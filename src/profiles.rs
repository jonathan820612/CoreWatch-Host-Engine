use crate::{dashboard_actions, night_light};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    thread,
};
use windows_sys::Win32::System::Power::{
    ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED, SetThreadExecutionState,
};
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

const PROFILES_FILE: &str = "profiles.json";
const NOTIF_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSpec {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub description: String,
    pub builtin: bool,
    pub power_plan: String,
    pub dnd: Option<bool>,
    pub keep_awake: bool,
    pub night_light: Option<bool>,
    pub night_warmth: Option<u8>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub power_plan_id: Option<String>,
    pub night_light: Option<bool>,
    pub night_warmth: Option<u8>,
    pub dnd: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesState {
    pub active_id: String,
    pub keep_awake_active: bool,
    pub has_baseline: bool,
    pub baseline: Option<Baseline>,
    pub profiles: Vec<ProfileSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProfileAction {
    Activate { id: String },
    RevertBaseline,
    SaveCustom { profile: ProfileSpec },
    DeleteCustom { id: String },
    ToggleKeepAwake { enabled: bool },
}

pub fn default_profiles() -> Vec<ProfileSpec> {
    vec![
        ProfileSpec {
            id: "normal".into(),
            name: "Normal".into(),
            icon: "🖥️".into(),
            description: "Balanced Windows power plan, notifications on, default display.".into(),
            builtin: true,
            power_plan: "balanced".into(),
            dnd: Some(false),
            keep_awake: false,
            night_light: Some(false),
            night_warmth: None,
        },
        ProfileSpec {
            id: "work".into(),
            name: "Work / Focus".into(),
            icon: "💼".into(),
            description: "Balanced power, Do Not Disturb enabled, keep screen awake while working."
                .into(),
            builtin: true,
            power_plan: "balanced".into(),
            dnd: Some(true),
            keep_awake: true,
            night_light: None,
            night_warmth: None,
        },
        ProfileSpec {
            id: "gaming".into(),
            name: "Gaming".into(),
            icon: "🎮".into(),
            description: "High/Ultimate Performance power plan, Do Not Disturb on, Night Light off."
                .into(),
            builtin: true,
            power_plan: "high".into(),
            dnd: Some(true),
            keep_awake: true,
            night_light: Some(false),
            night_warmth: None,
        },
        ProfileSpec {
            id: "streaming".into(),
            name: "Streaming / Present".into(),
            icon: "🎥".into(),
            description: "Do Not Disturb on, keep display awake, High Performance power.".into(),
            builtin: true,
            power_plan: "high".into(),
            dnd: Some(true),
            keep_awake: true,
            night_light: Some(false),
            night_warmth: None,
        },
        ProfileSpec {
            id: "night".into(),
            name: "Night".into(),
            icon: "🌙".into(),
            description: "Power Saver / Balanced plan, Night Light at 65% warmth, Do Not Disturb on."
                .into(),
            builtin: true,
            power_plan: "saver".into(),
            dnd: Some(true),
            keep_awake: false,
            night_light: Some(true),
            night_warmth: Some(65),
        },
    ]
}

#[derive(Default)]
struct KeepAwakeControl {
    enabled: bool,
    shutdown: bool,
}

/// Dedicated OS thread so `SetThreadExecutionState` is always set and cleared on
/// the exact same thread (Win32 execution state flags are per-thread).
struct KeepAwakeThread {
    signal: Arc<(Mutex<KeepAwakeControl>, Condvar)>,
    handle: Mutex<Option<thread::JoinHandle<()>>>,
}

impl KeepAwakeThread {
    fn new() -> Self {
        Self {
            signal: Arc::new((Mutex::new(KeepAwakeControl::default()), Condvar::new())),
            handle: Mutex::new(None),
        }
    }

    fn set(&self, enabled: bool) {
        let mut handle_slot = self.handle.lock().unwrap_or_else(|e| e.into_inner());
        if enabled && handle_slot.is_none() {
            let signal = self.signal.clone();
            *handle_slot = Some(thread::spawn(move || {
                let mut current = false;
                let (lock, cv) = &*signal;
                let mut ctrl = lock.lock().unwrap_or_else(|e| e.into_inner());
                loop {
                    if ctrl.shutdown {
                        if current {
                            apply_thread_keep_awake(false);
                        }
                        return;
                    }
                    if ctrl.enabled != current {
                        current = ctrl.enabled;
                        apply_thread_keep_awake(current);
                    }
                    ctrl = cv.wait(ctrl).unwrap_or_else(|e| e.into_inner());
                }
            }));
        }
        {
            let (lock, cv) = &*self.signal;
            let mut ctrl = lock.lock().unwrap_or_else(|e| e.into_inner());
            ctrl.enabled = enabled;
            cv.notify_all();
        }
    }

    fn shutdown(&self) {
        {
            let (lock, cv) = &*self.signal;
            let mut ctrl = lock.lock().unwrap_or_else(|e| e.into_inner());
            ctrl.enabled = false;
            ctrl.shutdown = true;
            cv.notify_all();
        }
        if let Some(handle) = self.handle.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = handle.join();
        }
    }
}

impl Drop for KeepAwakeThread {
    fn drop(&mut self) {
        self.shutdown();
    }
}

pub struct ProfileManager {
    file: Option<PathBuf>,
    state: Mutex<ProfilesState>,
    keep_awake: KeepAwakeThread,
}

impl ProfileManager {
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.map(|d| d.join(PROFILES_FILE));
        let mut state = file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<ProfilesState>(&raw).ok())
            .unwrap_or_else(|| ProfilesState {
                active_id: "normal".into(),
                keep_awake_active: false,
                has_baseline: false,
                baseline: None,
                profiles: default_profiles(),
            });
        // Never claim Keep Awake is active across a cold start before applying it.
        state.keep_awake_active = false;
        // Ensure all built-in presets exist.
        for preset in default_profiles() {
            if !state.profiles.iter().any(|p| p.id == preset.id) {
                state.profiles.push(preset);
            }
        }
        Self {
            file,
            state: Mutex::new(state),
            keep_awake: KeepAwakeThread::new(),
        }
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, ProfilesState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> ProfilesState {
        self.lock_state().clone()
    }

    fn persist(&self, state: &ProfilesState) {
        if let Some(path) = &self.file
            && let Some(parent) = path.parent()
        {
            let _ = fs::create_dir_all(parent);
            if let Ok(json) = serde_json::to_vec_pretty(state) {
                if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(parent)
                    && tmp.write_all(&json).is_ok()
                    && tmp.persist(path).is_ok()
                {
                    return;
                }
                let _ = fs::write(path, json);
            }
        }
    }

    pub fn execute(&self, action: ProfileAction) -> Result<(ProfilesState, String), String> {
        let (snapshot, message) = match action {
            ProfileAction::Activate { id } => {
                let (spec, need_baseline) = {
                    let guard = self.lock_state();
                    let spec = guard
                        .profiles
                        .iter()
                        .find(|p| p.id == id)
                        .cloned()
                        .ok_or("Selected profile was not found.")?;
                    (spec, guard.baseline.is_none() && id != "normal")
                };
                // Run slow OS actions (powercfg, Night Light, registry) OUTSIDE self.state mutex.
                let captured_baseline = need_baseline.then(capture_baseline);
                let mut notes = Vec::new();
                if let Some(note) = apply_power_plan(&spec.power_plan) {
                    notes.push(note);
                }
                if let Some(dnd) = spec.dnd {
                    set_dnd(dnd);
                    notes.push(if dnd { "DnD On" } else { "DnD Off" }.into());
                }
                self.keep_awake.set(spec.keep_awake);
                if let Some(nl) = spec.night_light {
                    let _ = night_light::set_enabled(nl);
                    notes.push(if nl { "Night Light On" } else { "Night Light Off" }.into());
                }
                if let Some(warmth) = spec.night_warmth {
                    let _ = night_light::set_warmth(u32::from(warmth));
                }
                let snap = {
                    let mut guard = self.lock_state();
                    if let Some(base) = captured_baseline
                        && guard.baseline.is_none()
                    {
                        guard.baseline = Some(base);
                        guard.has_baseline = true;
                    }
                    guard.keep_awake_active = spec.keep_awake;
                    guard.active_id = spec.id.clone();
                    guard.clone()
                };
                let msg = if notes.is_empty() {
                    format!("Activated mode: {}.", spec.name)
                } else {
                    format!("Activated {} ({}).", spec.name, notes.join(" · "))
                };
                (snap, msg)
            }
            ProfileAction::RevertBaseline => {
                self.keep_awake.set(false);
                let base = {
                    let mut guard = self.lock_state();
                    guard.keep_awake_active = false;
                    guard.has_baseline = false;
                    guard.active_id = "normal".into();
                    guard.baseline.take()
                };
                if let Some(base) = base {
                    if let Some(plan_id) = base.power_plan_id {
                        let _ = dashboard_actions::set_power_plan(&plan_id);
                    }
                    if let Some(nl) = base.night_light {
                        let _ = night_light::set_enabled(nl);
                    }
                    if let Some(w) = base.night_warmth {
                        let _ = night_light::set_warmth(u32::from(w));
                    }
                    if let Some(dnd) = base.dnd {
                        set_dnd(dnd);
                    }
                }
                (
                    self.snapshot(),
                    "Reverted to captured baseline system settings.".into(),
                )
            }
            ProfileAction::SaveCustom { mut profile } => {
                let clean_name = profile.name.trim().to_owned();
                if clean_name.is_empty() {
                    return Err("Profile name cannot be empty.".into());
                }
                profile.name = clean_name;
                if profile.id.trim().is_empty() {
                    let slug: String = profile
                        .name
                        .to_ascii_lowercase()
                        .chars()
                        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                        .collect();
                    profile.id = format!("custom-{}", slug.trim_matches('-'));
                }
                if profile.icon.trim().is_empty() {
                    profile.icon = "⚡".into();
                }
                profile.builtin = false;
                let mut guard = self.lock_state();
                if let Some(existing) = guard.profiles.iter_mut().find(|p| p.id == profile.id) {
                    if existing.builtin {
                        return Err("Built-in profiles cannot be overwritten.".into());
                    }
                    *existing = profile.clone();
                } else {
                    guard.profiles.push(profile.clone());
                }
                (guard.clone(), format!("Saved custom profile '{}'.", profile.name))
            }
            ProfileAction::DeleteCustom { id } => {
                let mut guard = self.lock_state();
                let idx = guard
                    .profiles
                    .iter()
                    .position(|p| p.id == id)
                    .ok_or("Profile not found.")?;
                if guard.profiles[idx].builtin {
                    return Err("Built-in profiles cannot be deleted.".into());
                }
                let removed = guard.profiles.remove(idx);
                if guard.active_id == id {
                    guard.active_id = "normal".into();
                }
                (guard.clone(), format!("Deleted custom profile '{}'.", removed.name))
            }
            ProfileAction::ToggleKeepAwake { enabled } => {
                self.keep_awake.set(enabled);
                let mut guard = self.lock_state();
                guard.keep_awake_active = enabled;
                let msg = if enabled {
                    "Keep Screen Awake enabled.".into()
                } else {
                    "Keep Screen Awake disabled.".into()
                };
                (guard.clone(), msg)
            }
        };
        self.persist(&snapshot);
        Ok((snapshot, message))
    }

    pub fn release_keep_awake_on_exit(&self) {
        self.keep_awake.shutdown();
    }
}

fn capture_baseline() -> Baseline {
    let power_plan_id = dashboard_actions::power_plans()
        .ok()
        .and_then(|plans| plans.into_iter().find(|p| p.active).map(|p| p.id));
    let night_light = night_light::status();
    let night_warmth = night_light::warmth().map(|w| w.percent.min(100) as u8);
    let dnd = read_dnd();
    Baseline {
        power_plan_id,
        night_light,
        night_warmth,
        dnd,
    }
}

fn apply_power_plan(kind: &str) -> Option<String> {
    let plans = dashboard_actions::power_plans().ok()?;
    let target = match kind.to_ascii_lowercase().as_str() {
        "high" => plans
            .iter()
            .find(|p| {
                let n = p.name.to_ascii_lowercase();
                n.contains("ultimate") || n.contains("high performance") || n.contains("amd ryzen high")
            })
            .or_else(|| plans.first()),
        "saver" => plans
            .iter()
            .find(|p| p.name.to_ascii_lowercase().contains("power saver"))
            .or_else(|| plans.iter().find(|p| p.name.to_ascii_lowercase().contains("balanced"))),
        "keep" => return None,
        _ => plans
            .iter()
            .find(|p| p.name.to_ascii_lowercase().contains("balanced")),
    }?;
    if dashboard_actions::set_power_plan(&target.id).is_ok() {
        Some(target.name.clone())
    } else {
        None
    }
}

fn read_dnd() -> Option<bool> {
    let val: u32 = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(NOTIF_SETTINGS)
        .ok()?
        .get_value("NOC_GLOBAL_SETTING_TOASTS_ENABLED")
        .ok()?;
    Some(val == 0)
}

fn set_dnd(enabled: bool) {
    if let Ok((key, _)) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(NOTIF_SETTINGS) {
        let toasts_enabled: u32 = if enabled { 0 } else { 1 };
        let _ = key.set_value("NOC_GLOBAL_SETTING_TOASTS_ENABLED", &toasts_enabled);
    }
}

fn apply_thread_keep_awake(enabled: bool) {
    unsafe {
        if enabled {
            SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
        } else {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_deletes_custom_profiles_without_touching_builtins() {
        let dir = tempfile::tempdir().unwrap();
        let mgr = ProfileManager::open(Some(dir.path()));
        assert!(mgr.snapshot().profiles.len() >= 5);
        assert!(
            mgr.execute(ProfileAction::DeleteCustom {
                id: "gaming".into()
            })
            .is_err()
        );
        let custom = ProfileSpec {
            id: String::new(),
            name: "Late Coding".into(),
            icon: "💻".into(),
            description: "Quiet coding".into(),
            builtin: false,
            power_plan: "keep".into(),
            dnd: None,
            keep_awake: false,
            night_light: None,
            night_warmth: None,
        };
        let (state, _) = mgr
            .execute(ProfileAction::SaveCustom { profile: custom })
            .unwrap();
        assert!(state.profiles.iter().any(|p| p.id == "custom-late-coding"));
        let (state, _) = mgr
            .execute(ProfileAction::DeleteCustom {
                id: "custom-late-coding".into(),
            })
            .unwrap();
        assert!(!state.profiles.iter().any(|p| p.id == "custom-late-coding"));
    }
}
