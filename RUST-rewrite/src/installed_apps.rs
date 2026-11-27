use crate::dashboard_actions;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    process::Command,
};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub version: String,
    pub publisher: String,
    pub install_date: String,
    pub estimated_size_kb: u64,
    pub install_location: String,
    pub uninstall_string: String,
    pub scope: String,
    pub is_system: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AppAction {
    OpenFolder { path: String },
    Uninstall { id: String },
}

fn infer_folder_from_cmd(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Strip icon resource suffix (",0", ",-101")
    let cleaned = trimmed.split(',').next().unwrap_or(trimmed).trim();
    let candidate = if let Some(rest) = cleaned.strip_prefix('"') {
        rest.split('"').next().unwrap_or("")
    } else if let Some(idx) = cleaned.to_ascii_lowercase().find(".exe") {
        &cleaned[..idx + 4]
    } else {
        cleaned.split_whitespace().next().unwrap_or("")
    };
    let lower = candidate.to_ascii_lowercase();
    if lower.is_empty() || lower.contains("msiexec") || lower.contains("rundll32") {
        return None;
    }
    let p = Path::new(candidate);
    let dir = if p.is_dir() {
        p.to_path_buf()
    } else {
        p.parent().map(Path::to_path_buf)?
    };
    let dir_lower = dir.to_string_lossy().to_ascii_lowercase();
    if dir_lower.ends_with(r"\system32") || dir_lower.ends_with(r"\syswow64") || dir_lower.ends_with(r"\windows") {
        return None;
    }
    dir.is_dir().then(|| dir.to_string_lossy().into_owned())
}

fn classify_system(name: &str, publisher: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let p = publisher.to_ascii_lowercase();
    n.contains("redistributable")
        || n.contains("runtime")
        || n.contains("sdk")
        || n.contains("targeting pack")
        || n.contains("windows desktop")
        || n.contains("update for ")
        || n.contains("driver")
        || n.contains("kb5")
        || (p.contains("microsoft") && (n.contains("visual c++") || n.contains(".net") || n.contains("webview2")))
}

pub fn list() -> Vec<InstalledApp> {
    let sources = [
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "Machine (64-bit)",
        ),
        (
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            "Machine (32-bit)",
        ),
        (
            HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            "Current User",
        ),
    ];

    let mut apps = Vec::new();
    let mut seen = HashSet::new();

    for (hive, path, scope) in sources {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for key_name in root.enum_keys().flatten() {
            let Ok(sub) = root.open_subkey_with_flags(&key_name, KEY_READ) else {
                continue;
            };
            if sub.get_value::<u32, _>("SystemComponent").ok() == Some(1) {
                continue;
            }
            let Ok(name) = sub.get_value::<String, _>("DisplayName") else {
                continue;
            };
            let name = name.trim().to_owned();
            if name.is_empty() {
                continue;
            }
            let version = sub
                .get_value::<String, _>("DisplayVersion")
                .unwrap_or_default()
                .trim()
                .to_owned();
            let dedup_key = format!("{}|{}", name.to_ascii_lowercase(), version);
            if !seen.insert(dedup_key) {
                continue;
            }
            let publisher = sub
                .get_value::<String, _>("Publisher")
                .unwrap_or_default()
                .trim()
                .to_owned();
            let install_date = sub
                .get_value::<String, _>("InstallDate")
                .unwrap_or_default()
                .trim()
                .to_owned();
            let estimated_size_kb = sub
                .get_value::<u32, _>("EstimatedSize")
                .map(u64::from)
                .unwrap_or(0);
            let raw_loc = sub
                .get_value::<String, _>("InstallLocation")
                .unwrap_or_default()
                .trim()
                .trim_matches('"')
                .to_owned();
            let uninstall_string = sub
                .get_value::<String, _>("UninstallString")
                .unwrap_or_default()
                .trim()
                .to_owned();
            let display_icon = sub
                .get_value::<String, _>("DisplayIcon")
                .unwrap_or_default();
            let install_location = if !raw_loc.is_empty() && Path::new(&raw_loc).is_dir() {
                raw_loc
            } else {
                infer_folder_from_cmd(&display_icon)
                    .or_else(|| infer_folder_from_cmd(&uninstall_string))
                    .unwrap_or(raw_loc)
            };
            let is_system = classify_system(&name, &publisher);

            apps.push(InstalledApp {
                id: format!("{scope}|{key_name}"),
                name,
                version,
                publisher,
                install_date,
                estimated_size_kb,
                install_location,
                uninstall_string,
                scope: scope.into(),
                is_system,
            });
        }
    }

    apps.sort_by_key(|a| a.name.to_ascii_lowercase());
    apps
}

pub fn execute(action: AppAction) -> Result<String, String> {
    match action {
        AppAction::OpenFolder { path } => {
            let p = PathBuf::from(path.trim());
            if !p.is_dir() {
                return Err("Install folder does not exist on disk.".into());
            }
            dashboard_actions::open_directory(&p)?;
            Ok(format!("Opened {}", p.display()))
        }
        AppAction::Uninstall { id } => {
            let apps = list();
            let app = apps
                .into_iter()
                .find(|a| a.id == id)
                .ok_or("Installed application entry was not found.")?;
            if app.uninstall_string.is_empty() {
                return Err("This application does not expose an uninstall command.".into());
            }
            // Convert MSI `/I{GUID}` repair/modify strings cleanly to `/X{GUID}` uninstall!
            let cmd = if app.uninstall_string.to_ascii_lowercase().contains("msiexec") {
                app.uninstall_string
                    .replace("/I{", "/X{")
                    .replace("/i{", "/X{")
                    .replace("/I ", "/X ")
                    .replace("/i ", "/X ")
            } else {
                app.uninstall_string.clone()
            };
            Command::new("cmd.exe")
                .args(["/C", "start", "", &cmd])
                .spawn()
                .map_err(|e| format!("Failed launching uninstaller: {e}"))?;
            Ok(format!("Launched uninstaller for '{}'.", app.name))
        }
    }
}
