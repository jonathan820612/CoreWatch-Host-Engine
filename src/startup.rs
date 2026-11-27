use crate::{dashboard_actions, native, system_controls};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
};
use winreg::{
    RegKey, RegValue,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_BINARY},
};

const RUN_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_ONCE_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\RunOnce";
const RUN_WOW_PATH: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
const APPROVED_RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const APPROVED_RUN32: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32";
const APPROVED_FOLDER: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupEntry {
    pub id: String,
    pub name: String,
    pub command: String,
    pub scope: String,
    pub source: String,
    pub enabled: bool,
    pub requires_admin: bool,
    pub location: String,
    pub file_exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupList {
    pub entries: Vec<StartupEntry>,
    pub is_admin: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StartupAction {
    Toggle { id: String, enabled: bool },
    Add { name: String, command: String },
    Remove { id: String },
    OpenLocation { id: String },
}

fn read_approved_map(hive: winreg::HKEY, subkey: &str) -> HashMap<String, bool> {
    let mut map = HashMap::new();
    let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(subkey, KEY_READ) else {
        return map;
    };
    for (name, val) in key.enum_values().flatten() {
        if let Some(&first) = val.bytes.first() {
            // Even first byte (0x02, 0x06) = Enabled; odd (0x03, 0x07) = Disabled
            map.insert(name.to_ascii_lowercase(), (first & 1) == 0);
        }
    }
    map
}

struct RegStartupSource {
    hive: winreg::HKEY,
    hive_tag: &'static str,
    subkey: &'static str,
    approved_subkey: &'static str,
    scope: &'static str,
    source: &'static str,
    requires_admin: bool,
}

fn read_registry_entries(src: &RegStartupSource, out: &mut Vec<StartupEntry>) {
    let approved = read_approved_map(src.hive, src.approved_subkey);
    let Ok(key) = RegKey::predef(src.hive).open_subkey_with_flags(src.subkey, KEY_READ) else {
        return;
    };
    for (name, val) in key.enum_values().flatten() {
        let command = String::from_utf8_lossy(&val.bytes)
            .trim_end_matches('\0')
            .to_owned();
        let command = key.get_value::<String, _>(&name).unwrap_or(command);
        let enabled = approved
            .get(&name.to_ascii_lowercase())
            .copied()
            .unwrap_or(true);
        let file_exists = extract_executable_path(&command).is_some_and(|p| p.exists());
        out.push(StartupEntry {
            id: format!(
                "reg|{}|{}|{}|{name}",
                src.hive_tag, src.subkey, src.approved_subkey
            ),
            name,
            command,
            scope: src.scope.into(),
            source: src.source.into(),
            enabled,
            requires_admin: src.requires_admin,
            location: format!("{}\\{}", src.hive_tag, src.subkey),
            file_exists,
        });
    }
}

fn read_folder_entries(
    folder: PathBuf,
    hive: winreg::HKEY,
    hive_tag: &str,
    scope: &str,
    requires_admin: bool,
    out: &mut Vec<StartupEntry>,
) {
    let approved = read_approved_map(hive, APPROVED_FOLDER);
    let Ok(dir) = fs::read_dir(&folder) else {
        return;
    };
    for entry in dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if fname.eq_ignore_ascii_case("desktop.ini") {
            continue;
        }
        let enabled = approved
            .get(&fname.to_ascii_lowercase())
            .copied()
            .unwrap_or(true);
        out.push(StartupEntry {
            id: format!("folder|{hive_tag}|{}|{fname}", folder.to_string_lossy()),
            name: path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(fname)
                .to_owned(),
            command: path.to_string_lossy().into_owned(),
            scope: scope.into(),
            source: "Startup Folder".into(),
            enabled,
            requires_admin,
            location: folder.to_string_lossy().into_owned(),
            file_exists: path.exists(),
        });
    }
}

pub fn list() -> StartupList {
    let mut entries = Vec::new();
    let sources = [
        RegStartupSource {
            hive: HKEY_CURRENT_USER,
            hive_tag: "HKCU",
            subkey: RUN_PATH,
            approved_subkey: APPROVED_RUN,
            scope: "Current User",
            source: "Registry (Run)",
            requires_admin: false,
        },
        RegStartupSource {
            hive: HKEY_CURRENT_USER,
            hive_tag: "HKCU",
            subkey: RUN_ONCE_PATH,
            approved_subkey: APPROVED_RUN,
            scope: "Current User",
            source: "Registry (RunOnce)",
            requires_admin: false,
        },
        RegStartupSource {
            hive: HKEY_LOCAL_MACHINE,
            hive_tag: "HKLM",
            subkey: RUN_PATH,
            approved_subkey: APPROVED_RUN,
            scope: "All Users",
            source: "Registry (Run)",
            requires_admin: true,
        },
        RegStartupSource {
            hive: HKEY_LOCAL_MACHINE,
            hive_tag: "HKLM",
            subkey: RUN_WOW_PATH,
            approved_subkey: APPROVED_RUN32,
            scope: "All Users (32-bit)",
            source: "Registry (WOW6432)",
            requires_admin: true,
        },
    ];
    for src in &sources {
        read_registry_entries(src, &mut entries);
    }

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let user_dir =
            PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup");
        read_folder_entries(
            user_dir,
            HKEY_CURRENT_USER,
            "HKCU",
            "Current User",
            false,
            &mut entries,
        );
    }
    if let Some(progdata) = std::env::var_os("ProgramData") {
        let common_dir =
            PathBuf::from(progdata).join(r"Microsoft\Windows\Start Menu\Programs\Startup");
        read_folder_entries(
            common_dir,
            HKEY_LOCAL_MACHINE,
            "HKLM",
            "All Users",
            true,
            &mut entries,
        );
    }

    entries.sort_by_key(|a| a.name.to_ascii_lowercase());
    StartupList {
        entries,
        is_admin: native::elevated(),
    }
}

fn approved_bytes(enabled: bool) -> [u8; 12] {
    let mut buf = [0u8; 12];
    buf[0] = if enabled { 0x02 } else { 0x03 };
    buf
}

fn parse_hive(tag: &str) -> Result<(winreg::HKEY, bool), String> {
    match tag {
        "HKCU" => Ok((HKEY_CURRENT_USER, false)),
        "HKLM" => Ok((HKEY_LOCAL_MACHINE, true)),
        _ => Err("Unknown registry hive.".into()),
    }
}

fn valid_reg_subkey(subkey: &str) -> bool {
    matches!(subkey, RUN_PATH | RUN_ONCE_PATH | RUN_WOW_PATH)
}

fn valid_approved_subkey(subkey: &str) -> bool {
    matches!(subkey, APPROVED_RUN | APPROVED_RUN32)
}

fn valid_startup_folder(folder: &str, needs_admin: bool) -> bool {
    let expected = if needs_admin {
        std::env::var_os("ProgramData")
            .map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs\Startup"))
    } else {
        std::env::var_os("APPDATA")
            .map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs\Startup"))
    };
    expected.is_some_and(|exp| {
        exp.to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .eq_ignore_ascii_case(folder.trim_end_matches(['\\', '/']))
    })
}

fn valid_single_filename(name: &str) -> bool {
    let mut comps = Path::new(name).components();
    matches!(comps.next(), Some(std::path::Component::Normal(_))) && comps.next().is_none()
}

pub fn execute(action: StartupAction) -> Result<StartupList, String> {
    match action {
        StartupAction::Toggle { id, enabled } => {
            let parts: Vec<&str> = id.splitn(5, '|').collect();
            match parts.as_slice() {
                ["reg", hive_tag, subkey, approved_subkey, name] => {
                    if !valid_reg_subkey(subkey)
                        || !valid_approved_subkey(approved_subkey)
                        || name.trim().is_empty()
                    {
                        return Err("Invalid registry startup entry identifier.".into());
                    }
                    let (hive, needs_admin) = parse_hive(hive_tag)?;
                    if needs_admin {
                        system_controls::require_admin()?;
                    }
                    let (key, _) = RegKey::predef(hive)
                        .create_subkey(approved_subkey)
                        .map_err(|e| format!("Could not open StartupApproved key: {e}"))?;
                    let raw = RegValue {
                        vtype: REG_BINARY,
                        bytes: approved_bytes(enabled).to_vec().into(),
                    };
                    key.set_raw_value(name, &raw)
                        .map_err(|e| format!("Could not update startup state: {e}"))?;
                }
                ["folder", hive_tag, folder, fname] => {
                    let (hive, needs_admin) = parse_hive(hive_tag)?;
                    if !valid_startup_folder(folder, needs_admin) || !valid_single_filename(fname) {
                        return Err("Invalid startup folder entry identifier.".into());
                    }
                    if needs_admin {
                        system_controls::require_admin()?;
                    }
                    let (key, _) = RegKey::predef(hive)
                        .create_subkey(APPROVED_FOLDER)
                        .map_err(|e| format!("Could not open StartupApproved folder key: {e}"))?;
                    let raw = RegValue {
                        vtype: REG_BINARY,
                        bytes: approved_bytes(enabled).to_vec().into(),
                    };
                    key.set_raw_value(fname, &raw)
                        .map_err(|e| format!("Could not update folder startup state: {e}"))?;
                }
                _ => return Err("Invalid startup entry identifier.".into()),
            }
        }
        StartupAction::Add { name, command } => {
            let clean_name = name.trim();
            let clean_cmd = command.trim();
            if clean_name.is_empty() || clean_cmd.is_empty() {
                return Err("Both an entry name and target command/path are required.".into());
            }
            let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(RUN_PATH)
                .map_err(|e| format!("Could not open HKCU Run key: {e}"))?;
            key.set_value(clean_name, &clean_cmd)
                .map_err(|e| format!("Could not write startup entry: {e}"))?;
        }
        StartupAction::Remove { id } => {
            let parts: Vec<&str> = id.splitn(5, '|').collect();
            match parts.as_slice() {
                ["reg", hive_tag, subkey, approved_subkey, name] => {
                    if !valid_reg_subkey(subkey)
                        || !valid_approved_subkey(approved_subkey)
                        || name.trim().is_empty()
                    {
                        return Err("Invalid registry startup entry identifier.".into());
                    }
                    let (hive, needs_admin) = parse_hive(hive_tag)?;
                    if needs_admin {
                        system_controls::require_admin()?;
                    }
                    let key = RegKey::predef(hive)
                        .open_subkey_with_flags(subkey, KEY_SET_VALUE)
                        .map_err(|e| format!("Could not open registry key: {e}"))?;
                    key.delete_value(name)
                        .map_err(|e| format!("Could not remove registry value: {e}"))?;
                    if let Ok(app_key) =
                        RegKey::predef(hive).open_subkey_with_flags(approved_subkey, KEY_SET_VALUE)
                    {
                        let _ = app_key.delete_value(name);
                    }
                }
                ["folder", hive_tag, folder, fname] => {
                    let (_, needs_admin) = parse_hive(hive_tag)?;
                    if !valid_startup_folder(folder, needs_admin) || !valid_single_filename(fname) {
                        return Err("Invalid startup folder entry identifier.".into());
                    }
                    if needs_admin {
                        system_controls::require_admin()?;
                    }
                    let target = Path::new(folder).join(fname);
                    fs::remove_file(&target)
                        .map_err(|e| format!("Could not delete startup file: {e}"))?;
                }
                _ => return Err("Invalid startup entry identifier.".into()),
            }
        }
        StartupAction::OpenLocation { id } => {
            let current = list();
            let entry = current
                .entries
                .iter()
                .find(|e| e.id == id)
                .ok_or("Startup entry was not found.")?;
            let path = extract_executable_path(&entry.command);
            if let Some(p) = path.as_deref().filter(|p| p.exists()) {
                dashboard_actions::reveal_in_explorer(p)?;
            } else if Path::new(&entry.location).is_dir() {
                dashboard_actions::open_directory(Path::new(&entry.location))?;
            } else {
                return Err("Could not locate an existing folder for this startup item.".into());
            }
        }
    }
    Ok(list())
}

fn expand_env_vars(raw: &str) -> String {
    if !raw.contains('%') {
        return raw.to_owned();
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('%') {
            let var = &after[..end];
            if !var.is_empty()
                && let Ok(val) = std::env::var(var)
            {
                out.push_str(&val);
            } else {
                out.push('%');
                out.push_str(var);
                out.push('%');
            }
            rest = &after[end + 1..];
        } else {
            out.push_str(&rest[start..]);
            rest = "";
        }
    }
    out.push_str(rest);
    out
}

fn extract_executable_path(cmd: &str) -> Option<PathBuf> {
    let expanded = expand_env_vars(cmd);
    let trimmed = expanded.trim();
    if let Some(rest) = trimmed.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(PathBuf::from(&rest[..end]));
    }
    if let Some(idx) = trimmed.to_ascii_lowercase().find(".exe") {
        return Some(PathBuf::from(&trimmed[..idx + 4]));
    }
    let token = trimmed.split_whitespace().next()?;
    Some(PathBuf::from(token))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_and_unquoted_startup_commands() {
        assert_eq!(
            extract_executable_path(r#""C:\Program Files\App\tool.exe" --silent"#),
            Some(PathBuf::from(r"C:\Program Files\App\tool.exe"))
        );
        assert_eq!(
            extract_executable_path(r"C:\Tools\agent.exe /min"),
            Some(PathBuf::from(r"C:\Tools\agent.exe"))
        );
        assert_eq!(approved_bytes(true)[0], 0x02);
        assert_eq!(approved_bytes(false)[0], 0x03);
    }
}
