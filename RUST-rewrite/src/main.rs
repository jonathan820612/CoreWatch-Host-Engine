#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod dashboard_actions;
mod dashboard_runtimes;
mod details;
mod devices;
mod display_control;
mod fast;
mod native;
mod network;
mod network_test;
mod night_light;
mod preferences;
mod sensors;
mod system_controls;

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
}

#[derive(Default, Clone, Copy)]
struct Schedule {
    minimized: bool,
    requested: u64,
    polling_profile: PollingProfile,
}

impl Dashboard {
    fn wake(&self) {
        self.schedule.0.lock().unwrap().requested += 1;
        self.schedule.1.notify_all();
    }

    fn minimize(&self, minimized: bool) {
        let mut state = self.schedule.0.lock().unwrap();
        if state.minimized != minimized {
            self.sensors.pause(minimized);
            state.minimized = minimized;
            state.requested += 1;
            self.schedule.1.notify_all();
        }
    }

    fn observe_window(&self, window: &tauri::Window) {
        if let (Ok(minimized), Ok(visible)) = (window.is_minimized(), window.is_visible()) {
            if visible && !minimized {
                self.window_shown.store(true, Ordering::Release);
            }
            if self.window_shown.load(Ordering::Acquire) {
                self.minimize(minimized);
            }
        }
    }

    fn set_polling_profile(&self, profile: PollingProfile) {
        let mut settings = self.schedule.0.lock().unwrap();
        if settings.polling_profile != profile {
            settings.polling_profile = profile;
            self.schedule.1.notify_all();
        }
    }

    fn wait(&self, next: Instant, handled: Schedule) -> Schedule {
        let (lock, wake) = &self.schedule;
        let mut state = lock.lock().unwrap();
        loop {
            if state.minimized {
                state = wake.wait(state).unwrap();
            } else if state.requested != handled.requested
                || state.polling_profile != handled.polling_profile
                || next <= Instant::now()
            {
                return *state;
            } else {
                let duration = next.saturating_duration_since(Instant::now());
                (state, _) = wake.wait_timeout(state, duration).unwrap();
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
    smoke_test: bool,
}

#[tauri::command]
fn snapshot(state: State<'_, Arc<Dashboard>>, after: u64) -> Snapshot {
    let live = state.fast.lock().unwrap().clone();
    let details = state.details.lock().unwrap();
    let revision = details.as_ref().map_or(0, |entry| entry.0);
    Snapshot {
        live,
        details: details
            .as_ref()
            .filter(|entry| entry.0 != after)
            .map(|entry| entry.1.clone()),
        revision,
        poll_interval_ms: state
            .schedule
            .0
            .lock()
            .unwrap()
            .polling_profile
            .fast_interval()
            .as_millis() as u64,
        smoke_test: state.smoke_test,
    }
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
) -> preferences::State {
    if window.label() == "main" {
        dashboard.observe_window(&window);
    }
    store.state()
}

#[tauri::command]
async fn save_dashboard_preferences(
    dashboard: State<'_, Arc<Dashboard>>,
    store: State<'_, Arc<preferences::Store>>,
    changes: preferences::Changes,
) -> Result<preferences::Settings, String> {
    let store = store.inner().clone();
    let dashboard = dashboard.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .update(changes, |profile| dashboard.set_polling_profile(profile))
            .map_err(|error| error.to_string())
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
    let result = tauri::async_runtime::spawn_blocking(network_test::run).await;
    state.testing_network.store(false, Ordering::Release);
    result.map_err(|error| error.to_string())
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
        } else {
            println!(
                "WebView2 verified dashboard layout, appearance, telemetry preferences, network controls, and Network views."
            );
            app.exit(0);
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
            let mut frame = state
                .fast
                .lock()
                .unwrap()
                .as_deref()
                .cloned()
                .unwrap_or_default();
            let refresh_process = start >= next_process || handled.requested != schedule.requested;
            collector.sample(refresh_process, &mut frame);
            if refresh_process {
                next_process = start + PROCESS_INTERVAL;
            }
            *state.fast.lock().unwrap() = Some(Arc::new(frame));
            handled = schedule;
            next = start + schedule.polling_profile.fast_interval();
        }
    });
}

fn start_details_worker(state: Arc<Dashboard>) {
    thread::spawn(move || {
        let _com = devices::ComApartment::enter();
        let mut collector = details::Collector::new();
        let mut next = Instant::now();
        let mut handled = Schedule::default();
        let mut revision = 0;
        loop {
            let schedule = state.wait(next, handled);
            let start = Instant::now();
            if schedule.requested != handled.requested {
                collector = details::Collector::new();
            }
            let details = collector.sample(state.sensors.latest().as_ref());
            revision += 1;
            *state.details.lock().unwrap() = Some((revision, Arc::new(details)));
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
    thread::sleep(interval);
    collector.sample(true, &mut sample);
    let _com = devices::ComApartment::enter();
    let details = details::Collector::new().sample(None);
    println!(
        "{}",
        serde_json::to_string_pretty(&Snapshot {
            live: Some(Arc::new(sample)),
            details: Some(Arc::new(details)),
            revision: 1,
            poll_interval_ms: interval.as_millis() as u64,
            smoke_test: false,
        })
        .expect("serialize snapshot")
    );
}

fn main() {
    let mut args = std::env::args().skip(1);
    let arg = args.next();
    if arg.as_deref() == Some("--snapshot") {
        print_snapshot();
        return;
    }
    if arg.as_deref() == Some("--sensor-status") {
        println!(
            "{}",
            serde_json::to_string_pretty(&sensors::status(None)).expect("serialize sensor status")
        );
        return;
    }
    let smoke_test = arg.as_deref() == Some("--smoke-test");
    let narrow_smoke = smoke_test && args.next().as_deref() == Some("--narrow");
    let state = Arc::new(Dashboard {
        smoke_test,
        ..Default::default()
    });
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            snapshot,
            refresh,
            dashboard_preferences,
            save_dashboard_preferences,
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
            if window.label() == "main"
                && matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_))
            {
                window.state::<Arc<Dashboard>>().observe_window(window);
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
            state.set_polling_profile(store.polling_profile());
            app.manage(store);
            if narrow_smoke && let Some(window) = app.get_webview_window("main") {
                window.set_size(tauri::LogicalSize::new(480.0, 720.0))?;
            }
            state.sensors.start();
            start_fast_worker(state.clone());
            start_details_worker(state.clone());
            if state.smoke_test {
                let app = app.handle().clone();
                thread::spawn(move || {
                    thread::sleep(Duration::from_secs(35));
                    if !state.rendered.load(Ordering::Acquire) {
                        eprintln!(
                            "Dashboard smoke test timed out before the UI rendered live data."
                        );
                        app.exit(1);
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
                display_control::cancel_on_exit();
            }
        });
}
