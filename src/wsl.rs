use crate::dashboard_actions;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use winreg::{RegKey, enums::{HKEY_CURRENT_USER, KEY_READ}};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistro {
    pub name: String,
    pub state: String,
    pub version: String,
    pub is_default: bool,
    pub vhdx_bytes: Option<u64>,
    pub base_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WslConfig {
    pub memory: String,
    pub processors: String,
    pub swap: String,
    pub localhost_forwarding: bool,
    pub networking_mode: String,
    pub dns_tunneling: bool,
    pub firewall: bool,
    pub auto_proxy: bool,
    pub gui_applications: bool,
    pub nested_virtualization: bool,
    pub auto_memory_reclaim: String,
    pub sparse_vhd: bool,
}

impl Default for WslConfig {
    fn default() -> Self {
        Self {
            memory: String::new(),
            processors: String::new(),
            swap: String::new(),
            localhost_forwarding: true,
            networking_mode: String::new(),
            dns_tunneling: true,
            firewall: true,
            auto_proxy: true,
            gui_applications: true,
            nested_virtualization: true,
            auto_memory_reclaim: String::new(),
            sparse_vhd: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslState {
    pub available: bool,
    pub error: Option<String>,
    pub distros: Vec<WslDistro>,
    pub config: WslConfig,
    pub config_path: String,
    pub vmmem_mb: u64,
    pub total_vhdx_bytes: u64,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WslAction {
    Launch { name: String },
    Explore { name: String },
    Terminate { name: String },
    ShutdownAll,
    SetDefault { name: String },
    SetVersion { name: String, version: u8 },
    Unregister { name: String },
    Install { name: String },
    OnlineList,
    OpenConfig,
    SaveConfig { config: WslConfig },
}

pub fn decode_wsl_output(bytes: &[u8]) -> String {
    let zero_count = bytes.iter().filter(|&&b| b == 0).count();
    if bytes.len() >= 4 && zero_count > bytes.len() / 4 {
        let slice = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
        let u16s: Vec<u16> = slice
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .collect();
        return String::from_utf16_lossy(&u16s)
            .replace('\0', "")
            .trim()
            .to_owned();
    }
    String::from_utf8_lossy(bytes)
        .replace('\0', "")
        .trim()
        .to_owned()
}

pub fn parse_wsl_list(raw: &str) -> Vec<WslDistro> {
    let mut distros = Vec::new();
    for (idx, line) in raw.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || idx == 0 && trimmed.to_ascii_uppercase().contains("NAME") {
            continue;
        }
        let is_default = trimmed.starts_with('*');
        let clean = trimmed.trim_start_matches('*').trim();
        let cols: Vec<&str> = clean.split_whitespace().collect();
        if cols.len() >= 3 {
            let version = cols[cols.len() - 1].to_owned();
            let state = cols[cols.len() - 2].to_owned();
            let name = cols[..cols.len() - 2].join(" ");
            if !name.is_empty() {
                distros.push(WslDistro {
                    name,
                    state,
                    version,
                    is_default,
                    vhdx_bytes: None,
                    base_path: String::new(),
                });
            }
        }
    }
    distros
}

fn read_lxss_metadata() -> HashMap<String, (String, Option<u64>)> {
    let mut map = HashMap::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(lxss) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Lxss",
        KEY_READ,
    ) else {
        return map;
    };
    for guid in lxss.enum_keys().flatten() {
        let Ok(sub) = lxss.open_subkey_with_flags(&guid, KEY_READ) else {
            continue;
        };
        let Ok(name) = sub.get_value::<String, _>("DistributionName") else {
            continue;
        };
        let base_raw: String = sub.get_value("BasePath").unwrap_or_default();
        let base_clean = base_raw
            .strip_prefix(r"\\?\")
            .unwrap_or(&base_raw)
            .to_owned();
        let vhdx = if !base_clean.is_empty() {
            fs::metadata(Path::new(&base_clean).join("ext4.vhdx"))
                .ok()
                .map(|m| m.len())
        } else {
            None
        };
        map.insert(name, (base_clean, vhdx));
    }
    map
}

fn vmmem_usage_mb() -> u64 {
    crate::native::process_memory_sum_by_names(&["vmmem", "vmmemwsl"]) / (1024 * 1024)
}

fn wslconfig_path() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".wslconfig")
}

fn read_wslconfig() -> WslConfig {
    let mut cfg = WslConfig::default();
    let Ok(raw) = fs::read_to_string(wslconfig_path()) else {
        return cfg;
    };
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') || trimmed.starts_with('[') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let val = v.trim();
            match k.trim().to_ascii_lowercase().as_str() {
                "memory" => cfg.memory = val.to_owned(),
                "processors" => cfg.processors = val.to_owned(),
                "swap" => cfg.swap = val.to_owned(),
                "localhostforwarding" => cfg.localhost_forwarding = !val.eq_ignore_ascii_case("false"),
                "networkingmode" => cfg.networking_mode = val.to_owned(),
                "dnstunneling" => cfg.dns_tunneling = !val.eq_ignore_ascii_case("false"),
                "firewall" => cfg.firewall = !val.eq_ignore_ascii_case("false"),
                "autoproxy" => cfg.auto_proxy = !val.eq_ignore_ascii_case("false"),
                "guiapplications" => cfg.gui_applications = !val.eq_ignore_ascii_case("false"),
                "nestedvirtualization" => cfg.nested_virtualization = !val.eq_ignore_ascii_case("false"),
                "automemoryreclaim" => cfg.auto_memory_reclaim = val.to_owned(),
                "sparsevhd" => cfg.sparse_vhd = val.eq_ignore_ascii_case("true"),
                _ => {}
            }
        }
    }
    cfg
}

/// Non-destructively merges updated keys into existing `.wslconfig` text, preserving all user
/// comments, unknown keys, and unrelated sections.
pub fn merge_wslconfig(existing: &str, cfg: &WslConfig) -> String {
    let wsl2_updates: Vec<(&str, Option<String>)> = vec![
        ("memory", (!cfg.memory.trim().is_empty()).then(|| cfg.memory.trim().to_owned())),
        ("processors", (!cfg.processors.trim().is_empty()).then(|| cfg.processors.trim().to_owned())),
        ("swap", (!cfg.swap.trim().is_empty()).then(|| cfg.swap.trim().to_owned())),
        ("localhostForwarding", Some(if cfg.localhost_forwarding { "true" } else { "false" }.into())),
        ("networkingMode", (!cfg.networking_mode.trim().is_empty()).then(|| cfg.networking_mode.trim().to_owned())),
        ("dnsTunneling", Some(if cfg.dns_tunneling { "true" } else { "false" }.into())),
        ("firewall", Some(if cfg.firewall { "true" } else { "false" }.into())),
        ("autoProxy", Some(if cfg.auto_proxy { "true" } else { "false" }.into())),
        ("guiApplications", Some(if cfg.gui_applications { "true" } else { "false" }.into())),
        ("nestedVirtualization", Some(if cfg.nested_virtualization { "true" } else { "false" }.into())),
    ];
    let exp_updates: Vec<(&str, Option<String>)> = vec![
        ("autoMemoryReclaim", (!cfg.auto_memory_reclaim.trim().is_empty()).then(|| cfg.auto_memory_reclaim.trim().to_owned())),
        ("sparseVhd", cfg.sparse_vhd.then(|| "true".into())),
    ];

    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut cur_sec = String::new();
    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            cur_sec = trimmed[1..trimmed.len() - 1].trim().to_owned();
            if !sections.iter().any(|(s, _)| s.eq_ignore_ascii_case(&cur_sec)) {
                sections.push((cur_sec.clone(), Vec::new()));
            }
        } else {
            if sections.is_empty() {
                sections.push((String::new(), Vec::new()));
            }
            if let Some((_, lines)) = sections.iter_mut().find(|(s, _)| s.eq_ignore_ascii_case(&cur_sec)) {
                lines.push(line.to_owned());
            } else if let Some((_, lines)) = sections.last_mut() {
                lines.push(line.to_owned());
            }
        }
    }

    let apply_section = |sections: &mut Vec<(String, Vec<String>)>, sec_name: &str, updates: &[(&str, Option<String>)]| {
        let has_any = updates.iter().any(|(_, v)| v.is_some());
        if !has_any && !sections.iter().any(|(s, _)| s.eq_ignore_ascii_case(sec_name)) {
            return;
        }
        let idx = match sections
            .iter()
            .position(|(s, _)| s.eq_ignore_ascii_case(sec_name))
        {
            Some(i) => i,
            None => {
                sections.push((sec_name.to_owned(), Vec::new()));
                sections.len() - 1
            }
        };
        let lines = &mut sections[idx].1;
        for (key, val_opt) in updates {
            let pos = lines.iter().position(|l| {
                let t = l.trim();
                !t.starts_with('#')
                    && !t.starts_with(';')
                    && t.split_once('=')
                        .is_some_and(|(k, _)| k.trim().eq_ignore_ascii_case(key))
            });
            match (pos, val_opt) {
                (Some(idx), Some(val)) => lines[idx] = format!("{key}={val}"),
                (Some(idx), None) => {
                    lines.remove(idx);
                }
                (None, Some(val)) => lines.push(format!("{key}={val}")),
                (None, None) => {}
            }
        }
    };

    apply_section(&mut sections, "wsl2", &wsl2_updates);
    apply_section(&mut sections, "experimental", &exp_updates);

    let mut out = Vec::new();
    for (name, lines) in sections {
        let meaningful = lines.iter().any(|l| !l.trim().is_empty());
        if name.is_empty() {
            if meaningful {
                out.extend(lines);
            }
            continue;
        }
        if !meaningful {
            continue;
        }
        if !out.is_empty() && !out.last().is_some_and(|l| l.trim().is_empty()) {
            out.push(String::new());
        }
        out.push(format!("[{name}]"));
        out.extend(lines);
    }
    format!("{}\n", out.join("\n"))
}

fn run_wsl_timeout(wsl: &Path, args: &[&str], timeout: Duration) -> Result<std::process::Output, String> {
    let mut child = Command::new(wsl)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed launching wsl.exe: {e}"))?;
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = stdout_pipe {
            let _ = std::io::Read::read_to_end(&mut r, &mut buf);
        }
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(mut r) = stderr_pipe {
            let _ = std::io::Read::read_to_end(&mut r, &mut buf);
        }
        buf
    });
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let stdout = out_handle.join().unwrap_or_default();
            let stderr = err_handle.join().unwrap_or_default();
            return Ok(std::process::Output {
                status,
                stdout,
                stderr,
            });
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out_handle.join();
            let _ = err_handle.join();
            return Err(format!("wsl.exe {} timed out after {}s.", args.join(" "), timeout.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(35));
    }
}

fn valid_distro_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub fn load_state() -> WslState {
    let config_path = wslconfig_path().to_string_lossy().into_owned();
    let config = read_wslconfig();
    let vmmem_mb = vmmem_usage_mb();
    let lxss = read_lxss_metadata();
    let Ok(sysdir) = crate::network::system_directory() else {
        return WslState {
            available: false,
            error: Some("System32 directory unavailable.".into()),
            distros: Vec::new(),
            config,
            config_path,
            vmmem_mb,
            total_vhdx_bytes: 0,
        };
    };
    let wsl = sysdir.join("wsl.exe");
    match run_wsl_timeout(&wsl, &["--list", "--verbose"], Duration::from_secs(8)) {
        Ok(out) if out.status.success() => {
            let text = decode_wsl_output(&out.stdout);
            let mut distros = parse_wsl_list(&text);
            let mut total_vhdx = 0u64;
            for d in &mut distros {
                if let Some((base, sz)) = lxss.get(&d.name) {
                    d.base_path = base.clone();
                    d.vhdx_bytes = *sz;
                    total_vhdx = total_vhdx.saturating_add(sz.unwrap_or(0));
                }
            }
            WslState {
                available: true,
                error: None,
                distros,
                config,
                config_path,
                vmmem_mb,
                total_vhdx_bytes: total_vhdx,
            }
        }
        Ok(out) => {
            let err = decode_wsl_output(&out.stderr);
            let stdout = decode_wsl_output(&out.stdout);
            let msg = if !err.is_empty() { err } else { stdout };
            WslState {
                available: true,
                error: (!msg.is_empty()).then_some(msg),
                distros: Vec::new(),
                config,
                config_path,
                vmmem_mb,
                total_vhdx_bytes: 0,
            }
        }
        Err(e) => WslState {
            available: false,
            error: Some(format!("WSL is not installed or unavailable: {e}")),
            distros: Vec::new(),
            config,
            config_path,
            vmmem_mb,
            total_vhdx_bytes: 0,
        },
    }
}

pub fn execute(action: WslAction) -> Result<String, String> {
    let wsl = crate::network::system_directory()?.join("wsl.exe");
    match action {
        WslAction::Launch { name } => {
            if !valid_distro_name(&name) {
                return Err("Invalid WSL distribution name.".into());
            }
            if Command::new("wt.exe").args(["wsl", "-d", &name]).spawn().is_ok() {
                return Ok(format!("Launched '{name}' in Windows Terminal."));
            }
            Command::new("cmd.exe")
                .args(["/C", "start", "wsl", "-d", &name])
                .spawn()
                .map_err(|e| format!("Could not launch WSL shell: {e}"))?;
            Ok(format!("Launched '{name}'."))
        }
        WslAction::Explore { name } => {
            if !valid_distro_name(&name) {
                return Err("Invalid WSL distribution name.".into());
            }
            let unc = format!(r"\\wsl.localhost\{name}");
            dashboard_actions::shell_open(&unc, None, false)?;
            Ok(format!("Opened {unc} in File Explorer."))
        }
        WslAction::Terminate { name } => {
            if !valid_distro_name(&name) {
                return Err("Invalid WSL distribution name.".into());
            }
            let out = run_wsl_timeout(&wsl, &["--terminate", &name], Duration::from_secs(12))?;
            if out.status.success() {
                Ok(format!("Terminated WSL distro '{name}'."))
            } else {
                Err(decode_wsl_output(&out.stderr))
            }
        }
        WslAction::ShutdownAll => {
            let out = run_wsl_timeout(&wsl, &["--shutdown"], Duration::from_secs(15))?;
            if out.status.success() {
                Ok("Shut down all running WSL instances.".into())
            } else {
                Err(decode_wsl_output(&out.stderr))
            }
        }
        WslAction::SetDefault { name } => {
            if !valid_distro_name(&name) {
                return Err("Invalid WSL distribution name.".into());
            }
            let out = run_wsl_timeout(&wsl, &["--set-default", &name], Duration::from_secs(10))?;
            if out.status.success() {
                Ok(format!("Set '{name}' as the default WSL distro."))
            } else {
                Err(decode_wsl_output(&out.stderr))
            }
        }
        WslAction::SetVersion { name, version } => {
            if !valid_distro_name(&name) || !matches!(version, 1 | 2) {
                return Err("Invalid WSL distribution or version (must be 1 or 2).".into());
            }
            let v_str = version.to_string();
            let out = run_wsl_timeout(&wsl, &["--set-version", &name, &v_str], Duration::from_secs(120))?;
            if out.status.success() {
                Ok(format!("Converted '{name}' to WSL {version}."))
            } else {
                Err(decode_wsl_output(&out.stderr))
            }
        }
        WslAction::Unregister { name } => {
            if !valid_distro_name(&name) {
                return Err("Invalid WSL distribution name.".into());
            }
            let out = run_wsl_timeout(&wsl, &["--unregister", &name], Duration::from_secs(20))?;
            if out.status.success() {
                Ok(format!("Unregistered WSL distro '{name}'."))
            } else {
                Err(decode_wsl_output(&out.stderr))
            }
        }
        WslAction::Install { name } => {
            if !valid_distro_name(&name) {
                return Err("Invalid WSL distribution name.".into());
            }
            if Command::new("wt.exe")
                .args(["wsl", "--install", "-d", &name])
                .spawn()
                .is_ok()
            {
                return Ok(format!("Started installing '{name}' in Windows Terminal."));
            }
            Command::new("cmd.exe")
                .args(["/C", "start", "wsl", "--install", "-d", &name])
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(format!("Started installing '{name}'."))
        }
        WslAction::OnlineList => {
            let out = run_wsl_timeout(&wsl, &["--list", "--online"], Duration::from_secs(15))?;
            let text = decode_wsl_output(&out.stdout);
            if text.is_empty() {
                Err(decode_wsl_output(&out.stderr))
            } else {
                Ok(text)
            }
        }
        WslAction::OpenConfig => {
            let path = wslconfig_path();
            if !path.exists() {
                let _ = fs::write(&path, "[wsl2]\n");
            }
            dashboard_actions::shell_open("notepad.exe", Some(&path.to_string_lossy()), false)?;
            Ok(format!("Opened {} in Notepad.", path.display()))
        }
        WslAction::SaveConfig { config } => {
            let path = wslconfig_path();
            let existing = fs::read_to_string(&path).unwrap_or_default();
            let merged = merge_wslconfig(&existing, &config);
            fs::write(&path, merged)
                .map_err(|e| format!("Failed writing .wslconfig: {e}"))?;
            Ok(format!("Saved {} (preserving custom keys & sections). Run 'Shutdown All' to apply.", path.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16le_and_parses_wsl_verbose_output() {
        let sample = "  NAME            STATE           VERSION\r\n* Ubuntu-24.04    Running         2\r\n  Debian          Stopped         2\r\n";
        let utf16: Vec<u8> = sample
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let decoded = decode_wsl_output(&utf16);
        let distros = parse_wsl_list(&decoded);
        assert_eq!(distros.len(), 2);
        assert_eq!(distros[0].name, "Ubuntu-24.04");
        assert!(distros[0].is_default);
        assert_eq!(distros[0].state, "Running");
        assert_eq!(distros[1].name, "Debian");
        assert!(!distros[1].is_default);
    }

    #[test]
    fn merge_wslconfig_preserves_comments_and_unknown_keys() {
        let existing = "[wsl2]\n# keep my custom kernel\nkernel=C:\\\\custom\\\\bzImage\nmemory=8GB\n\n[experimental]\ncustomFlag=1\n";
        let cfg = WslConfig {
            memory: "16GB".into(),
            auto_memory_reclaim: "gradual".into(),
            ..WslConfig::default()
        };
        let merged = merge_wslconfig(existing, &cfg);
        assert!(merged.contains("# keep my custom kernel"));
        assert!(merged.contains("kernel=C:\\\\custom\\\\bzImage"));
        assert!(merged.contains("memory=16GB"));
        assert!(merged.contains("customFlag=1"));
        assert!(merged.contains("autoMemoryReclaim=gradual"));
    }
}
