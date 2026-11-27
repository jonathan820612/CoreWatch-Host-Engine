use crate::details::{number, rows, text};
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::OsStr,
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    ptr,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FreeLibrary, HANDLE, HMODULE},
    System::LibraryLoader::{GetProcAddress, LoadLibraryW},
};
use wmi::WMIConnection;

// Official signed PawnIO LpcIO module (LGPL-2.1, namazso/PawnIO.Modules)
static PAWNIO_LPC_IO: &[u8] = include_bytes!("../assets/pawnio/LpcIO.bin");

#[derive(Debug, Clone, Default)]
pub struct ProviderTemp {
    pub id: String,
    pub name: String,
    pub hardware: String,
    pub category: String,
    pub value_c: f64,
    pub min_c: Option<f64>,
    pub max_c: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderFan {
    pub id: String,
    pub name: String,
    pub hardware: String,
    pub category: String,
    pub rpm: u32,
    pub pwm_pct: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderPower {
    pub id: String,
    pub name: String,
    pub hardware: String,
    pub category: String,
    pub watts: f64,
}

#[derive(Debug, Clone, Default)]
pub struct ProviderFrame {
    pub temperatures: Vec<ProviderTemp>,
    pub fans: Vec<ProviderFan>,
    pub powers: Vec<ProviderPower>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: &'static str,
    pub name: &'static str,
    pub state: &'static str, // "active" | "standby" | "admin_required" | "unavailable"
    pub detail: String,
}

fn categorize_hardware(hw_name: &str, sensor_name: &str) -> String {
    let h = hw_name.to_ascii_lowercase();
    let s = sensor_name.to_ascii_lowercase();
    if s.contains("liquid") || s.contains("coolant") || s.contains("water")
        || h.contains("kraken") || h.contains("icue") || h.contains("commander")
        || h.contains("aquacomputer") || h.contains("arctic") || h.contains("aio")
    {
        return "cooler".into();
    }
    if h.contains("ryzen") || h.contains("intel core") || h.contains("xeon")
        || h.contains("threadripper") || h.contains("cpu")
        || s.contains("tctl") || s.contains("tdie") || s.contains("cpu package")
    {
        return "cpu".into();
    }
    if h.contains("geforce") || h.contains("rtx") || h.contains("gtx")
        || h.contains("radeon") || h.contains("arc ") || h.contains("gpu")
        || s.contains("gpu ")
    {
        return "gpu".into();
    }
    if h.contains("nvme") || h.contains("ssd") || h.contains("samsung")
        || h.contains("western digital") || h.contains("wd_") || h.contains("crucial")
        || h.contains("kingston") || h.contains("sabrent") || h.contains("drive")
        || s.contains("drive ")
    {
        return "storage".into();
    }
    if h.contains("dimm") || h.contains("ddr") || h.contains("memory") || s.contains("spd") {
        return "memory".into();
    }
    if h.contains("psu") || h.contains("hx1") || h.contains("rm1") || h.contains("ax1") {
        return "psu".into();
    }
    "motherboard".into()
}

// =========================================================================
// 1. NATIVE RUST HWINFO64 SHARED MEMORY READER (Global\HWiNFO_SENS_SM2)
//    Zero extra crates, <0.2ms, works in Standard User when HWiNFO64 SM2 is on!
// =========================================================================

#[link(name = "kernel32")]
unsafe extern "system" {
    fn OpenFileMappingW(desired_access: u32, inherit_handle: i32, name: *const u16) -> HANDLE;
    fn MapViewOfFile(
        mapping: HANDLE,
        desired_access: u32,
        offset_high: u32,
        offset_low: u32,
        bytes_to_map: usize,
    ) -> *const u8;
    fn UnmapViewOfFile(base_addr: *const core::ffi::c_void) -> i32;
}

const FILE_MAP_READ: u32 = 0x0004;
const HWINFO_MAGIC: u32 = 0x5369_5748; // "HWiS"

fn read_u32_le(buf: &[u8], off: usize) -> Option<u32> {
    Some(u32::from_le_bytes(buf.get(off..off + 4)?.try_into().ok()?))
}

fn read_f64_le(buf: &[u8], off: usize) -> Option<f64> {
    Some(f64::from_le_bytes(buf.get(off..off + 8)?.try_into().ok()?))
}

fn read_cstr(buf: &[u8], off: usize, max_len: usize) -> String {
    let Some(slice) = buf.get(off..off + max_len) else {
        return String::new();
    };
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    String::from_utf8_lossy(&slice[..end]).trim().to_owned()
}

pub fn parse_hwinfo_sm2_bytes(bytes: &[u8]) -> Option<ProviderFrame> {
    if bytes.len() < 44 || read_u32_le(bytes, 0)? != HWINFO_MAGIC {
        return None;
    }
    let sensor_off = read_u32_le(bytes, 20)? as usize;
    let sensor_size = read_u32_le(bytes, 24)? as usize;
    let sensor_num = (read_u32_le(bytes, 28)? as usize).min(256);
    let reading_off = read_u32_le(bytes, 32)? as usize;
    let reading_size = read_u32_le(bytes, 36)? as usize;
    let reading_num = (read_u32_le(bytes, 40)? as usize).min(2048);

    if sensor_size < 264 || reading_size < 316 {
        return None;
    }
    let sensor_end = sensor_off.checked_add(sensor_size.checked_mul(sensor_num)?)?;
    let reading_end = reading_off.checked_add(reading_size.checked_mul(reading_num)?)?;
    if sensor_end > bytes.len() || reading_end > bytes.len() {
        return None;
    }

    let mut sensors = Vec::with_capacity(sensor_num);
    for i in 0..sensor_num {
        let base = sensor_off + i * sensor_size;
        let orig = read_cstr(bytes, base + 8, 128);
        let user = read_cstr(bytes, base + 136, 128);
        sensors.push(if !user.is_empty() { user } else { orig });
    }

    let mut frame = ProviderFrame::default();
    let mut pwm_by_sensor: HashMap<(usize, String), f64> = HashMap::new();

    // First pass: collect PWM / Fan duty % readings so we can attach them to RPM fans
    for i in 0..reading_num {
        let base = reading_off + i * reading_size;
        let r_type = read_u32_le(bytes, base)?;
        let s_idx = read_u32_le(bytes, base + 4)? as usize;
        let label_orig = read_cstr(bytes, base + 12, 128);
        let label_user = read_cstr(bytes, base + 140, 128);
        let label = if !label_user.is_empty() { label_user } else { label_orig };
        let unit = read_cstr(bytes, base + 268, 16);
        let val = read_f64_le(bytes, base + 284)?;
        if r_type == 7 && unit == "%" && (0.0..=100.0).contains(&val) {
            let low = label.to_ascii_lowercase();
            if low.contains("fan") || low.contains("pump") || low.contains("aio") {
                pwm_by_sensor.insert((s_idx, low), val);
            }
        }
    }

    for i in 0..reading_num {
        let base = reading_off + i * reading_size;
        let r_type = read_u32_le(bytes, base)?;
        let s_idx = read_u32_le(bytes, base + 4)? as usize;
        let r_id = read_u32_le(bytes, base + 8)?;
        let label_orig = read_cstr(bytes, base + 12, 128);
        let label_user = read_cstr(bytes, base + 140, 128);
        let label = if !label_user.is_empty() { label_user } else { label_orig };
        let unit = read_cstr(bytes, base + 268, 16);
        let val = read_f64_le(bytes, base + 284)?;
        let vmin = read_f64_le(bytes, base + 292).ok_or(()).ok();
        let vmax = read_f64_le(bytes, base + 300).ok_or(()).ok();
        if !val.is_finite() {
            continue;
        }
        let hw = sensors
            .get(s_idx)
            .cloned()
            .unwrap_or_else(|| "System".into());
        let category = categorize_hardware(&hw, &label);

        match r_type {
            1 => {
                // Temperature
                let c = if unit.contains('F') {
                    (val - 32.0) * 5.0 / 9.0
                } else {
                    val
                };
                if c > 1.0 && c < 145.0 {
                    frame.temperatures.push(ProviderTemp {
                        id: format!("hwinfo/temp/{s_idx}/{r_id}"),
                        name: label,
                        hardware: hw,
                        category,
                        value_c: (c * 10.0).round() / 10.0,
                        min_c: vmin.filter(|v| v.is_finite() && *v > 1.0 && *v < 145.0),
                        max_c: vmax.filter(|v| v.is_finite() && *v > 1.0 && *v < 145.0),
                    });
                }
            }
            3 => {
                // Fan RPM
                if (0.0..=20000.0).contains(&val) {
                    let low = label.to_ascii_lowercase();
                    let pwm = pwm_by_sensor
                        .iter()
                        .find(|((si, pl), _)| *si == s_idx && (pl.contains(&low) || low.contains(pl.as_str())))
                        .map(|(_, &p)| p);
                    frame.fans.push(ProviderFan {
                        id: format!("hwinfo/fan/{s_idx}/{r_id}"),
                        name: label,
                        hardware: hw,
                        category,
                        rpm: val.round().max(0.0) as u32,
                        pwm_pct: pwm,
                    });
                }
            }
            5 => {
                // Power (W)
                if val > 0.2 && val < 1500.0 {
                    let low = label.to_ascii_lowercase();
                    if low.contains("package") || low.contains("total") || low.contains("gpu power") || low.contains("cpu") {
                        frame.powers.push(ProviderPower {
                            id: format!("hwinfo/power/{s_idx}/{r_id}"),
                            name: label,
                            hardware: hw,
                            category,
                            watts: (val * 10.0).round() / 10.0,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    frame.detail = format!(
        "HWiNFO64 SM2: {} temps, {} fans",
        frame.temperatures.len(),
        frame.fans.len()
    );
    Some(frame)
}

pub fn read_hwinfo_shared_memory() -> Option<ProviderFrame> {
    let name = crate::native::wide(r"Global\HWiNFO_SENS_SM2");
    unsafe {
        let mapping = OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr());
        if mapping.is_null() {
            return None;
        }
        // First map header (44 bytes) to compute exact total shared-memory region size safely
        let hdr_ptr = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 44);
        if hdr_ptr.is_null() {
            CloseHandle(mapping);
            return None;
        }
        let hdr = std::slice::from_raw_parts(hdr_ptr, 44);
        let total_size = (|| -> Option<usize> {
            if read_u32_le(hdr, 0)? != HWINFO_MAGIC {
                return None;
            }
            let s_end = (read_u32_le(hdr, 20)? as usize)
                .checked_add((read_u32_le(hdr, 24)? as usize).checked_mul(read_u32_le(hdr, 28)? as usize)?)?;
            let r_end = (read_u32_le(hdr, 32)? as usize)
                .checked_add((read_u32_le(hdr, 36)? as usize).checked_mul(read_u32_le(hdr, 40)? as usize)?)?;
            let sz = s_end.max(r_end);
            (44..=16 * 1024 * 1024).contains(&sz).then_some(sz)
        })();
        UnmapViewOfFile(hdr_ptr.cast());

        let Some(total_size) = total_size else {
            CloseHandle(mapping);
            return None;
        };
        let full_ptr = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, total_size);
        let parsed = if !full_ptr.is_null() {
            let slice = std::slice::from_raw_parts(full_ptr, total_size);
            let res = parse_hwinfo_sm2_bytes(slice);
            UnmapViewOfFile(full_ptr.cast());
            res
        } else {
            None
        };
        CloseHandle(mapping);
        parsed
    }
}

// =========================================================================
// 2. NATIVE RUST LHM / OHM WMI READER (Standard User when LHM/FanControl WMI runs)
// =========================================================================

pub fn read_lhm_ohm_wmi() -> Option<(&'static str, ProviderFrame)> {
    for (label, namespace) in [
        ("LibreHardwareMonitor WMI", r"ROOT\LibreHardwareMonitor"),
        ("OpenHardwareMonitor WMI", r"ROOT\OpenHardwareMonitor"),
    ] {
        let Ok(conn) = WMIConnection::with_namespace_path(namespace) else {
            continue;
        };
        let hw_rows = rows(Some(&conn), "SELECT Identifier, Name, HardwareType FROM Hardware");
        let sensor_rows = rows(
            Some(&conn),
            "SELECT Identifier, Name, Parent, SensorType, Value, Min, Max FROM Sensor",
        );
        if sensor_rows.is_empty() {
            continue;
        }
        let mut hw_lookup: HashMap<String, (String, String)> = HashMap::new();
        for h in &hw_rows {
            if let (Some(id), Some(name)) = (text(h, "Identifier"), text(h, "Name")) {
                let htype = text(h, "HardwareType").unwrap_or("").to_ascii_lowercase();
                hw_lookup.insert(id.to_owned(), (name.to_owned(), htype));
            }
        }
        let mut frame = ProviderFrame::default();
        let mut ctrl_by_parent: HashMap<(String, String), f64> = HashMap::new();
        for s in &sensor_rows {
            if text(s, "SensorType") == Some("Control")
                && let (Some(parent), Some(name)) = (text(s, "Parent"), text(s, "Name"))
                && let Some(val) = wmi_f64(s, "Value")
            {
                ctrl_by_parent.insert((parent.to_owned(), name.to_ascii_lowercase()), val);
            }
        }
        for s in &sensor_rows {
            let Some(stype) = text(s, "SensorType") else {
                continue;
            };
            let Some(id) = text(s, "Identifier") else {
                continue;
            };
            let Some(name) = text(s, "Name") else {
                continue;
            };
            let Some(val) = wmi_f64(s, "Value") else {
                continue;
            };
            let parent = text(s, "Parent").unwrap_or("");
            let (hw_name, htype) = hw_lookup
                .get(parent)
                .cloned()
                .unwrap_or_else(|| ("Hardware".into(), String::new()));
            let category = match htype.as_str() {
                "cpu" => "cpu".into(),
                "gpunvidia" | "gpuamd" | "gpuintel" => "gpu".into(),
                "cooler" => "cooler".into(),
                "storage" => "storage".into(),
                "memory" => "memory".into(),
                "psu" => "psu".into(),
                "motherboard" | "superio" | "embeddedcontroller" => "motherboard".into(),
                _ => categorize_hardware(&hw_name, name),
            };
            match stype {
                "Temperature" if val > 1.0 && val < 145.0 => {
                    frame.temperatures.push(ProviderTemp {
                        id: format!("wmi:{id}"),
                        name: name.to_owned(),
                        hardware: hw_name,
                        category,
                        value_c: (val * 10.0).round() / 10.0,
                        min_c: wmi_f64(s, "Min").filter(|&v| v > 1.0 && v < 145.0),
                        max_c: wmi_f64(s, "Max").filter(|&v| v > 1.0 && v < 145.0),
                    });
                }
                "Fan" if (0.0..=20000.0).contains(&val) => {
                    let pwm = ctrl_by_parent
                        .get(&(parent.to_owned(), name.to_ascii_lowercase()))
                        .copied();
                    frame.fans.push(ProviderFan {
                        id: format!("wmi:{id}"),
                        name: name.to_owned(),
                        hardware: hw_name,
                        category,
                        rpm: val.round().max(0.0) as u32,
                        pwm_pct: pwm,
                    });
                }
                "Power" if val > 0.2 && val < 1500.0 => {
                    let low = name.to_ascii_lowercase();
                    if low.contains("package") || low.contains("total") || low.contains("core") {
                        frame.powers.push(ProviderPower {
                            id: format!("wmi:{id}"),
                            name: name.to_owned(),
                            hardware: hw_name,
                            category,
                            watts: (val * 10.0).round() / 10.0,
                        });
                    }
                }
                _ => {}
            }
        }
        frame.detail = format!(
            "{label}: {} temps, {} fans",
            frame.temperatures.len(),
            frame.fans.len()
        );
        return Some((label, frame));
    }
    None
}

fn wmi_f64(row: &HashMap<String, wmi::Variant>, key: &str) -> Option<f64> {
    match row.get(key)? {
        wmi::Variant::R4(v) => Some(f64::from(*v)),
        wmi::Variant::R8(v) => Some(*v),
        wmi::Variant::UI1(v) => Some(f64::from(*v)),
        wmi::Variant::UI2(v) => Some(f64::from(*v)),
        wmi::Variant::UI4(v) => Some(f64::from(*v)),
        wmi::Variant::I4(v) => Some(f64::from(*v)),
        wmi::Variant::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

// =========================================================================
// 3. NATIVE WINDOWS ACPI THERMAL ZONES (Zero extra deps, Standard User)
// =========================================================================

pub fn read_acpi_thermal_zones() -> Vec<ProviderTemp> {
    let Ok(conn) = WMIConnection::new() else {
        return Vec::new();
    };
    let zones = rows(
        Some(&conn),
        "SELECT Name, HighPrecisionTemperature, Temperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation",
    );
    let mut out = Vec::new();
    for (idx, z) in zones.iter().enumerate() {
        let name = text(z, "Name").unwrap_or("ACPI Zone");
        let temp_c = number(z, "HighPrecisionTemperature")
            .filter(|&v| v > 2742 && v < 4000)
            .map(|v| (v as f64) / 10.0 - 273.15)
            .or_else(|| {
                number(z, "Temperature")
                    .filter(|&v| v > 274 && v < 400)
                    .map(|v| (v as f64) - 273.15)
            });
        if let Some(c) = temp_c
            && c > 5.0
            && c < 120.0
        {
            out.push(ProviderTemp {
                id: format!("acpi/zone/{idx}"),
                name: format!("ACPI {name}"),
                hardware: "Windows ACPI Thermal Zone".into(),
                category: "motherboard".into(),
                value_c: (c * 10.0).round() / 10.0,
                min_c: None,
                max_c: None,
            });
        }
    }
    out
}

// =========================================================================
// 4. DIRECT NATIVE RUST PAWNIO SUPERIO ENGINE (ITE IT86xx/IT87xx & Nuvoton NCT679x)
//    Zero .NET required! Uses PawnIOLib.dll + signed LGPL-2.1 LpcIO.bin (17 KB)
// =========================================================================

type FnPawnioOpen = unsafe extern "system" fn(*mut HANDLE) -> i32;
type FnPawnioLoad = unsafe extern "system" fn(HANDLE, *const u8, usize) -> i32;
type FnPawnioExecute = unsafe extern "system" fn(
    HANDLE,
    *const i8,
    *const u64,
    usize,
    *mut u64,
    usize,
    *mut usize,
) -> i32;
type FnPawnioClose = unsafe extern "system" fn(HANDLE) -> i32;

struct PawnIoLpcSession {
    module: HMODULE,
    handle: HANDLE,
    execute: FnPawnioExecute,
    close: FnPawnioClose,
}

impl Drop for PawnIoLpcSession {
    fn drop(&mut self) {
        unsafe {
            if !self.handle.is_null() {
                (self.close)(self.handle);
            }
            if !self.module.is_null() {
                FreeLibrary(self.module);
            }
        }
    }
}

impl PawnIoLpcSession {
    fn open() -> Result<Self, String> {
        let mut candidates = vec![PathBuf::from(r"C:\Program Files\PawnIO\PawnIOLib.dll")];
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let p = PathBuf::from(pf).join(r"PawnIO\PawnIOLib.dll");
            if !candidates.contains(&p) {
                candidates.push(p);
            }
        }
        let dll = candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or("PawnIOLib.dll not found")?;
        let wide: Vec<u16> = OsStr::new(&dll).encode_wide().chain([0]).collect();
        unsafe {
            let module = LoadLibraryW(wide.as_ptr());
            if module.is_null() {
                return Err("Could not load PawnIOLib.dll".into());
            }
            let get = |sym: &[u8]| GetProcAddress(module, sym.as_ptr());
            let (Some(p_open), Some(p_load), Some(p_exec), Some(p_close)) = (
                get(b"pawnio_open\0"),
                get(b"pawnio_load\0"),
                get(b"pawnio_execute\0"),
                get(b"pawnio_close\0"),
            ) else {
                FreeLibrary(module);
                return Err("PawnIOLib exports missing".into());
            };
            let open_fn: FnPawnioOpen = std::mem::transmute(p_open);
            let load_fn: FnPawnioLoad = std::mem::transmute(p_load);
            let exec_fn: FnPawnioExecute = std::mem::transmute(p_exec);
            let close_fn: FnPawnioClose = std::mem::transmute(p_close);

            let mut handle: HANDLE = ptr::null_mut();
            let hr = open_fn(&mut handle);
            if hr < 0 || handle.is_null() {
                FreeLibrary(module);
                return Err(format!("pawnio_open failed (0x{:08X})", hr as u32));
            }
            let hr_load = load_fn(handle, PAWNIO_LPC_IO.as_ptr(), PAWNIO_LPC_IO.len());
            if hr_load < 0 {
                close_fn(handle);
                FreeLibrary(module);
                return Err(format!("pawnio_load(LpcIO) failed (0x{:08X})", hr_load as u32));
            }
            let sess = Self {
                module,
                handle,
                execute: exec_fn,
                close: close_fn,
            };
            sess.call(b"ioctl_find_bars\0", &[], &mut [])?;
            Ok(sess)
        }
    }

    fn call(&self, name: &[u8], input: &[u64], output: &mut [u64]) -> Result<usize, String> {
        let mut written = 0usize;
        let hr = unsafe {
            (self.execute)(
                self.handle,
                name.as_ptr().cast(),
                if input.is_empty() { ptr::null() } else { input.as_ptr() },
                input.len(),
                if output.is_empty() { ptr::null_mut() } else { output.as_mut_ptr() },
                output.len(),
                &mut written,
            )
        };
        if hr < 0 {
            return Err(format!("PawnIO LpcIO call failed (0x{:08X})", hr as u32));
        }
        Ok(written)
    }

    fn select_slot(&self, slot: u64) -> Result<(), String> {
        self.call(b"ioctl_select_slot\0", &[slot], &mut []).map(|_| ())
    }

    fn superio_inb(&self, reg: u8) -> Result<u8, String> {
        let mut out = [0u64; 1];
        self.call(b"ioctl_superio_inb\0", &[u64::from(reg)], &mut out)?;
        Ok((out[0] & 0xFF) as u8)
    }

    fn superio_inw(&self, reg: u8) -> Result<u16, String> {
        let mut out = [0u64; 1];
        self.call(b"ioctl_superio_inw\0", &[u64::from(reg)], &mut out)?;
        Ok((out[0] & 0xFFFF) as u16)
    }

    fn superio_outb(&self, reg: u8, val: u8) -> Result<(), String> {
        self.call(b"ioctl_superio_outb\0", &[u64::from(reg), u64::from(val)], &mut [])
            .map(|_| ())
    }

    fn pio_inb(&self, port: u16) -> Result<u8, String> {
        let mut out = [0u64; 1];
        self.call(b"ioctl_pio_inb\0", &[u64::from(port)], &mut out)?;
        Ok((out[0] & 0xFF) as u8)
    }

    fn pio_outb(&self, port: u16, val: u8) -> Result<(), String> {
        self.call(b"ioctl_pio_outb\0", &[u64::from(port), u64::from(val)], &mut [])
            .map(|_| ())
    }

    fn read_ec(&self, base: u16, reg: u8) -> Result<u8, String> {
        self.pio_outb(base + 5, reg)?;
        self.pio_inb(base + 6)
    }
}

fn ite_chip_name(id: u16) -> Option<&'static str> {
    Some(match id {
        0x8688 => "ITE IT8688E",
        0x8686 => "ITE IT8686E",
        0x8689 => "ITE IT8689E",
        0x8655 => "ITE IT8655E",
        0x8665 => "ITE IT8665E",
        0x8628 => "ITE IT8628E",
        0x8620 => "ITE IT8620E",
        0x8792 => "ITE IT8792E",
        0x8795 => "ITE IT87952E",
        0x8728 => "ITE IT8728F",
        0x8721 => "ITE IT8721F",
        0x8613 => "ITE IT8613E",
        _ => return None,
    })
}

pub fn read_pawnio_superio() -> Result<Option<ProviderFrame>, String> {
    if !crate::native::elevated() {
        return Ok(None);
    }
    let sess = PawnIoLpcSession::open()?;
    let mut frame = ProviderFrame::default();
    let mut chips_found = Vec::new();

    for slot in 0..2u64 {
        if sess.select_slot(slot).is_err() {
            continue;
        }
        let Ok(chip_id) = sess.superio_inw(0x20) else {
            continue;
        };
        if let Some(chip_name) = ite_chip_name(chip_id) {
            if sess.superio_outb(0x07, 0x04).is_err() {
                continue;
            }
            if sess.superio_inb(0x30).unwrap_or(0) & 1 == 0 {
                continue;
            }
            let base = sess.superio_inw(0x60).unwrap_or(0) & 0xFFF8;
            if base < 0x100 || base == 0xFFF8 {
                continue;
            }
            chips_found.push(format!("{chip_name} @ 0x{base:04X}"));
            let fan_regs: &[(u8, u8, Option<u8>)] = match chip_id {
                0x8688 | 0x8689 => &[
                    (0x0D, 0x18, Some(0x63)),
                    (0x0E, 0x19, Some(0x6B)),
                    (0x0F, 0x1A, Some(0x73)),
                    (0x80, 0x81, Some(0x7B)),
                    (0x82, 0x83, Some(0xA3)),
                    (0x4C, 0x4D, None),
                ],
                _ => &[
                    (0x0D, 0x18, Some(0x63)),
                    (0x0E, 0x19, Some(0x6B)),
                    (0x0F, 0x1A, Some(0x73)),
                    (0x80, 0x81, Some(0x7B)),
                    (0x82, 0x83, Some(0xA3)),
                ],
            };
            for (idx, &(lsb_r, msb_r, pwm_r)) in fan_regs.iter().enumerate() {
                let lsb = sess.read_ec(base, lsb_r).unwrap_or(0xFF);
                let msb = sess.read_ec(base, msb_r).unwrap_or(0xFF);
                let raw = (u32::from(msb) << 8) | u32::from(lsb);
                let rpm = if raw > 0 && raw < 0xFFFF {
                    1_350_000 / (raw * 2)
                } else {
                    0
                };
                let pwm = pwm_r
                    .and_then(|pr| sess.read_ec(base, pr).ok())
                    .map(|v| ((f64::from(v) / 255.0) * 100.0).round());
                // Only report populated headers (nonzero RPM or valid active PWM)
                if rpm > 0 || (idx < 3 && pwm.is_some_and(|p| p > 0.0 && p < 100.0)) {
                    frame.fans.push(ProviderFan {
                        id: format!("pawnio/sio/{slot}/fan/{}", idx + 1),
                        name: format!("Motherboard Fan #{}", idx + 1),
                        hardware: chip_name.into(),
                        category: "motherboard".into(),
                        rpm,
                        pwm_pct: pwm,
                    });
                }
            }
            for idx in 0..6u8 {
                if let Ok(raw) = sess.read_ec(base, 0x29 + idx) {
                    let temp = raw as i8;
                    if (8..=115).contains(&temp) {
                        frame.temperatures.push(ProviderTemp {
                            id: format!("pawnio/sio/{slot}/temp/{}", idx + 1),
                            name: format!("Board Temp #{}", idx + 1),
                            hardware: chip_name.into(),
                            category: "motherboard".into(),
                            value_c: f64::from(temp),
                            min_c: None,
                            max_c: None,
                        });
                    }
                }
            }
        }
    }

    if chips_found.is_empty() {
        Ok(None)
    } else {
        frame.detail = format!(
            "PawnIO SuperIO ({}): {} temps, {} fans",
            chips_found.join(", "),
            frame.temperatures.len(),
            frame.fans.len()
        );
        Ok(Some(frame))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_hwinfo_sm2_shared_memory_buffer() {
        // Build a synthetic HWiNFO_SENS_SM2 buffer with 1 sensor and 2 readings (Temp + Fan)
        let sensor_off = 44usize;
        let sensor_size = 264usize;
        let reading_off = sensor_off + sensor_size;
        let reading_size = 316usize;
        let mut buf = vec![0u8; reading_off + reading_size * 2];

        buf[0..4].copy_from_slice(&HWINFO_MAGIC.to_le_bytes());
        buf[4..8].copy_from_slice(&1u32.to_le_bytes());
        buf[20..24].copy_from_slice(&(sensor_off as u32).to_le_bytes());
        buf[24..28].copy_from_slice(&(sensor_size as u32).to_le_bytes());
        buf[28..32].copy_from_slice(&1u32.to_le_bytes());
        buf[32..36].copy_from_slice(&(reading_off as u32).to_le_bytes());
        buf[36..40].copy_from_slice(&(reading_size as u32).to_le_bytes());
        buf[40..44].copy_from_slice(&2u32.to_le_bytes());

        // Sensor 0: GIGABYTE B550 AORUS MASTER (ITE IT8688E)
        let s_name = b"GIGABYTE B550 AORUS MASTER (ITE IT8688E)";
        buf[sensor_off + 8..sensor_off + 8 + s_name.len()].copy_from_slice(s_name);

        // Reading 0: Temp = 42.5 C (VRM MOS)
        let r0 = reading_off;
        buf[r0..r0 + 4].copy_from_slice(&1u32.to_le_bytes());
        buf[r0 + 4..r0 + 8].copy_from_slice(&0u32.to_le_bytes());
        buf[r0 + 8..r0 + 12].copy_from_slice(&100u32.to_le_bytes());
        buf[r0 + 12..r0 + 19].copy_from_slice(b"VRM MOS");
        buf[r0 + 268..r0 + 269].copy_from_slice(b"C");
        buf[r0 + 284..r0 + 292].copy_from_slice(&42.5f64.to_le_bytes());

        // Reading 1: Fan = 2150 RPM (AIO Pump)
        let r1 = reading_off + reading_size;
        buf[r1..r1 + 4].copy_from_slice(&3u32.to_le_bytes());
        buf[r1 + 4..r1 + 8].copy_from_slice(&0u32.to_le_bytes());
        buf[r1 + 8..r1 + 12].copy_from_slice(&200u32.to_le_bytes());
        buf[r1 + 12..r1 + 20].copy_from_slice(b"AIO Pump");
        buf[r1 + 268..r1 + 271].copy_from_slice(b"RPM");
        buf[r1 + 284..r1 + 292].copy_from_slice(&2150.0f64.to_le_bytes());

        let parsed = parse_hwinfo_sm2_bytes(&buf).expect("parse HWiNFO SM2");
        assert_eq!(parsed.temperatures.len(), 1);
        assert_eq!(parsed.temperatures[0].name, "VRM MOS");
        assert_eq!(parsed.temperatures[0].value_c, 42.5);
        assert_eq!(parsed.fans.len(), 1);
        assert_eq!(parsed.fans[0].name, "AIO Pump");
        assert_eq!(parsed.fans[0].rpm, 2150);
    }
}
