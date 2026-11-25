use crate::{
    native,
    system_controls::{Service, require_admin},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    mem,
    net::{Ipv4Addr, Ipv6Addr},
    path::PathBuf,
    ptr,
    time::{Duration, Instant},
};
use sysinfo::{ProcessesToUpdate, System};
use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, FILETIME, HANDLE},
    NetworkManagement::IpHelper::*,
    Networking::WinSock::{AF_INET, AF_INET6},
    System::{Services::*, Threading::*},
};
use wmi::WMIConnection;

#[derive(Serialize)]
pub struct Snapshot {
    processes: Vec<Process>,
    services: Vec<ServiceRow>,
    sockets: Vec<Socket>,
    elevated: bool,
    errors: Vec<String>,
}

#[derive(Serialize)]
struct Process {
    pid: u32,
    name: String,
    cpu: f32,
    ram: u64,
    handles: Option<u32>,
    threads: Option<u32>,
    path: Option<PathBuf>,
    token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Counts {
    process_id: u32,
    handle_count: u32,
    thread_count: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(deserialize = "PascalCase"))]
struct ServiceRow {
    name: String,
    display_name: String,
    state: String,
    start_mode: String,
    start_name: Option<String>,
    delayed_auto_start: Option<bool>,
    process_id: Option<u32>,
}

pub fn snapshot() -> Snapshot {
    let wmi = WMIConnection::new();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let start = Instant::now();
    let counts: HashMap<_, _> = wmi
        .as_ref()
        .ok()
        .and_then(|wmi| {
            wmi.raw_query::<Counts>("SELECT ProcessId,HandleCount,ThreadCount FROM Win32_Process")
                .ok()
        })
        .unwrap_or_default()
        .into_iter()
        .map(|row| (row.process_id, row))
        .collect();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL.saturating_sub(start.elapsed()));
    system.refresh_processes(ProcessesToUpdate::All, true);
    let cpus = std::thread::available_parallelism().map_or(1, |cpus| cpus.get()) as f32;
    let processes = system
        .processes()
        .values()
        .filter_map(|process| {
            let pid = process.pid().as_u32();
            if pid == 0 {
                return None;
            }
            let name = process.name().to_string_lossy().into_owned();
            let info = counts.get(&pid);
            let token = if protected(pid, &name) {
                None
            } else {
                ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)
                    .ok()
                    .and_then(|handle| identity(&handle))
                    .filter(|&created| {
                        (created.saturating_sub(116_444_736_000_000_000) / 10_000_000)
                            == process.start_time()
                    })
                    .map(|value| value.to_string())
            };
            Some(Process {
                pid,
                name,
                cpu: (process.cpu_usage() / cpus).clamp(0.0, 100.0),
                ram: process.memory(),
                path: process
                    .exe()
                    .filter(|path| path.is_absolute())
                    .map(PathBuf::from),
                handles: info.map(|row| row.handle_count),
                threads: info.map(|row| row.thread_count),
                token,
            })
        })
        .collect();
    let mut errors = Vec::new();
    if counts.is_empty() {
        errors.push("Windows process handle and thread counts are unavailable.".into());
    }
    let services = wmi.and_then(|wmi| wmi.raw_query("SELECT Name,DisplayName,State,StartMode,StartName,DelayedAutoStart,ProcessId FROM Win32_Service"))
        .unwrap_or_else(|error| { errors.push(format!("Windows services: {error}")); Vec::new() });
    let (sockets, socket_errors) = sockets();
    errors.extend(socket_errors);
    Snapshot {
        processes,
        services,
        sockets,
        elevated: native::elevated(),
        errors,
    }
}

struct ProcessHandle(HANDLE);
impl ProcessHandle {
    fn open(pid: u32, flags: u32) -> Result<Self, String> {
        let handle = unsafe { OpenProcess(flags, 0, pid) };
        if handle.is_null() {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(Self(handle))
        }
    }
}
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

fn identity(handle: &ProcessHandle) -> Option<u64> {
    let [mut creation, mut exit, mut kernel, mut user] = [FILETIME::default(); 4];
    (unsafe { GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user) } != 0)
        .then(|| (u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
}

fn protected(pid: u32, name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    pid <= 4
        || pid == std::process::id()
        || matches!(
            name.trim_end_matches(".exe"),
            "csrss"
                | "lsass"
                | "wininit"
                | "winlogon"
                | "smss"
                | "services"
                | "svchost"
                | "dwm"
                | "explorer"
                | "pwsh"
                | "powershell"
                | "system"
                | "registry"
        )
}

pub fn terminate(pid: u32, token: &str) -> Result<(), String> {
    let handle = ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE)?;
    if !identity(&handle).is_some_and(|creation| token.parse::<u64>() == Ok(creation)) {
        return Err(
            "That process has exited or the PID has been reused. Refresh the snapshot.".into(),
        );
    }
    let (mut critical, mut size) = (0, 32768);
    let mut path = vec![0u16; size as usize];
    if unsafe { IsProcessCritical(handle.0, &mut critical) } == 0
        || critical != 0
        || unsafe { QueryFullProcessImageNameW(handle.0, 0, path.as_mut_ptr(), &mut size) } == 0
    {
        return Err("Windows protects this process or its identity could not be verified.".into());
    }
    let path = String::from_utf16_lossy(&path[..size as usize]);
    if protected(pid, path.rsplit('\\').next().unwrap_or(&path)) {
        return Err("This Windows or CoreWatch process is protected.".into());
    }
    if unsafe { TerminateProcess(handle.0, 1) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

pub fn process_folder(pid: u32) -> Result<(), String> {
    let handle = ProcessHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
    let mut size = 32768;
    let mut buffer = vec![0; size as usize];
    if unsafe { QueryFullProcessImageNameW(handle.0, 0, buffer.as_mut_ptr(), &mut size) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let path = PathBuf::from(String::from_utf16_lossy(&buffer[..size as usize]));
    crate::dashboard_actions::open_directory(
        path.parent().ok_or("The process folder is unavailable.")?,
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceAction {
    Start,
    Stop,
    Restart,
    Automatic,
    Manual,
    Disabled,
}

pub fn control_service(name: &str, action: ServiceAction) -> Result<(), String> {
    require_admin()?;
    if name.is_empty() || name.contains('\0') {
        return Err("A Windows service name is required.".into());
    }
    let manager = Service::manager()?;
    use ServiceAction::*;
    let rights = match action {
        Start => SERVICE_START,
        Stop => SERVICE_STOP | SERVICE_QUERY_STATUS,
        Restart => SERVICE_STOP | SERVICE_START | SERVICE_QUERY_STATUS,
        _ => SERVICE_CHANGE_CONFIG,
    };
    let service = manager.open(name, rights)?;
    if let Some(mode) = match action {
        Automatic => Some(SERVICE_AUTO_START),
        Manual => Some(SERVICE_DEMAND_START),
        Disabled => Some(SERVICE_DISABLED),
        _ => None,
    } {
        return service.set_startup(mode);
    }
    if matches!(action, Stop | Restart) {
        service.stop()?;
        let limit = Instant::now() + Duration::from_secs(15);
        while service.status()? != SERVICE_STOPPED {
            if Instant::now() >= limit {
                return Err(
                    "The service is still stopping. Refresh its status before starting it again."
                        .into(),
                );
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    }
    if matches!(action, Start | Restart) {
        service.start()?;
    }
    Ok(())
}

#[derive(Serialize)]
struct Socket {
    protocol: &'static str,
    address: String,
    port: u16,
    remote: Option<String>,
    state: &'static str,
    pid: u32,
}

fn table<T: Copy>(load: impl Fn(*mut std::ffi::c_void, *mut u32) -> u32) -> Result<Vec<T>, u32> {
    let mut size = 0;
    let status = load(ptr::null_mut(), &mut size);
    if status != ERROR_INSUFFICIENT_BUFFER {
        return Err(status);
    }
    for _ in 0..4 {
        if size < 4 {
            return Err(windows_sys::Win32::Foundation::ERROR_INVALID_DATA);
        }
        let mut buffer = vec![0u32; (size as usize).div_ceil(4)];
        let status = load(buffer.as_mut_ptr().cast(), &mut size);
        if status == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if status != 0 {
            return Err(status);
        }
        let count = buffer[0] as usize;
        if count > (buffer.len() * 4 - 4) / mem::size_of::<T>() {
            return Err(13);
        }
        return Ok((0..count)
            .map(|index| unsafe {
                buffer
                    .as_ptr()
                    .add(1)
                    .cast::<T>()
                    .add(index)
                    .read_unaligned()
            })
            .collect());
    }
    Err(ERROR_INSUFFICIENT_BUFFER)
}

fn tcp_state(state: u32) -> &'static str {
    match state {
        1 => "Closed",
        2 => "Listen",
        3 => "SYN sent",
        4 => "SYN received",
        5 => "Established",
        6 => "FIN wait 1",
        7 => "FIN wait 2",
        8 => "Close wait",
        9 => "Closing",
        10 => "Last ACK",
        11 => "Time wait",
        12 => "Delete TCB",
        _ => "Unknown",
    }
}

fn v6(address: [u8; 16], scope: u32) -> String {
    let address = Ipv6Addr::from(address);
    if scope == 0 {
        address.to_string()
    } else {
        format!("{address}%{scope}")
    }
}

fn sockets() -> (Vec<Socket>, Vec<String>) {
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    let port = |value| u16::from_be(value as u16);
    let tcp = |af, data, size| unsafe {
        GetExtendedTcpTable(data, size, 0, u32::from(af), TCP_TABLE_OWNER_PID_ALL, 0)
    };
    let udp = |af, data, size| unsafe {
        GetExtendedUdpTable(data, size, 0, u32::from(af), UDP_TABLE_OWNER_PID, 0)
    };
    macro_rules! append {
        ($ty:ty, $description:literal, $func:ident, $af:ident, $convert:expr) => {
            match table::<$ty>(|data, size| $func($af, data, size)) {
                Ok(entries) => rows.extend(entries.into_iter().map($convert)),
                Err(code) => errors.push(format!(
                    "{} sockets could not be read (Windows error {code}).",
                    $description
                )),
            }
        };
    }
    append!(MIB_TCPROW_OWNER_PID, "IPv4 TCP", tcp, AF_INET, |row| {
        Socket {
            protocol: "TCP",
            address: Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).to_string(),
            port: port(row.dwLocalPort),
            remote: (row.dwState != 2).then(|| {
                format!(
                    "{}:{}",
                    Ipv4Addr::from(row.dwRemoteAddr.to_ne_bytes()),
                    port(row.dwRemotePort)
                )
            }),
            state: tcp_state(row.dwState),
            pid: row.dwOwningPid,
        }
    });
    append!(MIB_TCP6ROW_OWNER_PID, "IPv6 TCP", tcp, AF_INET6, |row| {
        Socket {
            protocol: "TCP",
            address: v6(row.ucLocalAddr, row.dwLocalScopeId),
            port: port(row.dwLocalPort),
            remote: (row.dwState != 2).then(|| {
                format!(
                    "[{}]:{}",
                    v6(row.ucRemoteAddr, row.dwRemoteScopeId),
                    port(row.dwRemotePort)
                )
            }),
            state: tcp_state(row.dwState),
            pid: row.dwOwningPid,
        }
    });
    append!(MIB_UDPROW_OWNER_PID, "IPv4 UDP", udp, AF_INET, |row| {
        Socket {
            protocol: "UDP",
            address: Ipv4Addr::from(row.dwLocalAddr.to_ne_bytes()).to_string(),
            port: port(row.dwLocalPort),
            remote: None,
            state: "Bound",
            pid: row.dwOwningPid,
        }
    });
    append!(MIB_UDP6ROW_OWNER_PID, "IPv6 UDP", udp, AF_INET6, |row| {
        Socket {
            protocol: "UDP",
            address: v6(row.ucLocalAddr, row.dwLocalScopeId),
            port: port(row.dwLocalPort),
            remote: None,
            state: "Bound",
            pid: row.dwOwningPid,
        }
    });
    (rows, errors)
}

#[cfg(test)]
mod tests {
    use super::sockets;
    use std::net::{TcpListener, UdpSocket};

    #[test]
    fn loopback_sockets_are_attributed_to_current_process() {
        let tcp = TcpListener::bind("127.0.0.1:0").unwrap();
        let udp = UdpSocket::bind("127.0.0.1:0").unwrap();
        let (rows, errors) = sockets();
        for (protocol, state, port) in [
            ("TCP", "Listen", tcp.local_addr().unwrap().port()),
            ("UDP", "Bound", udp.local_addr().unwrap().port()),
        ] {
            assert!(
                rows.iter().any(|row| row.protocol == protocol
                    && row.state == state
                    && row.port == port
                    && row.pid == std::process::id()
                    && row.address == "127.0.0.1"),
                "{protocol} {port} missing: {errors:?}"
            );
        }
    }
}
