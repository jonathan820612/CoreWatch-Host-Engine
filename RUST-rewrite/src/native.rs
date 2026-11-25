use serde::Serialize;
use std::{collections::HashMap, mem, net::Ipv4Addr, ptr, slice};
use windows_sys::Win32::{
    Foundation::{GetLastError, LocalFree, RECT},
    Graphics::Gdi::{
        DEVMODEW, DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICE_PRIMARY_DEVICE, DISPLAY_DEVICEW, DMDO_90,
        DMDO_180, DMDO_270, ENUM_CURRENT_SETTINGS, EnumDisplayDevicesW, EnumDisplayMonitors,
        EnumDisplaySettingsW, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW,
    },
    NetworkManagement::{
        IpHelper::{
            FreeMibTable, GetIfTable2, GetIpNetEntry2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
            IF_TYPE_SOFTWARE_LOOPBACK, IF_TYPE_TUNNEL, MIB_IF_TABLE2, MIB_IPNET_ROW2,
        },
        Ndis::{IfOperStatusNotPresent, IfOperStatusUp, NET_IF_ADMIN_STATUS_UP},
        WiFi::*,
    },
    Networking::WinSock::{AF_INET, IN_ADDR, IN_ADDR_0, SOCKADDR_IN},
    System::{
        EventLog::*,
        Power::{PowerGetActiveScheme, PowerReadFriendlyName},
    },
    UI::{
        HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
        Shell::IsUserAnAdmin,
    },
};
use windows_sys::core::GUID;

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain([0]).collect()
}

fn utf16(text: &[u16]) -> String {
    let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    String::from_utf16_lossy(&text[..end])
}

#[derive(Serialize)]
pub struct Adapter {
    pub index: u32,
    pub name: String,
    pub description: String,
    pub kind: &'static str,
    pub online: bool,
    pub enabled: bool,
    pub physical: bool,
    pub mac: Option<String>,
    pub link_bps: u64,
    #[serde(skip)]
    pub counters: (u64, u64),
    #[serde(skip)]
    pub luid: u64,
    #[serde(skip)]
    pub eligible: bool,
}

pub fn adapters() -> Option<Vec<Adapter>> {
    // The OS owns the variable-length table until FreeMibTable.
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = ptr::null_mut();
        if GetIfTable2(&mut table) != 0 || table.is_null() {
            return None;
        }
        let first = ptr::addr_of!((*table).Table).cast();
        let rows = slice::from_raw_parts(first, (*table).NumEntries as usize);
        let result = rows
            .iter()
            .filter(
                |row: &&windows_sys::Win32::NetworkManagement::IpHelper::MIB_IF_ROW2| {
                    !matches!(row.Type, IF_TYPE_SOFTWARE_LOOPBACK | IF_TYPE_TUNNEL)
                        && row.InterfaceAndOperStatusFlags._bitfield & 2 == 0
                        && row.OperStatus != IfOperStatusNotPresent
                },
            )
            .map(|row| {
                let name = utf16(&row.Alias);
                let description = utf16(&row.Description);
                let physical = row.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
                let speed = [row.ReceiveLinkSpeed, row.TransmitLinkSpeed]
                    .into_iter()
                    .filter(|speed| *speed != u64::MAX)
                    .max()
                    .unwrap_or(0);
                Adapter {
                    index: row.InterfaceIndex,
                    name,
                    description,
                    kind: match row.Type {
                        IF_TYPE_IEEE80211 => "Wi-Fi",
                        IF_TYPE_ETHERNET_CSMACD => "Ethernet",
                        _ => "Other",
                    },
                    online: row.OperStatus == IfOperStatusUp,
                    enabled: row.AdminStatus == NET_IF_ADMIN_STATUS_UP,
                    physical,
                    mac: row
                        .PhysicalAddress
                        .get(..row.PhysicalAddressLength as usize)
                        .and_then(format_mac),
                    link_bps: speed,
                    counters: (row.InOctets, row.OutOctets),
                    luid: row.InterfaceLuid.Value,
                    eligible: physical,
                }
            })
            .collect();
        FreeMibTable(table.cast());
        Some(result)
    }
}

pub fn default_ipv4_route(adapters: &[Adapter]) -> Option<(u32, Option<Ipv4Addr>)> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetIpForwardTable2, GetIpInterfaceEntry, MIB_IPFORWARD_ROW2, MIB_IPFORWARD_TABLE2,
        MIB_IPINTERFACE_ROW,
    };
    // Windows combines route and interface metrics when choosing among equal prefixes.
    unsafe {
        let mut table: *mut MIB_IPFORWARD_TABLE2 = ptr::null_mut();
        if GetIpForwardTable2(AF_INET, &mut table) != 0 || table.is_null() {
            return None;
        }
        let first = ptr::addr_of!((*table).Table).cast::<MIB_IPFORWARD_ROW2>();
        let routes = slice::from_raw_parts(first, (*table).NumEntries as usize);
        let best = routes
            .iter()
            .filter_map(|route| {
                let index = route.InterfaceIndex;
                if route.DestinationPrefix.PrefixLength != 0
                    || !adapters
                        .iter()
                        .any(|adapter| adapter.index == index && adapter.online)
                {
                    return None;
                }
                let mut interface = MIB_IPINTERFACE_ROW {
                    Family: AF_INET,
                    InterfaceIndex: index,
                    ..Default::default()
                };
                if GetIpInterfaceEntry(&mut interface) != 0 {
                    return None;
                }
                let gateway = (route.NextHop.si_family == AF_INET)
                    .then(|| Ipv4Addr::from(route.NextHop.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()))
                    .filter(|address| !address.is_unspecified());
                Some((
                    u64::from(route.Metric) + u64::from(interface.Metric),
                    index,
                    gateway,
                ))
            })
            .min_by_key(|&(metric, index, _)| (metric, index));
        FreeMibTable(table.cast());
        best.map(|(_, index, gateway)| (index, gateway))
    }
}

#[derive(Serialize)]
pub struct GatewayNeighbor {
    pub state: &'static str,
    pub mac: Option<String>,
}

pub fn gateway_neighbor(
    gateway: Ipv4Addr,
    index: u32,
    refresh: bool,
) -> Result<GatewayNeighbor, String> {
    use windows_sys::Win32::{
        NetworkManagement::IpHelper::ResolveIpNetEntry2,
        Networking::WinSock::{
            NlnsDelay as NLNS_DELAY, NlnsIncomplete as NLNS_INCOMPLETE,
            NlnsPermanent as NLNS_PERMANENT, NlnsProbe as NLNS_PROBE,
            NlnsReachable as NLNS_REACHABLE, NlnsStale as NLNS_STALE,
            NlnsUnreachable as NLNS_UNREACHABLE,
        },
    };
    let mut row = MIB_IPNET_ROW2 {
        InterfaceIndex: index,
        ..Default::default()
    };
    row.Address.Ipv4 = SOCKADDR_IN {
        sin_family: AF_INET,
        sin_addr: IN_ADDR {
            S_un: IN_ADDR_0 {
                S_addr: u32::from_ne_bytes(gateway.octets()),
            },
        },
        ..Default::default()
    };
    let status = unsafe {
        if refresh {
            ResolveIpNetEntry2(&mut row, ptr::null())
        } else {
            GetIpNetEntry2(&mut row)
        }
    };
    if status != 0 {
        return Err(std::io::Error::from_raw_os_error(status as i32).to_string());
    }
    let state = match row.State {
        NLNS_REACHABLE => "Reachable",
        NLNS_PERMANENT => "Permanent",
        NLNS_STALE => "Stale",
        NLNS_DELAY => "Delay",
        NLNS_PROBE => "Probing",
        NLNS_INCOMPLETE => "Incomplete",
        NLNS_UNREACHABLE => "Unreachable",
        _ => "Unknown",
    };
    Ok(GatewayNeighbor {
        state,
        mac: row
            .PhysicalAddress
            .get(..row.PhysicalAddressLength as usize)
            .and_then(format_mac),
    })
}

fn format_mac(address: &[u8]) -> Option<String> {
    address.iter().any(|&byte| byte != 0).then(|| {
        address
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<Vec<_>>()
            .join(":")
    })
}

pub fn wifi_ssid() -> Option<String> {
    // Windows may restrict current_connection behind Location permission.
    unsafe {
        let mut version = 0;
        let mut client = ptr::null_mut();
        if WlanOpenHandle(2, ptr::null(), &mut version, &mut client) != 0 {
            return None;
        }
        let mut list = ptr::null_mut();
        let mut ssid = None;
        if WlanEnumInterfaces(client, ptr::null(), &mut list) == 0 && !list.is_null() {
            let first = ptr::addr_of!((*list).InterfaceInfo).cast::<WLAN_INTERFACE_INFO>();
            let interfaces = slice::from_raw_parts(first, (*list).dwNumberOfItems as usize);
            for interface in interfaces
                .iter()
                .filter(|item| item.isState == wlan_interface_state_connected)
            {
                let mut size = 0;
                let mut data = ptr::null_mut();
                if WlanQueryInterface(
                    client,
                    &interface.InterfaceGuid,
                    wlan_intf_opcode_current_connection,
                    ptr::null(),
                    &mut size,
                    &mut data,
                    ptr::null_mut(),
                ) != 0
                    || data.is_null()
                {
                    continue;
                }
                if size as usize >= mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>() {
                    let info = &*data.cast::<WLAN_CONNECTION_ATTRIBUTES>();
                    let value = &info.wlanAssociationAttributes.dot11Ssid;
                    ssid = value
                        .ucSSID
                        .get(..value.uSSIDLength as usize)
                        .filter(|bytes| !bytes.is_empty())
                        .map(|bytes| String::from_utf8_lossy(bytes).into_owned());
                }
                WlanFreeMemory(data);
                if ssid.is_some() {
                    break;
                }
            }
            WlanFreeMemory(list.cast());
        }
        WlanCloseHandle(client, ptr::null());
        ssid
    }
}

#[derive(Serialize)]
pub struct Display {
    pub id: String,
    pub name: String,
    pub resolution: String,
    pub refresh_hz: Option<f64>,
    pub orientation: &'static str,
    pub scale: Option<u32>,
    pub connection: Option<&'static str>,
    pub advanced_color: Option<&'static str>,
    pub color_profile: Option<String>,
    pub primary: bool,
    #[serde(skip)]
    pub position: (i32, i32),
}

pub fn displays() -> Vec<Display> {
    let mut scales = HashMap::<String, u32>::new();
    let mut displays = Vec::new();
    let targets = display_targets();
    // The callback only writes to the map during this synchronous enumeration.
    unsafe {
        EnumDisplayMonitors(
            ptr::null_mut(),
            ptr::null(),
            Some(monitor_scale),
            (&mut scales as *mut HashMap<_, _>) as isize,
        );
        for i in 0.. {
            let mut adapter = DISPLAY_DEVICEW {
                cb: mem::size_of::<DISPLAY_DEVICEW>() as u32,
                ..Default::default()
            };
            if EnumDisplayDevicesW(ptr::null(), i, &mut adapter, 0) == 0 {
                break;
            }
            if adapter.StateFlags & DISPLAY_DEVICE_ACTIVE == 0 {
                continue;
            }
            let mut mode = DEVMODEW {
                dmSize: mem::size_of::<DEVMODEW>() as u16,
                ..Default::default()
            };
            if EnumDisplaySettingsW(
                adapter.DeviceName.as_ptr(),
                ENUM_CURRENT_SETTINGS,
                &mut mode,
            ) == 0
            {
                continue;
            }
            let mut monitor = DISPLAY_DEVICEW {
                cb: mem::size_of::<DISPLAY_DEVICEW>() as u32,
                ..Default::default()
            };
            let id = utf16(&adapter.DeviceName);
            let target = targets.get(&id);
            let fallback_name =
                if EnumDisplayDevicesW(adapter.DeviceName.as_ptr(), 0, &mut monitor, 0) != 0 {
                    utf16(&monitor.DeviceString)
                } else {
                    id.clone()
                };
            let mode_flags = mode.Anonymous1.Anonymous2;
            let orientation = match mode_flags.dmDisplayOrientation {
                DMDO_90 => "Portrait",
                DMDO_180 => "Landscape (flipped)",
                DMDO_270 => "Portrait (flipped)",
                _ => "Landscape",
            };
            displays.push(Display {
                scale: target
                    .and_then(|target| display_scale(target).ok().map(|scale| scale.current))
                    .or_else(|| scales.get(&id).copied()),
                id,
                name: target
                    .and_then(|target| target.name.clone())
                    .unwrap_or(fallback_name),
                resolution: format!("{} × {}", mode.dmPelsWidth, mode.dmPelsHeight),
                refresh_hz: target.and_then(|target| target.refresh_hz).or_else(|| {
                    (mode.dmDisplayFrequency > 1).then_some(f64::from(mode.dmDisplayFrequency))
                }),
                connection: target.map(|target| target.connection),
                advanced_color: target.and_then(|target| target.advanced_color),
                color_profile: color_profile(&adapter.DeviceName),
                primary: adapter.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0,
                position: (mode_flags.dmPosition.x, mode_flags.dmPosition.y),
                orientation,
            });
        }
    }
    displays
}

unsafe extern "system" fn monitor_scale(
    monitor: HMONITOR,
    _: HDC,
    _: *mut RECT,
    data: isize,
) -> i32 {
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;
    let (mut x, mut y) = (0, 0);
    unsafe {
        if GetMonitorInfoW(monitor, &mut info.monitorInfo) != 0
            && GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut x, &mut y) == 0
        {
            let scales = &mut *(data as *mut HashMap<String, u32>);
            scales.insert(utf16(&info.szDevice), (x * 100 + 48) / 96);
        }
    }
    1
}

pub fn elevated() -> bool {
    unsafe { IsUserAnAdmin() != 0 }
}

pub fn power_plan() -> Option<String> {
    unsafe {
        let mut scheme: *mut GUID = ptr::null_mut();
        if PowerGetActiveScheme(ptr::null_mut(), &mut scheme) != 0 || scheme.is_null() {
            return None;
        }
        let mut size = 0;
        PowerReadFriendlyName(
            ptr::null_mut(),
            scheme,
            ptr::null(),
            ptr::null(),
            ptr::null_mut(),
            &mut size,
        );
        let mut name = vec![0u16; (size as usize).div_ceil(2)];
        let status = PowerReadFriendlyName(
            ptr::null_mut(),
            scheme,
            ptr::null(),
            ptr::null(),
            name.as_mut_ptr().cast(),
            &mut size,
        );
        LocalFree(scheme.cast());
        (status == 0).then(|| utf16(&name))
    }
}

struct Event(EVT_HANDLE);

impl Drop for Event {
    fn drop(&mut self) {
        unsafe { EvtClose(self.0) };
    }
}

pub fn last_crash() -> Option<String> {
    unsafe {
        let channel = wide("System");
        let filter = wide(
            "*[System[(Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=41) or (Provider[@Name='Microsoft-Windows-WER-SystemErrorReporting'] and EventID=1001)]]",
        );
        let query = EvtQuery(
            0,
            channel.as_ptr(),
            filter.as_ptr(),
            EvtQueryChannelPath | EvtQueryReverseDirection,
        );
        if query == 0 {
            return None;
        }
        let query = Event(query);
        let (mut handle, mut count) = (0, 0);
        if EvtNext(query.0, 1, &mut handle, 1000, 0, &mut count) == 0 {
            return (GetLastError() == 259).then(|| "None recorded".to_owned());
        }
        let event = Event(handle);
        let (mut size, mut fields) = (0, 0);
        EvtRender(
            0,
            event.0,
            EvtRenderEventXml,
            0,
            ptr::null_mut(),
            &mut size,
            &mut fields,
        );
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        if EvtRender(
            0,
            event.0,
            EvtRenderEventXml,
            size,
            buffer.as_mut_ptr().cast(),
            &mut size,
            &mut fields,
        ) == 0
        {
            return None;
        }
        let xml = utf16(&buffer);
        let time = xml
            .split_once("SystemTime='")
            .or_else(|| xml.split_once("SystemTime=\""))?
            .1;
        let stamp = time.get(..19)?.replace('T', " ");
        let tag = if xml.contains("<EventID>41</EventID>") {
            "KP-41"
        } else if xml.contains("<EventID>1001</EventID>") {
            "BSOD 1001"
        } else {
            return Some(format!("{stamp} UTC"));
        };
        Some(format!("{stamp} UTC ({tag})"))
    }
}

pub fn memory_commit() -> Option<(u64, u64)> {
    use windows_sys::Win32::System::ProcessStatus::{GetPerformanceInfo, PERFORMANCE_INFORMATION};
    let size = mem::size_of::<PERFORMANCE_INFORMATION>() as u32;
    let mut info = PERFORMANCE_INFORMATION {
        cb: size,
        ..Default::default()
    };
    (unsafe { GetPerformanceInfo(&mut info, size) } != 0).then(|| {
        (
            (info.CommitTotal * info.PageSize) as u64,
            (info.CommitLimit * info.PageSize) as u64,
        )
    })
}

struct DisplayTarget {
    name: Option<String>,
    connection: &'static str,
    refresh_hz: Option<f64>,
    advanced_color: Option<&'static str>,
    hdr_api: bool,
    adapter: windows_sys::Win32::Foundation::LUID,
    target_id: u32,
    source_adapter: windows_sys::Win32::Foundation::LUID,
    source_id: u32,
}

fn display_targets() -> HashMap<String, DisplayTarget> {
    use windows_sys::Win32::{
        Devices::Display::*,
        Foundation::{ERROR_INSUFFICIENT_BUFFER, LUID},
    };
    #[repr(C)]
    struct AdvancedColorInfo2 {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER,
        flags: u32,
        encoding: i32,
        bits_per_channel: u32,
        mode: i32,
    }
    fn header<T>(
        kind: DISPLAYCONFIG_DEVICE_INFO_TYPE,
        adapter: LUID,
        id: u32,
    ) -> DISPLAYCONFIG_DEVICE_INFO_HEADER {
        DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type: kind,
            adapterId: adapter,
            id,
            size: mem::size_of::<T>() as u32,
        }
    }

    // The active path can change between sizing and reading; retry a hot-plug once.
    for _ in 0..2 {
        let (mut path_count, mut mode_count) = (0, 0);
        unsafe {
            if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
                != 0
            {
                break;
            }
            let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
            let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
            let result = QueryDisplayConfig(
                QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                ptr::null_mut(),
            );
            if result == ERROR_INSUFFICIENT_BUFFER {
                continue;
            }
            if result != 0 {
                break;
            }
            paths.truncate(path_count as usize);
            let mut targets = HashMap::new();
            for path in paths {
                let source = path.sourceInfo;
                let target = path.targetInfo;
                let mut source_name = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
                    header: header::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>(
                        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                        source.adapterId,
                        source.id,
                    ),
                    ..Default::default()
                };
                if DisplayConfigGetDeviceInfo(&mut source_name.header) != 0 {
                    continue;
                }
                let mut target_name = DISPLAYCONFIG_TARGET_DEVICE_NAME {
                    header: header::<DISPLAYCONFIG_TARGET_DEVICE_NAME>(
                        DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
                        target.adapterId,
                        target.id,
                    ),
                    ..Default::default()
                };
                let name = (DisplayConfigGetDeviceInfo(&mut target_name.header) == 0)
                    .then(|| utf16(&target_name.monitorFriendlyDeviceName))
                    .filter(|name| !name.is_empty());
                let mut hdr = AdvancedColorInfo2 {
                    header: header::<AdvancedColorInfo2>(15, target.adapterId, target.id),
                    flags: 0,
                    encoding: 0,
                    bits_per_channel: 0,
                    mode: 0,
                };
                let hdr_api = DisplayConfigGetDeviceInfo(&mut hdr.header) == 0;
                let advanced_color = if hdr_api {
                    Some(if hdr.flags & 0x10 == 0 {
                        "Unsupported"
                    } else if hdr.flags & 0x08 != 0 {
                        "Managed"
                    } else if hdr.flags & 0x20 != 0 || hdr.mode == 2 {
                        "On"
                    } else {
                        "Off"
                    })
                } else {
                    let mut info = DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO {
                        header: header::<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>(
                            DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
                            target.adapterId,
                            target.id,
                        ),
                        ..Default::default()
                    };
                    (DisplayConfigGetDeviceInfo(&mut info.header) == 0).then(|| {
                        let flags = info.Anonymous.value;
                        if flags & 2 != 0 {
                            "On"
                        } else if flags & 1 != 0 {
                            "Off"
                        } else {
                            "Unsupported"
                        }
                    })
                };
                let connection = match target.outputTechnology {
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI => "HDMI",
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL
                    | DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL => "DisplayPort",
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED => "Embedded DisplayPort",
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI => "DVI",
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL => "Internal",
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST => "Miracast",
                    DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15 => "VGA",
                    _ => "Other",
                };
                let rate = target.refreshRate;
                targets
                    .entry(utf16(&source_name.viewGdiDeviceName))
                    .or_insert(DisplayTarget {
                        name,
                        connection,
                        refresh_hz: (rate.Numerator > 0 && rate.Denominator > 0)
                            .then(|| f64::from(rate.Numerator) / f64::from(rate.Denominator)),
                        advanced_color,
                        hdr_api,
                        adapter: target.adapterId,
                        target_id: target.id,
                        source_adapter: source.adapterId,
                        source_id: source.id,
                    });
            }
            return targets;
        }
    }
    HashMap::new()
}

const DPI_SCALES: [u32; 12] = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500];

#[derive(Serialize)]
pub struct DisplayScale {
    pub current: u32,
    pub available: &'static [u32],
    recommended: i32,
}

#[repr(C)]
struct ScaleRequest<const N: usize> {
    header: windows_sys::Win32::Devices::Display::DISPLAYCONFIG_DEVICE_INFO_HEADER,
    values: [i32; N],
}

impl<const N: usize> ScaleRequest<N> {
    fn new(target: &DisplayTarget, kind: i32, values: [i32; N]) -> Self {
        Self {
            header: windows_sys::Win32::Devices::Display::DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: kind,
                size: mem::size_of::<Self>() as u32,
                adapterId: target.source_adapter,
                id: target.source_id,
            },
            values,
        }
    }
}

fn display_scale(target: &DisplayTarget) -> Result<DisplayScale, String> {
    use windows_sys::Win32::Devices::Display::DisplayConfigGetDeviceInfo;
    // Windows uses signed relative steps from the recommended scale in this CCD request.
    let mut request = ScaleRequest::new(target, -3, [0; 3]);
    let result = unsafe { DisplayConfigGetDeviceInfo(&mut request.header) };
    if result != 0 {
        return Err(format!(
            "Windows did not expose scale options for this display ({result})."
        ));
    }
    let [min, current, max] = request.values;
    let indices = || {
        let recommended = min.checked_neg()?;
        let index = usize::try_from(recommended.checked_add(current)?).ok()?;
        let last = usize::try_from(recommended.checked_add(max)?).ok()?;
        (min <= 0 && max >= 0 && index <= last && last < DPI_SCALES.len()).then_some((
            recommended,
            index,
            last,
        ))
    };
    let (recommended, index, last) =
        indices().ok_or("Windows returned an invalid display scale range.")?;
    Ok(DisplayScale {
        current: DPI_SCALES[index],
        available: &DPI_SCALES[..=last],
        recommended,
    })
}

pub fn display_scale_options(id: &str) -> Result<DisplayScale, String> {
    let targets = display_targets();
    display_scale(
        targets
            .get(id)
            .ok_or("The selected display is no longer active.")?,
    )
}

pub fn set_display_scale(id: &str, percent: u32) -> Result<(), String> {
    use windows_sys::Win32::Devices::Display::DisplayConfigSetDeviceInfo;
    let targets = display_targets();
    let target = targets
        .get(id)
        .ok_or("The selected display is no longer active.")?;
    let scale = display_scale(target)?;
    let index = scale
        .available
        .iter()
        .position(|&item| item == percent)
        .ok_or("The selected scale is unavailable for this display.")?;
    if percent == scale.current {
        return Ok(());
    }
    let request = ScaleRequest::new(target, -4, [index as i32 - scale.recommended]);
    let result = unsafe { DisplayConfigSetDeviceInfo(&request.header) };
    if result != 0 {
        return Err(format!(
            "Windows rejected the display scale change ({result})."
        ));
    }
    Ok(())
}

pub fn set_hd_color(id: &str, enabled: bool) -> Result<(), String> {
    use windows_sys::Win32::Devices::Display::*;
    let targets = display_targets();
    let target = targets
        .get(id)
        .ok_or("The selected display is no longer active.")?;
    if !matches!(target.advanced_color, Some("On" | "Off")) {
        return Err(
            "Windows has not exposed an adjustable Advanced Color mode for this display.".into(),
        );
    }
    let request = DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE {
        header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
            // Newer Windows versions distinguish the HDR switch from wide-gamut color.
            r#type: if target.hdr_api {
                16
            } else {
                DISPLAYCONFIG_DEVICE_INFO_SET_ADVANCED_COLOR_STATE
            },
            size: mem::size_of::<DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE>() as u32,
            adapterId: target.adapter,
            id: target.target_id,
        },
        Anonymous: DISPLAYCONFIG_SET_ADVANCED_COLOR_STATE_0 {
            value: u32::from(enabled),
        },
    };
    let result = unsafe { DisplayConfigSetDeviceInfo(&request.header) };
    if result != 0 {
        return Err(format!(
            "Windows rejected the Advanced Color change ({result})."
        ));
    }
    Ok(())
}

fn color_profile(device: &[u16]) -> Option<String> {
    use windows_sys::Win32::{
        Graphics::Gdi::{CreateDCW, DeleteDC},
        UI::ColorSystem::GetICMProfileW,
    };
    unsafe {
        let driver = wide("DISPLAY");
        let dc = CreateDCW(driver.as_ptr(), device.as_ptr(), ptr::null(), ptr::null());
        if dc.is_null() {
            return None;
        }
        let mut length = 0;
        GetICMProfileW(dc, &mut length, ptr::null_mut());
        let mut buffer = vec![0u16; length as usize];
        let success = length > 0 && GetICMProfileW(dc, &mut length, buffer.as_mut_ptr()) != 0;
        DeleteDC(dc);
        success.then(|| {
            utf16(&buffer)
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or_default()
                .to_owned()
        })
    }
}

#[derive(Serialize)]
pub struct NetworkConfig {
    pub ipv4: Option<Ipv4Addr>,
    pub mask: Option<Ipv4Addr>,
    pub gateway: Option<Ipv4Addr>,
    pub dhcp: bool,
    pub dns: Vec<std::net::IpAddr>,
}

pub fn network_config(index: u32) -> Option<NetworkConfig> {
    use windows_sys::Win32::{
        Foundation::ERROR_BUFFER_OVERFLOW,
        NetworkManagement::IpHelper::{
            GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST,
            GetAdaptersAddresses, IP_ADAPTER_ADDRESSES_LH, IP_ADAPTER_DHCP_ENABLED,
        },
        Networking::WinSock::{AF_UNSPEC, SOCKET_ADDRESS},
    };

    fn ipv4(address: &SOCKET_ADDRESS) -> Option<Ipv4Addr> {
        match socket_ip(address)? {
            std::net::IpAddr::V4(address) => Some(address),
            _ => None,
        }
    }

    let mut length = 15_000u32;
    for _ in 0..3 {
        // The API fills an aligned buffer with linked structures and socket addresses.
        let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
        let first = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        unsafe {
            let status = GetAdaptersAddresses(
                u32::from(AF_UNSPEC),
                GAA_FLAG_INCLUDE_GATEWAYS | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST,
                ptr::null(),
                first,
                &mut length,
            );
            if status == ERROR_BUFFER_OVERFLOW {
                continue;
            }
            if status != 0 {
                return None;
            }
            let mut entry = first;
            while let Some(adapter) = entry.as_ref() {
                entry = adapter.Next;
                if adapter.Anonymous1.Anonymous.IfIndex != index {
                    continue;
                }
                let mut unicast = adapter.FirstUnicastAddress;
                let mut address_and_prefix = None;
                while let Some(item) = unicast.as_ref() {
                    unicast = item.Next;
                    if let Some(value) = ipv4(&item.Address) {
                        address_and_prefix = Some((value, item.OnLinkPrefixLength));
                        if !value.is_link_local() {
                            break;
                        }
                    }
                }
                let mut gateway = adapter.FirstGatewayAddress;
                let mut selected_gateway = None;
                while let Some(item) = gateway.as_ref() {
                    if let Some(value) = ipv4(&item.Address) {
                        selected_gateway = Some(value);
                        break;
                    }
                    gateway = item.Next;
                }
                let mut dns = Vec::new();
                let mut server = adapter.FirstDnsServerAddress;
                while let Some(item) = server.as_ref() {
                    if let Some(address) = socket_ip(&item.Address) {
                        dns.push(address);
                    }
                    server = item.Next;
                }
                return Some(NetworkConfig {
                    ipv4: address_and_prefix.map(|(address, _)| address),
                    mask: address_and_prefix.and_then(|(_, prefix)| mask_from_prefix(prefix)),
                    gateway: selected_gateway,
                    dhcp: adapter.Anonymous2.Flags & IP_ADAPTER_DHCP_ENABLED != 0,
                    dns,
                });
            }
            return None;
        }
    }
    None
}

fn socket_ip(
    address: &windows_sys::Win32::Networking::WinSock::SOCKET_ADDRESS,
) -> Option<std::net::IpAddr> {
    use std::net::Ipv6Addr;
    use windows_sys::Win32::Networking::WinSock::{AF_INET6, SOCKADDR_IN6};
    // The caller holds the GetAdaptersAddresses buffer for the duration of this read.
    unsafe {
        match address.lpSockaddr.as_ref()?.sa_family {
            AF_INET if address.iSockaddrLength as usize >= mem::size_of::<SOCKADDR_IN>() => {
                let info = &*address.lpSockaddr.cast::<SOCKADDR_IN>();
                Some(Ipv4Addr::from(info.sin_addr.S_un.S_addr.to_ne_bytes()).into())
            }
            AF_INET6 if address.iSockaddrLength as usize >= mem::size_of::<SOCKADDR_IN6>() => {
                let info = &*address.lpSockaddr.cast::<SOCKADDR_IN6>();
                Some(Ipv6Addr::from(info.sin6_addr.u.Byte).into())
            }
            _ => None,
        }
    }
}

fn mask_from_prefix(prefix: u8) -> Option<Ipv4Addr> {
    (prefix <= 32)
        .then(|| Ipv4Addr::from(u32::MAX.checked_shl(32 - u32::from(prefix)).unwrap_or(0)))
}

#[cfg(test)]
mod tests {
    use super::mask_from_prefix;

    #[test]
    fn subnet_mask_handles_boundary_and_non_octet_prefixes() {
        assert_eq!(mask_from_prefix(0).unwrap().to_string(), "0.0.0.0");
        assert_eq!(mask_from_prefix(23).unwrap().to_string(), "255.255.254.0");
        assert_eq!(mask_from_prefix(32).unwrap().to_string(), "255.255.255.255");
        assert!(mask_from_prefix(33).is_none());
    }
}
