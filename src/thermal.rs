use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader, Write},
    os::windows::{io::AsRawHandle, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

const CONFIG_FILE: &str = "thermal-config.json";
const BASELINE_FILE: &str = "thermal-baselines.json";
const PUMP_MIN_SAFETY_PCT: u8 = 35;
const HISTORY_CAP: usize = 45;

// =========================================================================
// PUBLIC API TYPES (JSON-serialized to Thermal & Cooling Lab UI)
// =========================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CurvePoint {
    pub temp_c: f64,
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FanCurve {
    pub sensor_id: String,
    pub hysteresis_c: f64,
    pub points: Vec<CurvePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ControlMode {
    #[default]
    Auto,
    Manual {
        percent: u8,
    },
    Curve(FanCurve),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ChannelAlias {
    pub label: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ThermalConfig {
    pub active_preset: String,
    pub channels: HashMap<String, ControlMode>,
    pub aliases: HashMap<String, ChannelAlias>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ChannelBaseline {
    /// PWM 10%-bucket (0..=10) -> (EMA RPM, sample count)
    buckets: HashMap<u8, (f64, u32)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthFinding {
    pub severity: &'static str, // "crit" | "warn" | "info"
    pub code: &'static str,
    pub channel: String,
    pub title: String,
    pub detail: String,
    pub advice: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TempSensor {
    pub id: String,
    pub name: String,
    pub hardware: String,
    pub category: String, // cpu | gpu | motherboard | cooler | storage | memory | acpi
    pub value_c: f64,
    pub min_c: f64,
    pub max_c: f64,
    pub warn_c: f64,
    pub crit_c: f64,
    pub status: &'static str, // "cool" | "warm" | "hot"
    pub history: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanChannel {
    pub id: String,
    pub name: String,
    pub raw_name: String,
    pub hardware: String,
    pub category: String,
    pub role: &'static str, // "pump" | "cpu" | "gpu" | "chassis" | "vrm" | "cooler"
    pub custom_role: Option<String>,
    pub rpm: Option<u32>,
    pub rpm_min: Option<u32>,
    pub rpm_max: Option<u32>,
    pub rpm_history: Vec<u32>,
    pub control_id: Option<String>,
    pub pwm_pct: Option<f64>,
    pub controllable: bool,
    pub min_pct: u8,
    pub max_pct: u8,
    pub mode: ControlMode,
    pub health_score: u8,
    pub health_status: &'static str, // "Healthy" | "0-dB Idle" | "Monitoring" | "Degraded" | "Struggling" | "Critical"
    pub expected_rpm: Option<u32>,
    pub rpm_jitter_pct: f64,
    pub baseline_samples: u32,
    pub issues: Vec<HealthFinding>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSensor {
    pub id: String,
    pub name: String,
    pub hardware: String,
    pub category: String,
    pub watts: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowSensor {
    pub id: String,
    pub name: String,
    pub hardware: String,
    pub lph: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AioSummary {
    pub detected: bool,
    pub pump_count: usize,
    pub max_pump_rpm: Option<u32>,
    pub coolant_temp_c: Option<f64>,
    pub flow_lph: Option<f64>,
    pub cpu_coolant_delta_c: Option<f64>,
    pub status: &'static str,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSnapshot {
    pub elevated: bool,
    pub helper_available: bool,
    pub helper_active: bool,
    pub pawn_io: &'static str,
    pub active_preset: String,
    pub overall_health_score: u8,
    pub overall_status: &'static str,
    pub hottest_temp: Option<TempSensor>,
    pub temperatures: Vec<TempSensor>,
    pub fans: Vec<FanChannel>,
    pub flows: Vec<FlowSensor>,
    pub powers: Vec<PowerSensor>,
    pub aio_summary: AioSummary,
    pub findings: Vec<HealthFinding>,
    pub gpu_throttle_reason: Option<String>,
    pub health_check_running: bool,
    pub last_check_summary: Option<String>,
    pub providers: Vec<crate::thermal_providers::ProviderStatus>,
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ThermalAction {
    Refresh,
    SetActive { active: bool },
    SetManual { control_id: String, percent: u8 },
    SetAuto { control_id: String },
    SetCurve { control_id: String, curve: FanCurve },
    ConfigureChannel {
        channel_id: String,
        label: Option<String>,
        role: Option<String>,
    },
    ApplyPreset { preset: String },
    ResetAllAuto,
    RunHealthCheck,
    ResetBaselines,
}

// =========================================================================
// RAW HELPER JSON DESERIALIZATION
// =========================================================================

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawThermalFrame {
    #[serde(default)]
    temperatures: Vec<RawTemp>,
    #[serde(default)]
    fans: Vec<RawFan>,
    #[serde(default)]
    controls: Vec<RawControl>,
    #[serde(default)]
    flows: Vec<RawFlow>,
    #[serde(default)]
    powers: Vec<RawPower>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawTemp {
    id: String,
    name: String,
    hardware: String,
    category: String,
    value: f64,
    min: Option<f64>,
    max: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawFan {
    id: String,
    name: String,
    hardware: String,
    category: String,
    index: i32,
    rpm: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawControl {
    id: String,
    name: String,
    hardware: String,
    category: String,
    index: i32,
    percent: Option<f64>,
    controllable: bool,
    min_pct: f64,
    max_pct: f64,
}

#[derive(Debug, Deserialize)]
struct RawFlow {
    id: String,
    name: String,
    hardware: String,
    lph: f64,
}

#[derive(Debug, Deserialize)]
struct RawPower {
    id: String,
    name: String,
    hardware: String,
    category: String,
    watts: f64,
}

#[derive(Debug, Deserialize)]
struct RawAck {
    ok: bool,
    error: Option<String>,
}

// =========================================================================
// JOB OBJECT (Guarantees Helper Exits If App Exits)
// =========================================================================

#[repr(C)]
#[derive(Default)]
struct IoCounters {
    r1: u64,
    r2: u64,
    r3: u64,
    r4: u64,
    r5: u64,
    r6: u64,
}

#[repr(C)]
#[derive(Default)]
struct JobBasicLimit {
    u1: i64,
    u2: i64,
    limit_flags: u32,
    u3: usize,
    u4: usize,
    u5: u32,
    u6: usize,
    u7: u32,
    u8: u32,
}

#[repr(C)]
#[derive(Default)]
struct JobExtLimit {
    basic: JobBasicLimit,
    io: IoCounters,
    m1: usize,
    m2: usize,
    m3: usize,
    m4: usize,
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const core::ffi::c_void, name: *const u16) -> HANDLE;
    fn SetInformationJobObject(
        job: HANDLE,
        info_class: u32,
        info: *const core::ffi::c_void,
        info_len: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: HANDLE, process: HANDLE) -> i32;
}

struct ThermalJob(HANDLE);
unsafe impl Send for ThermalJob {}

impl ThermalJob {
    fn attach(child: &Child) -> Option<Self> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info = JobExtLimit::default();
            info.basic.limit_flags = 0x0000_2000; // KILL_ON_JOB_CLOSE
            if SetInformationJobObject(
                job,
                9,
                (&raw const info).cast(),
                std::mem::size_of::<JobExtLimit>() as u32,
            ) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0
            {
                CloseHandle(job);
                return None;
            }
            Some(Self(job))
        }
    }
}

impl Drop for ThermalJob {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

// =========================================================================
// PERSISTENT ON-DEMAND THERMAL HELPER SESSION
// =========================================================================

struct HelperSession {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<Result<String, String>>,
    _job: Option<ThermalJob>,
}

impl HelperSession {
    fn open(exe: &Path) -> Result<(Self, RawThermalFrame), String> {
        let mut child = Command::new(exe)
            .arg("--thermal")
            .current_dir(exe.parent().ok_or("Sensor directory missing.")?)
            .creation_flags(0x0800_0000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Could not start thermal sensor helper: {e}"))?;
        let job = ThermalJob::attach(&child);
        let stdin = child.stdin.take().ok_or("Missing helper stdin.")?;
        let mut stdout = BufReader::new(child.stdout.take().ok_or("Missing helper stdout.")?);
        let (tx, rx) = mpsc::sync_channel(2);
        thread::spawn(move || {
            loop {
                let mut line = String::new();
                match stdout.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) if tx.send(Ok(line)).is_ok() => continue,
                    Ok(_) => break,
                    Err(err) => {
                        let _ = tx.send(Err(err.to_string()));
                        break;
                    }
                }
            }
        });
        let session = Self {
            child,
            stdin,
            rx,
            _job: job,
        };
        let line = session.read_line(Duration::from_secs(12))?;
        let frame: RawThermalFrame =
            serde_json::from_str(&line).map_err(|e| format!("Invalid thermal payload: {e}"))?;
        if let Some(err) = frame.error {
            return Err(err);
        }
        Ok((session, frame))
    }

    fn read_line(&self, timeout: Duration) -> Result<String, String> {
        self.rx
            .recv_timeout(timeout)
            .map_err(|_| "Thermal sensor helper timed out.".to_owned())?
    }

    fn poll_frame(&mut self) -> Result<RawThermalFrame, String> {
        self.stdin
            .write_all(b"\n")
            .and_then(|()| self.stdin.flush())
            .map_err(|e| e.to_string())?;
        let line = self.read_line(Duration::from_secs(8))?;
        let frame: RawThermalFrame =
            serde_json::from_str(&line).map_err(|e| format!("Invalid thermal payload: {e}"))?;
        if let Some(err) = frame.error {
            return Err(err);
        }
        Ok(frame)
    }

    fn set_fan(&mut self, control_id: &str, percent: u8) -> Result<(), String> {
        let cmd = format!("SETFAN {control_id} {percent}\n");
        self.stdin
            .write_all(cmd.as_bytes())
            .and_then(|()| self.stdin.flush())
            .map_err(|e| e.to_string())?;
        let line = self.read_line(Duration::from_secs(5))?;
        let ack: RawAck = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if ack.ok {
            Ok(())
        } else {
            Err(ack
                .error
                .unwrap_or_else(|| "Hardware rejected fan control command.".into()))
        }
    }

    fn auto_fan(&mut self, control_id: &str) -> Result<(), String> {
        let cmd = format!("AUTOFAN {control_id}\n");
        self.stdin
            .write_all(cmd.as_bytes())
            .and_then(|()| self.stdin.flush())
            .map_err(|e| e.to_string())?;
        let line = self.read_line(Duration::from_secs(5))?;
        let ack: RawAck = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if ack.ok {
            Ok(())
        } else {
            Err(ack
                .error
                .unwrap_or_else(|| "Could not restore hardware Auto mode.".into()))
        }
    }

    fn reset_all(&mut self) {
        let _ = self.stdin.write_all(b"RESETFANS\n");
        let _ = self.stdin.flush();
        let _ = self.read_line(Duration::from_secs(2));
    }
}

impl Drop for HelperSession {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"RESETFANS\nEXIT\n");
        let _ = self.stdin.flush();
        for _ in 0..5 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(35));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// =========================================================================
// PURE HEALTH ANALYSIS, CLASSIFICATION & FAN CURVE LOGIC
// =========================================================================

pub fn parse_role_override(raw: &str) -> Option<&'static str> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "pump" => Some("pump"),
        "cpu" => Some("cpu"),
        "gpu" => Some("gpu"),
        "cooler" | "radiator" => Some("cooler"),
        "vrm" => Some("vrm"),
        "chassis" => Some("chassis"),
        _ => None,
    }
}

pub fn classify_fan_role(name: &str, hardware: &str, category: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    let h = hardware.to_ascii_lowercase();
    if n.contains("pump")
        || n.contains("aio")
        || n.contains("w_pump")
        || n.contains("water")
        || n.contains("liquid")
    {
        return "pump";
    }
    if category == "cooler" || h.contains("kraken") || h.contains("commander") || h.contains("h100")
        || h.contains("h150") || h.contains("icue") || h.contains("aquacomputer")
    {
        return if n.contains("fan") { "cooler" } else { "pump" };
    }
    if category == "gpu" || n.contains("gpu") {
        return "gpu";
    }
    if n.contains("cpu") || n.contains("opt") {
        return "cpu";
    }
    if n.contains("vrm") || n.contains("pch") || n.contains("chipset") || n.contains("mos") {
        return "vrm";
    }
    "chassis"
}

fn temp_thresholds(category: &str, name: &str) -> (f64, f64) {
    let n = name.to_ascii_lowercase();
    if category == "cooler" || n.contains("liquid") || n.contains("coolant") || n.contains("water") {
        (42.0, 50.0)
    } else if category == "storage" {
        (58.0, 70.0)
    } else if category == "memory" {
        (50.0, 62.0)
    } else if n.contains("hot spot") || n.contains("hotspot") || n.contains("junction") {
        (88.0, 100.0)
    } else if n.contains("vrm") || n.contains("mos") {
        (85.0, 100.0)
    } else if category == "gpu" {
        (74.0, 85.0)
    } else if category == "cpu" {
        (78.0, 90.0)
    } else {
        (70.0, 85.0)
    }
}

pub fn enforce_pump_floor(role: &str, pct: u8) -> u8 {
    let clamped = pct.min(100);
    if role == "pump" {
        clamped.max(PUMP_MIN_SAFETY_PCT)
    } else {
        clamped
    }
}

pub fn interpolate_curve(curve: &FanCurve, temp_c: f64, last_applied: Option<(f64, u8)>) -> u8 {
    if curve.points.is_empty() {
        return 50;
    }
    if let Some((prev_temp, prev_pct)) = last_applied {
        let hyst = curve.hysteresis_c.clamp(0.0, 10.0);
        if temp_c < prev_temp && (prev_temp - temp_c) < hyst {
            return prev_pct;
        }
    }
    let mut pts = curve.points.clone();
    pts.sort_by(|a, b| a.temp_c.total_cmp(&b.temp_c));
    if temp_c <= pts[0].temp_c {
        return pts[0].percent.min(100);
    }
    if temp_c >= pts[pts.len() - 1].temp_c {
        return pts[pts.len() - 1].percent.min(100);
    }
    for win in pts.windows(2) {
        let (a, b) = (&win[0], &win[1]);
        if temp_c >= a.temp_c && temp_c <= b.temp_c {
            let span = (b.temp_c - a.temp_c).max(0.001);
            let t = ((temp_c - a.temp_c) / span).clamp(0.0, 1.0);
            let pct = f64::from(a.percent) + t * (f64::from(b.percent) - f64::from(a.percent));
            return pct.round().clamp(0.0, 100.0) as u8;
        }
    }
    pts[pts.len() - 1].percent.min(100)
}

#[derive(Default)]
struct ChannelTracker {
    rpm_samples: VecDeque<u32>,
    pwm_samples: VecDeque<f64>,
    rpm_min: Option<u32>,
    rpm_max: Option<u32>,
    zero_streak: u32,
    pending_cmd: Option<(u8, u32, u8)>, // (target_pct, rpm_before, polls_elapsed)
    pwm_unresponsive: bool,
    last_curve_out: Option<(f64, u8)>,
}

fn pwm_bucket(pwm: f64) -> u8 {
    (pwm.clamp(0.0, 100.0) / 10.0).round() as u8
}

struct HealthEvaluation {
    score: u8,
    status: &'static str,
    expected_rpm: Option<u32>,
    jitter_pct: f64,
    baseline_samples: u32,
    issues: Vec<HealthFinding>,
}

fn evaluate_channel_health(
    channel_name: &str,
    role: &'static str,
    rpm: Option<u32>,
    pwm: Option<f64>,
    host_temp_c: Option<f64>,
    tracker: &ChannelTracker,
    baseline: Option<&ChannelBaseline>,
) -> HealthEvaluation {
    let mut score: i32 = 100;
    let mut issues = Vec::new();

    // 1. Check GPU 0-dB idle mode explicitly so silent GPUs are never false-flagged!
    let is_gpu_zero_db = role == "gpu"
        && rpm == Some(0)
        && pwm.unwrap_or(0.0) <= 5.0
        && host_temp_c.unwrap_or(40.0) < 58.0;

    if is_gpu_zero_db {
        return HealthEvaluation {
            score: 100,
            status: "0-dB Idle",
            expected_rpm: None,
            jitter_pct: 0.0,
            baseline_samples: baseline.map_or(0, |b| b.buckets.values().map(|v| v.1).sum()),
            issues,
        };
    }

    // 2. Stalled / Zero-RPM Fault
    let demanded = pwm.is_some_and(|p| p >= 35.0)
        || (role == "pump" && host_temp_c.unwrap_or(0.0) >= 45.0)
        || (role == "cpu" && host_temp_c.unwrap_or(0.0) >= 62.0)
        || (role == "gpu" && host_temp_c.unwrap_or(0.0) >= 65.0);
    if rpm == Some(0) && demanded && tracker.zero_streak >= 2 {
        score -= 70;
        let is_pump = role == "pump";
        issues.push(HealthFinding {
            severity: "crit",
            code: if is_pump { "PUMP_STALL" } else { "FAN_STALL" },
            channel: channel_name.to_owned(),
            title: if is_pump {
                format!("{channel_name}: AIO Pump Stalled (0 RPM)")
            } else {
                format!("{channel_name}: Fan Stalled / Seized (0 RPM)")
            },
            detail: format!(
                "Reporting 0 RPM despite {:.0}% PWM / {:.0}°C load for {} consecutive samples.",
                pwm.unwrap_or(0.0),
                host_temp_c.unwrap_or(0.0),
                tracker.zero_streak
            ),
            advice: if is_pump {
                "Inspect pump power/SATA/header cable immediately. A stalled AIO pump causes rapid CPU overheating — avoid heavy loads until resolved.".into()
            } else {
                "Check for cable obstruction, dust buildup, or seized fan bearing. Replace fan if it fails to spin at 75% PWM.".into()
            },
        });
    }

    // 3. AIO Pump Low-RPM Warning
    if role == "pump"
        && let Some(r) = rpm
        && r > 0
        && r < 1100
    {
        score -= 45;
        issues.push(HealthFinding {
            severity: "crit",
            code: "PUMP_LOW_RPM",
            channel: channel_name.to_owned(),
            title: format!("{channel_name}: Abnormally Low Pump Speed ({r} RPM)"),
            detail: "AIO/liquid pumps normally operate between 1,800–3,200 RPM. Sub-1,100 RPM indicates impeller drag, failing motor, or severe BIOS throttling.".into(),
            advice: "Set your motherboard AIO_PUMP header to full DC 12V / ≥75% PWM and listen for grinding or gurgling noises.".into(),
        });
    }

    // 4. Learned Baseline RPM Deficit (Bearing Drag / Dust Choke / End-of-Life)
    let mut expected_rpm = None;
    let baseline_samples = baseline.map_or(0, |b| b.buckets.values().map(|v| v.1).sum());
    if let (Some(r), Some(p), Some(base)) = (rpm, pwm, baseline)
        && r > 0
        && p >= 25.0
    {
        let b = pwm_bucket(p);
        if let Some(&(exp, count)) = base.buckets.get(&b)
            && count >= 5
            && exp >= 400.0
        {
            expected_rpm = Some(exp.round() as u32);
            let deficit_pct = ((exp - f64::from(r)) / exp) * 100.0;
            if deficit_pct >= 35.0 {
                score -= 45;
                issues.push(HealthFinding {
                    severity: "crit",
                    code: "BEARING_SEVERE_DRAG",
                    channel: channel_name.to_owned(),
                    title: format!("{channel_name}: Severe RPM Deficit (-{deficit_pct:.0}% vs baseline)"),
                    detail: format!(
                        "Spinning at {r} RPM instead of expected ~{:.0} RPM at {:.0}% PWM — strong sign of failing bearing or clogged impeller.",
                        exp, p
                    ),
                    advice: "Clean dust filters/blades and check for bearing friction or wobble. Plan fan/pump replacement soon.".into(),
                });
            } else if deficit_pct >= 20.0 {
                score -= 22;
                issues.push(HealthFinding {
                    severity: "warn",
                    code: "BEARING_DRAG",
                    channel: channel_name.to_owned(),
                    title: format!("{channel_name}: Early Bearing Drag (-{deficit_pct:.0}% vs baseline)"),
                    detail: format!(
                        "Measured {r} RPM vs learned healthy baseline ~{:.0} RPM at {:.0}% PWM.",
                        exp, p
                    ),
                    advice: "Inspect fan blades/radiator fins for dust resistance and monitor trend over coming sessions.".into(),
                });
            }
        }
    }

    // 5. Bearing Wobble / Tachometer Jitter under Steady PWM
    let mut jitter_pct = 0.0;
    let n = tracker.rpm_samples.len().min(10);
    if n >= 6 {
        let recent_rpm: Vec<f64> = tracker
            .rpm_samples
            .iter()
            .rev()
            .take(n)
            .map(|&v| f64::from(v))
            .collect();
        let mean = recent_rpm.iter().sum::<f64>() / recent_rpm.len() as f64;
        let pwm_steady = if tracker.pwm_samples.len() >= n {
            let recent_pwm: Vec<f64> = tracker.pwm_samples.iter().rev().take(n).copied().collect();
            let p_min = recent_pwm.iter().copied().fold(f64::INFINITY, f64::min);
            let p_max = recent_pwm.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            (p_max - p_min) <= 4.0
        } else {
            true
        };
        if pwm_steady && mean >= 400.0 {
            let var = recent_rpm
                .iter()
                .map(|v| (v - mean).powi(2))
                .sum::<f64>()
                / recent_rpm.len() as f64;
            let std_dev = var.sqrt();
            jitter_pct = ((std_dev / mean) * 100.0 * 10.0).round() / 10.0;
            let max_step = recent_rpm
                .windows(2)
                .map(|w| (w[0] - w[1]).abs())
                .fold(0.0_f64, f64::max);
            let cov_limit = if role == "pump" { 6.5 } else { 8.5 };
            if jitter_pct >= cov_limit || max_step >= 260.0 {
                score -= if role == "pump" { 30 } else { 20 };
                issues.push(HealthFinding {
                    severity: "warn",
                    code: if role == "pump" { "PUMP_CAVITATION" } else { "BEARING_WOBBLE" },
                    channel: channel_name.to_owned(),
                    title: if role == "pump" {
                        format!("{channel_name}: Pump Cavitation / RPM Surging ({jitter_pct:.1}% jitter)")
                    } else {
                        format!("{channel_name}: Bearing Wobble / Tach Jitter ({jitter_pct:.1}% jitter)")
                    },
                    detail: format!(
                        "RPM fluctuated by ±{std_dev:.0} RPM (peak jump {max_step:.0} RPM) while PWM stayed steady."
                    ),
                    advice: if role == "pump" {
                        "Check AIO radiator orientation (ensure pump block is not the highest point in the loop) to bleed trapped air bubbles.".into()
                    } else {
                        "Erratic tachometer speed at steady PWM indicates worn fan bearings, unbalanced blades, or failing hall-effect sensor.".into()
                    },
                });
            }
        }
    }

    // 6. Unresponsive PWM Header
    if tracker.pwm_unresponsive {
        score -= 15;
        issues.push(HealthFinding {
            severity: "warn",
            code: "PWM_UNRESPONSIVE",
            channel: channel_name.to_owned(),
            title: format!("{channel_name}: PWM Control Unresponsive"),
            detail: "Commanded duty cycle changed significantly, but fan RPM did not respond as expected.".into(),
            advice: "Header may be a 3-pin DC fan on a PWM-only header, locked by motherboard BIOS/EC firmware, or driven by an external splitter.".into(),
        });
    }

    let final_score = score.clamp(0, 100) as u8;
    let status = if final_score <= 40 {
        "Critical"
    } else if final_score <= 65 {
        "Struggling"
    } else if final_score <= 85 {
        "Degraded"
    } else if rpm.is_none() {
        "Monitoring"
    } else {
        "Healthy"
    };

    HealthEvaluation {
        score: final_score,
        status,
        expected_rpm,
        jitter_pct,
        baseline_samples,
        issues,
    }
}

// =========================================================================
// THERMAL ENGINE (State + On-Demand Worker + Persistence)
// =========================================================================

struct EngineInner {
    session: Option<HelperSession>,
    last_frame: Option<RawThermalFrame>,
    last_error: Option<String>,
    config: ThermalConfig,
    baselines: HashMap<String, ChannelBaseline>,
    temp_history: HashMap<String, VecDeque<f64>>,
    temp_minmax: HashMap<String, (f64, f64)>,
    trackers: HashMap<String, ChannelTracker>,
    last_check_summary: Option<String>,
    last_active: Instant,
}

pub struct ThermalEngine {
    data_dir: Option<PathBuf>,
    smoke_test: bool,
    active_view: AtomicBool,
    stopping: AtomicBool,
    check_running: AtomicBool,
    inner: Mutex<EngineInner>,
}

impl ThermalEngine {
    pub fn open(data_dir: Option<&Path>, smoke_test: bool) -> Arc<Self> {
        let dir = data_dir.map(Path::to_path_buf);
        let config = dir
            .as_ref()
            .and_then(|d| fs::read(d.join(CONFIG_FILE)).ok())
            .and_then(|b| serde_json::from_slice::<ThermalConfig>(&b).ok())
            .unwrap_or_else(|| ThermalConfig {
                active_preset: "auto".into(),
                channels: HashMap::new(),
                aliases: HashMap::new(),
            });
        let baselines = dir
            .as_ref()
            .and_then(|d| fs::read(d.join(BASELINE_FILE)).ok())
            .and_then(|b| serde_json::from_slice::<HashMap<String, ChannelBaseline>>(&b).ok())
            .unwrap_or_default();

        let engine = Arc::new(Self {
            data_dir: dir,
            smoke_test,
            active_view: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            check_running: AtomicBool::new(false),
            inner: Mutex::new(EngineInner {
                session: None,
                last_frame: None,
                last_error: None,
                config,
                baselines,
                temp_history: HashMap::new(),
                temp_minmax: HashMap::new(),
                trackers: HashMap::new(),
                last_check_summary: None,
                last_active: Instant::now(),
            }),
        });

        // Lightweight supervisor: runs custom curves & retires idle helper when tab is closed.
        if !smoke_test {
            let bg = engine.clone();
            thread::spawn(move || {
                while !bg.stopping.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_secs(2));
                    if bg.stopping.load(Ordering::Acquire) {
                        break;
                    }
                    let view_open = bg.active_view.load(Ordering::Acquire);
                    let needs_curves = {
                        let guard = bg.inner.lock().unwrap_or_else(|e| e.into_inner());
                        guard
                            .config
                            .channels
                            .values()
                            .any(|m| !matches!(m, ControlMode::Auto))
                    };
                    if view_open || needs_curves {
                        if !bg.check_running.load(Ordering::Acquire) {
                            let _ = bg.tick_once();
                        }
                    } else {
                        let mut guard = bg.inner.lock().unwrap_or_else(|e| e.into_inner());
                        if guard.session.is_some()
                            && guard.last_active.elapsed() > Duration::from_secs(15)
                        {
                            // Free ~45 MB RAM when Thermal Lab is closed and all fans are Auto.
                            guard.session = None;
                        }
                    }
                }
            });
        }
        engine
    }

    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut session) = guard.session {
            session.reset_all();
        }
        guard.session = None;
        self.save_baselines_locked(&guard.baselines);
    }

    fn save_config_locked(&self, cfg: &ThermalConfig) {
        if let Some(dir) = &self.data_dir
            && let Ok(bytes) = serde_json::to_vec_pretty(cfg)
        {
            let _ = fs::create_dir_all(dir);
            let _ = fs::write(dir.join(CONFIG_FILE), bytes);
        }
    }

    fn save_baselines_locked(&self, baselines: &HashMap<String, ChannelBaseline>) {
        if let Some(dir) = &self.data_dir
            && let Ok(bytes) = serde_json::to_vec_pretty(baselines)
        {
            let _ = fs::create_dir_all(dir);
            let _ = fs::write(dir.join(BASELINE_FILE), bytes);
        }
    }

    fn ensure_session_and_poll(guard: &mut EngineInner) {
        if guard.session.is_none()
            && let Some(exe) = crate::sensors::helper_executable()
        {
            match HelperSession::open(&exe) {
                Ok((sess, frame)) => {
                    guard.session = Some(sess);
                    guard.last_frame = Some(frame);
                    guard.last_error = None;
                    return;
                }
                Err(err) => {
                    guard.last_error = Some(err);
                    return;
                }
            }
        }
        if let Some(ref mut sess) = guard.session {
            match sess.poll_frame() {
                Ok(frame) => {
                    guard.last_frame = Some(frame);
                    guard.last_error = None;
                }
                Err(err) => {
                    guard.last_error = Some(err);
                    guard.session = None;
                }
            }
        }
    }

    fn tick_once(&self) -> ThermalSnapshot {
        use crate::thermal_providers::{
            ProviderStatus, read_acpi_thermal_zones, read_hwinfo_shared_memory, read_lhm_ohm_wmi,
            read_pawnio_superio,
        };
        let elevated = crate::native::elevated();
        let nvml_gpu = crate::sensors::nvml_gpu_thermal();
        let hwinfo_frame = if self.smoke_test {
            None
        } else {
            read_hwinfo_shared_memory()
        };
        let wmi_frame = if self.smoke_test {
            None
        } else {
            read_lhm_ohm_wmi()
        };
        let pawnio_sio = if self.smoke_test || !elevated {
            Ok(None)
        } else {
            read_pawnio_superio()
        };
        let acpi_temps = if self.smoke_test {
            Vec::new()
        } else {
            read_acpi_thermal_zones()
        };
        let storage_vols = if self.smoke_test {
            Vec::new()
        } else {
            crate::storage::volumes()
        };

        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        guard.last_active = Instant::now();
        if !self.smoke_test {
            Self::ensure_session_and_poll(&mut guard);
        }

        // Track active hybrid providers (displayed as status pills at top of Thermal Lab)
        let helper_available = crate::sensors::helper_executable().is_some();
        let pawn_io_srv = crate::sensors::pawn_io_state();
        let helper_mobo_count = guard
            .last_frame
            .as_ref()
            .map_or(0, |f| f.fans.iter().filter(|x| x.category != "gpu").count());
        let mut providers = vec![
            ProviderStatus {
                id: "nvml",
                name: "NVML (GPU)",
                state: if nvml_gpu.is_some() { "active" } else { "unavailable" },
                detail: nvml_gpu
                    .as_ref()
                    .map_or_else(|| "No NVIDIA NVML GPU detected".into(), |g| g.name.clone()),
            },
            ProviderStatus {
                id: "pawnio_sio",
                name: "PawnIO SuperIO",
                state: match &pawnio_sio {
                    Ok(Some(_)) => "active",
                    Ok(None) if !elevated => "admin_required",
                    Ok(None) => "standby",
                    Err(_) if !elevated => "admin_required",
                    Err(_) => "unavailable",
                },
                detail: match &pawnio_sio {
                    Ok(Some(fr)) => fr.detail.clone(),
                    Ok(None) if !elevated => {
                        format!("Restart as Admin to read motherboard SuperIO & AIO headers (PawnIO: {pawn_io_srv})")
                    }
                    Ok(None) => "No direct ITE SuperIO chip reported on LPC slots".into(),
                    Err(e) => e.clone(),
                },
            },
            ProviderStatus {
                id: "lhm_helper",
                name: "LHM Helper",
                state: if !helper_available {
                    "unavailable"
                } else if guard.session.is_some() && (elevated || helper_mobo_count > 0) {
                    "active"
                } else if guard.session.is_some() {
                    "admin_required"
                } else {
                    "standby"
                },
                detail: if !helper_available {
                    "Optional CoreWatchSensorHelper.exe not staged".into()
                } else if !elevated {
                    "GPU sensors active; Admin required for CPU die, Motherboard EC, AIO & PWM control".into()
                } else {
                    "Full CPU, GPU, Motherboard SuperIO/EC, AIO & PWM control active".into()
                },
            },
            ProviderStatus {
                id: "hwinfo",
                name: "HWiNFO64 SM2",
                state: if hwinfo_frame.is_some() { "active" } else { "standby" },
                detail: hwinfo_frame.as_ref().map_or_else(
                    || "Standby — enable Shared Memory in HWiNFO64 to stream sensors in Standard User mode".into(),
                    |f| f.detail.clone(),
                ),
            },
            ProviderStatus {
                id: "wmi_hw",
                name: "LHM / OHM WMI",
                state: if wmi_frame.is_some() { "active" } else { "standby" },
                detail: wmi_frame.as_ref().map_or_else(
                    || "Standby — auto-connects when LibreHardwareMonitor or OpenHardwareMonitor WMI is running".into(),
                    |(_, f)| f.detail.clone(),
                ),
            },
        ];
        let smart_count = storage_vols.iter().filter(|v| v.temperature_c.is_some()).count();
        providers.push(ProviderStatus {
            id: "smart_acpi",
            name: "SMART / ACPI",
            state: if smart_count > 0 || !acpi_temps.is_empty() {
                "active"
            } else {
                "standby"
            },
            detail: format!("{smart_count} drive temp(s), {} ACPI zone(s)", acpi_temps.len()),
        });

        struct TempCandidate {
            name: String,
            hardware: String,
            category: String,
            value: f64,
            min: Option<f64>,
            max: Option<f64>,
        }
        // Build temperature list from LHM Helper + HWiNFO64 SM2 + LHM/OHM WMI + PawnIO SuperIO + NVML + SMART + ACPI
        let mut temp_map: HashMap<String, TempCandidate> = HashMap::new();
        if let Some(ref frame) = guard.last_frame {
            for t in &frame.temperatures {
                // Filter out invalid unprivileged 0°C placeholder readings
                if t.value > 1.0 && t.value < 145.0 {
                    temp_map.insert(
                        t.id.clone(),
                        TempCandidate {
                            name: t.name.clone(),
                            hardware: t.hardware.clone(),
                            category: t.category.clone(),
                            value: t.value,
                            min: t.min.filter(|&v| v > 1.0),
                            max: t.max.filter(|&v| v > 1.0),
                        },
                    );
                }
            }
        }
        fn merge_external_temps(
            temp_map: &mut HashMap<String, TempCandidate>,
            temps: &[crate::thermal_providers::ProviderTemp],
        ) {
            for t in temps {
                let dup = temp_map.values().any(|e| {
                    e.category == t.category && e.name.eq_ignore_ascii_case(&t.name)
                });
                if !dup {
                    temp_map.insert(
                        t.id.clone(),
                        TempCandidate {
                            name: t.name.clone(),
                            hardware: t.hardware.clone(),
                            category: t.category.clone(),
                            value: t.value_c,
                            min: t.min_c,
                            max: t.max_c,
                        },
                    );
                }
            }
        }
        if let Some(ref hw) = hwinfo_frame {
            merge_external_temps(&mut temp_map, &hw.temperatures);
        }
        if let Some((_, ref wf)) = wmi_frame {
            merge_external_temps(&mut temp_map, &wf.temperatures);
        }
        if let Ok(Some(ref pio)) = pawnio_sio
            && !temp_map.values().any(|t| t.category == "motherboard")
        {
            merge_external_temps(&mut temp_map, &pio.temperatures);
        }
        merge_external_temps(&mut temp_map, &acpi_temps);
        if let Some(ref gpu) = nvml_gpu
            && let Some(c) = gpu.temp_c
            && !temp_map
                .values()
                .any(|t| t.category == "gpu" && t.name.eq_ignore_ascii_case("GPU Core"))
        {
            temp_map.insert(
                "nvml/gpu/0/temp".into(),
                TempCandidate {
                    name: "GPU Core".into(),
                    hardware: gpu.name.clone(),
                    category: "gpu".into(),
                    value: c,
                    min: None,
                    max: None,
                },
            );
        }
        for vol in &storage_vols {
            if let Some(tc) = vol.temperature_c
                && (10..=110).contains(&tc)
            {
                let id = format!("storage/{}/temp", vol.mount);
                if !temp_map
                    .values()
                    .any(|t| t.category == "storage" && t.hardware.contains(&vol.mount))
                {
                    let hw = vol
                        .disk_name
                        .clone()
                        .unwrap_or_else(|| format!("{} ({})", vol.kind, vol.drive_type));
                    temp_map.insert(
                        id,
                        TempCandidate {
                            name: format!("Drive {} ({})", vol.mount.trim_end_matches('\\'), vol.label),
                            hardware: hw,
                            category: "storage".into(),
                            value: tc as f64,
                            min: None,
                            max: None,
                        },
                    );
                }
            }
        }

        let mut temperatures: Vec<TempSensor> = Vec::new();
        let mut temp_lookup: HashMap<String, f64> = HashMap::new();
        let mut cpu_max_c: Option<f64> = None;
        let mut gpu_max_c: Option<f64> = None;
        let mut coolant_c: Option<f64> = None;

        let mut sorted_temp_entries: Vec<_> = temp_map.into_iter().collect();
        sorted_temp_entries.sort_by(|a, b| a.1.category.cmp(&b.1.category).then_with(|| a.1.name.cmp(&b.1.name)));

        for (id, cand) in sorted_temp_entries {
            let TempCandidate {
                name,
                hardware,
                category,
                value: val,
                min: raw_min,
                max: raw_max,
            } = cand;
            let history_vec: Vec<f64> = {
                let hist = guard.temp_history.entry(id.clone()).or_default();
                hist.push_back(val);
                while hist.len() > HISTORY_CAP {
                    hist.pop_front();
                }
                hist.iter().copied().collect()
            };
            let (smin, smax) = *guard
                .temp_minmax
                .entry(id.clone())
                .and_modify(|(mn, mx)| {
                    if val < *mn {
                        *mn = val;
                    }
                    if val > *mx {
                        *mx = val;
                    }
                })
                .or_insert_with(|| (raw_min.unwrap_or(val).min(val), raw_max.unwrap_or(val).max(val)));
            let (warn_c, crit_c) = temp_thresholds(&category, &name);
            let status = if val >= crit_c {
                "hot"
            } else if val >= warn_c {
                "warm"
            } else {
                "cool"
            };
            temp_lookup.insert(id.clone(), val);
            if category == "cpu" {
                cpu_max_c = Some(cpu_max_c.map_or(val, |m| m.max(val)));
            } else if category == "gpu" && name.eq_ignore_ascii_case("GPU Core") {
                gpu_max_c = Some(gpu_max_c.map_or(val, |m| m.max(val)));
            }
            let lower_n = name.to_ascii_lowercase();
            if category == "cooler"
                || lower_n.contains("liquid")
                || lower_n.contains("coolant")
                || lower_n.contains("water")
            {
                coolant_c = Some(coolant_c.map_or(val, |m| m.max(val)));
            }
            temperatures.push(TempSensor {
                id,
                name,
                hardware,
                category,
                value_c: val,
                min_c: smin,
                max_c: smax,
                warn_c,
                crit_c,
                status,
                history: history_vec,
            });
        }

        struct ControlCandidate {
            id: String,
            name: String,
            hardware: String,
            category: String,
            index: i32,
            percent: Option<f64>,
            controllable: bool,
            min_pct: u8,
            max_pct: u8,
        }
        struct FusedChannel {
            id: String,
            name: String,
            hardware: String,
            category: String,
            rpm: Option<u32>,
            control_id: Option<String>,
            pwm_pct: Option<f64>,
            controllable: bool,
            min_pct: u8,
            max_pct: u8,
        }

        // Fuse Fans + Controls
        let mut raw_fans: Vec<(String, String, String, String, i32, Option<u32>)> = Vec::new();
        let mut raw_controls: Vec<ControlCandidate> = Vec::new();
        if let Some(ref frame) = guard.last_frame {
            for f in &frame.fans {
                raw_fans.push((
                    f.id.clone(),
                    f.name.clone(),
                    f.hardware.clone(),
                    f.category.clone(),
                    f.index,
                    Some(f.rpm.round().max(0.0) as u32),
                ));
            }
            for c in &frame.controls {
                raw_controls.push(ControlCandidate {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    hardware: c.hardware.clone(),
                    category: c.category.clone(),
                    index: c.index,
                    percent: c.percent,
                    controllable: c.controllable,
                    min_pct: c.min_pct.clamp(0.0, 100.0).round() as u8,
                    max_pct: c.max_pct.clamp(0.0, 100.0).round() as u8,
                });
            }
        }
        // Merge fans from HWiNFO64 SM2, LHM/OHM WMI, and native PawnIO SuperIO (avoiding duplicates with LHM Helper)
        #[allow(clippy::type_complexity)]
        fn append_ext_fans(
            raw_fans: &mut Vec<(String, String, String, String, i32, Option<u32>)>,
            raw_controls: &mut Vec<ControlCandidate>,
            ext_fans: &[crate::thermal_providers::ProviderFan],
        ) {
            for f in ext_fans {
                let dup = raw_fans.iter().any(|existing| {
                    existing.3 == f.category && existing.1.eq_ignore_ascii_case(&f.name)
                });
                if !dup {
                    raw_fans.push((
                        f.id.clone(),
                        f.name.clone(),
                        f.hardware.clone(),
                        f.category.clone(),
                        -1,
                        Some(f.rpm),
                    ));
                    if let Some(pwm) = f.pwm_pct {
                        raw_controls.push(ControlCandidate {
                            id: format!("{}:pwm", f.id),
                            name: f.name.clone(),
                            hardware: f.hardware.clone(),
                            category: f.category.clone(),
                            index: -1,
                            percent: Some(pwm),
                            controllable: false,
                            min_pct: 0,
                            max_pct: 100,
                        });
                    }
                }
            }
        }
        if let Some(ref hw) = hwinfo_frame {
            append_ext_fans(&mut raw_fans, &mut raw_controls, &hw.fans);
        }
        if let Some((_, ref wf)) = wmi_frame {
            append_ext_fans(&mut raw_fans, &mut raw_controls, &wf.fans);
        }
        if let Ok(Some(ref pio)) = pawnio_sio
            && !raw_fans.iter().any(|f| f.3 == "motherboard")
        {
            append_ext_fans(&mut raw_fans, &mut raw_controls, &pio.fans);
        }

        // Fallback to native NVML fan percentages if helper didn't report GPU fans
        if let Some(ref gpu) = nvml_gpu
            && !raw_fans.iter().any(|f| f.3 == "gpu")
            && !raw_controls.iter().any(|c| c.category == "gpu")
        {
            for (idx, &pct) in gpu.fan_percents.iter().enumerate() {
                raw_controls.push(ControlCandidate {
                    id: format!("nvml/gpu/0/control/{idx}"),
                    name: format!("GPU Fan {}", idx + 1),
                    hardware: gpu.name.clone(),
                    category: "gpu".into(),
                    index: idx as i32,
                    percent: Some(f64::from(pct)),
                    controllable: false,
                    min_pct: 0,
                    max_pct: 100,
                });
            }
        }

        let mut matched_controls = vec![false; raw_controls.len()];
        let mut fused: Vec<FusedChannel> = Vec::new();

        for (fid, fname, fhw, fcat, fidx, frpm) in raw_fans {
            let match_idx = raw_controls.iter().enumerate().position(|(ci, c)| {
                !matched_controls[ci]
                    && c.hardware == fhw
                    && (c.index == fidx || c.name.eq_ignore_ascii_case(&fname))
            });
            if let Some(ci) = match_idx {
                matched_controls[ci] = true;
                let c = &raw_controls[ci];
                fused.push(FusedChannel {
                    id: fid,
                    name: fname,
                    hardware: fhw,
                    category: fcat,
                    rpm: frpm,
                    control_id: Some(c.id.clone()),
                    pwm_pct: c.percent,
                    controllable: c.controllable,
                    min_pct: c.min_pct,
                    max_pct: c.max_pct,
                });
            } else {
                fused.push(FusedChannel {
                    id: fid,
                    name: fname,
                    hardware: fhw,
                    category: fcat,
                    rpm: frpm,
                    control_id: None,
                    pwm_pct: None,
                    controllable: false,
                    min_pct: 0,
                    max_pct: 100,
                });
            }
        }
        for (ci, c) in raw_controls.into_iter().enumerate() {
            if !matched_controls[ci] {
                fused.push(FusedChannel {
                    id: c.id.clone(),
                    name: c.name,
                    hardware: c.hardware,
                    category: c.category,
                    rpm: None,
                    control_id: Some(c.id),
                    pwm_pct: c.percent,
                    controllable: c.controllable,
                    min_pct: c.min_pct,
                    max_pct: c.max_pct,
                });
            }
        }

        // Apply active curves & evaluate per-channel health diagnostics
        let mut fans_out: Vec<FanChannel> = Vec::new();
        let mut all_findings: Vec<HealthFinding> = Vec::new();
        let mut commands_to_apply: Vec<(String, u8)> = Vec::new();
        let mut baselines_dirty = false;

        for FusedChannel {
            id,
            name: raw_name,
            hardware,
            category,
            rpm,
            control_id,
            pwm_pct,
            controllable,
            min_pct,
            max_pct,
        } in fused
        {
            let alias = guard.config.aliases.get(&id).cloned();
            let name = alias
                .as_ref()
                .and_then(|a| a.label.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map_or_else(|| raw_name.clone(), str::to_owned);
            let custom_role = alias
                .as_ref()
                .and_then(|a| a.role.as_deref())
                .and_then(parse_role_override)
                .map(str::to_owned);
            let role = custom_role
                .as_deref()
                .and_then(parse_role_override)
                .unwrap_or_else(|| classify_fan_role(&name, &hardware, &category));
            let effective_min = if role == "pump" {
                min_pct.max(PUMP_MIN_SAFETY_PCT)
            } else {
                min_pct
            };
            let mode = control_id
                .as_ref()
                .and_then(|cid| guard.config.channels.get(cid))
                .cloned()
                .unwrap_or(ControlMode::Auto);

            let host_temp = match role {
                "gpu" => gpu_max_c.or(cpu_max_c),
                "pump" | "cooler" => coolant_c.or(cpu_max_c),
                _ => cpu_max_c.or(gpu_max_c),
            };

            // Update rolling tracker & evaluate health cleanly without overlapping MutexGuard borrows
            let baseline_snap = guard.baselines.get(&id).cloned();
            let (eval, rpm_min, rpm_max, rpm_history) = {
                let tracker = guard.trackers.entry(id.clone()).or_default();
                if let Some(r) = rpm {
                    tracker.rpm_samples.push_back(r);
                    while tracker.rpm_samples.len() > HISTORY_CAP {
                        tracker.rpm_samples.pop_front();
                    }
                    if r > 0 {
                        tracker.rpm_min = Some(tracker.rpm_min.map_or(r, |m| m.min(r)));
                        tracker.rpm_max = Some(tracker.rpm_max.map_or(r, |m| m.max(r)));
                        tracker.zero_streak = 0;
                    } else {
                        tracker.zero_streak = tracker.zero_streak.saturating_add(1);
                    }
                }
                if let Some(p) = pwm_pct {
                    tracker.pwm_samples.push_back(p);
                    while tracker.pwm_samples.len() > HISTORY_CAP {
                        tracker.pwm_samples.pop_front();
                    }
                }
                // Check pending PWM responsiveness test
                if let Some((target_pct, rpm_before, elapsed)) = tracker.pending_cmd {
                    if let Some(cur_rpm) = rpm {
                        if cur_rpm.abs_diff(rpm_before) >= 80 {
                            tracker.pending_cmd = None;
                            tracker.pwm_unresponsive = false;
                        } else if elapsed >= 3 {
                            tracker.pending_cmd = None;
                            tracker.pwm_unresponsive = true;
                        } else {
                            tracker.pending_cmd = Some((target_pct, rpm_before, elapsed + 1));
                        }
                    } else {
                        tracker.pending_cmd = None;
                    }
                }

                // Curve evaluation
                if controllable
                    && let Some(ref cid) = control_id
                    && let ControlMode::Curve(ref curve) = mode
                {
                    let sensor_temp = temp_lookup
                        .get(&curve.sensor_id)
                        .copied()
                        .or(host_temp);
                    if let Some(st) = sensor_temp {
                        let raw_target = interpolate_curve(curve, st, tracker.last_curve_out);
                        let safe_target = enforce_pump_floor(role, raw_target)
                            .clamp(effective_min, max_pct.max(effective_min));
                        if tracker
                            .last_curve_out
                            .is_none_or(|(_, prev)| prev != safe_target)
                        {
                            tracker.last_curve_out = Some((st, safe_target));
                            commands_to_apply.push((cid.clone(), safe_target));
                        }
                    }
                }

                let eval = evaluate_channel_health(
                    &name,
                    role,
                    rpm,
                    pwm_pct,
                    host_temp,
                    tracker,
                    baseline_snap.as_ref(),
                );
                let rpm_min = tracker.rpm_min;
                let rpm_max = tracker.rpm_max;
                let rpm_history: Vec<u32> = tracker.rpm_samples.iter().copied().collect();
                (eval, rpm_min, rpm_max, rpm_history)
            };

            // Learn healthy RPM-vs-PWM baseline when fan is healthy and steady
            if eval.score >= 90
                && let (Some(r), Some(p)) = (rpm, pwm_pct)
                && r >= 350
                && p >= 25.0
            {
                let b = pwm_bucket(p);
                let entry = guard
                    .baselines
                    .entry(id.clone())
                    .or_default()
                    .buckets
                    .entry(b)
                    .or_insert((f64::from(r), 0));
                if entry.1 == 0 {
                    entry.0 = f64::from(r);
                } else if entry.1 < 200 {
                    // Slow EMA so normal variance settles while gradual degradation remains detectable
                    entry.0 = entry.0 * 0.96 + f64::from(r) * 0.04;
                }
                entry.1 = entry.1.saturating_add(1);
                if entry.1.is_multiple_of(10) {
                    baselines_dirty = true;
                }
            }

            for issue in &eval.issues {
                all_findings.push(issue.clone());
            }
            fans_out.push(FanChannel {
                id,
                name,
                raw_name,
                hardware,
                category,
                role,
                custom_role,
                rpm,
                rpm_min,
                rpm_max,
                rpm_history,
                control_id,
                pwm_pct,
                controllable,
                min_pct: effective_min,
                max_pct,
                mode,
                health_score: eval.score,
                health_status: eval.status,
                expected_rpm: eval.expected_rpm,
                rpm_jitter_pct: eval.jitter_pct,
                baseline_samples: eval.baseline_samples,
                issues: eval.issues,
            });
        }

        // Apply any curve-computed PWM updates to the helper
        if let Some(ref mut sess) = guard.session {
            for (cid, pct) in commands_to_apply {
                let _ = sess.set_fan(&cid, pct);
            }
        }
        if baselines_dirty {
            self.save_baselines_locked(&guard.baselines);
        }

        // Temperature & AIO heat-soak diagnostics
        for t in &temperatures {
            if t.value_c >= t.crit_c {
                all_findings.push(HealthFinding {
                    severity: "crit",
                    code: "OVER_TEMP",
                    channel: t.name.clone(),
                    title: format!("{} Over-Temperature ({:.0}°C)", t.name, t.value_c),
                    detail: format!(
                        "{} exceeded critical threshold ({:.0}°C).",
                        t.hardware, t.crit_c
                    ),
                    advice: "Increase cooling curve, inspect dust filters/airflow, and verify cooler mount or pump RPM.".into(),
                });
            }
        }

        let flows: Vec<FlowSensor> = guard
            .last_frame
            .as_ref()
            .map(|f| {
                f.flows
                    .iter()
                    .map(|fl| FlowSensor {
                        id: fl.id.clone(),
                        name: fl.name.clone(),
                        hardware: fl.hardware.clone(),
                        lph: fl.lph,
                    })
                    .collect()
            })
            .unwrap_or_default();

        let mut powers: Vec<PowerSensor> = guard
            .last_frame
            .as_ref()
            .map(|f| {
                f.powers
                    .iter()
                    .filter(|p| p.watts > 0.1)
                    .map(|p| PowerSensor {
                        id: p.id.clone(),
                        name: p.name.clone(),
                        hardware: p.hardware.clone(),
                        category: p.category.clone(),
                        watts: p.watts,
                    })
                    .collect()
            })
            .unwrap_or_default();
        for ext_powers in [
            hwinfo_frame.as_ref().map(|h| h.powers.as_slice()),
            wmi_frame.as_ref().map(|(_, w)| w.powers.as_slice()),
        ]
        .into_iter()
        .flatten()
        {
            for p in ext_powers {
                if !powers
                    .iter()
                    .any(|e| e.category == p.category && e.name.eq_ignore_ascii_case(&p.name))
                {
                    powers.push(PowerSensor {
                        id: p.id.clone(),
                        name: p.name.clone(),
                        hardware: p.hardware.clone(),
                        category: p.category.clone(),
                        watts: p.watts,
                    });
                }
            }
        }
        if let Some(ref gpu) = nvml_gpu
            && let Some(w) = gpu.power_w
            && !powers.iter().any(|p| p.category == "gpu")
        {
            powers.push(PowerSensor {
                id: "nvml/gpu/0/power".into(),
                name: "GPU Package".into(),
                hardware: gpu.name.clone(),
                category: "gpu".into(),
                watts: (w * 10.0).round() / 10.0,
            });
        }

        // AIO / Liquid Loop summary & heat-soak delta detection
        let pump_rpms: Vec<u32> = fans_out
            .iter()
            .filter(|f| f.role == "pump")
            .filter_map(|f| f.rpm)
            .collect();
        let pump_count = fans_out.iter().filter(|f| f.role == "pump").count();
        let max_pump_rpm = pump_rpms.iter().copied().max();
        let flow_lph = flows.first().map(|f| f.lph);
        let cpu_coolant_delta_c = match (cpu_max_c, coolant_c) {
            (Some(cpu), Some(cool)) => Some(((cpu - cool) * 10.0).round() / 10.0),
            _ => None,
        };
        if let (Some(cpu), Some(cool)) = (cpu_max_c, coolant_c)
            && cpu >= 85.0
            && cool < 32.0
        {
            all_findings.push(HealthFinding {
                severity: "crit",
                code: "AIO_THERMAL_TRANSFER_FAULT",
                channel: "AIO Cooler".into(),
                title: format!(
                    "AIO Heat Transfer Fault (CPU {cpu:.0}°C vs Coolant {cool:.0}°C)"
                ),
                detail: "Large CPU-to-coolant delta indicates dry/poor thermal paste, loose coldplate mounting, or a clogged microfin block.".into(),
                advice: "Check pump RPM, confirm coldplate mounting pressure, and re-paste the CPU if temps remain high.".into(),
            });
        }
        let aio_detected = pump_count > 0 || coolant_c.is_some() || flow_lph.is_some();
        let aio_summary = if aio_detected {
            let pump_bad = fans_out
                .iter()
                .any(|f| f.role == "pump" && f.health_score < 70);
            let status = if pump_bad || coolant_c.is_some_and(|c| c >= 50.0) {
                "Critical"
            } else if coolant_c.is_some_and(|c| c >= 42.0) {
                "Warm"
            } else {
                "Healthy"
            };
            let note = if let Some(r) = max_pump_rpm {
                format!("Pump active at {r} RPM · minimum 35% safety floor enforced.")
            } else {
                "Liquid cooling sensors active.".into()
            };
            AioSummary {
                detected: true,
                pump_count,
                max_pump_rpm,
                coolant_temp_c: coolant_c,
                flow_lph,
                cpu_coolant_delta_c,
                status,
                note,
            }
        } else {
            AioSummary {
                detected: false,
                pump_count: 0,
                max_pump_rpm: None,
                coolant_temp_c: None,
                flow_lph: None,
                cpu_coolant_delta_c: None,
                status: "Not Detected",
                note: if crate::native::elevated() {
                    "No dedicated AIO/Pump header or USB liquid controller reported. Motherboard PUMP_FAN headers appear automatically when tach-connected.".into()
                } else {
                    "Restart as Administrator (with PawnIO) to scan motherboard SuperIO PUMP_FAN / AIO_PUMP headers and USB liquid controllers.".into()
                },
            }
        };

        let gpu_throttle_reason = nvml_gpu.and_then(|g| g.throttle_reason);
        if let Some(ref reason) = gpu_throttle_reason {
            all_findings.push(HealthFinding {
                severity: "warn",
                code: "GPU_THROTTLE",
                channel: "NVIDIA GPU".into(),
                title: format!("GPU Throttling Active: {reason}"),
                detail: "NVML reports active GPU clock slowdown due to thermal or power limits.".into(),
                advice: "Raise GPU fan curve or verify case intake airflow.".into(),
            });
        }

        // Overall health score
        all_findings.sort_by_key(|f| match f.severity {
            "crit" => 0,
            "warn" => 1,
            _ => 2,
        });
        let min_fan_score = fans_out.iter().map(|f| f.health_score).min().unwrap_or(100);
        let crit_penalty = (all_findings
            .iter()
            .filter(|f| f.severity == "crit" && f.code == "OVER_TEMP")
            .count() as u8)
            .saturating_mul(20);
        let overall_health_score = min_fan_score.saturating_sub(crit_penalty);
        let overall_status = if overall_health_score <= 45 {
            "Critical"
        } else if overall_health_score <= 70 {
            "Warning"
        } else if overall_health_score <= 88 {
            "Attention"
        } else {
            "Healthy"
        };

        let hottest_temp = temperatures
            .iter()
            .max_by(|a, b| a.value_c.total_cmp(&b.value_c))
            .cloned();

        let has_mobo_fans = fans_out.iter().any(|f| f.category != "gpu");
        let note = if let Some(ref err) = guard.last_error {
            Some(err.clone())
        } else if !elevated && !has_mobo_fans {
            Some("Standard User mode: GPU thermals & fans are live, but Windows blocks direct motherboard SuperIO & Arctic/PWM AIO headers without elevation. Click Restart as Administrator (PawnIO is ready), OR enable Shared Memory in HWiNFO64 / WMI in LibreHardwareMonitor to read them in Standard User mode.".into())
        } else if !helper_available && pawnio_sio.as_ref().ok().and_then(|o| o.as_ref()).is_none() && hwinfo_frame.is_none() && wmi_frame.is_none() {
            Some("Optional Hardware Sensor Helper is not installed — showing native NVIDIA NVML, SMART & ACPI sensors.".into())
        } else {
            None
        };

        ThermalSnapshot {
            elevated,
            helper_available,
            helper_active: guard.session.is_some(),
            pawn_io: pawn_io_srv,
            active_preset: if guard.config.active_preset.is_empty() {
                "auto".into()
            } else {
                guard.config.active_preset.clone()
            },
            overall_health_score,
            overall_status,
            hottest_temp,
            temperatures,
            fans: fans_out,
            flows,
            powers,
            aio_summary,
            findings: all_findings,
            gpu_throttle_reason,
            health_check_running: self.check_running.load(Ordering::Acquire),
            last_check_summary: guard.last_check_summary.clone(),
            providers,
            note,
        }
    }

    pub fn snapshot(&self) -> ThermalSnapshot {
        self.tick_once()
    }

    pub fn execute(&self, action: ThermalAction) -> Result<ThermalSnapshot, String> {
        match action {
            ThermalAction::Refresh => Ok(self.tick_once()),
            ThermalAction::SetActive { active } => {
                self.active_view.store(active, Ordering::Release);
                if active {
                    Ok(self.tick_once())
                } else {
                    let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    drop(guard);
                    Ok(self.tick_once())
                }
            }
            ThermalAction::SetManual {
                control_id,
                percent,
            } => {
                if self.smoke_test {
                    return Ok(self.tick_once());
                }
                let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                Self::ensure_session_and_poll(&mut guard);
                let (role, current_rpm, channel_id) = guard
                    .last_frame
                    .as_ref()
                    .and_then(|f| {
                        let ctrl = f.controls.iter().find(|c| c.id == control_id)?;
                        let role = classify_fan_role(&ctrl.name, &ctrl.hardware, &ctrl.category);
                        let fan = f.fans.iter().find(|fnx| {
                            fnx.hardware == ctrl.hardware
                                && (fnx.index == ctrl.index
                                    || fnx.name.eq_ignore_ascii_case(&ctrl.name))
                        });
                        Some((
                            role,
                            fan.map(|x| x.rpm.round().max(0.0) as u32),
                            fan.map_or_else(|| ctrl.id.clone(), |x| x.id.clone()),
                        ))
                    })
                    .unwrap_or(("chassis", None, control_id.clone()));
                let safe_pct = enforce_pump_floor(role, percent);
                if let Some(ref mut sess) = guard.session {
                    sess.set_fan(&control_id, safe_pct)?;
                } else {
                    return Err("Hardware sensor helper is not active.".into());
                }
                if let Some(rpm_now) = current_rpm {
                    let tr = guard.trackers.entry(channel_id).or_default();
                    tr.pending_cmd = Some((safe_pct, rpm_now, 0));
                }
                guard.config.active_preset = "custom".into();
                guard
                    .config
                    .channels
                    .insert(control_id, ControlMode::Manual { percent: safe_pct });
                let cfg = guard.config.clone();
                self.save_config_locked(&cfg);
                drop(guard);
                Ok(self.tick_once())
            }
            ThermalAction::SetAuto { control_id } => {
                if self.smoke_test {
                    return Ok(self.tick_once());
                }
                let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(ref mut sess) = guard.session {
                    let _ = sess.auto_fan(&control_id);
                }
                guard.config.channels.remove(&control_id);
                if guard.config.channels.is_empty() {
                    guard.config.active_preset = "auto".into();
                }
                let cfg = guard.config.clone();
                self.save_config_locked(&cfg);
                drop(guard);
                Ok(self.tick_once())
            }
            ThermalAction::SetCurve { control_id, curve } => {
                if self.smoke_test {
                    return Ok(self.tick_once());
                }
                if curve.points.len() < 2 {
                    return Err("Provide at least 2 points for a custom fan curve.".into());
                }
                let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                guard.config.active_preset = "custom".into();
                guard
                    .config
                    .channels
                    .insert(control_id, ControlMode::Curve(curve));
                let cfg = guard.config.clone();
                self.save_config_locked(&cfg);
                drop(guard);
                Ok(self.tick_once())
            }
            ThermalAction::ConfigureChannel {
                channel_id,
                label,
                role,
            } => {
                let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                let clean_label = label
                    .map(|s| s.trim().chars().take(48).collect::<String>())
                    .filter(|s| !s.is_empty());
                let clean_role = role
                    .as_deref()
                    .and_then(parse_role_override)
                    .map(str::to_owned);
                if clean_label.is_none() && clean_role.is_none() {
                    guard.config.aliases.remove(&channel_id);
                } else {
                    guard.config.aliases.insert(
                        channel_id,
                        ChannelAlias {
                            label: clean_label,
                            role: clean_role,
                        },
                    );
                }
                let cfg = guard.config.clone();
                self.save_config_locked(&cfg);
                drop(guard);
                Ok(self.tick_once())
            }
            ThermalAction::ApplyPreset { preset } => {
                if self.smoke_test {
                    return Ok(self.tick_once());
                }
                let snap = self.tick_once();
                let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                guard.config.active_preset = preset.clone();
                if preset == "auto" {
                    guard.config.channels.clear();
                    if let Some(ref mut sess) = guard.session {
                        sess.reset_all();
                    }
                } else {
                    let default_cpu_sensor = snap
                        .temperatures
                        .iter()
                        .find(|t| t.category == "cpu")
                        .or_else(|| snap.temperatures.first())
                        .map(|t| t.id.clone())
                        .unwrap_or_default();
                    let default_gpu_sensor = snap
                        .temperatures
                        .iter()
                        .find(|t| t.category == "gpu")
                        .map(|t| t.id.clone())
                        .unwrap_or_else(|| default_cpu_sensor.clone());
                    for fan in &snap.fans {
                        if !fan.controllable {
                            continue;
                        }
                        let Some(ref cid) = fan.control_id else {
                            continue;
                        };
                        let sensor_id = if fan.role == "gpu" {
                            default_gpu_sensor.clone()
                        } else {
                            default_cpu_sensor.clone()
                        };
                        let mode = match preset.as_str() {
                            "silent" => ControlMode::Curve(FanCurve {
                                sensor_id,
                                hysteresis_c: 3.0,
                                points: vec![
                                    CurvePoint { temp_c: 35.0, percent: enforce_pump_floor(fan.role, 30) },
                                    CurvePoint { temp_c: 55.0, percent: enforce_pump_floor(fan.role, 45) },
                                    CurvePoint { temp_c: 75.0, percent: 68 },
                                    CurvePoint { temp_c: 88.0, percent: 95 },
                                ],
                            }),
                            "balanced" => ControlMode::Curve(FanCurve {
                                sensor_id,
                                hysteresis_c: 2.0,
                                points: vec![
                                    CurvePoint { temp_c: 35.0, percent: enforce_pump_floor(fan.role, 35) },
                                    CurvePoint { temp_c: 55.0, percent: enforce_pump_floor(fan.role, 55) },
                                    CurvePoint { temp_c: 72.0, percent: 78 },
                                    CurvePoint { temp_c: 85.0, percent: 100 },
                                ],
                            }),
                            "performance" => ControlMode::Curve(FanCurve {
                                sensor_id,
                                hysteresis_c: 2.0,
                                points: vec![
                                    CurvePoint { temp_c: 30.0, percent: enforce_pump_floor(fan.role, 50) },
                                    CurvePoint { temp_c: 50.0, percent: 72 },
                                    CurvePoint { temp_c: 68.0, percent: 90 },
                                    CurvePoint { temp_c: 78.0, percent: 100 },
                                ],
                            }),
                            "max" => {
                                if let Some(ref mut sess) = guard.session {
                                    let _ = sess.set_fan(cid, 100);
                                }
                                ControlMode::Manual { percent: 100 }
                            }
                            _ => ControlMode::Auto,
                        };
                        guard.config.channels.insert(cid.clone(), mode);
                    }
                }
                let cfg = guard.config.clone();
                self.save_config_locked(&cfg);
                drop(guard);
                Ok(self.tick_once())
            }
            ThermalAction::ResetAllAuto => self.execute(ThermalAction::ApplyPreset {
                preset: "auto".into(),
            }),
            ThermalAction::ResetBaselines => {
                let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                guard.baselines.clear();
                guard.trackers.clear();
                guard.last_check_summary = Some("Learned fan/pump baselines cleared — recalibrating.".into());
                self.save_baselines_locked(&guard.baselines);
                drop(guard);
                Ok(self.tick_once())
            }
            ThermalAction::RunHealthCheck => {
                if self.smoke_test {
                    let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    guard.last_check_summary =
                        Some("Health check skipped in smoke-test mode.".into());
                    drop(guard);
                    return Ok(self.tick_once());
                }
                if self.check_running.swap(true, Ordering::AcqRel) {
                    return Err("A fan & pump health check is already running.".into());
                }
                let snap_before = self.tick_once();
                let controllable: Vec<(String, String, &'static str, u8)> = snap_before
                    .fans
                    .iter()
                    .filter(|f| f.controllable && f.control_id.is_some())
                    .map(|f| {
                        (
                            f.id.clone(),
                            f.control_id.clone().unwrap(),
                            f.role,
                            f.min_pct,
                        )
                    })
                    .collect();

                if controllable.is_empty() {
                    self.check_running.store(false, Ordering::Release);
                    let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    guard.last_check_summary = Some(
                        "No controllable PWM fan headers detected (passive health monitoring still active). Run as Administrator to control motherboard fans.".into(),
                    );
                    drop(guard);
                    return Ok(self.tick_once());
                }

                let mut passed = 0usize;
                let mut warnings = Vec::new();
                // Step 1: 45% (pumps stay >= 65% safety)
                {
                    let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(ref mut sess) = guard.session {
                        for (_, cid, role, min_p) in &controllable {
                            let low = if *role == "pump" { 65 } else { 45u8.max(*min_p) };
                            let _ = sess.set_fan(cid, low);
                        }
                    }
                }
                thread::sleep(Duration::from_millis(2400));
                let low_snap = self.tick_once();

                // Step 2: 75% (pumps >= 85%)
                {
                    let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(ref mut sess) = guard.session {
                        for (_, cid, role, _) in &controllable {
                            let high = if *role == "pump" { 85 } else { 75 };
                            let _ = sess.set_fan(cid, high);
                        }
                    }
                }
                thread::sleep(Duration::from_millis(2400));
                let high_snap = self.tick_once();

                // Restore hardware Auto (or reapply prior config)
                {
                    let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                    let saved_channels = guard.config.channels.clone();
                    if let Some(ref mut sess) = guard.session {
                        sess.reset_all();
                        for (cid, mode) in saved_channels {
                            if let ControlMode::Manual { percent } = mode {
                                let _ = sess.set_fan(&cid, percent);
                            }
                        }
                    }
                    // Compare low vs high RPM response and record fresh baselines
                    for (fid, _, role, _) in &controllable {
                        let low_f = low_snap.fans.iter().find(|f| &f.id == fid);
                        let high_f = high_snap.fans.iter().find(|f| &f.id == fid);
                        let name = high_f.map_or(fid.as_str(), |f| f.name.as_str());
                        match (low_f.and_then(|f| f.rpm), high_f.and_then(|f| f.rpm)) {
                            (Some(0), Some(0)) => {
                                warnings.push(format!("{name}: STALLED (0 RPM at 75% PWM)"));
                            }
                            (Some(lo), Some(hi)) if hi >= lo + 100 => {
                                passed += 1;
                                let base = guard.baselines.entry(fid.clone()).or_default();
                                let b_lo = if *role == "pump" { 7 } else { 5 };
                                let b_hi = if *role == "pump" { 9 } else { 8 };
                                base.buckets.insert(b_lo, (f64::from(lo), 8));
                                base.buckets.insert(b_hi, (f64::from(hi), 8));
                            }
                            (Some(lo), Some(hi)) => {
                                warnings.push(format!(
                                    "{name}: Weak PWM response ({lo} -> {hi} RPM)"
                                ));
                            }
                            _ => {
                                passed += 1;
                            }
                        }
                    }
                    let summary = if warnings.is_empty() {
                        format!(
                            "Health check passed: {passed}/{} controllable fan/pump channel(s) responded smoothly & calibrated.",
                            controllable.len()
                        )
                    } else {
                        format!(
                            "Health check finished ({passed}/{} passed) — Warnings: {}",
                            controllable.len(),
                            warnings.join("; ")
                        )
                    };
                    guard.last_check_summary = Some(summary);
                    self.save_baselines_locked(&guard.baselines);
                }
                self.check_running.store(false, Ordering::Release);
                Ok(self.tick_once())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn curve_interpolation_respects_bounds_and_hysteresis() {
        let curve = FanCurve {
            sensor_id: "cpu".into(),
            hysteresis_c: 3.0,
            points: vec![
                CurvePoint { temp_c: 40.0, percent: 30 },
                CurvePoint { temp_c: 60.0, percent: 60 },
                CurvePoint { temp_c: 80.0, percent: 100 },
            ],
        };
        assert_eq!(interpolate_curve(&curve, 30.0, None), 30);
        assert_eq!(interpolate_curve(&curve, 50.0, None), 45);
        assert_eq!(interpolate_curve(&curve, 95.0, None), 100);
        // Cooling by 2°C (< 3°C hysteresis) holds previous duty
        assert_eq!(interpolate_curve(&curve, 58.0, Some((60.0, 60))), 60);
        // Cooling by 4°C (>= 3°C hysteresis) ramps down cleanly
        assert_eq!(interpolate_curve(&curve, 56.0, Some((60.0, 60))), 54);
    }

    #[test]
    fn pump_safety_floor_prevents_zero_duty() {
        assert_eq!(enforce_pump_floor("pump", 0), PUMP_MIN_SAFETY_PCT);
        assert_eq!(enforce_pump_floor("pump", 20), PUMP_MIN_SAFETY_PCT);
        assert_eq!(enforce_pump_floor("pump", 80), 80);
        assert_eq!(enforce_pump_floor("chassis", 0), 0);
    }

    #[test]
    fn health_engine_excludes_gpu_zero_db_and_catches_stalled_and_worn_fans() {
        let tracker = ChannelTracker {
            zero_streak: 4,
            ..Default::default()
        };
        // Silent GPU at 38°C & 0% PWM => healthy 0-dB Idle
        let idle = evaluate_channel_health("GPU Fan 1", "gpu", Some(0), Some(0.0), Some(38.0), &tracker, None);
        assert_eq!(idle.status, "0-dB Idle");
        assert_eq!(idle.score, 100);
        assert!(idle.issues.is_empty());

        // Stalled CPU fan at 60% PWM => Critical stall alert
        let stalled = evaluate_channel_health("CPU_FAN", "cpu", Some(0), Some(60.0), Some(72.0), &tracker, None);
        assert_eq!(stalled.status, "Critical");
        assert!(stalled.issues.iter().any(|i| i.code == "FAN_STALL"));

        // Worn bearing: learned 1500 RPM @ 60% PWM, now dragging at 900 RPM (-40%)
        let mut base = ChannelBaseline::default();
        base.buckets.insert(6, (1500.0, 12));
        let mut steady = ChannelTracker::default();
        for _ in 0..8 {
            steady.rpm_samples.push_back(900);
            steady.pwm_samples.push_back(60.0);
        }
        let drag = evaluate_channel_health("SYS_FAN1", "chassis", Some(900), Some(60.0), Some(50.0), &steady, Some(&base));
        assert!(drag.score <= 65);
        assert!(drag.issues.iter().any(|i| i.code == "BEARING_SEVERE_DRAG"));

        // Bearing wobble / pump cavitation: erratic RPM at steady PWM
        let mut wobble = ChannelTracker::default();
        for &r in &[2400, 1950, 2480, 1890, 2520, 1920, 2450, 1980] {
            wobble.rpm_samples.push_back(r);
            wobble.pwm_samples.push_back(80.0);
        }
        let cav = evaluate_channel_health("AIO_PUMP", "pump", Some(1980), Some(80.0), Some(55.0), &wobble, None);
        assert!(cav.issues.iter().any(|i| i.code == "PUMP_CAVITATION"));
    }
}
