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
    let mut configs = native::all_network_configs();
    Ok(rows
        .into_iter()
        .map(|info| {
            let config = (info.index > 0)
                .then(|| configs.remove(&info.index))
                .flatten();
            ManagedAdapter { config, info }
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

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WifiTelemetry {
    pub connected: bool,
    pub interface_name: String,
    pub ssid: String,
    pub bssid: String,
    pub signal_pct: Option<u8>,
    pub rssi_dbm: Option<i32>,
    pub channel: String,
    pub band: String,
    pub radio_type: String,
    pub authentication: String,
    pub cipher: String,
    pub rx_rate: String,
    pub tx_rate: String,
    pub note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEntry {
    pub destination: String,
    pub netmask: String,
    pub gateway: String,
    pub interface: String,
    pub metric: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArpEntry {
    pub ip: String,
    pub mac: String,
    pub kind: String,
    pub interface: String,
    pub vendor: &'static str,
}

pub fn mac_vendor_hint(mac: &str) -> &'static str {
    let prefix: String = mac
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .take(6)
        .collect::<String>()
        .to_ascii_uppercase();
    match prefix.as_str() {
        "000393" | "001CB3" | "3C0754" | "A45E60" | "ACBC32" | "D0034B" | "F0DBE2" | "F45C89" => "Apple",
        "001B21" | "001E67" | "3C970E" | "4851B7" | "6805CA" | "8C8D28" | "A0369F" | "D89EF3" => "Intel",
        "00E04C" | "107B44" | "4CEDFB" | "525400" | "7085C2" | "80FA5B" | "D43D7E" | "E0D55E" => "Realtek / PC",
        "049226" | "08606E" | "10BF48" | "2CFDA1" | "38D547" | "50465D" | "704D7B" | "AC9E17" => "ASUSTek",
        "1C1B0D" | "408D5C" | "74D435" | "902B34" | "B42E99" | "D85ED3" | "E0D55F" => "Gigabyte",
        "002421" | "448A5B" | "4CCC6A" | "D8CB8A" => "MSI",
        "000C29" | "005056" => "VMware",
        "00155D" => "Microsoft Hyper-V",
        "00187D" | "001BD5" | "1C6A7A" | "58971E" => "Cisco",
        "0418D6" | "18E829" | "24A43C" | "44D9E7" | "7483C2" | "788A20" | "802AA8" | "F09FC2" => "Ubiquiti",
        "14CC20" | "50C7BF" | "60E327" | "98DED0" | "B0BE76" | "C025E9" | "D80D17" | "E894F6" => "TP-Link",
        "00146C" | "28C68E" | "4494FC" | "6CB0CE" | "A021B7" | "C40415" => "Netgear",
        "001132" => "Synology",
        "B827EB" | "DC4A3E" | "DCA632" | "E45F01" | "28CDC1" => "Raspberry Pi",
        "001788" => "Philips Hue",
        "30AEA4" | "240AC4" | "7C9EBD" | "A4CF12" | "C8C9A3" => "Espressif IoT",
        "001A11" | "3C5AB4" | "546009" | "F4F5D8" => "Google",
        "002590" | "0CC47A" | "AC1F6B" => "Supermicro",
        "001422" | "180373" | "24B6FD" | "B8CA3A" | "F8B156" => "Dell",
        "001E0B" | "3CD92B" | "70106F" | "9457A5" => "HP / HPE",
        "00163E" => "Xen / Virtual",
        _ => "",
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTables {
    pub wifi: String,
    pub routes: String,
    pub arp: String,
    pub wifi_parsed: WifiTelemetry,
    pub routes_parsed: Vec<RouteEntry>,
    pub arp_parsed: Vec<ArpEntry>,
}

pub fn parse_wifi_output(raw: &str) -> WifiTelemetry {
    let mut info = WifiTelemetry {
        ssid: "Disconnected / Ethernet Only".into(),
        ..WifiTelemetry::default()
    };
    let lower = raw.to_ascii_lowercase();
    if lower.contains("location permission") || lower.contains("error 5") {
        info.note = "Windows Location Privacy restricted WLAN details (enable Location or run elevated).".into();
        return info;
    }
    for line in raw.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let key = k.trim().to_ascii_lowercase();
        let val = v.trim();
        match key.as_str() {
            "name" => info.interface_name = val.to_owned(),
            "state" => info.connected = val.eq_ignore_ascii_case("connected"),
            "ssid" => info.ssid = val.to_owned(),
            "bssid" | "ap bssid" => info.bssid = val.to_owned(),
            "radio type" => info.radio_type = val.to_owned(),
            "band" => info.band = val.to_owned(),
            "authentication" => info.authentication = val.to_owned(),
            "cipher" => info.cipher = val.to_owned(),
            "channel" => info.channel = val.to_owned(),
            "receive rate (mbps)" => info.rx_rate = format!("{val} Mbps"),
            "transmit rate (mbps)" => info.tx_rate = format!("{val} Mbps"),
            "signal" => {
                if let Ok(pct) = val.trim_end_matches('%').trim().parse::<u8>() {
                    info.signal_pct = Some(pct.min(100));
                    info.rssi_dbm = Some((pct as i32) / 2 - 100);
                }
            }
            _ => {}
        }
    }
    if info.band.is_empty()
        && let Ok(ch) = info.channel.parse::<u32>()
    {
        info.band = if ch <= 14 {
            "2.4 GHz"
        } else if ch <= 177 {
            "5 GHz"
        } else {
            "6 GHz"
        }
        .into();
    }
    info
}

pub fn parse_ipv4_routes(raw: &str) -> Vec<RouteEntry> {
    let mut routes = Vec::new();
    let mut in_active = false;
    for line in raw.lines() {
        let t = line.trim();
        if t.starts_with("Network Destination") {
            in_active = true;
            continue;
        }
        if in_active && (t.starts_with("===") || t.starts_with("Persistent Routes")) {
            break;
        }
        if !in_active || t.is_empty() {
            continue;
        }
        let cols: Vec<&str> = t.split_whitespace().collect();
        if cols.len() >= 5 && cols[0].parse::<Ipv4Addr>().is_ok() {
            routes.push(RouteEntry {
                destination: cols[0].to_owned(),
                netmask: cols[1].to_owned(),
                gateway: cols[2].to_owned(),
                interface: cols[3].to_owned(),
                metric: cols[4].to_owned(),
            });
        }
    }
    routes
}

pub fn parse_arp_table(raw: &str) -> Vec<ArpEntry> {
    let mut entries = Vec::new();
    for line in raw.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() >= 3 && cols[0].parse::<Ipv4Addr>().is_ok() {
            let ip = cols[0];
            let mac = cols[1];
            if ip.starts_with("224.")
                || ip.starts_with("239.")
                || ip.starts_with("255.")
                || mac.eq_ignore_ascii_case("ff-ff-ff-ff-ff-ff")
            {
                continue;
            }
            entries.push(ArpEntry {
                ip: ip.to_owned(),
                mac: mac.to_ascii_uppercase(),
                kind: cols[2].to_owned(),
                interface: String::new(),
                vendor: mac_vendor_hint(mac),
            });
        }
    }
    entries
}

fn native_ipv4_routes(if_names: &std::collections::HashMap<u32, String>) -> Option<(Vec<RouteEntry>, String)> {
    use windows_sys::Win32::{
        NetworkManagement::IpHelper::{
            FreeMibTable, GetIpForwardTable2, MIB_IPFORWARD_ROW2, MIB_IPFORWARD_TABLE2,
        },
        Networking::WinSock::AF_INET,
    };
    let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
    if unsafe { GetIpForwardTable2(AF_INET, &mut table) } != 0 || table.is_null() {
        return None;
    }
    let rows = unsafe {
        let first = std::ptr::addr_of!((*table).Table).cast::<MIB_IPFORWARD_ROW2>();
        std::slice::from_raw_parts(first, (*table).NumEntries as usize)
    };
    let mut routes = Vec::with_capacity(rows.len());
    let mut raw = String::from("Destination        Netmask          Gateway          Interface            Metric\n");
    for row in rows {
        let dest = Ipv4Addr::from(unsafe { row.DestinationPrefix.Prefix.Ipv4.sin_addr.S_un.S_addr }.to_ne_bytes());
        let prefix = row.DestinationPrefix.PrefixLength.min(32);
        let mask_u32 = if prefix == 0 {
            0
        } else {
            u32::MAX.checked_shl(32 - u32::from(prefix)).unwrap_or(0)
        };
        let mask = Ipv4Addr::from(mask_u32);
        let gw = Ipv4Addr::from(unsafe { row.NextHop.Ipv4.sin_addr.S_un.S_addr }.to_ne_bytes());
        let gw_str = if gw.is_unspecified() {
            "On-link".to_owned()
        } else {
            gw.to_string()
        };
        let iface = if_names
            .get(&row.InterfaceIndex)
            .cloned()
            .unwrap_or_else(|| format!("If {}", row.InterfaceIndex));
        let metric = row.Metric.to_string();
        raw.push_str(&format!(
            "{dest:<18} {mask:<16} {gw_str:<16} {iface:<20} {metric}\n"
        ));
        routes.push(RouteEntry {
            destination: dest.to_string(),
            netmask: mask.to_string(),
            gateway: gw_str,
            interface: iface,
            metric,
        });
    }
    unsafe { FreeMibTable(table.cast()) };
    routes.sort_unstable_by(|a, b| {
        (a.destination != "0.0.0.0")
            .cmp(&(b.destination != "0.0.0.0"))
            .then_with(|| a.metric.parse::<u32>().unwrap_or(9999).cmp(&b.metric.parse::<u32>().unwrap_or(9999)))
            .then_with(|| a.destination.cmp(&b.destination))
    });
    Some((routes, raw))
}

fn native_ipv4_arp(if_names: &std::collections::HashMap<u32, String>) -> Option<(Vec<ArpEntry>, String)> {
    use windows_sys::Win32::{
        NetworkManagement::IpHelper::{
            FreeMibTable, GetIpNetTable2, MIB_IPNET_ROW2, MIB_IPNET_TABLE2,
        },
        Networking::WinSock::AF_INET,
    };
    let mut table: *mut MIB_IPNET_TABLE2 = std::ptr::null_mut();
    if unsafe { GetIpNetTable2(AF_INET, &mut table) } != 0 || table.is_null() {
        return None;
    }
    let rows = unsafe {
        let first = std::ptr::addr_of!((*table).Table).cast::<MIB_IPNET_ROW2>();
        std::slice::from_raw_parts(first, (*table).NumEntries as usize)
    };
    let mut entries = Vec::new();
    let mut raw = String::from("IP Address        MAC Address        State        Interface\n");
    for row in rows {
        let ip = Ipv4Addr::from(unsafe { row.Address.Ipv4.sin_addr.S_un.S_addr }.to_ne_bytes());
        if ip.is_multicast() || ip.is_broadcast() || ip.is_unspecified() {
            continue;
        }
        let mac_len = (row.PhysicalAddressLength as usize).min(row.PhysicalAddress.len());
        if mac_len != 6 {
            continue;
        }
        let bytes = &row.PhysicalAddress[..6];
        if bytes.iter().all(|&b| b == 0) || bytes.iter().all(|&b| b == 0xFF) {
            continue;
        }
        let mac = format!(
            "{:02X}-{:02X}-{:02X}-{:02X}-{:02X}-{:02X}",
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]
        );
        let state = match row.State {
            0 => "Unreachable",
            1 => "Incomplete",
            2 => "Probe",
            3 => "Delay",
            4 => "Stale",
            5 => "Reachable",
            6 => "Permanent",
            _ => "Dynamic",
        };
        let iface = if_names
            .get(&row.InterfaceIndex)
            .cloned()
            .unwrap_or_else(|| format!("If {}", row.InterfaceIndex));
        let vendor = mac_vendor_hint(&mac);
        raw.push_str(&format!("{ip:<17} {mac:<18} {state:<12} {iface}\n"));
        entries.push(ArpEntry {
            ip: ip.to_string(),
            mac,
            kind: state.to_owned(),
            interface: iface,
            vendor,
        });
    }
    unsafe { FreeMibTable(table.cast()) };
    entries.sort_unstable_by(|a, b| a.ip.cmp(&b.ip));
    Some((entries, raw))
}

pub fn tables() -> NetworkTables {
    let if_names: std::collections::HashMap<u32, String> = native::adapters()
        .unwrap_or_default()
        .into_iter()
        .map(|a| (a.index, a.name))
        .collect();
    let (wifi, routes_opt, arp_opt) = thread::scope(|s| {
        let w = s.spawn(|| {
            system_tool(Tool::Netsh, ["wlan", "show", "interfaces"])
                .unwrap_or_else(|error| error)
        });
        let r = s.spawn(|| native_ipv4_routes(&if_names));
        let a = s.spawn(|| native_ipv4_arp(&if_names));
        (
            w.join().unwrap_or_default(),
            r.join().ok().flatten(),
            a.join().ok().flatten(),
        )
    });
    let (routes_parsed, routes) = routes_opt.unwrap_or_else(|| {
        let raw = system_tool(Tool::Route, ["print", "-4"]).unwrap_or_else(|e| e);
        (parse_ipv4_routes(&raw), raw)
    });
    let (arp_parsed, arp) = arp_opt.unwrap_or_else(|| {
        let raw = system_tool(Tool::Arp, ["-a"]).unwrap_or_else(|e| e);
        (parse_arp_table(&raw), raw)
    });
    NetworkTables {
        wifi_parsed: parse_wifi_output(&wifi),
        routes_parsed,
        arp_parsed,
        wifi,
        routes,
        arp,
    }
}

pub fn port_service_hint(port: u16) -> &'static str {
    match port {
        20 => "FTP-Data",
        21 => "FTP",
        22 => "SSH",
        23 => "Telnet",
        25 => "SMTP",
        53 => "DNS",
        67 | 68 => "DHCP",
        80 => "HTTP",
        110 => "POP3",
        123 => "NTP",
        135 => "RPC",
        139 => "NetBIOS",
        143 => "IMAP",
        161 => "SNMP",
        389 => "LDAP",
        443 => "HTTPS",
        445 => "SMB",
        587 => "SMTP-TLS",
        636 => "LDAPS",
        1433 => "MSSQL",
        3306 => "MySQL",
        3389 => "RDP",
        5432 => "PostgreSQL",
        5900 => "VNC",
        5985 => "WinRM-HTTP",
        5986 => "WinRM-HTTPS",
        6379 => "Redis",
        6742 => "OpenRGB SDK",
        8080 => "HTTP-Alt",
        8443 => "HTTPS-Alt",
        _ => "Custom",
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
        #[serde(default)]
        port: u16,
        #[serde(default)]
        ports: Vec<u16>,
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
    Srv,
    Any,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecordRow {
    pub name: String,
    pub rtype: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortProbe {
    pub port: u16,
    pub service: &'static str,
    pub address: SocketAddr,
    pub connected: bool,
    pub elapsed_ms: u128,
    pub message: String,
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
        probes: Vec<PortProbe>,
    },
    Dns {
        output: String,
        records: Vec<DnsRecordRow>,
        elapsed_ms: u128,
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
            // Parallel reverse DNS lookup for unique hop IPs (fast native WinSock GetNameInfoW)
            let unique_ips: Vec<Ipv4Addr> = {
                let mut v = Vec::new();
                for r in &replies {
                    if let Some(ip) = r.address
                        && !v.contains(&ip)
                    {
                        v.push(ip);
                    }
                }
                v
            };
            let resolved: std::collections::HashMap<Ipv4Addr, String> = thread::scope(|s| {
                let handles: Vec<_> = unique_ips
                    .into_iter()
                    .map(|ip| s.spawn(move || (ip, reverse_dns_ipv4(ip))))
                    .collect();
                let mut map = std::collections::HashMap::new();
                for h in handles {
                    if let Ok((ip, Some(host))) = h.join() {
                        map.insert(ip, host);
                    }
                }
                map
            });
            for r in &mut replies {
                if let Some(ip) = r.address {
                    r.hostname = resolved.get(&ip).cloned();
                }
            }
            Ok(DiagnosticResult::Trace { address, replies })
        }
        Diagnostic::Port {
            target,
            port,
            ports,
        } => {
            let mut list: Vec<u16> = if !ports.is_empty() {
                ports.into_iter().filter(|&p| p > 0).take(16).collect()
            } else if port > 0 {
                vec![port]
            } else {
                Vec::new()
            };
            list.dedup();
            if list.is_empty() {
                return Err("Enter one or more TCP ports from 1 to 65535.".into());
            }
            let base_ip = resolve(&target, list[0])?
                .into_iter()
                .next()
                .ok_or("No address returned by DNS.")?
                .ip();
            let handles: Vec<_> = list
                .into_iter()
                .map(|p| {
                    thread::spawn(move || {
                        let addr = SocketAddr::new(base_ip, p);
                        let start = Instant::now();
                        let res = TcpStream::connect_timeout(&addr, Duration::from_millis(1700));
                        let elapsed_ms = start.elapsed().as_millis();
                        let connected = res.is_ok();
                        let message = res.err().map_or_else(
                            || "Open (TCP handshake succeeded)".into(),
                            |error| error.to_string(),
                        );
                        PortProbe {
                            port: p,
                            service: port_service_hint(p),
                            address: addr,
                            connected,
                            elapsed_ms,
                            message,
                        }
                    })
                })
                .collect();
            let mut probes = Vec::with_capacity(handles.len());
            for handle in handles {
                if let Ok(probe) = handle.join() {
                    probes.push(probe);
                }
            }
            let first = probes.first().ok_or("Port probe failed.")?;
            Ok(DiagnosticResult::Port {
                address: first.address,
                connected: first.connected,
                elapsed_ms: first.elapsed_ms,
                message: first.message.clone(),
                probes,
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
            let rtype_str = format!("{record:?}").to_ascii_uppercase();
            let mut args = vec![
                "-timeout=2".to_owned(),
                "-retry=1".to_owned(),
                format!("-type={rtype_str}"),
                dns_name.clone(),
            ];
            if let Some(server) = server {
                args.push(server.to_string());
            }
            let start = Instant::now();
            system_tool(Tool::Nslookup, args).map(|output| {
                let records = parse_nslookup_records(&output, &dns_name, &rtype_str);
                DiagnosticResult::Dns {
                    output,
                    records,
                    elapsed_ms: start.elapsed().as_millis(),
                }
            })
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

fn reverse_dns_ipv4(ip: Ipv4Addr) -> Option<String> {
    use windows_sys::Win32::Networking::WinSock::{
        AF_INET, GetNameInfoW, IN_ADDR, IN_ADDR_0, NI_NAMEREQD, SOCKADDR_IN,
    };
    let sa = SOCKADDR_IN {
        sin_family: AF_INET,
        sin_port: 0,
        sin_addr: IN_ADDR {
            S_un: IN_ADDR_0 {
                S_addr: u32::from_ne_bytes(ip.octets()),
            },
        },
        sin_zero: [0; 8],
    };
    let mut host = [0u16; 256];
    let rc = unsafe {
        GetNameInfoW(
            (&sa as *const SOCKADDR_IN).cast(),
            std::mem::size_of::<SOCKADDR_IN>() as i32,
            host.as_mut_ptr(),
            host.len() as u32,
            std::ptr::null_mut(),
            0,
            NI_NAMEREQD as i32,
        )
    };
    if rc != 0 {
        return None;
    }
    let len = host.iter().position(|&c| c == 0).unwrap_or(host.len());
    let name = String::from_utf16_lossy(&host[..len]).trim().to_owned();
    (!name.is_empty() && name != ip.to_string()).then_some(name)
}

fn parse_nslookup_records(raw: &str, default_name: &str, rtype: &str) -> Vec<DnsRecordRow> {
    let mut rows = Vec::new();
    let mut current_name = default_name.to_owned();
    let mut after_header = false;
    let mut collecting_addrs = false;
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() {
            collecting_addrs = false;
            continue;
        }
        if t.starts_with("Server:") || t.starts_with("Address:") && !after_header {
            continue;
        }
        if t.starts_with("Non-authoritative answer:") || t.starts_with("Authoritative answers") {
            after_header = true;
            continue;
        }
        after_header = true;
        if let Some(rest) = t.strip_prefix("Name:") {
            current_name = rest.trim().to_owned();
            collecting_addrs = false;
            continue;
        }
        if let Some(rest) = t.strip_prefix("Addresses:").or_else(|| t.strip_prefix("Address:")) {
            collecting_addrs = true;
            let val = rest.trim();
            if !val.is_empty() {
                rows.push(DnsRecordRow {
                    name: current_name.clone(),
                    rtype: rtype.to_owned(),
                    value: val.to_owned(),
                });
            }
            continue;
        }
        if collecting_addrs && (t.parse::<IpAddr>().is_ok() || t.contains(':')) {
            rows.push(DnsRecordRow {
                name: current_name.clone(),
                rtype: rtype.to_owned(),
                value: t.to_owned(),
            });
            continue;
        }
        if let Some((lhs, rhs)) = t.split_once('=') {
            let key = lhs.trim();
            let val = rhs.trim().trim_matches('"');
            if !val.is_empty() && !key.starts_with("Server") {
                rows.push(DnsRecordRow {
                    name: current_name.clone(),
                    rtype: key.to_owned(),
                    value: val.to_owned(),
                });
            }
        }
    }
    rows
}

struct Icmp(HANDLE);

#[derive(Serialize)]
pub struct EchoReply {
    sequence: u8,
    address: Option<Ipv4Addr>,
    pub(crate) ms: Option<u32>,
    pub(crate) status: u32,
    ttl: Option<u8>,
    hostname: Option<String>,
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
                ttl: None,
                hostname: None,
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
            ttl: (reply.Status == IP_SUCCESS).then_some(reply.Options.Ttl),
            hostname: None,
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
    use super::{
        Diagnostic, DiagnosticResult, diagnose, parse_arp_table, parse_ipv4_routes,
        parse_wifi_output, port_service_hint, validate_alias, validate_target,
    };

    #[test]
    fn one_port_check_connects_to_local_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let result = diagnose(Diagnostic::Port {
            target: "127.0.0.1".into(),
            port,
            ports: Vec::new(),
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
    fn parses_wifi_routes_and_arp_tables() {
        let wifi = parse_wifi_output(
            "    Name : Wi-Fi\n    State : connected\n    SSID : HomeLab5G\n    Channel : 36\n    Signal : 86%\n",
        );
        assert!(wifi.connected);
        assert_eq!(wifi.ssid, "HomeLab5G");
        assert_eq!(wifi.band, "5 GHz");
        assert_eq!(wifi.signal_pct, Some(86));
        assert_eq!(wifi.rssi_dbm, Some(-57));

        let routes = parse_ipv4_routes(
            "Network Destination Netmask Gateway Interface Metric\n  0.0.0.0 0.0.0.0 192.168.1.1 192.168.1.50 25\n=====",
        );
        assert_eq!(routes.len(), 1);
        assert_eq!(routes[0].gateway, "192.168.1.1");

        let arp = parse_arp_table(
            "  192.168.1.1  aa-bb-cc-dd-ee-ff  dynamic\n  224.0.0.22  01-00-5e-00-00-16  static\n",
        );
        assert_eq!(arp.len(), 1);
        assert_eq!(arp[0].mac, "AA-BB-CC-DD-EE-FF");
        assert_eq!(port_service_hint(443), "HTTPS");
        assert_eq!(port_service_hint(6742), "OpenRGB SDK");
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
