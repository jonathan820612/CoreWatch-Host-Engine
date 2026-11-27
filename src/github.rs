use crate::{app_settings, dashboard_actions, secrets};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    thread,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepo {
    pub name: String,
    pub path: String,
    pub branch: String,
    pub remote_url: String,
    pub dirty_files: usize,
    pub ahead: usize,
    pub behind: usize,
    pub last_commit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubState {
    pub projects_root: String,
    pub git_available: bool,
    pub repos: Vec<LocalRepo>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GitHubAction {
    OpenEditor { path: String },
    OpenTerminal { path: String },
    OpenFolder { path: String },
    GitPull { path: String },
    PullAll,
    Clone { url: String },
    OpenRemote { url: String },
    FetchReleases { owner_repo: String },
}

pub fn read_git_head_branch(repo_dir: &Path) -> String {
    let head = fs::read_to_string(repo_dir.join(".git").join("HEAD")).unwrap_or_default();
    let trimmed = head.trim();
    if let Some(rest) = trimmed.strip_prefix("ref: refs/heads/") {
        rest.to_owned()
    } else {
        let short: String = trimmed.chars().take(7).collect();
        if short.chars().count() == 7 {
            format!("detached@{short}")
        } else {
            "unknown".into()
        }
    }
}

pub fn read_git_remote(repo_dir: &Path) -> String {
    let cfg = fs::read_to_string(repo_dir.join(".git").join("config")).unwrap_or_default();
    let mut in_origin = false;
    for line in cfg.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_origin = t.eq_ignore_ascii_case("[remote \"origin\"]");
            continue;
        }
        if in_origin
            && let Some((k, v)) = t.split_once('=')
            && k.trim().eq_ignore_ascii_case("url")
        {
            return v.trim().to_owned();
        }
    }
    String::new()
}

fn inspect_git_repo(repo_dir: &Path) -> (usize, usize, usize, String) {
    // Single fast `git status --porcelain=v1 -b` gives dirty count + ahead/behind!
    let mut dirty = 0usize;
    let mut ahead = 0usize;
    let mut behind = 0usize;
    if let Ok(out) = Command::new("git.exe")
        .args(["status", "--porcelain=v1", "-b"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(repo_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        && out.status.success()
    {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(hdr) = line.strip_prefix("## ") {
                if let Some(bracket) = hdr.find('[') {
                    let inside = &hdr[bracket + 1..].trim_end_matches(']');
                    for part in inside.split(',') {
                        let p = part.trim();
                        if let Some(n) = p.strip_prefix("ahead ") {
                            ahead = n.trim().parse().unwrap_or(0);
                        } else if let Some(n) = p.strip_prefix("behind ") {
                            behind = n.trim().parse().unwrap_or(0);
                        }
                    }
                }
            } else if !line.trim().is_empty() {
                dirty += 1;
            }
        }
    }
    let last_commit = Command::new("git.exe")
        .args(["log", "-1", "--format=%cr · %s"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(repo_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().chars().take(80).collect())
        .unwrap_or_default();
    (dirty, ahead, behind, last_commit)
}

fn discover_repo_dirs(projects_root: &str) -> Vec<PathBuf> {
    let root = Path::new(projects_root.trim());
    let mut candidates = Vec::new();
    if root.is_dir() {
        if root.join(".git").exists() {
            candidates.push(root.to_path_buf());
        }
        if let Ok(entries) = fs::read_dir(root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    if p.join(".git").exists() {
                        candidates.push(p);
                    } else if let Ok(sub) = fs::read_dir(&p) {
                        for child in sub.flatten().take(40) {
                            let cp = child.path();
                            if cp.is_dir() && cp.join(".git").exists() {
                                candidates.push(cp);
                            }
                        }
                    }
                }
            }
        }
    }
    candidates.truncate(60);
    candidates
}

pub fn scan_repos(projects_root: &str) -> GitHubState {
    let git_available = Command::new("git.exe")
        .arg("--version")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .is_ok_and(|o| o.status.success());

    let candidates = discover_repo_dirs(projects_root);
    // Parallelize per-repo git status & last commit inspection across worker pool!
    let queue = std::sync::Mutex::new(candidates);
    let out = std::sync::Mutex::new(Vec::new());
    let workers = thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    thread::scope(|s| {
        for _ in 0..workers {
            let q = &queue;
            let o = &out;
            s.spawn(move || {
                loop {
                    let next = q.lock().unwrap_or_else(|e| e.into_inner()).pop();
                    let Some(repo_dir) = next else { break };
                    let name = repo_dir
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("repo")
                        .to_owned();
                    let branch = read_git_head_branch(&repo_dir);
                    let remote_url = read_git_remote(&repo_dir);
                    let (dirty_files, ahead, behind, last_commit) = if git_available {
                        inspect_git_repo(&repo_dir)
                    } else {
                        (0, 0, 0, String::new())
                    };
                    o.lock().unwrap_or_else(|e| e.into_inner()).push(LocalRepo {
                        name,
                        path: repo_dir.to_string_lossy().into_owned(),
                        branch,
                        remote_url,
                        dirty_files,
                        ahead,
                        behind,
                        last_commit,
                    });
                }
            });
        }
    });
    let mut repos: Vec<LocalRepo> = out.into_inner().unwrap_or_else(|e| e.into_inner());

    repos.sort_by_key(|r| r.name.to_ascii_lowercase());
    GitHubState {
        projects_root: projects_root.to_owned(),
        git_available,
        repos,
    }
}

pub fn execute(
    action: GitHubAction,
    projects_root: &str,
    editor_path: &str,
) -> Result<String, String> {
    match action {
        GitHubAction::OpenFolder { path } => {
            let p = Path::new(path.trim());
            dashboard_actions::open_directory(p)?;
            Ok(format!("Opened {}", p.display()))
        }
        GitHubAction::OpenEditor { path } => {
            let p = Path::new(path.trim());
            if !p.is_dir() {
                return Err("Repository directory does not exist.".into());
            }
            let editor = (!editor_path.trim().is_empty())
                .then(|| PathBuf::from(editor_path.trim()))
                .filter(|e| e.is_file())
                .or_else(|| app_settings::detect_editor(app_settings::Editor::VsCode))
                .or_else(|| app_settings::detect_editor(app_settings::Editor::Cursor))
                .ok_or("No code editor configured or detected. Set Editor Path in Settings → Directories.")?;
            Command::new(&editor)
                .arg(p)
                .spawn()
                .map_err(|e| format!("Failed launching editor: {e}"))?;
            Ok(format!(
                "Opened {} in {}",
                p.display(),
                editor.file_name().unwrap_or_default().to_string_lossy()
            ))
        }
        GitHubAction::OpenTerminal { path } => {
            let p = Path::new(path.trim());
            if !p.is_dir() {
                return Err("Repository directory does not exist.".into());
            }
            if Command::new("wt.exe")
                .args(["-d", &p.to_string_lossy()])
                .spawn()
                .is_ok()
            {
                return Ok(format!("Opened Windows Terminal at {}", p.display()));
            }
            Command::new("cmd.exe")
                .args(["/C", "start", "cmd"])
                .current_dir(p)
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok(format!("Opened terminal at {}", p.display()))
        }
        GitHubAction::GitPull { path } => {
            let p = Path::new(path.trim());
            if !p.join(".git").exists() {
                return Err("Target folder is not a Git repository.".into());
            }
            let out = Command::new("git.exe")
                .args(["pull", "--ff-only"])
                .env("GIT_TERMINAL_PROMPT", "0")
                .current_dir(p)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("git pull failed: {e}"))?;
            let msg = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout).trim(),
                String::from_utf8_lossy(&out.stderr).trim()
            )
            .trim()
            .to_owned();
            if out.status.success() {
                Ok(if msg.is_empty() {
                    "Already up to date.".into()
                } else {
                    msg
                })
            } else {
                Err(msg)
            }
        }
        GitHubAction::PullAll => {
            let dirs = discover_repo_dirs(projects_root);
            if dirs.is_empty() {
                return Err("No Git repositories found in Projects root.".into());
            }
            let results: Vec<(String, bool, String)> = thread::scope(|s| {
                let handles: Vec<_> = dirs
                    .into_iter()
                    .map(|p| {
                        s.spawn(move || {
                            let name = p
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("repo")
                                .to_owned();
                            let out = Command::new("git.exe")
                                .args(["pull", "--ff-only"])
                                .env("GIT_TERMINAL_PROMPT", "0")
                                .current_dir(&p)
                                .creation_flags(CREATE_NO_WINDOW)
                                .output();
                            match out {
                                Ok(o) if o.status.success() => (
                                    name,
                                    true,
                                    String::from_utf8_lossy(&o.stdout)
                                        .lines()
                                        .next()
                                        .unwrap_or("OK")
                                        .trim()
                                        .to_owned(),
                                ),
                                Ok(o) => (
                                    name,
                                    false,
                                    String::from_utf8_lossy(&o.stderr)
                                        .lines()
                                        .next()
                                        .unwrap_or("Failed")
                                        .trim()
                                        .to_owned(),
                                ),
                                Err(e) => (name, false, e.to_string()),
                            }
                        })
                    })
                    .collect();
                handles.into_iter().filter_map(|h| h.join().ok()).collect()
            });
            let ok_cnt = results.iter().filter(|r| r.1).count();
            let lines: Vec<String> = results
                .iter()
                .map(|(n, ok, m)| format!("[{}] {n}: {m}", if *ok { "OK" } else { "SKIP" }))
                .collect();
            Ok(format!(
                "Pull All: {ok_cnt}/{} repositories updated.\n{}",
                results.len(),
                lines.join("\n")
            ))
        }
        GitHubAction::Clone { url } => {
            let clean = url.trim();
            if !(clean.starts_with("https://") || clean.starts_with("git@")) || clean.contains(' ')
            {
                return Err("Enter a valid HTTPS or SSH Git repository URL.".into());
            }
            let root = Path::new(projects_root.trim());
            fs::create_dir_all(root).map_err(|e| e.to_string())?;
            let out = Command::new("git.exe")
                .args(["clone", clean])
                .env("GIT_TERMINAL_PROMPT", "0")
                .current_dir(root)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("git clone failed: {e}"))?;
            if out.status.success() {
                Ok(format!("Cloned {clean} into {}", root.display()))
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
            }
        }
        GitHubAction::OpenRemote { url } => {
            let clean = url.trim();
            let web_url = if let Some(rest) = clean.strip_prefix("git@github.com:") {
                format!("https://github.com/{}", rest.trim_end_matches(".git"))
            } else if clean.starts_with("https://") {
                clean.trim_end_matches(".git").to_owned()
            } else {
                return Err("Remote URL is not a supported HTTPS/GitHub URL.".into());
            };
            dashboard_actions::shell_open(&web_url, None, false)?;
            Ok(format!("Opened {web_url}"))
        }
        GitHubAction::FetchReleases { owner_repo } => {
            let slug = owner_repo.trim().trim_matches('/');
            let valid = slug.split('/').count() == 2
                && slug
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'));
            if !valid {
                return Err(
                    "Enter repository as owner/repo (e.g. jonathan820612/CoreWatch-Host-Engine)."
                        .into(),
                );
            }
            let url = format!("https://api.github.com/repos/{slug}/releases?per_page=8");
            let resp = secrets::http_request(
                "GET",
                &url,
                &[("Accept", "application/vnd.github+json")],
                None,
                15_000,
                false,
                512 * 1024,
            )?;
            if resp.status >= 400 {
                return Err(format!("GitHub API returned HTTP {}.", resp.status));
            }
            #[derive(Deserialize)]
            struct Rel {
                tag_name: String,
                name: Option<String>,
                published_at: Option<String>,
                prerelease: bool,
            }
            let list: Vec<Rel> = serde_json::from_slice(&resp.body).map_err(|e| e.to_string())?;
            if list.is_empty() {
                return Ok(format!("No published releases found for {slug}."));
            }
            let lines: Vec<String> = list
                .into_iter()
                .map(|r| {
                    format!(
                        "{}  {}  [{}]{}",
                        r.tag_name,
                        r.name.unwrap_or_default(),
                        r.published_at.unwrap_or_default().get(..10).unwrap_or(""),
                        if r.prerelease { " (pre-release)" } else { "" }
                    )
                })
                .collect();
            Ok(lines.join("\n"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_git_head_and_origin_remote_from_repo_files() {
        let dir = tempfile::tempdir().unwrap();
        let git = dir.path().join(".git");
        fs::create_dir_all(&git).unwrap();
        fs::write(git.join("HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(
            git.join("config"),
            "[remote \"origin\"]\n\turl = https://github.com/jonathan820612/CoreWatch-Host-Engine.git\n",
        )
        .unwrap();
        assert_eq!(read_git_head_branch(dir.path()), "main");
        assert!(read_git_remote(dir.path()).contains("CoreWatch-Host-Engine"));
    }
}
