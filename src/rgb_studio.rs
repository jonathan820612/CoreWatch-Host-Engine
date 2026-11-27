use crate::{
    dashboard_actions,
    rgb_hid::{DirectHidController, scan_direct_hid_controllers},
    rgb_nvapi::{NvApiEneGpuDevice, scan_nvapi_gpus},
    rgb_smbus::{DirectSmbusController, scan_smbus_dram},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use windows::{
    Devices::{
        Enumeration::DeviceInformation,
        Lights::{LampArray, LampArrayKind},
    },
    UI::Color as WinColor,
    core::HSTRING,
};

const CONFIG_FILE: &str = "rgb-studio.json";
const OPENRGB_MAGIC: &[u8; 4] = b"ORGB";
const OPENRGB_CLIENT_PROTOCOL: u32 = 3;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// OpenRGB SDK Packet IDs
const PKT_REQUEST_CONTROLLER_COUNT: u32 = 0;
const PKT_REQUEST_CONTROLLER_DATA: u32 = 1;
const PKT_REQUEST_PROTOCOL_VERSION: u32 = 40;
const PKT_SET_CLIENT_NAME: u32 = 50;
const PKT_UPDATE_LEDS: u32 = 1050;
const PKT_UPDATE_ZONE_LEDS: u32 = 1051;
const PKT_SET_CUSTOM_MODE: u32 = 1053;
const PKT_UPDATE_MODE: u32 = 1100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct RgbColor {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl RgbColor {
    pub const BLACK: Self = Self { r: 0, g: 0, b: 0 };

    pub fn from_hex(hex: &str) -> Option<Self> {
        let s = hex.trim().strip_prefix('#').unwrap_or(hex.trim());
        if s.len() != 6 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let r = u8::from_str_radix(&s[0..2], 16).ok()?;
        let g = u8::from_str_radix(&s[2..4], 16).ok()?;
        let b = u8::from_str_radix(&s[4..6], 16).ok()?;
        Some(Self { r, g, b })
    }

    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    pub fn scale(self, brightness_pct: u8) -> Self {
        let factor = (brightness_pct.min(100) as f32) / 100.0;
        Self {
            r: (self.r as f32 * factor).round() as u8,
            g: (self.g as f32 * factor).round() as u8,
            b: (self.b as f32 * factor).round() as u8,
        }
    }

    pub fn lerp(self, other: Self, t: f32) -> Self {
        let t = t.clamp(0.0, 1.0);
        Self {
            r: (self.r as f32 + (other.r as f32 - self.r as f32) * t).round() as u8,
            g: (self.g as f32 + (other.g as f32 - self.g as f32) * t).round() as u8,
            b: (self.b as f32 + (other.b as f32 - self.b as f32) * t).round() as u8,
        }
    }

    pub fn from_hsv(hue_deg: f32, sat: f32, val: f32) -> Self {
        let h = ((hue_deg % 360.0) + 360.0) % 360.0;
        let s = sat.clamp(0.0, 1.0);
        let v = val.clamp(0.0, 1.0);
        let c = v * s;
        let x = c * (1.0 - (((h / 60.0) % 2.0) - 1.0).abs());
        let m = v - c;
        let (r1, g1, b1) = match h as u32 {
            0..=59 => (c, x, 0.0),
            60..=119 => (x, c, 0.0),
            120..=179 => (0.0, c, x),
            180..=239 => (0.0, x, c),
            240..=299 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        Self {
            r: ((r1 + m) * 255.0).round() as u8,
            g: ((g1 + m) * 255.0).round() as u8,
            b: ((b1 + m) * 255.0).round() as u8,
        }
    }

    pub fn from_temperature(celsius: f64) -> Self {
        // Smooth thermal curve: <=40C Ice Blue -> 55C Emerald -> 70C Amber -> >=86C Crimson Red
        let cool = Self { r: 0, g: 180, b: 255 };
        let mild = Self { r: 16, g: 220, b: 145 };
        let warm = Self { r: 255, g: 165, b: 0 };
        let hot = Self { r: 255, g: 30, b: 30 };
        if celsius <= 40.0 {
            cool
        } else if celsius <= 56.0 {
            cool.lerp(mild, ((celsius - 40.0) / 16.0) as f32)
        } else if celsius <= 72.0 {
            mild.lerp(warm, ((celsius - 56.0) / 16.0) as f32)
        } else if celsius <= 86.0 {
            warm.lerp(hot, ((celsius - 72.0) / 14.0) as f32)
        } else {
            hot
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RgbEffect {
    #[default]
    Static,
    Breathing,
    Rainbow,
    DualPulse,
    ThermalCpu,
    ThermalGpu,
    ThemeSync,
    Blackout,
}

impl RgbEffect {
    pub fn is_animated(self) -> bool {
        matches!(
            self,
            Self::Breathing | Self::Rainbow | Self::DualPulse | Self::ThermalCpu | Self::ThermalGpu
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RgbBackend {
    DirectHid,
    DirectNvapi,
    DirectSmbus,
    WindowsLampArray,
    OpenRgb,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbModeInfo {
    pub index: usize,
    pub name: String,
    #[serde(skip)]
    pub raw_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbZoneInfo {
    pub index: usize,
    pub name: String,
    pub led_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbDeviceInfo {
    pub id: String,
    pub backend: RgbBackend,
    pub index: u32,
    pub device_type: String,
    pub icon: String,
    pub name: String,
    pub vendor: String,
    pub description: String,
    pub led_count: usize,
    pub active_mode_index: usize,
    pub active_mode_name: String,
    pub modes: Vec<RgbModeInfo>,
    pub zones: Vec<RgbZoneInfo>,
    pub preview_hex: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lamp_array_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbPreset {
    pub id: String,
    pub name: String,
    pub effect: RgbEffect,
    pub primary_hex: String,
    pub secondary_hex: String,
    pub brightness: u8,
    pub speed: u8,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RgbConfig {
    pub host: String,
    pub port: u16,
    pub effect: RgbEffect,
    pub primary_hex: String,
    pub secondary_hex: String,
    pub brightness: u8,
    pub speed: u8,
    pub theme_accent_hex: String,
    pub auto_sync_profiles: bool,
    pub profile_bindings: BTreeMap<String, String>,
    pub custom_presets: Vec<RgbPreset>,
    #[serde(default)]
    pub pinned_devices: Vec<String>,
    #[serde(default = "default_true")]
    pub restore_on_launch: bool,
    #[serde(default = "default_true")]
    pub alert_flash_enabled: bool,
}

fn default_true() -> bool {
    true
}

impl Default for RgbConfig {
    fn default() -> Self {
        let mut bindings = BTreeMap::new();
        bindings.insert("normal".into(), "theme-sync".into());
        bindings.insert("work".into(), "theme-sync".into());
        bindings.insert("gaming".into(), "thermal-gpu".into());
        bindings.insert("streaming".into(), "corewatch-cyber".into());
        bindings.insert("night".into(), "blackout".into());
        Self {
            host: "127.0.0.1".into(),
            port: 6742,
            effect: RgbEffect::Static,
            primary_hex: "#3182ce".into(),
            secondary_hex: "#9f7aea".into(),
            brightness: 85,
            speed: 45,
            theme_accent_hex: "#3182ce".into(),
            auto_sync_profiles: false,
            profile_bindings: bindings,
            custom_presets: Vec::new(),
            pinned_devices: Vec::new(),
            restore_on_launch: true,
            alert_flash_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbStateSnapshot {
    pub direct_hid_count: usize,
    pub direct_hid_status: String,
    pub direct_nvapi_count: usize,
    pub direct_nvapi_status: String,
    pub direct_smbus_count: usize,
    pub direct_smbus_status: String,
    pub smbus_needs_admin: bool,
    pub openrgb_connected: bool,
    pub openrgb_protocol: u32,
    pub openrgb_error: Option<String>,
    pub openrgb_exe_path: Option<String>,
    pub win11_lamp_count: usize,
    pub win11_status: String,
    pub devices: Vec<RgbDeviceInfo>,
    pub config: RgbConfig,
    pub presets: Vec<RgbPreset>,
    pub live_color_hex: String,
    pub live_cpu_temp: Option<f64>,
    pub live_gpu_temp: Option<f64>,
    pub engine_running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_json: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RgbAction {
    Connect {
        host: String,
        port: u16,
    },
    Disconnect,
    Rescan,
    ApplyEffect {
        effect: RgbEffect,
        primary_hex: String,
        secondary_hex: String,
        brightness: u8,
        speed: u8,
    },
    SyncThemeAccent {
        accent_hex: String,
    },
    SetDeviceColor {
        device_id: String,
        zone_index: Option<usize>,
        color_hex: String,
    },
    SetDeviceMode {
        device_id: String,
        mode_index: usize,
    },
    SetDevicePinned {
        device_id: String,
        pinned: bool,
    },
    DiagnosticReadback,
    Blackout,
    SavePreset {
        name: String,
    },
    ApplyPreset {
        id: String,
    },
    DeletePreset {
        id: String,
    },
    SetProfileSync {
        enabled: bool,
        bindings: Option<BTreeMap<String, String>>,
    },
    LaunchOpenrgb,
    OpenDynamicLightingSettings,
}

pub fn builtin_presets() -> Vec<RgbPreset> {
    vec![
        RgbPreset {
            id: "corewatch-cyber".into(),
            name: "CoreWatch Cyber".into(),
            effect: RgbEffect::DualPulse,
            primary_hex: "#00b4ff".into(),
            secondary_hex: "#c026d3".into(),
            brightness: 90,
            speed: 45,
            builtin: true,
        },
        RgbPreset {
            id: "theme-sync".into(),
            name: "Theme Accent Sync".into(),
            effect: RgbEffect::ThemeSync,
            primary_hex: "#3182ce".into(),
            secondary_hex: "#63b3ed".into(),
            brightness: 85,
            speed: 40,
            builtin: true,
        },
        RgbPreset {
            id: "thermal-cpu".into(),
            name: "Thermal CPU Guard".into(),
            effect: RgbEffect::ThermalCpu,
            primary_hex: "#00b4ff".into(),
            secondary_hex: "#ff1e1e".into(),
            brightness: 95,
            speed: 50,
            builtin: true,
        },
        RgbPreset {
            id: "thermal-gpu".into(),
            name: "Thermal GPU Guard".into(),
            effect: RgbEffect::ThermalGpu,
            primary_hex: "#00b4ff".into(),
            secondary_hex: "#ff1e1e".into(),
            brightness: 95,
            speed: 50,
            builtin: true,
        },
        RgbPreset {
            id: "rainbow-wave".into(),
            name: "Rainbow Wave".into(),
            effect: RgbEffect::Rainbow,
            primary_hex: "#ff0080".into(),
            secondary_hex: "#00ffff".into(),
            brightness: 85,
            speed: 55,
            builtin: true,
        },
        RgbPreset {
            id: "warm-desk".into(),
            name: "Warm Desk Amber".into(),
            effect: RgbEffect::Static,
            primary_hex: "#ff9b3d".into(),
            secondary_hex: "#d97706".into(),
            brightness: 70,
            speed: 30,
            builtin: true,
        },
        RgbPreset {
            id: "emerald-pulse".into(),
            name: "Emerald Breathe".into(),
            effect: RgbEffect::Breathing,
            primary_hex: "#10b981".into(),
            secondary_hex: "#059669".into(),
            brightness: 80,
            speed: 35,
            builtin: true,
        },
        RgbPreset {
            id: "blackout".into(),
            name: "Stealth Blackout".into(),
            effect: RgbEffect::Blackout,
            primary_hex: "#000000".into(),
            secondary_hex: "#000000".into(),
            brightness: 0,
            speed: 0,
            builtin: true,
        },
    ]
}

// =============================================================================
// PURE-RUST OPENRGB SDK TCP CLIENT (16-byte LE "ORGB" framing)
// =============================================================================

struct CursorReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> CursorReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos.saturating_add(n) > self.data.len() {
            return Err("OpenRGB packet ended unexpectedly.".into());
        }
        let slice = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    fn read_u16(&mut self) -> Result<u16, String> {
        let b = self.read_bytes(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let b = self.read_bytes(4)?;
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_string(&mut self) -> Result<String, String> {
        let len = self.read_u16()? as usize;
        let bytes = self.read_bytes(len)?;
        let trimmed = bytes.strip_suffix(&[0]).unwrap_or(bytes);
        Ok(String::from_utf8_lossy(trimmed).trim().to_owned())
    }

    fn read_color(&mut self) -> Result<RgbColor, String> {
        let b = self.read_bytes(4)?;
        Ok(RgbColor {
            r: b[0],
            g: b[1],
            b: b[2],
        })
    }
}

fn encode_openrgb_packet(dev_id: u32, pkt_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(16 + payload.len());
    out.extend_from_slice(OPENRGB_MAGIC);
    out.extend_from_slice(&dev_id.to_le_bytes());
    out.extend_from_slice(&pkt_id.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

fn decode_openrgb_header(header: &[u8; 16]) -> Result<(u32, u32, u32), String> {
    if &header[0..4] != OPENRGB_MAGIC {
        return Err("Invalid OpenRGB packet magic header.".into());
    }
    let dev_id = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    let pkt_id = u32::from_le_bytes([header[8], header[9], header[10], header[11]]);
    let size = u32::from_le_bytes([header[12], header[13], header[14], header[15]]);
    if size > 16 * 1024 * 1024 {
        return Err("OpenRGB packet exceeded maximum allowed size.".into());
    }
    Ok((dev_id, pkt_id, size))
}

fn openrgb_device_type(code: i32) -> (&'static str, &'static str) {
    match code {
        0 => ("Motherboard", "📟"),
        1 => ("DRAM", "🧠"),
        2 => ("GPU", "🎞️"),
        3 => ("Cooler", "❄️"),
        4 => ("LED Strip", "🌈"),
        5 => ("Keyboard", "⌨️"),
        6 => ("Mouse", "🖱️"),
        7 => ("Mouse Mat", "🟦"),
        8 => ("Headset", "🎧"),
        9 => ("Headset Stand", "🎧"),
        10 => ("Gamepad", "🎮"),
        11 => ("Light", "💡"),
        12 => ("Speaker", "🔊"),
        13 => ("Virtual", "✨"),
        14 => ("Storage", "💾"),
        15 => ("Case", "🖥️"),
        16 => ("Microphone", "🎙️"),
        17 => ("Accessory", "🔌"),
        18 => ("Keypad", "⌨️"),
        _ => ("RGB Device", "💡"),
    }
}

fn parse_controller_data(index: u32, protocol: u32, data: &[u8]) -> Result<RgbDeviceInfo, String> {
    let mut r = CursorReader::new(data);
    let _data_size = r.read_u32()?;
    let type_code = r.read_i32()?;
    let (dtype, icon) = openrgb_device_type(type_code);
    let name = r.read_string()?;
    let vendor = if protocol >= 1 {
        r.read_string()?
    } else {
        String::new()
    };
    let description = r.read_string()?;
    let _version = r.read_string()?;
    let _serial = r.read_string()?;
    let _location = r.read_string()?;

    let num_modes = r.read_u16()? as usize;
    let active_mode = r.read_i32()?.max(0) as usize;
    let mut modes = Vec::with_capacity(num_modes.min(128));
    for idx in 0..num_modes {
        let mode_start = r.pos;
        let mode_name = r.read_string()?;
        let _value = r.read_i32()?;
        let _flags = r.read_u32()?;
        let _speed_min = r.read_u32()?;
        let _speed_max = r.read_u32()?;
        if protocol >= 3 {
            let _brightness_min = r.read_u32()?;
            let _brightness_max = r.read_u32()?;
        }
        let _colors_min = r.read_u32()?;
        let _colors_max = r.read_u32()?;
        let _speed = r.read_u32()?;
        if protocol >= 3 {
            let _brightness = r.read_u32()?;
        }
        let _direction = r.read_u32()?;
        let _color_mode = r.read_u32()?;
        let num_mode_colors = r.read_u16()? as usize;
        for _ in 0..num_mode_colors {
            let _ = r.read_color()?;
        }
        let mode_end = r.pos;
        modes.push(RgbModeInfo {
            index: idx,
            name: mode_name,
            raw_bytes: data[mode_start..mode_end].to_vec(),
        });
    }

    let num_zones = r.read_u16()? as usize;
    let mut zones = Vec::with_capacity(num_zones.min(64));
    for idx in 0..num_zones {
        let zname = r.read_string()?;
        let _ztype = r.read_i32()?;
        let _leds_min = r.read_u32()?;
        let _leds_max = r.read_u32()?;
        let leds_count = r.read_u32()?;
        let matrix_len = r.read_u16()? as usize;
        if matrix_len > 0 {
            let _ = r.read_bytes(matrix_len)?;
        }
        if protocol >= 4 && r.remaining() >= 2 {
            let num_segments = r.read_u16()? as usize;
            for _ in 0..num_segments {
                let _seg_name = r.read_string()?;
                let _seg_type = r.read_i32()?;
                let _seg_start = r.read_u32()?;
                let _seg_len = r.read_u32()?;
            }
        }
        zones.push(RgbZoneInfo {
            index: idx,
            name: zname,
            led_count: leds_count,
        });
    }

    let num_leds = r.read_u16()? as usize;
    for _ in 0..num_leds {
        let _led_name = r.read_string()?;
        let _led_val = r.read_u32()?;
    }

    let num_colors = if r.remaining() >= 2 {
        r.read_u16()? as usize
    } else {
        0
    };
    let mut first_color = None;
    for _ in 0..num_colors {
        if r.remaining() < 4 {
            break;
        }
        let c = r.read_color()?;
        if first_color.is_none() && (c.r > 0 || c.g > 0 || c.b > 0) {
            first_color = Some(c);
        }
    }

    let active_mode_name = modes
        .get(active_mode)
        .map(|m| m.name.clone())
        .unwrap_or_else(|| "Custom".into());
    let led_count = num_leds
        .max(num_colors)
        .max(zones.iter().map(|z| z.led_count as usize).sum());

    Ok(RgbDeviceInfo {
        id: format!("openrgb:{index}"),
        backend: RgbBackend::OpenRgb,
        index,
        device_type: dtype.into(),
        icon: icon.into(),
        name: if name.is_empty() {
            format!("OpenRGB Device #{index}")
        } else {
            name
        },
        vendor,
        description,
        led_count,
        active_mode_index: active_mode,
        active_mode_name,
        modes,
        zones,
        preview_hex: first_color.unwrap_or(RgbColor::BLACK).to_hex(),
        lamp_array_id: None,
    })
}

struct OpenRgbClient {
    stream: TcpStream,
    protocol: u32,
}

impl OpenRgbClient {
    fn connect(host: &str, port: u16) -> Result<Self, String> {
        let addr_str = format!("{}:{}", host.trim(), port);
        let addrs: Vec<SocketAddr> = addr_str
            .to_socket_addrs()
            .map_err(|e| format!("Could not resolve {addr_str}: {e}"))?
            .collect();
        let addr = addrs
            .into_iter()
            .next()
            .ok_or_else(|| format!("No socket address found for {addr_str}."))?;
        let stream = TcpStream::connect_timeout(&addr, Duration::from_millis(900))
            .map_err(|e| format!("OpenRGB SDK server unreachable at {addr_str} ({e})."))?;
        let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(1200)));
        let _ = stream.set_nodelay(true);

        let mut client = Self {
            stream,
            protocol: 0,
        };
        // Negotiate protocol version (best-effort; OpenRGB >=0.6 supports v2-v4).
        let ver_payload = OPENRGB_CLIENT_PROTOCOL.to_le_bytes();
        if let Ok(reply) = client.request(0, PKT_REQUEST_PROTOCOL_VERSION, &ver_payload)
            && reply.len() >= 4
        {
            let server_proto = u32::from_le_bytes([reply[0], reply[1], reply[2], reply[3]]);
            client.protocol = server_proto.min(OPENRGB_CLIENT_PROTOCOL);
        }
        // Identify client to OpenRGB server UI.
        let _ = client.send_only(0, PKT_SET_CLIENT_NAME, b"RustCoreWatch\0");
        Ok(client)
    }

    fn send_only(&mut self, dev_id: u32, pkt_id: u32, payload: &[u8]) -> Result<(), String> {
        let frame = encode_openrgb_packet(dev_id, pkt_id, payload);
        self.stream
            .write_all(&frame)
            .map_err(|e| format!("OpenRGB write failed: {e}"))
    }

    fn request(&mut self, dev_id: u32, pkt_id: u32, payload: &[u8]) -> Result<Vec<u8>, String> {
        self.send_only(dev_id, pkt_id, payload)?;
        let mut header = [0u8; 16];
        self.stream
            .read_exact(&mut header)
            .map_err(|e| format!("OpenRGB read header failed: {e}"))?;
        let (_dev, _pkt, size) = decode_openrgb_header(&header)?;
        let mut body = vec![0u8; size as usize];
        if size > 0 {
            self.stream
                .read_exact(&mut body)
                .map_err(|e| format!("OpenRGB read body failed: {e}"))?;
        }
        Ok(body)
    }

    fn enumerate_devices(&mut self) -> Result<Vec<RgbDeviceInfo>, String> {
        let count_bytes = self.request(0, PKT_REQUEST_CONTROLLER_COUNT, &[])?;
        if count_bytes.len() < 4 {
            return Ok(Vec::new());
        }
        let count = u32::from_le_bytes([
            count_bytes[0],
            count_bytes[1],
            count_bytes[2],
            count_bytes[3],
        ])
        .min(64);
        let proto_bytes = self.protocol.to_le_bytes();
        let mut devices = Vec::with_capacity(count as usize);
        for idx in 0..count {
            let payload = if self.protocol >= 1 {
                &proto_bytes[..]
            } else {
                &[]
            };
            if let Ok(data) = self.request(idx, PKT_REQUEST_CONTROLLER_DATA, payload)
                && let Ok(dev) = parse_controller_data(idx, self.protocol, &data)
            {
                devices.push(dev);
            }
        }
        Ok(devices)
    }

    fn set_custom_mode(&mut self, dev_id: u32) -> Result<(), String> {
        self.send_only(dev_id, PKT_SET_CUSTOM_MODE, &[])
    }

    fn update_leds(&mut self, dev_id: u32, colors: &[RgbColor]) -> Result<(), String> {
        let count = colors.len().min(u16::MAX as usize);
        let data_size = (4 + 2 + count * 4) as u32;
        let mut payload = Vec::with_capacity(data_size as usize);
        payload.extend_from_slice(&data_size.to_le_bytes());
        payload.extend_from_slice(&(count as u16).to_le_bytes());
        for c in &colors[..count] {
            payload.extend_from_slice(&[c.r, c.g, c.b, 0]);
        }
        self.send_only(dev_id, PKT_UPDATE_LEDS, &payload)
    }

    fn update_zone_leds(
        &mut self,
        dev_id: u32,
        zone_idx: u32,
        colors: &[RgbColor],
    ) -> Result<(), String> {
        let count = colors.len().min(u16::MAX as usize);
        let data_size = (4 + 4 + 2 + count * 4) as u32;
        let mut payload = Vec::with_capacity(data_size as usize);
        payload.extend_from_slice(&data_size.to_le_bytes());
        payload.extend_from_slice(&zone_idx.to_le_bytes());
        payload.extend_from_slice(&(count as u16).to_le_bytes());
        for c in &colors[..count] {
            payload.extend_from_slice(&[c.r, c.g, c.b, 0]);
        }
        self.send_only(dev_id, PKT_UPDATE_ZONE_LEDS, &payload)
    }

    fn update_mode(&mut self, dev_id: u32, mode_idx: i32, raw_mode: &[u8]) -> Result<(), String> {
        let data_size = (4 + 4 + raw_mode.len()) as u32;
        let mut payload = Vec::with_capacity(data_size as usize);
        payload.extend_from_slice(&data_size.to_le_bytes());
        payload.extend_from_slice(&mode_idx.to_le_bytes());
        payload.extend_from_slice(raw_mode);
        self.send_only(dev_id, PKT_UPDATE_MODE, &payload)
    }
}

// =============================================================================
// WINDOWS 11 NATIVE DYNAMIC LIGHTING (WinRT LampArray HID Usage Page 0x59)
// =============================================================================

fn lamp_kind_label(kind: LampArrayKind) -> (&'static str, &'static str) {
    match kind {
        LampArrayKind::Keyboard => ("Keyboard", "⌨️"),
        LampArrayKind::Mouse => ("Mouse", "🖱️"),
        LampArrayKind::GameController => ("Gamepad", "🎮"),
        LampArrayKind::Peripheral => ("Peripheral", "🔌"),
        LampArrayKind::Scene => ("Ambient Light", "💡"),
        LampArrayKind::Notification => ("Indicator", "🔔"),
        LampArrayKind::Chassis => ("Chassis / Case", "🖥️"),
        LampArrayKind::Wearable => ("Wearable", "🎧"),
        LampArrayKind::Furniture => ("Desk / Furniture", "🌈"),
        LampArrayKind::Art => ("Wall Art", "🎨"),
        LampArrayKind::Headset => ("Headset", "🎧"),
        LampArrayKind::Microphone => ("Microphone", "🎙️"),
        LampArrayKind::Speaker => ("Speaker", "🔊"),
        _ => ("Dynamic Lighting", "✨"),
    }
}

fn scan_win11_lamp_arrays() -> (Vec<RgbDeviceInfo>, HashMap<String, LampArray>, String) {
    let selector = match LampArray::GetDeviceSelector() {
        Ok(s) if !s.is_empty() => s,
        _ => {
            return (
                Vec::new(),
                HashMap::new(),
                "Windows 11 Dynamic Lighting API unavailable on this OS build.".into(),
            );
        }
    };
    let collection = match DeviceInformation::FindAllAsyncAqsFilter(&selector)
        .and_then(|op| op.join())
    {
        Ok(c) => c,
        Err(e) => {
            return (
                Vec::new(),
                HashMap::new(),
                format!("Dynamic Lighting scan unavailable ({e})."),
            );
        }
    };
    let count = collection.Size().unwrap_or(0);
    let mut devices = Vec::new();
    let mut handles = HashMap::new();
    let mut unavailable_count = 0usize;
    for idx in 0..count {
        let Ok(info) = collection.GetAt(idx) else {
            continue;
        };
        let Ok(dev_id) = info.Id() else {
            continue;
        };
        let friendly = info
            .Name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_else(|_| format!("Dynamic Lighting Device #{}", idx + 1));
        if let Ok(lamp) = LampArray::FromIdAsync(&dev_id).and_then(|op| op.join()) {
            let led_count = lamp.LampCount().unwrap_or(1).max(0) as usize;
            let kind = lamp
                .LampArrayKind()
                .unwrap_or(LampArrayKind::Undefined);
            let available = lamp.IsAvailable().unwrap_or(true);
            if !available {
                unavailable_count += 1;
            }
            let (dtype, icon) = lamp_kind_label(kind);
            let id_str = dev_id.to_string_lossy();
            handles.insert(id_str.clone(), lamp);
            devices.push(RgbDeviceInfo {
                id: format!("win11:{idx}"),
                backend: RgbBackend::WindowsLampArray,
                index: idx,
                device_type: dtype.into(),
                icon: icon.into(),
                name: friendly,
                vendor: "Windows Dynamic Lighting".into(),
                description: if available {
                    format!("Native HID LampArray ({led_count} lamps · Ready)")
                } else {
                    format!(
                        "Native HID LampArray ({led_count} lamps · Blocked by Windows Dynamic Lighting priority)"
                    )
                },
                led_count,
                active_mode_index: 0,
                active_mode_name: if available {
                    "Direct (LampArray)".into()
                } else {
                    "Waiting for Win11 Permission".into()
                },
                modes: vec![RgbModeInfo {
                    index: 0,
                    name: "Direct (LampArray)".into(),
                    raw_bytes: Vec::new(),
                }],
                zones: vec![RgbZoneInfo {
                    index: 0,
                    name: "All Lamps".into(),
                    led_count: led_count as u32,
                }],
                preview_hex: "#3182ce".into(),
                lamp_array_id: Some(id_str),
            });
        }
    }
    let status = if devices.is_empty() {
        "Windows 11 Dynamic Lighting ready · 0 HID LampArray devices detected".into()
    } else if unavailable_count > 0 {
        format!(
            "Windows 11 Dynamic Lighting: {} device(s) found, but {} blocked — enable 'Compatible apps in the foreground always control lighting' in Win11 Lighting settings",
            devices.len(),
            unavailable_count
        )
    } else {
        format!(
            "Windows 11 Dynamic Lighting active · {} HID LampArray device(s) held",
            devices.len()
        )
    };
    (devices, handles, status)
}

fn push_win11_lamp_color(
    handles: &mut HashMap<String, LampArray>,
    lamp_id: &str,
    color: RgbColor,
    enabled: bool,
) -> Result<(), String> {
    if !handles.contains_key(lamp_id) {
        let hstr = HSTRING::from(lamp_id);
        let lamp = LampArray::FromIdAsync(&hstr)
            .and_then(|op| op.join())
            .map_err(|e| format!("Could not open Windows LampArray device: {e}"))?;
        handles.insert(lamp_id.to_owned(), lamp);
    }
    let Some(lamp) = handles.get(lamp_id) else {
        return Err("Windows LampArray handle unavailable.".into());
    };
    if !lamp.IsAvailable().unwrap_or(true) {
        return Err(
            "Windows 11 Dynamic Lighting is currently overriding this device. Open Win11 Lighting settings and enable 'Compatible apps in the foreground always control lighting' (or put RustCoreWatch above Windows Dynamic Lighting)."
                .into(),
        );
    }
    let _ = lamp.SetIsEnabled(enabled);
    let _ = lamp.SetBrightnessLevel(if enabled { 1.0 } else { 0.0 });
    let win_color = WinColor {
        A: 255,
        R: color.r,
        G: color.g,
        B: color.b,
    };
    if let Err(e) = lamp.SetColor(win_color) {
        handles.remove(lamp_id);
        return Err(format!("Failed to set LampArray color: {e}"));
    }
    Ok(())
}

fn push_win11_lamp_rainbow(
    handles: &mut HashMap<String, LampArray>,
    lamp_id: &str,
    led_count: usize,
    phase: f32,
    brightness_pct: u8,
) -> Result<(), String> {
    if !handles.contains_key(lamp_id) {
        let hstr = HSTRING::from(lamp_id);
        let lamp = LampArray::FromIdAsync(&hstr)
            .and_then(|op| op.join())
            .map_err(|e| format!("Could not open Windows LampArray device: {e}"))?;
        handles.insert(lamp_id.to_owned(), lamp);
    }
    let Some(lamp) = handles.get(lamp_id) else {
        return Err("Windows LampArray handle unavailable.".into());
    };
    if !lamp.IsAvailable().unwrap_or(true) {
        return Ok(());
    }
    let _ = lamp.SetIsEnabled(true);
    let _ = lamp.SetBrightnessLevel(1.0);
    let count = led_count.clamp(1, 512);
    let mut indices = Vec::with_capacity(count);
    let mut colors = Vec::with_capacity(count);
    let val = (brightness_pct.min(100) as f32) / 100.0;
    for i in 0..count {
        let hue = (phase * 60.0 + (i as f32) * (360.0 / (count as f32).max(8.0))) % 360.0;
        let c = RgbColor::from_hsv(hue, 1.0, val);
        indices.push(i as i32);
        colors.push(WinColor {
            A: 255,
            R: c.r,
            G: c.g,
            B: c.b,
        });
    }
    if let Err(e) = lamp.SetColorsForIndices(&colors, &indices) {
        handles.remove(lamp_id);
        return Err(format!("Failed to set LampArray rainbow colors: {e}"));
    }
    Ok(())
}

// =============================================================================
// OPENRGB EXECUTABLE DETECTOR
// =============================================================================

pub fn detect_openrgb_executable() -> Option<String> {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from(r"C:\Program Files\OpenRGB\OpenRGB.exe"),
        PathBuf::from(r"C:\Program Files (x86)\OpenRGB\OpenRGB.exe"),
    ];
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let local_path = PathBuf::from(&local);
        candidates.push(local_path.join(r"Programs\OpenRGB\OpenRGB.exe"));
        candidates.push(local_path.join(r"OpenRGB\OpenRGB.exe"));
        let winget_pkgs = local_path.join(r"Microsoft\WinGet\Packages");
        if let Ok(entries) = fs::read_dir(&winget_pkgs) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                if name.contains("openrgb") {
                    candidates.push(entry.path().join("OpenRGB.exe"));
                    if let Ok(sub) = fs::read_dir(entry.path()) {
                        for sub_entry in sub.flatten() {
                            candidates.push(sub_entry.path().join("OpenRGB.exe"));
                        }
                    }
                }
            }
        }
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        candidates.push(PathBuf::from(&profile).join(r"scoop\apps\openrgb\current\OpenRGB.exe"));
        candidates.push(PathBuf::from(&profile).join(r"scoop\shims\openrgb.exe"));
    }
    if let Ok(path_env) = std::env::var("PATH") {
        for seg in path_env.split(';') {
            let p = PathBuf::from(seg.trim()).join("OpenRGB.exe");
            if p.is_file() {
                candidates.push(p);
            }
        }
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

// =============================================================================
// RGB STUDIO ENGINE & BACKGROUND ANIMATOR
// =============================================================================

struct RgbInner {
    config: RgbConfig,
    direct_hid: Vec<DirectHidController>,
    direct_hid_status: String,
    direct_nvapi: Vec<NvApiEneGpuDevice>,
    direct_nvapi_status: String,
    direct_smbus: Vec<DirectSmbusController>,
    direct_smbus_status: String,
    smbus_needs_admin: bool,
    device_previews: HashMap<String, String>,
    device_modes: HashMap<String, usize>,
    openrgb_client: Option<OpenRgbClient>,
    openrgb_protocol: u32,
    openrgb_error: Option<String>,
    openrgb_devices: Vec<RgbDeviceInfo>,
    win11_devices: Vec<RgbDeviceInfo>,
    win11_handles: HashMap<String, LampArray>,
    win11_status: String,
    openrgb_exe_path: Option<String>,
    live_color: RgbColor,
    live_cpu_temp: Option<f64>,
    live_gpu_temp: Option<f64>,
    last_pushed_frame: Option<(RgbEffect, RgbColor, u8)>,
    alert_flash_until: Option<Instant>,
    diagnostic_json: Option<String>,
    message: String,
    phase: f32,
}

fn filter_duplicate_win11_lamps(
    direct_hid: &[DirectHidController],
    win11_devices: &mut Vec<RgbDeviceInfo>,
    win11_handles: &mut HashMap<String, LampArray>,
    win11_status: &mut String,
) {
    let claimed_razer_pids: Vec<String> = direct_hid
        .iter()
        .filter_map(|c| c.razer_pid())
        .map(|pid| format!("VID_1532&PID_{pid:04X}"))
        .collect();
    if claimed_razer_pids.is_empty() {
        return;
    }
    let before = win11_devices.len();
    win11_devices.retain(|dev| {
        let Some(ref lid) = dev.lamp_array_id else {
            return true;
        };
        let upper = lid.to_ascii_uppercase();
        let dup = claimed_razer_pids.iter().any(|tag| upper.contains(tag));
        if dup {
            win11_handles.remove(lid);
        }
        !dup
    });
    let removed = before.saturating_sub(win11_devices.len());
    if removed > 0 && win11_devices.is_empty() {
        *win11_status = format!(
            "Windows 11 Dynamic Lighting: {removed} device(s) upgraded to native Direct USB HID (no extra LampArray devices)"
        );
    }
}

struct HardwareScanBundle {
    direct_hid: Vec<DirectHidController>,
    direct_hid_status: String,
    direct_nvapi: Vec<NvApiEneGpuDevice>,
    direct_nvapi_status: String,
    direct_smbus: Vec<DirectSmbusController>,
    direct_smbus_status: String,
    smbus_needs_admin: bool,
    win11_devices: Vec<RgbDeviceInfo>,
    win11_handles: HashMap<String, LampArray>,
    win11_status: String,
    openrgb_exe_path: Option<String>,
}

fn scan_all_native_hardware() -> HardwareScanBundle {
    // Run HID, NVAPI, SMBus, Win11 Dynamic Lighting, and OpenRGB exe scan concurrently!
    thread::scope(|s| {
        let h_hid = s.spawn(scan_direct_hid_controllers);
        let h_nvapi = s.spawn(scan_nvapi_gpus);
        let h_smbus = s.spawn(scan_smbus_dram);
        let h_win11 = s.spawn(scan_win11_lamp_arrays);
        let h_exe = s.spawn(detect_openrgb_executable);

        let (hid, hid_status) = h_hid
            .join()
            .unwrap_or_else(|_| (Vec::new(), "Direct USB HID scan failed.".into()));
        let (nvapi, nvapi_status) = h_nvapi
            .join()
            .unwrap_or_else(|_| (Vec::new(), "NVIDIA NVAPI scan failed.".into()));
        let smbus = h_smbus.join().unwrap_or_else(|_| crate::rgb_smbus::SmbusScanResult {
            controllers: Vec::new(),
            status: "PawnIO SMBus scan failed.".into(),
            needs_admin: false,
        });
        let (mut wdevs, mut whandles, mut wstatus) = h_win11.join().unwrap_or_else(|_| {
            (
                Vec::new(),
                HashMap::new(),
                "Windows 11 Dynamic Lighting scan failed.".into(),
            )
        });
        let exe = h_exe.join().ok().flatten();

        filter_duplicate_win11_lamps(&hid, &mut wdevs, &mut whandles, &mut wstatus);
        HardwareScanBundle {
            direct_hid: hid,
            direct_hid_status: hid_status,
            direct_nvapi: nvapi,
            direct_nvapi_status: nvapi_status,
            direct_smbus: smbus.controllers,
            direct_smbus_status: smbus.status,
            smbus_needs_admin: smbus.needs_admin,
            win11_devices: wdevs,
            win11_handles: whandles,
            win11_status: wstatus,
            openrgb_exe_path: exe,
        }
    })
}

struct FlagGuard<'a>(&'a AtomicBool);
impl Drop for FlagGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub struct RgbEngine {
    file: Option<PathBuf>,
    inner: Mutex<RgbInner>,
    wake: Condvar,
    stop: AtomicBool,
    scanning: AtomicBool,
    smoke_test: bool,
}

impl RgbEngine {
    fn lock_inner(&self) -> std::sync::MutexGuard<'_, RgbInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn open(dir: Option<&Path>, smoke_test: bool) -> Arc<Self> {
        Self::open_internal(dir, smoke_test, false)
    }

    fn open_internal(dir: Option<&Path>, smoke_test: bool, sync_scan: bool) -> Arc<Self> {
        let file = dir.map(|d| d.join(CONFIG_FILE));
        let config = file
            .as_ref()
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|raw| serde_json::from_str::<RgbConfig>(&raw).ok())
            .unwrap_or_default();
        let initial_color = RgbColor::from_hex(&config.primary_hex)
            .unwrap_or(RgbColor {
                r: 49,
                g: 130,
                b: 206,
            });
        let initial_msg = if smoke_test {
            "Standalone Rust RGB engine ready (smoke test mode).".into()
        } else if sync_scan {
            "Scanning native RGB hardware…".into()
        } else {
            "Standalone Rust RGB engine starting · scanning USB HID, GPU NVAPI, RAM SMBus, and Dynamic Lighting…".into()
        };
        let engine = Arc::new(Self {
            file,
            inner: Mutex::new(RgbInner {
                config,
                direct_hid: Vec::new(),
                direct_hid_status: if smoke_test {
                    "Direct USB HID ready (smoke test mode)".into()
                } else {
                    "Direct USB HID scanning…".into()
                },
                direct_nvapi: Vec::new(),
                direct_nvapi_status: if smoke_test {
                    "NVIDIA NVAPI ready (smoke test mode)".into()
                } else {
                    "NVIDIA NVAPI scanning…".into()
                },
                direct_smbus: Vec::new(),
                direct_smbus_status: if smoke_test {
                    "PawnIO SMBus ready (smoke test mode)".into()
                } else {
                    "PawnIO SMBus scanning…".into()
                },
                smbus_needs_admin: false,
                device_previews: HashMap::new(),
                device_modes: HashMap::new(),
                openrgb_client: None,
                openrgb_protocol: 0,
                openrgb_error: None,
                openrgb_devices: Vec::new(),
                win11_devices: Vec::new(),
                win11_handles: HashMap::new(),
                win11_status: if smoke_test {
                    "Windows 11 Dynamic Lighting ready (smoke test mode)".into()
                } else {
                    "Windows 11 Dynamic Lighting scanning…".into()
                },
                openrgb_exe_path: None,
                live_color: initial_color,
                live_cpu_temp: None,
                live_gpu_temp: None,
                last_pushed_frame: None,
                alert_flash_until: None,
                diagnostic_json: None,
                message: initial_msg,
                phase: 0.0,
            }),
            wake: Condvar::new(),
            stop: AtomicBool::new(false),
            scanning: AtomicBool::new(false),
            smoke_test,
        });
        if !smoke_test {
            if sync_scan {
                engine.perform_rescan(false);
            } else {
                let bg = engine.clone();
                thread::spawn(move || {
                    if !bg.stop.load(Ordering::Acquire) {
                        bg.perform_rescan(true);
                    }
                });
            }
            Self::spawn_animator(engine.clone());
        }
        engine
    }

    pub fn needs_thermal_telemetry(&self) -> bool {
        let guard = self.lock_inner();
        matches!(
            guard.config.effect,
            RgbEffect::ThermalCpu | RgbEffect::ThermalGpu
        )
    }

    pub fn trigger_alert_flash(&self) {
        if self.smoke_test {
            return;
        }
        let mut guard = self.lock_inner();
        if !guard.config.alert_flash_enabled || guard.config.effect == RgbEffect::Blackout {
            return;
        }
        guard.alert_flash_until = Some(Instant::now() + Duration::from_millis(1800));
        guard.last_pushed_frame = None;
        self.wake.notify_all();
    }

    fn perform_rescan(&self, restore_saved_effect: bool) {
        if self.smoke_test {
            return;
        }
        if self.scanning.swap(true, Ordering::AcqRel) {
            return;
        }
        let _flag_guard = FlagGuard(&self.scanning);
        let old_handles = {
            let mut guard = self.lock_inner();
            (
                std::mem::take(&mut guard.direct_hid),
                std::mem::take(&mut guard.direct_nvapi),
                std::mem::take(&mut guard.direct_smbus),
                std::mem::take(&mut guard.win11_handles),
            )
        };
        drop(old_handles);

        let bundle = scan_all_native_hardware();
        if self.stop.load(Ordering::Acquire) {
            return;
        }
        let mut guard = self.lock_inner();
        guard.direct_hid = bundle.direct_hid;
        guard.direct_hid_status = bundle.direct_hid_status;
        guard.direct_nvapi = bundle.direct_nvapi;
        guard.direct_nvapi_status = bundle.direct_nvapi_status;
        guard.direct_smbus = bundle.direct_smbus;
        guard.direct_smbus_status = bundle.direct_smbus_status;
        guard.smbus_needs_admin = bundle.smbus_needs_admin;
        guard.win11_devices = bundle.win11_devices;
        guard.win11_handles = bundle.win11_handles;
        guard.win11_status = bundle.win11_status;
        guard.openrgb_exe_path = bundle.openrgb_exe_path;
        guard.last_pushed_frame = None;
        if let Some(client) = guard.openrgb_client.as_mut() {
            match client.enumerate_devices() {
                Ok(devs) => {
                    guard.openrgb_devices = devs;
                    guard.openrgb_error = None;
                }
                Err(err) => {
                    guard.openrgb_client = None;
                    guard.openrgb_devices.clear();
                    guard.openrgb_error = Some(err);
                }
            }
        }
        let total = guard.direct_hid.len()
            + guard.direct_nvapi.len()
            + guard.direct_smbus.len()
            + guard.win11_devices.len()
            + guard.openrgb_devices.len();
        if restore_saved_effect && guard.config.restore_on_launch && total > 0 {
            guard.live_color = compute_master_color(&guard);
            push_frame_locked(&mut guard, true);
        }
        guard.message = format!(
            "Hardware scan complete: {} USB HID · {} GPU NVAPI · {} RAM SMBus · {} Win11 LampArray ({total} total).",
            guard.direct_hid.len(),
            guard.direct_nvapi.len(),
            guard.direct_smbus.len(),
            guard.win11_devices.len()
        );
        self.wake.notify_all();
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
        self.wake.notify_all();
        let mut guard = self.lock_inner();
        guard.win11_handles.clear();
        guard.direct_hid.clear();
        guard.direct_nvapi.clear();
        guard.direct_smbus.clear();
        guard.openrgb_client = None;
        guard.openrgb_devices.clear();
    }

    pub fn update_telemetry(&self, cpu_temp: Option<f64>, gpu_temp: Option<f64>) {
        let mut guard = self.lock_inner();
        let changed = guard.live_cpu_temp != cpu_temp || guard.live_gpu_temp != gpu_temp;
        guard.live_cpu_temp = cpu_temp;
        guard.live_gpu_temp = gpu_temp;
        if changed
            && matches!(
                guard.config.effect,
                RgbEffect::ThermalCpu | RgbEffect::ThermalGpu
            )
        {
            self.wake.notify_one();
        }
    }

    pub fn on_profile_activated(&self, profile_id: &str) {
        if self.smoke_test {
            return;
        }
        let preset_id = {
            let guard = self.lock_inner();
            if !guard.config.auto_sync_profiles {
                return;
            }
            guard.config.profile_bindings.get(profile_id).cloned()
        };
        if let Some(pid) = preset_id {
            let _ = self.execute(RgbAction::ApplyPreset { id: pid });
        }
    }

    pub fn snapshot(&self) -> RgbStateSnapshot {
        let guard = self.lock_inner();
        self.snapshot_locked(&guard)
    }

    fn snapshot_locked(&self, guard: &RgbInner) -> RgbStateSnapshot {
        let default_hex = guard.live_color.to_hex();
        let mut devices = Vec::new();
        for dev in &guard.direct_hid {
            let preview = guard
                .device_previews
                .get(dev.id())
                .map(String::as_str)
                .unwrap_or(&default_hex);
            let mode = *guard.device_modes.get(dev.id()).unwrap_or(&0);
            devices.push(dev.to_device_info(preview, mode));
        }
        for dev in &guard.direct_nvapi {
            let preview = guard
                .device_previews
                .get(&dev.id)
                .map(String::as_str)
                .unwrap_or(&default_hex);
            let mode = *guard.device_modes.get(&dev.id).unwrap_or(&0);
            devices.push(dev.to_device_info(preview, mode));
        }
        for dev in &guard.direct_smbus {
            let preview = guard
                .device_previews
                .get(dev.id())
                .map(String::as_str)
                .unwrap_or(&default_hex);
            let mode = *guard.device_modes.get(dev.id()).unwrap_or(&0);
            devices.push(dev.to_device_info(preview, mode));
        }
        devices.extend(guard.win11_devices.clone());
        devices.extend(guard.openrgb_devices.clone());
        let mut presets = builtin_presets();
        presets.extend(guard.config.custom_presets.clone());
        let has_devices = !devices.is_empty();
        RgbStateSnapshot {
            direct_hid_count: guard.direct_hid.len(),
            direct_hid_status: guard.direct_hid_status.clone(),
            direct_nvapi_count: guard.direct_nvapi.len(),
            direct_nvapi_status: guard.direct_nvapi_status.clone(),
            direct_smbus_count: guard.direct_smbus.len(),
            direct_smbus_status: guard.direct_smbus_status.clone(),
            smbus_needs_admin: guard.smbus_needs_admin,
            openrgb_connected: guard.openrgb_client.is_some(),
            openrgb_protocol: guard.openrgb_protocol,
            openrgb_error: guard.openrgb_error.clone(),
            openrgb_exe_path: guard.openrgb_exe_path.clone(),
            win11_lamp_count: guard.win11_devices.len(),
            win11_status: guard.win11_status.clone(),
            devices,
            config: guard.config.clone(),
            presets,
            live_color_hex: default_hex,
            live_cpu_temp: guard.live_cpu_temp,
            live_gpu_temp: guard.live_gpu_temp,
            engine_running: has_devices && guard.config.effect.is_animated(),
            diagnostic_json: guard.diagnostic_json.clone(),
            message: guard.message.clone(),
        }
    }

    fn persist_config(&self, cfg: &RgbConfig) {
        if let Some(path) = &self.file
            && let Some(parent) = path.parent()
        {
            let _ = fs::create_dir_all(parent);
            if let Ok(bytes) = serde_json::to_vec_pretty(cfg) {
                if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(parent)
                    && tmp.write_all(&bytes).is_ok()
                    && tmp.persist(path).is_ok()
                {
                    return;
                }
                let _ = fs::write(path, bytes);
            }
        }
    }

    pub fn execute(&self, action: RgbAction) -> Result<RgbStateSnapshot, String> {
        match action {
            RgbAction::Connect { host, port } => {
                let host = if host.trim().is_empty() {
                    "127.0.0.1".to_owned()
                } else {
                    host.trim().to_owned()
                };
                let port = if port == 0 { 6742 } else { port };
                if self.smoke_test {
                    let mut guard = self.lock_inner();
                    guard.config.host = host;
                    guard.config.port = port;
                    guard.message = "OpenRGB connection skipped in smoke test mode.".into();
                    return Ok(self.snapshot_locked(&guard));
                }
                let connect_res = OpenRgbClient::connect(&host, port);
                let mut guard = self.lock_inner();
                guard.config.host = host.clone();
                guard.config.port = port;
                self.persist_config(&guard.config);
                match connect_res {
                    Ok(mut client) => {
                        let proto = client.protocol;
                        let devs = client.enumerate_devices().unwrap_or_default();
                        let count = devs.len();
                        guard.openrgb_protocol = proto;
                        guard.openrgb_devices = devs;
                        guard.openrgb_client = Some(client);
                        guard.openrgb_error = None;
                        guard.last_pushed_frame = None;
                        guard.message = format!(
                            "Connected to OpenRGB SDK v{proto} at {host}:{port} · {count} controller(s) discovered."
                        );
                        self.wake.notify_all();
                        Ok(self.snapshot_locked(&guard))
                    }
                    Err(err) => {
                        guard.openrgb_client = None;
                        guard.openrgb_devices.clear();
                        guard.openrgb_error = Some(err.clone());
                        guard.message = err;
                        Ok(self.snapshot_locked(&guard))
                    }
                }
            }
            RgbAction::Disconnect => {
                let mut guard = self.lock_inner();
                guard.openrgb_client = None;
                guard.openrgb_devices.clear();
                guard.openrgb_protocol = 0;
                guard.openrgb_error = None;
                guard.message = "Disconnected from OpenRGB SDK server.".into();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::Rescan => {
                self.perform_rescan(false);
                let mut guard = self.lock_inner();
                if self.smoke_test {
                    guard.message = "Hardware scan complete (smoke test mode).".into();
                }
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::ApplyEffect {
                effect,
                primary_hex,
                secondary_hex,
                brightness,
                speed,
            } => {
                let primary = RgbColor::from_hex(&primary_hex)
                    .ok_or("Primary color must be a valid 6-digit hex color.")?;
                let secondary = RgbColor::from_hex(&secondary_hex)
                    .ok_or("Secondary color must be a valid 6-digit hex color.")?;
                let mut guard = self.lock_inner();
                guard.config.effect = effect;
                guard.config.primary_hex = primary.to_hex();
                guard.config.secondary_hex = secondary.to_hex();
                guard.config.brightness = brightness.min(100);
                guard.config.speed = speed.min(100);
                self.persist_config(&guard.config);
                let frame_color = compute_master_color(&guard);
                guard.live_color = frame_color;
                guard.last_pushed_frame = None;
                if !self.smoke_test {
                    push_frame_locked(&mut guard, true);
                }
                guard.message = format!(
                    "Applied {:?} effect at {}% brightness ({}).",
                    effect,
                    guard.config.brightness,
                    frame_color.to_hex()
                );
                self.wake.notify_all();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::SyncThemeAccent { accent_hex } => {
                let accent = RgbColor::from_hex(&accent_hex)
                    .ok_or("Theme accent must be a valid hex color.")?;
                let mut guard = self.lock_inner();
                guard.config.theme_accent_hex = accent.to_hex();
                guard.config.primary_hex = accent.to_hex();
                guard.config.effect = RgbEffect::ThemeSync;
                if guard.config.brightness == 0 {
                    guard.config.brightness = 85;
                }
                self.persist_config(&guard.config);
                guard.live_color = accent.scale(guard.config.brightness);
                guard.last_pushed_frame = None;
                if !self.smoke_test {
                    push_frame_locked(&mut guard, true);
                }
                guard.message = format!("Synced RGB lighting to Theme Studio accent {}.", accent.to_hex());
                self.wake.notify_all();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::SetDeviceColor {
                device_id,
                zone_index,
                color_hex,
            } => {
                let color = RgbColor::from_hex(&color_hex)
                    .ok_or("Device color must be a valid hex color.")?;
                let mut guard = self.lock_inner();
                guard.last_pushed_frame = None;
                // Automatically pin device so master animations don't overwrite manual color overrides.
                if !guard.config.pinned_devices.contains(&device_id) {
                    guard.config.pinned_devices.push(device_id.clone());
                    self.persist_config(&guard.config);
                }
                let brightness = guard.config.brightness.max(10);
                let scaled = color.scale(brightness);
                if let Some(pos) = guard.direct_hid.iter().position(|d| d.id() == device_id) {
                    let dev_name = guard.direct_hid[pos].name().to_owned();
                    if !self.smoke_test {
                        guard.direct_hid[pos].set_zone_color(zone_index, color, brightness)?;
                    }
                    guard.device_previews.insert(device_id, scaled.to_hex());
                    guard.message = format!("Updated {dev_name} to {}.", scaled.to_hex());
                    Ok(self.snapshot_locked(&guard))
                } else if let Some(pos) = guard.direct_nvapi.iter().position(|d| d.id == device_id) {
                    let dev_name = guard.direct_nvapi[pos].name.clone();
                    if !self.smoke_test {
                        guard.direct_nvapi[pos].set_all_direct(&[scaled])?;
                    }
                    guard.device_previews.insert(device_id, scaled.to_hex());
                    guard.message = format!("Updated {dev_name} to {}.", scaled.to_hex());
                    Ok(self.snapshot_locked(&guard))
                } else if let Some(pos) = guard.direct_smbus.iter().position(|d| d.id() == device_id) {
                    let dev_name = guard.direct_smbus[pos].name().to_owned();
                    if !self.smoke_test {
                        guard.direct_smbus[pos].apply_effect(
                            RgbEffect::Static,
                            scaled,
                            brightness,
                            0.0,
                        )?;
                    }
                    guard.device_previews.insert(device_id, scaled.to_hex());
                    guard.message = format!("Updated {dev_name} to {}.", scaled.to_hex());
                    Ok(self.snapshot_locked(&guard))
                } else if let Some(pos) = guard.openrgb_devices.iter().position(|d| d.id == device_id) {
                    let dev_index = guard.openrgb_devices[pos].index;
                    let led_count = guard.openrgb_devices[pos].led_count.max(1);
                    let zone_led_count = zone_index
                        .and_then(|zi| guard.openrgb_devices[pos].zones.get(zi))
                        .map(|z| z.led_count as usize);
                    if !self.smoke_test
                        && let Some(client) = guard.openrgb_client.as_mut()
                    {
                        let _ = client.set_custom_mode(dev_index);
                        if let (Some(zi), Some(zleds)) = (zone_index, zone_led_count) {
                            let buf = vec![scaled; zleds.max(1)];
                            client.update_zone_leds(dev_index, zi as u32, &buf)?;
                        } else {
                            let buf = vec![scaled; led_count];
                            client.update_leds(dev_index, &buf)?;
                        }
                    }
                    guard.openrgb_devices[pos].preview_hex = scaled.to_hex();
                    guard.message = format!(
                        "Updated {} to {}.",
                        guard.openrgb_devices[pos].name,
                        scaled.to_hex()
                    );
                    Ok(self.snapshot_locked(&guard))
                } else if let Some(pos) = guard.win11_devices.iter().position(|d| d.id == device_id)
                {
                    let lamp_id = guard.win11_devices[pos].lamp_array_id.clone();
                    if !self.smoke_test
                        && let Some(ref lid) = lamp_id
                    {
                        push_win11_lamp_color(&mut guard.win11_handles, lid, scaled, true)?;
                    }
                    guard.win11_devices[pos].preview_hex = scaled.to_hex();
                    guard.message = format!(
                        "Updated {} to {}.",
                        guard.win11_devices[pos].name,
                        scaled.to_hex()
                    );
                    Ok(self.snapshot_locked(&guard))
                } else {
                    Err("Selected RGB device was not found.".into())
                }
            }
            RgbAction::SetDeviceMode {
                device_id,
                mode_index,
            } => {
                let mut guard = self.lock_inner();
                guard.last_pushed_frame = None;
                if !guard.config.pinned_devices.contains(&device_id) {
                    guard.config.pinned_devices.push(device_id.clone());
                    self.persist_config(&guard.config);
                }
                let primary = RgbColor::from_hex(&guard.config.primary_hex).unwrap_or(RgbColor {
                    r: 49,
                    g: 130,
                    b: 206,
                });
                let secondary = RgbColor::from_hex(&guard.config.secondary_hex).unwrap_or(primary);
                let brightness = guard.config.brightness;
                let speed = guard.config.speed;
                if let Some(pos) = guard.direct_hid.iter().position(|d| d.id() == device_id) {
                    let dev_name = guard.direct_hid[pos].name().to_owned();
                    if !self.smoke_test {
                        guard.direct_hid[pos].set_hardware_mode(
                            mode_index,
                            primary,
                            secondary,
                            brightness,
                            speed,
                        )?;
                    }
                    guard.device_modes.insert(device_id, mode_index);
                    guard.message = format!("Updated hardware mode on {dev_name}.");
                    return Ok(self.snapshot_locked(&guard));
                }
                if let Some(pos) = guard.direct_nvapi.iter().position(|d| d.id == device_id) {
                    let dev_name = guard.direct_nvapi[pos].name.clone();
                    if !self.smoke_test {
                        guard.direct_nvapi[pos].set_hardware_mode(
                            mode_index,
                            primary.scale(brightness),
                            speed,
                        )?;
                    }
                    guard.device_modes.insert(device_id, mode_index);
                    guard.message = format!("Updated GPU hardware mode on {dev_name}.");
                    return Ok(self.snapshot_locked(&guard));
                }
                if let Some(pos) = guard.direct_smbus.iter().position(|d| d.id() == device_id) {
                    let dev_name = guard.direct_smbus[pos].name().to_owned();
                    if !self.smoke_test {
                        guard.direct_smbus[pos].set_hardware_mode(
                            mode_index,
                            primary,
                            secondary,
                            brightness,
                            speed,
                        )?;
                    }
                    guard.device_modes.insert(device_id, mode_index);
                    guard.message = format!("Updated RAM hardware mode on {dev_name}.");
                    return Ok(self.snapshot_locked(&guard));
                }
                let pos = guard
                    .openrgb_devices
                    .iter()
                    .position(|d| d.id == device_id)
                    .ok_or("Hardware mode switching is not supported on this device.")?;
                let dev_index = guard.openrgb_devices[pos].index;
                let mode = guard.openrgb_devices[pos]
                    .modes
                    .get(mode_index)
                    .cloned()
                    .ok_or("Selected hardware mode index is out of range.")?;
                if !self.smoke_test
                    && let Some(client) = guard.openrgb_client.as_mut()
                    && !mode.raw_bytes.is_empty()
                {
                    client.update_mode(dev_index, mode_index as i32, &mode.raw_bytes)?;
                }
                guard.openrgb_devices[pos].active_mode_index = mode_index;
                guard.openrgb_devices[pos].active_mode_name = mode.name.clone();
                guard.message = format!(
                    "Set {} hardware mode to '{}'.",
                    guard.openrgb_devices[pos].name, mode.name
                );
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::SetDevicePinned { device_id, pinned } => {
                let mut guard = self.lock_inner();
                if pinned {
                    if !guard.config.pinned_devices.contains(&device_id) {
                        guard.config.pinned_devices.push(device_id);
                    }
                    guard.message = "Pinned device to independent manual lighting.".into();
                } else {
                    guard.config.pinned_devices.retain(|id| id != &device_id);
                    guard.last_pushed_frame = None;
                    if !self.smoke_test {
                        push_frame_locked(&mut guard, true);
                    }
                    guard.message = "Synced device back to Master Effect.".into();
                }
                self.persist_config(&guard.config);
                self.wake.notify_all();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::DiagnosticReadback => {
                let mut guard = self.lock_inner();
                let mut list = Vec::new();
                if !self.smoke_test {
                    for dev in &guard.direct_hid {
                        list.push(dev.diagnostic_readback());
                    }
                    for dev in &guard.direct_nvapi {
                        list.push(dev.diagnostic_readback());
                    }
                }
                let report = serde_json::json!({
                    "directHid": guard.direct_hid_status,
                    "directNvapi": guard.direct_nvapi_status,
                    "directSmbus": guard.direct_smbus_status,
                    "win11LampArray": guard.win11_status,
                    "hardwareReadbacks": list,
                });
                guard.diagnostic_json = Some(
                    serde_json::to_string_pretty(&report).unwrap_or_else(|e| e.to_string()),
                );
                guard.message = format!(
                    "Hardware diagnostics captured ({} device readback(s)).",
                    list.len()
                );
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::Blackout => {
                let mut guard = self.lock_inner();
                guard.config.effect = RgbEffect::Blackout;
                guard.config.pinned_devices.clear();
                guard.live_color = RgbColor::BLACK;
                guard.last_pushed_frame = None;
                guard.alert_flash_until = None;
                self.persist_config(&guard.config);
                if !self.smoke_test {
                    push_frame_locked(&mut guard, true);
                }
                guard.message = "Stealth Blackout applied — all connected RGB LEDs turned off.".into();
                self.wake.notify_all();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::SavePreset { name } => {
                let clean = name.trim();
                if clean.is_empty() {
                    return Err("Enter a name for the RGB preset.".into());
                }
                let mut guard = self.lock_inner();
                let slug = clean
                    .to_ascii_lowercase()
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                    .collect::<String>()
                    .trim_matches('-')
                    .to_owned();
                let id = format!(
                    "custom-{}",
                    if slug.is_empty() { "preset" } else { &slug }
                );
                let preset = RgbPreset {
                    id: id.clone(),
                    name: clean.to_owned(),
                    effect: guard.config.effect,
                    primary_hex: guard.config.primary_hex.clone(),
                    secondary_hex: guard.config.secondary_hex.clone(),
                    brightness: guard.config.brightness,
                    speed: guard.config.speed,
                    builtin: false,
                };
                if let Some(existing) = guard
                    .config
                    .custom_presets
                    .iter_mut()
                    .find(|p| p.id == id)
                {
                    *existing = preset;
                } else {
                    guard.config.custom_presets.push(preset);
                }
                self.persist_config(&guard.config);
                guard.message = format!("Saved RGB preset '{clean}'.");
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::ApplyPreset { id } => {
                let mut guard = self.lock_inner();
                let mut all = builtin_presets();
                all.extend(guard.config.custom_presets.clone());
                let preset = all
                    .into_iter()
                    .find(|p| p.id == id)
                    .ok_or("Selected RGB preset was not found.")?;
                guard.config.effect = preset.effect;
                if preset.effect != RgbEffect::ThemeSync {
                    guard.config.primary_hex = preset.primary_hex.clone();
                } else {
                    guard.config.primary_hex = guard.config.theme_accent_hex.clone();
                }
                guard.config.secondary_hex = preset.secondary_hex.clone();
                guard.config.brightness = preset.brightness;
                guard.config.speed = preset.speed;
                self.persist_config(&guard.config);
                guard.live_color = compute_master_color(&guard);
                guard.last_pushed_frame = None;
                if !self.smoke_test {
                    push_frame_locked(&mut guard, true);
                }
                guard.message = format!("Activated RGB preset '{}'.", preset.name);
                self.wake.notify_all();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::DeletePreset { id } => {
                let mut guard = self.lock_inner();
                let before = guard.config.custom_presets.len();
                guard.config.custom_presets.retain(|p| p.id != id);
                if guard.config.custom_presets.len() == before {
                    return Err("Built-in presets cannot be deleted.".into());
                }
                self.persist_config(&guard.config);
                guard.message = "Deleted custom RGB preset.".into();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::SetProfileSync { enabled, bindings } => {
                let mut guard = self.lock_inner();
                guard.config.auto_sync_profiles = enabled;
                if let Some(map) = bindings {
                    guard.config.profile_bindings = map;
                }
                self.persist_config(&guard.config);
                guard.message = if enabled {
                    "System Profiles → RGB auto-sync enabled.".into()
                } else {
                    "System Profiles → RGB auto-sync disabled.".into()
                };
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::LaunchOpenrgb => {
                if self.smoke_test {
                    return Ok(self.snapshot());
                }
                let exe = detect_openrgb_executable().ok_or(
                    "OpenRGB.exe was not found in standard folders. Install OpenRGB (e.g. via App Installer / winget install OpenRGB.OpenRGB) and try again.",
                )?;
                let (host, port) = {
                    let guard = self.lock_inner();
                    (guard.config.host.clone(), guard.config.port)
                };
                Command::new(&exe)
                    .args([
                        "--server",
                        "--startminimized",
                        "--server-port",
                        &port.to_string(),
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| format!("Failed to launch OpenRGB: {e}"))?;
                // Give OpenRGB SDK server a brief moment to bind TCP port, then try connecting.
                for _ in 0..8 {
                    thread::sleep(Duration::from_millis(350));
                    if let Ok(mut client) = OpenRgbClient::connect(&host, port) {
                        let mut guard = self.lock_inner();
                        guard.openrgb_protocol = client.protocol;
                        guard.openrgb_devices = client.enumerate_devices().unwrap_or_default();
                        guard.openrgb_client = Some(client);
                        guard.openrgb_error = None;
                        guard.openrgb_exe_path = Some(exe);
                        guard.last_pushed_frame = None;
                        guard.message = format!(
                            "Launched OpenRGB SDK Server & connected · {} controller(s) ready.",
                            guard.openrgb_devices.len()
                        );
                        self.wake.notify_all();
                        return Ok(self.snapshot_locked(&guard));
                    }
                }
                let mut guard = self.lock_inner();
                guard.openrgb_exe_path = Some(exe);
                guard.message = "OpenRGB launched in headless SDK mode — click Connect once it finishes detecting hardware.".into();
                Ok(self.snapshot_locked(&guard))
            }
            RgbAction::OpenDynamicLightingSettings => {
                if !self.smoke_test {
                    dashboard_actions::shell_open("ms-settings:personalization-lighting", None, false)?;
                }
                let mut guard = self.lock_inner();
                guard.message = "Opened Windows 11 Dynamic Lighting settings.".into();
                Ok(self.snapshot_locked(&guard))
            }
        }
    }

    fn spawn_animator(engine: Arc<Self>) {
        thread::spawn(move || {
            let mut last_tick = Instant::now();
            loop {
                let mut guard = engine.lock_inner();
                while !engine.stop.load(Ordering::Acquire)
                    && ((!guard.config.effect.is_animated()
                        && guard.alert_flash_until.is_none())
                        || (guard.direct_hid.is_empty()
                            && guard.direct_nvapi.is_empty()
                            && guard.direct_smbus.is_empty()
                            && (guard.openrgb_client.is_none() || guard.openrgb_devices.is_empty())
                            && guard.win11_devices.is_empty()))
                {
                    guard = engine.wake.wait(guard).unwrap_or_else(|e| e.into_inner());
                    last_tick = Instant::now();
                }
                if engine.stop.load(Ordering::Acquire) {
                    return;
                }
                let now = Instant::now();
                let dt = now.saturating_duration_since(last_tick).as_secs_f32();
                last_tick = now;
                let speed_factor = 0.25 + (guard.config.speed as f32 / 100.0) * 2.2;
                guard.phase = (guard.phase + dt * speed_factor) % 1000.0;
                let flashing = match guard.alert_flash_until {
                    Some(until) if now < until => true,
                    Some(_) => {
                        guard.alert_flash_until = None;
                        guard.last_pushed_frame = None;
                        false
                    }
                    None => false,
                };
                if flashing {
                    let pulse_on = (now.elapsed().as_millis() / 220).is_multiple_of(2);
                    guard.live_color = if pulse_on {
                        RgbColor { r: 255, g: 40, b: 30 }
                    } else {
                        RgbColor { r: 255, g: 145, b: 0 }
                    };
                } else {
                    guard.live_color = compute_master_color(&guard);
                }
                push_frame_locked(&mut guard, flashing);
                let sleep_ms = if flashing {
                    180
                } else {
                    match guard.config.effect {
                        RgbEffect::ThermalCpu | RgbEffect::ThermalGpu => 300,
                        _ => 65,
                    }
                };
                let (next_guard, _) = engine
                    .wake
                    .wait_timeout(guard, Duration::from_millis(sleep_ms))
                    .unwrap_or_else(|e| e.into_inner());
                drop(next_guard);
            }
        });
    }
}

fn compute_master_color(guard: &RgbInner) -> RgbColor {
    let primary = RgbColor::from_hex(&guard.config.primary_hex).unwrap_or(RgbColor {
        r: 49,
        g: 130,
        b: 206,
    });
    let secondary = RgbColor::from_hex(&guard.config.secondary_hex).unwrap_or(RgbColor {
        r: 159,
        g: 122,
        b: 234,
    });
    let brightness = guard.config.brightness;
    match guard.config.effect {
        RgbEffect::Static => primary.scale(brightness),
        RgbEffect::ThemeSync => RgbColor::from_hex(&guard.config.theme_accent_hex)
            .unwrap_or(primary)
            .scale(brightness),
        RgbEffect::Blackout => RgbColor::BLACK,
        RgbEffect::Breathing => {
            let wave = (guard.phase * std::f32::consts::PI).sin() * 0.5 + 0.5;
            let amp = 0.12 + 0.88 * wave;
            primary.scale(((brightness as f32) * amp).round() as u8)
        }
        RgbEffect::DualPulse => {
            let wave = (guard.phase * std::f32::consts::PI).sin() * 0.5 + 0.5;
            primary.lerp(secondary, wave).scale(brightness)
        }
        RgbEffect::Rainbow => {
            let hue = (guard.phase * 60.0) % 360.0;
            RgbColor::from_hsv(hue, 1.0, (brightness as f32) / 100.0)
        }
        RgbEffect::ThermalCpu => {
            let temp = guard.live_cpu_temp.unwrap_or(42.0);
            RgbColor::from_temperature(temp).scale(brightness)
        }
        RgbEffect::ThermalGpu => {
            let temp = guard.live_gpu_temp.unwrap_or(42.0);
            RgbColor::from_temperature(temp).scale(brightness)
        }
    }
}

fn compute_unscaled_color_and_brightness(guard: &RgbInner) -> (RgbColor, u8) {
    let primary = RgbColor::from_hex(&guard.config.primary_hex).unwrap_or(RgbColor {
        r: 49,
        g: 130,
        b: 206,
    });
    let secondary = RgbColor::from_hex(&guard.config.secondary_hex).unwrap_or(RgbColor {
        r: 159,
        g: 122,
        b: 234,
    });
    let brightness = guard.config.brightness;
    match guard.config.effect {
        RgbEffect::Static => (primary, brightness),
        RgbEffect::ThemeSync => (
            RgbColor::from_hex(&guard.config.theme_accent_hex).unwrap_or(primary),
            brightness,
        ),
        RgbEffect::Blackout => (RgbColor::BLACK, 0),
        RgbEffect::Breathing => {
            let wave = (guard.phase * std::f32::consts::PI).sin() * 0.5 + 0.5;
            let amp = 0.12 + 0.88 * wave;
            (primary, ((brightness as f32) * amp).round() as u8)
        }
        RgbEffect::DualPulse => {
            let wave = (guard.phase * std::f32::consts::PI).sin() * 0.5 + 0.5;
            (primary.lerp(secondary, wave), brightness)
        }
        RgbEffect::Rainbow => {
            let hue = (guard.phase * 60.0) % 360.0;
            (RgbColor::from_hsv(hue, 1.0, 1.0), brightness)
        }
        RgbEffect::ThermalCpu => (
            RgbColor::from_temperature(guard.live_cpu_temp.unwrap_or(42.0)),
            brightness,
        ),
        RgbEffect::ThermalGpu => (
            RgbColor::from_temperature(guard.live_gpu_temp.unwrap_or(42.0)),
            brightness,
        ),
    }
}

fn push_frame_locked(guard: &mut RgbInner, enter_direct_mode: bool) {
    let master = guard.live_color;
    let effect = guard.config.effect;
    let brightness = guard.config.brightness;
    let phase = guard.phase;
    let (unscaled_color, eff_brightness) = compute_unscaled_color_and_brightness(guard);
    let frame_sig = (effect, master, eff_brightness);
    // Skip redundant hardware writes on steady frames (especially ThermalCpu/ThermalGpu at 300ms)
    if !enter_direct_mode
        && effect != RgbEffect::Rainbow
        && guard.last_pushed_frame == Some(frame_sig)
    {
        return;
    }
    guard.last_pushed_frame = Some(frame_sig);
    let hex = master.to_hex();
    let pinned: Vec<String> = if effect == RgbEffect::Blackout {
        Vec::new()
    } else {
        guard.config.pinned_devices.clone()
    };

    // 1. Native Direct USB HID (Gigabyte RGB Fusion 2.0, Razer Chroma, etc.)
    let mut updated_ids = Vec::new();
    let mut hid_err: Option<String> = None;
    for dev in &mut guard.direct_hid {
        if pinned.iter().any(|p| p == dev.id()) {
            continue;
        }
        if let Err(err) =
            dev.apply_effect(effect, unscaled_color, brightness, eff_brightness, phase)
        {
            hid_err = Some(format!("{}: {err}", dev.name()));
        }
        updated_ids.push(dev.id().to_owned());
    }
    if let Some(err) = hid_err {
        guard.direct_hid_status = format!("Direct USB HID warning: {err}");
    }

    // 2. Native NVIDIA NVAPI I2C GPU (ASUS TUF / ROG ENE Aura GPUs)
    let mut nvapi_err: Option<String> = None;
    for dev in &mut guard.direct_nvapi {
        if pinned.iter().any(|p| p == &dev.id) {
            continue;
        }
        if let Err(err) = dev.apply_effect(effect, master, eff_brightness, phase) {
            nvapi_err = Some(format!("{}: {err}", dev.name));
        }
        updated_ids.push(dev.id.clone());
    }
    if let Some(err) = nvapi_err {
        guard.direct_nvapi_status = format!("NVIDIA NVAPI warning: {err}");
    }

    // 3. Native PawnIO SMBus DRAM (Corsair Vengeance Pro / Dominator / G.Skill ENE)
    let mut smbus_err: Option<String> = None;
    for dev in &mut guard.direct_smbus {
        if pinned.iter().any(|p| p == dev.id()) {
            continue;
        }
        if let Err(err) = dev.apply_effect(effect, master, eff_brightness, phase) {
            smbus_err = Some(format!("{}: {err}", dev.name()));
        }
        updated_ids.push(dev.id().to_owned());
    }
    if let Some(err) = smbus_err {
        guard.direct_smbus_status = format!("PawnIO SMBus warning: {err}");
    }
    for id in updated_ids {
        guard.device_previews.insert(id, hex.clone());
    }

    // 4. Optional OpenRGB SDK controllers
    if guard.openrgb_client.is_some() {
        let mut disconnected = false;
        let device_specs: Vec<(String, u32, usize)> = guard
            .openrgb_devices
            .iter()
            .filter(|d| !pinned.iter().any(|p| p == &d.id))
            .map(|d| (d.id.clone(), d.index, d.led_count.max(1)))
            .collect();
        if let Some(client) = guard.openrgb_client.as_mut() {
            for (_id, dev_idx, led_count) in &device_specs {
                if enter_direct_mode {
                    let _ = client.set_custom_mode(*dev_idx);
                }
                let colors: Vec<RgbColor> = if effect == RgbEffect::Rainbow && *led_count > 1 {
                    (0..*led_count)
                        .map(|i| {
                            let hue = (phase * 60.0 + (i as f32) * (360.0 / (*led_count as f32).max(8.0))) % 360.0;
                            RgbColor::from_hsv(hue, 1.0, (brightness as f32) / 100.0)
                        })
                        .collect()
                } else {
                    vec![master; *led_count]
                };
                if client.update_leds(*dev_idx, &colors).is_err() {
                    disconnected = true;
                    break;
                }
            }
        }
        if disconnected {
            guard.openrgb_client = None;
            guard.openrgb_devices.clear();
            guard.openrgb_error = Some("OpenRGB SDK connection was closed by the server.".into());
        } else {
            for dev in &mut guard.openrgb_devices {
                if !pinned.iter().any(|p| p == &dev.id) {
                    dev.preview_hex = hex.clone();
                }
            }
        }
    }

    // 5. Windows 11 Dynamic Lighting LampArrays (fallback for devices not claimed by Direct HID)
    let enabled = effect != RgbEffect::Blackout && brightness > 0;
    let lamp_targets: Vec<(usize, String, usize)> = guard
        .win11_devices
        .iter()
        .enumerate()
        .filter(|(_, d)| !pinned.iter().any(|p| p == &d.id))
        .filter_map(|(i, d)| d.lamp_array_id.clone().map(|lid| (i, lid, d.led_count)))
        .collect();
    let mut win11_err: Option<String> = None;
    for (idx, lamp_id, led_count) in lamp_targets {
        let res = if effect == RgbEffect::Rainbow && led_count > 1 && enabled {
            push_win11_lamp_rainbow(&mut guard.win11_handles, &lamp_id, led_count, phase, brightness)
        } else {
            push_win11_lamp_color(&mut guard.win11_handles, &lamp_id, master, enabled)
        };
        if let Err(err) = res {
            win11_err = Some(err);
        }
        guard.win11_devices[idx].preview_hex = hex.clone();
    }
    if let Some(err) = win11_err {
        guard.win11_status = err;
    }
}

/// CLI diagnostic helper (`--rgb-probe` / `--rgb-test <#rrggbb>`).
pub fn run_cli_probe(test_hex: Option<&str>) -> String {
    let engine = RgbEngine::open_internal(None, false, true);
    if let Some(hex) = test_hex {
        let _ = engine.execute(RgbAction::ApplyEffect {
            effect: RgbEffect::Static,
            primary_hex: hex.to_owned(),
            secondary_hex: hex.to_owned(),
            brightness: 85,
            speed: 50,
        });
        let readbacks = {
            let guard = engine.lock_inner();
            let mut list = Vec::new();
            for dev in &guard.direct_hid {
                list.push(dev.diagnostic_readback());
            }
            for dev in &guard.direct_nvapi {
                list.push(dev.diagnostic_readback());
            }
            list
        };
        let snap = engine.snapshot();
        engine.stop();
        return serde_json::to_string_pretty(&serde_json::json!({
            "snapshot": snap,
            "hardwareVerification": readbacks,
        }))
        .unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"));
    }
    let snap = engine.snapshot();
    engine.stop();
    serde_json::to_string_pretty(&snap).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openrgb_packet_framing_roundtrip() {
        let payload = [0x03, 0x00, 0x00, 0x00];
        let packet = encode_openrgb_packet(2, PKT_REQUEST_PROTOCOL_VERSION, &payload);
        assert_eq!(packet.len(), 20);
        let hdr: [u8; 16] = packet[..16].try_into().unwrap();
        let (dev_id, pkt_id, size) = decode_openrgb_header(&hdr).unwrap();
        assert_eq!(dev_id, 2);
        assert_eq!(pkt_id, PKT_REQUEST_PROTOCOL_VERSION);
        assert_eq!(size, 4);
    }

    #[test]
    fn parse_minimal_openrgb_controller_payload() {
        fn push_str(buf: &mut Vec<u8>, s: &str) {
            let len = (s.len() + 1) as u16;
            buf.extend_from_slice(&len.to_le_bytes());
            buf.extend_from_slice(s.as_bytes());
            buf.push(0);
        }
        let mut body = Vec::new();
        body.extend_from_slice(&0u32.to_le_bytes()); // data_size placeholder
        body.extend_from_slice(&5i32.to_le_bytes()); // Keyboard
        push_str(&mut body, "Corsair K70 RGB");
        push_str(&mut body, "Corsair");
        push_str(&mut body, "HID Keyboard");
        push_str(&mut body, "1.0");
        push_str(&mut body, "SER123");
        push_str(&mut body, "HID:0001");
        body.extend_from_slice(&1u16.to_le_bytes()); // 1 mode
        body.extend_from_slice(&0i32.to_le_bytes()); // active mode 0
        // Mode 0 (protocol v3)
        push_str(&mut body, "Direct");
        body.extend_from_slice(&0i32.to_le_bytes()); // value
        body.extend_from_slice(&0u32.to_le_bytes()); // flags
        body.extend_from_slice(&0u32.to_le_bytes()); // speed_min
        body.extend_from_slice(&0u32.to_le_bytes()); // speed_max
        body.extend_from_slice(&0u32.to_le_bytes()); // brightness_min (v3)
        body.extend_from_slice(&100u32.to_le_bytes()); // brightness_max (v3)
        body.extend_from_slice(&0u32.to_le_bytes()); // colors_min
        body.extend_from_slice(&0u32.to_le_bytes()); // colors_max
        body.extend_from_slice(&0u32.to_le_bytes()); // speed
        body.extend_from_slice(&100u32.to_le_bytes()); // brightness (v3)
        body.extend_from_slice(&0u32.to_le_bytes()); // direction
        body.extend_from_slice(&1u32.to_le_bytes()); // color_mode
        body.extend_from_slice(&0u16.to_le_bytes()); // 0 mode colors
        // Zones
        body.extend_from_slice(&1u16.to_le_bytes()); // 1 zone
        push_str(&mut body, "Main Keys");
        body.extend_from_slice(&1i32.to_le_bytes()); // linear
        body.extend_from_slice(&104u32.to_le_bytes());
        body.extend_from_slice(&104u32.to_le_bytes());
        body.extend_from_slice(&104u32.to_le_bytes());
        body.extend_from_slice(&0u16.to_le_bytes()); // matrix len 0
        // LEDs
        body.extend_from_slice(&2u16.to_le_bytes());
        push_str(&mut body, "Key: Esc");
        body.extend_from_slice(&0u32.to_le_bytes());
        push_str(&mut body, "Key: Enter");
        body.extend_from_slice(&1u32.to_le_bytes());
        // Colors
        body.extend_from_slice(&2u16.to_le_bytes());
        body.extend_from_slice(&[0x00, 0xB4, 0xFF, 0x00]);
        body.extend_from_slice(&[0x00, 0xB4, 0xFF, 0x00]);

        let dev = parse_controller_data(0, 3, &body).unwrap();
        assert_eq!(dev.name, "Corsair K70 RGB");
        assert_eq!(dev.vendor, "Corsair");
        assert_eq!(dev.device_type, "Keyboard");
        assert_eq!(dev.modes.len(), 1);
        assert_eq!(dev.modes[0].name, "Direct");
        assert_eq!(dev.zones.len(), 1);
        assert_eq!(dev.led_count, 104);
        assert_eq!(dev.preview_hex, "#00b4ff");
    }

    #[test]
    fn thermal_color_gradient_transitions_cool_to_hot() {
        let cold = RgbColor::from_temperature(35.0);
        let warm = RgbColor::from_temperature(72.0);
        let hot = RgbColor::from_temperature(90.0);
        assert!(cold.b > cold.r);
        assert!(warm.r > 200 && warm.g > 120);
        assert!(hot.r > 240 && hot.g < 50 && hot.b < 50);
    }

    #[test]
    fn rgb_color_hex_and_scaling() {
        let c = RgbColor::from_hex("#3182ce").unwrap();
        assert_eq!(c.to_hex(), "#3182ce");
        let half = c.scale(50);
        assert_eq!(half, RgbColor { r: 25, g: 65, b: 103 });
        assert!(RgbColor::from_hex("not-hex").is_none());
    }
}
