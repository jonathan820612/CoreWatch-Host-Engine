use crate::{dashboard_actions, secrets};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const BACKUP_FILE: &str = "backup-jobs.json";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupJob {
    pub id: String,
    pub name: String,
    pub source: String,
    pub destination: String,
    pub mode: String, // incremental | mirror
    pub excludes: Vec<String>,
    pub last_run_ms: Option<u64>,
    pub last_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRunRecord {
    pub timestamp_ms: u64,
    pub job_name: String,
    pub dry_run: bool,
    pub exit_code: i32,
    pub success: bool,
    pub summary: String,
    pub output_tail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupState {
    pub jobs: Vec<BackupJob>,
    pub history: Vec<BackupRunRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BackupAction {
    SaveJob { job: BackupJob },
    DeleteJob { id: String },
    RunJob { id: String, dry_run: bool },
    OpenFolder { path: String },
    ClearHistory,
}

pub struct BackupManager {
    file: Option<PathBuf>,
    state: Mutex<BackupState>,
}

impl BackupManager {
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.map(|d| d.join(BACKUP_FILE));
        let state = file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<BackupState>(&raw).ok())
            .unwrap_or_default();
        Self {
            file,
            state: Mutex::new(state),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BackupState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> BackupState {
        self.lock().clone()
    }

    fn persist(&self, state: &BackupState) {
        if let Some(path) = &self.file {
            secrets::write_json_atomic(path, state);
        }
    }

    pub fn execute(&self, action: BackupAction) -> Result<(BackupState, String), String> {
        match action {
            BackupAction::OpenFolder { path } => {
                let p = Path::new(path.trim());
                if !p.is_dir() {
                    return Err("Folder does not exist on disk yet.".into());
                }
                dashboard_actions::open_directory(p)?;
                Ok((self.snapshot(), format!("Opened {}", p.display())))
            }
            BackupAction::SaveJob { mut job } => {
                if job.name.trim().is_empty()
                    || job.source.trim().is_empty()
                    || job.destination.trim().is_empty()
                {
                    return Err("Job name, source folder, and destination folder are required.".into());
                }
                let src_norm = job.source.trim().trim_end_matches(['\\', '/']).to_ascii_lowercase();
                let dst_norm = job.destination.trim().trim_end_matches(['\\', '/']).to_ascii_lowercase();
                if src_norm == dst_norm {
                    return Err("Source and destination folders must be different.".into());
                }
                if job.mode == "mirror" && dashboard_actions::is_protected_system_path(Path::new(job.destination.trim())) {
                    return Err("Refused: Mirror mode cannot target a protected Windows system folder.".into());
                }
                if job.id.trim().is_empty() {
                    job.id = format!("job-{}", now_ms());
                }
                job.name = job.name.trim().to_owned();
                job.source = job.source.trim().to_owned();
                job.destination = job.destination.trim().to_owned();
                if job.mode != "mirror" {
                    job.mode = "incremental".into();
                }
                let mut guard = self.lock();
                if let Some(existing) = guard.jobs.iter_mut().find(|j| j.id == job.id) {
                    *existing = job.clone();
                } else {
                    guard.jobs.push(job.clone());
                }
                self.persist(&guard);
                Ok((guard.clone(), format!("Saved backup job '{}'.", job.name)))
            }
            BackupAction::DeleteJob { id } => {
                let mut guard = self.lock();
                let before = guard.jobs.len();
                guard.jobs.retain(|j| j.id != id);
                if guard.jobs.len() == before {
                    return Err("Backup job not found.".into());
                }
                self.persist(&guard);
                Ok((guard.clone(), "Deleted backup job.".into()))
            }
            BackupAction::ClearHistory => {
                let mut guard = self.lock();
                guard.history.clear();
                self.persist(&guard);
                Ok((guard.clone(), "Cleared backup run history.".into()))
            }
            BackupAction::RunJob { id, dry_run } => {
                let job = self
                    .lock()
                    .jobs
                    .iter()
                    .find(|j| j.id == id)
                    .cloned()
                    .ok_or("Backup job not found.")?;
                if !Path::new(&job.source).is_dir() {
                    return Err(format!("Source directory does not exist: {}", job.source));
                }
                let robocopy = crate::network::system_directory()?.join("robocopy.exe");
                let mut args = vec![
                    job.source.clone(),
                    job.destination.clone(),
                    if job.mode == "mirror" { "/MIR" } else { "/E" }.to_owned(),
                    "/R:2".into(),
                    "/W:2".into(),
                    "/NP".into(),
                    "/NDL".into(),
                    "/MT:8".into(),
                ];
                if dry_run {
                    args.push("/L".into());
                }
                let xd: Vec<String> = job
                    .excludes
                    .iter()
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty())
                    .collect();
                if !xd.is_empty() {
                    args.push("/XD".into());
                    args.extend(xd);
                }
                let output = Command::new(robocopy)
                    .args(&args)
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .map_err(|e| format!("Failed to execute robocopy: {e}"))?;
                let code = output.status.code().unwrap_or(-1);
                let success = (0..=7).contains(&code);
                let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
                let tail: Vec<&str> = stdout.lines().rev().take(24).collect();
                let output_tail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
                let summary = format!(
                    "{} {} (robocopy exit {code}: {})",
                    if dry_run { "Dry-run" } else { "Sync" },
                    if success { "completed" } else { "failed" },
                    decode_robocopy_exit(code)
                );
                let ts = now_ms();
                let mut guard = self.lock();
                if let Some(j) = guard.jobs.iter_mut().find(|j| j.id == id) {
                    j.last_run_ms = Some(ts);
                    j.last_status = Some(summary.clone());
                }
                guard.history.insert(
                    0,
                    BackupRunRecord {
                        timestamp_ms: ts,
                        job_name: job.name.clone(),
                        dry_run,
                        exit_code: code,
                        success,
                        summary: summary.clone(),
                        output_tail,
                    },
                );
                guard.history.truncate(50);
                self.persist(&guard);
                Ok((guard.clone(), summary))
            }
        }
    }
}

pub fn decode_robocopy_exit(code: i32) -> &'static str {
    match code {
        0 => "No changes needed",
        1 => "Files copied successfully",
        2 => "Extra files/dirs detected",
        3 => "Files copied + extra items",
        4..=7 => "Completed with minor mismatches",
        _ => "Copy error or access denied",
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_robocopy_exit_codes() {
        assert_eq!(decode_robocopy_exit(0), "No changes needed");
        assert_eq!(decode_robocopy_exit(1), "Files copied successfully");
        assert_eq!(decode_robocopy_exit(16), "Copy error or access denied");
    }
}
