use crate::event_log;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use sysinfo::{Disks, ProcessRefreshKind, ProcessesToUpdate, System};

const CHANNELS: &[(&str, &str, usize)] = &[
    ("System", "SYS", 8),
    ("Application", "APP", 4),
    ("Microsoft-Windows-Windows Defender/Operational", "DEF", 2),
    ("Microsoft-Windows-NetworkProfile/Operational", "NET", 2),
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveLogEntry {
    pub seq: u64,
    pub time_ms: u64,
    pub level: &'static str,
    pub source: &'static str,
    pub tag: String,
    pub message: String,
}

#[derive(Default)]
struct TailState {
    seeded: bool,
    seq: u64,
    high_water: HashMap<&'static str, u64>,
    known_pids: HashMap<u32, String>,
    known_services: HashMap<String, u32>,
    known_mounts: HashSet<String>,
    sys: Option<System>,
}

#[derive(Default)]
pub struct SystemLogTailer {
    state: Mutex<TailState>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn event_level_str(level: u8) -> &'static str {
    match level {
        1 => "crit",
        2 => "err",
        3 => "warn",
        _ => "info",
    }
}

fn clean_single_line(raw: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(raw.len().min(max_chars + 4));
    let mut prev_space = false;
    for ch in raw.chars() {
        let mapped = if ch.is_whitespace() { ' ' } else { ch };
        if mapped == ' ' {
            if !prev_space && !out.is_empty() {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(mapped);
            prev_space = false;
        }
        if out.chars().count() >= max_chars {
            out.push('…');
            break;
        }
    }
    out.trim().to_owned()
}

fn format_event_message(record: &event_log::Record) -> String {
    let provider = record
        .provider
        .strip_prefix("Microsoft-Windows-")
        .unwrap_or(&record.provider);
    let body = record
        .message
        .as_deref()
        .map(|m| clean_single_line(m, 180))
        .filter(|m| !m.is_empty())
        .unwrap_or_else(|| format!("Event #{} logged by {provider}", record.event_id));
    format!("{provider} (#{}): {body}", record.event_id)
}

fn service_state_name(state: u32) -> &'static str {
    match state {
        1 => "Stopped",
        2 => "Starting",
        3 => "Stopping",
        4 => "Running",
        5 => "Resuming",
        6 => "Pausing",
        7 => "Paused",
        _ => "Unknown",
    }
}

/// Fast native Win32 SCM pass returning `(service_name -> dwCurrentState)` (~1–2ms, zero subprocess).
fn snapshot_service_states() -> HashMap<String, u32> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{ERROR_MORE_DATA, GetLastError},
        System::Services::{
            CloseServiceHandle, ENUM_SERVICE_STATUS_PROCESSW, EnumServicesStatusExW,
            OpenSCManagerW, SC_ENUM_PROCESS_INFO, SC_MANAGER_ENUMERATE_SERVICE, SERVICE_STATE_ALL,
            SERVICE_WIN32,
        },
    };
    let mut out = HashMap::new();
    unsafe {
        let scm = OpenSCManagerW(ptr::null(), ptr::null(), SC_MANAGER_ENUMERATE_SERVICE);
        if scm.is_null() {
            return out;
        }
        let mut needed = 0u32;
        let mut count = 0u32;
        let mut resume = 0u32;
        let ok = EnumServicesStatusExW(
            scm,
            SC_ENUM_PROCESS_INFO,
            SERVICE_WIN32,
            SERVICE_STATE_ALL,
            ptr::null_mut(),
            0,
            &mut needed,
            &mut count,
            &mut resume,
            ptr::null(),
        );
        if ok == 0 && GetLastError() == ERROR_MORE_DATA && needed > 0 && needed < 4 * 1024 * 1024 {
            let mut buf = vec![0u8; needed as usize];
            if EnumServicesStatusExW(
                scm,
                SC_ENUM_PROCESS_INFO,
                SERVICE_WIN32,
                SERVICE_STATE_ALL,
                buf.as_mut_ptr(),
                needed,
                &mut needed,
                &mut count,
                &mut resume,
                ptr::null(),
            ) != 0
            {
                let entries = std::slice::from_raw_parts(
                    buf.as_ptr().cast::<ENUM_SERVICE_STATUS_PROCESSW>(),
                    count as usize,
                );
                for entry in entries {
                    if !entry.lpServiceName.is_null() {
                        let mut len = 0usize;
                        while *entry.lpServiceName.add(len) != 0 && len < 260 {
                            len += 1;
                        }
                        let name = String::from_utf16_lossy(std::slice::from_raw_parts(
                            entry.lpServiceName,
                            len,
                        ));
                        out.insert(name, entry.ServiceStatusProcess.dwCurrentState);
                    }
                }
            }
        }
        CloseServiceHandle(scm);
    }
    out
}

fn snapshot_pids(sys: &mut System) -> HashMap<u32, String> {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes()
        .iter()
        .map(|(pid, proc)| (pid.as_u32(), proc.name().to_string_lossy().into_owned()))
        .collect()
}

fn snapshot_mounts() -> HashSet<String> {
    Disks::new_with_refreshed_list()
        .list()
        .iter()
        .map(|d| d.mount_point().to_string_lossy().into_owned())
        .collect()
}

impl SystemLogTailer {
    pub fn reset(&self) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.seeded = false;
        st.high_water.clear();
        st.known_pids.clear();
        st.known_services.clear();
        st.known_mounts.clear();
        st.sys = None;
    }

    pub fn poll(&self, seed: bool, smoke_test: bool) -> Vec<LiveLogEntry> {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if smoke_test {
            st.seeded = true;
            st.seq += 1;
            let t = now_ms();
            return vec![
                LiveLogEntry {
                    seq: st.seq,
                    time_ms: t,
                    level: "ok",
                    source: "SYS",
                    tag: "Live Console".into(),
                    message: "Live System Console armed — streaming Windows Event Logs, processes, services & storage events.".into(),
                },
                LiveLogEntry {
                    seq: st.seq + 1,
                    time_ms: t,
                    level: "info",
                    source: "PROC",
                    tag: "Process".into(),
                    message: "Process & SCM service differential watcher active (smoke mode).".into(),
                },
            ];
        }

        let mut entries: Vec<LiveLogEntry> = Vec::new();
        let doing_seed = seed || !st.seeded;
        let mut reader = event_log::Reader::open().ok();

        if doing_seed {
            st.high_water.clear();
            let mut seeded_events: Vec<(u64, &'static str, &'static str, String, String)> = Vec::new();
            if let Some(ref mut rdr) = reader {
                for &(channel, source, seed_limit) in CHANNELS {
                    if let Ok(mut query) = event_log::Query::open(channel, "*") {
                        let mut max_record = 0u64;
                        for _ in 0..seed_limit {
                            match query.next(rdr) {
                                Ok(Some(rec)) => {
                                    if rec.key.record > max_record {
                                        max_record = rec.key.record;
                                    }
                                    seeded_events.push((
                                        rec.key.time_ms,
                                        event_level_str(rec.level),
                                        source,
                                        format!("#{}", rec.event_id),
                                        format_event_message(&rec),
                                    ));
                                }
                                _ => break,
                            }
                        }
                        if max_record > 0 {
                            st.high_water.insert(channel, max_record);
                        }
                    }
                }
            }
            seeded_events.sort_by_key(|e| e.0);
            for (time_ms, level, source, tag, message) in seeded_events {
                st.seq += 1;
                entries.push(LiveLogEntry {
                    seq: st.seq,
                    time_ms,
                    level,
                    source,
                    tag,
                    message,
                });
            }
            let mut sys = System::new();
            st.known_pids = snapshot_pids(&mut sys);
            st.sys = Some(sys);
            st.known_services = snapshot_service_states();
            st.known_mounts = snapshot_mounts();
            st.seeded = true;
            st.seq += 1;
            entries.push(LiveLogEntry {
                seq: st.seq,
                time_ms: now_ms(),
                level: "ok",
                source: "SYS",
                tag: "Live".into(),
                message: format!(
                    "Live System Console active — watching {} Windows channels, {} processes & {} services.",
                    st.high_water.len(),
                    st.known_pids.len(),
                    st.known_services.len()
                ),
            });
            return entries;
        }

        // Incremental poll: only events newer than high_water
        let mut fresh_events: Vec<(u64, &'static str, &'static str, String, String)> = Vec::new();
        if let Some(ref mut rdr) = reader {
            for &(channel, source, _) in CHANNELS {
                let last_id = st.high_water.get(channel).copied().unwrap_or(0);
                let filter = if last_id > 0 {
                    format!("*[System[EventRecordID>{last_id}]]")
                } else {
                    "*".to_owned()
                };
                if let Ok(mut query) = event_log::Query::open(channel, &filter) {
                    let mut max_record = last_id;
                    for _ in 0..10 {
                        match query.next(rdr) {
                            Ok(Some(rec)) => {
                                if rec.key.record > max_record {
                                    max_record = rec.key.record;
                                }
                                fresh_events.push((
                                    rec.key.time_ms,
                                    event_level_str(rec.level),
                                    source,
                                    format!("#{}", rec.event_id),
                                    format_event_message(&rec),
                                ));
                            }
                            _ => break,
                        }
                    }
                    if max_record > last_id {
                        st.high_water.insert(channel, max_record);
                    }
                }
            }
        }
        fresh_events.sort_by_key(|e| e.0);
        for (time_ms, level, source, tag, message) in fresh_events {
            st.seq += 1;
            entries.push(LiveLogEntry {
                seq: st.seq,
                time_ms,
                level,
                source,
                tag,
                message,
            });
        }

        // Process launch / exit diff (capped to avoid burst spam)
        let t_now = now_ms();
        let current_pids = {
            let sys = st.sys.get_or_insert_with(System::new);
            snapshot_pids(sys)
        };
        let mut proc_events = 0usize;
        for (&pid, name) in &current_pids {
            if !st.known_pids.contains_key(&pid) && proc_events < 6 {
                st.seq += 1;
                entries.push(LiveLogEntry {
                    seq: st.seq,
                    time_ms: t_now,
                    level: "info",
                    source: "PROC",
                    tag: format!("+{pid}"),
                    message: format!("Process started: {name} (PID {pid})"),
                });
                proc_events += 1;
            }
        }
        let mut exited: Vec<(u32, String)> = Vec::new();
        for (&pid, name) in &st.known_pids {
            if !current_pids.contains_key(&pid) && proc_events + exited.len() < 8 {
                exited.push((pid, name.clone()));
            }
        }
        for (pid, name) in exited {
            st.seq += 1;
            entries.push(LiveLogEntry {
                seq: st.seq,
                time_ms: t_now,
                level: "info",
                source: "PROC",
                tag: format!("-{pid}"),
                message: format!("Process exited: {name} (PID {pid})"),
            });
        }
        st.known_pids = current_pids;

        // Windows Service state transitions
        let current_services = snapshot_service_states();
        let mut svc_events = 0usize;
        for (name, &new_state) in &current_services {
            if let Some(&old_state) = st.known_services.get(name)
                && old_state != new_state
                && svc_events < 6
            {
                st.seq += 1;
                let level = match new_state {
                    4 => "ok",
                    1 => "warn",
                    _ => "info",
                };
                entries.push(LiveLogEntry {
                    seq: st.seq,
                    time_ms: t_now,
                    level,
                    source: "SVC",
                    tag: service_state_name(new_state).into(),
                    message: format!(
                        "Service '{name}': {} -> {}",
                        service_state_name(old_state),
                        service_state_name(new_state)
                    ),
                });
                svc_events += 1;
            }
        }
        st.known_services = current_services;

        // Storage / USB mount & unmount diff
        let current_mounts = snapshot_mounts();
        let added_mounts: Vec<String> = current_mounts
            .difference(&st.known_mounts)
            .cloned()
            .collect();
        let removed_mounts: Vec<String> = st
            .known_mounts
            .difference(&current_mounts)
            .cloned()
            .collect();
        for mount in added_mounts {
            st.seq += 1;
            entries.push(LiveLogEntry {
                seq: st.seq,
                time_ms: t_now,
                level: "ok",
                source: "HW",
                tag: "Mount".into(),
                message: format!("Volume mounted: {mount}"),
            });
        }
        for mount in removed_mounts {
            st.seq += 1;
            entries.push(LiveLogEntry {
                seq: st.seq,
                time_ms: t_now,
                level: "warn",
                source: "HW",
                tag: "Unmount".into(),
                message: format!("Volume removed: {mount}"),
            });
        }
        st.known_mounts = current_mounts;

        entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_multiline_event_messages_compactly() {
        let raw = "  Line one\r\n\tLine   two\nLine three  ";
        assert_eq!(clean_single_line(raw, 80), "Line one Line two Line three");
        let truncated = clean_single_line("abcdefghijklmnopqrstuvwxyz", 10);
        assert_eq!(truncated, "abcdefghij…");
    }

    #[test]
    fn smoke_poll_emits_armed_entries_and_reset_clears_state() {
        let tailer = SystemLogTailer::default();
        let first = tailer.poll(true, true);
        assert!(first.len() >= 2);
        assert_eq!(first[0].source, "SYS");
        tailer.reset();
        let st = tailer.state.lock().unwrap();
        assert!(!st.seeded);
    }
}
