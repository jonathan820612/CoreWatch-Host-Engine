use crate::rgb_studio::{RgbBackend, RgbColor, RgbDeviceInfo, RgbEffect, RgbModeInfo, RgbZoneInfo};
use std::{ffi::c_void, mem, ptr, sync::Arc};
use windows_sys::Win32::{
    Foundation::{FreeLibrary, HMODULE},
    System::LibraryLoader::{GetProcAddress, LoadLibraryA},
};

// NVAPI Interface IDs (verified from NVAPI headers)
const NVAPI_ID_INITIALIZE: u32 = 0x0150_E828;
const NVAPI_ID_UNLOAD: u32 = 0xD22B_DD7E;
const NVAPI_ID_ENUM_PHYSICAL_GPUS: u32 = 0xE5AC_921F;
const NVAPI_ID_GPU_GET_FULL_NAME: u32 = 0xCEEE_8E9F;
const NVAPI_ID_GPU_GET_PCI_IDENTIFIERS: u32 = 0x2DDF_B66E;
const NVAPI_ID_I2C_WRITE_EX: u32 = 0x283A_C65A;
const NVAPI_ID_I2C_READ_EX: u32 = 0x4D7B_0709;

const NVIDIA_PCI_VEN: u16 = 0x10DE;
const ASUS_PCI_SUBVEN: u16 = 0x1043;

// ENE SMBus / I2C Registers (ASUS Aura GPU Gen2 / ENE 6K582)
const ENE_REG_DEVICE_NAME: u16 = 0x1000;
const ENE_REG_CONFIG_TABLE: u16 = 0x1C00;
const ENE_REG_COLORS_DIRECT_V1: u16 = 0x8000;
const ENE_REG_COLORS_EFFECT_V1: u16 = 0x8010;
const ENE_REG_DIRECT: u16 = 0x8020;
const ENE_REG_MODE: u16 = 0x8021;
const ENE_REG_SPEED: u16 = 0x8022;
const ENE_REG_DIRECTION: u16 = 0x8023;
const ENE_REG_APPLY: u16 = 0x80A0;
const ENE_REG_COLORS_DIRECT_V2: u16 = 0x8100;
const ENE_REG_COLORS_EFFECT_V2: u16 = 0x8160;

const ENE_APPLY_VAL: u8 = 0x01;
const ENE_MODE_OFF: u8 = 0;
const ENE_MODE_STATIC: u8 = 1;
const ENE_MODE_BREATHING: u8 = 2;
const ENE_MODE_SPECTRUM: u8 = 4;
const ENE_MODE_RAINBOW: u8 = 5;

#[repr(C)]
struct NvI2cInfoV3 {
    version: u32,
    display_mask: u32,
    is_ddc_port: u8,
    i2c_dev_address: u8,
    i2c_reg_address: *mut u8,
    reg_addr_size: u32,
    data: *mut u8,
    size: u32,
    i2c_speed: u32,
    i2c_speed_khz: u32,
    port_id: u8,
    is_port_id_set: u32,
}

impl NvI2cInfoV3 {
    fn new(dev_addr_7bit: u8, reg: *mut u8, reg_size: u32, data: *mut u8, data_size: u32) -> Self {
        Self {
            version: (mem::size_of::<Self>() as u32) | (3 << 16),
            display_mask: 0,
            is_ddc_port: 0,
            i2c_dev_address: dev_addr_7bit << 1,
            i2c_reg_address: reg,
            reg_addr_size: reg_size,
            data,
            size: data_size,
            i2c_speed: 0xFFFF,
            i2c_speed_khz: 0, // NVAPI_I2C_SPEED_DEFAULT
            port_id: 1,       // GPU RGB controllers live on port 1
            is_port_id_set: 1,
        }
    }
}

type FnQueryInterface = unsafe extern "C" fn(u32) -> *mut c_void;
type FnInitialize = unsafe extern "C" fn() -> i32;
type FnUnload = unsafe extern "C" fn() -> i32;
type FnEnumPhysicalGpus = unsafe extern "C" fn(*mut *mut c_void, *mut i32) -> i32;
type FnGpuGetFullName = unsafe extern "C" fn(*mut c_void, *mut u8) -> i32;
type FnGpuGetPciIds = unsafe extern "C" fn(*mut c_void, *mut u32, *mut u32, *mut u32, *mut u32) -> i32;
type FnI2cXferEx = unsafe extern "C" fn(*mut c_void, *mut NvI2cInfoV3, *mut u32) -> i32;

struct NvApiVtable {
    module: HMODULE,
    unload: Option<FnUnload>,
    enum_gpus: FnEnumPhysicalGpus,
    get_name: Option<FnGpuGetFullName>,
    get_pci_ids: FnGpuGetPciIds,
    i2c_write_ex: FnI2cXferEx,
    i2c_read_ex: FnI2cXferEx,
}

unsafe impl Send for NvApiVtable {}
unsafe impl Sync for NvApiVtable {}

impl Drop for NvApiVtable {
    fn drop(&mut self) {
        if let Some(unload) = self.unload {
            unsafe {
                let _ = unload();
            }
        }
        if !self.module.is_null() {
            unsafe {
                FreeLibrary(self.module);
            }
        }
    }
}

impl NvApiVtable {
    fn load() -> Result<Arc<Self>, String> {
        unsafe {
            let module = LoadLibraryA(c"nvapi64.dll".as_ptr().cast());
            if module.is_null() {
                return Err("nvapi64.dll not found (non-NVIDIA GPU or driver absent).".into());
            }
            let Some(qi_raw) = GetProcAddress(module, c"nvapi_QueryInterface".as_ptr().cast()) else {
                FreeLibrary(module);
                return Err("nvapi_QueryInterface export missing in nvapi64.dll.".into());
            };
            let qi: FnQueryInterface = mem::transmute(qi_raw);

            let init_ptr = qi(NVAPI_ID_INITIALIZE);
            if init_ptr.is_null() {
                FreeLibrary(module);
                return Err("NvAPI_Initialize entry point unavailable.".into());
            }
            let init: FnInitialize = mem::transmute(init_ptr);
            if init() != 0 {
                FreeLibrary(module);
                return Err("NvAPI_Initialize failed.".into());
            }
            let unload_ptr = qi(NVAPI_ID_UNLOAD);
            let unload = (!unload_ptr.is_null())
                .then(|| mem::transmute::<*mut c_void, FnUnload>(unload_ptr));

            let enum_ptr = qi(NVAPI_ID_ENUM_PHYSICAL_GPUS);
            let pci_ptr = qi(NVAPI_ID_GPU_GET_PCI_IDENTIFIERS);
            let write_ptr = qi(NVAPI_ID_I2C_WRITE_EX);
            let read_ptr = qi(NVAPI_ID_I2C_READ_EX);
            if enum_ptr.is_null() || pci_ptr.is_null() || write_ptr.is_null() || read_ptr.is_null() {
                if let Some(u) = unload {
                    let _ = u();
                }
                FreeLibrary(module);
                return Err("Required NvAPI I2C functions are unavailable.".into());
            }
            let name_ptr = qi(NVAPI_ID_GPU_GET_FULL_NAME);

            Ok(Arc::new(Self {
                module,
                unload,
                enum_gpus: mem::transmute::<*mut c_void, FnEnumPhysicalGpus>(enum_ptr),
                get_name: (!name_ptr.is_null())
                    .then(|| mem::transmute::<*mut c_void, FnGpuGetFullName>(name_ptr)),
                get_pci_ids: mem::transmute::<*mut c_void, FnGpuGetPciIds>(pci_ptr),
                i2c_write_ex: mem::transmute::<*mut c_void, FnI2cXferEx>(write_ptr),
                i2c_read_ex: mem::transmute::<*mut c_void, FnI2cXferEx>(read_ptr),
            }))
        }
    }

    fn write_word(&self, gpu: *mut c_void, addr: u8, cmd: u8, word: u16) -> Result<(), String> {
        let mut reg = cmd;
        let mut data = [(word & 0xFF) as u8, ((word >> 8) & 0xFF) as u8];
        let mut info = NvI2cInfoV3::new(addr, &mut reg, 1, data.as_mut_ptr(), 2);
        let mut unknown = 0u32;
        let rc = unsafe { (self.i2c_write_ex)(gpu, &mut info, &mut unknown) };
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("NvAPI_I2CWriteEx(word) returned {rc}"))
        }
    }

    fn write_byte(&self, gpu: *mut c_void, addr: u8, cmd: u8, val: u8) -> Result<(), String> {
        let mut reg = cmd;
        let mut data = [val];
        let mut info = NvI2cInfoV3::new(addr, &mut reg, 1, data.as_mut_ptr(), 1);
        let mut unknown = 0u32;
        let rc = unsafe { (self.i2c_write_ex)(gpu, &mut info, &mut unknown) };
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("NvAPI_I2CWriteEx(byte) returned {rc}"))
        }
    }

    fn read_byte(&self, gpu: *mut c_void, addr: u8, cmd: u8) -> Result<u8, String> {
        let mut reg = cmd;
        let mut data = [0u8; 4];
        let mut info = NvI2cInfoV3::new(addr, &mut reg, 1, data.as_mut_ptr(), 1);
        let mut unknown = 0u32;
        let rc = unsafe { (self.i2c_read_ex)(gpu, &mut info, &mut unknown) };
        if rc == 0 {
            Ok(data[0])
        } else {
            Err(format!("NvAPI_I2CReadEx(byte) returned {rc}"))
        }
    }

    fn write_block(&self, gpu: *mut c_void, addr: u8, cmd: u8, payload: &[u8]) -> Result<(), String> {
        let len = payload.len().min(32);
        let mut reg = cmd;
        let mut buf = [0u8; 34];
        buf[0] = len as u8;
        buf[1..1 + len].copy_from_slice(&payload[..len]);
        let mut info = NvI2cInfoV3::new(addr, &mut reg, 1, buf.as_mut_ptr(), (len + 1) as u32);
        let mut unknown = 0u32;
        let rc = unsafe { (self.i2c_write_ex)(gpu, &mut info, &mut unknown) };
        if rc == 0 {
            Ok(())
        } else {
            Err(format!("NvAPI_I2CWriteEx(block) returned {rc}"))
        }
    }

    fn ene_read_reg(&self, gpu: *mut c_void, addr: u8, reg: u16) -> Result<u8, String> {
        // ENE takes big-endian 16-bit register address written as LE word to cmd 0x00
        let swapped = reg.swap_bytes();
        self.write_word(gpu, addr, 0x00, swapped)?;
        self.read_byte(gpu, addr, 0x81)
    }

    fn ene_write_reg(&self, gpu: *mut c_void, addr: u8, reg: u16, val: u8) -> Result<(), String> {
        let swapped = reg.swap_bytes();
        self.write_word(gpu, addr, 0x00, swapped)?;
        self.write_byte(gpu, addr, 0x01, val)
    }

    fn ene_write_block(&self, gpu: *mut c_void, addr: u8, reg: u16, bytes: &[u8]) -> Result<(), String> {
        let swapped = reg.swap_bytes();
        self.write_word(gpu, addr, 0x00, swapped)?;
        if self.write_block(gpu, addr, 0x03, bytes).is_err() {
            for &b in bytes {
                self.write_byte(gpu, addr, 0x01, b)?;
            }
        }
        Ok(())
    }
}

pub struct NvApiEneGpuDevice {
    pub id: String,
    pub name: String,
    pub ene_signature: String,
    pub i2c_addr: u8,
    pub led_count: usize,
    pub pci_subsys_dev: u16,
    direct_reg: u16,
    effect_reg: u16,
    direct_mode_active: bool,
    gpu_handle: *mut c_void,
    nvapi: Arc<NvApiVtable>,
}

unsafe impl Send for NvApiEneGpuDevice {}

pub fn ene_encode_rbg(color: RgbColor) -> [u8; 3] {
    // Verified from ENESMBusController.cpp: ENE stores colors in R, B, G order!
    [color.r, color.b, color.g]
}

fn is_valid_ene_signature(sig: &str) -> bool {
    sig.starts_with("AUMA0-") || sig.starts_with("AUDA0-") || sig.starts_with("LED-")
}

impl NvApiEneGpuDevice {
    pub fn set_direct(&mut self, enable: bool) -> Result<(), String> {
        if self.direct_mode_active == enable {
            return Ok(());
        }
        self.nvapi
            .ene_write_reg(self.gpu_handle, self.i2c_addr, ENE_REG_DIRECT, u8::from(enable))?;
        self.nvapi
            .ene_write_reg(self.gpu_handle, self.i2c_addr, ENE_REG_APPLY, ENE_APPLY_VAL)?;
        self.direct_mode_active = enable;
        Ok(())
    }

    pub fn set_all_direct(&mut self, colors: &[RgbColor]) -> Result<(), String> {
        self.set_direct(true)?;
        let count = self.led_count.max(1);
        let fallback = colors.first().copied().unwrap_or(RgbColor::BLACK);
        let mut rbg = Vec::with_capacity(count * 3);
        for i in 0..count {
            let c = colors.get(i).copied().unwrap_or(fallback);
            rbg.extend_from_slice(&ene_encode_rbg(c));
        }
        // ENE I2C interface max block size is 3 bytes (1 LED per write)
        let mut sent = 0usize;
        while sent < rbg.len() {
            let chunk = (rbg.len() - sent).min(3);
            self.nvapi.ene_write_block(
                self.gpu_handle,
                self.i2c_addr,
                self.direct_reg + sent as u16,
                &rbg[sent..sent + chunk],
            )?;
            sent += chunk;
        }
        Ok(())
    }

    pub fn set_hardware_mode(
        &mut self,
        mode_idx: usize,
        color: RgbColor,
        speed: u8,
    ) -> Result<(), String> {
        self.set_direct(false)?;
        let ene_mode = match mode_idx {
            0 => ENE_MODE_STATIC,
            1 => ENE_MODE_BREATHING,
            2 => ENE_MODE_SPECTRUM,
            3 => ENE_MODE_RAINBOW,
            4 => ENE_MODE_OFF,
            _ => ENE_MODE_STATIC,
        };
        let ene_speed = match speed {
            80..=100 => 0x00,
            60..=79 => 0x01,
            40..=59 => 0x02,
            20..=39 => 0x03,
            _ => 0x04,
        };
        if matches!(ene_mode, ENE_MODE_STATIC | ENE_MODE_BREATHING) {
            let count = self.led_count.max(1);
            let rbg = ene_encode_rbg(color);
            for i in 0..count {
                self.nvapi.ene_write_block(
                    self.gpu_handle,
                    self.i2c_addr,
                    self.effect_reg + (i * 3) as u16,
                    &rbg,
                )?;
            }
        }
        self.nvapi
            .ene_write_reg(self.gpu_handle, self.i2c_addr, ENE_REG_MODE, ene_mode)?;
        self.nvapi
            .ene_write_reg(self.gpu_handle, self.i2c_addr, ENE_REG_SPEED, ene_speed)?;
        self.nvapi
            .ene_write_reg(self.gpu_handle, self.i2c_addr, ENE_REG_DIRECTION, 0)?;
        self.nvapi
            .ene_write_reg(self.gpu_handle, self.i2c_addr, ENE_REG_APPLY, ENE_APPLY_VAL)
    }

    pub fn apply_effect(
        &mut self,
        effect: RgbEffect,
        color: RgbColor,
        brightness_pct: u8,
        phase: f32,
    ) -> Result<(), String> {
        match effect {
            RgbEffect::Blackout => self.set_all_direct(&[RgbColor::BLACK]),
            RgbEffect::Rainbow => {
                let count = self.led_count.max(1);
                let val = (brightness_pct.min(100) as f32) / 100.0;
                let colors: Vec<RgbColor> = (0..count)
                    .map(|i| {
                        let hue = (phase * 60.0 + (i as f32) * (360.0 / count as f32)) % 360.0;
                        RgbColor::from_hsv(hue, 1.0, val)
                    })
                    .collect();
                self.set_all_direct(&colors)
            }
            _ => self.set_all_direct(&[color]),
        }
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        let modes = vec![
            RgbModeInfo { index: 0, name: "Static".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 1, name: "Breathing".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 2, name: "Spectrum Cycle".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 3, name: "Rainbow".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 4, name: "Off".into(), raw_bytes: Vec::new() },
        ];
        let active_mode_name = modes
            .get(active_mode)
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "Direct".into());
        RgbDeviceInfo {
            id: self.id.clone(),
            backend: RgbBackend::DirectNvapi,
            index: 0,
            device_type: "GPU".into(),
            icon: "🎞️".into(),
            name: self.name.clone(),
            vendor: "NVIDIA NVAPI I2C (Native GPU)".into(),
            description: format!(
                "ENE Aura {} @ I2C 0x{:02X} (Subsys 0x{:04X} · {} LEDs)",
                self.ene_signature, self.i2c_addr, self.pci_subsys_dev, self.led_count
            ),
            led_count: self.led_count,
            active_mode_index: active_mode,
            active_mode_name,
            modes,
            zones: vec![RgbZoneInfo {
                index: 0,
                name: "GPU Shroud / Logo".into(),
                led_count: self.led_count as u32,
            }],
            preview_hex: preview_hex.to_owned(),
            lamp_array_id: None,
        }
    }

    pub fn diagnostic_readback(&self) -> serde_json::Value {
        let direct_flag = self
            .nvapi
            .ene_read_reg(self.gpu_handle, self.i2c_addr, ENE_REG_DIRECT)
            .ok();
        let mode_val = self
            .nvapi
            .ene_read_reg(self.gpu_handle, self.i2c_addr, ENE_REG_MODE)
            .ok();
        let mut leds_hex = Vec::with_capacity(self.led_count);
        for i in 0..self.led_count {
            let base = self.direct_reg + (i * 3) as u16;
            let r = self.nvapi.ene_read_reg(self.gpu_handle, self.i2c_addr, base).unwrap_or(0);
            let b = self.nvapi.ene_read_reg(self.gpu_handle, self.i2c_addr, base + 1).unwrap_or(0);
            let g = self.nvapi.ene_read_reg(self.gpu_handle, self.i2c_addr, base + 2).unwrap_or(0);
            leds_hex.push(RgbColor { r, g, b }.to_hex());
        }
        serde_json::json!({
            "id": self.id,
            "name": self.name,
            "eneSignature": self.ene_signature,
            "i2cAddr": format!("0x{:02X}", self.i2c_addr),
            "directModeReadback": direct_flag,
            "hardwareModeReadback": mode_val,
            "directLedsReadback": leds_hex,
        })
    }
}

pub fn scan_nvapi_gpus() -> (Vec<NvApiEneGpuDevice>, String) {
    let nvapi = match NvApiVtable::load() {
        Ok(v) => v,
        Err(err) => return (Vec::new(), err),
    };
    let mut handles = [ptr::null_mut::<c_void>(); 64];
    let mut count = 0i32;
    let rc = unsafe { (nvapi.enum_gpus)(handles.as_mut_ptr(), &mut count) };
    if rc != 0 || count <= 0 {
        return (Vec::new(), "NVAPI initialized · 0 NVIDIA physical GPUs found.".into());
    }

    let mut found = Vec::new();
    let mut notes = Vec::new();
    for (idx, &gpu) in handles.iter().enumerate().take(count.min(64) as usize) {
        let (mut dev_id, mut subsys_id, mut rev_id, mut ext_dev_id) = (0u32, 0u32, 0u32, 0u32);
        if unsafe {
            (nvapi.get_pci_ids)(gpu, &mut dev_id, &mut subsys_id, &mut rev_id, &mut ext_dev_id)
        } != 0
        {
            continue;
        }
        let pci_ven = (dev_id & 0xFFFF) as u16;
        let sub_ven = (subsys_id & 0xFFFF) as u16;
        let sub_dev = ((subsys_id >> 16) & 0xFFFF) as u16;

        let mut gpu_name = String::new();
        if let Some(get_name) = nvapi.get_name {
            let mut buf = [0u8; 64];
            if unsafe { get_name(gpu, buf.as_mut_ptr()) } == 0 {
                let nul = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                gpu_name = String::from_utf8_lossy(&buf[..nul]).trim().to_owned();
            }
        }
        if gpu_name.is_empty() {
            gpu_name = format!("NVIDIA GPU #{idx}");
        }

        if pci_ven != NVIDIA_PCI_VEN || sub_ven != ASUS_PCI_SUBVEN {
            notes.push(format!("{gpu_name} (SubVen 0x{sub_ven:04X})"));
            continue;
        }

        // Probe verified ASUS ENE I2C addresses (0x67 for RTX 30/40/50 TUF/Strix, 0x4E legacy)
        let mut detected = None;
        for &addr in &[0x67u8, 0x4Eu8] {
            let mut sig_bytes = [0u8; 16];
            let mut ok = true;
            for (i, slot) in sig_bytes.iter_mut().enumerate() {
                match nvapi.ene_read_reg(gpu, addr, ENE_REG_DEVICE_NAME + i as u16) {
                    Ok(b) => *slot = b,
                    Err(_) => {
                        ok = false;
                        break;
                    }
                }
            }
            if !ok {
                continue;
            }
            let nul = sig_bytes.iter().position(|&b| b == 0).unwrap_or(15);
            let sig = String::from_utf8_lossy(&sig_bytes[..nul]).trim().to_owned();
            if !is_valid_ene_signature(&sig) {
                continue;
            }
            // Read config table bytes 0x02 and 0x03 for exact LED count
            let cfg2 = nvapi.ene_read_reg(gpu, addr, ENE_REG_CONFIG_TABLE + 0x02).unwrap_or(1);
            let cfg3 = nvapi.ene_read_reg(gpu, addr, ENE_REG_CONFIG_TABLE + 0x03).unwrap_or(1);
            let is_v2 = sig.starts_with("AUMA0-E6K5-") || sig.starts_with("AUDA0-E6K5-");
            let raw_leds = if sig.ends_with("-0107")
                || sig.ends_with("-1107")
                || sig.ends_with("-1110")
                || sig.ends_with("-1111")
                || sig.ends_with("-0008")
                || sig.ends_with("-1113")
                || sig.ends_with("-1114")
            {
                cfg3
            } else {
                cfg2
            };
            let led_count = (raw_leds as usize).clamp(1, 32);
            detected = Some((addr, sig, is_v2, led_count));
            break;
        }

        if let Some((addr, sig, is_v2, led_count)) = detected {
            found.push(NvApiEneGpuDevice {
                id: format!("nvapi:gpu:{idx}:0x{addr:02x}"),
                name: format!("ASUS {gpu_name}"),
                ene_signature: sig,
                i2c_addr: addr,
                led_count,
                pci_subsys_dev: sub_dev,
                direct_reg: if is_v2 {
                    ENE_REG_COLORS_DIRECT_V2
                } else {
                    ENE_REG_COLORS_DIRECT_V1
                },
                effect_reg: if is_v2 {
                    ENE_REG_COLORS_EFFECT_V2
                } else {
                    ENE_REG_COLORS_EFFECT_V1
                },
                direct_mode_active: false,
                gpu_handle: gpu,
                nvapi: nvapi.clone(),
            });
        } else {
            notes.push(format!("{gpu_name} (I2C 0x67/0x4E no ENE response)"));
        }
    }

    let status = if !found.is_empty() {
        format!("NVIDIA NVAPI active · {} GPU RGB controller(s) ready", found.len())
    } else if !notes.is_empty() {
        format!("NVAPI active · no supported GPU RGB detected ({})", notes.join(", "))
    } else {
        "NVAPI active · no supported GPU RGB controllers detected".into()
    };
    (found, status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ene_color_order_is_rbg() {
        assert_eq!(
            ene_encode_rbg(RgbColor { r: 0x11, g: 0x22, b: 0x33 }),
            [0x11, 0x33, 0x22]
        );
    }

    #[test]
    fn ene_signature_filter_accepts_known_prefixes() {
        assert!(is_valid_ene_signature("AUMA0-E6K5-1107"));
        assert!(is_valid_ene_signature("AUMA0-E6K5-0107"));
        assert!(is_valid_ene_signature("LED-0116"));
        assert!(!is_valid_ene_signature(""));
        assert!(!is_valid_ene_signature("UNKNOWN"));
    }

    #[test]
    fn nv_i2c_info_v3_version_encodes_struct_size() {
        let mut reg = 0u8;
        let mut data = [0u8; 2];
        let info = NvI2cInfoV3::new(0x67, &mut reg, 1, data.as_mut_ptr(), 2);
        assert_eq!(info.i2c_dev_address, 0xCE);
        assert_eq!(info.version >> 16, 3);
        assert_eq!((info.version & 0xFFFF) as usize, mem::size_of::<NvI2cInfoV3>());
    }
}
