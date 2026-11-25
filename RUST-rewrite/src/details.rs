use crate::native;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    time::{Duration, Instant},
};
use sysinfo::{Disks, System};
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE},
};
use wmi::{Variant, WMIConnection};

type Row = HashMap<String, Variant>;
type Fields = BTreeMap<&'static str, String>;

#[derive(Serialize, Default)]
pub struct Details {
    fields: Fields,
    pub volumes: Vec<Volume>,
    pub displays: Vec<native::Display>,
    pub adapters: Vec<native::Adapter>,
    pub dns_uplink: Option<crate::network::DnsUplink>,
    pub gateway_neighbor: Option<native::GatewayNeighbor>,
    pub notes: Vec<&'static str>,
}

#[derive(Serialize)]
pub struct Volume {
    mount: String,
    label: String,
    filesystem: String,
    total: u64,
    used: u64,
    health: Option<&'static str>,
    kind: &'static str,
    removable: bool,
    active_percent: Option<u64>,
}

pub struct Collector {
    wmi: Option<WMIConnection>,
    standard: Option<WMIConnection>,
    storage: Option<WMIConnection>,
    defender: Option<WMIConnection>,
    hardware: Vec<(&'static str, WMIConnection)>,
    identity: Fields,
    next_identity: Instant,
}

impl Collector {
    pub fn new() -> Self {
        Self {
            wmi: WMIConnection::new().ok(),
            standard: WMIConnection::with_namespace_path(r"ROOT\StandardCimv2").ok(),
            storage: WMIConnection::with_namespace_path(r"ROOT\Microsoft\Windows\Storage").ok(),
            defender: WMIConnection::with_namespace_path(r"ROOT\Microsoft\Windows\Defender").ok(),
            hardware: [
                ("LibreHardwareMonitor", r"ROOT\LibreHardwareMonitor"),
                ("OpenHardwareMonitor", r"ROOT\OpenHardwareMonitor"),
            ]
            .into_iter()
            .filter_map(|(name, path)| {
                WMIConnection::with_namespace_path(path)
                    .ok()
                    .map(|connection| (name, connection))
            })
            .collect(),
            identity: Fields::new(),
            next_identity: Instant::now(),
        }
    }

    pub fn sample(&mut self, bridge: Option<&crate::sensors::Readings>) -> Details {
        if Instant::now() >= self.next_identity {
            self.identity = self.read_identity();
            self.next_identity = Instant::now() + Duration::from_secs(45);
        }
        let mut sample = Details {
            fields: self.identity.clone(),
            ..Details::default()
        };
        let f = &mut sample.fields;
        put(f, "powerPlan", native::power_plan());
        put(f, "nightLight", night_light());
        let thermal = rows(
            self.wmi.as_ref(),
            "SELECT ThrottleReasons, Temperature, HighPrecisionTemperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation",
        );
        let mut reasons = thermal
            .iter()
            .filter_map(|row| {
                let reason = number(row, "ThrottleReasons")?;
                let warm = number(row, "HighPrecisionTemperature")
                    .is_some_and(|kelvin| kelvin >= 3332)
                    || number(row, "Temperature").is_some_and(|kelvin| kelvin >= 333);
                Some(reason != 0 && warm)
            })
            .peekable();
        if reasons.peek().is_some() {
            put(
                f,
                "throttle",
                Some(if reasons.any(|active| active) {
                    "ACPI active"
                } else {
                    "None reported"
                }),
            );
        }
        self.audio_and_gpu(f, bridge);
        self.network(
            f,
            &mut sample.adapters,
            &mut sample.dns_uplink,
            &mut sample.gateway_neighbor,
        );
        sample.displays = native::displays();
        sample.volumes = self.volumes();
        if self.wmi.is_none() {
            sample.notes.push(
                "Windows WMI is unavailable. Native counters and volume totals are still sampled.",
            );
        }
        if !f.contains_key("cpuTemp") || !f.contains_key("gpuTemp") {
            sample
                .notes
                .push("Some temperature readings need a compatible hardware sensor provider.");
        }
        sample
    }

    fn read_identity(&self) -> Fields {
        let mut fields = Fields::new();
        let f = &mut fields;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        put(f, "host", System::host_name());
        put(f, "os", System::long_os_version());
        put(f, "engine", Some("Rust · WebView2"));
        put(f, "java", java_home_version());
        put(
            f,
            "elevation",
            Some(if native::elevated() {
                "Administrator"
            } else {
                "Standard user"
            }),
        );
        put(f, "lastCrash", native::last_crash());
        put(
            f,
            "directX",
            crate::network::system_directory()
                .ok()
                .and_then(|path| path.join("d3d12.dll").is_file().then_some("DirectX 12")),
        );
        put(
            f,
            "secureBoot",
            registry::<u32>(
                &hklm,
                r"SYSTEM\CurrentControlSet\Control\SecureBoot\State",
                "UEFISecureBootEnabled",
            )
            .map(|value| on_off(value != 0)),
        );
        put(
            f,
            "telemetry",
            registry::<u32>(
                &hklm,
                r"SYSTEM\CurrentControlSet\Services\DiagTrack",
                "Start",
            )
            .map(|value| {
                if value == 4 {
                    "DiagTrack disabled"
                } else {
                    "DiagTrack enabled"
                }
            }),
        );
        let version = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        let build = registry::<String>(&hklm, version, "CurrentBuildNumber");
        let ubr = registry::<u32>(&hklm, version, "UBR");
        put(
            f,
            "build",
            build.map(|build| ubr.map_or_else(|| build.clone(), |ubr| format!("{build}.{ubr}"))),
        );
        let cbs =
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending";
        let windows_update =
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired";
        let pending = [cbs, windows_update]
            .iter()
            .any(|path| hklm.open_subkey(path).is_ok())
            || registry::<Vec<String>>(
                &hklm,
                r"SYSTEM\CurrentControlSet\Control\Session Manager",
                "PendingFileRenameOperations",
            )
            .is_some_and(|paths| !paths.is_empty());
        put(
            f,
            "pendingReboot",
            Some(if pending { "Yes" } else { "No known flags" }),
        );
        put(
            f,
            "update",
            registry::<String>(&hklm, version, "DisplayVersion").map(|v| {
                if pending {
                    format!("{v} · Reboot pending")
                } else {
                    v
                }
            }),
        );

        if let Some(computer) =
            self.first("SELECT Domain, HypervisorPresent FROM Win32_ComputerSystem")
        {
            put(f, "domain", text(&computer, "Domain"));
            if flag(&computer, "HypervisorPresent") == Some(true) {
                put(f, "virtualization", Some("Hypervisor active"));
            }
        }
        if !f.contains_key("virtualization")
            && let Some(cpu) =
                self.first("SELECT VirtualizationFirmwareEnabled FROM Win32_Processor")
        {
            put(
                f,
                "virtualization",
                flag(&cpu, "VirtualizationFirmwareEnabled").map(on_off),
            );
        }
        if let Some(board) = self.first("SELECT Manufacturer, Product FROM Win32_BaseBoard") {
            put(f, "board", joined(&board, &["Manufacturer", "Product"]));
        }
        if let Some(bios) = self.first("SELECT SMBIOSBIOSVersion FROM Win32_BIOS") {
            put(f, "bios", text(&bios, "SMBIOSBIOSVersion"));
        }
        let mut caches: BTreeMap<u64, u64> = BTreeMap::new();
        for cache in rows(
            self.wmi.as_ref(),
            "SELECT Level, InstalledSize FROM Win32_CacheMemory",
        ) {
            if let (Some(level @ 3..=5), Some(kib)) =
                (number(&cache, "Level"), number(&cache, "InstalledSize"))
            {
                *caches.entry(level - 2).or_default() += kib;
            }
        }
        for (level, name) in [(1, "l1"), (2, "l2"), (3, "l3")] {
            put(
                f,
                name,
                caches.get(&level).filter(|&&kib| kib > 0).map(|kib| {
                    if *kib >= 1024 {
                        format!("{:.1} MiB", *kib as f64 / 1024.0)
                    } else {
                        format!("{kib} KiB")
                    }
                }),
            );
        }

        fields
    }

    fn first(&self, query: &str) -> Option<Row> {
        rows(self.wmi.as_ref(), query).into_iter().next()
    }

    fn audio_and_gpu(&self, f: &mut Fields, bridge: Option<&crate::sensors::Readings>) {
        let (output, input) = crate::devices::audio();
        put(f, "audioOutput", output);
        put(f, "audioInput", input);
        let gpu = crate::devices::gpu();
        let mut bridge_gpu_matches = gpu.as_ref().is_some_and(|gpu| gpu.single);
        if let Some(ref gpu) = gpu {
            put(f, "gpuName", Some(gpu.name.as_str()));
            if gpu.dedicated > 0 {
                put(f, "vramTotal", Some(gpu.dedicated.to_string()));
            }
            let escaped_name = gpu.name.to_ascii_lowercase();
            let controllers = rows(
                self.wmi.as_ref(),
                "SELECT Name, DriverVersion FROM Win32_VideoController",
            );
            bridge_gpu_matches |= matches!(controllers.as_slice(), [controller]
                if text(controller, "Name").is_some_and(|name| name.eq_ignore_ascii_case(&gpu.name)));
            put(
                f,
                "gpuDriver",
                controllers
                    .iter()
                    .find(|row| {
                        text(row, "Name")
                            .is_some_and(|name| name.to_ascii_lowercase() == escaped_name)
                    })
                    .and_then(|row| text(row, "DriverVersion")),
            );
            let adapter_prefix = format!("luid_0x{:08x}_0x{:08x}_", gpu.high, gpu.low);
            let engines = rows(
                self.wmi.as_ref(),
                "SELECT Name, UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine",
            );
            let mut totals = HashMap::<String, u64>::new();
            for row in &engines {
                if let Some(engine) =
                    text(row, "Name").and_then(|name| gpu_instance_suffix(name, &adapter_prefix))
                    && let Some(usage) = number(row, "UtilizationPercentage")
                {
                    *totals.entry(engine.to_owned()).or_default() += usage;
                }
            }
            put(
                f,
                "gpuLoad",
                totals
                    .values()
                    .max()
                    .map(|usage| usage.min(&100).to_string()),
            );
            let memory = rows(
                self.wmi.as_ref(),
                "SELECT Name, DedicatedUsage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory",
            );
            put(
                f,
                "vramUsed",
                memory
                    .iter()
                    .find(|row| {
                        text(row, "Name").is_some_and(|name| {
                            gpu_instance_suffix(name, &adapter_prefix).is_some()
                        })
                    })
                    .and_then(|row| number(row, "DedicatedUsage"))
                    .map(|bytes| bytes.to_string()),
            );
        }
        if let Some(reading) = bridge
            && let Some(value) = reading
                .cpu_temp
                .filter(|value| (15.0..=120.0).contains(value))
        {
            put(f, "cpuTemp", Some(format!("{value:.0}")));
            let source = reading
                .sensor
                .as_deref()
                .filter(|sensor| !sensor.is_empty())
                .map_or_else(
                    || "LibreHardwareMonitor helper".to_owned(),
                    |sensor| format!("LibreHardwareMonitor helper · {sensor}"),
                );
            put(f, "cpuTempSource", Some(source));
        }
        for (provider, connection) in &self.hardware {
            let sensors = rows(
                Some(connection),
                "SELECT Name, Identifier, SensorType, Value FROM Sensor",
            );
            if !f.contains_key("cpuTemp") {
                let candidates = sensors.iter().filter(|row| {
                    text(row, "SensorType") == Some("Temperature")
                        && text(row, "Identifier").is_some_and(|id| {
                            id.starts_with("/amdcpu/") || id.starts_with("/intelcpu/")
                        })
                });
                let names = [
                    "tctl/tdie",
                    "cpu package",
                    "tdie",
                    "core max",
                    "core average",
                ];
                let temp = candidates
                    .filter_map(|row| {
                        let name = text(row, "Name")?;
                        let normalized = name.to_ascii_lowercase();
                        let rank = names.iter().position(|pick| normalized.contains(pick))?;
                        Some((rank, sensor_value(row, 0.0, 120.0)?, name))
                    })
                    .min_by_key(|&(rank, _, _)| rank);
                if let Some((_, value, sensor)) = temp {
                    put(f, "cpuTemp", Some(format!("{value:.0}")));
                    put(
                        f,
                        "cpuTempSource",
                        Some(format!("{provider} WMI · {sensor}")),
                    );
                }
            }
            // Vendor identifiers cannot disambiguate two GPUs from the same vendor.
            // The platform adapter name must identify a single matching sensor group.
            if let Some(gpu) = &gpu {
                let matching_hardware =
                    rows(Some(connection), "SELECT Name, Identifier FROM Hardware");
                let mut ids = matching_hardware
                    .iter()
                    .filter(|row| {
                        text(row, "Name").is_some_and(|name| name.eq_ignore_ascii_case(&gpu.name))
                    })
                    .filter_map(|row| text(row, "Identifier"));
                if let Some(identifier) = ids.next().filter(|_| ids.next().is_none()) {
                    let prefix = format!("{identifier}/");
                    for (field, ty, name, min, max) in [
                        ("gpuTemp", "Temperature", "GPU Core", 0.0, 120.0),
                        ("gpuPower", "Power", "GPU Package", 0.0, 1000.0),
                        ("gpuLoad", "Load", "GPU Core", 0.0, 100.0),
                    ] {
                        if !f.contains_key(field) {
                            let reading = sensors.iter().find(|row| {
                                text(row, "SensorType") == Some(ty)
                                    && text(row, "Name") == Some(name)
                                    && text(row, "Identifier")
                                        .is_some_and(|id| id.starts_with(&prefix))
                            });
                            put(
                                f,
                                field,
                                reading
                                    .and_then(|row| sensor_value(row, min, max))
                                    .map(|value| format!("{value:.0}")),
                            );
                        }
                    }
                }
            }
        }
        if let Some(readings) = bridge.filter(|_| bridge_gpu_matches) {
            let supplemental = [
                ("gpuTemp", readings.gpu_temp, 120.0),
                ("gpuPower", readings.gpu_power, 1000.0),
            ];
            for (field, value, limit) in supplemental {
                if !f.contains_key(field) {
                    put(
                        f,
                        field,
                        value
                            .filter(|value| (0.0..=limit).contains(value))
                            .map(|value| format!("{value:.0}")),
                    );
                }
            }
        }
    }

    fn volumes(&self) -> Vec<Volume> {
        let partitions = rows(
            self.storage.as_ref(),
            "SELECT DiskNumber, DriveLetter FROM MSFT_Partition",
        );
        let physical = rows(
            self.storage.as_ref(),
            "SELECT Number, HealthStatus FROM MSFT_Disk",
        );
        let disk_activity = rows(
            self.wmi.as_ref(),
            "SELECT Name, PercentDiskTime FROM Win32_PerfFormattedData_PerfDisk_LogicalDisk",
        );
        let disks = Disks::new_with_refreshed_list();
        let mut list: Vec<_> = disks
            .list()
            .iter()
            .filter(|disk| disk.total_space() > 0)
            .map(|disk| {
                let mount = disk.mount_point().display().to_string();
                let letter = mount.as_bytes().first().map(|&c| c.to_ascii_uppercase());
                let disk_number = partitions
                    .iter()
                    .find(|row| {
                        let found = number(row, "DriveLetter")
                            .and_then(|value| u8::try_from(value).ok())
                            .or_else(|| {
                                text(row, "DriveLetter").and_then(|value| value.bytes().next())
                            });
                        letter.is_some() && found == letter
                    })
                    .and_then(|row| number(row, "DiskNumber"));
                let health = disk_number
                    .and_then(|disk_number| {
                        physical
                            .iter()
                            .find(|row| number(row, "Number") == Some(disk_number))
                    })
                    .and_then(|row| match number(row, "HealthStatus")? {
                        0 => Some("Healthy"),
                        1 => Some("Warning"),
                        2 => Some("Unhealthy"),
                        _ => None,
                    });
                Volume {
                    active_percent: disk_activity
                        .iter()
                        .find(|row| {
                            text(row, "Name").is_some_and(|name| {
                                name.eq_ignore_ascii_case(mount.trim_end_matches('\\'))
                            })
                        })
                        .and_then(|row| number(row, "PercentDiskTime"))
                        .map(|value| value.min(100)),
                    mount,
                    label: disk.name().to_string_lossy().into_owned(),
                    filesystem: disk.file_system().to_string_lossy().into_owned(),
                    total: disk.total_space(),
                    used: disk.total_space().saturating_sub(disk.available_space()),
                    health,
                    kind: match disk.kind() {
                        sysinfo::DiskKind::SSD => "SSD",
                        sysinfo::DiskKind::HDD => "HDD",
                        _ => "",
                    },
                    removable: disk.is_removable(),
                }
            })
            .collect();
        list.sort_unstable_by(|a, b| a.mount.cmp(&b.mount));
        list
    }

    fn network(
        &self,
        f: &mut Fields,
        adapters: &mut Vec<native::Adapter>,
        dns: &mut Option<crate::network::DnsUplink>,
        neighbor: &mut Option<native::GatewayNeighbor>,
    ) {
        *adapters = native::adapters().unwrap_or_default();
        if let Some(connection) = &self.wmi {
            crate::network::include_disabled(adapters, connection);
        }
        adapters.sort_unstable_by(|a, b| b.online.cmp(&a.online).then_with(|| a.name.cmp(&b.name)));
        let primary = native::default_ipv4_route(adapters).and_then(|(index, gateway)| {
            adapters
                .iter()
                .find(|nic| nic.index == index)
                .map(|nic| (nic, gateway))
        });
        let connection_status = if primary.is_some() {
            "IPv4 route available"
        } else {
            "No IPv4 default route detected"
        };
        put(f, "networkStatus", Some(connection_status));
        let wifi = adapters
            .iter()
            .find(|nic| nic.kind == "Wi-Fi" && nic.physical);
        put(
            f,
            "wifiSsid",
            native::wifi_ssid().or_else(|| {
                wifi.map(|nic| {
                    if nic.online {
                        "SSID unavailable"
                    } else {
                        "Disconnected"
                    }
                    .to_owned()
                })
            }),
        );
        put(
            f,
            "ethernet",
            adapters
                .iter()
                .find(|nic| nic.kind == "Ethernet" && nic.physical)
                .map(|nic| nic.description.as_str()),
        );
        put(f, "wifi", wifi.map(|nic| nic.description.as_str()));
        if let Some((nic, gateway)) = primary {
            let config = native::network_config(nic.index);
            *dns = Some(crate::network::DnsUplink::from_adapter(
                nic,
                config.as_ref(),
            ));
            if let Some(gateway) = gateway {
                put(f, "gateway", Some(gateway.to_string()));
                *neighbor = native::gateway_neighbor(gateway, nic.index, false).ok();
            }
            if nic.link_bps > 0 && nic.link_bps != u64::MAX {
                put(
                    f,
                    "link",
                    Some(if nic.link_bps >= 1_000_000_000 {
                        format!("{} Gbps", nic.link_bps as f64 / 1e9)
                    } else {
                        format!("{:.0} Mbps", nic.link_bps as f64 / 1e6)
                    }),
                );
            }
            if let Some(config) = config {
                put(f, "ipv4", config.ipv4.map(|value| value.to_string()));
                put(f, "subnet", config.mask.map(|value| value.to_string()));
                put(
                    f,
                    "assignment",
                    Some(if config.dhcp { "DHCP" } else { "Static" }),
                );
            }

            let profiles = rows(
                self.standard.as_ref(),
                "SELECT Name, InterfaceIndex, NetworkCategory FROM MSFT_NetConnectionProfile",
            );
            if let Some(profile) = profiles
                .iter()
                .find(|row| number(row, "InterfaceIndex") == Some(nic.index.into()))
            {
                let category = match number(profile, "NetworkCategory") {
                    Some(0) => "Public",
                    Some(1) => "Private",
                    Some(2) => "Domain",
                    _ => "Profile",
                };
                put(
                    f,
                    "networkStatus",
                    text(profile, "Name").map(|name| format!("{category} · {name}")),
                );
            }
        }
        put(f, "firewall", crate::devices::firewall());
        if let Some(wmi) = &self.wmi {
            let shares: Result<Vec<Row>, _> =
                wmi.raw_query("SELECT Name FROM Win32_Share WHERE Type = 0");
            put(
                f,
                "sharing",
                shares.ok().map(|shares| shares.len().to_string()),
            );
        }
        if let Some(defender) = rows(self.defender.as_ref(), "SELECT RealTimeProtectionEnabled, IsTamperProtected, BehaviorMonitorEnabled, IoavProtectionEnabled FROM MSFT_MpComputerStatus").first() {
            for (field, property) in [("realtime", "RealTimeProtectionEnabled"), ("tamper", "IsTamperProtected"),
                ("behavior", "BehaviorMonitorEnabled"), ("ioav", "IoavProtectionEnabled")] {
                put(f, field, flag(defender, property).map(on_off));
            }
        }
        if let Some(preferences) = rows(
            self.defender.as_ref(),
            "SELECT MAPSReporting FROM MSFT_MpPreference",
        )
        .first()
        {
            put(
                f,
                "cloud",
                number(preferences, "MAPSReporting").map(|value| on_off(value != 0)),
            );
        }
    }
}

fn registry<T: winreg::types::FromRegValue>(root: &RegKey, key: &str, property: &str) -> Option<T> {
    root.open_subkey(key).ok()?.get_value(property).ok()
}

fn put(f: &mut Fields, key: &'static str, value: Option<impl Into<String>>) {
    if let Some(value) = value
        .map(Into::into)
        .filter(|value: &String| !value.trim().is_empty())
    {
        f.insert(key, value);
    }
}

fn rows(connection: Option<&WMIConnection>, query: &str) -> Vec<Row> {
    connection
        .and_then(|connection| connection.raw_query(query).ok())
        .unwrap_or_default()
}

fn text<'a>(row: &'a Row, property: &str) -> Option<&'a str> {
    match row.get(property)? {
        Variant::String(value) if !value.trim().is_empty() => Some(value.trim()),
        _ => None,
    }
}

fn joined(row: &Row, properties: &[&str]) -> Option<String> {
    let values: Vec<_> = properties
        .iter()
        .filter_map(|property| text(row, property))
        .collect();
    (!values.is_empty()).then(|| values.join(" "))
}

fn number(row: &Row, property: &str) -> Option<u64> {
    match row.get(property)? {
        Variant::UI1(value) => Some((*value).into()),
        Variant::UI2(value) => Some((*value).into()),
        Variant::UI4(value) => Some((*value).into()),
        Variant::UI8(value) => Some(*value),
        Variant::I2(value) => (*value).try_into().ok(),
        Variant::I4(value) => (*value).try_into().ok(),
        Variant::I8(value) => (*value).try_into().ok(),
        Variant::String(value) => value.parse().ok(),
        _ => None,
    }
}

fn sensor_value(row: &Row, min: f64, max: f64) -> Option<f64> {
    let value = match row.get("Value")? {
        Variant::R4(value) => (*value).into(),
        Variant::R8(value) => *value,
        _ => return None,
    };
    (min..=max).contains(&value).then_some(value)
}

fn flag(row: &Row, property: &str) -> Option<bool> {
    if let Variant::Bool(value) = row.get(property)? {
        Some(*value)
    } else {
        None
    }
}

fn on_off(on: bool) -> &'static str {
    if on { "On" } else { "Off" }
}

fn gpu_instance_suffix<'a>(name: &'a str, adapter: &str) -> Option<&'a str> {
    let start = name.find("luid_")?;
    let end = start + adapter.len();
    name.get(start..end)
        .filter(|instance| instance.eq_ignore_ascii_case(adapter))?;
    name.get(end..)
}

fn java_home_version() -> Option<String> {
    use std::{fs::File, io::Read, path::PathBuf};
    let home = PathBuf::from(std::env::var_os("JAVA_HOME")?);
    let mut contents = String::new();
    File::open(home.join("release"))
        .ok()?
        .take(8192)
        .read_to_string(&mut contents)
        .ok()?;
    let entry = |key: &str| {
        contents.lines().find_map(|line| {
            let (name, value) = line.split_once('=')?;
            (name == key).then_some(value.trim_matches('"'))
        })
    };
    let version = entry("JAVA_VERSION")?;
    Some(match entry("IMPLEMENTOR") {
        Some(vendor) => format!("{version} ({vendor})"),
        None => version.to_owned(),
    })
}

fn night_light() -> Option<&'static str> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    for path in [
        r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate",
        r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\Cache\DefaultAccount\$$windows.data.bluelightreduction.bluelightreductionstate\Current",
    ] {
        let Ok(data) = user
            .open_subkey(path)
            .and_then(|key| key.get_raw_value("Data"))
        else {
            continue;
        };
        let Some(payload) = data.bytes.get(10..) else {
            continue;
        };
        if let Some(index) = payload
            .windows(4)
            .position(|marker| marker == b"CB\x01\x00")
        {
            let inner = payload.get(index + 4..)?;
            if inner.starts_with(&[0x10, 0x00]) {
                return Some("On");
            }
            if inner.starts_with(&[0xd0, 0x0a]) {
                return Some("Off");
            }
        } else if data.bytes.len() > 24 && data.bytes[18] == 0x15 {
            return Some("On");
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::gpu_instance_suffix;

    #[test]
    fn gpu_instance_matches_hex_ids_case_insensitively() {
        let adapter = "luid_0x00000000_0x00010fa9_";
        assert_eq!(
            gpu_instance_suffix("luid_0x00000000_0x00010FA9_phys_0", adapter),
            Some("phys_0")
        );
        assert_eq!(
            gpu_instance_suffix("pid_26_luid_0x00000000_0x00010FA9_phys_0_eng_1", adapter),
            Some("phys_0_eng_1")
        );
        assert_eq!(
            gpu_instance_suffix("luid_0x00000000_0x0000FAB4_phys_0", adapter),
            None
        );
    }
}
