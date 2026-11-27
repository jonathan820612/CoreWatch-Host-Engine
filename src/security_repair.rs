use crate::{native, system_controls};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PostureCheck {
    pub id: String,
    pub label: String,
    pub status: String, // ok | warn | crit | neutral
    pub value: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEntryAudit {
    pub path: String,
    pub exists: bool,
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPosture {
    pub is_admin: bool,
    pub checks: Vec<PostureCheck>,
    pub hosts_entries: Vec<String>,
    pub proxy_enabled: bool,
    pub proxy_server: String,
    pub path_entries: Vec<String>,
    pub path_audit: Vec<PathEntryAudit>,
    pub temp_bloat_bytes: u64,
    pub temp_file_count: usize,
    pub score: u8,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RepairAction {
    FlushDns,
    ResetWinsock,
    ResetIpStack,
    SfcVerify,
    SfcScannow,
    DismCheckHealth,
    DismRestoreHealth,
    SafeTempCleanup,
    OpenDefender,
    OpenHostsFolder,
    OpenHostsNotepad,
}

pub fn audit() -> SecurityPosture {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut checks = Vec::new();

    // Secure Boot
    let sb = hklm
        .open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Control\SecureBoot\State", KEY_READ)
        .and_then(|k| k.get_value::<u32, _>("UEFISecureBootEnabled"))
        .ok();
    checks.push(PostureCheck {
        id: "secure-boot".into(),
        label: "UEFI Secure Boot".into(),
        status: match sb {
            Some(1) => "ok",
            Some(0) => "warn",
            _ => "neutral",
        }
        .into(),
        value: match sb {
            Some(1) => "Enabled",
            Some(0) => "Disabled",
            _ => "Unknown",
        }
        .into(),
        detail: "Protects boot chain from unsigned bootloaders.".into(),
    });

    // TPM 2.0 readiness
    let tpm_present = hklm
        .open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Services\TPM\WMI", KEY_READ)
        .is_ok();
    let tpm_spec: Option<String> = hklm
        .open_subkey_with_flags(r"SYSTEM\CurrentControlSet\Services\TPM\WMI", KEY_READ)
        .and_then(|k| k.get_value("SpecVersion"))
        .ok();
    checks.push(PostureCheck {
        id: "tpm".into(),
        label: "TPM Security Module".into(),
        status: if tpm_present { "ok" } else { "warn" }.into(),
        value: tpm_spec
            .as_deref()
            .map(|s| format!("Ready ({})", s.split(',').next().unwrap_or(s).trim()))
            .unwrap_or_else(|| if tpm_present { "Present".into() } else { "Not Detected".into() }),
        detail: "Hardware root of trust for BitLocker, Windows Hello, and Windows 11.".into(),
    });

    // Core Isolation / HVCI
    let hvci = hklm
        .open_subkey_with_flags(
            r"SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity",
            KEY_READ,
        )
        .and_then(|k| k.get_value::<u32, _>("Enabled"))
        .ok();
    checks.push(PostureCheck {
        id: "hvci".into(),
        label: "Memory Integrity (HVCI)".into(),
        status: match hvci {
            Some(1) => "ok",
            Some(0) => "warn",
            _ => "neutral",
        }
        .into(),
        value: match hvci {
            Some(1) => "Enabled",
            Some(0) => "Off",
            _ => "Not Configured",
        }
        .into(),
        detail: "Hypervisor-protected Code Integrity.".into(),
    });

    // Remote Desktop (RDP) + NLA + Port
    let ts_key = hklm.open_subkey_with_flags(
        r"SYSTEM\CurrentControlSet\Control\Terminal Server",
        KEY_READ,
    );
    let rdp_denied = ts_key
        .ok()
        .and_then(|k| k.get_value::<u32, _>("fDenyTSConnections").ok());
    let rdp_tcp = hklm.open_subkey_with_flags(
        r"SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp",
        KEY_READ,
    );
    let rdp_port = rdp_tcp
        .as_ref()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("PortNumber").ok())
        .unwrap_or(3389);
    let rdp_nla = rdp_tcp
        .ok()
        .and_then(|k| k.get_value::<u32, _>("UserAuthentication").ok())
        .unwrap_or(1)
        != 0;
    checks.push(PostureCheck {
        id: "rdp".into(),
        label: "Remote Desktop (RDP)".into(),
        status: match rdp_denied {
            Some(1) => "ok",
            Some(0) if rdp_nla => "warn",
            Some(0) => "crit",
            _ => "neutral",
        }
        .into(),
        value: match rdp_denied {
            Some(1) => "Disabled".into(),
            Some(0) => format!("Port {rdp_port} · {}", if rdp_nla { "NLA On" } else { "NLA Off!" }),
            _ => "Unknown".into(),
        },
        detail: "Remote Desktop exposure and Network Level Authentication.".into(),
    });

    // UAC
    let uac = hklm
        .open_subkey_with_flags(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System",
            KEY_READ,
        )
        .and_then(|k| k.get_value::<u32, _>("EnableLUA"))
        .ok();
    checks.push(PostureCheck {
        id: "uac".into(),
        label: "User Account Control (UAC)".into(),
        status: match uac {
            Some(1) => "ok",
            Some(0) => "crit",
            _ => "neutral",
        }
        .into(),
        value: match uac {
            Some(1) => "Enabled",
            Some(0) => "Disabled",
            _ => "Unknown",
        }
        .into(),
        detail: "Prompts before administrative changes.".into(),
    });

    // SMBv1 check
    let smbv1 = hklm
        .open_subkey_with_flags(
            r"SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters",
            KEY_READ,
        )
        .and_then(|k| k.get_value::<u32, _>("SMB1"))
        .ok();
    checks.push(PostureCheck {
        id: "smbv1".into(),
        label: "Legacy SMBv1 Protocol".into(),
        status: if smbv1 == Some(1) { "crit" } else { "ok" }.into(),
        value: if smbv1 == Some(1) {
            "Enabled (Risk)"
        } else {
            "Disabled / Safe"
        }
        .into(),
        detail: "Legacy SMBv1 should remain disabled.".into(),
    });

    // BitLocker quick check
    let bitlocker = check_bitlocker_c();
    checks.push(PostureCheck {
        id: "bitlocker".into(),
        label: "BitLocker (C: Drive)".into(),
        status: if bitlocker.contains("Protection On") {
            "ok"
        } else if bitlocker.contains("Admin") {
            "neutral"
        } else {
            "warn"
        }
        .into(),
        value: bitlocker,
        detail: "Full-volume drive encryption state on OS volume.".into(),
    });

    // Temp bloat quick scan (top 2 levels, bounded fast)
    let (temp_bloat_bytes, temp_file_count) = measure_temp_bloat();
    let temp_mb = temp_bloat_bytes as f64 / (1024.0 * 1024.0);
    checks.push(PostureCheck {
        id: "temp-bloat".into(),
        label: "Temp Folder Footprint".into(),
        status: if temp_mb >= 2048.0 {
            "warn"
        } else {
            "ok"
        }
        .into(),
        value: format!("{temp_mb:.0} MiB ({temp_file_count} files)"),
        detail: "User %TEMP% temporary file cache size.".into(),
    });

    // Hosts entries
    let hosts_entries = crate::network::system_directory()
        .ok()
        .and_then(|d| fs::read_to_string(d.join(r"drivers\etc\hosts")).ok())
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_owned)
        .collect();

    // Proxy
    let inet = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        KEY_READ,
    );
    let proxy_enabled = inet
        .as_ref()
        .ok()
        .and_then(|k| k.get_value::<u32, _>("ProxyEnable").ok())
        .is_some_and(|v| v != 0);
    let proxy_server = inet
        .ok()
        .and_then(|k| k.get_value::<String, _>("ProxyServer").ok())
        .unwrap_or_default();

    let path_entries: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(';')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    let mut seen_paths = HashSet::new();
    let path_audit: Vec<PathEntryAudit> = path_entries
        .iter()
        .map(|entry| {
            let key = entry.trim_end_matches('\\').to_ascii_lowercase();
            let duplicate = !seen_paths.insert(key);
            let exists = Path::new(entry).is_dir();
            PathEntryAudit {
                path: entry.clone(),
                exists,
                duplicate,
            }
        })
        .collect();

    let mut score = 100i32;
    for c in &checks {
        match c.status.as_str() {
            "crit" => score -= 22,
            "warn" => score -= 8,
            _ => {}
        }
    }

    SecurityPosture {
        is_admin: native::elevated(),
        checks,
        hosts_entries,
        proxy_enabled,
        proxy_server,
        path_entries,
        path_audit,
        temp_bloat_bytes,
        temp_file_count,
        score: score.clamp(0, 100) as u8,
    }
}

fn measure_temp_bloat() -> (u64, usize) {
    let mut roots = Vec::new();
    if let Some(user_temp) = std::env::var_os("TEMP").map(PathBuf::from) {
        roots.push(user_temp);
    }
    let mut total_bytes = 0u64;
    let mut total_files = 0usize;
    for root in roots {
        let mut stack = vec![(root, 0usize)];
        while let Some((dir, depth)) = stack.pop() {
            if depth > 4 || total_files > 25_000 {
                break;
            }
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(meta) = entry.metadata() else {
                    continue;
                };
                if meta.is_file() {
                    total_bytes = total_bytes.saturating_add(meta.len());
                    total_files += 1;
                } else if meta.is_dir() && !meta.file_type().is_symlink() {
                    stack.push((entry.path(), depth + 1));
                }
            }
        }
    }
    (total_bytes, total_files)
}

fn safe_temp_cleanup() -> Result<String, String> {
    let temp_dir = std::env::var_os("TEMP")
        .map(PathBuf::from)
        .ok_or("User %TEMP% directory is unavailable.")?;
    if !temp_dir.is_dir() {
        return Err("User %TEMP% directory does not exist.".into());
    }
    let mut freed = 0u64;
    let mut removed = 0usize;
    let mut skipped = 0usize;
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_file() {
                let sz = meta.len();
                if fs::remove_file(&path).is_ok() {
                    freed = freed.saturating_add(sz);
                    removed += 1;
                } else {
                    skipped += 1;
                }
            } else if meta.is_dir() {
                if fs::remove_dir_all(&path).is_ok() {
                    removed += 1;
                } else {
                    skipped += 1;
                }
            }
        }
    }
    let freed_mb = freed as f64 / (1024.0 * 1024.0);
    Ok(format!(
        "Cleaned user %TEMP%: removed {removed} item(s), freed {freed_mb:.1} MiB ({skipped} in-use item(s) safely skipped)."
    ))
}

fn check_bitlocker_c() -> String {
    if !native::elevated() {
        return "Requires Admin".into();
    }
    let Ok(sysdir) = crate::network::system_directory() else {
        return "Unavailable".into();
    };
    let Ok(out) = Command::new(sysdir.join("manage-bde.exe"))
        .args(["-status", "C:"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return "Unavailable".into();
    };
    let txt = String::from_utf8_lossy(&out.stdout);
    if txt.contains("Protection On") {
        "Protection On".into()
    } else if txt.contains("Protection Off") {
        "Protection Off".into()
    } else {
        "Not Encrypted".into()
    }
}

pub fn run_repair(action: RepairAction) -> Result<String, String> {
    let sysdir = crate::network::system_directory()?;
    match action {
        RepairAction::FlushDns => crate::network::flush_dns(),
        RepairAction::ResetWinsock => {
            system_controls::require_admin()?;
            let out = Command::new(sysdir.join("netsh.exe"))
                .args(["winsock", "reset"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }
        RepairAction::ResetIpStack => {
            system_controls::require_admin()?;
            let out = Command::new(sysdir.join("netsh.exe"))
                .args(["int", "ip", "reset"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }
        RepairAction::SfcVerify => {
            system_controls::require_admin()?;
            let out = Command::new(sysdir.join("sfc.exe"))
                .arg("/verifyonly")
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(decode_sfc_output(&out.stdout))
        }
        RepairAction::SfcScannow => {
            system_controls::require_admin()?;
            let out = Command::new(sysdir.join("sfc.exe"))
                .arg("/scannow")
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(decode_sfc_output(&out.stdout))
        }
        RepairAction::DismCheckHealth => {
            system_controls::require_admin()?;
            let out = Command::new(sysdir.join("DISM.exe"))
                .args(["/Online", "/Cleanup-Image", "/CheckHealth"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }
        RepairAction::DismRestoreHealth => {
            system_controls::require_admin()?;
            let out = Command::new(sysdir.join("DISM.exe"))
                .args(["/Online", "/Cleanup-Image", "/RestoreHealth"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
        }
        RepairAction::SafeTempCleanup => safe_temp_cleanup(),
        RepairAction::OpenDefender => {
            crate::dashboard_actions::shell_open("windowsdefender://threatsettings", None, false)
                .or_else(|_| crate::dashboard_actions::shell_open("windowsdefender:", None, false))?;
            Ok("Opened Windows Security.".into())
        }
        RepairAction::OpenHostsFolder => {
            crate::dashboard_actions::open_directory(&sysdir.join(r"drivers\etc"))?;
            Ok("Opened drivers\\etc folder.".into())
        }
        RepairAction::OpenHostsNotepad => {
            let hosts = sysdir.join(r"drivers\etc\hosts");
            crate::dashboard_actions::shell_open(
                "notepad.exe",
                Some(&hosts.to_string_lossy()),
                !native::elevated(),
            )?;
            Ok("Opened hosts file in Notepad.".into())
        }
    }
}

fn decode_sfc_output(bytes: &[u8]) -> String {
    if bytes.len() >= 4 && bytes[1] == 0 {
        let u16s: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        return String::from_utf16_lossy(&u16s).trim().to_owned();
    }
    String::from_utf8_lossy(bytes).trim().to_owned()
}
