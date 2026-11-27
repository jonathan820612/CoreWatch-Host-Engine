use crate::secrets;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const ALERTS_FILE: &str = "alerts.json";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRule {
    pub id: String,
    pub name: String,
    pub metric: String, // cpu_temp | gpu_temp | ram_pct | drive_free_pct | internet_down
    pub threshold: f64,
    pub duration_secs: u64,
    pub cooldown_secs: u64,
    pub enabled: bool,
    pub notify_toast: bool,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvent {
    pub id: u64,
    pub timestamp_ms: u64,
    pub rule_id: String,
    pub rule_name: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertsStore {
    pub rules: Vec<AlertRule>,
    pub history: Vec<AlertEvent>,
    pub unread_count: usize,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AlertAction {
    SaveRule { rule: AlertRule },
    ToggleRule { id: String, enabled: bool },
    DeleteRule { id: String },
    ResetDefaults,
    ClearHistory,
    MarkRead,
    SetMuted { muted: bool },
    TestToast,
}

pub struct LiveTelemetryInput {
    pub cpu_temp: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub ram_pct: Option<f64>,
    pub cpu_load: Option<f64>,
    pub min_drive_free_pct: Option<(String, f64)>,
    pub has_default_route: bool,
}

pub fn default_rules() -> Vec<AlertRule> {
    vec![
        AlertRule {
            id: "cpu-temp-high".into(),
            name: "CPU Overheating (≥ 85 °C)".into(),
            metric: "cpu_temp".into(),
            threshold: 85.0,
            duration_secs: 30,
            cooldown_secs: 300,
            enabled: true,
            notify_toast: true,
            target: None,
        },
        AlertRule {
            id: "gpu-temp-high".into(),
            name: "GPU Overheating (≥ 85 °C)".into(),
            metric: "gpu_temp".into(),
            threshold: 85.0,
            duration_secs: 30,
            cooldown_secs: 300,
            enabled: true,
            notify_toast: true,
            target: None,
        },
        AlertRule {
            id: "drive-space-low".into(),
            name: "Drive Free Space Below 10%".into(),
            metric: "drive_free_pct".into(),
            threshold: 10.0,
            duration_secs: 15,
            cooldown_secs: 1800,
            enabled: true,
            notify_toast: true,
            target: None,
        },
        AlertRule {
            id: "ram-pressure".into(),
            name: "High Memory Pressure (≥ 92%)".into(),
            metric: "ram_pct".into(),
            threshold: 92.0,
            duration_secs: 20,
            cooldown_secs: 300,
            enabled: true,
            notify_toast: true,
            target: None,
        },
        AlertRule {
            id: "network-drop".into(),
            name: "Network / Default Route Lost".into(),
            metric: "internet_down".into(),
            threshold: 1.0,
            duration_secs: 10,
            cooldown_secs: 180,
            enabled: false,
            notify_toast: true,
            target: None,
        },
    ]
}

struct RuntimeTracker {
    breached_since: HashMap<String, Instant>,
    last_fired: HashMap<String, Instant>,
    next_event_id: u64,
}

pub struct AlertsEngine {
    file: Option<PathBuf>,
    store: Mutex<AlertsStore>,
    tracker: Mutex<RuntimeTracker>,
    unread: AtomicUsize,
    has_enabled: AtomicBool,
}

impl AlertsEngine {
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.map(|d| d.join(ALERTS_FILE));
        let store = file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<AlertsStore>(&raw).ok())
            .unwrap_or_else(|| AlertsStore {
                rules: default_rules(),
                history: Vec::new(),
                unread_count: 0,
                muted: false,
            });
        let initial_unread = store.unread_count;
        let initial_enabled = !store.muted && store.rules.iter().any(|r| r.enabled);
        let next_event_id = store.history.iter().map(|e| e.id).max().unwrap_or(0) + 1;
        Self {
            file,
            store: Mutex::new(store),
            tracker: Mutex::new(RuntimeTracker {
                breached_since: HashMap::new(),
                last_fired: HashMap::new(),
                next_event_id,
            }),
            unread: AtomicUsize::new(initial_unread),
            has_enabled: AtomicBool::new(initial_enabled),
        }
    }

    pub fn snapshot(&self) -> AlertsStore {
        self.store.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn unread_count(&self) -> usize {
        self.unread.load(Ordering::Acquire)
    }

    pub fn has_enabled_rules(&self) -> bool {
        self.has_enabled.load(Ordering::Acquire)
    }

    fn persist(&self, store: &AlertsStore) {
        if let Some(path) = &self.file {
            secrets::write_json_atomic(path, store);
        }
    }

    pub fn evaluate(&self, input: &LiveTelemetryInput) -> bool {
        let now = Instant::now();
        let (rules, muted) = {
            let s = self.store.lock().unwrap_or_else(|e| e.into_inner());
            (s.rules.clone(), s.muted)
        };
        if muted {
            return false;
        }
        let mut fired: Vec<(AlertRule, String, String)> = Vec::new();
        {
            let mut tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
            for rule in &rules {
                if !rule.enabled {
                    tracker.breached_since.remove(&rule.id);
                    continue;
                }
                let breach = match rule.metric.as_str() {
                    "cpu_temp" => input
                        .cpu_temp
                        .filter(|&v| v >= rule.threshold)
                        .map(|v| ("critical", format!("CPU reached {v:.0} °C (limit {:.0} °C)", rule.threshold))),
                    "gpu_temp" => input
                        .gpu_temp
                        .filter(|&v| v >= rule.threshold)
                        .map(|v| ("critical", format!("GPU reached {v:.0} °C (limit {:.0} °C)", rule.threshold))),
                    "cpu_load" => input
                        .cpu_load
                        .filter(|&v| v >= rule.threshold)
                        .map(|v| ("warning", format!("CPU load at {v:.0}% (limit {:.0}%)", rule.threshold))),
                    "ram_pct" => input
                        .ram_pct
                        .filter(|&v| v >= rule.threshold)
                        .map(|v| ("warning", format!("RAM usage at {v:.1}% (limit {:.0}%)", rule.threshold))),
                    "drive_free_pct" => input
                        .min_drive_free_pct
                        .as_ref()
                        .filter(|(_, free)| *free <= rule.threshold)
                        .map(|(drive, free)| {
                            (
                                "warning",
                                format!("Drive {drive} has only {free:.1}% free (limit {:.0}%)", rule.threshold),
                            )
                        }),
                    "internet_down" => (!input.has_default_route).then(|| {
                        (
                            "critical",
                            "Default IPv4 network route is unavailable.".to_owned(),
                        )
                    }),
                    _ => None,
                };
                if let Some((severity, msg)) = breach {
                    let since = *tracker.breached_since.entry(rule.id.clone()).or_insert(now);
                    if now.duration_since(since).as_secs() >= rule.duration_secs {
                        let cooled = tracker
                            .last_fired
                            .get(&rule.id)
                            .is_none_or(|&t| now.duration_since(t).as_secs() >= rule.cooldown_secs);
                        if cooled {
                            tracker.last_fired.insert(rule.id.clone(), now);
                            fired.push((rule.clone(), severity.to_owned(), msg));
                        }
                    }
                } else {
                    tracker.breached_since.remove(&rule.id);
                }
            }
        }
        if fired.is_empty() {
            return false;
        }
        let mut toasts = Vec::new();
        let to_persist = {
            let mut store = self.store.lock().unwrap_or_else(|e| e.into_inner());
            let mut tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
            let ts = now_ms();
            for (rule, severity, msg) in fired {
                let id = tracker.next_event_id;
                tracker.next_event_id += 1;
                store.history.insert(
                    0,
                    AlertEvent {
                        id,
                        timestamp_ms: ts,
                        rule_id: rule.id.clone(),
                        rule_name: rule.name.clone(),
                        severity,
                        message: msg.clone(),
                    },
                );
                store.unread_count = store.unread_count.saturating_add(1);
                if rule.notify_toast {
                    toasts.push((rule.name, msg));
                }
            }
            store.history.truncate(120);
            self.unread.store(store.unread_count, Ordering::Release);
            store.clone()
        };
        self.persist(&to_persist);
        for (title, body) in toasts {
            std::thread::spawn(move || {
                send_windows_toast(&title, &body);
            });
        }
        true
    }

    pub fn execute(&self, action: AlertAction) -> Result<(AlertsStore, String), String> {
        let (snapshot, message) = {
            let mut store = self.store.lock().unwrap_or_else(|e| e.into_inner());
            let message = match action {
                AlertAction::SaveRule { mut rule } => {
                    let name = rule.name.trim().to_owned();
                    if name.is_empty() {
                        return Err("Rule name is required.".into());
                    }
                    rule.name = name;
                    if rule.id.trim().is_empty() {
                        rule.id = format!("rule-{}", now_ms());
                    }
                    rule.cooldown_secs = rule.cooldown_secs.max(15);
                    if let Some(existing) = store.rules.iter_mut().find(|r| r.id == rule.id) {
                        *existing = rule.clone();
                    } else {
                        store.rules.push(rule.clone());
                    }
                    format!("Saved alert rule '{}'.", rule.name)
                }
                AlertAction::ToggleRule { id, enabled } => {
                    let rule = store
                        .rules
                        .iter_mut()
                        .find(|r| r.id == id)
                        .ok_or("Rule not found.")?;
                    rule.enabled = enabled;
                    format!(
                        "{} rule '{}'.",
                        if enabled { "Enabled" } else { "Paused" },
                        rule.name
                    )
                }
                AlertAction::DeleteRule { id } => {
                    let before = store.rules.len();
                    store.rules.retain(|r| r.id != id);
                    if store.rules.len() == before {
                        return Err("Rule not found.".into());
                    }
                    let mut tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
                    tracker.breached_since.remove(&id);
                    tracker.last_fired.remove(&id);
                    "Deleted alert rule.".into()
                }
                AlertAction::ResetDefaults => {
                    store.rules = default_rules();
                    let mut tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
                    tracker.breached_since.clear();
                    tracker.last_fired.clear();
                    "Restored default watchdog rules.".into()
                }
                AlertAction::ClearHistory => {
                    store.history.clear();
                    store.unread_count = 0;
                    "Cleared alert history.".into()
                }
                AlertAction::MarkRead => {
                    store.unread_count = 0;
                    "Marked alerts as read.".into()
                }
                AlertAction::SetMuted { muted } => {
                    store.muted = muted;
                    if muted {
                        "Smart Alerts globally muted.".into()
                    } else {
                        "Smart Alerts resumed.".into()
                    }
                }
                AlertAction::TestToast => {
                    let mut tracker = self.tracker.lock().unwrap_or_else(|e| e.into_inner());
                    let id = tracker.next_event_id;
                    tracker.next_event_id += 1;
                    store.history.insert(
                        0,
                        AlertEvent {
                            id,
                            timestamp_ms: now_ms(),
                            rule_id: "test".into(),
                            rule_name: "CoreWatch Test Alert".into(),
                            severity: "info".into(),
                            message: "Smart Alerts & Watchdog pipeline is active.".into(),
                        },
                    );
                    store.history.truncate(120);
                    std::thread::spawn(|| {
                        send_windows_toast(
                            "RustCoreWatch Alert Test",
                            "Smart Alerts & Watchdog notifications are working.",
                        );
                    });
                    "Sent Windows test notification.".into()
                }
            };
            self.unread.store(store.unread_count, Ordering::Release);
            self.has_enabled.store(
                !store.muted && store.rules.iter().any(|r| r.enabled),
                Ordering::Release,
            );
            (store.clone(), message)
        };
        self.persist(&snapshot);
        Ok((snapshot, message))
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn send_windows_toast(title: &str, body: &str) {
    let Ok(sysdir) = crate::network::system_directory() else {
        return;
    };
    let ps = sysdir.join(r"WindowsPowerShell\v1.0\powershell.exe");
    let t = escape_xml(title).replace('\'', "''");
    let b = escape_xml(body).replace('\'', "''");
    let script = format!(
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; \
         [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null; \
         $xml = New-Object Windows.Data.Xml.Dom.XmlDocument; \
         $xml.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>{t}</text><text>{b}</text></binding></visual></toast>'); \
         $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); \
         [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('com.corewatch.rust.dashboard').Show($toast)"
    );
    let _ = Command::new(ps)
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_and_records_rule_triggers() {
        let dir = tempfile::tempdir().unwrap();
        let engine = AlertsEngine::open(Some(dir.path()));
        engine
            .execute(AlertAction::SaveRule {
                rule: AlertRule {
                    id: "instant-ram".into(),
                    name: "Instant RAM".into(),
                    metric: "ram_pct".into(),
                    threshold: 80.0,
                    duration_secs: 0,
                    cooldown_secs: 60,
                    enabled: true,
                    notify_toast: false,
                    target: None,
                },
            })
            .unwrap();
        engine.evaluate(&LiveTelemetryInput {
            cpu_temp: Some(50.0),
            gpu_temp: Some(45.0),
            ram_pct: Some(90.0),
            cpu_load: Some(20.0),
            min_drive_free_pct: Some(("C:".into(), 45.0)),
            has_default_route: true,
        });
        let snap = engine.snapshot();
        assert_eq!(snap.unread_count, 1);
        assert_eq!(snap.history[0].rule_id, "instant-ram");
    }
}
