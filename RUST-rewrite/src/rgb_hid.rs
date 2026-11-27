use crate::rgb_studio::{RgbBackend, RgbColor, RgbDeviceInfo, RgbEffect, RgbModeInfo, RgbZoneInfo};
use std::{
    ffi::OsString,
    os::windows::ffi::{OsStrExt, OsStringExt},
    ptr,
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Devices::{
        DeviceAndDriverInstallation::{
            DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, SP_DEVICE_INTERFACE_DATA,
            SP_DEVICE_INTERFACE_DETAIL_DATA_W, SetupDiDestroyDeviceInfoList,
            SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW, SetupDiGetDeviceInterfaceDetailW,
        },
        HumanInterfaceDevice::{
            HIDD_ATTRIBUTES, HIDP_CAPS, HidD_FreePreparsedData, HidD_GetAttributes,
            HidD_GetFeature, HidD_GetHidGuid, HidD_GetPreparsedData, HidD_GetProductString,
            HidD_SetFeature, HidP_GetCaps,
        },
    },
    Foundation::{CloseHandle, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE},
    Storage::FileSystem::{CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING},
};

const GIGABYTE_ITE_VID: u16 = 0x048D;
const RAZER_VID: u16 = 0x1532;

const FUSION2_REPORT_ID: u8 = 0xCC;
const FUSION2_BUF_LEN: usize = 64;

const FUSION2_HDR_D_LED1: u8 = 5;
const FUSION2_HDR_D_LED2: u8 = 6;
const FUSION2_HDR_D_LED1_ARGB: u8 = 0x58;
const FUSION2_HDR_D_LED2_ARGB: u8 = 0x59;

const FUSION2_EFFECT_STATIC: u8 = 1;
const FUSION2_EFFECT_PULSE: u8 = 2;
const FUSION2_EFFECT_BLINKING: u8 = 3;
const FUSION2_EFFECT_COLORCYCLE: u8 = 4;
const FUSION2_EFFECT_WAVE: u8 = 6;

// =============================================================================
// PURE WIN32 HID TRANSPORT
// =============================================================================

#[derive(Debug, Clone)]
pub struct HidDeviceEntry {
    pub path: String,
    pub vid: u16,
    pub pid: u16,
    pub usage_page: u16,
    pub usage: u16,
    pub feature_len: usize,
    pub product: String,
}

pub struct HidHandle(HANDLE);

// Win32 file/HID handles are thread-safe when synchronized behind Mutex<RgbInner>.
unsafe impl Send for HidHandle {}

impl HidHandle {
    pub fn open(path: &str, read_write: bool) -> Result<Self, String> {
        let wide: Vec<u16> = OsString::from(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let access = if read_write {
            GENERIC_READ | GENERIC_WRITE
        } else {
            0
        };
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            if read_write {
                // Windows keyboard/mouse HID paths disallow GENERIC_READ|WRITE but still allow
                // HidD_SetFeature / HidD_GetFeature control transfers with dwDesiredAccess = 0.
                return Self::open(path, false);
            }
            return Err(format!("Could not open HID device path: {path}"));
        }
        Ok(Self(handle))
    }

    pub fn set_feature(&self, report: &[u8]) -> Result<(), String> {
        let ok = unsafe { HidD_SetFeature(self.0, report.as_ptr().cast(), report.len() as u32) };
        if !ok {
            Err(format!(
                "HidD_SetFeature failed (OS error {})",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }

    pub fn get_feature(&self, report: &mut [u8]) -> Result<(), String> {
        let ok =
            unsafe { HidD_GetFeature(self.0, report.as_mut_ptr().cast(), report.len() as u32) };
        if !ok {
            Err(format!(
                "HidD_GetFeature failed (OS error {})",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }
}

impl Drop for HidHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

fn read_hid_string(
    func: unsafe extern "system" fn(HANDLE, *mut core::ffi::c_void, u32) -> bool,
    h: HANDLE,
) -> String {
    let mut buf = [0u16; 128];
    let ok = unsafe { func(h, buf.as_mut_ptr().cast(), (buf.len() * 2) as u32) };
    if !ok {
        return String::new();
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    OsString::from_wide(&buf[..len])
        .to_string_lossy()
        .trim()
        .to_owned()
}

pub fn enumerate_hid_devices() -> Vec<HidDeviceEntry> {
    let mut result = Vec::new();
    unsafe {
        let mut hid_guid = std::mem::zeroed();
        HidD_GetHidGuid(&mut hid_guid);
        let dev_info = SetupDiGetClassDevsW(
            &hid_guid,
            ptr::null(),
            ptr::null_mut(),
            DIGCF_PRESENT | DIGCF_DEVICEINTERFACE,
        );
        if dev_info == INVALID_HANDLE_VALUE as isize || dev_info == 0 {
            return result;
        }
        let mut idx = 0u32;
        loop {
            let mut iface_data: SP_DEVICE_INTERFACE_DATA = std::mem::zeroed();
            iface_data.cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32;
            if SetupDiEnumDeviceInterfaces(
                dev_info,
                ptr::null(),
                &hid_guid,
                idx,
                &mut iface_data,
            ) == 0
            {
                break;
            }
            idx += 1;

            let mut required = 0u32;
            SetupDiGetDeviceInterfaceDetailW(
                dev_info,
                &iface_data,
                ptr::null_mut(),
                0,
                &mut required,
                ptr::null_mut(),
            );
            let min_size = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
            if required < min_size || required > 8192 {
                continue;
            }
            let mut detail_buf = vec![0u32; (required as usize).div_ceil(4)];
            let detail_ptr = detail_buf.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
            // On 64-bit Windows SP_DEVICE_INTERFACE_DETAIL_DATA_W::cbSize must be 8 (6 on 32-bit).
            (*detail_ptr).cbSize = if cfg!(target_pointer_width = "64") {
                8
            } else {
                6
            };
            if SetupDiGetDeviceInterfaceDetailW(
                dev_info,
                &iface_data,
                detail_ptr,
                required,
                ptr::null_mut(),
                ptr::null_mut(),
            ) == 0
            {
                continue;
            }
            let path_offset = std::mem::offset_of!(SP_DEVICE_INTERFACE_DETAIL_DATA_W, DevicePath);
            let max_chars = (required as usize).saturating_sub(path_offset) / 2;
            let path_ptr = ptr::addr_of!((*detail_ptr).DevicePath) as *const u16;
            let mut len = 0usize;
            while len < max_chars && *path_ptr.add(len) != 0 {
                len += 1;
            }
            let path = OsString::from_wide(std::slice::from_raw_parts(path_ptr, len))
                .to_string_lossy()
                .into_owned();

            // Open with 0 access for metadata query — always succeeds for present HID collections.
            let Ok(handle) = HidHandle::open(&path, false) else {
                continue;
            };
            let mut attrs: HIDD_ATTRIBUTES = std::mem::zeroed();
            attrs.Size = std::mem::size_of::<HIDD_ATTRIBUTES>() as u32;
            if !HidD_GetAttributes(handle.0, &mut attrs) {
                continue;
            }
            let mut preparsed = 0isize;
            let (mut usage_page, mut usage, mut feature_len) = (0, 0, 0);
            if HidD_GetPreparsedData(handle.0, &mut preparsed) && preparsed != 0 {
                let mut caps: HIDP_CAPS = std::mem::zeroed();
                if HidP_GetCaps(preparsed, &mut caps) >= 0 {
                    usage_page = caps.UsagePage;
                    usage = caps.Usage;
                    feature_len = caps.FeatureReportByteLength as usize;
                }
                HidD_FreePreparsedData(preparsed);
            }
            let product = read_hid_string(HidD_GetProductString, handle.0);

            result.push(HidDeviceEntry {
                path,
                vid: attrs.VendorID,
                pid: attrs.ProductID,
                usage_page,
                usage,
                feature_len,
                product,
            });
        }
        SetupDiDestroyDeviceInfoList(dev_info);
    }
    result
}

// =============================================================================
// GIGABYTE RGB FUSION 2.0 USB HID DRIVER (ITE IT5702 / IT8297 / IT5711)
// =============================================================================

#[derive(Debug, Clone)]
pub struct GigabyteZoneDef {
    pub name: &'static str,
    pub led_idx: u8,
    pub led_count: u32,
}

pub struct GigabyteFusion2Device {
    pub id: String,
    pub name: String,
    pub description: String,
    pub pid: u16,
    pub zones: Vec<GigabyteZoneDef>,
    handle: HidHandle,
    cal_strip0: u32,
    cal_strip1: u32,
    strip_builtin_enabled: Option<bool>,
    argb_len_configured: bool,
}

fn gigabyte_parse_cal_order(cal: u32) -> (usize, usize, usize) {
    let b = (cal & 0xFF) as usize;
    let g = ((cal >> 8) & 0xFF) as usize;
    let r = ((cal >> 16) & 0xFF) as usize;
    if r < 3 && g < 3 && b < 3 && r != g && r != b && g != b {
        (r, g, b)
    } else {
        // Default GRB order for WS2812B ARGB strips
        (1, 0, 2)
    }
}

fn gigabyte_build_effect_packet(
    led_idx: u8,
    effect_type: u8,
    color: RgbColor,
    brightness: u8,
    speed: u8,
) -> [u8; FUSION2_BUF_LEN] {
    let mut buf = [0u8; FUSION2_BUF_LEN];
    buf[0] = FUSION2_REPORT_ID;
    buf[1] = if led_idx < 8 {
        0x20 + led_idx
    } else {
        0x90 + (led_idx - 8)
    };
    let zone_mask: u32 = 1u32 << (led_idx.min(15));
    buf[2..6].copy_from_slice(&zone_mask.to_le_bytes());
    buf[11] = effect_type;
    buf[12] = brightness;
    buf[13] = 0; // min_brightness
    // color0 is 0x00RRGGBB in little-endian => [B, G, R, 0]
    let color0: u32 = ((color.r as u32) << 16) | ((color.g as u32) << 8) | (color.b as u32);
    buf[14..18].copy_from_slice(&color0.to_le_bytes());
    let sp = ((100u16.saturating_sub(speed as u16)) / 10).min(10);
    match effect_type {
        FUSION2_EFFECT_PULSE => {
            let p: u16 = if sp <= 6 {
                400 + sp * 100
            } else {
                1000 + (sp - 6) * 200
            };
            buf[22..24].copy_from_slice(&p.to_le_bytes());
            buf[24..26].copy_from_slice(&p.to_le_bytes());
            buf[26..28].copy_from_slice(&200u16.to_le_bytes());
        }
        FUSION2_EFFECT_BLINKING => {
            buf[22..24].copy_from_slice(&100u16.to_le_bytes());
            buf[24..26].copy_from_slice(&100u16.to_le_bytes());
            let hold = sp * 200 + 700;
            buf[26..28].copy_from_slice(&hold.to_le_bytes());
        }
        FUSION2_EFFECT_COLORCYCLE => {
            let p0 = sp * 100 + 300;
            let p1 = p0.saturating_sub(200);
            buf[22..24].copy_from_slice(&p0.to_le_bytes());
            buf[24..26].copy_from_slice(&p1.to_le_bytes());
            buf[30] = 7; // effect_param0: cycle colors
        }
        FUSION2_EFFECT_WAVE => {
            let p0 = ((sp + 1) * (sp + 1) + (sp + 1) + 10) * 5 / 2;
            buf[22..24].copy_from_slice(&p0.to_le_bytes());
            buf[30] = 7;
            buf[31] = 1;
        }
        _ => {}
    }
    buf
}

fn gigabyte_build_strip_packets(
    argb_header: u8,
    colors: &[RgbColor],
    cal: u32,
) -> Vec<[u8; FUSION2_BUF_LEN]> {
    let (bo_r, bo_g, bo_b) = gigabyte_parse_cal_order(cal);
    let mut packets = Vec::new();
    let mut offset_leds = 0usize;
    while offset_leds < colors.len() {
        let chunk = (colors.len() - offset_leds).min(19);
        let mut pkt = [0u8; FUSION2_BUF_LEN];
        pkt[0] = FUSION2_REPORT_ID;
        pkt[1] = argb_header;
        let boffset = (offset_leds * 3) as u16;
        pkt[2..4].copy_from_slice(&boffset.to_le_bytes());
        pkt[4] = (chunk * 3) as u8;
        for i in 0..chunk {
            let c = colors[offset_leds + i];
            let base = 5 + i * 3;
            pkt[base + bo_r] = c.r;
            pkt[base + bo_g] = c.g;
            pkt[base + bo_b] = c.b;
        }
        packets.push(pkt);
        offset_leds += chunk;
    }
    packets
}

impl GigabyteFusion2Device {
    pub fn probe(entry: &HidDeviceEntry, index: u32) -> Option<Self> {
        if entry.vid != GIGABYTE_ITE_VID {
            return None;
        }
        if !matches!(entry.pid, 0x5702 | 0x5711 | 0x8297 | 0x8950 | 0xA100) {
            return None;
        }
        if entry.feature_len < FUSION2_BUF_LEN {
            return None;
        }
        // Gigabyte IT5702/IT8297 exposes COL01 (usage_page 0xFF89, usage 0xCC) for RGB Fusion 2.0
        if entry.usage_page != 0xFF89 && entry.usage != 0xCC {
            return None;
        }

        let handle = HidHandle::open(&entry.path, true).ok()?;

        // Send 0xCC 0x60 to read IT8297Report hardware info & factory color calibration
        let mut req = [0u8; FUSION2_BUF_LEN];
        req[0] = FUSION2_REPORT_ID;
        req[1] = 0x60;
        handle.set_feature(&req).ok()?;

        let mut resp = [0u8; FUSION2_BUF_LEN];
        resp[0] = FUSION2_REPORT_ID;
        handle.get_feature(&mut resp).ok()?;

        let fw_ver = u32::from_le_bytes([resp[4], resp[5], resp[6], resp[7]]);
        let fw_version = format!(
            "{}.{}.{}.{}",
            fw_ver & 0xFF,
            (fw_ver >> 8) & 0xFF,
            (fw_ver >> 16) & 0xFF,
            (fw_ver >> 24) & 0xFF
        );
        let support_cmd_flag = resp[11];
        let prod_bytes = &resp[12..40];
        let nul = prod_bytes.iter().position(|&b| b == 0).unwrap_or(prod_bytes.len());
        let chip_product = String::from_utf8_lossy(&prod_bytes[..nul]).trim().to_owned();

        let cal_strip0 = u32::from_le_bytes([resp[44], resp[45], resp[46], resp[47]]);
        let cal_strip1 = u32::from_le_bytes([resp[48], resp[49], resp[50], resp[51]]);
        let chip_id_val = u32::from_le_bytes([resp[56], resp[57], resp[58], resp[59]]);
        let chip_id = format!("0x{chip_id_val:08X}");

        let board_name = read_motherboard_name().unwrap_or_else(|| {
            if !chip_product.is_empty() {
                chip_product.clone()
            } else {
                format!("Gigabyte RGB Fusion 2.0 (PID 0x{:04X})", entry.pid)
            }
        });

        let dev = Self {
            id: format!("hid:gigabyte:{index}"),
            name: board_name,
            description: format!(
                "ITE IT{:04X} USB HID · FW {} · Chip {}",
                entry.pid, fw_version, chip_id
            ),
            pid: entry.pid,
            zones: vec![
                GigabyteZoneDef {
                    name: "D_LED1 (ARGB Header 1)",
                    led_idx: FUSION2_HDR_D_LED1,
                    led_count: 32,
                },
                GigabyteZoneDef {
                    name: "D_LED2 (ARGB Header 2)",
                    led_idx: FUSION2_HDR_D_LED2,
                    led_count: 32,
                },
                GigabyteZoneDef {
                    name: "I/O Cover / Onboard",
                    led_idx: 0,
                    led_count: 1,
                },
                GigabyteZoneDef {
                    name: "LED_C1 (12V RGB Header 1)",
                    led_idx: 1,
                    led_count: 1,
                },
                GigabyteZoneDef {
                    name: "LED_CPU (CPU Cooler RGB)",
                    led_idx: 2,
                    led_count: 1,
                },
                GigabyteZoneDef {
                    name: "LED_C2 (12V RGB Header 2)",
                    led_idx: 4,
                    led_count: 1,
                },
            ],
            handle,
            cal_strip0,
            cal_strip1,
            strip_builtin_enabled: None,
            argb_len_configured: false,
        };

        // Match OpenRGB's safe initialization sequence (does NOT erase calibration or flash):
        if (support_cmd_flag & 0x02) != 0 {
            let _ = dev.send_cc(0x48, 0x00, 0x00); // Disable firmware LampArray lock
        }
        let _ = dev.send_cc(0x31, 0x00, 0x00); // Disable Beat/Audio mode
        Some(dev)
    }

    fn send_cc(&self, a: u8, b: u8, c: u8) -> Result<(), String> {
        let mut buf = [0u8; FUSION2_BUF_LEN];
        buf[0] = FUSION2_REPORT_ID;
        buf[1] = a;
        buf[2] = b;
        buf[3] = c;
        self.handle.set_feature(&buf)
    }

    fn set_strip_builtin(&mut self, enable: bool) -> Result<(), String> {
        if self.strip_builtin_enabled == Some(enable) {
            return Ok(());
        }
        // 0x00 = enable built-in hardware effect on D_LED1/D_LED2; 0x03 = disable for Direct ARGB streaming
        let mask: u8 = if enable {
            0x00
        } else if self.pid == 0x5711 {
            0x01 | 0x02 | 0x08 | 0x10 | 0x20 | 0x40
        } else {
            0x01 | 0x02
        };
        self.send_cc(0x32, mask, 0x00)?;
        self.strip_builtin_enabled = Some(enable);
        thread::sleep(Duration::from_millis(50));
        Ok(())
    }

    fn ensure_argb_led_count(&mut self) -> Result<(), String> {
        if self.argb_len_configured {
            return Ok(());
        }
        // Set D_LED1 & D_LED2 division to LEDS_64 (enum value 1) so 32-64 LED fans/strips render cleanly
        let mut buf = [0u8; FUSION2_BUF_LEN];
        buf[0] = FUSION2_REPORT_ID;
        buf[1] = 0x34;
        buf[2] = (1u8 << 4) | 1u8;
        self.handle.set_feature(&buf)?;
        self.argb_len_configured = true;
        Ok(())
    }

    fn apply_all(&self) -> Result<(), String> {
        if self.pid == 0x5711 {
            self.send_cc(0x28, 0xFF, 0x07)
        } else {
            self.send_cc(0x28, 0xFF, 0x00)
        }
    }

    pub fn set_solid_all(&mut self, color: RgbColor, brightness_pct: u8) -> Result<(), String> {
        // Using hardware Static mode on D_LED1/D_LED2 (indices 5 & 6) + onboard LEDs (0..=7)
        // reliably lights EVERY LED on any ARGB fan hub or strip regardless of LED count!
        self.set_strip_builtin(true)?;
        let hw_bright = ((brightness_pct.min(100) as u16 * 255) / 100) as u8;
        let scaled = if hw_bright == 0 { RgbColor::BLACK } else { color };
        for led_idx in 0u8..8u8 {
            let pkt = gigabyte_build_effect_packet(
                led_idx,
                FUSION2_EFFECT_STATIC,
                scaled,
                hw_bright.max(if scaled == RgbColor::BLACK { 0 } else { 1 }),
                50,
            );
            self.handle.set_feature(&pkt)?;
        }
        self.apply_all()
    }

    pub fn set_rainbow_frame(&mut self, phase: f32, brightness_pct: u8) -> Result<(), String> {
        self.ensure_argb_led_count()?;
        self.set_strip_builtin(false)?;
        let val = (brightness_pct.min(100) as f32) / 100.0;
        let master = RgbColor::from_hsv((phase * 60.0) % 360.0, 1.0, val);
        // Onboard single-LED zones follow master hue
        for led_idx in [0u8, 1, 2, 3, 4, 7] {
            let pkt = gigabyte_build_effect_packet(led_idx, FUSION2_EFFECT_STATIC, master, 255, 50);
            let _ = self.handle.set_feature(&pkt);
        }
        let _ = self.apply_all();
        // Addressable ARGB headers get smooth per-LED rainbow wave
        let strip_colors: Vec<RgbColor> = (0..32)
            .map(|i| {
                let hue = (phase * 60.0 + (i as f32) * (360.0 / 32.0)) % 360.0;
                RgbColor::from_hsv(hue, 1.0, val)
            })
            .collect();
        for pkt in gigabyte_build_strip_packets(FUSION2_HDR_D_LED1_ARGB, &strip_colors, self.cal_strip0)
        {
            self.handle.set_feature(&pkt)?;
        }
        for pkt in gigabyte_build_strip_packets(FUSION2_HDR_D_LED2_ARGB, &strip_colors, self.cal_strip1)
        {
            self.handle.set_feature(&pkt)?;
        }
        Ok(())
    }

    pub fn set_zone_color(
        &mut self,
        zone_index: Option<usize>,
        color: RgbColor,
        brightness_pct: u8,
    ) -> Result<(), String> {
        let Some(zi) = zone_index else {
            return self.set_solid_all(color, brightness_pct);
        };
        let Some(zone) = self.zones.get(zi).cloned() else {
            return Err("Invalid Gigabyte zone index.".into());
        };
        self.set_strip_builtin(true)?;
        let hw_bright = ((brightness_pct.min(100) as u16 * 255) / 100) as u8;
        let pkt = gigabyte_build_effect_packet(
            zone.led_idx,
            FUSION2_EFFECT_STATIC,
            color,
            hw_bright,
            50,
        );
        self.handle.set_feature(&pkt)?;
        let mut apply = [0u8; FUSION2_BUF_LEN];
        apply[0] = FUSION2_REPORT_ID;
        apply[1] = 0x28;
        let mask: u32 = 1u32 << (zone.led_idx.min(15));
        apply[2..6].copy_from_slice(&mask.to_le_bytes());
        self.handle.set_feature(&apply)
    }

    pub fn set_hardware_mode(
        &mut self,
        mode_idx: usize,
        color: RgbColor,
        brightness_pct: u8,
        speed: u8,
    ) -> Result<(), String> {
        let eff = match mode_idx {
            0 => FUSION2_EFFECT_STATIC,
            1 => FUSION2_EFFECT_PULSE,
            2 => FUSION2_EFFECT_COLORCYCLE,
            3 => FUSION2_EFFECT_WAVE,
            4 => FUSION2_EFFECT_BLINKING,
            _ => FUSION2_EFFECT_STATIC,
        };
        self.set_strip_builtin(true)?;
        let hw_bright = if mode_idx == 5 {
            0
        } else {
            ((brightness_pct.min(100) as u16 * 255) / 100) as u8
        };
        let col = if mode_idx == 5 { RgbColor::BLACK } else { color };
        for led_idx in 0u8..8u8 {
            let pkt = gigabyte_build_effect_packet(led_idx, eff, col, hw_bright, speed);
            self.handle.set_feature(&pkt)?;
        }
        self.apply_all()
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        let modes = vec![
            RgbModeInfo { index: 0, name: "Static".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 1, name: "Pulse / Breathe".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 2, name: "Color Cycle".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 3, name: "Digital Wave".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 4, name: "Blinking".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 5, name: "Off".into(), raw_bytes: Vec::new() },
        ];
        let active_mode_name = modes
            .get(active_mode)
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "Static".into());
        let zones: Vec<RgbZoneInfo> = self
            .zones
            .iter()
            .enumerate()
            .map(|(i, z)| RgbZoneInfo {
                index: i,
                name: z.name.to_owned(),
                led_count: z.led_count,
            })
            .collect();
        let led_count = zones.iter().map(|z| z.led_count as usize).sum();
        RgbDeviceInfo {
            id: self.id.clone(),
            backend: RgbBackend::DirectHid,
            index: 0,
            device_type: "Motherboard".into(),
            icon: "📟".into(),
            name: self.name.clone(),
            vendor: "Gigabyte RGB Fusion 2.0 (Native HID)".into(),
            description: self.description.clone(),
            led_count,
            active_mode_index: active_mode,
            active_mode_name,
            modes,
            zones,
            preview_hex: preview_hex.to_owned(),
            lamp_array_id: None,
        }
    }

    pub fn diagnostic_info(&self) -> serde_json::Value {
        fn decode_cal(cal: u32) -> String {
            let (r, g, b) = gigabyte_parse_cal_order(cal);
            let mut s = *b"???";
            s[r] = b'R';
            s[g] = b'G';
            s[b] = b'B';
            String::from_utf8_lossy(&s).into_owned()
        }
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "pid": format!("0x{:04X}", self.pid),
            "description": self.description,
            "calStrip0": decode_cal(self.cal_strip0),
            "calStrip1": decode_cal(self.cal_strip1),
            "stripBuiltinEnabled": self.strip_builtin_enabled,
        })
    }
}

pub fn check_win11_lighting_conflict_for_razer_pid(pid: u16) -> bool {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(devs) = hkcu.open_subkey(r"Software\Microsoft\Lighting\Devices") else {
        return false;
    };
    let needle = format!("VID_1532&PID_{pid:04X}");
    for key_name in devs.enum_keys().flatten() {
        if key_name.to_ascii_uppercase().contains(&needle)
            && let Ok(sub) = devs.open_subkey(&key_name)
        {
            let enabled: u32 = sub.get_value("AmbientLightingEnabled").unwrap_or(0);
            if enabled != 0 {
                return true;
            }
        }
    }
    false
}

fn read_motherboard_name() -> Option<String> {
    use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey(r"HARDWARE\DESCRIPTION\System\BIOS")
        .ok()?;
    let mfr: String = key.get_value("BaseBoardManufacturer").unwrap_or_default();
    let prod: String = key.get_value("BaseBoardProduct").unwrap_or_default();
    let combined = format!("{} {}", mfr.trim(), prod.trim()).trim().to_owned();
    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

// =============================================================================
// RAZER CHROMA USB HID DRIVER (90-byte + Report ID = 91-byte Feature Reports)
// =============================================================================

const RAZER_REPORT_LEN: usize = 91;

#[derive(Debug, Clone, Copy)]
struct RazerDeviceSpec {
    pid: u16,
    name: &'static str,
    device_type: &'static str,
    icon: &'static str,
    transaction_id: u8,
    led_id: u8,
    rows: u8,
    cols: u8,
    max_brightness: u8,
    single_color: bool,
}

const RAZER_SPECS: &[RazerDeviceSpec] = &[
    RazerDeviceSpec {
        pid: 0x026B,
        name: "Razer Huntsman V2 TKL",
        device_type: "Keyboard",
        icon: "⌨️",
        transaction_id: 0x3F,
        led_id: 0x05, // RAZER_LED_ID_BACKLIGHT
        rows: 6,
        cols: 17,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x026C,
        name: "Razer Huntsman V2",
        device_type: "Keyboard",
        icon: "⌨️",
        transaction_id: 0x3F,
        led_id: 0x05,
        rows: 6,
        cols: 22,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x0257,
        name: "Razer Huntsman Mini",
        device_type: "Keyboard",
        icon: "⌨️",
        transaction_id: 0x3F,
        led_id: 0x05,
        rows: 5,
        cols: 15,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x0243,
        name: "Razer Huntsman TE",
        device_type: "Keyboard",
        icon: "⌨️",
        transaction_id: 0x3F,
        led_id: 0x05,
        rows: 6,
        cols: 18,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x024E,
        name: "Razer BlackWidow V3",
        device_type: "Keyboard",
        icon: "⌨️",
        transaction_id: 0x3F,
        led_id: 0x05,
        rows: 6,
        cols: 22,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x0071,
        name: "Razer DeathAdder Essential (White)",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x3F,
        led_id: 0x05,
        rows: 1,
        cols: 2,
        max_brightness: 255,
        single_color: true,
    },
    RazerDeviceSpec {
        pid: 0x006E,
        name: "Razer DeathAdder Essential",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x3F,
        led_id: 0x05,
        rows: 1,
        cols: 2,
        max_brightness: 255,
        single_color: true,
    },
    RazerDeviceSpec {
        pid: 0x0098,
        name: "Razer DeathAdder Essential V2",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x1F,
        led_id: 0x05,
        rows: 1,
        cols: 2,
        max_brightness: 100,
        single_color: true,
    },
    RazerDeviceSpec {
        pid: 0x0084,
        name: "Razer DeathAdder V2",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x3F,
        led_id: 0x00,
        rows: 1,
        cols: 2,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x0078,
        name: "Razer Viper",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x3F,
        led_id: 0x04,
        rows: 1,
        cols: 1,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x008A,
        name: "Razer Viper Mini",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x1F,
        led_id: 0x00,
        rows: 1,
        cols: 1,
        max_brightness: 255,
        single_color: false,
    },
    RazerDeviceSpec {
        pid: 0x0099,
        name: "Razer Basilisk V3",
        device_type: "Mouse",
        icon: "🖱️",
        transaction_id: 0x1F,
        led_id: 0x00,
        rows: 1,
        cols: 11,
        max_brightness: 255,
        single_color: false,
    },
];

pub fn razer_build_report(
    transaction_id: u8,
    command_class: u8,
    command_id: u8,
    args: &[u8],
) -> [u8; RAZER_REPORT_LEN] {
    let mut r = [0u8; RAZER_REPORT_LEN];
    r[0] = 0x00; // HID report_id
    r[1] = 0x00; // status = NEW
    r[2] = transaction_id;
    r[3] = 0x00; // remaining_packets lo
    r[4] = 0x00; // remaining_packets hi
    r[5] = 0x00; // protocol_type
    let copy_len = args.len().min(80);
    r[6] = copy_len as u8;
    r[7] = command_class;
    r[8] = command_id;
    r[9..9 + copy_len].copy_from_slice(&args[..copy_len]);
    let mut crc = 0u8;
    for &b in &r[3..89] {
        crc ^= b;
    }
    r[89] = crc;
    r[90] = 0x00;
    r
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RazerAppliedState {
    Off,
    Static {
        color: RgbColor,
        brightness_pct: u8,
    },
    HardwareBreathing {
        brightness_pct: u8,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RazerSingleColorAction {
    Off,
    HardwareBreathing(u8),
    Static(u8),
}

/// Maps any high-level studio effect onto a safe single-write hardware action for
/// VARSTORE-backed monochrome Razer mice (e.g. DeathAdder Essential) so 15 Hz
/// animations never hammer their non-volatile EEPROM.
pub(crate) fn razer_single_color_plan(
    effect: RgbEffect,
    base_brightness_pct: u8,
) -> RazerSingleColorAction {
    let clamped = base_brightness_pct.min(100);
    if effect == RgbEffect::Blackout || clamped == 0 {
        RazerSingleColorAction::Off
    } else if effect == RgbEffect::Breathing {
        RazerSingleColorAction::HardwareBreathing(clamped)
    } else {
        RazerSingleColorAction::Static(clamped)
    }
}

pub struct RazerHidDevice {
    pub id: String,
    pub pid: u16,
    pub name: String,
    pub device_type: String,
    pub icon: String,
    pub firmware: String,
    pub rows: u8,
    pub cols: u8,
    pub single_color: bool,
    win11_conflict: bool,
    last_applied: Option<RazerAppliedState>,
    transaction_id: u8,
    led_id: u8,
    max_brightness: u8,
    handle: HidHandle,
}

impl RazerHidDevice {
    pub fn probe_all(entries: &[HidDeviceEntry]) -> Vec<Self> {
        let mut found = Vec::new();
        let mut seen_pids = Vec::new();
        for entry in entries {
            if entry.vid != RAZER_VID {
                continue;
            }
            if entry.feature_len != RAZER_REPORT_LEN {
                continue;
            }
            // Skip Windows Dynamic Lighting LampArray collections (Usage Page 0x59)
            if entry.usage_page == 0x59 {
                continue;
            }
            if seen_pids.contains(&entry.pid) {
                continue;
            }
            let Ok(handle) = HidHandle::open(&entry.path, true) else {
                continue;
            };
            let spec = RAZER_SPECS.iter().find(|s| s.pid == entry.pid).copied();
            let candidate_tids: &[u8] = if let Some(s) = spec {
                if s.transaction_id == 0x3F {
                    &[0x3F, 0x1F, 0xFF]
                } else {
                    &[s.transaction_id, 0x3F, 0x1F]
                }
            } else {
                &[0x3F, 0x1F, 0xFF]
            };

            // Verify live communication using GetFirmwareVersion (0x00, 0x81, len 0x02)
            let mut active_tid = None;
            let mut fw_str = String::new();
            for &tid in candidate_tids {
                let req = razer_build_report(tid, 0x00, 0x81, &[0x00, 0x00]);
                if handle.set_feature(&req).is_ok() {
                    thread::sleep(Duration::from_millis(6));
                    let mut resp = [0u8; RAZER_REPORT_LEN];
                    if handle.get_feature(&mut resp).is_ok() && resp[1] == 0x02 {
                        active_tid = Some(tid);
                        fw_str = format!("v{}.{}", resp[9], resp[10]);
                        break;
                    }
                }
            }
            if active_tid.is_none()
                && let Some(s) = spec
            {
                let probe_req = razer_build_report(s.transaction_id, 0x00, 0x81, &[0, 0]);
                if handle.set_feature(&probe_req).is_ok() {
                    active_tid = Some(s.transaction_id);
                    fw_str = "Detected".into();
                }
            }
            let Some(tid) = active_tid else {
                continue;
            };
            seen_pids.push(entry.pid);

            let (name, dtype, icon, led_id, rows, cols, max_b, single_color) = if let Some(s) = spec {
                (
                    s.name.to_owned(),
                    s.device_type.to_owned(),
                    s.icon.to_owned(),
                    s.led_id,
                    s.rows,
                    s.cols,
                    s.max_brightness,
                    s.single_color,
                )
            } else {
                let fallback_name = if !entry.product.is_empty() {
                    entry.product.clone()
                } else {
                    format!("Razer Device (0x{:04X})", entry.pid)
                };
                (
                    fallback_name,
                    "Peripheral".to_owned(),
                    "✨".to_owned(),
                    0x05,
                    1,
                    1,
                    255,
                    false,
                )
            };

            let idx = found.len() as u32;
            let win11_conflict = check_win11_lighting_conflict_for_razer_pid(entry.pid);
            found.push(Self {
                id: format!("hid:razer:{:04x}:{idx}", entry.pid),
                pid: entry.pid,
                name,
                device_type: dtype,
                icon,
                firmware: fw_str,
                rows,
                cols,
                single_color,
                win11_conflict,
                last_applied: None,
                transaction_id: tid,
                led_id,
                max_brightness: max_b,
                handle,
            });
        }
        found
    }

    fn send(&self, class: u8, cmd: u8, args: &[u8]) -> Result<(), String> {
        let pkt = razer_build_report(self.transaction_id, class, cmd, args);
        self.handle.set_feature(&pkt)
    }

    fn query(&self, class: u8, cmd: u8, args: &[u8]) -> Result<[u8; RAZER_REPORT_LEN], String> {
        let pkt = razer_build_report(self.transaction_id, class, cmd, args);
        self.handle.set_feature(&pkt)?;
        let mut resp = [0u8; RAZER_REPORT_LEN];
        for _ in 0..8 {
            thread::sleep(Duration::from_millis(5));
            resp.fill(0);
            if self.handle.get_feature(&mut resp).is_err() {
                continue;
            }
            if resp[7] == class && resp[8] == cmd && resp[1] != 0x00 && resp[1] != 0x01 {
                return Ok(resp);
            }
        }
        Ok(resp)
    }

    fn storage_byte(&self) -> u8 {
        if self.single_color { 0x01 } else { 0x00 }
    }

    fn target_led_ids(&self) -> &'static [u8] {
        if self.single_color {
            if self.pid == 0x0098 {
                &[0x04] // DeathAdder Essential V2: Logo only
            } else {
                &[0x04, 0x01] // DeathAdder Essential / White Edition: Logo (0x04) + Scroll Wheel (0x01)
            }
        } else {
            // Non-single-color devices use their spec led_id
            &[]
        }
    }

    fn set_brightness(&self, brightness_pct: u8) -> Result<(), String> {
        let val = ((brightness_pct.min(100) as u16 * self.max_brightness as u16) / 100) as u8;
        let storage = self.storage_byte();
        let leds = self.target_led_ids();
        if !leds.is_empty() {
            for &led in leds {
                self.send(0x0F, 0x04, &[storage, led, val])?;
                thread::sleep(Duration::from_millis(4));
            }
            return Ok(());
        }
        // Extended Matrix Brightness (0x0F, 0x04, [storage=0, led_id, brightness])
        self.send(0x0F, 0x04, &[storage, self.led_id, val])
    }

    pub fn set_static(&mut self, color: RgbColor, brightness_pct: u8) -> Result<(), String> {
        let clamped = brightness_pct.min(100);
        if clamped == 0 || (!self.single_color && color == RgbColor::BLACK) {
            return self.set_off();
        }
        let target_color = if self.single_color {
            RgbColor { r: 0xFF, g: 0xFF, b: 0xFF }
        } else {
            color
        };
        let desired = RazerAppliedState::Static {
            color: target_color,
            brightness_pct: clamped,
        };
        if self.last_applied == Some(desired) {
            return Ok(());
        }
        let _ = self.set_brightness(clamped);
        thread::sleep(Duration::from_millis(4));
        let storage = self.storage_byte();
        if self.single_color {
            for &led in self.target_led_ids() {
                self.send(
                    0x0F,
                    0x02,
                    &[storage, led, 0x01, 0x00, 0x00, 0x01, 0xFF, 0xFF, 0xFF],
                )?;
                thread::sleep(Duration::from_millis(4));
            }
            self.last_applied = Some(desired);
            return Ok(());
        }
        self.send(
            0x0F,
            0x02,
            &[
                storage,
                self.led_id,
                0x01, // STATIC
                0x00,
                0x00,
                0x01, // 1 color
                target_color.r,
                target_color.g,
                target_color.b,
            ],
        )?;
        self.last_applied = Some(desired);
        Ok(())
    }

    fn set_single_color_breathing(&mut self, brightness_pct: u8) -> Result<(), String> {
        let clamped = brightness_pct.min(100);
        if clamped == 0 {
            return self.set_off();
        }
        let desired = RazerAppliedState::HardwareBreathing {
            brightness_pct: clamped,
        };
        if self.last_applied == Some(desired) {
            return Ok(());
        }
        let _ = self.set_brightness(clamped);
        thread::sleep(Duration::from_millis(4));
        let storage = self.storage_byte();
        for &led in self.target_led_ids() {
            self.send(
                0x0F,
                0x02,
                &[storage, led, 0x02, 0x01, 0x00, 0x01, 0xFF, 0xFF, 0xFF],
            )?;
            thread::sleep(Duration::from_millis(4));
        }
        self.last_applied = Some(desired);
        Ok(())
    }

    pub fn apply_effect(
        &mut self,
        effect: RgbEffect,
        color: RgbColor,
        base_brightness_pct: u8,
        frame_brightness_pct: u8,
        phase: f32,
    ) -> Result<(), String> {
        if self.single_color {
            // VARSTORE-backed monochrome mice: write hardware state ONCE per user change,
            // never on every 15 Hz software animation tick.
            return match razer_single_color_plan(effect, base_brightness_pct) {
                RazerSingleColorAction::Off => self.set_off(),
                RazerSingleColorAction::HardwareBreathing(b) => self.set_single_color_breathing(b),
                RazerSingleColorAction::Static(b) => {
                    self.set_static(RgbColor { r: 255, g: 255, b: 255 }, b)
                }
            };
        }
        match effect {
            RgbEffect::Blackout => self.set_off(),
            RgbEffect::Rainbow => self.set_rainbow_frame(phase, frame_brightness_pct),
            _ => self.set_static(color, frame_brightness_pct),
        }
    }

    pub fn diagnostic_readback(&self) -> serde_json::Value {
        let mode_resp = self.query(0x00, 0x84, &[0x00, 0x00]);
        let storage = self.storage_byte();
        let primary_led = self.target_led_ids().first().copied().unwrap_or(self.led_id);
        let bright_resp = self.query(0x0F, 0x84, &[storage, primary_led, 0x00]);
        let (mode_status, dev_mode) = match mode_resp {
            Ok(r) => (format!("0x{:02X}", r[1]), Some(r[9])),
            Err(e) => (e, None),
        };
        let (bright_status, bright_val) = match bright_resp {
            Ok(r) => (format!("0x{:02X}", r[1]), Some(r[11])),
            Err(e) => (e, None),
        };
        let scroll_readback = if self.target_led_ids().contains(&0x01) {
            match self.query(0x0F, 0x84, &[storage, 0x01, 0x00]) {
                Ok(r) => Some(serde_json::json!({
                    "ack": format!("0x{:02X}", r[1]),
                    "brightness": r[11],
                })),
                Err(_) => None,
            }
        } else {
            None
        };
        let win11_conflict = check_win11_lighting_conflict_for_razer_pid(self.pid);
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "pid": format!("0x{:04X}", self.pid),
            "firmware": self.firmware,
            "deviceModeAck": mode_status,
            "deviceMode": dev_mode,
            "brightnessAck": bright_status,
            "brightnessReadback": bright_val,
            "scrollBrightnessReadback": scroll_readback,
            "win11DynamicLightingConflict": win11_conflict,
        })
    }

    pub fn set_off(&mut self) -> Result<(), String> {
        if self.last_applied == Some(RazerAppliedState::Off) {
            return Ok(());
        }
        let storage = self.storage_byte();
        let leds = self.target_led_ids();
        if !leds.is_empty() {
            let _ = self.set_brightness(0);
            for &led in leds {
                self.send(0x0F, 0x02, &[storage, led, 0x00, 0x00, 0x00, 0x00])?;
                thread::sleep(Duration::from_millis(4));
            }
            self.last_applied = Some(RazerAppliedState::Off);
            return Ok(());
        }
        let _ = self.set_brightness(0);
        self.send(0x0F, 0x02, &[storage, self.led_id, 0x00, 0x00, 0x00, 0x00])?;
        self.last_applied = Some(RazerAppliedState::Off);
        Ok(())
    }

    pub fn set_rainbow_frame(&mut self, phase: f32, brightness_pct: u8) -> Result<(), String> {
        if self.single_color || self.rows == 0 || self.cols == 0 {
            let val = (brightness_pct.min(100) as f32) / 100.0;
            let c = RgbColor::from_hsv((phase * 60.0) % 360.0, 1.0, val);
            return self.set_static(c, brightness_pct);
        }
        self.last_applied = None;
        let _ = self.set_brightness(brightness_pct);
        let cols = self.cols.min(24) as usize;
        for row in 0..self.rows {
            let mut args = Vec::with_capacity(5 + cols * 3);
            args.extend_from_slice(&[0x00, 0x00, row, 0x00, (cols - 1) as u8]);
            for col in 0..cols {
                let hue = (phase * 60.0 + (col as f32) * (360.0 / cols as f32)) % 360.0;
                let c = RgbColor::from_hsv(hue, 1.0, 1.0);
                args.extend_from_slice(&[c.r, c.g, c.b]);
            }
            self.send(0x0F, 0x03, &args)?;
            thread::sleep(Duration::from_millis(1));
        }
        // Apply Custom Frame mode (0x08)
        self.send(
            0x0F,
            0x02,
            &[0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        )
    }

    pub fn set_hardware_mode(
        &mut self,
        mode_idx: usize,
        color: RgbColor,
        secondary: RgbColor,
        brightness_pct: u8,
    ) -> Result<(), String> {
        self.last_applied = None;
        if mode_idx == 4 {
            return self.set_off();
        }
        if self.single_color {
            return match mode_idx {
                1 => self.set_single_color_breathing(brightness_pct),
                _ => self.set_static(color, brightness_pct),
            };
        }
        let _ = self.set_brightness(brightness_pct);
        thread::sleep(Duration::from_millis(4));
        let storage = self.storage_byte();
        match mode_idx {
            0 => self.set_static(color, brightness_pct),
            1 => self.send(
                0x0F,
                0x02,
                &[storage, self.led_id, 0x02, 0x01, 0x00, 0x01, color.r, color.g, color.b],
            ),
            2 => self.send(
                0x0F,
                0x02,
                &[
                    storage, self.led_id, 0x02, 0x02, 0x00, 0x02, color.r, color.g, color.b,
                    secondary.r, secondary.g, secondary.b,
                ],
            ),
            3 => self.send(0x0F, 0x02, &[storage, self.led_id, 0x03, 0x00, 0x00, 0x00]),
            5 => self.send(0x0F, 0x02, &[storage, self.led_id, 0x04, 0x01, 0x28, 0x00]),
            _ => self.set_static(color, brightness_pct),
        }
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        let modes = if self.single_color {
            vec![
                RgbModeInfo { index: 0, name: "Static (Single-Color LED)".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 1, name: "Breathing".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 4, name: "Off".into(), raw_bytes: Vec::new() },
            ]
        } else {
            vec![
                RgbModeInfo { index: 0, name: "Static".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 1, name: "Breathing (1-Color)".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 2, name: "Breathing (2-Color)".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 3, name: "Spectrum Cycle".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 5, name: "Rainbow Wave".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 4, name: "Off".into(), raw_bytes: Vec::new() },
            ]
        };
        let active_mode_name = modes
            .iter()
            .find(|m| m.index == active_mode)
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "Static".into());
        let led_count = (self.rows as usize) * (self.cols as usize);
        let mut desc = if self.single_color {
            format!(
                "Razer USB HID (PID 0x{:04X} · {} · Monochrome Brightness LED)",
                self.pid, self.firmware
            )
        } else {
            format!(
                "Razer Chroma USB HID (PID 0x{:04X} · {} · {}×{} Matrix)",
                self.pid, self.firmware, self.rows, self.cols
            )
        };
        if self.win11_conflict {
            desc.push_str(
                " · Win11 Dynamic Lighting is ON (disable in Win11 Lighting Settings if Windows overrides color)",
            );
        }
        RgbDeviceInfo {
            id: self.id.clone(),
            backend: RgbBackend::DirectHid,
            index: self.pid as u32,
            device_type: self.device_type.clone(),
            icon: self.icon.clone(),
            name: self.name.clone(),
            vendor: "Razer (Native USB HID)".into(),
            description: desc,
            led_count,
            active_mode_index: active_mode,
            active_mode_name,
            modes,
            zones: vec![RgbZoneInfo {
                index: 0,
                name: if self.single_color {
                    "Logo & Scroll Wheel".into()
                } else {
                    "All LEDs".into()
                },
                led_count: led_count as u32,
            }],
            preview_hex: preview_hex.to_owned(),
            lamp_array_id: None,
        }
    }
}

// =============================================================================
// UNIFIED DIRECT HID CONTROLLER ENUM
// =============================================================================

pub enum DirectHidController {
    Gigabyte(GigabyteFusion2Device),
    Razer(RazerHidDevice),
}

impl DirectHidController {
    pub fn id(&self) -> &str {
        match self {
            Self::Gigabyte(d) => &d.id,
            Self::Razer(d) => &d.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Self::Gigabyte(d) => &d.name,
            Self::Razer(d) => &d.name,
        }
    }

    pub fn razer_pid(&self) -> Option<u16> {
        match self {
            Self::Razer(d) => Some(d.pid),
            Self::Gigabyte(_) => None,
        }
    }

    pub fn apply_effect(
        &mut self,
        effect: RgbEffect,
        color: RgbColor,
        base_brightness_pct: u8,
        frame_brightness_pct: u8,
        phase: f32,
    ) -> Result<(), String> {
        match self {
            Self::Gigabyte(d) => match effect {
                RgbEffect::Blackout => d.set_solid_all(RgbColor::BLACK, 0),
                RgbEffect::Rainbow => d.set_rainbow_frame(phase, frame_brightness_pct),
                _ => d.set_solid_all(color, frame_brightness_pct),
            },
            Self::Razer(d) => {
                d.apply_effect(effect, color, base_brightness_pct, frame_brightness_pct, phase)
            }
        }
    }

    pub fn set_zone_color(
        &mut self,
        zone_index: Option<usize>,
        color: RgbColor,
        brightness_pct: u8,
    ) -> Result<(), String> {
        match self {
            Self::Gigabyte(d) => d.set_zone_color(zone_index, color, brightness_pct),
            Self::Razer(d) => {
                d.last_applied = None;
                d.set_static(color, brightness_pct)
            }
        }
    }

    pub fn set_hardware_mode(
        &mut self,
        mode_idx: usize,
        color: RgbColor,
        secondary: RgbColor,
        brightness_pct: u8,
        speed: u8,
    ) -> Result<(), String> {
        match self {
            Self::Gigabyte(d) => d.set_hardware_mode(mode_idx, color, brightness_pct, speed),
            Self::Razer(d) => d.set_hardware_mode(mode_idx, color, secondary, brightness_pct),
        }
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        match self {
            Self::Gigabyte(d) => d.to_device_info(preview_hex, active_mode),
            Self::Razer(d) => d.to_device_info(preview_hex, active_mode),
        }
    }

    pub fn diagnostic_readback(&self) -> serde_json::Value {
        match self {
            Self::Gigabyte(d) => d.diagnostic_info(),
            Self::Razer(d) => d.diagnostic_readback(),
        }
    }
}

pub fn scan_direct_hid_controllers() -> (Vec<DirectHidController>, String) {
    let entries = enumerate_hid_devices();
    let mut controllers = Vec::new();
    for entry in &entries {
        if let Some(gb) = GigabyteFusion2Device::probe(entry, 0) {
            controllers.push(DirectHidController::Gigabyte(gb));
            break; // One primary motherboard controller
        }
    }
    for razer in RazerHidDevice::probe_all(&entries) {
        controllers.push(DirectHidController::Razer(razer));
    }
    let status = if controllers.is_empty() {
        format!(
            "Direct USB HID scanned {} collections · 0 supported RGB HID devices found",
            entries.len()
        )
    } else {
        format!(
            "Direct USB HID active · {} controller(s) ready",
            controllers.len()
        )
    };
    (controllers, status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn razer_report_checksum_matches_openrgb_spec() {
        // Static extended matrix report for LED 0x05, color #FF8040, tid 0x3F
        let pkt = razer_build_report(
            0x3F,
            0x0F,
            0x02,
            &[0x00, 0x05, 0x01, 0x00, 0x00, 0x01, 0xFF, 0x80, 0x40],
        );
        assert_eq!(pkt.len(), 91);
        assert_eq!(pkt[0], 0x00);
        assert_eq!(pkt[2], 0x3F);
        assert_eq!(pkt[6], 9);
        assert_eq!(pkt[7], 0x0F);
        assert_eq!(pkt[8], 0x02);
        let expected_crc: u8 = pkt[3..89].iter().fold(0u8, |acc, &b| acc ^ b);
        assert_eq!(pkt[89], expected_crc);
        assert_eq!(pkt[90], 0x00);
    }

    #[test]
    fn gigabyte_effect_packet_encodes_color_and_zone_mask() {
        let pkt = gigabyte_build_effect_packet(
            5, // D_LED1
            FUSION2_EFFECT_STATIC,
            RgbColor { r: 0xAA, g: 0xBB, b: 0xCC },
            200,
            50,
        );
        assert_eq!(pkt[0], 0xCC);
        assert_eq!(pkt[1], 0x25);
        assert_eq!(u32::from_le_bytes([pkt[2], pkt[3], pkt[4], pkt[5]]), 1 << 5);
        assert_eq!(pkt[11], FUSION2_EFFECT_STATIC);
        assert_eq!(pkt[12], 200);
        // color0 = 0x00AABBCC in LE => [0xCC, 0xBB, 0xAA, 0x00]
        assert_eq!(&pkt[14..18], &[0xCC, 0xBB, 0xAA, 0x00]);
    }

    #[test]
    fn gigabyte_strip_packets_chunk_19_leds_with_calibration() {
        // GRB calibration: R=1, G=0, B=2 -> (1<<16)|(0<<8)|2 = 0x00010002
        let cal = (1u32 << 16) | 2u32;
        let colors = vec![RgbColor { r: 0x11, g: 0x22, b: 0x33 }; 25];
        let pkts = gigabyte_build_strip_packets(FUSION2_HDR_D_LED1_ARGB, &colors, cal);
        assert_eq!(pkts.len(), 2);
        assert_eq!(pkts[0][0], 0xCC);
        assert_eq!(pkts[0][1], 0x58);
        assert_eq!(pkts[0][4], 19 * 3);
        // First LED in GRB order: [G=0x22, R=0x11, B=0x33]
        assert_eq!(&pkts[0][5..8], &[0x22, 0x11, 0x33]);
        assert_eq!(u16::from_le_bytes([pkts[1][2], pkts[1][3]]), 19 * 3);
        assert_eq!(pkts[1][4], 6 * 3);
    }

    #[test]
    fn razer_varstore_single_color_avoids_animation_spam() {
        assert_eq!(
            razer_single_color_plan(RgbEffect::Blackout, 80),
            RazerSingleColorAction::Off
        );
        assert_eq!(
            razer_single_color_plan(RgbEffect::Static, 0),
            RazerSingleColorAction::Off
        );
        assert_eq!(
            razer_single_color_plan(RgbEffect::Breathing, 85),
            RazerSingleColorAction::HardwareBreathing(85)
        );
        assert_eq!(
            razer_single_color_plan(RgbEffect::Rainbow, 85),
            RazerSingleColorAction::Static(85)
        );
        assert_eq!(
            razer_single_color_plan(RgbEffect::DualPulse, 70),
            RazerSingleColorAction::Static(70)
        );
    }
}
