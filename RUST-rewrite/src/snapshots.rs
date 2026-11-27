use crate::{devices_tree, secrets, startup, system_controls, tasks};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub id: String,
    pub label: String,
    pub created_ms: u64,
    pub apps: BTreeMap<String, String>,
    pub startup: BTreeMap<String, String>,
    pub services: BTreeMap<String, String>,
    pub hosts: Vec<String>,
    pub network: BTreeMap<String, String>,
    #[serde(default)]
    pub drivers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub id: String,
    pub label: String,
    pub created_ms: u64,
    pub app_count: usize,
    pub startup_count: usize,
    pub service_count: usize,
    pub hosts_count: usize,
    pub driver_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub key: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryDiff {
    pub added: Vec<DiffEntry>,
    pub removed: Vec<DiffEntry>,
    pub changed: Vec<DiffEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDiff {
    pub before_label: String,
    pub after_label: String,
    pub apps: CategoryDiff,
    pub startup: CategoryDiff,
    pub services: CategoryDiff,
    pub hosts: CategoryDiff,
    pub network: CategoryDiff,
    pub drivers: CategoryDiff,
    pub total_changes: usize,
}

fn snapshots_dir(base: Option<&Path>) -> PathBuf {
    let root = base
        .map(Path::to_path_buf)
        .unwrap_or_else(|| std::env::temp_dir().join("CoreWatch-Rust"));
    root.join("snapshots")
}

fn collect_installed_apps_map() -> BTreeMap<String, String> {
    let mut apps = BTreeMap::new();
    let targets = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];
    for (hive, path) in targets {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for sub in root.enum_keys().flatten() {
            let Ok(item) = root.open_subkey_with_flags(&sub, KEY_READ) else {
                continue;
            };
            let Ok(name) = item.get_value::<String, _>("DisplayName") else {
                continue;
            };
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            let version = item
                .get_value::<String, _>("DisplayVersion")
                .unwrap_or_else(|_| "unknown".into());
            apps.insert(name.to_owned(), version);
        }
    }
    apps
}

fn collect_services_map() -> BTreeMap<String, String> {
    // Capture both live running state AND startup mode via fast native SCM!
    if let Ok(rows) = tasks::enum_services_native() {
        return rows
            .into_iter()
            .map(|s| (s.name, format!("{} | {}", s.state, s.start_mode)))
            .collect();
    }
    BTreeMap::new()
}

fn collect_drivers_map() -> BTreeMap<String, String> {
    devices_tree::scan()
        .devices
        .into_iter()
        .map(|d| (d.name, format!("{} ({})", d.driver_version, d.driver_date)))
        .collect()
}

fn collect_hosts() -> Vec<String> {
    let Ok(sysdir) = crate::network::system_directory() else {
        return Vec::new();
    };
    let path = sysdir.join(r"drivers\etc\hosts");
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_owned)
        .collect()
}

fn collect_network_map() -> BTreeMap<String, String> {
    let mut net = BTreeMap::new();
    let mut cfgs = crate::native::all_network_configs();
    for nic in crate::native::adapters().unwrap_or_default() {
        let cfg = cfgs.remove(&nic.index);
        let summary = match cfg {
            Some(c) => format!(
                "{} | {} | DNS: {}",
                if nic.online { "Up" } else { "Down" },
                c.ipv4
                    .map(|ip| ip.to_string())
                    .unwrap_or_else(|| "No IPv4".into()),
                if c.dns.is_empty() {
                    "Auto".into()
                } else {
                    c.dns
                        .iter()
                        .map(|ip| ip.to_string())
                        .collect::<Vec<_>>()
                        .join(", ")
                }
            ),
            None => if nic.online { "Up" } else { "Down" }.into(),
        };
        net.insert(nic.name, summary);
    }
    net
}

pub fn capture_live(label: String) -> SystemSnapshot {
    let created_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let (apps, startup_map, services, hosts, network, drivers) = std::thread::scope(|s| {
        let h_apps = s.spawn(collect_installed_apps_map);
        let h_start = s.spawn(|| {
            startup::list()
                .entries
                .into_iter()
                .map(|e| {
                    (
                        format!("{} ({})", e.name, e.scope),
                        format!("{} | {}", if e.enabled { "Enabled" } else { "Disabled" }, e.command),
                    )
                })
                .collect::<BTreeMap<_, _>>()
        });
        let h_svc = s.spawn(collect_services_map);
        let h_hosts = s.spawn(collect_hosts);
        let h_net = s.spawn(collect_network_map);
        let h_drv = s.spawn(collect_drivers_map);
        (
            h_apps.join().unwrap_or_default(),
            h_start.join().unwrap_or_default(),
            h_svc.join().unwrap_or_default(),
            h_hosts.join().unwrap_or_default(),
            h_net.join().unwrap_or_default(),
            h_drv.join().unwrap_or_default(),
        )
    });
    SystemSnapshot {
        id: format!("snap-{created_ms}"),
        label: if label.trim().is_empty() {
            format!("Snapshot {created_ms}")
        } else {
            label.trim().to_owned()
        },
        created_ms,
        apps,
        startup: startup_map,
        services,
        hosts,
        network,
        drivers,
    }
}

pub fn save_snapshot(
    base: Option<&Path>,
    label: String,
    create_restore_point: bool,
) -> Result<(SnapshotSummary, String), String> {
    let mut note = String::new();
    if create_restore_point {
        system_controls::require_admin()?;
        let ps = crate::network::system_directory()?
            .join(r"WindowsPowerShell\v1.0\powershell.exe");
        let clean = label
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
            .take(48)
            .collect::<String>();
        let desc = if clean.trim().is_empty() {
            "CoreWatch Snapshot".into()
        } else {
            format!("CoreWatch: {clean}")
        };
        let out = Command::new(ps)
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &format!("Checkpoint-Computer -Description '{desc}' -RestorePointType MODIFY_SETTINGS -ErrorAction Stop"),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Restore point failed: {e}"))?;
        if out.status.success() {
            note = " + Windows Restore Point created".into();
        } else {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_owned();
            note = format!(" (Restore Point skipped: {err})");
        }
    }
    let snap = capture_live(label);
    let dir = snapshots_dir(base);
    let file = dir.join(format!("{}.json", snap.id));
    secrets::write_json_atomic(&file, &snap);
    let summary = summarize(&snap);
    Ok((summary, format!("Captured snapshot '{}'{note}.", snap.label)))
}

fn summarize(s: &SystemSnapshot) -> SnapshotSummary {
    SnapshotSummary {
        id: s.id.clone(),
        label: s.label.clone(),
        created_ms: s.created_ms,
        app_count: s.apps.len(),
        startup_count: s.startup.len(),
        service_count: s.services.len(),
        hosts_count: s.hosts.len(),
        driver_count: s.drivers.len(),
    }
}

pub fn list_snapshots(base: Option<&Path>) -> Vec<SnapshotSummary> {
    let dir = snapshots_dir(base);
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&path)
            && let Ok(snap) = serde_json::from_str::<SystemSnapshot>(&raw)
        {
            out.push(summarize(&snap));
        }
    }
    out.sort_by_key(|a| std::cmp::Reverse(a.created_ms));
    out
}

pub fn load_snapshot(base: Option<&Path>, id: &str) -> Result<SystemSnapshot, String> {
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Invalid snapshot identifier.".into());
    }
    let file = snapshots_dir(base).join(format!("{id}.json"));
    let raw = fs::read_to_string(&file).map_err(|_| "Snapshot not found.".to_owned())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn delete_snapshot(base: Option<&Path>, id: &str) -> Result<(), String> {
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err("Invalid snapshot identifier.".into());
    }
    let file = snapshots_dir(base).join(format!("{id}.json"));
    fs::remove_file(&file).map_err(|e| e.to_string())
}

fn diff_maps(before: &BTreeMap<String, String>, after: &BTreeMap<String, String>) -> CategoryDiff {
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut changed = Vec::new();
    for (k, v_after) in after {
        match before.get(k) {
            None => added.push(DiffEntry {
                key: k.clone(),
                before: None,
                after: Some(v_after.clone()),
            }),
            Some(v_before) if v_before != v_after => changed.push(DiffEntry {
                key: k.clone(),
                before: Some(v_before.clone()),
                after: Some(v_after.clone()),
            }),
            _ => {}
        }
    }
    for (k, v_before) in before {
        if !after.contains_key(k) {
            removed.push(DiffEntry {
                key: k.clone(),
                before: Some(v_before.clone()),
                after: None,
            });
        }
    }
    CategoryDiff {
        added,
        removed,
        changed,
    }
}

fn diff_sets(before: &[String], after: &[String]) -> CategoryDiff {
    let b: BTreeSet<&String> = before.iter().collect();
    let a: BTreeSet<&String> = after.iter().collect();
    let added = a
        .difference(&b)
        .map(|s| DiffEntry {
            key: (*s).clone(),
            before: None,
            after: Some("Present".into()),
        })
        .collect();
    let removed = b
        .difference(&a)
        .map(|s| DiffEntry {
            key: (*s).clone(),
            before: Some("Present".into()),
            after: None,
        })
        .collect();
    CategoryDiff {
        added,
        removed,
        changed: Vec::new(),
    }
}

pub fn diff(before: &SystemSnapshot, after: &SystemSnapshot) -> SnapshotDiff {
    let apps = diff_maps(&before.apps, &after.apps);
    let startup = diff_maps(&before.startup, &after.startup);
    let services = diff_maps(&before.services, &after.services);
    let hosts = diff_sets(&before.hosts, &after.hosts);
    let network = diff_maps(&before.network, &after.network);
    let drivers = diff_maps(&before.drivers, &after.drivers);
    let count = |c: &CategoryDiff| c.added.len() + c.removed.len() + c.changed.len();
    let total_changes = count(&apps)
        + count(&startup)
        + count(&services)
        + count(&hosts)
        + count(&network)
        + count(&drivers);
    SnapshotDiff {
        before_label: before.label.clone(),
        after_label: after.label.clone(),
        apps,
        startup,
        services,
        hosts,
        network,
        drivers,
        total_changes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diffs_added_removed_and_changed_entries() {
        let mut a_apps = BTreeMap::new();
        a_apps.insert("AppA".into(), "1.0".into());
        a_apps.insert("AppB".into(), "2.0".into());
        let mut b_apps = BTreeMap::new();
        b_apps.insert("AppB".into(), "2.1".into());
        b_apps.insert("AppC".into(), "1.0".into());
        let s1 = SystemSnapshot {
            id: "1".into(),
            label: "Before".into(),
            created_ms: 1,
            apps: a_apps,
            startup: BTreeMap::new(),
            services: BTreeMap::new(),
            hosts: vec!["127.0.0.1 local".into()],
            network: BTreeMap::new(),
            drivers: BTreeMap::from([("GPU".into(), "555.0".into())]),
        };
        let s2 = SystemSnapshot {
            id: "2".into(),
            label: "After".into(),
            created_ms: 2,
            apps: b_apps,
            startup: BTreeMap::new(),
            services: BTreeMap::new(),
            hosts: vec!["127.0.0.1 local".into(), "10.0.0.2 nas".into()],
            network: BTreeMap::new(),
            drivers: BTreeMap::from([("GPU".into(), "560.0".into())]),
        };
        let d = diff(&s1, &s2);
        assert_eq!(d.apps.added.len(), 1);
        assert_eq!(d.apps.removed.len(), 1);
        assert_eq!(d.apps.changed.len(), 1);
        assert_eq!(d.hosts.added.len(), 1);
        assert_eq!(d.drivers.changed.len(), 1);
        assert_eq!(d.total_changes, 5);
    }
}
