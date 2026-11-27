use crate::{
    dashboard_actions,
    details::{number, rows, text},
    devices::ComApartment,
    native, system_controls,
};
use serde::{Deserialize, Serialize};
use std::{
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
};
use wmi::WMIConnection;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmbShare {
    pub name: String,
    pub unc_path: String,
    pub path: String,
    pub description: String,
    pub share_type: String,
    pub is_special: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharingState {
    pub is_admin: bool,
    pub shares: Vec<SmbShare>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SharingAction {
    Create {
        name: String,
        path: String,
        description: String,
        full_access: bool,
    },
    Remove {
        name: String,
    },
    OpenFolder {
        path: String,
    },
    OpenFsmgmt,
}

pub fn list() -> SharingState {
    let _com = ComApartment::enter();
    let wmi = WMIConnection::new().ok();
    let mut shares = Vec::new();
    let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "localhost".into());
    for row in rows(
        wmi.as_ref(),
        "SELECT Name, Path, Description, Type FROM Win32_Share",
    ) {
        let Some(name) = text(&row, "Name") else {
            continue;
        };
        let code = number(&row, "Type").unwrap_or(0);
        let is_special = name.ends_with('$') || (code & 0x8000_0000) != 0;
        let share_type = match code & 0xFF {
            0 => {
                if is_special {
                    "Admin Disk Share"
                } else {
                    "Folder Share"
                }
            }
            1 => "Print Queue",
            3 => "IPC",
            _ => "System Share",
        }
        .to_owned();
        shares.push(SmbShare {
            unc_path: format!(r"\\{computer}\{name}"),
            name: name.to_owned(),
            path: text(&row, "Path").unwrap_or("").to_owned(),
            description: text(&row, "Description").unwrap_or("").to_owned(),
            share_type,
            is_special,
        });
    }
    shares.sort_by(|a, b| a.is_special.cmp(&b.is_special).then_with(|| a.name.cmp(&b.name)));
    SharingState {
        is_admin: native::elevated(),
        shares,
    }
}

fn valid_share_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.ends_with('$')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
}

pub fn execute(action: SharingAction) -> Result<(SharingState, String), String> {
    match action {
        SharingAction::OpenFolder { path } => {
            let p = Path::new(path.trim());
            if !p.is_dir() {
                return Err("Share folder does not exist.".into());
            }
            dashboard_actions::open_directory(p)?;
            Ok((list(), format!("Opened {}", p.display())))
        }
        SharingAction::OpenFsmgmt => {
            dashboard_actions::shell_open("fsmgmt.msc", None, false)?;
            Ok((list(), "Opened Shared Folders MMC (fsmgmt.msc).".into()))
        }
        SharingAction::Create {
            name,
            path,
            description,
            full_access,
        } => {
            system_controls::require_admin()?;
            let clean_name = name.trim();
            if !valid_share_name(clean_name) {
                return Err("Share name must use letters, digits, spaces, '-' or '_'.".into());
            }
            let p = Path::new(path.trim());
            if !p.is_absolute() || !p.is_dir() {
                return Err("Target share path must be an existing absolute folder.".into());
            }
            let net_exe = crate::network::system_directory()?.join("net.exe");
            let spec = format!("{clean_name}={}", p.to_string_lossy());
            let grant = if full_access {
                "/GRANT:Everyone,FULL"
            } else {
                "/GRANT:Everyone,READ"
            };
            let mut args = vec!["share".to_owned(), spec, grant.to_owned()];
            let desc = description.trim();
            if !desc.is_empty() {
                args.push(format!("/REMARK:{desc}"));
            }
            let out = Command::new(net_exe)
                .args(&args)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Failed invoking net.exe: {e}"))?;
            if out.status.success() {
                Ok((list(), format!("Created SMB share '{clean_name}'.")))
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
            }
        }
        SharingAction::Remove { name } => {
            system_controls::require_admin()?;
            let clean_name = name.trim();
            if clean_name.is_empty() || clean_name.ends_with('$') {
                return Err("Refused: Protected administrative shares ($-shares) cannot be removed.".into());
            }
            let net_exe = crate::network::system_directory()?.join("net.exe");
            let out = Command::new(net_exe)
                .args(["share", clean_name, "/DELETE", "/Y"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Failed invoking net.exe: {e}"))?;
            if out.status.success() {
                Ok((list(), format!("Removed SMB share '{clean_name}'.")))
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
            }
        }
    }
}
