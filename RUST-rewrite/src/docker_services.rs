use crate::tasks::{self, ServiceAction};
use serde::{Deserialize, Serialize};
use std::{os::windows::process::CommandExt, process::Command};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServiceInfo {
    pub name: String,
    pub display_name: String,
    pub status: String,
    pub start_type: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerState {
    pub runtime: Option<String>,
    pub runtime_available: bool,
    pub runtime_error: Option<String>,
    pub containers: Vec<ContainerInfo>,
    pub images: Vec<ImageInfo>,
    pub dev_services: Vec<DevServiceInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DockerAction {
    Start { id: String },
    Stop { id: String },
    Restart { id: String },
    RemoveContainer { id: String },
    Logs { id: String },
    RemoveImage { id: String },
    PruneSystem,
    ServiceControl { name: String, op: String },
}

fn detect_runtime() -> Option<&'static str> {
    ["docker", "podman"].into_iter().find(|&bin| {
        Command::new(bin)
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .is_ok_and(|o| o.status.success())
    })
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))
}

pub fn load_state() -> DockerState {
    let runtime = detect_runtime();
    let mut containers = Vec::new();
    let mut images = Vec::new();
    let mut runtime_error = None;
    let mut runtime_available = false;

    if let Some(bin) = runtime {
        match Command::new(bin)
            .args([
                "ps",
                "-a",
                "--format",
                "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.State}}\t{{.Status}}\t{{.Ports}}",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            Ok(out) if out.status.success() => {
                runtime_available = true;
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    let cols: Vec<&str> = line.split('\t').collect();
                    if cols.len() >= 5 {
                        containers.push(ContainerInfo {
                            id: cols[0].trim().to_owned(),
                            name: cols[1].trim().to_owned(),
                            image: cols[2].trim().to_owned(),
                            state: cols[3].trim().to_owned(),
                            status: cols[4].trim().to_owned(),
                            ports: cols.get(5).copied().unwrap_or("").trim().to_owned(),
                        });
                    }
                }
            }
            Ok(out) => {
                runtime_error = Some(String::from_utf8_lossy(&out.stderr).trim().to_owned());
            }
            Err(e) => {
                runtime_error = Some(e.to_string());
            }
        }

        if runtime_available
            && let Ok(out) = Command::new(bin)
                .args([
                    "images",
                    "--format",
                    "{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            && out.status.success()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let cols: Vec<&str> = line.split('\t').collect();
                if cols.len() >= 4 {
                    images.push(ImageInfo {
                        id: cols[0].trim().to_owned(),
                        repository: cols[1].trim().to_owned(),
                        tag: cols[2].trim().to_owned(),
                        size: cols[3].trim().to_owned(),
                    });
                }
            }
        }
    }

    DockerState {
        runtime: runtime.map(str::to_owned),
        runtime_available,
        runtime_error,
        containers,
        images,
        dev_services: scan_dev_services(),
    }
}

/// Fast native Win32 SCM query for local developer services (zero sc.exe subprocesses!).
fn scan_dev_services() -> Vec<DevServiceInfo> {
    let patterns = [
        "docker", "postgres", "mysql", "mariadb", "mongodb", "redis", "mssql", "w3svc",
        "apache", "nginx", "ollama", "sshd", "rabbitmq", "wsl", "tailscale",
    ];
    let mut out: Vec<DevServiceInfo> = tasks::enum_services_native()
        .unwrap_or_default()
        .into_iter()
        .filter(|s| {
            let lower = s.name.to_ascii_lowercase();
            let dlower = s.display_name.to_ascii_lowercase();
            patterns
                .iter()
                .any(|p| lower.contains(p) || dlower.contains(p))
        })
        .map(|s| DevServiceInfo {
            name: s.name,
            display_name: s.display_name,
            status: s.state,
            start_type: s.start_mode,
            pid: s.process_id,
        })
        .collect();
    out.sort_by_key(|a| a.name.to_ascii_lowercase());
    out
}

pub fn execute(action: DockerAction) -> Result<String, String> {
    if let DockerAction::ServiceControl { name, op } = action {
        let act = match op.as_str() {
            "start" => ServiceAction::Start,
            "stop" => ServiceAction::Stop,
            "restart" => ServiceAction::Restart,
            _ => return Err("Unsupported service operation.".into()),
        };
        tasks::control_service(name.trim(), act)?;
        return Ok(format!("Service '{}' {op} completed.", name.trim()));
    }

    let bin = detect_runtime().ok_or("Neither Docker nor Podman CLI was found on PATH.")?;
    let args: Vec<&str> = match &action {
        DockerAction::Start { id } => {
            if !valid_id(id) {
                return Err("Invalid container ID.".into());
            }
            vec!["start", id]
        }
        DockerAction::Stop { id } => {
            if !valid_id(id) {
                return Err("Invalid container ID.".into());
            }
            vec!["stop", id]
        }
        DockerAction::Restart { id } => {
            if !valid_id(id) {
                return Err("Invalid container ID.".into());
            }
            vec!["restart", id]
        }
        DockerAction::RemoveContainer { id } => {
            if !valid_id(id) {
                return Err("Invalid container ID.".into());
            }
            vec!["rm", "-f", id]
        }
        DockerAction::Logs { id } => {
            if !valid_id(id) {
                return Err("Invalid container ID.".into());
            }
            vec!["logs", "--tail", "80", id]
        }
        DockerAction::RemoveImage { id } => {
            if !valid_id(id) {
                return Err("Invalid image ID.".into());
            }
            vec!["rmi", id]
        }
        DockerAction::PruneSystem => vec!["system", "prune", "-f"],
        DockerAction::ServiceControl { .. } => unreachable!(),
    };
    let out = Command::new(bin)
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed executing {bin}: {e}"))?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        Ok(if !stdout.is_empty() { stdout } else { stderr })
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}
