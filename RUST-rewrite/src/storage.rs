use crate::{
    details::{number, rows, text},
    pdh,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{Duration, Instant},
};
use sysinfo::{DiskKind, Disks};
use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
use wmi::WMIConnection;

#[derive(Serialize)]
pub struct Volume {
    pub mount: String,
    label: String,
    filesystem: String,
    pub total: u64,
    pub used: u64,
    pub drive_type: &'static str,
    kind: &'static str,
    removable: bool,
    health: Option<&'static str>,
    wear_percent: Option<u64>,
    temperature_c: Option<u64>,
    disk_name: Option<String>,
    read_errors: Option<u64>,
    write_errors: Option<u64>,
    active_percent: Option<u64>,
    latency_ms: Option<f64>,
    queue_length: Option<f64>,
}

#[derive(Default)]
struct Smart {
    name: Option<String>,
    health: Option<&'static str>,
    wear: Option<u64>,
    temp: Option<u64>,
    read_errors: Option<u64>,
    write_errors: Option<u64>,
    bus: Option<&'static str>,
}

struct DiskCounters {
    query: pdh::Query,
    active: Option<pdh::Counter>,
    latency: Option<pdh::Counter>,
    queue: Option<pdh::Counter>,
    transfers: Option<pdh::Counter>,
}

impl DiskCounters {
    fn open(drive: &str) -> Option<Self> {
        let query = pdh::Query::open()?;
        let counter = |name| query.add(&format!(r"\LogicalDisk({drive})\{name}"));
        let counters = Self {
            active: counter("% Disk Time"),
            latency: counter("Avg. Disk sec/Transfer"),
            queue: counter("Current Disk Queue Length"),
            transfers: counter("Disk Transfers/sec"),
            query,
        };
        if counters.active.is_none() && counters.latency.is_none() && counters.queue.is_none() {
            return None;
        }
        counters.query.collect();
        Some(counters)
    }

    fn sample(&self) -> DiskIo {
        if !self.query.collect() {
            return DiskIo::default();
        }
        let active = self
            .active
            .as_ref()
            .and_then(pdh::Counter::value)
            .map(|value| value.round().clamp(0.0, 100.0) as u64);
        let transfers = self.transfers.as_ref().and_then(pdh::Counter::value);
        let latency = self
            .latency
            .as_ref()
            .and_then(pdh::Counter::value)
            .filter(|&value| value >= 0.0)
            .map(|value| value * 1000.0)
            .or_else(|| (transfers == Some(0.0)).then_some(0.0));
        let queue = self
            .queue
            .as_ref()
            .and_then(pdh::Counter::value)
            .filter(|&value| value >= 0.0);
        DiskIo {
            active,
            latency,
            queue,
        }
    }
}

#[derive(Default)]
struct DiskIo {
    active: Option<u64>,
    latency: Option<f64>,
    queue: Option<f64>,
}

#[derive(Default)]
pub struct Collector {
    smart: HashMap<String, Smart>,
    counters: HashMap<String, Option<DiskCounters>>,
    next_smart: Option<Instant>,
    local_drives: HashSet<String>,
}

impl Collector {
    pub fn invalidate(&mut self) {
        self.next_smart = None;
    }

    pub fn sample(&mut self, storage: Option<&WMIConnection>) -> Vec<Volume> {
        let mut volumes = volumes();
        let local: HashSet<_> = volumes
            .iter()
            .filter(|volume| matches!(volume.drive_type, "Local Volume" | "Removable"))
            .filter_map(|volume| drive_key(&volume.mount))
            .collect();
        let now = Instant::now();
        if local != self.local_drives || self.next_smart.is_none_or(|next| next <= now) {
            self.counters
                .retain(|drive, counters| local.contains(drive) && counters.is_some());
            self.smart = storage
                .map(|connection| smart_disks(connection, &local))
                .unwrap_or_default();
            self.local_drives = local;
            self.next_smart = Some(now + Duration::from_secs(30));
        }
        for volume in &mut volumes {
            let Some(drive) = drive_key(&volume.mount) else {
                continue;
            };
            if !self.local_drives.contains(&drive) {
                continue;
            }
            if let Some(smart) = self.smart.get(&drive) {
                volume.health = smart.health;
                volume.wear_percent = smart.wear;
                volume.temperature_c = smart.temp;
                volume.disk_name = smart.name.clone();
                volume.read_errors = smart.read_errors;
                volume.write_errors = smart.write_errors;
                if let Some(bus) = smart.bus {
                    volume.kind = bus;
                }
            }
            let io = match self.counters.entry(drive) {
                std::collections::hash_map::Entry::Occupied(entry) => {
                    entry.get().as_ref().map(DiskCounters::sample)
                }
                std::collections::hash_map::Entry::Vacant(entry) => {
                    let counter = DiskCounters::open(entry.key());
                    entry.insert(counter);
                    None
                }
            }
            .unwrap_or_default();
            volume.active_percent = io.active;
            volume.latency_ms = io.latency;
            volume.queue_length = io.queue;
        }
        volumes
    }
}

pub fn drive_key(mount: &str) -> Option<String> {
    match mount.as_bytes() {
        [letter, b':', b'\\'] if letter.is_ascii_alphabetic() => {
            Some(format!("{}:", letter.to_ascii_uppercase() as char))
        }
        _ => None,
    }
}

pub fn drive_type(path: &Path) -> &'static str {
    use std::os::windows::ffi::OsStrExt;
    let path: Vec<_> = path.as_os_str().encode_wide().chain([0]).collect();
    match unsafe { GetDriveTypeW(path.as_ptr()) } {
        2 => "Removable",
        3 => "Local Volume",
        4 => "Network Route",
        5 => "Optical Drive",
        6 => "RAM Disk",
        _ => "Unknown Drive",
    }
}

pub fn volumes() -> Vec<Volume> {
    let disks = Disks::new_with_refreshed_list();
    let mut list: Vec<_> = disks
        .list()
        .iter()
        .filter(|disk| disk.total_space() > 0)
        .map(|disk| {
            let drive_type = drive_type(disk.mount_point());
            Volume {
                mount: disk.mount_point().to_string_lossy().into_owned(),
                label: disk.name().to_string_lossy().into_owned(),
                filesystem: disk.file_system().to_string_lossy().into_owned(),
                total: disk.total_space(),
                used: disk.total_space().saturating_sub(disk.available_space()),
                kind: match disk.kind() {
                    DiskKind::SSD => "SSD",
                    DiskKind::HDD => "HDD",
                    _ => "",
                },
                drive_type,
                removable: drive_type == "Removable" || disk.is_removable(),
                health: None,
                wear_percent: None,
                temperature_c: None,
                disk_name: None,
                read_errors: None,
                write_errors: None,
                active_percent: None,
                latency_ms: None,
                queue_length: None,
            }
        })
        .collect();
    list.sort_unstable_by(|a, b| {
        a.removable
            .cmp(&b.removable)
            .then_with(|| a.mount.cmp(&b.mount))
    });
    list
}

fn smart_disks(connection: &WMIConnection, connected: &HashSet<String>) -> HashMap<String, Smart> {
    let physical: HashMap<_, _> = connection
        .exec_query("SELECT Number, FriendlyName, HealthStatus, BusType FROM MSFT_Disk")
        .into_iter()
        .flatten()
        .filter_map(|result| {
            let disk = result.ok()?;
            let path = disk.path().ok();
            let properties = disk.into_desr::<crate::details::Row>().ok()?;
            Some((number(&properties, "Number")?, (properties, path)))
        })
        .collect();
    let partitions = rows(
        Some(connection),
        "SELECT DiskNumber, DriveLetter FROM MSFT_Partition",
    );
    let mut counters = HashMap::new();
    let mut drives = HashMap::new();
    for partition in partitions {
        let Some(letter) = text(&partition, "DriveLetter")
            .and_then(|value| value.bytes().next())
            .or_else(|| u8::try_from(number(&partition, "DriveLetter")?).ok())
            .filter(u8::is_ascii_alphabetic)
        else {
            continue;
        };
        let drive = format!("{}:", letter.to_ascii_uppercase() as char);
        if !connected.contains(&drive) {
            continue;
        }
        let Some(index) = number(&partition, "DiskNumber") else {
            continue;
        };
        let Some((disk, path)) = physical.get(&index) else {
            continue;
        };
        let reliability = counters.entry(index).or_insert_with(|| {
            let path = path.as_deref()?;
            let query = format!(
                "ASSOCIATORS OF {{{path}}} WHERE AssocClass = MSFT_DiskToStorageReliabilityCounter"
            );
            rows(Some(connection), &query).into_iter().next()
        });
        let reliability = |property| reliability.as_ref().and_then(|row| number(row, property));
        drives.insert(
            drive,
            Smart {
                health: match number(disk, "HealthStatus") {
                    Some(0) => Some("Healthy"),
                    Some(1) => Some("Warning"),
                    Some(2) => Some("Unhealthy"),
                    _ => None,
                },
                name: text(disk, "FriendlyName").map(str::to_owned),
                bus: match number(disk, "BusType") {
                    Some(7) => Some("USB"),
                    Some(17) => Some("NVMe"),
                    _ => None,
                },
                wear: reliability("Wear").filter(|&value| value <= 100),
                temp: reliability("Temperature").filter(|&value| (1..120).contains(&value)),
                read_errors: reliability("ReadErrorsTotal"),
                write_errors: reliability("WriteErrorsTotal"),
            },
        );
    }
    drives
}
