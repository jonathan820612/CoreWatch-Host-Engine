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
    let header_offsets = sep_idx
        .checked_sub(1)
        .and_then(|idx| lines.get(idx))
        .and_then(|hdr| detect_header_offsets(hdr));

    let mut upgrades = Vec::new();
    for line in lines.iter().skip(sep_idx + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || (trimmed.len() >= 10 && trimmed.chars().all(|c| c == '-'))
            || trimmed.ends_with("upgrades available.")
            || trimmed.ends_with("upgrade available.")
            || trimmed.contains("package(s) have version numbers")
            || trimmed.contains("package(s) have pins")
            || trimmed.starts_with("The following packages")
        {
            continue;
        }
        let cols: Vec<String> = split_columns(line, header_offsets.as_deref());
        if cols.len() >= 4 {
            if cols[0].eq_ignore_ascii_case("Name") && cols[1].eq_ignore_ascii_case("Id") {
                continue;
            }
            let id = cols[1].clone();
            if !valid_winget_id(&id) {
                continue;
            }
            upgrades.push(WingetUpgrade {
                name: cols[0].clone(),
                ignored: ignored.contains(&id),
                id,
                version: cols[2].clone(),
                available: cols[3].clone(),
                source: cols.get(4).cloned().unwrap_or_else(|| "winget".to_owned()),
            });
        }
    }
    upgrades
}

fn detect_header_offsets(header: &str) -> Option<Vec<usize>> {
    let chars: Vec<char> = header.chars().collect();
    let mut starts = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i] == ' ' {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        starts.push(i);
        while i < chars.len() && chars[i] != ' ' {
            i += 1;
        }
    }
    (starts.len() >= 4).then_some(starts)
}

fn split_columns(line: &str, offsets: Option<&[usize]>) -> Vec<String> {
    let trimmed = line.trim();
    let mut out = Vec::new();
    let bytes = trimmed.as_bytes();
    let mut start = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b' ' {
            let mut j = i;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            if j - i >= 2 {
                let piece = trimmed[start..i].trim();
                if !piece.is_empty() {
                    out.push(piece.to_owned());
                }
                start = j;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    let tail = trimmed[start..].trim();
    if !tail.is_empty() {
        out.push(tail.to_owned());
    }
    let expected_cols = offsets.map_or(4, |c| c.len().max(4));
    if out.len() >= expected_cols {
        return out;
    }
    // Fallback when a truncated `…` Name (or Id) leaves only 1 space before the next column.
    if let Some(cols) = offsets {
        let chars: Vec<char> = line.chars().collect();
        if chars.len() > cols[3] {
            let mut sliced = Vec::with_capacity(cols.len());
            for (idx, &begin) in cols.iter().enumerate() {
                let end = cols.get(idx + 1).copied().unwrap_or(chars.len()).min(chars.len());
                if begin < end {
                    let s: String = chars[begin..end].iter().collect();
                    let t = s.trim();
                    if !t.is_empty() {
                        sliced.push(t.to_owned());
                    }
                }
            }
            if sliced.len() >= 4 {
                return sliced;
            }
        }
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
                        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_owned();
                        let fallback = if stderr.is_empty() {
                            String::from_utf8_lossy(&out.stdout).trim().to_owned()
                        } else {
                            stderr
                        };
                        (!fallback.is_empty()).then_some(fallback)
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

The following packages have an upgrade available, but require explicit targeting for upgrade:
Name                 Id                  Version  Available  Source
-------------------------------------------------------------------
Long Truncated Name… Foo.Bar.Pkg         1.0.0    1.1.0      winget
";
        let mut ignored = HashSet::new();
        ignored.insert("Git.Git".into());
        let rows = parse_winget_table(sample, &ignored);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, "Git.Git");
        assert!(rows[0].ignored);
        assert_eq!(rows[1].available, "1.96.2");
        assert!(!rows[1].ignored);
        assert_eq!(rows[2].id, "Foo.Bar.Pkg");
    }
}
