use crate::{dashboard_actions, network, secrets, ssh_certs};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::{IpAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const HOMELAB_FILE: &str = "homelab-nodes.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomelabNode {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: String, // tcp | ssh | http | https | rdp | icmp | winrm
    pub role: String,
    pub online: Option<bool>,
    pub latency_ms: Option<u64>,
    pub last_checked_ms: Option<u64>,
    pub detail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HomelabAction {
    SaveNode { node: HomelabNode },
    DeleteNode { id: String },
    ProbeAll,
    ProbeOne { id: String },
    ImportSshConfig,
    LaunchSsh { id: String },
    LaunchRdp { id: String },
    OpenWeb { id: String },
}

pub struct HomelabManager {
    file: Option<PathBuf>,
    nodes: Mutex<Vec<HomelabNode>>,
}

impl HomelabManager {
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.map(|d| d.join(HOMELAB_FILE));
        let nodes = file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<Vec<HomelabNode>>(&raw).ok())
            .unwrap_or_default();
        Self {
            file,
            nodes: Mutex::new(nodes),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<HomelabNode>> {
        self.nodes.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn list(&self) -> Vec<HomelabNode> {
        self.lock().clone()
    }

    fn persist(&self, list: &[HomelabNode]) {
        if let Some(path) = &self.file {
            secrets::write_json_atomic(path, list);
        }
    }

    pub fn execute(&self, action: HomelabAction) -> Result<(Vec<HomelabNode>, String), String> {
        match action {
            HomelabAction::SaveNode { mut node } => {
                if node.name.trim().is_empty() || node.host.trim().is_empty() {
                    return Err("Node name and host/IP are required.".into());
                }
                if node.id.trim().is_empty() {
                    node.id = format!("node-{}", now_ms());
                }
                node.name = node.name.trim().to_owned();
                node.host = node.host.trim().to_owned();
                node.protocol = node.protocol.trim().to_ascii_lowercase();
                if node.port == 0 {
                    node.port = match node.protocol.as_str() {
                        "http" => 80,
                        "https" => 443,
                        "rdp" => 3389,
                        "winrm" => 5985,
                        "icmp" => 0,
                        _ => 22,
                    };
                }
                let mut guard = self.lock();
                if let Some(existing) = guard.iter_mut().find(|n| n.id == node.id) {
                    *existing = node.clone();
                } else {
                    guard.push(node.clone());
                }
                self.persist(&guard);
                Ok((guard.clone(), format!("Saved homelab node '{}'.", node.name)))
            }
            HomelabAction::DeleteNode { id } => {
                let mut guard = self.lock();
                let before = guard.len();
                guard.retain(|n| n.id != id);
                if guard.len() == before {
                    return Err("Node not found.".into());
                }
                self.persist(&guard);
                Ok((guard.clone(), "Removed homelab node.".into()))
            }
            HomelabAction::ImportSshConfig => {
                let ssh_hosts = ssh_certs::list_hosts();
                let mut guard = self.lock();
                let mut added = 0usize;
                for h in ssh_hosts {
                    if h.host_name.is_empty() {
                        continue;
                    }
                    if guard.iter().any(|n| n.host.eq_ignore_ascii_case(&h.host_name) && n.port == h.port) {
                        continue;
                    }
                    guard.push(HomelabNode {
                        id: format!("ssh-{}", h.alias),
                        name: h.alias,
                        host: h.host_name,
                        port: h.port,
                        protocol: "ssh".into(),
                        role: "SSH Host".into(),
                        online: None,
                        latency_ms: None,
                        last_checked_ms: None,
                        detail: None,
                    });
                    added += 1;
                }
                self.persist(&guard);
                Ok((
                    guard.clone(),
                    format!("Imported {added} host(s) from ~/.ssh/config."),
                ))
            }
            HomelabAction::ProbeOne { id } => {
                let target = self
                    .lock()
                    .iter()
                    .find(|n| n.id == id)
                    .cloned()
                    .ok_or("Node not found.")?;
                let (online, latency_ms, detail) = probe_node(&target);
                let ts = now_ms();
                let mut guard = self.lock();
                if let Some(n) = guard.iter_mut().find(|n| n.id == id) {
                    n.online = Some(online);
                    n.latency_ms = latency_ms;
                    n.last_checked_ms = Some(ts);
                    n.detail = Some(detail.clone());
                }
                self.persist(&guard);
                Ok((guard.clone(), format!("{}: {detail}", target.name)))
            }
            HomelabAction::ProbeAll => {
                let snapshot = self.list();
                // Parallel concurrent probing across all homelab nodes!
                let results: Vec<(String, bool, Option<u64>, String)> = thread::scope(|s| {
                    let handles: Vec<_> = snapshot
                        .into_iter()
                        .map(|n| {
                            s.spawn(move || {
                                let (ok, ms, msg) = probe_node(&n);
                                (n.id, ok, ms, msg)
                            })
                        })
                        .collect();
                    handles
                        .into_iter()
                        .filter_map(|h| h.join().ok())
                        .collect()
                });
                let ts = now_ms();
                let online_count = results.iter().filter(|r| r.1).count();
                let total = results.len();
                let mut guard = self.lock();
                for (id, ok, ms, msg) in results {
                    if let Some(n) = guard.iter_mut().find(|n| n.id == id) {
                        n.online = Some(ok);
                        n.latency_ms = ms;
                        n.last_checked_ms = Some(ts);
                        n.detail = Some(msg);
                    }
                }
                self.persist(&guard);
                Ok((
                    guard.clone(),
                    format!("Probed {total} node(s) in parallel: {online_count} online."),
                ))
            }
            HomelabAction::LaunchSsh { id } => {
                let node = self
                    .lock()
                    .iter()
                    .find(|n| n.id == id)
                    .cloned()
                    .ok_or("Node not found.")?;
                let host = validate_host(&node.host)?;
                let port = if node.port == 0 { 22 } else { node.port };
                let port_str = port.to_string();
                if Command::new("wt.exe")
                    .args(["ssh", "-p", &port_str, host])
                    .spawn()
                    .is_ok()
                {
                    return Ok((self.list(), format!("Launched SSH to {host}:{port} in Windows Terminal.")));
                }
                Command::new("cmd.exe")
                    .args(["/C", "start", "ssh", "-p", &port_str, host])
                    .spawn()
                    .map_err(|e| format!("Failed launching SSH: {e}"))?;
                Ok((self.list(), format!("Launched SSH to {host}:{port}.")))
            }
            HomelabAction::LaunchRdp { id } => {
                let node = self
                    .lock()
                    .iter()
                    .find(|n| n.id == id)
                    .cloned()
                    .ok_or("Node not found.")?;
                let host = validate_host(&node.host)?;
                let target = if node.port > 0 && node.port != 3389 {
                    format!("/v:{host}:{}", node.port)
                } else {
                    format!("/v:{host}")
                };
                Command::new("mstsc.exe")
                    .arg(&target)
                    .spawn()
                    .map_err(|e| format!("Failed launching Remote Desktop (mstsc.exe): {e}"))?;
                Ok((self.list(), format!("Launched Remote Desktop to {host}.")))
            }
            HomelabAction::OpenWeb { id } => {
                let node = self
                    .lock()
                    .iter()
                    .find(|n| n.id == id)
                    .cloned()
                    .ok_or("Node not found.")?;
                let host = validate_host(&node.host)?;
                let scheme = if node.protocol == "https" || node.port == 443 || node.port == 8443 || node.port == 8006 {
                    "https"
                } else {
                    "http"
                };
                let url = if (scheme == "http" && (node.port == 80 || node.port == 0))
                    || (scheme == "https" && (node.port == 443 || node.port == 0))
                {
                    format!("{scheme}://{host}")
                } else {
                    format!("{scheme}://{host}:{}", node.port)
                };
                dashboard_actions::shell_open(&url, None, false)?;
                Ok((self.list(), format!("Opened {url}.")))
            }
        }
    }
}

fn validate_host(host: &str) -> Result<&str, String> {
    let h = host.trim();
    if h.is_empty()
        || h.starts_with('-')
        || h.chars()
            .any(|c| c.is_whitespace() || matches!(c, '&' | '|' | ';' | '"' | '\'' | '`' | '$'))
    {
        return Err("Host contains unsupported characters.".into());
    }
    Ok(h)
}

fn probe_node(node: &HomelabNode) -> (bool, Option<u64>, String) {
    match node.protocol.as_str() {
        "http" | "https" => {
            let port = if node.port > 0 {
                node.port
            } else if node.protocol == "https" {
                443
            } else {
                80
            };
            let url = format!("{}://{}:{port}/", node.protocol, node.host);
            match secrets::http_request("GET", &url, &[], None, 3500, true, 16 * 1024) {
                Ok(resp) => {
                    let ms = resp.elapsed_ms;
                    let ok = resp.status < 500;
                    (ok, Some(ms), format!("HTTP {} ({ms} ms)", resp.status))
                }
                Err(e) => (false, None, format!("HTTP error ({e})")),
            }
        }
        "icmp" => {
            let Ok(addrs) = (node.host.as_str(), 0u16).to_socket_addrs() else {
                return (false, None, "DNS lookup failed".into());
            };
            let Some(ipv4) = addrs.into_iter().find_map(|a| match a.ip() {
                IpAddr::V4(ip) => Some(ip),
                IpAddr::V6(_) => None,
            }) else {
                return (false, None, "No IPv4 address for ICMP".into());
            };
            match network::ping(ipv4, 2) {
                Ok(replies) => {
                    if let Some(ms) = replies.iter().find_map(|r| (r.status == 0).then_some(r.ms).flatten()) {
                        (true, Some(u64::from(ms)), format!("ICMP Reply ({ms} ms)"))
                    } else {
                        (false, None, "ICMP Timeout".into())
                    }
                }
                Err(e) => (false, None, format!("ICMP error: {e}")),
            }
        }
        _ => {
            let port = if node.port > 0 { node.port } else { 22 };
            probe_tcp(&node.host, port)
        }
    }
}

fn probe_tcp(host: &str, port: u16) -> (bool, Option<u64>, String) {
    let target = format!("{host}:{port}");
    let Ok(mut addrs) = target.to_socket_addrs() else {
        return (false, None, "DNS lookup failed".into());
    };
    let Some(addr) = addrs.next() else {
        return (false, None, "No IP address".into());
    };
    let start = Instant::now();
    match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(_) => {
            let ms = start.elapsed().as_millis() as u64;
            (true, Some(ms), format!("Online TCP:{port} ({ms} ms)"))
        }
        Err(e) => (false, None, format!("Unreachable ({})", e.kind())),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
