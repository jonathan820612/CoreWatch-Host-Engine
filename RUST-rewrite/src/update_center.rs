use crate::{app_settings, dashboard_runtimes, secrets};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    os::windows::process::CommandExt,
    path::Path,
    process::Command,
    thread,
};

const IGNORED_FILE: &str = "ignored-updates.json";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WingetUpgrade {
    pub name: String,
    pub id: String,
    pub version: String,
    pub available: String,
    pub source: String,
    pub ignored: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScan {
    pub winget_available: bool,
    pub winget_error: Option<String>,
    pub upgrades: Vec<WingetUpgrade>,
    pub ignored_ids: Vec<String>,
    pub powershell: Option<dashboard_runtimes::PowerShellUpdate>,
    pub corewatch: Option<app_settings::ReleaseStatus>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateAction {
    UpgradePackage { id: String },
    UpgradeBatch { ids: Vec<String> },
    ToggleIgnore { id: String, ignored: bool },
    OpenWindowsUpdate,
}

fn load_ignored(dir: Option<&Path>) -> HashSet<String> {
    dir.map(|d| d.join(IGNORED_FILE))
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .collect()
}

fn save_ignored(dir: Option<&Path>, set: &HashSet<String>) -> Result<(), String> {
    let Some(base) = dir else {
        return Ok(());
    };
    let mut list: Vec<String> = set.iter().cloned().collect();
    list.sort();
    secrets::write_json_atomic(&base.join(IGNORED_FILE), &list);
    Ok(())
}

pub fn strip_ansi_and_progress(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for ch in chars.by_ref() {
                    if ch.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

pub fn parse_winget_table(stdout: &str, ignored: &HashSet<String>) -> Vec<WingetUpgrade> {
    let cleaned = strip_ansi_and_progress(stdout);
    // WinGet writes spinner frames separated by \r before the real header line; take the segment after the last \r on each line.
    let lines: Vec<&str> = cleaned
        .lines()
        .map(|l| l.rsplit('\r').next().unwrap_or(l))
        .collect();
    let Some(sep_idx) = lines
        .iter()
        .position(|l| l.trim().len() >= 10 && l.trim().chars().all(|c| c == '-'))
    else {
        return Vec::new();
    };
    let mut upgrades = Vec::new();
    for line in lines.iter().skip(sep_idx + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.ends_with("upgrades available.")
            || trimmed.contains("package(s) have version numbers")
            || trimmed.starts_with("The following packages")
        {
            continue;
        }
        let cols: Vec<&str> = split_columns(trimmed);
        if cols.len() >= 4 {
            let id = cols[1].to_owned();
            upgrades.push(WingetUpgrade {
                name: cols[0].to_owned(),
                ignored: ignored.contains(&id),
                id,
                version: cols[2].to_owned(),
                available: cols[3].to_owned(),
                source: cols.get(4).copied().unwrap_or("winget").to_owned(),
            });
        }
    }
    upgrades
}

fn split_columns(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b' ' {
            let mut j = i;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            if j - i >= 2 {
                let piece = line[start..i].trim();
                if !piece.is_empty() {
                    out.push(piece);
                }
                start = j;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    let tail = line[start..].trim();
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

pub fn scan(dir: Option<&Path>) -> UpdateScan {
    let ignored = load_ignored(dir);
    // Run WinGet upgrade scan, PowerShell 7 GitHub check, and CoreWatch release check in parallel!
    let ((winget_available, winget_error, upgrades), powershell, corewatch) = thread::scope(|s| {
        let h_wg = s.spawn(|| {
            match Command::new("winget.exe")
                .args([
                    "upgrade",
                    "--accept-source-agreements",
                    "--disable-interactivity",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
            {
                Ok(out) => {
                    let text = String::from_utf8_lossy(&out.stdout);
                    let list = parse_winget_table(&text, &ignored);
                    let err = if list.is_empty() && !out.status.success() {
                        let e = String::from_utf8_lossy(&out.stderr).trim().to_owned();
                        (!e.is_empty()).then_some(e)
                    } else {
                        None
                    };
                    (true, err, list)
                }
                Err(e) => (false, Some(format!("WinGet CLI unavailable: {e}")), Vec::new()),
            }
        });
        let h_ps = s.spawn(|| dashboard_runtimes::powershell_update().ok());
        let h_cw = s.spawn(|| app_settings::release_status().ok());
        (
            h_wg.join().unwrap_or((false, Some("WinGet worker failed".into()), Vec::new())),
            h_ps.join().ok().flatten(),
            h_cw.join().ok().flatten(),
        )
    });

    let mut ignored_ids: Vec<String> = ignored.into_iter().collect();
    ignored_ids.sort();

    UpdateScan {
        winget_available,
        winget_error,
        upgrades,
        ignored_ids,
        powershell,
        corewatch,
    }
}

fn valid_winget_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}

fn upgrade_one(clean: &str) -> Result<String, String> {
    if !valid_winget_id(clean) {
        return Err(format!("Invalid WinGet package identifier: {clean}"));
    }
    let out = Command::new("winget.exe")
        .args([
            "upgrade",
            "--id",
            clean,
            "--exact",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed launching winget: {e}"))?;
    if out.status.success() {
        Ok(format!("Upgraded {clean} via WinGet."))
    } else {
        Err(format!(
            "WinGet upgrade for {clean} returned {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stdout).trim()
        ))
    }
}

pub fn execute(dir: Option<&Path>, action: UpdateAction) -> Result<String, String> {
    match action {
        UpdateAction::UpgradePackage { id } => upgrade_one(id.trim()),
        UpdateAction::UpgradeBatch { ids } => {
            if ids.is_empty() {
                return Err("Select at least one package to upgrade.".into());
            }
            let mut ok = 0usize;
            let mut lines = Vec::new();
            for id in ids.iter().take(25) {
                let clean = id.trim();
                match upgrade_one(clean) {
                    Ok(_) => {
                        ok += 1;
                        lines.push(format!("[OK] Upgraded {clean}"));
                    }
                    Err(e) => lines.push(format!("[FAIL] {clean}: {e}")),
                }
            }
            Ok(format!(
                "Batch upgrade complete: {ok}/{} succeeded.\n{}",
                ids.len().min(25),
                lines.join("\n")
            ))
        }
        UpdateAction::ToggleIgnore { id, ignored } => {
            let mut set = load_ignored(dir);
            if ignored {
                set.insert(id.clone());
            } else {
                set.remove(&id);
            }
            save_ignored(dir, &set)?;
            Ok(if ignored {
                format!("Pinned/ignored updates for '{id}'.")
            } else {
                format!("Unpinned '{id}'.")
            })
        }
        UpdateAction::OpenWindowsUpdate => {
            crate::dashboard_actions::shell_open("ms-settings:windowsupdate", None, false)?;
            Ok("Opened Windows Update Settings.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_winget_upgrade_table_with_ansi_spinners() {
        let sample = "\
   - \r   \\ \rName                 Id                  Version  Available  Source
-------------------------------------------------------------------
\x1b[0mGit                  Git.Git             2.45.0   2.47.1     winget
Visual Studio Code   Microsoft.VSCode    1.92.0   1.96.2     winget
2 upgrades available.
";
        let mut ignored = HashSet::new();
        ignored.insert("Git.Git".into());
        let rows = parse_winget_table(sample, &ignored);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, "Git.Git");
        assert!(rows[0].ignored);
        assert_eq!(rows[1].available, "1.96.2");
        assert!(!rows[1].ignored);
    }
}
