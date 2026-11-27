use crate::{
    dashboard_actions,
    details::{number, rows, text},
    devices::ComApartment,
    native, system_controls,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    os::windows::process::CommandExt,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use wmi::{Variant, WMIConnection};

const MIN_UNALLOC_BYTES: u64 = 16 * 1024 * 1024;
const ALIGN_START_BYTES: u64 = 1024 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSegment {
    pub kind: &'static str,
    pub disk_number: u32,
    pub partition_number: u32,
    pub offset_bytes: u64,
    pub size_bytes: u64,
    pub size_gb: f64,
    pub pct_of_disk: f64,
    pub label: String,
    pub drive_letter: String,
    pub file_system: String,
    pub part_type: String,
    pub is_protected: bool,
    pub is_system: bool,
    pub is_boot: bool,
    pub is_active: bool,
    pub health_status: String,
    pub free_gb: Option<f64>,
    pub used_pct: Option<f64>,
    pub min_size_gb: Option<f64>,
    pub max_size_gb: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskEntry {
    pub number: u32,
    pub friendly_name: String,
    pub bus_type: String,
    pub partition_style: String,
    pub size_bytes: u64,
    pub size_gb: f64,
    pub allocated_gb: f64,
    pub unallocated_gb: f64,
    pub is_offline: bool,
    pub is_readonly: bool,
    pub is_system_disk: bool,
    pub health_status: String,
    pub operational_status: String,
    pub partition_count: usize,
    pub segments: Vec<DiskSegment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskPartitionerState {
    pub is_admin: bool,
    pub available_letters: Vec<String>,
    pub disks: Vec<DiskEntry>,
    pub scanned_at_ms: u64,
    pub notice: String,
    pub notice_error: bool,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PartitionAction {
    Initialize {
        disk: u32,
        style: String,
    },
    CreatePartition {
        disk: u32,
        size_mb: Option<u64>,
        drive_letter: Option<String>,
        #[serde(default)]
        no_letter: bool,
        file_system: String,
        label: String,
        #[serde(default)]
        cluster_size: Option<u32>,
        #[serde(default)]
        full_format: bool,
    },
    FormatPartition {
        disk: u32,
        partition: u32,
        file_system: String,
        label: String,
        #[serde(default)]
        cluster_size: Option<u32>,
        #[serde(default)]
        full_format: bool,
    },
    ResizePartition {
        disk: u32,
        partition: u32,
        size_mb: u64,
    },
    SetLetter {
        disk: u32,
        partition: u32,
        drive_letter: Option<String>,
    },
    SetLabel {
        disk: u32,
        partition: u32,
        label: String,
    },
    DeletePartition {
        disk: u32,
        partition: u32,
    },
    ClearDisk {
        disk: u32,
        #[serde(default)]
        confirm_token: Option<String>,
    },
    SetOnline {
        disk: u32,
        online: bool,
    },
    OpenDiskMgmt,
}

fn flag(row: &crate::details::Row, property: &str) -> bool {
    matches!(row.get(property), Some(Variant::Bool(true)))
}

fn round2(val: f64) -> f64 {
    (val * 100.0).round() / 100.0
}

fn bus_type_name(code: Option<u64>) -> &'static str {
    match code {
        Some(1) => "SCSI",
        Some(3) => "ATA",
        Some(7) => "USB",
        Some(8) => "RAID",
        Some(9) => "iSCSI",
        Some(10) => "SAS",
        Some(11) => "SATA",
        Some(12) => "SD",
        Some(14) => "Virtual",
        Some(15) => "File Backed",
        Some(16) => "Storage Spaces",
        Some(17) => "NVMe",
        _ => "Disk",
    }
}

fn partition_style_name(code: Option<u64>) -> &'static str {
    match code {
        Some(1) => "MBR",
        Some(2) => "GPT",
        _ => "RAW",
    }
}

fn health_name(code: Option<u64>) -> &'static str {
    match code {
        Some(0) => "Healthy",
        Some(1) => "Warning",
        Some(2) => "Unhealthy",
        _ => "Unknown",
    }
}

fn partition_type_name(gpt_type: Option<&str>, mbr_type: Option<u64>, is_system: bool) -> String {
    if let Some(guid) = gpt_type {
        let g = guid.trim().to_ascii_lowercase();
        if g.contains("c12a7328-f81f-11d2-ba4b-00a0c93ec93b") {
            return "EFI System Partition".into();
        }
        if g.contains("e3c9e316-0b5c-4db8-817d-f92df00215ae") {
            return "Reserved".into();
        }
        if g.contains("de94bba4-06d1-4d40-a16a-bfd50179d6ac") {
            return "Recovery".into();
        }
        if g.contains("ebd0a0a2-b9e5-4433-87c0-68b6b72699c7") {
            return "Basic".into();
        }
    }
    if is_system {
        return "System".into();
    }
    match mbr_type {
        Some(7) => "IFS / NTFS".into(),
        Some(11 | 12) => "FAT32".into(),
        Some(39) => "Recovery".into(),
        Some(238) => "GPT Protective".into(),
        _ => "Basic".into(),
    }
}

pub fn is_protected_partition(
    drive_letter: &str,
    is_system: bool,
    is_boot: bool,
    part_type: &str,
) -> bool {
    if drive_letter.eq_ignore_ascii_case("C") || is_system || is_boot {
        return true;
    }
    matches!(
        part_type,
        "System" | "Reserved" | "Recovery" | "EFI System Partition"
    )
}

fn is_non_resizable_type(part_type: &str) -> bool {
    matches!(
        part_type,
        "System" | "Reserved" | "Recovery" | "EFI System Partition"
    )
}

fn available_drive_letters(used_extra: &HashSet<char>) -> Vec<String> {
    let mut used = used_extra.clone();
    let mask = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() };
    for idx in 0..26u32 {
        if mask & (1 << idx) != 0 {
            used.insert((b'A' + idx as u8) as char);
        }
    }
    ('D'..='Z')
        .filter(|ch| !used.contains(ch))
        .map(|ch| ch.to_string())
        .collect()
}

fn extract_volume_guid(row: &crate::details::Row) -> Option<String> {
    let Variant::Array(items) = row.get("AccessPaths")? else {
        return None;
    };
    for item in items {
        if let Variant::String(s) = item {
            let norm = s.trim().to_ascii_lowercase();
            if norm.starts_with(r"\\?\volume{") {
                return Some(norm.trim_end_matches('\\').to_owned());
            }
        }
    }
    None
}

fn query_supported_sizes() -> HashMap<(u32, u32), (f64, f64)> {
    let mut map = HashMap::new();
    let script = "Get-Partition | Where-Object { $_.Type -eq 'Basic' -or $_.Type -eq 'IFS' } | ForEach-Object { try { $s = Get-PartitionSupportedSize -DiskNumber $_.DiskNumber -PartitionNumber $_.PartitionNumber -ErrorAction Stop; \"{0}|{1}|{2}|{3}\" -f $_.DiskNumber,$_.PartitionNumber,$s.SizeMin,$s.SizeMax } catch {} }";
    let Ok(out) = run_powershell(script) else {
        return map;
    };
    for line in out.lines() {
        let p: Vec<&str> = line.trim().split('|').collect();
        if p.len() == 4
            && let (Ok(dn), Ok(pn), Ok(min_b), Ok(max_b)) = (
                p[0].parse::<u32>(),
                p[1].parse::<u32>(),
                p[2].parse::<u64>(),
                p[3].parse::<u64>(),
            )
        {
            map.insert(
                (dn, pn),
                (
                    round2(min_b as f64 / 1_073_741_824.0),
                    round2(max_b as f64 / 1_073_741_824.0),
                ),
            );
        }
    }
    map
}

pub fn list_disks(rescan: bool, notice: String, notice_error: bool) -> DiskPartitionerState {
    if rescan {
        let _ = run_powershell("Update-HostStorageCache -ErrorAction SilentlyContinue");
    }
    let _com = ComApartment::enter();
    let storage = WMIConnection::with_namespace_path(r"ROOT\Microsoft\Windows\Storage").ok();
    let is_admin = native::elevated();

    let supported_sizes = if is_admin {
        query_supported_sizes()
    } else {
        HashMap::new()
    };

    type VolMeta = (String, String, u64, u64, String);
    let mut volumes_by_letter: HashMap<char, VolMeta> = HashMap::new();
    let mut volumes_by_guid: HashMap<String, VolMeta> = HashMap::new();
    let mut used_letters = HashSet::new();
    for vol in rows(
        storage.as_ref(),
        "SELECT Path, DriveLetter, FileSystemLabel, FileSystem, Size, SizeRemaining, HealthStatus FROM MSFT_Volume",
    ) {
        let label = text(&vol, "FileSystemLabel").unwrap_or("").to_owned();
        let fs = text(&vol, "FileSystem").unwrap_or("").to_owned();
        let total = number(&vol, "Size").unwrap_or(0);
        let rem = number(&vol, "SizeRemaining").unwrap_or(0);
        let health = health_name(number(&vol, "HealthStatus")).to_owned();
        if let Some(vpath) = text(&vol, "Path") {
            let norm = vpath.trim().to_ascii_lowercase().trim_end_matches('\\').to_owned();
            if norm.starts_with(r"\\?\volume{") {
                volumes_by_guid.insert(norm, (label.clone(), fs.clone(), total, rem, health.clone()));
            }
        }
        if let Some(letter) = text(&vol, "DriveLetter")
            .and_then(|v| v.chars().next())
            .or_else(|| {
                number(&vol, "DriveLetter")
                    .and_then(|n| u8::try_from(n).ok())
                    .map(|b| b as char)
            })
            .filter(|c| c.is_ascii_alphabetic())
            .map(|c| c.to_ascii_uppercase())
        {
            used_letters.insert(letter);
            volumes_by_letter.insert(letter, (label, fs, total, rem, health));
        }
    }

    let mut parts_by_disk: HashMap<u32, Vec<crate::details::Row>> = HashMap::new();
    for part in rows(
        storage.as_ref(),
        "SELECT DiskNumber, PartitionNumber, Offset, Size, DriveLetter, AccessPaths, IsSystem, IsBoot, IsActive, GptType, MbrType FROM MSFT_Partition",
    ) {
        if let Some(dn) = number(&part, "DiskNumber").and_then(|n| u32::try_from(n).ok()) {
            parts_by_disk.entry(dn).or_default().push(part);
        }
    }

    let mut raw_disks = rows(
        storage.as_ref(),
        "SELECT Number, FriendlyName, BusType, PartitionStyle, Size, AllocatedSize, IsOffline, IsReadOnly, IsSystem, IsBoot, HealthStatus FROM MSFT_Disk",
    );
    raw_disks.sort_by_key(|row| number(row, "Number").unwrap_or(u64::MAX));

    let mut disks = Vec::new();
    for row in raw_disks {
        let Some(disk_num) = number(&row, "Number").and_then(|n| u32::try_from(n).ok()) else {
            continue;
        };
        let disk_bytes = number(&row, "Size").unwrap_or(0);
        let allocated_bytes = number(&row, "AllocatedSize").unwrap_or(0);
        let disk_gb = round2(disk_bytes as f64 / 1_073_741_824.0);
        let alloc_gb = round2(allocated_bytes as f64 / 1_073_741_824.0);
        let unalloc_gb = round2((disk_bytes.saturating_sub(allocated_bytes)) as f64 / 1_073_741_824.0);
        let part_style = partition_style_name(number(&row, "PartitionStyle")).to_owned();
        let mut disk_parts = parts_by_disk.remove(&disk_num).unwrap_or_default();
        disk_parts.sort_by_key(|p| number(p, "Offset").unwrap_or(0));

        let mut is_system_disk = flag(&row, "IsSystem") || flag(&row, "IsBoot");
        for p in &disk_parts {
            let letter = extract_letter(p);
            if letter == Some('C') || flag(p, "IsSystem") || flag(p, "IsBoot") {
                is_system_disk = true;
            }
        }

        let mut segments = Vec::new();
        let mut cursor = ALIGN_START_BYTES;
        if part_style == "RAW" && disk_parts.is_empty() {
            if disk_bytes >= MIN_UNALLOC_BYTES {
                segments.push(DiskSegment {
                    kind: "unallocated",
                    disk_number: disk_num,
                    partition_number: 0,
                    offset_bytes: 0,
                    size_bytes: disk_bytes,
                    size_gb: disk_gb,
                    pct_of_disk: 100.0,
                    label: "Uninitialized (RAW)".into(),
                    drive_letter: String::new(),
                    file_system: String::new(),
                    part_type: "Unallocated".into(),
                    is_protected: false,
                    is_system: false,
                    is_boot: false,
                    is_active: false,
                    health_status: String::new(),
                    free_gb: None,
                    used_pct: None,
                    min_size_gb: None,
                    max_size_gb: None,
                });
            }
        } else {
            for p in &disk_parts {
                let offset = number(p, "Offset").unwrap_or(0);
                let size = number(p, "Size").unwrap_or(0);
                if offset > cursor && offset - cursor >= MIN_UNALLOC_BYTES {
                    let gap = offset - cursor;
                    segments.push(make_unalloc_segment(disk_num, cursor, gap, disk_bytes));
                }
                let p_num = number(p, "PartitionNumber").unwrap_or(0) as u32;
                let letter_char = extract_letter(p);
                let drive_letter = letter_char.map(|c| c.to_string()).unwrap_or_default();
                let is_system = flag(p, "IsSystem");
                let is_boot = flag(p, "IsBoot");
                let is_active = flag(p, "IsActive");
                let part_type =
                    partition_type_name(text(p, "GptType"), number(p, "MbrType"), is_system);
                let is_protected =
                    is_protected_partition(&drive_letter, is_system, is_boot, &part_type);
                // Match by DriveLetter first, then fall back to Volume GUID (populates EFI FAT32 & Recovery NTFS!)
                let vol_meta = letter_char
                    .and_then(|c| volumes_by_letter.get(&c))
                    .or_else(|| {
                        extract_volume_guid(p).and_then(|g| volumes_by_guid.get(&g))
                    });
                let (label, file_system, free_gb, used_pct, health_status) = vol_meta
                    .map(|(lbl, fs, total, rem, health)| {
                        let free = round2(*rem as f64 / 1_073_741_824.0);
                        let used = if *total > 0 {
                            Some(round2((total.saturating_sub(*rem) as f64 / *total as f64) * 100.0))
                        } else {
                            None
                        };
                        (lbl.clone(), fs.clone(), Some(free), used, health.clone())
                    })
                    .unwrap_or_else(|| (String::new(), String::new(), None, None, String::new()));

                let (min_size_gb, max_size_gb) = supported_sizes
                    .get(&(disk_num, p_num))
                    .map(|&(mn, mx)| (Some(mn), Some(mx)))
                    .unwrap_or((None, None));

                segments.push(DiskSegment {
                    kind: "partition",
                    disk_number: disk_num,
                    partition_number: p_num,
                    offset_bytes: offset,
                    size_bytes: size,
                    size_gb: round2(size as f64 / 1_073_741_824.0),
                    pct_of_disk: if disk_bytes > 0 {
                        round2((size as f64 / disk_bytes as f64) * 100.0)
                    } else {
                        0.0
                    },
                    label,
                    drive_letter,
                    file_system,
                    part_type,
                    is_protected,
                    is_system,
                    is_boot,
                    is_active,
                    health_status,
                    free_gb,
                    used_pct,
                    min_size_gb,
                    max_size_gb,
                });
                let end = offset.saturating_add(size);
                if end > cursor {
                    cursor = end;
                }
            }
            if disk_bytes > cursor && disk_bytes - cursor >= MIN_UNALLOC_BYTES {
                let tail = disk_bytes - cursor;
                segments.push(make_unalloc_segment(disk_num, cursor, tail, disk_bytes));
            }
        }

        let is_offline = flag(&row, "IsOffline");
        disks.push(DiskEntry {
            number: disk_num,
            friendly_name: text(&row, "FriendlyName")
                .unwrap_or("Physical Disk")
                .to_owned(),
            bus_type: bus_type_name(number(&row, "BusType")).to_owned(),
            partition_style: part_style,
            size_bytes: disk_bytes,
            size_gb: disk_gb,
            allocated_gb: alloc_gb,
            unallocated_gb: unalloc_gb,
            is_offline,
            is_readonly: flag(&row, "IsReadOnly"),
            is_system_disk,
            health_status: health_name(number(&row, "HealthStatus")).to_owned(),
            operational_status: if is_offline { "Offline" } else { "Online" }.to_owned(),
            partition_count: disk_parts.len(),
            segments,
        });
    }

    let scanned_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    DiskPartitionerState {
        is_admin,
        available_letters: available_drive_letters(&used_letters),
        disks,
        scanned_at_ms,
        notice,
        notice_error,
    }
}

fn extract_letter(row: &crate::details::Row) -> Option<char> {
    text(row, "DriveLetter")
        .and_then(|v| v.chars().next())
        .or_else(|| {
            number(row, "DriveLetter")
                .and_then(|n| u8::try_from(n).ok())
                .map(|b| b as char)
        })
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase())
}

fn make_unalloc_segment(disk_number: u32, offset: u64, size: u64, disk_bytes: u64) -> DiskSegment {
    DiskSegment {
        kind: "unallocated",
        disk_number,
        partition_number: 0,
        offset_bytes: offset,
        size_bytes: size,
        size_gb: round2(size as f64 / 1_073_741_824.0),
        pct_of_disk: if disk_bytes > 0 {
            round2((size as f64 / disk_bytes as f64) * 100.0)
        } else {
            0.0
        },
        label: "Unallocated Space".into(),
        drive_letter: String::new(),
        file_system: String::new(),
        part_type: "Unallocated".into(),
        is_protected: false,
        is_system: false,
        is_boot: false,
        is_active: false,
        health_status: String::new(),
        free_gb: None,
        used_pct: None,
        min_size_gb: None,
        max_size_gb: None,
    }
}

fn sanitize_label(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '-'))
        .take(32)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn validate_fs(fs: &str) -> Result<&'static str, String> {
    match fs.trim().to_ascii_uppercase().as_str() {
        "NTFS" => Ok("NTFS"),
        "EXFAT" => Ok("exFAT"),
        "FAT32" => Ok("FAT32"),
        "REFS" => Ok("ReFS"),
        _ => Err("Unsupported file system. Choose NTFS, exFAT, FAT32, or ReFS.".into()),
    }
}

fn validate_cluster(cluster: Option<u32>) -> Result<Option<u32>, String> {
    match cluster {
        None | Some(0) => Ok(None),
        Some(v @ (4096 | 8192 | 16384 | 32768 | 65536)) => Ok(Some(v)),
        Some(_) => Err("Cluster size must be Default, 4K, 8K, 16K, 32K, or 64K.".into()),
    }
}

fn validate_letter(raw: Option<&str>) -> Result<Option<char>, String> {
    let Some(s) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let ch = s
        .chars()
        .next()
        .filter(|c| c.is_ascii_alphabetic())
        .map(|c| c.to_ascii_uppercase())
        .ok_or("Drive letter must be a single letter D–Z.")?;
    if !('D'..='Z').contains(&ch) {
        return Err("Drive letter must be between D and Z.".into());
    }
    Ok(Some(ch))
}

fn run_powershell(script: &str) -> Result<String, String> {
    let ps = crate::network::system_directory()?
        .join(r"WindowsPowerShell\v1.0\powershell.exe");
    let output = Command::new(ps)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to invoke Windows Storage engine: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

pub fn execute_action(action: PartitionAction) -> Result<DiskPartitionerState, String> {
    if matches!(action, PartitionAction::OpenDiskMgmt) {
        dashboard_actions::shell_open("diskmgmt.msc", None, false)?;
        return Ok(list_disks(
            false,
            "Opened Windows Disk Management (diskmgmt.msc).".into(),
            false,
        ));
    }

    // Native instant SetVolumeLabelW for SetLabel (no PowerShell spawn needed!)
    if let PartitionAction::SetLabel {
        disk,
        partition,
        label,
    } = action
    {
        let snapshot = list_disks(false, String::new(), false);
        let seg = snapshot
            .disks
            .iter()
            .find(|d| d.number == disk)
            .and_then(|d| {
                d.segments
                    .iter()
                    .find(|s| s.kind == "partition" && s.partition_number == partition)
            })
            .ok_or_else(|| format!("Partition {partition} on Disk {disk} was not found."))?;
        if seg.drive_letter.is_empty() {
            return Err("Assign a drive letter before changing the volume label.".into());
        }
        let clean = sanitize_label(&label);
        let mount = format!("{}:\\", seg.drive_letter);
        dashboard_actions::label_volume(&mount, &clean)?;
        return Ok(list_disks(
            false,
            format!("Updated volume label on {}: to '{clean}'.", seg.drive_letter),
            false,
        ));
    }

    system_controls::require_admin()?;
    let snapshot = list_disks(false, String::new(), false);

    let find_disk = |disk_num: u32| -> Result<&DiskEntry, String> {
        snapshot
            .disks
            .iter()
            .find(|d| d.number == disk_num)
            .ok_or_else(|| format!("Disk {disk_num} was not found."))
    };

    let find_part = |disk_num: u32, part_num: u32| -> Result<&DiskSegment, String> {
        find_disk(disk_num)?
            .segments
            .iter()
            .find(|s| s.kind == "partition" && s.partition_number == part_num)
            .ok_or_else(|| format!("Partition {part_num} on Disk {disk_num} was not found."))
    };

    let notice = match action {
        PartitionAction::Initialize { disk, style } => {
            let entry = find_disk(disk)?;
            if entry.is_system_disk {
                return Err("Refused: Cannot initialize the active System/Boot disk.".into());
            }
            let style_norm = match style.trim().to_ascii_uppercase().as_str() {
                "GPT" => "GPT",
                "MBR" => "MBR",
                _ => return Err("Partition style must be GPT or MBR.".into()),
            };
            let online_prefix = if entry.is_offline {
                format!("Set-Disk -Number {disk} -IsOffline $false -ErrorAction Stop; ")
            } else {
                String::new()
            };
            run_powershell(&format!(
                "{online_prefix}Initialize-Disk -Number {disk} -PartitionStyle {style_norm} -ErrorAction Stop"
            ))?;
            format!("Initialized Disk {disk} as {style_norm}.")
        }
        PartitionAction::CreatePartition {
            disk,
            size_mb,
            drive_letter,
            no_letter,
            file_system,
            label,
            cluster_size,
            full_format,
        } => {
            let entry = find_disk(disk)?;
            let fs = validate_fs(&file_system)?;
            let cluster = validate_cluster(cluster_size)?;
            let clean_label = sanitize_label(&label);
            let letter = validate_letter(drive_letter.as_deref())?;
            let size_arg = match size_mb.filter(|&m| m >= 16) {
                Some(mb) => format!("-Size ({mb} * 1MB)"),
                None => "-UseMaximumSize".into(),
            };
            let letter_arg = if no_letter {
                String::new()
            } else {
                match letter {
                    Some(ch) => format!("-DriveLetter '{ch}'"),
                    None => "-AssignDriveLetter".into(),
                }
            };
            let label_arg = if clean_label.is_empty() {
                String::new()
            } else {
                format!(" -NewFileSystemLabel '{clean_label}'")
            };
            let cluster_arg = cluster
                .map(|c| format!(" -AllocationUnitSize {c}"))
                .unwrap_or_default();
            let full_arg = if full_format { " -Full" } else { "" };
            let online_prefix = if entry.is_offline {
                format!("Set-Disk -Number {disk} -IsOffline $false -ErrorAction Stop; ")
            } else {
                String::new()
            };
            run_powershell(&format!(
                "{online_prefix}$p = New-Partition -DiskNumber {disk} {size_arg} {letter_arg} -ErrorAction Stop; Format-Volume -Partition $p -FileSystem {fs}{label_arg}{cluster_arg}{full_arg} -Confirm:$false -Force -ErrorAction Stop | Out-Null"
            ))?;
            format!("Created and formatted new {fs} partition on Disk {disk}.")
        }
        PartitionAction::FormatPartition {
            disk,
            partition,
            file_system,
            label,
            cluster_size,
            full_format,
        } => {
            let seg = find_part(disk, partition)?;
            if seg.is_protected {
                return Err(
                    "Refused: System, Boot, C:, EFI, Reserved, and Recovery partitions are protected."
                        .into(),
                );
            }
            let fs = validate_fs(&file_system)?;
            let cluster = validate_cluster(cluster_size)?;
            let clean_label = sanitize_label(&label);
            let label_arg = if clean_label.is_empty() {
                String::new()
            } else {
                format!(" -NewFileSystemLabel '{clean_label}'")
            };
            let cluster_arg = cluster
                .map(|c| format!(" -AllocationUnitSize {c}"))
                .unwrap_or_default();
            let full_arg = if full_format { " -Full" } else { "" };
            run_powershell(&format!(
                "$p = Get-Partition -DiskNumber {disk} -PartitionNumber {partition} -ErrorAction Stop; Format-Volume -Partition $p -FileSystem {fs}{label_arg}{cluster_arg}{full_arg} -Confirm:$false -Force -ErrorAction Stop | Out-Null"
            ))?;
            format!(
                "{} formatted Disk {disk} Partition {partition} as {fs}.",
                if full_format { "Full" } else { "Quick" }
            )
        }
        PartitionAction::ResizePartition {
            disk,
            partition,
            size_mb,
        } => {
            let seg = find_part(disk, partition)?;
            if is_non_resizable_type(&seg.part_type) {
                return Err("Refused: EFI, Reserved, System, and Recovery partitions cannot be resized here.".into());
            }
            if size_mb < 64 {
                return Err("Target partition size must be at least 64 MB.".into());
            }
            run_powershell(&format!(
                "Resize-Partition -DiskNumber {disk} -PartitionNumber {partition} -Size ({size_mb} * 1MB) -ErrorAction Stop"
            ))?;
            format!("Resized Disk {disk} Partition {partition} to {size_mb} MB.")
        }
        PartitionAction::SetLetter {
            disk,
            partition,
            drive_letter,
        } => {
            let seg = find_part(disk, partition)?;
            if seg.is_protected {
                return Err("Refused: Cannot reassign or remove the drive letter on a protected partition.".into());
            }
            let letter = validate_letter(drive_letter.as_deref())?;
            if let Some(ch) = letter {
                run_powershell(&format!(
                    "Set-Partition -DiskNumber {disk} -PartitionNumber {partition} -NewDriveLetter '{ch}' -ErrorAction Stop"
                ))?;
                format!("Assigned drive letter {ch}: to Disk {disk} Partition {partition}.")
            } else {
                if seg.drive_letter.is_empty() {
                    return Err("This partition does not have a drive letter assigned.".into());
                }
                let cur = &seg.drive_letter;
                run_powershell(&format!(
                    "Remove-PartitionAccessPath -DiskNumber {disk} -PartitionNumber {partition} -AccessPath '{cur}:\\' -ErrorAction Stop"
                ))?;
                format!("Removed drive letter {cur}: from Disk {disk} Partition {partition}.")
            }
        }
        PartitionAction::DeletePartition { disk, partition } => {
            let seg = find_part(disk, partition)?;
            if seg.is_protected {
                return Err(
                    "Refused: Cannot delete System, Boot, C:, EFI, Reserved, or Recovery partitions."
                        .into(),
                );
            }
            run_powershell(&format!(
                "Remove-Partition -DiskNumber {disk} -PartitionNumber {partition} -Confirm:$false -ErrorAction Stop"
            ))?;
            format!("Deleted Partition {partition} on Disk {disk}.")
        }
        PartitionAction::ClearDisk {
            disk,
            confirm_token,
        } => {
            let entry = find_disk(disk)?;
            if entry.is_system_disk {
                return Err("Refused: Cannot wipe the active Windows System/Boot disk.".into());
            }
            let expected = format!("DISK {disk}");
            if confirm_token
                .as_deref()
                .map(str::trim)
                .is_none_or(|t| !t.eq_ignore_ascii_case(&expected))
            {
                return Err(format!(
                    "Safety verification failed: type '{expected}' exactly to confirm wiping Disk {disk}."
                ));
            }
            run_powershell(&format!(
                "Clear-Disk -Number {disk} -RemoveData -RemoveOEM -Confirm:$false -ErrorAction Stop"
            ))?;
            format!("Cleared all partitions on Disk {disk}.")
        }
        PartitionAction::SetOnline { disk, online } => {
            let entry = find_disk(disk)?;
            if entry.is_system_disk && !online {
                return Err("Refused: Cannot take the Windows System/Boot disk offline.".into());
            }
            let offline_flag = if online { "$false" } else { "$true" };
            run_powershell(&format!(
                "Set-Disk -Number {disk} -IsOffline {offline_flag} -ErrorAction Stop"
            ))?;
            format!(
                "Set Disk {disk} {}.",
                if online { "Online" } else { "Offline" }
            )
        }
        PartitionAction::OpenDiskMgmt | PartitionAction::SetLabel { .. } => unreachable!(),
    };

    Ok(list_disks(true, notice, false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_system_boot_c_and_reserved_partitions() {
        assert!(is_protected_partition("C", false, false, "Basic"));
        assert!(is_protected_partition("c", false, false, "Basic"));
        assert!(is_protected_partition("D", true, false, "Basic"));
        assert!(is_protected_partition("D", false, true, "Basic"));
        assert!(is_protected_partition("", false, false, "EFI System Partition"));
        assert!(is_protected_partition("", false, false, "Recovery"));
        assert!(is_protected_partition("", false, false, "Reserved"));
        assert!(!is_protected_partition("D", false, false, "Basic"));
        assert!(!is_protected_partition("", false, false, "Basic"));
    }

    #[test]
    fn sanitizes_volume_labels_and_validates_letters_and_clusters() {
        assert_eq!(sanitize_label("Data_Drive-1; rm -rf"), "Data_Drive-1 rm -rf");
        assert_eq!(validate_letter(Some("e")).unwrap(), Some('E'));
        assert!(validate_letter(Some("C")).is_err());
        assert_eq!(validate_letter(Some("")).unwrap(), None);
        assert_eq!(validate_fs("ntfs").unwrap(), "NTFS");
        assert!(validate_fs("ext4").is_err());
        assert_eq!(validate_cluster(Some(4096)).unwrap(), Some(4096));
        assert!(validate_cluster(Some(1234)).is_err());
    }
}
