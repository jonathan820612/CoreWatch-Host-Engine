use crate::{devices, native};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs},
    os::windows::{ffi::OsStringExt, process::CommandExt},
    path::PathBuf,
    process::Command,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::{HANDLE, INVALID_HANDLE_VALUE},
    NetworkManagement::IpHelper::{
        ICMP_ECHO_REPLY32, IP_OPTION_INFORMATION, IP_SUCCESS, IP_TTL_EXPIRED_TRANSIT,
        IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho,
    },
    System::SystemInformation::GetSystemDirectoryW,
};
use wmi::WMIConnection;

static CONFIGURE: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct DnsUplink {
    pub index: u32,
    pub name: String,
    pub ipv4: Vec<Ipv4Addr>,
    pub ipv6: Vec<std::net::Ipv6Addr>,
}

impl DnsUplink {
    pub fn from_adapter(adapter: &native::Adapter, config: Option<&native::NetworkConfig>) -> Self {
        let mut uplink = Self {
            index: adapter.index,
            name: adapter.name.clone(),
            ipv4: Vec::new(),
            ipv6: Vec::new(),
        };
        for address in config.into_iter().flat_map(|config| &config.dns) {
            match *address {
                IpAddr::V4(ip) if !uplink.ipv4.contains(&ip) => uplink.ipv4.push(ip),
                IpAddr::V6(ip) if !uplink.ipv6.contains(&ip) => uplink.ipv6.push(ip),
                _ => {}
            }
        }
        uplink
    }
}

fn dashboard_uplink() -> Result<(native::Adapter, Option<Ipv4Addr>), String> {
    let mut adapters = native::adapters().ok_or("Unable to read Windows adapters.")?;
    let (index, gateway) = native::default_ipv4_route(&adapters)
        .ok_or("No active IPv4 default route is available.")?;
    let position = adapters
        .iter()
        .position(|adapter| adapter.index == index)
        .ok_or("The active adapter is unavailable.")?;
    Ok((adapters.swap_remove(position), gateway))
}

pub fn set_dashboard_dns(index: u32, alias: &str, servers: &[Ipv4Addr]) -> Result<String, String> {
    if !native::elevated() {
        return Err("Run CoreWatch as administrator to change DNS servers.".into());
    }
    let _lock = CONFIGURE
        .lock()
        .map_err(|_| "Unable to lock adapter settings.")?;
    let (adapter, _) = dashboard_uplink()?;
    if (adapter.index, adapter.name.as_str()) != (index, alias) {
        return Err(
            "The active adapter changed. Refresh the dashboard before applying DNS.".into(),
        );
    }
    configure_ipv4_dns(index, servers)?;
    let result = if servers.is_empty() {
        format!("IPv4 DNS reset to automatic on {}.", adapter.name)
    } else {
        format!("IPv4 DNS updated on {}.", adapter.name)
    };
    Ok(match flush_dns() {
        Ok(_) => format!("{result} DNS cache flushed."),
        Err(error) => format!("{result} DNS cache flush failed: {error}"),
    })
}

pub fn refresh_dashboard_arp() -> Result<native::GatewayNeighbor, String> {
    let (adapter, gateway) = dashboard_uplink()?;
    native::gateway_neighbor(
        gateway.ok_or("No IPv4 gateway on the active route.")?,
        adapter.index,
        true,
    )
}

#[derive(Serialize)]
pub struct ManagedAdapter {
    pub info: native::Adapter,
    pub config: Option<native::NetworkConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Win32NetworkAdapter {
    name: String,
    net_connection_id: Option<String>,
    interface_index: Option<u32>,
    net_enabled: Option<bool>,
    #[serde(rename = "MACAddress")]
    mac_address: Option<String>,
    #[serde(rename = "AdapterTypeID")]
    adapter_type_id: Option<u16>,
}

pub fn adapters() -> Result<Vec<ManagedAdapter>, String> {
    let mut rows: Vec<_> = native::adapters()
        .ok_or("Windows could not enumerate network interfaces.")?
        .into_iter()
        .filter(|entry| entry.physical)
        .collect();

    let _apartment = devices::ComApartment::enter();
    if let Ok(connection) = WMIConnection::new() {
        include_disabled(&mut rows, &connection);
    }
    rows.sort_unstable_by(|a, b| b.online.cmp(&a.online).then_with(|| a.name.cmp(&b.name)));
    Ok(rows
        .into_iter()
        .map(|info| ManagedAdapter {
            config: if info.index > 0 {
                native::network_config(info.index)
            } else {
                None
            },
            info,
        })
        .collect())
}

pub fn include_disabled(rows: &mut Vec<native::Adapter>, connection: &WMIConnection) {
    // Disabled devices may be absent from the IP interface table.
    let fallback: Vec<Win32NetworkAdapter> = connection
        .raw_query("SELECT Name, NetConnectionID, InterfaceIndex, NetEnabled, MACAddress, AdapterTypeID FROM Win32_NetworkAdapter WHERE PhysicalAdapter = TRUE")
        .unwrap_or_default();
    for entry in fallback {
        let Some(alias) = entry.net_connection_id else {
            continue;
        };
        let index = entry.interface_index.unwrap_or(0);
        if alias.is_empty()
            || entry.net_enabled != Some(false)
            || rows.iter().any(|nic| {
                (index != 0 && nic.index == index) || nic.name.eq_ignore_ascii_case(&alias)
            })
        {
            continue;
        }
        rows.push(native::Adapter {
            index,
            name: alias,
            description: entry.name,
            kind: match entry.adapter_type_id {
                Some(0) => "Ethernet",
                Some(9) => "Wi-Fi",
                _ => "Other",
            },
            online: false,
            enabled: false,
            physical: true,
            mac: entry.mac_address,
            link_bps: 0,
            counters: (0, 0),
            luid: 0,
            eligible: false,
        });
    }
}

#[derive(Serialize)]
pub struct NetworkTables {
    wifi: String,
    routes: String,
    arp: String,
}

pub fn tables() -> NetworkTables {
    fn read(name: Tool, args: &[&str]) -> String {
        system_tool(name, args.iter().copied()).unwrap_or_else(|error| error)
    }
    NetworkTables {
        wifi: read(Tool::Netsh, &["wlan", "show", "interfaces"]),
        routes: read(Tool::Route, &["print", "-4"]),
        arp: read(Tool::Arp, &["-a"]),
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Diagnostic {
    Ping {
        target: String,
    },
    Trace {
        target: String,
    },
    Port {
        target: String,
        port: u16,
    },
    Dns {
        target: String,
        record: RecordType,
        server: Option<IpAddr>,
    },
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "UPPERCASE")]
pub enum RecordType {
    A,
    Aaaa,
    Mx,
    Txt,
    Ns,
    Cname,
    Soa,
    Ptr,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiagnosticResult {
    Ping {
        address: Ipv4Addr,
        replies: Vec<EchoReply>,
    },
    Trace {
        address: Ipv4Addr,
        replies: Vec<EchoReply>,
    },
    Port {
        address: SocketAddr,
        connected: bool,
        elapsed_ms: u128,
        message: String,
    },
    Dns {
        output: String,
    },
}

pub fn diagnose(request: Diagnostic) -> Result<DiagnosticResult, String> {
    match request {
        Diagnostic::Ping { target } => {
            let address = resolve_ipv4(&target)?;
            let replies = ping(address, 6)?;
            Ok(DiagnosticResult::Ping { address, replies })
        }
        Diagnostic::Trace { target } => {
            let address = resolve_ipv4(&target)?;
            let socket = Icmp::new()?;
            let mut replies = Vec::new();
            for hop in 1..=24 {
                let reply = socket.echo(address, hop, hop);
                let reached = reply.status == IP_SUCCESS;
                replies.push(reply);
                if reached {
                    break;
                }
            }
            Ok(DiagnosticResult::Trace { address, replies })
        }
        Diagnostic::Port { target, port } => {
            if port == 0 {
                return Err("Enter a TCP port from 1 to 65535.".into());
            }
            let address = resolve(&target, port)?
                .into_iter()
                .next()
                .ok_or("No address returned by DNS.")?;
            let start = Instant::now();
            let result = TcpStream::connect_timeout(&address, Duration::from_millis(1700));
            let elapsed_ms = start.elapsed().as_millis();
            let connected = result.is_ok();
            Ok(DiagnosticResult::Port {
                address,
                connected,
                elapsed_ms,
                message: result.err().map_or_else(
                    || "Connection established".into(),
                    |error| error.to_string(),
                ),
            })
        }
        Diagnostic::Dns {
            target,
            record,
            server,
        } => {
            let target = validate_target(&target)?;
            let dns_name = match (matches!(record, RecordType::Ptr), target.parse::<IpAddr>()) {
                (true, Ok(IpAddr::V4(ip))) => {
                    let [a, b, c, d] = ip.octets();
                    format!("{d}.{c}.{b}.{a}.in-addr.arpa.")
                }
                (true, Ok(IpAddr::V6(ip))) => {
                    let reverse: String = ip
                        .octets()
                        .iter()
                        .rev()
                        .map(|byte| format!("{:x}.{:x}.", byte & 15, byte >> 4))
                        .collect();
                    format!("{reverse}ip6.arpa.")
                }
                _ => target.to_owned(),
            };
            let mut args = vec![
                "-timeout=2".to_owned(),
                "-retry=1".to_owned(),
                format!("-type={}", format!("{record:?}").to_ascii_uppercase()),
                dns_name,
            ];
            if let Some(server) = server {
                args.push(server.to_string());
            }
            system_tool(Tool::Nslookup, args).map(|output| DiagnosticResult::Dns { output })
        }
    }
}

fn validate_target(target: &str) -> Result<&str, String> {
    let value = target.trim();
    if value.parse::<IpAddr>().is_ok() {
        return Ok(value);
    }
    let hostname = value.strip_suffix('.').unwrap_or(value);
    if hostname.len() <= 253
        && hostname.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        })
    {
        return Ok(value);
    }
    Err("Enter an IP address or DNS hostname.".into())
}

fn resolve(target: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    (validate_target(target)?, port)
        .to_socket_addrs()
        .map(|addresses| addresses.collect())
        .map_err(|error| format!("DNS resolution failed: {error}"))
}

fn resolve_ipv4(target: &str) -> Result<Ipv4Addr, String> {
    resolve(target, 0)?
        .into_iter()
        .find_map(|entry| match entry.ip() {
            IpAddr::V4(address) => Some(address),
            _ => None,
        })
        .ok_or_else(|| "The target did not resolve to IPv4.".into())
}

struct Icmp(HANDLE);

#[derive(Serialize)]
pub struct EchoReply {
    sequence: u8,
    address: Option<Ipv4Addr>,
    pub(crate) ms: Option<u32>,
    pub(crate) status: u32,
}

pub(crate) fn ping(address: Ipv4Addr, samples: u8) -> Result<Vec<EchoReply>, String> {
    let socket = Icmp::new()?;
    let mut replies = Vec::with_capacity(samples as usize);
    for sample in 1..=samples {
        replies.push(socket.echo(address, 128, sample));
        if sample < samples {
            thread::sleep(Duration::from_millis(180));
        }
    }
    Ok(replies)
}

impl Icmp {
    fn new() -> Result<Self, String> {
        let handle = unsafe { IcmpCreateFile() };
        if handle == INVALID_HANDLE_VALUE {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(Self(handle))
    }

    fn echo(&self, ip: Ipv4Addr, ttl: u8, sequence: u8) -> EchoReply {
        let payload = [0u8; 32];
        let options = IP_OPTION_INFORMATION {
            Ttl: ttl,
            ..Default::default()
        };
        let mut output = [0u64; 64];
        let received = unsafe {
            IcmpSendEcho(
                self.0,
                u32::from_ne_bytes(ip.octets()),
                payload.as_ptr().cast(),
                payload.len() as u16,
                &options,
                output.as_mut_ptr().cast(),
                std::mem::size_of_val(&output) as u32,
                850,
            )
        };
        if received == 0 {
            let status = unsafe { windows_sys::Win32::Foundation::GetLastError() };
            return EchoReply {
                sequence,
                address: None,
                ms: None,
                status,
            };
        }
        // Windows uses the fixed-width reply layout on 64-bit targets.
        let reply = unsafe { &*output.as_ptr().cast::<ICMP_ECHO_REPLY32>() };
        EchoReply {
            sequence,
            address: (reply.Address != 0).then(|| Ipv4Addr::from(reply.Address.to_ne_bytes())),
            ms: matches!(reply.Status, IP_SUCCESS | IP_TTL_EXPIRED_TRANSIT)
                .then_some(reply.RoundTripTime),
            status: reply.Status,
        }
    }
}

impl Drop for Icmp {
    fn drop(&mut self) {
        unsafe {
            IcmpCloseHandle(self.0);
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AdapterAction {
    Enable,
    Disable,
    Restart,
    Rename {
        name: String,
    },
    Dhcp,
    Static {
        address: Ipv4Addr,
        prefix: u8,
        gateway: Option<Ipv4Addr>,
    },
    Dns {
        servers: Vec<Ipv4Addr>,
    },
}

pub fn configure(index: u32, alias: &str, action: AdapterAction) -> Result<String, String> {
    if !native::elevated() {
        return Err("Run CoreWatch as administrator to change adapter settings.".into());
    }
    let _configure = CONFIGURE
        .lock()
        .map_err(|_| "Unable to lock adapter settings.")?;
    let adapter = adapters()?
        .into_iter()
        .find(|adapter| adapter.info.index == index && adapter.info.name == alias)
        .ok_or("Adapter changed or is no longer available. Refresh the list.")?;
    if index == 0
        && matches!(
            action,
            AdapterAction::Dhcp | AdapterAction::Static { .. } | AdapterAction::Dns { .. }
        )
    {
        return Err("Enable this adapter before changing IP or DNS settings.".into());
    }
    let alias = validate_alias(&adapter.info.name)?;
    let name = format!("name={alias}");
    let id = format!("name={index}");
    let run = |args: &[&str]| system_tool(Tool::Netsh, args.iter().copied()).map(|_| ());
    let interface = |state: &str| run(&["interface", "set", "interface", &name, state]);
    let ipv4 =
        |setting: &str, source: &str| run(&["interface", "ipv4", "set", setting, &id, source]);
    match action {
        AdapterAction::Enable => interface("admin=enabled")?,
        AdapterAction::Disable => interface("admin=disabled")?,
        AdapterAction::Restart => {
            if !adapter.info.enabled {
                return Err("Enable the adapter before restarting it.".into());
            }
            interface("admin=disabled")?;
            interface("admin=enabled").map_err(|error| {
                format!("Adapter was disabled but Windows could not re-enable it: {error}")
            })?;
        }
        AdapterAction::Rename { name: new } => {
            let new = format!("newname={}", validate_alias(&new)?);
            interface(&new)?;
        }
        AdapterAction::Dhcp => {
            ipv4("address", "source=dhcp")?;
            ipv4("dnsservers", "source=dhcp")
                .map_err(|error| format!("IPv4 is set to DHCP, but DNS reset failed: {error}"))?;
        }
        AdapterAction::Static {
            address,
            prefix,
            gateway,
        } => {
            if prefix > 32
                || !valid_unicast(address)
                || gateway.is_some_and(|ip| !valid_unicast(ip))
            {
                return Err(
                    "Enter a valid unicast IPv4 address, prefix (0–32), and optional gateway."
                        .into(),
                );
            }
            let address = format!("address={address}/{prefix}");
            let gateway = format!(
                "gateway={}",
                gateway.map_or_else(|| "none".into(), |ip| ip.to_string())
            );
            run(&[
                "interface",
                "ipv4",
                "set",
                "address",
                &id,
                "source=static",
                &address,
                &gateway,
            ])?;
        }
        AdapterAction::Dns { servers } => configure_ipv4_dns(index, &servers)?,
    }
    Ok(format!("Updated {alias}."))
}

fn valid_unicast(address: Ipv4Addr) -> bool {
    !address.is_unspecified() && !address.is_broadcast() && !address.is_multicast()
}

fn configure_ipv4_dns(index: u32, servers: &[Ipv4Addr]) -> Result<(), String> {
    if servers.len() > 2 || servers.iter().any(|&address| !valid_unicast(address)) {
        return Err("Enter up to two unicast IPv4 DNS servers.".into());
    }
    let interface = format!("name={index}");
    let run = |args: &[&str]| system_tool(Tool::Netsh, args.iter().copied()).map(|_| ());
    if let Some(primary) = servers.first() {
        let address = format!("address={primary}");
        run(&[
            "interface",
            "ipv4",
            "set",
            "dnsservers",
            &interface,
            "source=static",
            &address,
            "validate=no",
        ])?;
        if let Some(secondary) = servers.get(1).filter(|secondary| *secondary != primary) {
            let address = format!("address={secondary}");
            run(&[
                "interface",
                "ipv4",
                "add",
                "dnsservers",
                &interface,
                &address,
                "index=2",
                "validate=no",
            ])
            .map_err(|error| format!("Primary DNS was saved, but secondary DNS failed: {error}"))?;
        }
    } else {
        run(&[
            "interface",
            "ipv4",
            "set",
            "dnsservers",
            &interface,
            "source=dhcp",
        ])?;
    }
    Ok(())
}

fn validate_alias(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.encode_utf16().count() > 128
        || value
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '"' | '=' | '*' | '?'))
    {
        return Err("Enter a valid Windows adapter name.".into());
    }
    Ok(value)
}

pub fn flush_dns() -> Result<String, String> {
    system_tool(Tool::Ipconfig, ["/flushdns"])
}

#[derive(Serialize)]
pub struct DnsCheck {
    pub elapsed_ms: Option<u64>,
    pub flush_error: Option<String>,
    pub lookup_error: Option<String>,
}

pub fn check_dns(flush: bool) -> DnsCheck {
    use windows_sys::Win32::NetworkManagement::Dns::{
        DNS_QUERY_BYPASS_CACHE, DNS_QUERY_NO_HOSTS_FILE, DNS_TYPE_A, DnsFree, DnsFreeRecordList,
        DnsQuery_W,
    };
    let flush_error = if flush { flush_dns().err() } else { None };
    let start = Instant::now();
    let domain = native::wide("cloudflare.com.");
    let mut records = std::ptr::null_mut();
    let status = unsafe {
        DnsQuery_W(
            domain.as_ptr(),
            DNS_TYPE_A,
            DNS_QUERY_BYPASS_CACHE | DNS_QUERY_NO_HOSTS_FILE,
            std::ptr::null_mut(),
            &mut records,
            std::ptr::null_mut(),
        )
    };
    let resolved = if status == 0 {
        let mut record = records;
        let mut address_found = false;
        // The resolver owns a linked list until DnsFree.
        unsafe {
            while let Some(entry) = record.as_ref() {
                if entry.wType == DNS_TYPE_A {
                    address_found = true;
                    break;
                }
                record = entry.pNext;
            }
        }
        address_found
    } else {
        false
    };
    if !records.is_null() {
        unsafe { DnsFree(records.cast(), DnsFreeRecordList) };
    }
    DnsCheck {
        elapsed_ms: resolved.then(|| (start.elapsed().as_millis() as u64).max(1)),
        flush_error,
        lookup_error: (!resolved).then(|| {
            if status == 0 {
                "The Windows resolver returned no records.".into()
            } else {
                std::io::Error::from_raw_os_error(status as i32).to_string()
            }
        }),
    }
}

#[derive(Clone, Copy)]
pub(crate) enum Tool {
    Netsh,
    Route,
    Arp,
    Nslookup,
    Ipconfig,
    Powercfg,
    Shutdown,
}

pub(crate) fn system_tool(
    tool: Tool,
    args: impl IntoIterator<Item = impl AsRef<std::ffi::OsStr>>,
) -> Result<String, String> {
    let program = match tool {
        Tool::Netsh => "netsh.exe",
        Tool::Route => "route.exe",
        Tool::Arp => "arp.exe",
        Tool::Nslookup => "nslookup.exe",
        Tool::Ipconfig => "ipconfig.exe",
        Tool::Powercfg => "powercfg.exe",
        Tool::Shutdown => "shutdown.exe",
    };
    let path = system_directory()?.join(program);
    let output = Command::new(path)
        .args(args)
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| format!("{program}: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let details = [stdout.as_str(), stderr.as_str()]
        .into_iter()
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if output.status.success() {
        return Ok(if details.is_empty() {
            "Completed.".into()
        } else {
            details
        });
    }
    Err(format!("{program} returned {}. {details}", output.status))
}

pub(crate) fn system_directory() -> Result<PathBuf, String> {
    let mut folder = [0u16; 1024];
    let length = unsafe { GetSystemDirectoryW(folder.as_mut_ptr(), folder.len() as u32) } as usize;
    if length == 0 || length >= folder.len() {
        return Err("Windows System32 directory could not be resolved.".into());
    }
    Ok(PathBuf::from(OsString::from_wide(&folder[..length])))
}

#[cfg(test)]
mod tests {
    use super::{Diagnostic, DiagnosticResult, diagnose, validate_alias, validate_target};

    #[test]
    fn one_port_check_connects_to_local_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let result = diagnose(Diagnostic::Port {
            target: "127.0.0.1".into(),
            port,
        })
        .unwrap();
        assert!(matches!(
            result,
            DiagnosticResult::Port {
                connected: true,
                ..
            }
        ));
    }

    #[test]
    fn diagnostic_targets_cannot_be_command_options() {
        for target in ["-type=any", "localhost & echo", "1.2.3.4:80", "a..b"] {
            assert!(validate_target(target).is_err());
        }
        for target in ["127.0.0.1", "::1", "host.example.", "_service.example"] {
            assert!(validate_target(target).is_ok());
        }
    }

    #[test]
    fn adapter_alias_cannot_add_options_or_wildcards() {
        assert!(validate_alias("Office LAN").is_ok());
        assert!(validate_alias("wired\" admin=disabled").is_err());
        assert!(validate_alias("Wi-*").is_err());
    }
}
