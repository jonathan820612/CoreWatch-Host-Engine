use crate::{dashboard_actions, secrets};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

const RULES_FILE: &str = "organizer-rules.json";
const UNDO_FILE: &str = "organizer-undo.json";
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerRule {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub extensions: Vec<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedMove {
    pub file_name: String,
    pub rule_name: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownFolder {
    pub label: String,
    pub path: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerState {
    pub rules: Vec<OrganizerRule>,
    pub can_undo: bool,
    pub last_undo_count: usize,
    pub known_folders: Vec<KnownFolder>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OrganizerAction {
    SaveRule { rule: OrganizerRule },
    ToggleRule { id: String, enabled: bool },
    DeleteRule { id: String },
    ResetDefaults,
    Preview {
        source: String,
        dest: String,
        #[serde(default)]
        recursive: bool,
    },
    Apply {
        source: String,
        dest: String,
        #[serde(default)]
        recursive: bool,
        #[serde(default)]
        skip_duplicates: bool,
    },
    UndoLast,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizerResult {
    pub state: OrganizerState,
    pub moves: Vec<PlannedMove>,
    pub message: String,
}

pub fn default_rules() -> Vec<OrganizerRule> {
    let mk = |id: &str, name: &str, folder: &str, exts: &[&str]| OrganizerRule {
        id: id.into(),
        name: name.into(),
        folder: folder.into(),
        extensions: exts.iter().map(|s| (*s).to_owned()).collect(),
        enabled: true,
    };
    vec![
        mk("images", "Images", "Images", &["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "heic"]),
        mk("docs", "Documents", "Documents", &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv"]),
        mk("videos", "Videos", "Videos", &["mp4", "mkv", "mov", "avi", "webm", "wmv"]),
        mk("audio", "Audio", "Audio", &["mp3", "wav", "flac", "ogg", "m4a", "aac"]),
        mk("archives", "Archives", "Archives", &["zip", "7z", "rar", "tar", "gz", "xz"]),
        mk("installers", "Installers", "Installers", &["exe", "msi", "msix", "msixbundle", "iso"]),
        mk("code", "Code & Config", "Code", &["rs", "ps1", "py", "js", "ts", "json", "toml", "yaml", "yml", "html", "css"]),
    ]
}

fn detect_known_folders() -> Vec<KnownFolder> {
    let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for name in ["Downloads", "Desktop", "Documents", "Pictures", "Videos", "Music"] {
        let p = profile.join(name);
        if p.is_dir() {
            let count = fs::read_dir(&p)
                .ok()
                .map(|rd| {
                    rd.flatten()
                        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
                        .count()
                })
                .unwrap_or(0);
            out.push(KnownFolder {
                label: name.to_owned(),
                path: p.to_string_lossy().into_owned(),
                file_count: count,
            });
        }
    }
    out
}

pub struct OrganizerManager {
    dir: Option<PathBuf>,
    rules: Mutex<Vec<OrganizerRule>>,
    undo: Mutex<Vec<PlannedMove>>,
}

impl OrganizerManager {
    pub fn open(dir: Option<&Path>) -> Self {
        let dir_buf = dir.map(Path::to_path_buf);
        let rules = dir_buf
            .as_ref()
            .and_then(|d| fs::read_to_string(d.join(RULES_FILE)).ok())
            .and_then(|raw| serde_json::from_str::<Vec<OrganizerRule>>(&raw).ok())
            .unwrap_or_else(default_rules);
        let undo = dir_buf
            .as_ref()
            .and_then(|d| fs::read_to_string(d.join(UNDO_FILE)).ok())
            .and_then(|raw| serde_json::from_str::<Vec<PlannedMove>>(&raw).ok())
            .unwrap_or_default();
        Self {
            dir: dir_buf,
            rules: Mutex::new(rules),
            undo: Mutex::new(undo),
        }
    }

    pub fn snapshot(&self) -> OrganizerState {
        let rules = self.rules.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let undo_len = self.undo.lock().unwrap_or_else(|e| e.into_inner()).len();
        OrganizerState {
            rules,
            can_undo: undo_len > 0,
            last_undo_count: undo_len,
            known_folders: detect_known_folders(),
        }
    }

    fn persist_rules(&self, rules: &[OrganizerRule]) {
        if let Some(d) = &self.dir {
            secrets::write_json_atomic(&d.join(RULES_FILE), rules);
        }
    }

    fn persist_undo(&self, moves: &[PlannedMove]) {
        if let Some(d) = &self.dir {
            secrets::write_json_atomic(&d.join(UNDO_FILE), moves);
        }
    }

    pub fn execute(&self, action: OrganizerAction) -> Result<OrganizerResult, String> {
        match action {
            OrganizerAction::SaveRule { mut rule } => {
                if rule.name.trim().is_empty() || rule.folder.trim().is_empty() {
                    return Err("Rule name and destination subfolder are required.".into());
                }
                rule.name = rule.name.trim().to_owned();
                rule.folder = sanitize_folder_name(&rule.folder);
                if rule.folder.is_empty() {
                    return Err("Destination subfolder name is invalid.".into());
                }
                rule.extensions = rule
                    .extensions
                    .into_iter()
                    .map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase())
                    .filter(|e| !e.is_empty())
                    .collect();
                if rule.extensions.is_empty() {
                    return Err("Provide at least one file extension (e.g. pdf, docx).".into());
                }
                if rule.id.trim().is_empty() {
                    rule.id = format!("rule-{}", now_ms());
                }
                let updated = {
                    let mut guard = self.rules.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(existing) = guard.iter_mut().find(|r| r.id == rule.id) {
                        *existing = rule.clone();
                    } else {
                        guard.push(rule.clone());
                    }
                    guard.clone()
                };
                self.persist_rules(&updated);
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves: Vec::new(),
                    message: format!("Saved rule '{}'.", rule.name),
                })
            }
            OrganizerAction::ToggleRule { id, enabled } => {
                let updated = {
                    let mut guard = self.rules.lock().unwrap_or_else(|e| e.into_inner());
                    let r = guard
                        .iter_mut()
                        .find(|r| r.id == id)
                        .ok_or("Rule not found.")?;
                    r.enabled = enabled;
                    guard.clone()
                };
                self.persist_rules(&updated);
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves: Vec::new(),
                    message: if enabled { "Enabled rule." } else { "Disabled rule." }.into(),
                })
            }
            OrganizerAction::DeleteRule { id } => {
                let updated = {
                    let mut guard = self.rules.lock().unwrap_or_else(|e| e.into_inner());
                    guard.retain(|r| r.id != id);
                    guard.clone()
                };
                self.persist_rules(&updated);
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves: Vec::new(),
                    message: "Deleted rule.".into(),
                })
            }
            OrganizerAction::ResetDefaults => {
                let defaults = default_rules();
                *self.rules.lock().unwrap_or_else(|e| e.into_inner()) = defaults.clone();
                self.persist_rules(&defaults);
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves: Vec::new(),
                    message: "Restored default file organizer rules.".into(),
                })
            }
            OrganizerAction::Preview {
                source,
                dest,
                recursive,
            } => {
                let rules = self.rules.lock().unwrap_or_else(|e| e.into_inner()).clone();
                let moves = plan_moves(Path::new(source.trim()), Path::new(dest.trim()), &rules, recursive)?;
                let total_mb = moves.iter().map(|m| m.bytes).sum::<u64>() as f64 / (1024.0 * 1024.0);
                let msg = format!(
                    "Dry-run preview: {} file(s) ({total_mb:.1} MiB) matched enabled rules.",
                    moves.len()
                );
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves,
                    message: msg,
                })
            }
            OrganizerAction::Apply {
                source,
                dest,
                recursive,
                skip_duplicates,
            } => {
                let rules = self.rules.lock().unwrap_or_else(|e| e.into_inner()).clone();
                let planned = plan_moves(Path::new(source.trim()), Path::new(dest.trim()), &rules, recursive)?;
                let mut completed = Vec::new();
                let mut skipped_dups = 0usize;
                let mut skipped_locked = 0usize;
                for item in planned {
                    let from = Path::new(&item.from);
                    let raw_to = Path::new(&item.to);
                    if skip_duplicates && raw_to.exists() {
                        skipped_dups += 1;
                        continue;
                    }
                    let to = unique_destination(raw_to);
                    if let Some(parent) = to.parent()
                        && fs::create_dir_all(parent).is_err()
                    {
                        skipped_locked += 1;
                        continue;
                    }
                    if move_file_safe(from, &to).is_err() {
                        skipped_locked += 1;
                        continue;
                    }
                    completed.push(PlannedMove {
                        file_name: item.file_name,
                        rule_name: item.rule_name,
                        from: item.from,
                        to: to.to_string_lossy().into_owned(),
                        bytes: item.bytes,
                    });
                }
                if !completed.is_empty() {
                    let mut undo_guard = self.undo.lock().unwrap_or_else(|e| e.into_inner());
                    *undo_guard = completed.clone();
                    drop(undo_guard);
                    self.persist_undo(&completed);
                }
                let mut extras = Vec::new();
                if skipped_dups > 0 {
                    extras.push(format!("{skipped_dups} duplicate(s) skipped"));
                }
                if skipped_locked > 0 {
                    extras.push(format!("{skipped_locked} locked/in-use skipped"));
                }
                let suffix = if extras.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", extras.join(", "))
                };
                let msg = format!(
                    "Organized {} file(s){suffix}. 1-click Undo is available.",
                    completed.len()
                );
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves: completed,
                    message: msg,
                })
            }
            OrganizerAction::UndoLast => {
                let pending_undo = self.undo.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if pending_undo.is_empty() {
                    return Err("Nothing to undo.".into());
                }
                let mut restored = 0usize;
                let mut touched_dirs: HashSet<PathBuf> = HashSet::new();
                for item in pending_undo.iter().rev() {
                    let cur = Path::new(&item.to);
                    let orig = Path::new(&item.from);
                    if cur.is_file() {
                        if let Some(parent) = cur.parent() {
                            touched_dirs.insert(parent.to_path_buf());
                        }
                        if let Some(parent) = orig.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        if move_file_safe(cur, orig).is_ok() {
                            restored += 1;
                        }
                    }
                }
                // Clean up now-empty category folders created during organize
                for dir in touched_dirs {
                    let _ = fs::remove_dir(&dir); // succeeds only if completely empty
                }
                {
                    let mut undo_guard = self.undo.lock().unwrap_or_else(|e| e.into_inner());
                    undo_guard.clear();
                }
                self.persist_undo(&[]);
                Ok(OrganizerResult {
                    state: self.snapshot(),
                    moves: Vec::new(),
                    message: format!("Undid last run: restored {restored} file(s)."),
                })
            }
        }
    }
}

fn sanitize_folder_name(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        .collect::<String>()
        .trim()
        .to_owned()
}

fn should_skip_file(path: &Path, meta: &fs::Metadata) -> bool {
    let attrs = meta.file_attributes();
    if (attrs & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) != 0 {
        return true;
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(name.as_str(), "desktop.ini" | "thumbs.db" | "ntuser.dat") {
        return true;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(ext.as_str(), "lnk" | "tmp" | "crdownload" | "part" | "partial" | "download")
}

fn plan_moves(
    source: &Path,
    dest: &Path,
    rules: &[OrganizerRule],
    recursive: bool,
) -> Result<Vec<PlannedMove>, String> {
    if !source.is_dir() {
        return Err(format!("Source folder does not exist: {}", source.display()));
    }
    if dashboard_actions::is_protected_system_path(source) {
        return Err("Refusing to organize a protected Windows system or profile root directory.".into());
    }
    let dest_root = if dest.as_os_str().is_empty() {
        source
    } else {
        dest
    };
    let rule_folders: HashSet<String> = rules
        .iter()
        .map(|r| dest_root.join(&r.folder).to_string_lossy().to_ascii_lowercase())
        .collect();

    let mut moves = Vec::new();
    let mut stack = vec![source.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = fs::symlink_metadata(&path) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if recursive {
                    let low = path.to_string_lossy().to_ascii_lowercase();
                    if !rule_folders.contains(&low)
                        && (meta.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) == 0
                    {
                        stack.push(path);
                    }
                }
                continue;
            }
            if !meta.is_file() || should_skip_file(&path, &meta) {
                continue;
            }
            let Some(ext) = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
            else {
                continue;
            };
            if let Some(rule) = rules
                .iter()
                .find(|r| r.enabled && r.extensions.iter().any(|x| x == &ext))
            {
                let file_name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_owned();
                let target = dest_root.join(&rule.folder).join(&file_name);
                if target == path {
                    continue;
                }
                moves.push(PlannedMove {
                    file_name,
                    rule_name: rule.name.clone(),
                    from: path.to_string_lossy().into_owned(),
                    to: target.to_string_lossy().into_owned(),
                    bytes: meta.len(),
                });
            }
        }
    }
    moves.sort_by_key(|m| m.file_name.to_ascii_lowercase());
    Ok(moves)
}

fn unique_destination(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|s| s.to_str());
    let parent = path.parent().unwrap_or(Path::new("."));
    for n in 1..10_000 {
        let candidate = match ext {
            Some(e) => parent.join(format!("{stem} ({n}).{e}")),
            None => parent.join(format!("{stem} ({n})")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

fn move_file_safe(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map_err(|e| format!("Copy failed for {}: {e}", from.display()))?;
    fs::remove_file(from).map_err(|e| format!("Cleanup failed for {}: {e}", from.display()))
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
    fn previews_applies_and_undoes_file_sorting() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("inbox");
        let dst = dir.path().join("sorted");
        fs::create_dir_all(&src).unwrap();
        let img = src.join("photo.png");
        let doc = src.join("notes.pdf");
        let partial = src.join("movie.mp4.crdownload");
        fs::write(&img, b"png").unwrap();
        fs::write(&doc, b"pdf").unwrap();
        fs::write(&partial, b"partial").unwrap();

        let mgr = OrganizerManager::open(Some(dir.path()));
        let preview = mgr
            .execute(OrganizerAction::Preview {
                source: src.to_string_lossy().into_owned(),
                dest: dst.to_string_lossy().into_owned(),
                recursive: false,
            })
            .unwrap();
        assert_eq!(preview.moves.len(), 2);
        assert!(img.exists());

        let applied = mgr
            .execute(OrganizerAction::Apply {
                source: src.to_string_lossy().into_owned(),
                dest: dst.to_string_lossy().into_owned(),
                recursive: false,
                skip_duplicates: false,
            })
            .unwrap();
        assert_eq!(applied.moves.len(), 2);
        assert!(dst.join("Images").join("photo.png").exists());
        assert!(dst.join("Documents").join("notes.pdf").exists());
        assert!(partial.exists());
        assert!(applied.state.can_undo);

        let undone = mgr.execute(OrganizerAction::UndoLast).unwrap();
        assert!(!undone.state.can_undo);
        assert!(img.exists());
        assert!(doc.exists());
        assert!(!dst.join("Images").exists());
    }

    #[test]
    fn blocks_protected_windows_roots() {
        let mgr = OrganizerManager::open(None);
        assert!(
            mgr.execute(OrganizerAction::Preview {
                source: r"C:\Windows".into(),
                dest: String::new(),
                recursive: false,
            })
            .is_err()
        );
    }
}
