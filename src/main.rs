#![windows_subsystem = "windows"]

mod app_installer;
mod app_settings;
mod backup_sync;
mod battery;
mod dashboard_actions;
mod dashboard_runtimes;
mod details;
mod devices;
mod devices_tree;
mod diagnostics;
mod disk_map;
mod disk_partitioner;
mod display_control;
mod docker_services;
mod event_log;
mod fast;
mod file_organizer;
mod github;
mod homelab;
mod installed_apps;
mod jira;
mod native;
mod network;
mod network_test;
mod night_light;
mod pdh;
mod preferences;
mod profiles;
mod rgb_hid;
mod rgb_nvapi;
mod rgb_smbus;
mod rgb_studio;
mod secrets;
mod security_repair;
mod sensors;
mod sharing;
mod smart_alerts;
mod snapshots;
mod ssh_certs;
mod startup;
mod storage;
mod system_controls;
mod tasks;
mod update_center;
mod wsl;

use preferences::PollingProfile;
use serde::Serialize;
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State, WindowEvent};

const PROCESS_INTERVAL: Duration = Duration::from_secs(3);

fn lock_or_recover<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

struct AtomicResetGuard<'a>(&'a AtomicBool);
impl Drop for AtomicResetGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn bounds_visible_on_monitors(
    bounds: preferences::WindowBounds,
    monitors: &[tauri::Monitor],
) -> bool {
    if monitors.is_empty() {
        return true;
    }
    let left = bounds.x;
    let top = bounds.y;
    let right = bounds.x.saturating_add(bounds.width as i32);
    let bottom = bounds.y.saturating_add(bounds.height as i32);
    monitors.iter().any(|m| {
        let pos = m.position();
        let size = m.size();
        let m_right = pos.x.saturating_add(size.width as i32);
        let m_bottom = pos.y.saturating_add(size.height as i32);
        let overlap_w = right.min(m_right) - left.max(pos.x);
        let overlap_h = bottom.min(m_bottom) - top.max(pos.y);
        overlap_w >= 80 && overlap_h >= 60
    })
}

#[derive(Default)]
struct Dashboard {
    fast: Mutex<Option<Arc<fast::FastSample>>>,
    details: Mutex<Option<(u64, Arc<details::Details>)>>,
    schedule: (Mutex<Schedule>, Condvar),
    smoke_test: bool,
    rendered: AtomicBool,
    testing_network: AtomicBool,
    window_shown: AtomicBool,
    sensors: sensors::SensorBridge,
    disk_scan: Arc<disk_map::State>,
    diagnostics_report: Mutex<Option<Arc<diagnostics::Report>>>,
    window_lock_mode: Mutex<preferences::WindowLockMode>,
    locked_position: Mutex<Option<tauri::PhysicalPosition<i32>>>,
}

#[derive(Serialize)]
struct DiagnosticsFrame {
    report: Arc<diagnostics::Report>,
    dismissed: Vec<event_log::Key>,
}

#[tauri::command]
async fn diagnostics_scan(
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
    options: diagnostics::Options,
) -> Result<DiagnosticsFrame, String> {
    let report = Arc::new(
        tauri::async_runtime::spawn_blocking(move || diagnostics::scan(options))
            .await
            .map_err(|error| error.to_string())??,
    );
    *lock_or_recover(&dashboard.diagnostics_report) = Some(report.clone());
    Ok(DiagnosticsFrame {
        report,
        dismissed: store.state().settings.diagx_dismissed,
    })
}

#[tauri::command]
async fn diagnostics_event(key: event_log::Key) -> Result<Option<event_log::Record>, String> {
    if !diagnostics::valid_key(&key) {
        return Err("This Windows event reference is invalid.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        event_log::by_key(&key)
            .map_err(|error| std::io::Error::from_raw_os_error(error as i32).to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn diagnostics_mark(
    store: State<'_, Arc<preferences::Store>>,
    key: event_log::Key,
    solved: bool,
) -> Result<Vec<event_log::Key>, String> {
    if !diagnostics::valid_key(&key) {
        return Err("This Windows event reference is invalid.".into());
    }
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut changes = preferences::Changes::default();
        changes.diagnostic_mark = Some((key, solved));
        store
            .update(changes, |_| ())
            .map(|state| state.diagx_dismissed)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn diagnostics_clear(dashboard: State<'_, Arc<Dashboard>>) {
    if lock_or_recover(&dashboard.diagnostics_report)
        .take()
        .is_some()
    {
        native::trim_working_set();
    }
}

#[tauri::command]
fn diagnostics_code(input: String) -> Result<diagnostics::Code, String> {
    diagnostics::translate(&input)
}

#[tauri::command]
async fn diagnostics_open_dump(
    dashboard: State<'_, Arc<Dashboard>>,
    path: std::path::PathBuf,
) -> Result<(), String> {
    if dashboard.smoke_test {
        return Err("Dump explorer actions are disabled during smoke tests.".into());
    }
    tauri::async_runtime::spawn_blocking(move || diagnostics::open_dump(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn diagnostics_launch_tool(
    dashboard: State<'_, Arc<Dashboard>>,
    kind: String,
) -> Result<(), String> {
    if dashboard.smoke_test {
        return Err("External tools are disabled during smoke tests.".into());
    }
    tauri::async_runtime::spawn_blocking(move || diagnostics::launch_tool(&kind))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn diagnostics_export(
    window: tauri::WebviewWindow,
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
) -> Result<Option<String>, String> {
    if dashboard.smoke_test {
        return Err("File exports are disabled during smoke tests.".into());
    }
    let report = lock_or_recover(&dashboard.diagnostics_report)
        .clone()
        .ok_or("Run a diagnostics scan first.")?;
    let settings = store.state().settings;
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app_settings::pick(
            owner,
            settings.directories.exports_root.into(),
            app_settings::Picker::ReportSave,
        )?
        else {
            return Ok(None);
        };
        let report = diagnostics::markdown(&report, &settings.diagx_dismissed);
        app_settings::write_export(&path, report.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Default, Clone, Copy)]
struct Schedule {
    minimized: bool,
    paused: bool,
    requested: u64,
    polling_profile: PollingProfile,
}

impl Dashboard {
    fn wake(&self) {
        lock_or_recover(&self.schedule.0).requested += 1;
        self.schedule.1.notify_all();
    }

    fn minimize(&self, minimized: bool, background_watchdog: bool) {
        let mut state = lock_or_recover(&self.schedule.0);
        if state.minimized != minimized {
            state.minimized = minimized;
            // Keep sensor helper alive when minimized if Smart Alerts or RGB Thermal needs live temps!
            self.sensors
                .pause(state.paused || (state.minimized && !background_watchdog));
            state.requested += 1;
            self.schedule.1.notify_all();
            drop(state);
            if minimized {
                // Evict heavy on-demand caches and release unused Rust working set pages in tray.
                self.disk_scan.clear();
                let _ = lock_or_recover(&self.diagnostics_report).take();
                native::trim_working_set();
            }
        }
    }

    fn set_paused(&self, paused: bool, background_watchdog: bool) {
        let mut state = lock_or_recover(&self.schedule.0);
        if state.paused != paused {
            state.paused = paused;
            self.sensors
                .pause(state.paused || (state.minimized && !background_watchdog));
            if !paused {
                state.requested += 1;
            }
            self.schedule.1.notify_all();
        }
    }

    pub fn sync_watchdog(&self, background_watchdog: bool) {
        let state = lock_or_recover(&self.schedule.0);
        self.sensors
            .pause(state.paused || (state.minimized && !background_watchdog));
        self.schedule.1.notify_all();
    }

    fn is_paused(&self) -> bool {
        lock_or_recover(&self.schedule.0).paused
    }

    fn observe_window(&self, window: &tauri::Window, background_watchdog: bool) {
        if let (Ok(minimized), Ok(visible)) = (window.is_minimized(), window.is_visible()) {
            if visible && !minimized {
                self.window_shown.store(true, Ordering::Release);
            }
            if self.window_shown.load(Ordering::Acquire) {
                self.minimize(minimized || !visible, background_watchdog);
            }
        }
    }

    fn set_polling_profile(&self, profile: PollingProfile) {
        let mut settings = lock_or_recover(&self.schedule.0);
        if settings.polling_profile != profile {
            settings.polling_profile = profile;
            self.schedule.1.notify_all();
        }
    }

    fn wait(&self, next: Instant, handled: Schedule) -> Schedule {
        let (lock, wake) = &self.schedule;
        let mut state = lock_or_recover(lock);
        loop {
            if state.minimized || state.paused {
                state = wake.wait(state).unwrap_or_else(|e| e.into_inner());
            } else if state.requested != handled.requested
                || state.polling_profile != handled.polling_profile
                || next <= Instant::now()
            {
                return *state;
            } else {
                let duration = next.saturating_duration_since(Instant::now());
                (state, _) = wake
                    .wait_timeout(state, duration)
                    .unwrap_or_else(|e| e.into_inner());
            }
        }
    }

    /// Details worker wait: when minimized to tray (not paused), wakes every 5s if Smart Alerts
    /// or RGB Thermal needs background monitoring so tray mode never blinds alerts or thermal RGB.
    fn wait_details(&self, next: Instant, handled: Schedule, background_watchdog: bool) -> (Schedule, bool) {
        let (lock, wake) = &self.schedule;
        let mut state = lock_or_recover(lock);
        loop {
            if state.paused {
                state = wake.wait(state).unwrap_or_else(|e| e.into_inner());
            } else if state.minimized {
                if !background_watchdog {
                    state = wake.wait(state).unwrap_or_else(|e| e.into_inner());
                } else {
                    let (next_state, timed_out) = wake
                        .wait_timeout(state, Duration::from_secs(5))
                        .unwrap_or_else(|e| e.into_inner());
                    state = next_state;
                    if state.minimized && !state.paused && timed_out.timed_out() {
                        return (*state, true);
                    }
                }
            } else if state.requested != handled.requested
                || state.polling_profile != handled.polling_profile
                || next <= Instant::now()
            {
                return (*state, false);
            } else {
                let duration = next.saturating_duration_since(Instant::now());
                (state, _) = wake
                    .wait_timeout(state, duration)
                    .unwrap_or_else(|e| e.into_inner());
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    live: Option<Arc<fast::FastSample>>,
    details: Option<Arc<details::Details>>,
    revision: u64,
    poll_interval_ms: u64,
    telemetry_paused: bool,
    unread_alerts: usize,
    smoke_test: bool,
}

#[tauri::command]
fn snapshot(
    state: State<'_, Arc<Dashboard>>,
    alerts: State<'_, Arc<smart_alerts::AlertsEngine>>,
    after: u64,
) -> Snapshot {
    let live = lock_or_recover(&state.fast).clone();
    let details = lock_or_recover(&state.details);
    let revision = details.as_ref().map_or(0, |entry| entry.0);
    let schedule = *lock_or_recover(&state.schedule.0);
    Snapshot {
        live,
        details: details
            .as_ref()
            .filter(|entry| entry.0 != after)
            .map(|entry| entry.1.clone()),
        revision,
        poll_interval_ms: schedule.polling_profile.fast_interval().as_millis() as u64,
        telemetry_paused: schedule.paused,
        unread_alerts: alerts.unread_count(),
        smoke_test: state.smoke_test,
    }
}

#[tauri::command]
fn set_telemetry_paused(
    state: State<'_, Arc<Dashboard>>,
    alerts: State<'_, Arc<smart_alerts::AlertsEngine>>,
    rgb: State<'_, Arc<rgb_studio::RgbEngine>>,
    paused: bool,
) -> bool {
    let bg_active = !state.smoke_test
        && (alerts.has_enabled_rules() || rgb.needs_thermal_telemetry());
    state.set_paused(paused, bg_active);
    state.is_paused()
}

#[tauri::command]
fn set_window_lock_mode(
    window: tauri::WebviewWindow,
    state: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
    mode: preferences::WindowLockMode,
) -> Result<preferences::WindowLockMode, String> {
    *lock_or_recover(&state.window_lock_mode) = mode;
    if matches!(
        mode,
        preferences::WindowLockMode::Position | preferences::WindowLockMode::All
    ) {
        if let Ok(pos) = window.outer_position() {
            *lock_or_recover(&state.locked_position) = Some(pos);
        }
    } else {
        *lock_or_recover(&state.locked_position) = None;
    }
    let resizable = !matches!(mode, preferences::WindowLockMode::All);
    let _ = window.set_resizable(resizable);
    let mut changes = preferences::Changes::default();
    changes.window_lock_mode = Some(mode);
    store
        .update(changes, |_| ())
        .map_err(|e| e.to_string())?;
    Ok(mode)
}

#[tauri::command]
fn refresh(state: State<'_, Arc<Dashboard>>) {
    state.wake();
}

#[tauri::command]
fn dashboard_preferences(
    window: tauri::Window,
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
    alerts: State<'_, Arc<smart_alerts::AlertsEngine>>,
    rgb: State<'_, Arc<rgb_studio::RgbEngine>>,
) -> preferences::State {
    if window.label() == "main" {
        let bg_active = !dashboard.smoke_test
            && (alerts.has_enabled_rules() || rgb.needs_thermal_telemetry());
        dashboard.observe_window(&window, bg_active);
    }
    store.state()
}

#[tauri::command]
async fn save_dashboard_preferences(
    window: tauri::WebviewWindow,
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
    changes: preferences::Changes,
) -> Result<preferences::Settings, String> {
    let store = store.inner().clone();
    let dashboard = dashboard.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let previous = store.state().settings;
        let startup = changes.start_with_windows;
        if let Some(enabled) = startup
            && !dashboard.smoke_test
        {
            app_settings::set_startup(enabled)?;
        }
        if let Some(opacity) = changes.opacity {
            app_settings::set_opacity(&window, opacity)?;
        }
        let result = store
            .update(changes, |profile| dashboard.set_polling_profile(profile))
            .map_err(|error| error.to_string());
        if result.is_err() {
            if startup.is_some() && !dashboard.smoke_test {
                app_settings::set_startup(previous.general.start_with_windows)?;
            }
            app_settings::set_opacity(&window, previous.opacity)?;
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SettingsAction {
    Startup,
    Catalog,
    Browse { location: app_settings::Location },
    Open { location: app_settings::Location },
    Detect { editor: app_settings::Editor },
    OpenData,
    CheckUpdates,
    OpenReleases,
    OpenProject,
    ThemeImport,
    ThemeExport { theme: Box<preferences::Theme> },
    Wallpaper,
    DiskFolder,
}

#[tauri::command]
async fn settings_action(
    window: tauri::WebviewWindow,
    store: State<'_, Arc<preferences::Store>>,
    dashboard: State<'_, Arc<Dashboard>>,
    action: SettingsAction,
) -> Result<serde_json::Value, String> {
    use app_settings::Picker;
    let store = store.inner().clone();
    let smoke = dashboard.smoke_test;
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        let dirs = store.state().settings.directories;
        let json = |result: serde_json::Error| result.to_string();
        if smoke && !matches!(action, SettingsAction::Startup | SettingsAction::Catalog | SettingsAction::Detect { .. }) {
            return Err("External settings actions are disabled during smoke tests.".into());
        }
        match action {
            SettingsAction::Catalog => {
                let catalog: serde_json::Value = serde_json::from_str(include_str!("../docs/modules-catalog.json")).map_err(json)?;
                let smoke_disk_root = smoke.then(resolve_smoke_disk_root);
                let installed_modules = if smoke {
                    preferences::INSTALLED_MODULES
                        .iter()
                        .map(|&id| id.to_owned())
                        .collect::<Vec<_>>()
                } else {
                    read_installed_modules_manifest().unwrap_or_else(|| {
                        preferences::INSTALLED_MODULES
                            .iter()
                            .map(|&id| id.to_owned())
                            .collect()
                    })
                };
                Ok(serde_json::json!({
                    "modules": catalog["modules"],
                    "installedModules": installed_modules,
                    "version": env!("CARGO_PKG_VERSION"),
                    "smoke": smoke,
                    "smokeDiskRoot": smoke_disk_root
                }))
            }
            SettingsAction::Startup if smoke => Ok(serde_json::json!({ "enabled": store.state().settings.general.start_with_windows, "detail": "Smoke test" })),
            SettingsAction::Startup => serde_json::to_value(app_settings::startup()?).map_err(json),
            SettingsAction::Browse { location } => {
                let picker = if location.is_editor() { Picker::Editor } else { Picker::Directory };
                serde_json::to_value(app_settings::pick(owner, location.path(&dirs).to_path_buf(), picker)?).map_err(json)
            }
            SettingsAction::Open { location } => { app_settings::open_location(location, &dirs)?; Ok(serde_json::Value::Null) }
            SettingsAction::Detect { editor } => serde_json::to_value(app_settings::detect_editor(editor)).map_err(json),
            SettingsAction::OpenData => {
                let path = store.directory().ok_or("The CoreWatch data folder is unavailable.")?;
                std::fs::create_dir_all(path).map_err(|error| error.to_string())?;
                dashboard_actions::open_directory(path)?;
                Ok(serde_json::Value::Null)
            }
            SettingsAction::CheckUpdates => serde_json::to_value(app_settings::release_status()?).map_err(json),
            SettingsAction::OpenReleases => { app_settings::open_releases()?; Ok(serde_json::Value::Null) }
            SettingsAction::OpenProject => {
                dashboard_actions::shell_open("https://github.com/jonathan820612/CoreWatch-Host-Engine", None, false)?;
                Ok(serde_json::Value::Null)
            }
            SettingsAction::ThemeImport => {
                let Some(path) = app_settings::pick(owner, dirs.exports_root.into(), Picker::ThemeOpen)? else { return Ok(serde_json::Value::Null); };
                let bytes = app_settings::read_file(&path, 1024 * 1024)?;
                let payload: serde_json::Value = serde_json::from_slice(&bytes).map_err(json)?;
                let theme = payload.get("theme").unwrap_or(&payload);
                if !theme.is_object() || !["presetId", "bgApp", "bgSurface"].iter().any(|key| theme.get(key).is_some()) {
                    return Err("The selected JSON does not contain a CoreWatch theme.".into());
                }
                let mut theme: preferences::Theme = serde_json::from_value(theme.clone()).map_err(json)?;
                theme.normalize();
                serde_json::to_value(theme).map_err(json)
            }
            SettingsAction::ThemeExport { mut theme } => {
                let Some(path) = app_settings::pick(owner, dirs.exports_root.into(), Picker::ThemeSave)? else { return Ok(serde_json::Value::Null); };
                theme.normalize();
                app_settings::export_theme(&path, &theme)?;
                Ok(serde_json::json!(true))
            }
            SettingsAction::Wallpaper => {
                let Some(path) = app_settings::pick(owner, dirs.projects_root.into(), Picker::Image)? else { return Ok(serde_json::Value::Null); };
                let bytes = app_settings::read_file(&path, preferences::MAX_IMAGE_BYTES)?;
                serde_json::to_value(store.set_wallpaper(bytes).map_err(|error| error.to_string())?).map_err(json)
            }
            SettingsAction::DiskFolder => serde_json::to_value(app_settings::pick(owner, dirs.projects_root.into(), Picker::Directory)?).map_err(json),
        }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn disk_map_drives() -> Result<Vec<storage::Volume>, String> {
    tauri::async_runtime::spawn_blocking(storage::volumes)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn disk_map_scan(
    dashboard: State<'_, Arc<Dashboard>>,
    path: std::path::PathBuf,
) -> Result<disk_map::Scan, String> {
    let job = dashboard.disk_scan.begin()?;
    tauri::async_runtime::spawn_blocking(move || job.scan(path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn disk_map_cancel(dashboard: State<'_, Arc<Dashboard>>) {
    dashboard.disk_scan.cancel();
}

#[tauri::command]
fn disk_map_clear(dashboard: State<'_, Arc<Dashboard>>) {
    dashboard.disk_scan.clear();
}

#[tauri::command]
async fn disk_map_open(
    dashboard: State<'_, Arc<Dashboard>>,
    path: std::path::PathBuf,
) -> Result<(), String> {
    if dashboard.smoke_test {
        return Err("Explorer actions are disabled during smoke tests.".into());
    }
    tauri::async_runtime::spawn_blocking(move || disk_map::open_path(&path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn disk_map_node(
    dashboard: State<'_, Arc<Dashboard>>,
    path: std::path::PathBuf,
) -> Result<Option<disk_map::Scan>, String> {
    dashboard.disk_scan.node_view(&path)
}

#[tauri::command]
async fn disk_map_recycle(
    dashboard: State<'_, Arc<Dashboard>>,
    path: std::path::PathBuf,
    current_view: Option<std::path::PathBuf>,
) -> Result<Option<disk_map::Scan>, String> {
    if dashboard.smoke_test {
        return Err("Recycle actions are disabled during smoke tests.".into());
    }
    let disk = dashboard.disk_scan.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        disk.recycle(&path, current_view.as_deref())
    })
    .await
    .map_err(|error| error.to_string())??;
    dashboard.wake();
    Ok(res)
}

#[tauri::command]
async fn tasks_snapshot() -> Result<tasks::Snapshot, String> {
    tauri::async_runtime::spawn_blocking(tasks::snapshot)
        .await
        .map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TasksAction {
    Terminate {
        pid: u32,
        token: String,
    },
    Folder {
        pid: u32,
    },
    Service {
        name: String,
        action: tasks::ServiceAction,
    },
}

#[tauri::command]
async fn tasks_action(
    dashboard: State<'_, Arc<Dashboard>>,
    action: TasksAction,
) -> Result<(), String> {
    if dashboard.smoke_test {
        return Err("Task actions are disabled during smoke tests.".into());
    }
    tauri::async_runtime::spawn_blocking(move || match action {
        TasksAction::Terminate { pid, token } => tasks::terminate(pid, &token),
        TasksAction::Folder { pid } => tasks::process_folder(pid),
        TasksAction::Service { name, action } => tasks::control_service(&name, action),
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_dashboard_preferences(
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
) -> Result<preferences::Settings, String> {
    let store = store.inner().clone();
    let dashboard = dashboard.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .legacy_changes()
            .and_then(|changes| {
                store.update(changes, |profile| dashboard.set_polling_profile(profile))
            })
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_dashboard_wallpaper(
    store: State<'_, Arc<preferences::Store>>,
    request: tauri::ipc::Request<'_>,
) -> Result<u64, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Choose a local image file.".into());
    };
    if bytes.len() > preferences::MAX_IMAGE_BYTES {
        return Err("Choose an image no larger than 12 MiB.".into());
    }
    let bytes = bytes.clone();
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.set_wallpaper(bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn remove_dashboard_wallpaper(
    store: State<'_, Arc<preferences::Store>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.remove_wallpaper().map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn network_adapters() -> Result<Vec<network::ManagedAdapter>, String> {
    tauri::async_runtime::spawn_blocking(network::adapters)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn network_tables() -> Result<network::NetworkTables, String> {
    tauri::async_runtime::spawn_blocking(network::tables)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_network_diagnostic(
    request: network::Diagnostic,
) -> Result<network::DiagnosticResult, String> {
    tauri::async_runtime::spawn_blocking(move || network::diagnose(request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn configure_network_adapter(
    state: State<'_, Arc<Dashboard>>,
    index: u32,
    alias: String,
    action: network::AdapterAction,
) -> Result<String, String> {
    let result =
        tauri::async_runtime::spawn_blocking(move || network::configure(index, &alias, action))
            .await
            .map_err(|e| e.to_string())?;
    state.wake();
    result
}

#[tauri::command]
async fn flush_dns_cache() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(network::flush_dns)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_dns(flush: bool) -> Result<network::DnsCheck, String> {
    tauri::async_runtime::spawn_blocking(move || network::check_dns(flush))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_dashboard_dns(
    state: State<'_, Arc<Dashboard>>,
    index: u32,
    alias: String,
    servers: Vec<std::net::Ipv4Addr>,
) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        network::set_dashboard_dns(index, &alias, &servers)
    })
    .await
    .map_err(|e| e.to_string())?;
    state.wake();
    result
}

#[tauri::command]
async fn refresh_dashboard_arp(
    state: State<'_, Arc<Dashboard>>,
) -> Result<native::GatewayNeighbor, String> {
    let result = tauri::async_runtime::spawn_blocking(network::refresh_dashboard_arp)
        .await
        .map_err(|e| e.to_string())?;
    state.wake();
    result
}

#[tauri::command]
async fn cpu_sensor_status(
    state: State<'_, Arc<Dashboard>>,
) -> Result<sensors::SensorStatus, String> {
    let bridge = state.sensors.clone();
    tauri::async_runtime::spawn_blocking(move || sensors::status(Some(&bridge)))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_discovery_sharing(
    state: State<'_, Arc<Dashboard>>,
    group: devices::FirewallGroup,
    enabled: bool,
) -> Result<(), String> {
    let result =
        tauri::async_runtime::spawn_blocking(move || devices::set_firewall_group(group, enabled))
            .await
            .map_err(|e| e.to_string())?;
    state.wake();
    result
}

#[tauri::command]
async fn external_ipv4() -> Result<Option<std::net::Ipv4Addr>, String> {
    tauri::async_runtime::spawn_blocking(network_test::external_ipv4)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum DashboardChange {
    SystemToggle {
        setting: system_controls::Setting,
        enabled: bool,
    },
    NetworkProfile {
        index: u32,
        private: bool,
    },
    DisplayScale {
        id: String,
        percent: u32,
    },
    NightLight {
        enabled: bool,
    },
    NightWarmth {
        percent: u32,
    },
    Restart,
    SelectJava {
        home: std::path::PathBuf,
    },
    InstallJava {
        major: u8,
    },
    UpdatePowershell {
        version: String,
    },
}

#[tauri::command]
async fn apply_dashboard_change(
    state: State<'_, Arc<Dashboard>>,
    change: DashboardChange,
) -> Result<Option<String>, String> {
    if state.smoke_test {
        return Err("Dashboard smoke tests cannot apply system changes.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        match change {
            DashboardChange::SystemToggle { setting, enabled } => {
                system_controls::set(setting, enabled)
            }
            DashboardChange::NetworkProfile { index, private } => {
                system_controls::set_network_profile(index, private)
            }
            DashboardChange::DisplayScale { id, percent } => {
                native::set_display_scale(&id, percent)
            }
            DashboardChange::NightLight { enabled } => night_light::set_enabled(enabled),
            DashboardChange::NightWarmth { percent } => night_light::set_warmth(percent),
            DashboardChange::Restart => system_controls::restart(),
            DashboardChange::SelectJava { home } => dashboard_runtimes::select_java(home),
            DashboardChange::InstallJava { major } => dashboard_runtimes::install_java(major),
            DashboardChange::UpdatePowershell { version } => {
                return dashboard_runtimes::update_powershell(version).map(Some);
            }
        }
        .map(|()| None)
    })
    .await
    .map_err(|error| error.to_string())?;
    state.wake();
    result
}

#[tauri::command]
async fn display_scale_options(id: String) -> Result<native::DisplayScale, String> {
    tauri::async_runtime::spawn_blocking(move || native::display_scale_options(&id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn java_runtimes() -> Result<Vec<dashboard_runtimes::JavaRuntime>, String> {
    tauri::async_runtime::spawn_blocking(dashboard_runtimes::java_runtimes)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn powershell_update() -> Result<dashboard_runtimes::PowerShellUpdate, String> {
    tauri::async_runtime::spawn_blocking(dashboard_runtimes::powershell_update)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn identify_displays(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dashboard_actions::identify(&app, &window))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn display_modes(id: String) -> Result<display_control::Choices, String> {
    tauri::async_runtime::spawn_blocking(move || display_control::options(&id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn preview_display(
    state: State<'_, Arc<Dashboard>>,
    id: String,
    change: display_control::DisplayChange,
) -> Result<Option<u32>, String> {
    let preview =
        tauri::async_runtime::spawn_blocking(move || display_control::preview(&id, change))
            .await
            .map_err(|e| e.to_string())??;
    state.wake();
    Ok(preview)
}

#[tauri::command]
async fn confirm_display(
    state: State<'_, Arc<Dashboard>>,
    token: u32,
    keep: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || display_control::finish(token, keep))
        .await
        .map_err(|e| e.to_string())??;
    state.wake();
    Ok(())
}

#[tauri::command]
async fn set_advanced_color(
    state: State<'_, Arc<Dashboard>>,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || native::set_hd_color(&id, enabled))
        .await
        .map_err(|e| e.to_string())??;
    state.wake();
    Ok(())
}

#[tauri::command]
async fn elevate(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(dashboard_actions::relaunch_elevated)
        .await
        .map_err(|e| e.to_string())??;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn relaunch_app(
    app: tauri::AppHandle,
    state: State<'_, Arc<Dashboard>>,
) -> Result<(), String> {
    if state.smoke_test {
        return Err("App restart is disabled during smoke tests.".into());
    }
    tauri::async_runtime::spawn_blocking(dashboard_actions::relaunch)
        .await
        .map_err(|e| e.to_string())??;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn open_volume(mount: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dashboard_actions::open_volume(&mount))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn label_volume(
    state: State<'_, Arc<Dashboard>>,
    mount: String,
    label: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dashboard_actions::label_volume(&mount, &label))
        .await
        .map_err(|e| e.to_string())??;
    state.wake();
    Ok(())
}

#[tauri::command]
async fn power_plans() -> Result<Vec<dashboard_actions::PowerPlan>, String> {
    tauri::async_runtime::spawn_blocking(dashboard_actions::power_plans)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_power_plan(state: State<'_, Arc<Dashboard>>, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || dashboard_actions::set_power_plan(&id))
        .await
        .map_err(|e| e.to_string())??;
    state.wake();
    Ok(())
}

#[tauri::command]
async fn test_network(state: State<'_, Arc<Dashboard>>) -> Result<network_test::Results, String> {
    if state.testing_network.swap(true, Ordering::AcqRel) {
        return Err("A network test is already running.".to_owned());
    }
    let _reset = AtomicResetGuard(&state.testing_network);
    tauri::async_runtime::spawn_blocking(network_test::run)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn dp_list_disks(rescan: Option<bool>) -> Result<disk_partitioner::DiskPartitionerState, String> {
    let do_rescan = rescan.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        disk_partitioner::list_disks(do_rescan, String::new(), false)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn dp_action(
    state: State<'_, Arc<Dashboard>>,
    action: disk_partitioner::PartitionAction,
) -> Result<disk_partitioner::DiskPartitionerState, String> {
    let result = tauri::async_runtime::spawn_blocking(move || disk_partitioner::execute_action(action))
        .await
        .map_err(|e| e.to_string())??;
    state.wake();
    Ok(result)
}

#[tauri::command]
async fn startup_list() -> Result<startup::StartupList, String> {
    tauri::async_runtime::spawn_blocking(startup::list)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn startup_action(action: startup::StartupAction) -> Result<startup::StartupList, String> {
    tauri::async_runtime::spawn_blocking(move || startup::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn profiles_state(mgr: State<'_, Arc<profiles::ProfileManager>>) -> profiles::ProfilesState {
    mgr.snapshot()
}

#[tauri::command]
async fn profiles_action(
    dashboard: State<'_, Arc<Dashboard>>,
    mgr: State<'_, Arc<profiles::ProfileManager>>,
    rgb: State<'_, Arc<rgb_studio::RgbEngine>>,
    action: profiles::ProfileAction,
) -> Result<(profiles::ProfilesState, String), String> {
    let activated_id = match &action {
        profiles::ProfileAction::Activate { id } => Some(id.clone()),
        _ => None,
    };
    let mgr = mgr.inner().clone();
    let out = tauri::async_runtime::spawn_blocking(move || mgr.execute(action))
        .await
        .map_err(|e| e.to_string())??;
    if let Some(id) = activated_id {
        let rgb = rgb.inner().clone();
        tauri::async_runtime::spawn_blocking(move || rgb.on_profile_activated(&id));
    }
    dashboard.wake();
    Ok(out)
}

#[tauri::command]
async fn rgb_state(
    engine: State<'_, Arc<rgb_studio::RgbEngine>>,
) -> Result<rgb_studio::RgbStateSnapshot, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.snapshot())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn rgb_action(
    engine: State<'_, Arc<rgb_studio::RgbEngine>>,
    action: rgb_studio::RgbAction,
) -> Result<rgb_studio::RgbStateSnapshot, String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn alerts_state(engine: State<'_, Arc<smart_alerts::AlertsEngine>>) -> smart_alerts::AlertsStore {
    engine.snapshot()
}

#[tauri::command]
async fn alerts_action(
    engine: State<'_, Arc<smart_alerts::AlertsEngine>>,
    action: smart_alerts::AlertAction,
) -> Result<(smart_alerts::AlertsStore, String), String> {
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || engine.execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn battery_snapshot() -> Result<battery::BatterySnapshot, String> {
    tauri::async_runtime::spawn_blocking(battery::snapshot)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn battery_action(
    store: State<'_, Arc<preferences::Store>>,
    action: battery::BatteryAction,
) -> Result<String, String> {
    let exports = store.state().settings.directories.exports_root;
    tauri::async_runtime::spawn_blocking(move || battery::execute(action, &exports))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn snapshots_list(
    store: State<'_, Arc<preferences::Store>>,
) -> Result<Vec<snapshots::SnapshotSummary>, String> {
    let dir = store.directory().map(std::path::Path::to_path_buf);
    tauri::async_runtime::spawn_blocking(move || snapshots::list_snapshots(dir.as_deref()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn snapshots_capture(
    store: State<'_, Arc<preferences::Store>>,
    label: String,
    create_restore_point: bool,
) -> Result<(snapshots::SnapshotSummary, String), String> {
    let dir = store.directory().map(std::path::Path::to_path_buf);
    tauri::async_runtime::spawn_blocking(move || {
        snapshots::save_snapshot(dir.as_deref(), label, create_restore_point)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn snapshots_diff(
    store: State<'_, Arc<preferences::Store>>,
    before_id: String,
    after_id: Option<String>,
) -> Result<snapshots::SnapshotDiff, String> {
    let dir = store.directory().map(std::path::Path::to_path_buf);
    tauri::async_runtime::spawn_blocking(move || {
        let before = snapshots::load_snapshot(dir.as_deref(), &before_id)?;
        let after = match after_id.as_deref().filter(|s| !s.is_empty() && *s != "__LIVE__") {
            Some(id) => snapshots::load_snapshot(dir.as_deref(), id)?,
            None => snapshots::capture_live("Current Live System".into()),
        };
        Ok(snapshots::diff(&before, &after))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn snapshots_delete(
    store: State<'_, Arc<preferences::Store>>,
    id: String,
) -> Result<(), String> {
    let dir = store.directory().map(std::path::Path::to_path_buf);
    tauri::async_runtime::spawn_blocking(move || snapshots::delete_snapshot(dir.as_deref(), &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ssh_certs_state() -> Result<ssh_certs::SshCertsState, String> {
    tauri::async_runtime::spawn_blocking(ssh_certs::load_state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn ssh_certs_action(action: ssh_certs::SshCertsAction) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ssh_certs::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn backup_state(mgr: State<'_, Arc<backup_sync::BackupManager>>) -> backup_sync::BackupState {
    mgr.snapshot()
}

#[tauri::command]
async fn backup_action(
    mgr: State<'_, Arc<backup_sync::BackupManager>>,
    action: backup_sync::BackupAction,
) -> Result<(backup_sync::BackupState, String), String> {
    let mgr = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn security_audit() -> Result<security_repair::SecurityPosture, String> {
    tauri::async_runtime::spawn_blocking(security_repair::audit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn security_repair_action(action: security_repair::RepairAction) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || security_repair::run_repair(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn docker_state() -> Result<docker_services::DockerState, String> {
    tauri::async_runtime::spawn_blocking(docker_services::load_state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn docker_action(action: docker_services::DockerAction) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || docker_services::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn installed_apps_list() -> Result<Vec<installed_apps::InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(installed_apps::list)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn installed_apps_action(action: installed_apps::AppAction) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || installed_apps::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn update_center_scan(
    store: State<'_, Arc<preferences::Store>>,
) -> Result<update_center::UpdateScan, String> {
    let dir = store.directory().map(std::path::Path::to_path_buf);
    tauri::async_runtime::spawn_blocking(move || update_center::scan(dir.as_deref()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_center_action(
    store: State<'_, Arc<preferences::Store>>,
    action: update_center::UpdateAction,
) -> Result<String, String> {
    let dir = store.directory().map(std::path::Path::to_path_buf);
    tauri::async_runtime::spawn_blocking(move || update_center::execute(dir.as_deref(), action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn homelab_list(mgr: State<'_, Arc<homelab::HomelabManager>>) -> Vec<homelab::HomelabNode> {
    mgr.list()
}

#[tauri::command]
async fn homelab_action(
    mgr: State<'_, Arc<homelab::HomelabManager>>,
    action: homelab::HomelabAction,
) -> Result<(Vec<homelab::HomelabNode>, String), String> {
    let mgr = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn wsl_state() -> Result<wsl::WslState, String> {
    tauri::async_runtime::spawn_blocking(wsl::load_state)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn wsl_action(action: wsl::WslAction) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || wsl::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn sharing_list() -> Result<sharing::SharingState, String> {
    tauri::async_runtime::spawn_blocking(sharing::list)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn sharing_action(
    action: sharing::SharingAction,
) -> Result<(sharing::SharingState, String), String> {
    tauri::async_runtime::spawn_blocking(move || sharing::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn devices_scan() -> Result<devices_tree::DevicesReport, String> {
    tauri::async_runtime::spawn_blocking(devices_tree::scan)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn devices_action(action: devices_tree::DeviceAction) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || devices_tree::execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn organizer_state(
    mgr: State<'_, Arc<file_organizer::OrganizerManager>>,
) -> file_organizer::OrganizerState {
    mgr.snapshot()
}

#[tauri::command]
async fn organizer_action(
    mgr: State<'_, Arc<file_organizer::OrganizerManager>>,
    action: file_organizer::OrganizerAction,
) -> Result<file_organizer::OrganizerResult, String> {
    let mgr = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn app_installer_catalog() -> Vec<app_installer::CatalogApp> {
    app_installer::catalog()
}

#[tauri::command]
async fn app_installer_action(
    action: app_installer::InstallerAction,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || match action {
        app_installer::InstallerAction::Search { query } => {
            serde_json::to_value(app_installer::search(&query)?).map_err(|e| e.to_string())
        }
        app_installer::InstallerAction::InstallBatch { ids } => {
            serde_json::to_value(app_installer::install_batch(&ids)?).map_err(|e| e.to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn github_state(
    store: State<'_, Arc<preferences::Store>>,
) -> Result<github::GitHubState, String> {
    let root = store.state().settings.directories.projects_root;
    tauri::async_runtime::spawn_blocking(move || github::scan_repos(&root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn github_action(
    store: State<'_, Arc<preferences::Store>>,
    action: github::GitHubAction,
) -> Result<String, String> {
    let dirs = store.state().settings.directories;
    tauri::async_runtime::spawn_blocking(move || {
        github::execute(action, &dirs.projects_root, &dirs.editor_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn jira_config(mgr: State<'_, Arc<jira::JiraManager>>) -> jira::JiraPublicConfig {
    mgr.public_config()
}

#[tauri::command]
async fn jira_action(
    mgr: State<'_, Arc<jira::JiraManager>>,
    action: jira::JiraAction,
) -> Result<jira::JiraResponse, String> {
    let mgr = mgr.inner().clone();
    tauri::async_runtime::spawn_blocking(move || mgr.execute(action))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pick_folder(
    window: tauri::WebviewWindow,
    dashboard: State<'_, Arc<Dashboard>>,
    initial: Option<String>,
) -> Result<Option<String>, String> {
    if dashboard.smoke_test {
        return Ok(None);
    }
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let start = initial
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(std::path::PathBuf::from)
                .unwrap_or_default()
        });
    tauri::async_runtime::spawn_blocking(move || {
        Ok(app_settings::pick(owner, start, app_settings::Picker::Directory)?
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn snapshots_export(
    window: tauri::WebviewWindow,
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
    markdown: String,
) -> Result<Option<String>, String> {
    if dashboard.smoke_test {
        return Err("File exports are disabled during smoke tests.".into());
    }
    let exports_root = store.state().settings.directories.exports_root;
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app_settings::pick(
            owner,
            exports_root.into(),
            app_settings::Picker::ReportSave,
        )?
        else {
            return Ok(None);
        };
        app_settings::write_export(&path, markdown.as_bytes())?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn finish_dashboard_smoke(
    app: tauri::AppHandle,
    state: State<'_, Arc<Dashboard>>,
    error: Option<String>,
) {
    if state.smoke_test {
        state.rendered.store(true, Ordering::Release);
        if let Some(error) = error {
            eprintln!("Dashboard smoke test: {error}");
            app.exit(1);
            std::process::exit(1);
        } else {
            println!(
                "WebView2 verified Dashboard, Settings, Font Size, Command Palette, Theme Studio, Disk Partitioner, RGB Studio, Network, Tasks & Ports, UltimaDiagX, Disk Map, and all 24 Rust Modules."
            );
            app.exit(0);
            std::process::exit(0);
        }
    }
}

fn start_fast_worker(state: Arc<Dashboard>) {
    thread::spawn(move || {
        let mut collector = fast::Collector::default();
        let mut next = Instant::now();
        let mut next_process = next;
        let mut handled = Schedule::default();
        loop {
            let schedule = state.wait(next, handled);
            let start = Instant::now();
            if start.saturating_duration_since(next) > handled.polling_profile.fast_interval() * 3 {
                collector.reset_baseline();
            }
            let mut frame = lock_or_recover(&state.fast)
                .as_deref()
                .cloned()
                .unwrap_or_default();
            let refresh_process = start >= next_process || handled.requested != schedule.requested;
            collector.sample(refresh_process, &mut frame);
            if refresh_process {
                next_process = start + PROCESS_INTERVAL;
            }
            *lock_or_recover(&state.fast) = Some(Arc::new(frame));
            handled = schedule;
            next = start + schedule.polling_profile.fast_interval();
        }
    });
}

fn start_details_worker(
    state: Arc<Dashboard>,
    alerts: Arc<smart_alerts::AlertsEngine>,
    rgb: Arc<rgb_studio::RgbEngine>,
) {
    thread::spawn(move || {
        let _com = devices::ComApartment::enter();
        let mut collector = details::Collector::new();
        let mut next = Instant::now();
        let mut handled = Schedule::default();
        let mut revision = 0;
        loop {
            let bg_watchdog = !state.smoke_test
                && (alerts.has_enabled_rules() || rgb.needs_thermal_telemetry());
            let (schedule, background_tick) = state.wait_details(next, handled, bg_watchdog);
            if background_tick {
                // Lightweight tray tick: feed sensors & RAM/CPU to Smart Alerts + RGB Thermal
                // without running heavy UI display/network/volume enumeration.
                let sensor = state.sensors.latest();
                let cpu_temp = sensor.as_ref().and_then(|s| s.cpu_temp);
                let gpu_temp = sensor.as_ref().and_then(|s| s.gpu_temp);
                rgb.update_telemetry(cpu_temp, gpu_temp);
                let ram_pct = native::memory_usage()
                    .filter(|&(_, total)| total > 0)
                    .map(|(used, total)| (used as f64 / total as f64) * 100.0);
                let fired_any = alerts.evaluate(&smart_alerts::LiveTelemetryInput {
                    cpu_temp,
                    gpu_temp,
                    ram_pct,
                    cpu_load: None,
                    min_drive_free_pct: None,
                    has_default_route: true,
                });
                if fired_any {
                    rgb.trigger_alert_flash();
                }
                continue;
            }
            let start = Instant::now();
            if schedule.requested != handled.requested {
                collector.invalidate();
            }
            let details = collector.sample(state.sensors.latest().as_ref());
            if !state.smoke_test {
                let cpu_temp = details.field("cpuTemp").and_then(|s| s.parse().ok());
                let gpu_temp = details.field("gpuTemp").and_then(|s| s.parse().ok());
                rgb.update_telemetry(cpu_temp, gpu_temp);
                let fast_snap = lock_or_recover(&state.fast).clone();
                let ram_pct = fast_snap
                    .as_ref()
                    .and_then(|f| f.ram.as_ref())
                    .filter(|r| r.total > 0)
                    .map(|r| (r.used as f64 / r.total as f64) * 100.0);
                let cpu_load = fast_snap.as_ref().and_then(|f| f.cpu_percent).map(f64::from);
                let min_drive_free_pct = details
                    .volumes
                    .iter()
                    .filter(|v| v.drive_type == "Local Volume" && v.total > 0)
                    .map(|v| {
                        let free_pct =
                            (v.total.saturating_sub(v.used) as f64 / v.total as f64) * 100.0;
                        (v.mount.clone(), free_pct)
                    })
                    .min_by(|a, b| a.1.total_cmp(&b.1));
                let fired_any = alerts.evaluate(&smart_alerts::LiveTelemetryInput {
                    cpu_temp,
                    gpu_temp,
                    ram_pct,
                    cpu_load,
                    min_drive_free_pct,
                    has_default_route: details.dns_uplink.is_some(),
                });
                if fired_any {
                    rgb.trigger_alert_flash();
                }
            }
            revision += 1;
            *lock_or_recover(&state.details) = Some((revision, Arc::new(details)));
            handled = schedule;
            next = (start + schedule.polling_profile.details_interval())
                .max(Instant::now() + Duration::from_millis(250));
        }
    });
}

fn print_snapshot() {
    let interval = PollingProfile::default().fast_interval();
    let mut collector = fast::Collector::default();
    let mut sample = fast::FastSample::default();
    collector.sample(true, &mut sample);
    let _com = devices::ComApartment::enter();
    let mut details_collector = details::Collector::new();
    let live_sensors = sensors::instant_readings();
    let mut details = details_collector.sample(live_sensors.as_ref());
    thread::sleep(interval);
    collector.sample(true, &mut sample);
    details.volumes = details_collector.sample_volumes();
    println!(
        "{}",
        serde_json::to_string_pretty(&Snapshot {
            live: Some(Arc::new(sample)),
            details: Some(Arc::new(details)),
            revision: 1,
            poll_interval_ms: interval.as_millis() as u64,
            telemetry_paused: false,
            unread_alerts: 0,
            smoke_test: false,
        })
        .expect("serialize snapshot")
    );
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn AttachConsole(process_id: u32) -> i32;
    fn GetStdHandle(std_handle: u32) -> *mut core::ffi::c_void;
    fn GetFileType(handle: *mut core::ffi::c_void) -> u32;
    fn CreateMutexW(
        attributes: *const core::ffi::c_void,
        initial_owner: i32,
        name: *const u16,
    ) -> *mut core::ffi::c_void;
}

#[link(name = "user32")]
unsafe extern "system" {
    fn EnumWindows(
        enum_func: unsafe extern "system" fn(*mut core::ffi::c_void, isize) -> i32,
        lparam: isize,
    ) -> i32;
    fn GetWindowTextW(hwnd: *mut core::ffi::c_void, text: *mut u16, max_count: i32) -> i32;
    fn GetClassNameW(hwnd: *mut core::ffi::c_void, class_name: *mut u16, max_count: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: *mut core::ffi::c_void, process_id: *mut u32) -> u32;
    fn ShowWindow(hwnd: *mut core::ffi::c_void, cmd_show: i32) -> i32;
    fn SetForegroundWindow(hwnd: *mut core::ffi::c_void) -> i32;
}

unsafe extern "system" fn focus_existing_enum(
    hwnd: *mut core::ffi::c_void,
    lparam: isize,
) -> i32 {
    const SW_SHOW: i32 = 5;
    const SW_RESTORE: i32 = 9;
    let mut title_buf = [0u16; 128];
    let title_len = unsafe { GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32) };
    if title_len <= 0 {
        return 1;
    }
    let title = String::from_utf16_lossy(&title_buf[..title_len as usize]);
    if title != "RustCoreWatch" {
        return 1;
    }
    let mut class_buf = [0u16; 128];
    let class_len = unsafe { GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32) };
    let class = if class_len > 0 {
        String::from_utf16_lossy(&class_buf[..class_len as usize])
    } else {
        String::new()
    };
    // Never hijack File Explorer folders or unrelated browser tabs titled "RustCoreWatch".
    if class.eq_ignore_ascii_case("CabinetWClass")
        || class.eq_ignore_ascii_case("ExploreWClass")
        || class.starts_with("Chrome_WidgetWin")
    {
        return 1;
    }
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut pid);
    }
    if pid == 0 || pid == std::process::id() {
        return 1;
    }
    // Verify process executable name when accessible; if ACCESS_DENIED (existing instance elevated),
    // accept Tauri/Tao window classes.
    let mut verified = class == "Window Class" || class.starts_with("WRY") || class.starts_with("Tao");
    unsafe {
        use windows_sys::Win32::{
            Foundation::CloseHandle,
            System::Threading::{
                OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            },
        };
        let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !proc.is_null() {
            let mut path_buf = [0u16; 520];
            let mut len = path_buf.len() as u32;
            if QueryFullProcessImageNameW(proc, 0, path_buf.as_mut_ptr(), &mut len) != 0 {
                let exe = String::from_utf16_lossy(&path_buf[..len as usize]);
                verified = exe.to_ascii_lowercase().ends_with("rustcorewatch.exe");
            }
            CloseHandle(proc);
        }
    }
    if !verified {
        return 1;
    }
    unsafe {
        ShowWindow(hwnd, SW_SHOW);
        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        if lparam != 0 {
            *(lparam as *mut bool) = true;
        }
    }
    0
}

fn focus_existing_window() {
    let mut found = false;
    unsafe {
        let _ = EnumWindows(focus_existing_enum, (&raw mut found) as isize);
    }
}

fn resolve_smoke_disk_root() -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe()
        && let Some(dir) = exe.parent()
    {
        let beside = dir.join("ui");
        if beside.is_dir() {
            return beside;
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let ui = cwd.join("ui");
        if ui.is_dir() {
            return ui;
        }
    }
    #[cfg(any(debug_assertions, test))]
    {
        let manifest_ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("ui");
        if manifest_ui.is_dir() {
            return manifest_ui;
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallManifest {
    #[serde(default)]
    installed_modules: Vec<String>,
}

fn read_installed_modules_manifest() -> Option<Vec<String>> {
    let exe = std::env::current_exe().ok()?;
    let path = exe.parent()?.join("installed-modules.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let manifest: InstallManifest = serde_json::from_str(&raw).ok()?;
    let valid: Vec<String> = manifest
        .installed_modules
        .into_iter()
        .filter(|id| preferences::INSTALLED_MODULES.contains(&id.as_str()))
        .collect();
    Some(valid)
}

fn default_app_data_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("LOCALAPPDATA")
        .map(|root| std::path::PathBuf::from(root).join("com.corewatch.rust.dashboard"))
}

/// Headless CLI entry point invoked by the modular installer at the end of setup:
/// `RustCoreWatch.exe --configure-install [--apply-manifest | --enabled=id1,id2] [--startup=true|false] [--low-memory=true|false] [--data-dir=PATH]`
fn run_configure_install(args: &[String]) -> Result<(), String> {
    let mut data_dir = default_app_data_dir();
    let mut apply_manifest = false;
    let mut enabled_override: Option<Vec<String>> = None;
    let mut startup: Option<bool> = None;
    let mut low_memory: Option<bool> = None;

    for arg in args {
        if arg == "--apply-manifest" {
            apply_manifest = true;
        } else if let Some(val) = arg.strip_prefix("--enabled=") {
            let list: Vec<String> = val
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect();
            enabled_override = Some(list);
        } else if let Some(val) = arg.strip_prefix("--startup=") {
            startup = Some(matches!(val.to_ascii_lowercase().as_str(), "1" | "true" | "yes"));
        } else if let Some(val) = arg.strip_prefix("--low-memory=") {
            low_memory = Some(matches!(val.to_ascii_lowercase().as_str(), "1" | "true" | "yes"));
        } else if let Some(val) = arg.strip_prefix("--data-dir=")
            && !val.trim().is_empty()
        {
            data_dir = Some(std::path::PathBuf::from(val.trim()));
        }
    }

    let dir = data_dir.ok_or("Could not resolve %LOCALAPPDATA% for RustCoreWatch preferences.")?;
    let store = preferences::Store::open(Some(dir), None);
    let mut changes = preferences::Changes::default();

    let enabled_list = if let Some(list) = enabled_override {
        Some(list)
    } else if apply_manifest {
        read_installed_modules_manifest()
    } else {
        None
    };

    if let Some(enabled) = enabled_list {
        let disabled: Vec<String> = preferences::INSTALLED_MODULES
            .iter()
            .filter(|&&id| !enabled.iter().any(|e| e.eq_ignore_ascii_case(id)))
            .map(|&id| id.to_owned())
            .collect();
        changes.modules = Some(preferences::Modules { disabled });
    }
    if let Some(flag) = low_memory {
        changes.low_memory_mode = Some(flag);
    }
    if let Some(flag) = startup {
        changes.start_with_windows = Some(flag);
        app_settings::set_startup(flag)?;
    }

    store
        .update(changes, |_| ())
        .map_err(|e| format!("Failed saving install configuration: {e}"))?;
    Ok(())
}

fn attach_parent_console_for_cli() {
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
    const STD_OUTPUT_HANDLE: u32 = (-11i32) as u32;
    const FILE_TYPE_UNKNOWN: u32 = 0;
    unsafe {
        let stdout = GetStdHandle(STD_OUTPUT_HANDLE);
        if stdout.is_null() || GetFileType(stdout) == FILE_TYPE_UNKNOWN {
            let _ = AttachConsole(ATTACH_PARENT_PROCESS);
        }
    }
}

struct SingleInstanceGuard(*mut core::ffi::c_void);

impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}

fn acquire_single_instance(handoff: bool) -> Option<SingleInstanceGuard> {
    const ERROR_ACCESS_DENIED: i32 = 5;
    const ERROR_ALREADY_EXISTS: i32 = 183;
    let name = native::wide("Local\\RustCoreWatch_SingleInstance_v1");
    let attempts = if handoff { 50 } else { 1 };
    for attempt in 0..attempts {
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, name.as_ptr());
            let err = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            if handle.is_null() {
                if err != ERROR_ACCESS_DENIED {
                    return Some(SingleInstanceGuard(std::ptr::null_mut()));
                }
                // Existing instance is running elevated (Admin) — wait if handing off, else focus it.
            } else if err != ERROR_ALREADY_EXISTS {
                return Some(SingleInstanceGuard(handle));
            } else {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
        }
        if handoff && attempt + 1 < attempts {
            thread::sleep(Duration::from_millis(100));
            continue;
        }
        // Another instance is already running — bring its window (even if hidden in tray) to the front.
        focus_existing_window();
        return None;
    }
    None
}

fn configure_webview2_memory_args(smoke_test: bool, force_low_memory: bool) {
    let low_memory = force_low_memory
        || (!smoke_test
            && std::env::var_os("LOCALAPPDATA")
                .map(|root| {
                    std::path::PathBuf::from(root).join("com.corewatch.rust.dashboard")
                })
                .is_some_and(|dir| preferences::read_low_memory_mode(&dir)));

    // Tier 1 (always on, zero UI tradeoff): strip unused Edge features, cap renderer count,
    // disable shader disk cache and background networking/pings.
    let mut flags = String::from(
        "--disable-features=msSmartScreenProtection,msWebOOUI,msEdgeReadingView,Translate,MediaRouter \
         --disable-gpu-shader-disk-cache \
         --renderer-process-limit=1 \
         --disable-background-networking \
         --no-pings",
    );
    // Tier 2 (togglable in Settings -> General -> Low-Memory Mode, or --low-memory CLI flag):
    // disables Chromium's dedicated GPU compositor process, saving ~180-225 MB RAM.
    if low_memory {
        flags.push_str(" --disable-gpu --disable-gpu-compositing");
    }
    let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
    let merged = if existing.trim().is_empty() {
        flags
    } else {
        format!("{existing} {flags}")
    };
    // SAFETY: Called once at the start of `main()` before spawning any worker threads or WebView2.
    unsafe {
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", merged);
    }
}

fn main() {
    let all_args: Vec<String> = std::env::args().skip(1).collect();
    let arg = all_args.first().map(String::as_str);
    let is_cli = matches!(
        arg,
        Some(
            "--snapshot"
                | "--diagnostics"
                | "--sensor-status"
                | "--rgb-probe"
                | "--rgb-test"
                | "--smoke-test"
                | "--configure-install"
        )
    );
    if is_cli {
        attach_parent_console_for_cli();
    }
    if arg == Some("--configure-install") {
        if let Err(error) = run_configure_install(&all_args[1..]) {
            eprintln!("RustCoreWatch configure-install: {error}");
            std::process::exit(1);
        }
        println!("RustCoreWatch install configuration applied.");
        return;
    }
    if arg == Some("--snapshot") {
        print_snapshot();
        return;
    }
    if arg == Some("--diagnostics") {
        let hours = all_args
            .get(1)
            .and_then(|value| value.parse().ok())
            .unwrap_or(24);
        match diagnostics::scan(diagnostics::Options {
            hours,
            warnings: true,
        }) {
            Ok(report) => println!(
                "{}",
                serde_json::to_string_pretty(&report).expect("serialize diagnostics")
            ),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if arg == Some("--sensor-status") {
        println!(
            "{}",
            serde_json::to_string_pretty(&sensors::status(None)).expect("serialize sensor status")
        );
        return;
    }
    if arg == Some("--rgb-probe") {
        println!("{}", rgb_studio::run_cli_probe(None));
        return;
    }
    if arg == Some("--rgb-test") {
        let hex = all_args
            .get(1)
            .cloned()
            .unwrap_or_else(|| "#00b4ff".to_owned());
        println!("{}", rgb_studio::run_cli_probe(Some(&hex)));
        return;
    }
    let smoke_test = all_args.iter().any(|a| a == "--smoke-test");
    let narrow_smoke = smoke_test && all_args.iter().any(|a| a == "--narrow");
    let handoff = all_args
        .iter()
        .any(|a| a == "--elevated" || a == "--relaunch");
    let force_low_memory = all_args.iter().any(|a| a == "--low-memory");
    let _instance_guard = if smoke_test {
        None
    } else {
        match acquire_single_instance(handoff) {
            Some(guard) => Some(guard),
            None => return,
        }
    };
    configure_webview2_memory_args(smoke_test, force_low_memory);
    let state = Arc::new(Dashboard {
        smoke_test,
        ..Default::default()
    });
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            refresh,
            set_telemetry_paused,
            set_window_lock_mode,
            dashboard_preferences,
            save_dashboard_preferences,
            settings_action,
            diagnostics_scan,
            diagnostics_event,
            diagnostics_mark,
            diagnostics_clear,
            diagnostics_code,
            diagnostics_open_dump,
            diagnostics_launch_tool,
            diagnostics_export,
            tasks_snapshot,
            tasks_action,
            disk_map_drives,
            disk_map_scan,
            disk_map_cancel,
            disk_map_clear,
            disk_map_open,
            disk_map_node,
            disk_map_recycle,
            dp_list_disks,
            dp_action,
            startup_list,
            startup_action,
            profiles_state,
            profiles_action,
            rgb_state,
            rgb_action,
            alerts_state,
            alerts_action,
            battery_snapshot,
            battery_action,
            snapshots_list,
            snapshots_capture,
            snapshots_diff,
            snapshots_delete,
            ssh_certs_state,
            ssh_certs_action,
            backup_state,
            backup_action,
            security_audit,
            security_repair_action,
            docker_state,
            docker_action,
            installed_apps_list,
            installed_apps_action,
            update_center_scan,
            update_center_action,
            homelab_list,
            homelab_action,
            wsl_state,
            wsl_action,
            sharing_list,
            sharing_action,
            devices_scan,
            devices_action,
            organizer_state,
            organizer_action,
            app_installer_catalog,
            app_installer_action,
            github_state,
            github_action,
            jira_config,
            jira_action,
            pick_folder,
            snapshots_export,
            import_dashboard_preferences,
            set_dashboard_wallpaper,
            remove_dashboard_wallpaper,
            test_network,
            network_adapters,
            network_tables,
            run_network_diagnostic,
            configure_network_adapter,
            flush_dns_cache,
            check_dns,
            set_dashboard_dns,
            refresh_dashboard_arp,
            set_discovery_sharing,
            cpu_sensor_status,
            external_ipv4,
            apply_dashboard_change,
            display_scale_options,
            java_runtimes,
            powershell_update,
            identify_displays,
            display_modes,
            preview_display,
            confirm_display,
            set_advanced_color,
            elevate,
            relaunch_app,
            open_volume,
            label_volume,
            power_plans,
            set_power_plan,
            finish_dashboard_smoke
        ])
        .register_uri_scheme_protocol(preferences::WALLPAPER_SCHEME, |context, request| {
            if context.webview_label() == "main"
                && let Some(store) = context.app_handle().try_state::<Arc<preferences::Store>>()
            {
                return store.serve_wallpaper(&request);
            }
            tauri::http::Response::builder()
                .status(404)
                .body(Vec::new())
                .unwrap()
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let state = window.state::<Arc<Dashboard>>();
            if let WindowEvent::Moved(pos) = event {
                let skip = window.is_minimized().unwrap_or(false)
                    || window.is_maximized().unwrap_or(false)
                    || !window.is_visible().unwrap_or(true);
                if !skip {
                    let lock = *lock_or_recover(&state.window_lock_mode);
                    if matches!(
                        lock,
                        preferences::WindowLockMode::Position | preferences::WindowLockMode::All
                    ) && let Some(locked) = *lock_or_recover(&state.locked_position)
                        && (pos.x != locked.x || pos.y != locked.y)
                    {
                        let _ = window.set_position(locked);
                    }
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !state.smoke_test
                    && !window.is_minimized().unwrap_or(false)
                    && !window.is_maximized().unwrap_or(false)
                    && let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size())
                    && size.width >= 480
                    && size.height >= 480
                {
                    let mut changes = preferences::Changes::default();
                    changes.window_bounds = Some(preferences::WindowBounds {
                        x: pos.x,
                        y: pos.y,
                        width: size.width,
                        height: size.height,
                    });
                    let _ = window
                        .state::<Arc<preferences::Store>>()
                        .update(changes, |_| ());
                }
                if window.app_handle().tray_by_id("corewatch").is_some()
                    && window
                        .state::<Arc<preferences::Store>>()
                        .state()
                        .settings
                        .general
                        .minimize_to_tray_on_close
                {
                    api.prevent_close();
                    if window.hide().is_ok() {
                        let bg_active = !state.smoke_test
                            && (window
                                .state::<Arc<smart_alerts::AlertsEngine>>()
                                .has_enabled_rules()
                                || window
                                    .state::<Arc<rgb_studio::RgbEngine>>()
                                    .needs_thermal_telemetry());
                        state.minimize(true, bg_active);
                    }
                }
            }
            if matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_)) {
                let bg_active = !state.smoke_test
                    && (window
                        .state::<Arc<smart_alerts::AlertsEngine>>()
                        .has_enabled_rules()
                        || window
                            .state::<Arc<rgb_studio::RgbEngine>>()
                            .needs_thermal_telemetry());
                state.observe_window(window, bg_active);
            }
        })
        .setup(move |app| {
            let (directory, legacy_directory) = if state.smoke_test {
                (None, None)
            } else {
                (
                    Some(app.path().app_local_data_dir()?),
                    Some(app.path().local_data_dir()?.join("CoreWatch")),
                )
            };
            let store = Arc::new(preferences::Store::open(directory, legacy_directory));
            let data_dir = store.directory().map(std::path::Path::to_path_buf);
            let profiles_mgr = Arc::new(profiles::ProfileManager::open(data_dir.as_deref()));
            let rgb_engine = rgb_studio::RgbEngine::open(data_dir.as_deref(), state.smoke_test);
            let alerts_engine = Arc::new(smart_alerts::AlertsEngine::open(data_dir.as_deref()));
            let backup_mgr = Arc::new(backup_sync::BackupManager::open(data_dir.as_deref()));
            let homelab_mgr = Arc::new(homelab::HomelabManager::open(data_dir.as_deref()));
            let organizer_mgr = Arc::new(file_organizer::OrganizerManager::open(data_dir.as_deref()));
            let jira_mgr = Arc::new(jira::JiraManager::open(data_dir.as_deref()));
            state.set_polling_profile(store.polling_profile());
            let initial = store.state().settings;
            *lock_or_recover(&state.window_lock_mode) = initial.window_lock_mode;
            app.manage(store);
            app.manage(profiles_mgr);
            app.manage(rgb_engine.clone());
            app.manage(alerts_engine.clone());
            app.manage(backup_mgr);
            app.manage(homelab_mgr);
            app.manage(organizer_mgr);
            app.manage(jira_mgr);
            let tray_ready = app_settings::tray(app.handle())
                .map_err(|error| eprintln!("CoreWatch tray: {error}"))
                .is_ok();
            if narrow_smoke && let Some(window) = app.get_webview_window("main") {
                window.set_size(tauri::LogicalSize::new(480.0, 720.0))?;
            }
            let start_in_tray =
                !state.smoke_test && !handoff && tray_ready && initial.general.start_minimized;
            if start_in_tray {
                let bg_active =
                    alerts_engine.has_enabled_rules() || rgb_engine.needs_thermal_telemetry();
                state.minimize(true, bg_active);
            }
            if !state.smoke_test {
                state.sensors.start();
            }
            if let Some(window) = app.get_webview_window("main") {
                if !state.smoke_test && !narrow_smoke {
                    if let Some(bounds) = initial.window_bounds {
                        let _ = window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height));
                        let monitors = window.available_monitors().unwrap_or_default();
                        if bounds_visible_on_monitors(bounds, &monitors) {
                            let _ = window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y));
                        }
                    }
                    if matches!(
                        initial.window_lock_mode,
                        preferences::WindowLockMode::Position | preferences::WindowLockMode::All
                    ) && let Ok(pos) = window.outer_position()
                    {
                        *lock_or_recover(&state.locked_position) = Some(pos);
                    }
                    if matches!(initial.window_lock_mode, preferences::WindowLockMode::All) {
                        let _ = window.set_resizable(false);
                    }
                }
                app_settings::set_opacity(&window, initial.opacity)
                    .map_err(std::io::Error::other)?;
                if !start_in_tray {
                    window.show()?;
                }
            }
            start_fast_worker(state.clone());
            start_details_worker(state.clone(), alerts_engine, rgb_engine);
            if state.smoke_test {
                let app = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(60));
                    if !state.rendered.load(Ordering::Acquire) {
                        eprintln!(
                            "Dashboard smoke test timed out before the UI rendered live data."
                        );
                        app.exit(1);
                        std::process::exit(1);
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("launch CoreWatch dashboard")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<Arc<Dashboard>>().sensors.stop();
                app.state::<Arc<rgb_studio::RgbEngine>>().stop();
                app.state::<Arc<profiles::ProfileManager>>()
                    .release_keep_awake_on_exit();
                display_control::cancel_on_exit();
            }
        });
}
