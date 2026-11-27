use crate::event_log::{self, Key, Query, Reader, Record};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    ptr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::System::{
    Diagnostics::Debug::{
        FORMAT_MESSAGE_FROM_HMODULE, FORMAT_MESSAGE_FROM_SYSTEM, FORMAT_MESSAGE_IGNORE_INSERTS,
        FormatMessageW,
    },
    LibraryLoader::GetModuleHandleW,
};

const CHANNELS: &[(&str, usize)] = &[
    ("System", 140),
    ("Application", 140),
    ("Setup", 40),
    ("Microsoft-Windows-Kernel-WHEA/Errors", 40),
    ("Microsoft-Windows-Ntfs/Operational", 40),
    ("Microsoft-Windows-WindowsUpdateClient/Operational", 40),
    ("Microsoft-Windows-WLAN-AutoConfig/Operational", 40),
    ("Microsoft-Windows-DHCP-Client/Admin", 30),
    ("Microsoft-Windows-Windows Defender/Operational", 40),
    ("Microsoft-Windows-TaskScheduler/Operational", 30),
];

const SUBSYSTEM_DEFS: &[(&str, &str)] = &[
    ("Kernel & Power", "⚡"),
    ("Hardware / WHEA", "🔬"),
    ("Storage & Disk", "💾"),
    ("Graphics / GPU", "🎮"),
    ("Network & DNS", "📡"),
    ("Applications & Crashes", "💥"),
    ("Windows Update & Services", "⚙️"),
    ("System Security", "🛡️"),
];

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub hours: u32,
    pub warnings: bool,
}

#[derive(Serialize)]
pub struct Report {
    pub hours: u32,
    pub time_ms: u64,
    score: Option<u32>,
    grade: &'static str,
    counts: Counts,
    channels: Vec<Channel>,
    subsystems: Vec<SubsystemHealth>,
    findings: Vec<Finding>,
    pub events: Vec<Event>,
    pub last_crash: Option<Record>,
    recurring: Vec<Signature>,
    dumps: Vec<Dump>,
    reliability_index: Option<f64>,
    wer_recent: Option<usize>,
}

#[derive(Default, Serialize)]
struct Counts {
    total: usize,
    critical: u32,
    errors: u32,
    warnings: u32,
    benign: u32,
}

#[derive(Serialize)]
struct Channel {
    name: &'static str,
    count: usize,
    limited: bool,
    error: Option<String>,
}

#[derive(Serialize)]
struct SubsystemHealth {
    name: &'static str,
    icon: &'static str,
    status: &'static str,
    critical: u32,
    errors: u32,
    warnings: u32,
    total: u32,
}

#[derive(Serialize)]
struct Finding {
    id: &'static str,
    severity: &'static str,
    subsystem: &'static str,
    title: String,
    detail: String,
    recommended_fix: &'static str,
    count: usize,
}

#[derive(Serialize)]
pub struct Event {
    #[serde(flatten)]
    pub record: Record,
    category: &'static str,
    subsystem: &'static str,
    summary: &'static str,
    recommended_fix: &'static str,
    benign: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    extracted_codes: Vec<String>,
}

#[derive(Serialize)]
struct Signature {
    provider: String,
    event_id: u16,
    category: &'static str,
    summary: &'static str,
    count: usize,
}

#[derive(Serialize)]
struct Dump {
    name: String,
    path: String,
    kind: &'static str,
    size: u64,
    time_ms: Option<u64>,
    stop_code: Option<String>,
    stop_hex: Option<String>,
}

fn epoch_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

pub fn valid_key(key: &Key) -> bool {
    key.record > 0 && key.time_ms > 0 && CHANNELS.iter().any(|(channel, _)| *channel == key.channel)
}

fn extract_hex_codes(message: Option<&str>) -> Vec<String> {
    let Some(msg) = message else {
        return Vec::new();
    };
    let bytes = msg.as_bytes();
    let mut codes = Vec::new();
    let mut seen = HashSet::new();
    let mut i = 0;
    while i + 2 < bytes.len() && codes.len() < 3 {
        if bytes[i] == b'0' && (bytes[i + 1] == b'x' || bytes[i + 1] == b'X') {
            let start = i + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_hexdigit() {
                end += 1;
            }
            let digits = end - start;
            if (2..=8).contains(&digits) {
                let hex = format!("0x{}", msg[start..end].to_ascii_uppercase());
                if hex != "0x0" && hex != "0x00" && hex != "0x00000000" && seen.insert(hex.clone())
                {
                    codes.push(hex);
                }
            }
            i = end;
        } else {
            i += 1;
        }
    }
    codes
}

fn classify(record: Record) -> Event {
    let provider = record.provider.to_ascii_lowercase();
    let (subsystem, summary, fix, benign) = match (provider.as_str(), record.event_id) {
        ("microsoft-windows-kernel-power", 41) => (
            "Kernel & Power",
            "Windows rebooted without a clean shutdown (power loss, hard reset, or thermal/PSU trip).",
            "Check PSU cables, CPU/GPU thermals, RAM XMP/EXPO stability, and inspect any preceding WHEA or BugCheck events.",
            false,
        ),
        ("microsoft-windows-kernel-power", 137 | 506 | 507) => (
            "Kernel & Power",
            "Modern Standby / system sleep power transition issue reported by the kernel.",
            "Update chipset & BIOS firmware and verify powercfg /sleepstudy for misbehaving wake devices.",
            false,
        ),
        ("eventlog", 6008) => (
            "Kernel & Power",
            "Windows logged that the previous shutdown was unexpected.",
            "Correlate with Kernel-Power 41 and BugCheck 1001 events right before this timestamp.",
            false,
        ),
        ("microsoft-windows-wer-systemerrorreporting" | "bugcheck", 1001) => (
            "Kernel & Power",
            "Windows recovered from a Blue Screen (BugCheck) and recorded the stop code and dump file.",
            "Translate the stop code below and inspect the matching minidump file in C:\\Windows\\Minidump.",
            false,
        ),
        ("microsoft-windows-kernel-general", 1 | 5 | 6) => (
            "Kernel & Power",
            "Kernel registry hive or system clock anomaly recorded.",
            "Run chkdsk on the system volume and verify CMOS battery / Windows Time service.",
            false,
        ),
        ("microsoft-windows-kernel-boot", 29 | 124) => (
            "Kernel & Power",
            "Fast Startup / kernel boot failure occurred.",
            "Try disabling Fast Startup in Power Options or updating storage controller drivers.",
            false,
        ),
        ("microsoft-windows-distributedcom", 10016 | 10010) => (
            "Windows Update & Services",
            "Common DistributedCOM activation/permission warning (generally harmless on Windows 10/11).",
            "Safe to ignore unless directly accompanying a broken app or service startup failure.",
            true,
        ),
        ("microsoft-windows-devicesetupmanager", 131 | 121 | 122 | 123) => (
            "Windows Update & Services",
            "Windows Device Setup Manager failed to download optional device metadata from Microsoft servers.",
            "Benign network metadata warning; does not affect driver functionality.",
            true,
        ),
        ("microsoft-windows-tpm-wmi", 1796 | 1801) => (
            "System Security",
            "Secure Boot DBX / TPM attestation update warning.",
            "Ensure BIOS firmware is up to date and TPM 2.0 is enabled in UEFI.",
            false,
        ),
        ("application error", 1000) => (
            "Applications & Crashes",
            "An application crashed with an unhandled exception. Inspect the faulting module and exception code.",
            "Update the crashing application or GPU/runtime DLL named in the message; click the 0x code to translate.",
            false,
        ),
        ("application hang", 1002) => (
            "Applications & Crashes",
            "An application stopped responding to Windows and was closed.",
            "Check for background overlays, disk I/O stalls, or corrupted app cache/plugins.",
            false,
        ),
        (".net runtime", 1026 | 1023) => (
            "Applications & Crashes",
            "Unhandled .NET runtime exception terminated a managed process.",
            "Repair or update the target .NET Desktop Runtime and check the stack trace in the event body.",
            false,
        ),
        ("windows error reporting", 1001) => (
            "Applications & Crashes",
            "Windows Error Reporting archived a crash bucket for an application or driver.",
            "Review the Problem Signature (P1 = app name, P4 = faulting module, P7 = exception code).",
            false,
        ),
        ("display" | "nvlddmkm" | "amdwddmg" | "amdkmdag" | "igfx", 4101 | 13 | 14 | 153 | 0) => (
            "Graphics / GPU",
            "Graphics driver stopped responding and was reset by Windows TDR (Timeout Detection & Recovery).",
            "Perform a clean GPU driver install (DDU), back off GPU overclock/undervolt, and check PCIe power seating.",
            false,
        ),
        ("disk", 7 | 11 | 51 | 52 | 153 | 154) => (
            "Storage & Disk",
            "Low-level disk I/O error, bad block, or controller retry timeout detected.",
            "Back up data immediately, check SATA/NVMe seating, and inspect SMART health & wear on the Dashboard.",
            false,
        ),
        ("ntfs" | "microsoft-windows-ntfs", 50 | 55 | 98 | 130 | 137 | 140) => (
            "Storage & Disk",
            "NTFS filesystem metadata corruption or delayed-write failure on a mounted volume.",
            "Run 'chkdsk /scan' or schedule 'chkdsk /f' on the named volume and verify drive SMART status.",
            false,
        ),
        ("storahci" | "stornvme" | "nvme" | "iaStorA" | "iastorac", 129 | 153) => (
            "Storage & Disk",
            "Storage controller (NVMe/AHCI) issued a bus reset due to an unresponsive drive command.",
            "Update NVMe firmware & motherboard chipset drivers; disable PCIe Link State Power Management if recurring.",
            false,
        ),
        ("volsnap", 25 | 36 | 39) => (
            "Storage & Disk",
            "Volume Shadow Copy (System Restore / backup snapshot) aborted due to low shadow storage space.",
            "Increase shadow storage allocation or free disk space on the affected drive.",
            false,
        ),
        ("service control manager", 7000 | 7001 | 7009 | 7011 | 7023 | 7024 | 7031 | 7034) => (
            "Windows Update & Services",
            "A Windows service failed to start, timed out, or terminated unexpectedly.",
            "Check the service binary & dependencies in Tasks & Ports → Windows Services; run DISM / SFC if a core OS service.",
            false,
        ),
        ("microsoft-windows-dns-client", 1014) => (
            "Network & DNS",
            "DNS name resolution timed out after none of the configured DNS servers responded.",
            "Flush DNS cache, test Cloudflare (1.1.1.1) or Google (8.8.8.8) in Network Manager, or check router uplink.",
            false,
        ),
        ("e1dexpress" | "e1rexpress" | "rt640x64" | "ndis" | "netwtw10" | "netwtw12" | "netwtw14", 27 | 32 | 5002 | 5005 | 10400) => (
            "Network & DNS",
            "Network adapter link flap, hardware reset, or driver fault.",
            "Update NIC/Wi-Fi drivers from motherboard vendor and disable Energy-Efficient Ethernet (EEE) if drops persist.",
            false,
        ),
        ("microsoft-windows-whea-logger" | "microsoft-windows-kernel-whea", 1 | 17 | 18 | 19 | 20 | 47) => (
            "Hardware / WHEA",
            "Windows Hardware Error Architecture (WHEA) logged a CPU, cache, memory ECC, or PCIe hardware error.",
            "If Event 18/19: ease CPU Curve Optimizer / overclock & verify RAM XMP. If Event 17: reseat GPU/NVMe or update BIOS.",
            false,
        ),
        (_, _) if provider.contains("whea") => (
            "Hardware / WHEA",
            "Windows Hardware Error Architecture reported a hardware fault. Check the component & APIC ID in the message.",
            "Reset unstable CPU/RAM overclocks, update BIOS AGESA/microcode, and inspect PCIe devices.",
            false,
        ),
        (_, _) if provider.contains("windowsupdate") => (
            "Windows Update & Services",
            "Windows Update reported a download, staging, or install issue.",
            "Run Security & Repair → DISM RestoreHealth & SFC /scannow, or reset the Windows Update cache.",
            false,
        ),
        (_, _) if provider.contains("wlan") || provider.contains("dhcp") || provider.contains("tcpip") || provider.contains("dns") => (
            "Network & DNS",
            "Windows recorded a Wi-Fi, DHCP lease, or IP stack warning/error.",
            "Use Network Manager → Active Diagnostics & Wi-Fi/Routing to inspect signal, gateway, and DHCP lease.",
            false,
        ),
        (_, _) if provider.contains("defender") || provider.contains("security") || provider.contains("bitlocker") || provider.contains("schannel") => (
            "System Security",
            "Windows Security, Defender, BitLocker, or TLS/Schannel reported an event.",
            "Open Security & Repair to inspect Defender health, Secure Boot, HVCI, and expiring certificates.",
            provider.contains("schannel") && record.level == 3,
        ),
        (_, _) if provider.contains("taskscheduler") => (
            "Windows Update & Services",
            "A scheduled background task failed to launch or returned a non-zero exit code.",
            "Inspect the task name and action path in the event message; remove orphaned tasks from uninstalled apps.",
            false,
        ),
        (_, _) if provider.contains("ntfs") || provider.contains("disk") || provider.contains("partmgr") || provider.contains("vds") => (
            "Storage & Disk",
            "Windows storage subsystem recorded a volume or disk warning/error.",
            "Check Disk Map / Dashboard SMART indicators and run chkdsk /scan on affected volumes.",
            false,
        ),
        (_, _) if provider.contains("nvlddmkm") || provider.contains("amdwddmg") || provider.contains("dwm") || provider.contains("dxkrnl") || provider.contains("display") => (
            "Graphics / GPU",
            "Graphics stack or Desktop Window Manager (DWM) reported an error.",
            "Update GPU drivers, check display cable/HDR settings, and verify GPU temperatures under load.",
            false,
        ),
        (_, _) if record.key.channel == "Application" => (
            "Applications & Crashes",
            "Application-channel event logged by installed software.",
            "Review the faulting component or error code in the event details below.",
            false,
        ),
        _ => (
            "Kernel & Power",
            "System-channel event recorded by Windows.",
            "Inspect the provider message and correlate with nearby events using ±5 min correlation.",
            false,
        ),
    };
    let extracted_codes = extract_hex_codes(record.message.as_deref());
    Event {
        record,
        category: subsystem,
        subsystem,
        summary,
        recommended_fix: fix,
        benign,
        extracted_codes,
    }
}

fn scan_channel(name: &'static str, limit: usize, filter: &str) -> (Channel, Vec<Event>) {
    let mut channel = Channel {
        name,
        count: 0,
        limited: false,
        error: None,
    };
    let mut out = Vec::new();
    let mut reader = match Reader::open() {
        Ok(r) => r,
        Err(status) => {
            channel.error = Some(format!("Event Log unavailable ({status})"));
            return (channel, out);
        }
    };
    match Query::open(name, filter) {
        Ok(mut query) => {
            for _ in 0..=limit {
                match query.next(&mut reader) {
                    Ok(Some(_)) if channel.count == limit => {
                        channel.limited = true;
                        break;
                    }
                    Ok(Some(record)) => {
                        out.push(classify(record));
                        channel.count += 1;
                    }
                    Ok(None) => break,
                    Err(error) => {
                        channel.error =
                            Some(std::io::Error::from_raw_os_error(error as i32).to_string());
                        break;
                    }
                }
            }
        }
        Err(error) => {
            channel.error = Some(std::io::Error::from_raw_os_error(error as i32).to_string())
        }
    }
    (channel, out)
}

pub fn scan(options: Options) -> Result<Report, String> {
    if !(1..=720).contains(&options.hours) {
        return Err("Choose an event window from 1 to 720 hours.".into());
    }
    let filter = format!(
        "*[System[TimeCreated[timediff(@SystemTime) <= {}] and (Level=1 or Level=2{})]]",
        u64::from(options.hours) * 3_600_000,
        if options.warnings { " or Level=3" } else { "" }
    );

    // Parallelize all 10 Event Log channels + reliability WMI + dump parsing + WER + last_crash!
    let (channels, mut events, reliability_idx, dumps, wer_recent, last_crash) =
        std::thread::scope(|s| {
            let chan_handles: Vec<_> = CHANNELS
                .iter()
                .map(|&(name, limit)| {
                    let f = &filter;
                    s.spawn(move || scan_channel(name, limit, f))
                })
                .collect();
            let rel_h = s.spawn(reliability_index);
            let dump_h = s.spawn(dump_inventory);
            let wer_h = s.spawn(recent_wer);
            let crash_h = s.spawn(|| event_log::latest_crash().ok().flatten());

            let mut channels = Vec::with_capacity(CHANNELS.len());
            let mut events = Vec::new();
            for h in chan_handles {
                if let Ok((ch, evs)) = h.join() {
                    channels.push(ch);
                    events.extend(evs);
                }
            }
            (
                channels,
                events,
                rel_h.join().ok().flatten(),
                dump_h.join().unwrap_or_default(),
                wer_h.join().ok().flatten(),
                crash_h.join().ok().flatten(),
            )
        });

    events.sort_unstable_by(|a, b| {
        b.record
            .key
            .time_ms
            .cmp(&a.record.key.time_ms)
            .then_with(|| a.record.key.channel.cmp(&b.record.key.channel))
            .then_with(|| b.record.key.record.cmp(&a.record.key.record))
    });

    let mut counts = Counts {
        total: events.len(),
        ..Counts::default()
    };
    let mut groups = HashMap::<(&str, u16), (&Event, usize)>::new();
    let mut sub_stats: HashMap<&'static str, (u32, u32, u32)> = HashMap::new();
    for event in &events {
        if event.benign {
            counts.benign += 1;
            continue;
        }
        let entry = sub_stats.entry(event.subsystem).or_insert((0, 0, 0));
        match event.record.level {
            1 => {
                counts.critical += 1;
                entry.0 += 1;
            }
            2 => {
                counts.errors += 1;
                entry.1 += 1;
            }
            3 => {
                counts.warnings += 1;
                entry.2 += 1;
            }
            _ => (),
        }
        groups
            .entry((&event.record.provider, event.record.event_id))
            .or_insert((event, 0))
            .1 += 1;
    }

    let subsystems: Vec<SubsystemHealth> = SUBSYSTEM_DEFS
        .iter()
        .map(|&(name, icon)| {
            let (critical, errors, warnings) = sub_stats.get(name).copied().unwrap_or((0, 0, 0));
            let status = if critical > 0 || errors >= 10 {
                "Critical"
            } else if errors >= 3 {
                "Degraded"
            } else if errors > 0 || warnings >= 5 {
                "Advisory"
            } else {
                "Healthy"
            };
            SubsystemHealth {
                name,
                icon,
                status,
                critical,
                errors,
                warnings,
                total: critical + errors + warnings,
            }
        })
        .collect();

    let findings = synthesize_findings(&events, &dumps);

    let mut recurring: Vec<_> = groups
        .into_values()
        .filter(|&(_, count)| count > 1)
        .map(|(event, count)| Signature {
            provider: event.record.provider.clone(),
            event_id: event.record.event_id,
            category: event.subsystem,
            summary: event.summary,
            count,
        })
        .collect();
    recurring.sort_unstable_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.provider.cmp(&b.provider))
            .then_with(|| a.event_id.cmp(&b.event_id))
    });
    recurring.truncate(8);

    let penalty = (u32::from(
        events
            .iter()
            .any(|event| !event.benign && event.subsystem == "Hardware / WHEA"),
    ) * 12)
        + (u32::from(
            events
                .iter()
                .any(|event| !event.benign && event.subsystem == "Storage & Disk"),
        ) * 12)
        + reliability_idx
            .filter(|&index| index < 7.0)
            .map_or(0, |index| ((7.0 - index) * 4.0).round() as u32);
    let (score, grade) = grade(
        &counts,
        penalty,
        channels
            .iter()
            .any(|channel| channel.error.is_none() || channel.count > 0),
    );
    Ok(Report {
        hours: options.hours,
        time_ms: epoch_ms(SystemTime::now()).unwrap_or_default(),
        score,
        grade,
        counts,
        channels,
        subsystems,
        findings,
        events,
        last_crash,
        recurring,
        dumps,
        reliability_index: reliability_idx,
        wer_recent,
    })
}

fn synthesize_findings(events: &[Event], dumps: &[Dump]) -> Vec<Finding> {
    let mut findings = Vec::new();
    let kp41 = events
        .iter()
        .filter(|e| {
            e.record.event_id == 41
                && e.record
                    .provider
                    .eq_ignore_ascii_case("Microsoft-Windows-Kernel-Power")
        })
        .count();
    if kp41 > 0 {
        findings.push(Finding {
            id: "kp41",
            severity: "critical",
            subsystem: "Kernel & Power",
            title: format!("{kp41} Unexpected Shutdown / Kernel-Power 41 Event(s)"),
            detail: "System lost power or rebooted abruptly without a clean Windows shutdown."
                .into(),
            recommended_fix: "Verify PSU stability, check CPU/GPU temps, back off unstable RAM XMP/EXPO or CPU undervolts, and inspect nearby WHEA/BugCheck events.",
            count: kp41,
        });
    }
    let whea = events
        .iter()
        .filter(|e| !e.benign && e.subsystem == "Hardware / WHEA")
        .count();
    if whea > 0 {
        findings.push(Finding {
            id: "whea",
            severity: "critical",
            subsystem: "Hardware / WHEA",
            title: format!("{whea} Hardware / WHEA Fault(s) Detected"),
            detail: "CPU, cache hierarchy, memory controller, or PCIe bus reported corrected or uncorrectable hardware errors."
                .into(),
            recommended_fix: "Check BIOS AGESA/microcode updates, ease PBO/Curve Optimizer or XMP timings, and reseat GPU/NVMe cards.",
            count: whea,
        });
    }
    let disk = events
        .iter()
        .filter(|e| !e.benign && e.subsystem == "Storage & Disk")
        .count();
    if disk > 0 {
        findings.push(Finding {
            id: "disk",
            severity: "critical",
            subsystem: "Storage & Disk",
            title: format!("{disk} Storage / Disk / NTFS Warning(s) or Error(s)"),
            detail: "Windows logged disk I/O timeouts, controller resets, or filesystem metadata issues."
                .into(),
            recommended_fix: "Back up critical data, verify drive SMART wear/temp on Dashboard, update NVMe firmware, and run chkdsk /scan.",
            count: disk,
        });
    }
    let gpu_tdr = events
        .iter()
        .filter(|e| !e.benign && e.subsystem == "Graphics / GPU")
        .count();
    if gpu_tdr > 0 {
        findings.push(Finding {
            id: "gpu_tdr",
            severity: "warn",
            subsystem: "Graphics / GPU",
            title: format!("{gpu_tdr} Graphics Driver Reset / GPU Event(s)"),
            detail: "Windows TDR reset an unresponsive display driver or DWM reported a GPU error."
                .into(),
            recommended_fix: "Clean-install latest GPU driver, revert GPU OC/undervolt, and check PCIe power connectors & GPU thermals.",
            count: gpu_tdr,
        });
    }
    let app_crashes = events
        .iter()
        .filter(|e| !e.benign && e.subsystem == "Applications & Crashes" && e.record.level <= 2)
        .count();
    if app_crashes >= 2 {
        findings.push(Finding {
            id: "app_crashes",
            severity: "warn",
            subsystem: "Applications & Crashes",
            title: format!("{app_crashes} Application Crash / Hang Event(s)"),
            detail: "Multiple user-mode application crashes or unhandled runtime exceptions occurred in this window."
                .into(),
            recommended_fix: "Inspect the recurring faulting module in Recurring Events and update or repair the affected app/runtime.",
            count: app_crashes,
        });
    }
    let svc_fails = events
        .iter()
        .filter(|e| {
            !e.benign
                && e.record
                    .provider
                    .eq_ignore_ascii_case("Service Control Manager")
                && e.record.level <= 2
        })
        .count();
    if svc_fails > 0 {
        findings.push(Finding {
            id: "svc_fails",
            severity: "warn",
            subsystem: "Windows Update & Services",
            title: format!("{svc_fails} Windows Service Failure(s)"),
            detail: "One or more Windows services failed to start, timed out, or terminated unexpectedly."
                .into(),
            recommended_fix: "Check Tasks & Ports → Stopped Auto services and run Security & Repair → DISM / SFC if core OS services fail.",
            count: svc_fails,
        });
    }
    let net_drops = events
        .iter()
        .filter(|e| !e.benign && e.subsystem == "Network & DNS")
        .count();
    if net_drops >= 3 {
        findings.push(Finding {
            id: "net_drops",
            severity: "warn",
            subsystem: "Network & DNS",
            title: format!("{net_drops} Network / DNS / Wi-Fi Event(s)"),
            detail: "Repeated DNS resolution timeouts, DHCP lease warnings, or Wi-Fi disconnects were logged."
                .into(),
            recommended_fix: "Flush DNS cache, switch to Cloudflare (1.1.1.1) or Google (8.8.8.8) DNS, and check NIC drivers.",
            count: net_drops,
        });
    }
    let kernel_dumps: Vec<&Dump> = dumps
        .iter()
        .filter(|d| d.kind.starts_with("Kernel"))
        .collect();
    if !kernel_dumps.is_empty() {
        let latest_stop = kernel_dumps
            .first()
            .and_then(|d| d.stop_code.as_deref())
            .unwrap_or("See dump inventory");
        findings.push(Finding {
            id: "kernel_dumps",
            severity: "critical",
            subsystem: "Kernel & Power",
            title: format!("{} Kernel BSOD Crash Dump(s) Present", kernel_dumps.len()),
            detail: format!("Latest dump stop code: {latest_stop}"),
            recommended_fix: "Click Locate on the dump below or translate its hex stop code in the Windows Code Translator.",
            count: kernel_dumps.len(),
        });
    }
    findings
}

fn grade(counts: &Counts, penalty: u32, available: bool) -> (Option<u32>, &'static str) {
    if !available {
        return (None, "Unavailable");
    }
    let deduction = (counts.critical * 15).min(45)
        + (counts.errors * 2).min(30)
        + (counts.warnings / 4).min(12)
        + penalty;
    let score = 100u32.saturating_sub(deduction).max(5);
    let label = if score >= 85 && counts.critical == 0 {
        "Healthy"
    } else if score >= 65 {
        "Advisory"
    } else if score >= 40 {
        "Degraded"
    } else {
        "Critical"
    };
    (Some(score), label)
}

fn reliability_index() -> Option<f64> {
    let wmi = wmi::WMIConnection::new().ok()?;
    let rows = crate::details::rows(
        Some(&wmi),
        "SELECT TimeGenerated,SystemStabilityIndex FROM Win32_ReliabilityStabilityMetrics",
    );
    let row = rows
        .iter()
        .max_by_key(|row| crate::details::text(row, "TimeGenerated"))?;
    let value = match row.get("SystemStabilityIndex")? {
        wmi::Variant::R4(value) => f64::from(*value),
        wmi::Variant::R8(value) => *value,
        _ => return None,
    };
    (0.0..=10.0).contains(&value).then_some(value)
}

/// Pure-Rust BSOD Minidump & Kernel Dump header parser (reads first 4 KB only).
fn parse_dump_stop_code(path: &Path) -> (Option<String>, Option<String>) {
    let Ok(mut file) = fs::File::open(path) else {
        return (None, None);
    };
    let mut buf = [0u8; 4096];
    let Ok(n) = file.read(&mut buf) else {
        return (None, None);
    };
    if n < 64 {
        return (None, None);
    }
    let le32 = |off: usize| -> u32 {
        u32::from_le_bytes([buf[off], buf[off + 1], buf[off + 2], buf[off + 3]])
    };
    // Full / Kernel / Small Memory Dump x64 ("PAGEDU64")
    if &buf[0..8] == b"PAGEDU64" && n >= 0x40 {
        let code = le32(0x38);
        if code != 0 {
            let hex = format!("0x{code:08X}");
            let label = curated_code_info(code)
                .map(|(name, _, _)| format!("{hex} · {name}"))
                .unwrap_or_else(|| hex.clone());
            return (Some(label), Some(hex));
        }
    }
    // 32-bit Kernel Dump ("PAGEDUMP")
    if &buf[0..8] == b"PAGEDUMP" && n >= 0x24 {
        let code = le32(0x20);
        if code != 0 {
            let hex = format!("0x{code:08X}");
            let label = curated_code_info(code)
                .map(|(name, _, _)| format!("{hex} · {name}"))
                .unwrap_or_else(|| hex.clone());
            return (Some(label), Some(hex));
        }
    }
    // Minidump ("MDMP"): scan MINIDUMP_DIRECTORY for ExceptionStream (type 6)
    if &buf[0..4] == b"MDMP" && n >= 32 {
        let stream_count = le32(8) as usize;
        let dir_rva = le32(12) as usize;
        for i in 0..stream_count.min(32) {
            let entry = dir_rva + i * 12;
            if entry + 12 > n {
                break;
            }
            let stream_type = le32(entry);
            let data_rva = le32(entry + 8) as usize;
            if stream_type == 6 && data_rva + 16 <= n {
                // MINIDUMP_EXCEPTION_STREAM: ThreadId(4) + __alignment(4) + ExceptionRecord.ExceptionCode(4)
                let exc_code = le32(data_rva + 8);
                if exc_code != 0 {
                    let hex = format!("0x{exc_code:08X}");
                    let label = curated_code_info(exc_code)
                        .map(|(name, _, _)| format!("{hex} · {name}"))
                        .unwrap_or_else(|| hex.clone());
                    return (Some(label), Some(hex));
                }
            }
        }
    }
    (None, None)
}

fn dump_inventory() -> Vec<Dump> {
    fn item(path: &Path, kind: &'static str) -> Option<Dump> {
        let data = fs::symlink_metadata(path).ok()?;
        if !data.is_file() || !path.extension()?.eq_ignore_ascii_case("dmp") {
            return None;
        }
        let (stop_code, stop_hex) = parse_dump_stop_code(path);
        Some(Dump {
            name: path.file_name()?.to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            kind,
            size: data.len(),
            time_ms: data.modified().ok().and_then(epoch_ms),
            stop_code,
            stop_hex,
        })
    }
    let mut dumps = Vec::new();
    for (base, dir, kind) in [
        ("SystemRoot", "Minidump", "Kernel minidump"),
        ("LOCALAPPDATA", "CrashDumps", "Application dump"),
    ] {
        let Some(base) = std::env::var_os(base).map(PathBuf::from) else {
            continue;
        };
        if let Ok(entries) = fs::read_dir(base.join(dir)) {
            let mut found: Vec<_> = entries
                .flatten()
                .filter_map(|entry| item(&entry.path(), kind))
                .collect();
            found.sort_unstable_by_key(|dump| std::cmp::Reverse(dump.time_ms));
            dumps.extend(found.into_iter().take(12));
        }
    }
    if let Some(full) = std::env::var_os("SystemRoot").and_then(|root| {
        item(
            &PathBuf::from(root).join("MEMORY.DMP"),
            "Kernel memory dump",
        )
    }) {
        dumps.push(full);
    }
    dumps.sort_unstable_by_key(|dump| std::cmp::Reverse(dump.time_ms));
    dumps
}

pub fn open_dump(path: &Path) -> Result<(), String> {
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("dmp"))
    {
        return Err("Only .dmp crash dump files can be located from UltimaDiagX.".into());
    }
    if !path.is_file() {
        return Err("Crash dump file no longer exists on disk.".into());
    }
    crate::dashboard_actions::reveal_in_explorer(path)
}

pub fn launch_tool(kind: &str) -> Result<(), String> {
    match kind {
        "eventvwr" => crate::dashboard_actions::shell_open("eventvwr.msc", None, false),
        "reliability" => crate::dashboard_actions::shell_open("perfmon.exe", Some("/rel"), false),
        _ => Err("Unknown diagnostic tool.".into()),
    }
}

fn recent_wer() -> Option<usize> {
    let root = PathBuf::from(std::env::var_os("ProgramData")?)
        .join(r"Microsoft\Windows\WER\ReportArchive");
    let week = SystemTime::now() - Duration::from_secs(7 * 86400);
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(0),
        Err(_) => return None,
    };
    Some(
        entries
            .flatten()
            .filter(|entry| {
                entry.file_type().is_ok_and(|kind| kind.is_dir())
                    && entry
                        .metadata()
                        .and_then(|meta| meta.modified())
                        .is_ok_and(|time| time >= week)
            })
            .count(),
    )
}

#[derive(Serialize)]
pub struct Code {
    hex: String,
    decimal: u32,
    family: &'static str,
    message: Option<String>,
    fix: Option<&'static str>,
}

fn curated_code_info(value: u32) -> Option<(&'static str, &'static str, &'static str)> {
    // Returns (short_symbol, explanation, recommended_fix)
    let entry = match value {
        // Common BSOD BugCheck Stop Codes
        0x0000_000A => ("IRQL_NOT_LESS_OR_EQUAL", "A kernel driver accessed invalid paged memory at an elevated IRQL.", "Update recently installed drivers, test RAM stability, and run verifier if persistent."),
        0x0000_001A => ("MEMORY_MANAGEMENT", "Severe memory management error in RAM or pagefile.", "Run Windows Memory Diagnostic / MemTest86, reseat DIMMs, and test without XMP/EXPO."),
        0x0000_001E => ("KMODE_EXCEPTION_NOT_HANDLED", "A kernel-mode program generated an unhandled exception.", "Update GPU, network, and chipset drivers; inspect faulting .sys driver in dump."),
        0x0000_0024 => ("NTFS_FILE_SYSTEM", "NTFS filesystem driver encountered a fatal error.", "Run chkdsk /f on affected volumes and check drive SMART status."),
        0x0000_003B => ("SYSTEM_SERVICE_EXCEPTION", "An exception occurred transitioning from non-privileged to privileged kernel code.", "Update graphics/capture drivers and anti-cheat software; check DISM & SFC."),
        0x0000_0050 => ("PAGE_FAULT_IN_NONPAGED_AREA", "Invalid system memory reference by a driver or faulty RAM.", "Test RAM modules, update antivirus/storage drivers, and run chkdsk /scan."),
        0x0000_007A => ("KERNEL_DATA_INPAGE_ERROR", "Requested page of kernel data from pagefile could not be read from disk.", "Check SSD/HDD cable, SMART health, and storage controller drivers immediately."),
        0x0000_007E => ("SYSTEM_THREAD_EXCEPTION_NOT_HANDLED", "A system thread generated an unhandled exception.", "Check BIOS & graphics/chipset drivers; ensure free disk space on C:."),
        0x0000_009F => ("DRIVER_POWER_STATE_FAILURE", "A driver failed to complete a sleep/resume power IRP in time.", "Update chipset, USB, GPU, and Wi-Fi drivers; check powercfg /energy."),
        0x0000_00BE => ("ATTEMPTED_WRITE_TO_READONLY_MEMORY", "A driver attempted to write to read-only memory.", "Update recently installed kernel drivers (GPU, audio, RGB, or anti-cheat)."),
        0x0000_00C2 => ("BAD_POOL_CALLER", "A kernel driver made an invalid memory pool request.", "Update third-party kernel drivers and security software."),
        0x0000_00D1 => ("DRIVER_IRQL_NOT_LESS_OR_EQUAL", "A kernel driver touched pageable memory at too high an IRQL.", "Identify the named .sys driver (often NIC, Wi-Fi, or GPU) and update or roll it back."),
        0x0000_00EF => ("CRITICAL_PROCESS_DIED", "A critical Windows system process terminated unexpectedly.", "Run SFC /scannow and DISM /Online /Cleanup-Image /RestoreHealth; check SSD health."),
        0x0000_00F4 => ("CRITICAL_OBJECT_TERMINATION", "A critical system process or thread exited.", "Verify system SSD/NVMe health and run SFC / DISM."),
        0x0000_0101 => ("CLOCK_WATCHDOG_TIMEOUT", "A secondary CPU core failed to respond to clock interrupts (CPU lockup).", "Increase CPU Vcore or reduce CPU overclock / Curve Optimizer; update motherboard BIOS."),
        0x0000_0109 => ("CRITICAL_STRUCTURE_CORRUPTION", "Kernel Patch Protection detected corrupted kernel code or data.", "Test RAM for errors and remove outdated unsigned kernel drivers."),
        0x0000_0116 => ("VIDEO_TDR_FAILURE", "GPU driver failed to recover within the timeout period.", "Clean-install GPU drivers with DDU, check GPU temps/power cables, and reset GPU OC."),
        0x0000_0119 => ("VIDEO_SCHEDULER_INTERNAL_ERROR", "The GPU video scheduler detected a fatal violation.", "Update GPU drivers and Windows DirectX / OS updates."),
        0x0000_0124 => ("WHEA_UNCORRECTABLE_ERROR", "Fatal hardware error reported by CPU, cache, memory, or PCIe bus.", "Reset CPU/RAM overclocks, update BIOS microcode, check CPU cooling, and reseat GPU/NVMe."),
        0x0000_0133 => ("DPC_WATCHDOG_VIOLATION", "A driver spent too long inside a Deferred Procedure Call (DPC).", "Update SSD/NVMe firmware, Wi-Fi/NIC drivers, and GPU drivers."),
        0x0000_0139 => ("KERNEL_SECURITY_CHECK_FAILURE", "Kernel detected corruption of a critical data structure (GS cookie/list).", "Update anti-cheat/VPN/RGB kernel drivers and run memory diagnostics."),
        0x0000_013A => ("KERNEL_MODE_HEAP_CORRUPTION", "Kernel-mode heap manager detected memory corruption.", "Update third-party drivers and test RAM stability."),
        0x0000_0154 => ("UNEXPECTED_STORE_EXCEPTION", "Windows compressed memory store caught an unexpected I/O exception.", "Check SSD health/firmware and run chkdsk & SFC /scannow."),
        0x0000_0192 => ("KERNEL_AUTO_BOOST_LOCK_ACQUISITION_WITH_RAISED_IRQL", "A driver acquired a mutex/lock at raised IRQL.", "Update recently added hardware/security kernel drivers."),
        // Common NTSTATUS / App Crash Codes
        0xC000_0005 => ("STATUS_ACCESS_VIOLATION", "Process attempted to read or write protected/unmapped memory.", "Update the faulting app/GPU driver, verify game/app files, or check RAM stability."),
        0xC000_001D => ("STATUS_ILLEGAL_INSTRUCTION", "CPU encountered an unsupported or corrupted instruction (e.g. AVX2).", "Verify CPU instruction requirements or repair corrupted application binaries."),
        0xC000_007B => ("STATUS_INVALID_IMAGE_FORMAT", "32-bit/64-bit DLL mismatch or corrupted Visual C++ / DirectX DLL.", "Reinstall Microsoft Visual C++ Redistributables (x64 & x86) from App Installer."),
        0xC000_00FD => ("STATUS_STACK_OVERFLOW", "A thread exhausted its call stack (infinite recursion or deep call chain).", "Update the crashing application or disable buggy third-party plugins/overlays."),
        0xC000_0135 => ("STATUS_DLL_NOT_FOUND", "A required DLL dependency could not be located on PATH.", "Reinstall the application or missing VC++ / .NET runtime."),
        0xC000_0142 => ("STATUS_DLL_INIT_FAILED", "A DLL failed during initialization (DllMain returned FALSE).", "Repair VC++ runtimes, check antivirus quarantine, and run SFC /scannow."),
        0xC000_0409 => ("STATUS_STACK_BUFFER_OVERRUN", "Fail-fast security check detected stack corruption or assertion failure.", "Update the application, GPU drivers, and check system integrity with SFC."),
        0xC000_0602 => ("STATUS_FAIL_FAST_EXCEPTION", "Application intentionally aborted via fail-fast due to corrupted state.", "Update the affected Windows Store / WinUI app or repair Windows packages."),
        0xE043_4352 => ("CLR_MANAGED_EXCEPTION", "Unhandled .NET CLR managed exception.", "Inspect the accompanying .NET Runtime Event 1026 for the exact exception & stack trace."),
        0x8000_0003 => ("STATUS_BREAKPOINT", "Software breakpoint hit outside a debugger (often Chromium/Electron OOM or fatal assert).", "Check available RAM/VRAM and update the Electron/browser app."),
        // Common Windows Update / Win32 HRESULTs
        0x8007_0002 => ("ERROR_FILE_NOT_FOUND", "The system cannot find the file specified (common in Windows Update or service paths).", "Check the target file path or reset Windows Update SoftwareDistribution cache."),
        0x8007_0005 => ("E_ACCESSDENIED", "Access is denied — insufficient permissions or blocked by security policy.", "Run as Administrator, verify folder ACLs, or check Controlled Folder Access."),
        0x8007_000E => ("E_OUTOFMEMORY", "Not enough memory / virtual address space available.", "Close high-RAM apps in Tasks & Ports and verify pagefile size."),
        0x8007_0422 => ("ERROR_SERVICE_DISABLED", "The service cannot be started because it is disabled.", "Enable the required Windows service in Tasks & Ports → Windows Services."),
        0x800F_081F => ("CBS_E_SOURCE_MISSING", "Component Based Servicing source files could not be found (DISM/WU).", "Run DISM /Online /Cleanup-Image /RestoreHealth with internet access or a matching Windows ISO."),
        0x800F_0922 => ("CBS_E_INSTALLERS_FAILED", "Windows Update failed (often low EFI System Partition space or VPN blocking).", "Verify EFI partition free space in Disk Partitioner and disconnect VPN during update."),
        0x8024_002E => ("WU_E_WU_DISABLED", "Windows Update is disabled by Group Policy or WSUS configuration.", "Check Group Policy / registry WindowsUpdate keys."),
        0x8024_402F => ("WU_E_PT_ECP_SUCCEEDED_WITH_ERRORS", "Windows Update encountered a transient network connection interruption.", "Check DNS/firewall/proxy settings and retry Windows Update."),
        _ => return None,
    };
    Some(entry)
}

fn format_ntdll(code: u32) -> Option<String> {
    let module_name = crate::native::wide("ntdll.dll");
    let module = unsafe { GetModuleHandleW(module_name.as_ptr()) };
    if module.is_null() {
        return None;
    }
    let mut buffer = [0u16; 1024];
    let length = unsafe {
        FormatMessageW(
            FORMAT_MESSAGE_FROM_HMODULE | FORMAT_MESSAGE_IGNORE_INSERTS,
            module.cast(),
            code,
            0,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            ptr::null(),
        )
    };
    (length > 0).then(|| {
        String::from_utf16_lossy(&buffer[..length as usize])
            .trim()
            .to_owned()
    })
}

pub fn translate(input: &str) -> Result<Code, String> {
    let input = input.trim();
    let parse = if let Some(digits) = input
        .strip_prefix("0x")
        .or_else(|| input.strip_prefix("0X"))
    {
        u32::from_str_radix(digits, 16).ok()
    } else if input.len() == 8
        && input
            .bytes()
            .any(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_digit())
    {
        u32::from_str_radix(input, 16).ok()
    } else {
        input
            .parse::<u32>()
            .ok()
            .or_else(|| input.parse::<i32>().ok().map(|value| value as u32))
    };
    let value =
        parse.ok_or("Enter a decimal Windows error code or hexadecimal code beginning with 0x.")?;
    let curated = curated_code_info(value);
    let (family, lookup) = if value & 0xffff_0000 == 0x8007_0000 {
        ("Win32 HRESULT", value & 0xffff)
    } else if value & 0xf000_0000 == 0xc000_0000 {
        ("NTSTATUS", value)
    } else if value & 0xffff_0000 == 0x8024_0000 || value & 0xffff_0000 == 0x800f_0000 {
        ("Windows Update / CBS", value)
    } else if value <= 0x200 && curated.is_some() {
        ("BSOD BugCheck", value)
    } else if value <= u16::MAX.into() {
        ("Win32", value)
    } else {
        ("Windows status", value)
    };
    let mut buffer = [0u16; 2048];
    let length = unsafe {
        FormatMessageW(
            FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
            ptr::null(),
            lookup,
            0,
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            ptr::null(),
        )
    };
    let sys_msg = (length > 0).then(|| {
        String::from_utf16_lossy(&buffer[..length as usize])
            .trim()
            .to_owned()
    });
    let message = if let Some((sym, desc, _)) = curated {
        Some(match sys_msg {
            Some(os) if !os.eq_ignore_ascii_case(desc) => format!("{sym} — {desc} (OS: {os})"),
            _ => format!("{sym} — {desc}"),
        })
    } else {
        sys_msg.or_else(|| format_ntdll(value))
    };
    Ok(Code {
        hex: format!("0x{value:08X}"),
        decimal: value,
        family,
        message,
        fix: curated.map(|(_, _, f)| f),
    })
}

pub fn markdown(report: &Report, dismissed: &[Key]) -> String {
    use std::fmt::Write;
    let mut out = format!(
        "# CoreWatch Rust · UltimaDiagX\n\n{} · Last {} hours\n\n",
        event_log::utc(report.time_ms),
        report.hours
    );
    let _ = writeln!(
        out,
        "Health score | {} | {}\n",
        report
            .score
            .map_or_else(|| "—".into(), |score| score.to_string()),
        report.grade
    );
    let _ = writeln!(
        out,
        "{} events · {} critical · {} errors · {} warnings · {} benign\n",
        report.counts.total,
        report.counts.critical,
        report.counts.errors,
        report.counts.warnings,
        report.counts.benign
    );
    if !report.findings.is_empty() {
        out.push_str("## Root-Cause Findings\n\n");
        for f in &report.findings {
            let _ = writeln!(
                out,
                "- **[{}] {}** ({}): {} — *Fix:* {}",
                f.severity.to_uppercase(),
                cell(&f.title),
                f.subsystem,
                cell(&f.detail),
                cell(f.recommended_fix)
            );
        }
        out.push('\n');
    }
    out.push_str("## Subsystem Health Matrix\n\n| Subsystem | Status | Critical | Errors | Warnings |\n| --- | --- | ---: | ---: | ---: |\n");
    for s in &report.subsystems {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} |",
            s.name, s.status, s.critical, s.errors, s.warnings
        );
    }
    out.push_str("\n## Windows channels\n\n| Channel | Records | Coverage |\n| --- | ---: | --- |\n");
    for channel in &report.channels {
        let coverage = channel.error.as_deref().unwrap_or(if channel.limited {
            "Record limit reached"
        } else {
            "Complete for selected window"
        });
        let _ = writeln!(
            out,
            "| {} | {} | {} |",
            cell(channel.name),
            channel.count,
            cell(coverage)
        );
    }
    if let Some(crash) = &report.last_crash {
        let _ = writeln!(
            out,
            "\n## Last system crash\n\n{} · {} · {}\n\n{}",
            crash.utc(),
            crash.event_id,
            cell(&crash.provider),
            cell(
                crash
                    .message
                    .as_deref()
                    .unwrap_or("Event message unavailable")
            )
        );
    }
    if !report.recurring.is_empty() {
        out.push_str("\n## Recurring events\n\n| Provider | Event | Subsystem | Occurrences |\n| --- | ---: | --- | ---: |\n");
        for event in &report.recurring {
            let _ = writeln!(
                out,
                "| {} | {} | {} | {} |",
                cell(&event.provider),
                event.event_id,
                cell(event.category),
                event.count
            );
        }
    }
    if !report.dumps.is_empty() {
        out.push_str("\n## Crash dump inventory\n\n| Path | Kind | Stop Code | Modified | Size (bytes) |\n| --- | --- | --- | --- | ---: |\n");
        for dump in &report.dumps {
            let stamp = dump.time_ms.map_or_else(|| "—".into(), event_log::utc);
            let _ = writeln!(
                out,
                "| {} | {} | {} | {} | {} |",
                cell(&dump.path),
                dump.kind,
                cell(dump.stop_code.as_deref().unwrap_or("—")),
                stamp,
                dump.size
            );
        }
    }
    out.push_str("\n## Event timeline\n\n| Time | Channel | Provider | Event | Level | State | Message |\n| --- | --- | --- | ---: | --- | --- | --- |\n");
    for event in &report.events {
        let record = &event.record;
        let state = if dismissed.contains(&record.key) {
            "Solved"
        } else if event.benign {
            "Benign"
        } else {
            "Open"
        };
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} |",
            record.utc(),
            cell(&record.key.channel),
            cell(&record.provider),
            record.event_id,
            match record.level {
                1 => "Critical",
                2 => "Error",
                3 => "Warning",
                _ => "Information",
            },
            state,
            cell(record.message.as_deref().unwrap_or(event.summary))
        );
    }
    out
}

fn cell(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('|', "&#124;")
        .replace('[', "&#91;")
        .replace(']', "&#93;")
        .replace('`', "&#96;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_collisions_do_not_mark_application_events_as_bugchecks() {
        let event = |channel: &str, provider: &str| Record {
            key: Key {
                channel: channel.into(),
                record: 1,
                time_ms: 1,
            },
            provider: provider.into(),
            event_id: 1001,
            level: 2,
            message: None,
        };
        assert!(
            event("Application", "Windows Error Reporting")
                .crash_tag()
                .is_none()
        );
        assert_eq!(
            event("System", "Microsoft-Windows-WER-SystemErrorReporting").crash_tag(),
            Some("BSOD 1001")
        );
        assert_eq!(translate("0x80070005").unwrap().family, "Win32 HRESULT");
        assert!(
            translate("0x00000124")
                .unwrap()
                .message
                .unwrap()
                .contains("WHEA_UNCORRECTABLE_ERROR")
        );
        assert_eq!(
            extract_hex_codes(Some("Failed with 0x80070005 and 0xc0000005 (0x0)")),
            vec!["0x80070005".to_owned(), "0xC0000005".to_owned()]
        );
        assert_eq!(
            cell("<tag> | [action]"),
            "&lt;tag&gt; &#124; &#91;action&#93;"
        );
    }
}
