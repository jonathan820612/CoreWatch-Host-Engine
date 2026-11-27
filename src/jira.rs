use crate::{dashboard_actions, secrets};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

const JIRA_FILE: &str = "jira-config.json";
const DEFAULT_JQL: &str = "assignee = currentUser() ORDER BY updated DESC";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    /// Stored DPAPI-encrypted on disk (`dpapi:<base64>`), decrypted in memory when loaded.
    pub api_token: String,
    pub jql: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraPublicConfig {
    pub base_url: String,
    pub email: String,
    pub has_token: bool,
    pub jql: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    pub priority: String,
    pub issue_type: String,
    pub assignee: String,
    pub updated: String,
    pub browse_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraTransition {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraComment {
    pub author: String,
    pub created: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueDetail {
    pub key: String,
    pub summary: String,
    pub description: String,
    pub status: String,
    pub priority: String,
    pub assignee: String,
    pub reporter: String,
    pub labels: Vec<String>,
    pub transitions: Vec<JiraTransition>,
    pub comments: Vec<JiraComment>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JiraAction {
    SaveConfig {
        base_url: String,
        email: String,
        api_token: String,
        jql: String,
    },
    ClearConfig,
    FetchIssues {
        jql: Option<String>,
    },
    GetIssueDetail {
        key: String,
    },
    TransitionIssue {
        key: String,
        transition_id: String,
    },
    AddComment {
        key: String,
        body: String,
    },
    OpenIssue {
        key: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraResponse {
    pub config: JiraPublicConfig,
    pub issues: Vec<JiraIssue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<JiraIssueDetail>,
    pub message: String,
}

pub struct JiraManager {
    file: Option<PathBuf>,
    config: Mutex<JiraConfig>,
}

impl JiraManager {
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.map(|d| d.join(JIRA_FILE));
        let mut needs_migration = false;
        let mut config = file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<JiraConfig>(&raw).ok())
            .unwrap_or_default();
        if !config.api_token.is_empty() {
            if !config.api_token.starts_with("dpapi:") {
                needs_migration = true;
            }
            config.api_token = secrets::unprotect_secret(&config.api_token).unwrap_or_default();
        }
        if config.jql.trim().is_empty() {
            config.jql = DEFAULT_JQL.into();
        }
        let mgr = Self {
            file,
            config: Mutex::new(config.clone()),
        };
        if needs_migration && !config.api_token.is_empty() {
            mgr.persist(&config);
        }
        mgr
    }

    fn lock_cfg(&self) -> std::sync::MutexGuard<'_, JiraConfig> {
        self.config.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn public_config(&self) -> JiraPublicConfig {
        let cfg = self.lock_cfg();
        JiraPublicConfig {
            base_url: cfg.base_url.clone(),
            email: cfg.email.clone(),
            has_token: !cfg.api_token.is_empty(),
            jql: cfg.jql.clone(),
        }
    }

    fn persist(&self, cfg: &JiraConfig) {
        let Some(path) = &self.file else {
            return;
        };
        let mut disk_cfg = cfg.clone();
        if !disk_cfg.api_token.is_empty() {
            match secrets::protect_secret(&disk_cfg.api_token) {
                Ok(enc) => disk_cfg.api_token = enc,
                Err(_) => return, // Never fall back to writing plaintext secrets to disk.
            }
        }
        secrets::write_json_atomic(path, &disk_cfg);
    }

    pub fn execute(&self, action: JiraAction) -> Result<JiraResponse, String> {
        match action {
            JiraAction::SaveConfig {
                base_url,
                email,
                api_token,
                jql,
            } => {
                let clean_url = base_url.trim().trim_end_matches('/').to_owned();
                if !clean_url.starts_with("https://") {
                    return Err("Jira Base URL must start with https:// (e.g. https://yourteam.atlassian.net).".into());
                }
                let updated = {
                    let mut guard = self.lock_cfg();
                    guard.base_url = clean_url;
                    guard.email = email.trim().to_owned();
                    if !api_token.trim().is_empty() {
                        guard.api_token = api_token.trim().to_owned();
                    }
                    guard.jql = if jql.trim().is_empty() {
                        DEFAULT_JQL.into()
                    } else {
                        jql.trim().to_owned()
                    };
                    guard.clone()
                };
                self.persist(&updated);
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues: Vec::new(),
                    detail: None,
                    message: "Saved Jira connection settings (API token encrypted with Windows DPAPI).".into(),
                })
            }
            JiraAction::ClearConfig => {
                let empty = JiraConfig {
                    jql: DEFAULT_JQL.into(),
                    ..JiraConfig::default()
                };
                *self.lock_cfg() = empty.clone();
                self.persist(&empty);
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues: Vec::new(),
                    detail: None,
                    message: "Cleared Jira credentials.".into(),
                })
            }
            JiraAction::OpenIssue { key } => {
                let cfg = self.lock_cfg().clone();
                if cfg.base_url.is_empty() {
                    return Err("Configure your Jira Base URL first.".into());
                }
                let clean = validate_issue_key(&key)?;
                let url = format!("{}/browse/{clean}", cfg.base_url);
                dashboard_actions::shell_open(&url, None, false)?;
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues: Vec::new(),
                    detail: None,
                    message: format!("Opened {clean} in browser."),
                })
            }
            JiraAction::FetchIssues { jql } => {
                let cfg = self.lock_cfg().clone();
                if cfg.base_url.is_empty() || cfg.api_token.is_empty() {
                    return Err("Configure your Jira Base URL, Email, and API Token first.".into());
                }
                let query = jql
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&cfg.jql);
                let issues = fetch_issues_http(&cfg, query)?;
                let count = issues.len();
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues,
                    detail: None,
                    message: format!("Loaded {count} Jira issue(s)."),
                })
            }
            JiraAction::GetIssueDetail { key } => {
                let cfg = self.lock_cfg().clone();
                if cfg.base_url.is_empty() || cfg.api_token.is_empty() {
                    return Err("Configure Jira credentials first.".into());
                }
                let clean = validate_issue_key(&key)?;
                let detail = fetch_issue_detail_http(&cfg, clean)?;
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues: Vec::new(),
                    detail: Some(detail),
                    message: format!("Loaded details for {clean}."),
                })
            }
            JiraAction::TransitionIssue { key, transition_id } => {
                let cfg = self.lock_cfg().clone();
                if cfg.base_url.is_empty() || cfg.api_token.is_empty() {
                    return Err("Configure Jira credentials first.".into());
                }
                let clean = validate_issue_key(&key)?;
                let tid = transition_id.trim();
                if tid.is_empty() || !tid.chars().all(|c| c.is_ascii_digit()) {
                    return Err("Invalid Jira transition ID.".into());
                }
                let url = format!("{}/rest/api/2/issue/{clean}/transitions", cfg.base_url);
                let payload = serde_json::json!({ "transition": { "id": tid } }).to_string();
                jira_post_json(&cfg, &url, &payload)?;
                let detail = fetch_issue_detail_http(&cfg, clean).ok();
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues: Vec::new(),
                    detail,
                    message: format!("Updated workflow status on {clean}."),
                })
            }
            JiraAction::AddComment { key, body } => {
                let cfg = self.lock_cfg().clone();
                if cfg.base_url.is_empty() || cfg.api_token.is_empty() {
                    return Err("Configure Jira credentials first.".into());
                }
                let clean_key = validate_issue_key(&key)?;
                let clean_body = body.trim();
                if clean_body.is_empty() {
                    return Err("Comment text is required.".into());
                }
                let url = format!("{}/rest/api/2/issue/{clean_key}/comment", cfg.base_url);
                let payload = serde_json::json!({ "body": clean_body }).to_string();
                jira_post_json(&cfg, &url, &payload)?;
                Ok(JiraResponse {
                    config: self.public_config(),
                    issues: Vec::new(),
                    detail: None,
                    message: format!("Added comment to {clean_key}."),
                })
            }
        }
    }
}

fn validate_issue_key(key: &str) -> Result<&str, String> {
    let clean = key.trim();
    if clean.is_empty() || !clean.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid Jira issue key.".into());
    }
    Ok(clean)
}

fn auth_header(cfg: &JiraConfig) -> String {
    if cfg.email.is_empty() {
        format!("Bearer {}", cfg.api_token)
    } else {
        let pair = format!("{}:{}", cfg.email, cfg.api_token);
        format!("Basic {}", secrets::base64_encode(pair.as_bytes()))
    }
}

fn jira_post_json(cfg: &JiraConfig, url: &str, body: &str) -> Result<Vec<u8>, String> {
    let auth = auth_header(cfg);
    let resp = secrets::http_request(
        "POST",
        url,
        &[
            ("Authorization", auth.as_str()),
            ("Content-Type", "application/json"),
            ("Accept", "application/json"),
        ],
        Some(body.as_bytes()),
        12_000,
        false,
        4 * 1024 * 1024,
    )?;
    if !(200..300).contains(&resp.status) {
        let detail = String::from_utf8_lossy(&resp.body);
        let brief = detail.trim().chars().take(240).collect::<String>();
        return Err(format!("Jira HTTP {}: {}", resp.status, brief));
    }
    Ok(resp.body)
}

fn jira_get_json(cfg: &JiraConfig, url: &str) -> Result<Vec<u8>, String> {
    let auth = auth_header(cfg);
    let resp = secrets::http_request(
        "GET",
        url,
        &[("Authorization", auth.as_str()), ("Accept", "application/json")],
        None,
        12_000,
        false,
        4 * 1024 * 1024,
    )?;
    if !(200..300).contains(&resp.status) {
        return Err(format!("Jira HTTP {}", resp.status));
    }
    Ok(resp.body)
}

fn fetch_issues_http(cfg: &JiraConfig, jql: &str) -> Result<Vec<JiraIssue>, String> {
    let url = format!("{}/rest/api/3/search/jql", cfg.base_url);
    let body = serde_json::json!({
        "jql": jql,
        "maxResults": 50,
        "fields": ["summary", "status", "priority", "issuetype", "assignee", "updated"]
    })
    .to_string();
    let bytes = match jira_post_json(cfg, &url, &body) {
        Ok(b) => b,
        Err(_) => {
            let fallback_url = format!("{}/rest/api/2/search", cfg.base_url);
            jira_post_json(cfg, &fallback_url, &body)?
        }
    };

    let val: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = val.get("issues").and_then(|v| v.as_array()) {
        for item in arr {
            let key = item
                .get("key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let fields = item.get("fields");
            let summary = fields
                .and_then(|f| f.get("summary"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_owned();
            let status = fields
                .and_then(|f| f.get("status"))
                .and_then(|s| s.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Open")
                .to_owned();
            let priority = fields
                .and_then(|f| f.get("priority"))
                .and_then(|p| p.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("—")
                .to_owned();
            let issue_type = fields
                .and_then(|f| f.get("issuetype"))
                .and_then(|t| t.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Task")
                .to_owned();
            let assignee = fields
                .and_then(|f| f.get("assignee"))
                .and_then(|a| a.get("displayName"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unassigned")
                .to_owned();
            let updated = fields
                .and_then(|f| f.get("updated"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.get(..10))
                .unwrap_or("")
                .to_owned();
            if !key.is_empty() {
                let browse_url = format!("{}/browse/{key}", cfg.base_url);
                out.push(JiraIssue {
                    key,
                    summary,
                    status,
                    priority,
                    issue_type,
                    assignee,
                    updated,
                    browse_url,
                });
            }
        }
    }
    Ok(out)
}

fn fetch_issue_detail_http(cfg: &JiraConfig, key: &str) -> Result<JiraIssueDetail, String> {
    let url = format!("{}/rest/api/2/issue/{key}?expand=transitions", cfg.base_url);
    let bytes = jira_get_json(cfg, &url)?;
    let val: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let fields = val.get("fields");
    let str_field = |name: &str| {
        fields
            .and_then(|f| f.get(name))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_owned()
    };
    let nested_name = |name: &str, key_name: &str, fallback: &str| {
        fields
            .and_then(|f| f.get(name))
            .and_then(|o| o.get(key_name))
            .and_then(|v| v.as_str())
            .unwrap_or(fallback)
            .to_owned()
    };
    let labels = fields
        .and_then(|f| f.get("labels"))
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let transitions = val
        .get("transitions")
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    Some(JiraTransition {
                        id: t.get("id")?.as_str()?.to_owned(),
                        name: t.get("name")?.as_str()?.to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let comments = fields
        .and_then(|f| f.get("comment"))
        .and_then(|c| c.get("comments"))
        .and_then(|a| a.as_array())
        .map(|arr| {
            arr.iter()
                .rev()
                .take(15)
                .map(|c| JiraComment {
                    author: c
                        .get("author")
                        .and_then(|a| a.get("displayName"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("User")
                        .to_owned(),
                    created: c
                        .get("created")
                        .and_then(|v| v.as_str())
                        .and_then(|s| s.get(..10))
                        .unwrap_or("")
                        .to_owned(),
                    body: c
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_owned(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(JiraIssueDetail {
        key: key.to_owned(),
        summary: str_field("summary"),
        description: str_field("description"),
        status: nested_name("status", "name", "Open"),
        priority: nested_name("priority", "name", "—"),
        assignee: nested_name("assignee", "displayName", "Unassigned"),
        reporter: nested_name("reporter", "displayName", "—"),
        labels,
        transitions,
        comments,
    })
}
