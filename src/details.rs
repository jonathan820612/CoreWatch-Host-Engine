use crate::native;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    time::{Duration, Instant},
};
use sysinfo::System;
use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
use wmi::{Variant, WMIConnection};

pub(crate) type Row = HashMap<String, Variant>;
type Fields = BTreeMap<&'static str, String>;

#[derive(Serialize, Default)]
pub struct Details {
    fields: Fields,
    pub volumes: Vec<crate::storage::Volume>,
    pub displays: Vec<native::Display>,
    pub adapters: Vec<native::Adapter>,
    pub dns_uplink: Option<crate::network::DnsUplink>,
    pub gateway_neighbor: Option<native::GatewayNeighbor>,
    pub notes: Vec<&'static str>,
    pub last_crash: Option<crate::event_log::Record>,
}

impl Details {
    pub fn field(&self, key: &str) -> Option<&str> {
        self.fields.get(key).map(String::as_str)
    }
}

pub struct Collector {
    wmi: Option<WMIConnection>,
    standard: Option<WMIConnection>,
    storage: Option<WMIConnection>,
    defender: Option<WMIConnection>,
    hardware: Vec<(&'static str, WMIConnection)>,
    identity: Fields,
    next_identity: Instant,
    last_crash: Option<crate::event_log::Record>,
    volumes: crate::storage::Collector,
    limits: PerformanceLimits,
    next_limits: Instant,
}

#[derive(Default)]
struct PerformanceLimits {
    available: bool,
    thermal: Vec<String>,
    power: Vec<String>,
}

impl PerformanceLimits {
    fn sample(connection: Option<&WMIConnection>) -> Self {
        let mut report = Self::default();
        let zones = rows(
            connection,
            "SELECT Name, ThrottleReasons, Temperature, HighPrecisionTemperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation",
        );
        for zone in zones {
            let Some(reasons) = number(&zone, "ThrottleReasons") else {
                continue;
            };
            report.available = true;
            let temperature = number(&zone, "HighPrecisionTemperature")
                .filter(|&value| value > 2732)
                .map(|value| value as f64 / 10.0 - 273.15)
                .or_else(|| {
                    number(&zone, "Temperature")
                        .filter(|&value| value > 273)
                        .map(|value| value as f64 - 273.15)
                });
            if reasons != 0
                && let Some(temperature) = temperature.filter(|&value| value >= 60.0)
            {
                let name = text(&zone, "Name").unwrap_or("ACPI thermal zone");
                report
                    .thermal
                    .push(format!("{name} reported throttling at {temperature:.0} °C"));
            }
        }
        let cpu = rows(
            connection,
            "SELECT PerformanceLimitFlags, PercentPerformanceLimit FROM Win32_PerfFormattedData_Counters_ProcessorInformation WHERE Name = '_Total'",
        );
        if let Some(cpu) = cpu.first()
            && let (Some(flags), Some(cap)) = (
                number(cpu, "PerformanceLimitFlags"),
                number(cpu, "PercentPerformanceLimit"),
            )
            && cap > 0
        {
            report.available = true;
            if cap < 100 {
                if flags & 2 != 0 {
                    report
                        .thermal
                        .push(format!("Windows CPU thermal limit at {cap}%"));
                }
                if flags & 1 != 0 {
                    report
                        .power
                        .push(format!("Windows CPU power limit at {cap}%"));
                }
                if flags == 0 && cap <= 85 {
                    report
                        .power
                        .push(format!("Windows CPU performance capped at {cap}%"));
                }
            }
        }
        report
    }

    fn apply(&self, fields: &mut Fields) {
        let mut thermal = self.thermal.clone();
        if let Some(temperature) = fields
            .get("cpuTemp")
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|&value| value >= 92)
        {
            thermal.push(format!("CPU sensor reports {temperature} °C"));
        }
        let state = match (thermal.is_empty(), self.power.is_empty()) {
            (false, false) => "Thermal/Power",
            (false, true) => "Thermal",
            (true, false) => "Power",
            (true, true) if self.available => "None reported",
            (true, true) => return,
        };
        let details = thermal
            .iter()
            .chain(&self.power)
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(" · ");
        put(fields, "throttle", Some(state));
        put(fields, "throttleDetail", Some(details));
    }
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
            last_crash: None,
            volumes: crate::storage::Collector::default(),
            limits: PerformanceLimits::default(),
            next_limits: Instant::now(),
        }
    }

    pub fn sample(&mut self, bridge: Option<&crate::sensors::Readings>) -> Details {
        if Instant::now() >= self.next_identity {
            self.identity = self.read_identity();
            if let Ok(record) = crate::event_log::latest_crash() {
                self.last_crash = record;
                let caption = self.last_crash.as_ref().map_or_else(
                    || "None recorded".to_owned(),
                    |event| {
                        format!(
                            "{} ({})",
                            event.utc(),
                            event.crash_tag().unwrap_or("System event")
                        )
                    },
                );
                put(&mut self.identity, "lastCrash", Some(caption));
            }
            self.next_identity = Instant::now() + Duration::from_secs(45);
        }
        let mut sample = Details {
            fields: self.identity.clone(),
            last_crash: self.last_crash.clone(),
            ..Details::default()
        };
        let f = &mut sample.fields;
        put(f, "powerPlan", native::power_plan());
        put(f, "nightLight", crate::night_light::status().map(on_off));
        if let Some(warmth) = crate::night_light::warmth() {
            put(f, "nightWarmth", Some(warmth.percent.to_string()));
            put(f, "nightKelvin", Some(warmth.kelvin.to_string()));
        }
        if Instant::now() >= self.next_limits {
            self.limits = PerformanceLimits::sample(self.wmi.as_ref());
            self.next_limits = Instant::now() + Duration::from_secs(4);
        }
        self.audio_and_gpu(f, bridge);
        self.limits.apply(f);
        self.network(
            f,
            &mut sample.adapters,
            &mut sample.dns_uplink,
            &mut sample.gateway_neighbor,
        );
        sample.displays = native::displays();
        sample.volumes = self.sample_volumes();
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

    pub fn invalidate(&mut self) {
        self.next_identity = Instant::now();
        self.next_limits = Instant::now();
        self.volumes.invalidate();
        if self.storage.is_none() {
            self.storage =
                WMIConnection::with_namespace_path(r"ROOT\Microsoft\Windows\Storage").ok();
        }
    }

    pub fn sample_volumes(&mut self) -> Vec<crate::storage::Volume> {
        self.volumes.sample(self.storage.as_ref())
    }

    fn read_identity(&self) -> Fields {
        let mut fields = Fields::new();
        let f = &mut fields;
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        put(f, "host", System::host_name());
        let edition = self
            .first("SELECT Caption FROM Win32_OperatingSystem")
            .and_then(|os| text(&os, "Caption").map(str::to_owned))
            .or_else(System::long_os_version);
        put(f, "os", edition);
        put(
            f,
            "powershell",
            crate::dashboard_runtimes::powershell_label(),
        );
        put(f, "java", crate::dashboard_runtimes::java_current());
        put(
            f,
            "elevation",
            Some(if native::elevated() {
                "Administrator"
            } else {
                "Standard user"
            }),
        );
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
            .map(|value| if value == 4 { "Off" } else { "On" }),
        );
        let version = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        let build = registry::<String>(&hklm, version, "CurrentBuildNumber");
        let ubr = registry::<u32>(&hklm, version, "UBR");
        put(
            f,
            "build",
            build.map(|build| ubr.map_or_else(|| build.clone(), |ubr| format!("{build}.{ubr}"))),
        );
        let reasons = pending_reboot_reasons(&hklm);
        let pending = !reasons.is_empty();
        put(f, "pendingReboot", Some(if pending { "Yes" } else { "No" }));
        put(
            f,
            "pendingRebootDetail",
            Some(if pending {
                format!("Reboot required: {}", reasons.join(" · "))
            } else {
                "No pending reboot registry flags detected".to_owned()
            }),
        );
        put(
            f,
            "update",
            registry::<String>(&hklm, version, "DisplayVersion").map(|v| {
                if pending {
                    format!("{v} · Reboot Pending")
                } else {
                    format!("{v} · Up to Date")
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
                ("gpuLoad", readings.gpu_load, 100.0),
            ];
            for (field, value, limit) in supplemental {
                let needs_fill = !f.contains_key(field)
                    || (field == "gpuLoad" && f.get("gpuLoad").map(String::as_str) == Some("0"));
                if needs_fill
                    && let Some(formatted) = value
                        .filter(|value| (0.0..=limit).contains(value))
                        .map(|value| format!("{value:.0}"))
                {
                    put(f, field, Some(formatted));
                }
            }
        }
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
                .map(|nic| nic.description.as_str())
                .or(Some("Not Installed")),
        );
        put(
            f,
            "wifi",
            wifi.map(|nic| nic.description.as_str())
                .or(Some("Not Installed")),
        );
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
        if let Ok(firewall) = crate::devices::Firewall::read() {
            put(f, "firewall", firewall.status());
            put(
                f,
                "discovery",
                firewall.group_status(crate::devices::FirewallGroup::Discovery),
            );
            put(
                f,
                "sharing",
                firewall.group_status(crate::devices::FirewallGroup::Sharing),
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

#[derive(Default)]
struct PendingRebootSignals {
    cbs_reboot_pending: bool,
    cbs_reboot_in_progress: bool,
    wu_reboot_required: bool,
    update_exe_volatile: bool,
    netlogon_domain_join: bool,
    active_computer_name: Option<String>,
    pending_computer_name: Option<String>,
}

fn evaluate_pending_reboot(signals: &PendingRebootSignals) -> Vec<String> {
    let mut reasons = Vec::new();
    if signals.cbs_reboot_pending {
        reasons.push("Component Based Servicing".to_owned());
    }
    if signals.cbs_reboot_in_progress {
        reasons.push("CBS Reboot In Progress".to_owned());
    }
    if signals.wu_reboot_required {
        reasons.push("Windows Update".to_owned());
    }
    if signals.update_exe_volatile {
        reasons.push("Windows Update Volatile Flag".to_owned());
    }
    if signals.netlogon_domain_join {
        reasons.push("Pending Domain Join".to_owned());
    }
    if let (Some(active), Some(pending)) = (
        signals.active_computer_name.as_deref(),
        signals.pending_computer_name.as_deref(),
    ) && !active.trim().is_empty()
        && !pending.trim().is_empty()
        && !active.trim().eq_ignore_ascii_case(pending.trim())
    {
        reasons.push(format!(
            "Pending Computer Rename ({} → {})",
            active.trim(),
            pending.trim()
        ));
    }
    reasons
}

/// Inspects genuine Windows OS restart flags (CBS, Windows Update, volatile update flag,
/// pending domain join, and pending computer rename). Deliberately avoids noisy
/// `PendingFileRenameOperations` temp-delete entries from Store/Edge/Xbox updates.
fn pending_reboot_reasons(hklm: &RegKey) -> Vec<String> {
    let signals = PendingRebootSignals {
        cbs_reboot_pending: hklm
            .open_subkey(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending",
            )
            .is_ok(),
        cbs_reboot_in_progress: hklm
            .open_subkey(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootInProgress",
            )
            .is_ok(),
        wu_reboot_required: hklm
            .open_subkey(
                r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired",
            )
            .is_ok(),
        update_exe_volatile: registry::<u32>(
            hklm,
            r"SOFTWARE\Microsoft\Updates",
            "UpdateExeVolatile",
        )
        .is_some_and(|v| v != 0),
        netlogon_domain_join: hklm
            .open_subkey(r"SYSTEM\CurrentControlSet\Services\Netlogon\JoinDomain")
            .is_ok()
            || hklm
                .open_subkey(r"SYSTEM\CurrentControlSet\Services\Netlogon\AvoidSpnSet")
                .is_ok(),
        active_computer_name: registry::<String>(
            hklm,
            r"SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName",
            "ComputerName",
        ),
        pending_computer_name: registry::<String>(
            hklm,
            r"SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName",
            "ComputerName",
        ),
    };
    evaluate_pending_reboot(&signals)
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

pub(crate) fn rows(connection: Option<&WMIConnection>, query: &str) -> Vec<Row> {
    connection
        .and_then(|connection| connection.raw_query(query).ok())
        .unwrap_or_default()
}

pub(crate) fn text<'a>(row: &'a Row, property: &str) -> Option<&'a str> {
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

pub(crate) fn number(row: &Row, property: &str) -> Option<u64> {
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

#[cfg(test)]
mod tests {
    use super::{PendingRebootSignals, evaluate_pending_reboot, gpu_instance_suffix};

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

    #[test]
    fn pending_reboot_only_triggers_on_genuine_os_flags() {
        let clean = PendingRebootSignals {
            active_computer_name: Some("WORKSTATION".into()),
            pending_computer_name: Some("workstation".into()),
            ..Default::default()
        };
        assert!(evaluate_pending_reboot(&clean).is_empty());

        let flagged = PendingRebootSignals {
            wu_reboot_required: true,
            active_computer_name: Some("OLD-PC".into()),
            pending_computer_name: Some("NEW-PC".into()),
            ..Default::default()
        };
        let reasons = evaluate_pending_reboot(&flagged);
        assert_eq!(reasons.len(), 2);
        assert!(reasons[0].contains("Windows Update"));
        assert!(reasons[1].contains("OLD-PC → NEW-PC"));
    }
}
