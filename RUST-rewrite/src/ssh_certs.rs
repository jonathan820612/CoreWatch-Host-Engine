use serde::{Deserialize, Serialize};
use std::{
    ffi::c_void,
    fs,
    net::{TcpStream, ToSocketAddrs},
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
    ptr,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{FILETIME, SYSTEMTIME},
    System::Time::FileTimeToSystemTime,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHost {
    pub alias: String,
    pub host_name: String,
    pub user: String,
    pub port: u16,
    pub identity_file: String,
    pub proxy_jump: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    pub name: String,
    pub path: String,
    pub public_key: String,
    pub key_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertInfo {
    pub store: String,
    pub subject: String,
    pub issuer: String,
    pub thumbprint: String,
    pub not_after: String,
    pub days_remaining: i64,
    pub status: String, // expired | critical | warning | ok
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCertsState {
    pub config_path: String,
    pub hosts: Vec<SshHost>,
    pub keys: Vec<SshKeyInfo>,
    pub certs: Vec<CertInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SshCertsAction {
    SaveHost { host: SshHost },
    DeleteHost { alias: String },
    LaunchSsh { alias: String },
    TestHost { host_name: String, port: u16 },
    GenerateKey { name: String, comment: String },
}

pub fn ssh_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".ssh")
}

pub fn parse_ssh_config(content: &str) -> Vec<SshHost> {
    let mut hosts = Vec::new();
    let mut current: Option<SshHost> = None;
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(2, |c: char| c.is_whitespace() || c == '=');
        let key = parts.next().unwrap_or("").trim();
        let val = parts.next().unwrap_or("").trim().trim_matches('"');
        if key.eq_ignore_ascii_case("Host") {
            if let Some(h) = current.take()
                && !h.alias.contains('*')
                && !h.alias.contains('?')
            {
                hosts.push(h);
            }
            let alias = val.split_whitespace().next().unwrap_or("").to_owned();
            if !alias.is_empty() {
                current = Some(SshHost {
                    alias,
                    host_name: String::new(),
                    user: String::new(),
                    port: 22,
                    identity_file: String::new(),
                    proxy_jump: String::new(),
                });
            }
        } else if let Some(ref mut h) = current {
            match key.to_ascii_lowercase().as_str() {
                "hostname" => h.host_name = val.to_owned(),
                "user" => h.user = val.to_owned(),
                "port" => {
                    if let Ok(p) = val.parse::<u16>() {
                        h.port = p;
                    }
                }
                "identityfile" => h.identity_file = val.to_owned(),
                "proxyjump" => h.proxy_jump = val.to_owned(),
                _ => {}
            }
        }
    }
    if let Some(h) = current
        && !h.alias.contains('*')
        && !h.alias.contains('?')
    {
        hosts.push(h);
    }
    hosts
}

pub fn list_hosts() -> Vec<SshHost> {
    let path = ssh_dir().join("config");
    fs::read_to_string(path)
        .map(|s| parse_ssh_config(&s))
        .unwrap_or_default()
}

fn list_keys() -> Vec<SshKeyInfo> {
    let dir = ssh_dir();
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut keys = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("pub") {
            continue;
        }
        let pub_text = fs::read_to_string(&path).unwrap_or_default().trim().to_owned();
        let key_type = pub_text
            .split_whitespace()
            .next()
            .unwrap_or("ssh-key")
            .to_owned();
        keys.push(SshKeyInfo {
            name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_owned(),
            path: path.to_string_lossy().into_owned(),
            public_key: pub_text,
            key_type,
        });
    }
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    keys
}

// Native Win32 CryptoAPI (crypt32.dll) certificate store reader (~1ms vs ~600ms PowerShell).
#[repr(C)]
struct CryptBlob {
    cb_data: u32,
    pb_data: *const u8,
}

#[repr(C)]
struct CryptAlgorithmIdentifier {
    psz_obj_id: *const u8,
    parameters: CryptBlob,
}

#[repr(C)]
struct CertInfoNative {
    dw_version: u32,
    serial_number: CryptBlob,
    signature_algorithm: CryptAlgorithmIdentifier,
    issuer: CryptBlob,
    not_before: FILETIME,
    not_after: FILETIME,
}

#[repr(C)]
struct CertContextNative {
    dw_cert_encoding_type: u32,
    pb_cert_encoded: *const u8,
    cb_cert_encoded: u32,
    p_cert_info: *const CertInfoNative,
    h_cert_store: *mut c_void,
}

const CERT_STORE_PROV_SYSTEM_W: *const u8 = 10usize as *const u8;
const CERT_STORE_READONLY_FLAG: u32 = 0x0000_8000;
const CERT_SYSTEM_STORE_CURRENT_USER: u32 = 0x0001_0000;
const CERT_SYSTEM_STORE_LOCAL_MACHINE: u32 = 0x0002_0000;
const CERT_NAME_SIMPLE_DISPLAY_TYPE: u32 = 4;
const CERT_NAME_ISSUER_FLAG: u32 = 1;
const CERT_SHA1_HASH_PROP_ID: u32 = 3;
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

#[link(name = "crypt32")]
unsafe extern "system" {
    fn CertOpenStore(
        lpsz_store_provider: *const u8,
        dw_encoding_type: u32,
        h_crypt_prov: usize,
        dw_flags: u32,
        pv_para: *const c_void,
    ) -> *mut c_void;
    fn CertEnumCertificatesInStore(
        h_cert_store: *mut c_void,
        p_prev_cert_context: *const CertContextNative,
    ) -> *const CertContextNative;
    fn CertGetNameStringW(
        p_cert_context: *const CertContextNative,
        dw_type: u32,
        dw_flags: u32,
        pv_type_para: *const c_void,
        psz_name_string: *mut u16,
        cch_name_string: u32,
    ) -> u32;
    fn CertGetCertificateContextProperty(
        p_cert_context: *const CertContextNative,
        dw_prop_id: u32,
        pv_data: *mut c_void,
        pcb_data: *mut u32,
    ) -> i32;
    fn CertCloseStore(h_cert_store: *mut c_void, dw_flags: u32) -> i32;
}

unsafe fn cert_name(ctx: *const CertContextNative, flags: u32) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe {
        CertGetNameStringW(
            ctx,
            CERT_NAME_SIMPLE_DISPLAY_TYPE,
            flags,
            ptr::null(),
            buf.as_mut_ptr(),
            buf.len() as u32,
        )
    };
    if len <= 1 {
        return String::new();
    }
    let end = (len as usize).saturating_sub(1).min(buf.len());
    String::from_utf16_lossy(&buf[..end]).trim().to_owned()
}

unsafe fn cert_thumbprint(ctx: *const CertContextNative) -> String {
    let mut hash = [0u8; 32];
    let mut len = hash.len() as u32;
    if unsafe {
        CertGetCertificateContextProperty(
            ctx,
            CERT_SHA1_HASH_PROP_ID,
            hash.as_mut_ptr().cast(),
            &mut len,
        )
    } == 0
    {
        return String::new();
    }
    let mut out = String::with_capacity((len as usize) * 2);
    for &b in &hash[..(len as usize).min(hash.len())] {
        out.push_str(&format!("{b:02X}"));
    }
    out
}

pub fn scan_windows_certs() -> Vec<CertInfo> {
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let store_name = crate::native::wide("MY");
    let mut out = Vec::new();

    for (label, flag) in [
        ("CurrentUser\\My", CERT_SYSTEM_STORE_CURRENT_USER),
        ("LocalMachine\\My", CERT_SYSTEM_STORE_LOCAL_MACHINE),
    ] {
        let store = unsafe {
            CertOpenStore(
                CERT_STORE_PROV_SYSTEM_W,
                0,
                0,
                flag | CERT_STORE_READONLY_FLAG,
                store_name.as_ptr().cast(),
            )
        };
        if store.is_null() {
            continue;
        }
        let mut ctx: *const CertContextNative = ptr::null();
        loop {
            ctx = unsafe { CertEnumCertificatesInStore(store, ctx) };
            if ctx.is_null() {
                break;
            }
            let info_ptr = unsafe { (*ctx).p_cert_info };
            if info_ptr.is_null() {
                continue;
            }
            let ft = unsafe { (*info_ptr).not_after };
            let ticks = ((ft.dwHighDateTime as i64) << 32) | (ft.dwLowDateTime as i64);
            let exp_secs = (ticks - UNIX_EPOCH_TICKS) / 10_000_000;
            let days = (exp_secs - now_secs).div_euclid(86_400);
            let mut st = SYSTEMTIME::default();
            let not_after = if unsafe { FileTimeToSystemTime(&ft, &mut st) } != 0 {
                format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
            } else {
                "—".into()
            };
            let status = if days < 0 {
                "expired"
            } else if days <= 30 {
                "critical"
            } else if days <= 90 {
                "warning"
            } else {
                "ok"
            }
            .to_owned();
            let subject = unsafe { cert_name(ctx, 0) };
            let issuer = unsafe { cert_name(ctx, CERT_NAME_ISSUER_FLAG) };
            let thumbprint = unsafe { cert_thumbprint(ctx) };
            out.push(CertInfo {
                store: label.to_owned(),
                subject: if subject.is_empty() {
                    "(Unnamed Certificate)".into()
                } else {
                    subject
                },
                issuer,
                thumbprint,
                not_after,
                days_remaining: days,
                status,
            });
        }
        unsafe {
            CertCloseStore(store, 0);
        }
    }

    out.sort_unstable_by_key(|c| c.days_remaining);
    out.truncate(120);
    out
}

pub fn load_state() -> SshCertsState {
    SshCertsState {
        config_path: ssh_dir().join("config").to_string_lossy().into_owned(),
        hosts: list_hosts(),
        keys: list_keys(),
        certs: scan_windows_certs(),
    }
}

fn format_host_block(h: &SshHost) -> String {
    let mut lines = vec![format!("Host {}", h.alias.trim())];
    if !h.host_name.trim().is_empty() {
        lines.push(format!("    HostName {}", h.host_name.trim()));
    }
    if !h.user.trim().is_empty() {
        lines.push(format!("    User {}", h.user.trim()));
    }
    if h.port != 0 && h.port != 22 {
        lines.push(format!("    Port {}", h.port));
    }
    if !h.identity_file.trim().is_empty() {
        lines.push(format!("    IdentityFile {}", h.identity_file.trim()));
    }
    if !h.proxy_jump.trim().is_empty() {
        lines.push(format!("    ProxyJump {}", h.proxy_jump.trim()));
    }
    lines.join("\n")
}

fn rewrite_host(target_alias: &str, replacement: Option<&SshHost>) -> Result<(), String> {
    let dir = ssh_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut output_lines: Vec<String> = Vec::new();
    let mut skipping = false;
    let mut replaced = false;

    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.to_ascii_lowercase().starts_with("host ")
            || trimmed.to_ascii_lowercase().starts_with("host\t")
        {
            let alias = trimmed.split_whitespace().nth(1).unwrap_or("");
            if alias.eq_ignore_ascii_case(target_alias) {
                skipping = true;
                if let Some(host) = replacement {
                    output_lines.push(format_host_block(host));
                    replaced = true;
                }
                continue;
            } else {
                skipping = false;
            }
        }
        if !skipping {
            output_lines.push(line.to_owned());
        }
    }
    if let Some(host) = replacement
        && !replaced
    {
        if !output_lines.is_empty() && !output_lines.last().is_some_and(|l| l.is_empty()) {
            output_lines.push(String::new());
        }
        output_lines.push(format_host_block(host));
    }
    let body = format!("{}\n", output_lines.join("\n").trim_end());
    fs::write(&path, body).map_err(|e| format!("Failed writing ~/.ssh/config: {e}"))
}

pub fn execute(action: SshCertsAction) -> Result<String, String> {
    match action {
        SshCertsAction::SaveHost { host } => {
            let alias = host.alias.trim();
            if alias.is_empty()
                || !alias
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            {
                return Err("Alias must contain only letters, digits, '-', '_', or '.'.".into());
            }
            if host.host_name.trim().is_empty() {
                return Err("HostName / IP is required.".into());
            }
            rewrite_host(alias, Some(&host))?;
            Ok(format!("Saved SSH host '{alias}' to ~/.ssh/config."))
        }
        SshCertsAction::DeleteHost { alias } => {
            rewrite_host(alias.trim(), None)?;
            Ok(format!("Removed SSH host '{}' from ~/.ssh/config.", alias.trim()))
        }
        SshCertsAction::LaunchSsh { alias } => {
            let clean = alias.trim();
            if clean.is_empty() || clean.starts_with('-') {
                return Err("Invalid SSH host alias.".into());
            }
            let wt = Command::new("wt.exe").args(["ssh", clean]).spawn();
            if wt.is_ok() {
                return Ok(format!("Launched SSH session to '{clean}' in Windows Terminal."));
            }
            Command::new("cmd.exe")
                .args(["/C", "start", "ssh", clean])
                .spawn()
                .map_err(|e| format!("Could not launch SSH terminal: {e}"))?;
            Ok(format!("Launched SSH session to '{clean}'."))
        }
        SshCertsAction::TestHost { host_name, port } => {
            let port = if port == 0 { 22 } else { port };
            let target = format!("{}:{port}", host_name.trim());
            let addr = target
                .to_socket_addrs()
                .map_err(|e| format!("DNS resolution failed for {target}: {e}"))?
                .next()
                .ok_or("No IP address resolved for target.")?;
            let start = Instant::now();
            TcpStream::connect_timeout(&addr, Duration::from_secs(3))
                .map_err(|e| format!("TCP connect to {target} failed: {e}"))?;
            let ms = start.elapsed().as_millis();
            Ok(format!("Reachable: {target} responded in {ms} ms."))
        }
        SshCertsAction::GenerateKey { name, comment } => {
            let clean_name: String = name
                .trim()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .collect();
            if clean_name.is_empty() {
                return Err("Key filename is required (e.g. id_ed25519_work).".into());
            }
            let dir = ssh_dir();
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let key_path = dir.join(&clean_name);
            if key_path.exists() {
                return Err(format!("Key '{}' already exists.", key_path.display()));
            }
            let output = Command::new("ssh-keygen.exe")
                .args([
                    "-t",
                    "ed25519",
                    "-f",
                    &key_path.to_string_lossy(),
                    "-N",
                    "",
                    "-C",
                    comment.trim(),
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Failed to run ssh-keygen.exe: {e}"))?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
            }
            Ok(format!("Generated ED25519 SSH key '{}'.", clean_name))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_config_hosts_and_reads_native_cert_store() {
        let cfg = r#"
# Homelab
Host proxmox
    HostName 10.0.0.10
    User root
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump bastion

Host *
    ServerAliveInterval 60
"#;
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "proxmox");
        assert_eq!(hosts[0].proxy_jump, "bastion");
        // Verify native crypt32 reader never crashes and formats dates cleanly
        for cert in scan_windows_certs() {
            assert!(cert.not_after.len() == 10 || cert.not_after == "—");
            assert_eq!(cert.thumbprint.len(), 40);
        }
    }
}
