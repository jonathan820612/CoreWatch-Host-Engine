use crate::rgb_studio::{RgbBackend, RgbColor, RgbDeviceInfo, RgbEffect, RgbModeInfo, RgbZoneInfo};
use std::{
    ffi::OsStr,
    mem,
    os::windows::ffi::OsStrExt,
    path::PathBuf,
    ptr,
    sync::Arc,
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FreeLibrary, HANDLE, HMODULE, WAIT_ABANDONED, WAIT_OBJECT_0},
    System::{
        LibraryLoader::{GetProcAddress, LoadLibraryW},
        Threading::{CreateMutexA, ReleaseMutex, WaitForSingleObject},
    },
};

// Official signed PawnIO SMBus modules (LGPL-2.1, from namazso/PawnIO.Modules v0.2.12)
static PAWNIO_SMBUS_PIIX4: &[u8] = include_bytes!("../assets/pawnio/SmbusPIIX4.bin");
static PAWNIO_SMBUS_I801: &[u8] = include_bytes!("../assets/pawnio/SmbusI801.bin");

const E_ACCESSDENIED: i32 = 0x8007_0005u32 as i32;

// Standard SMBus transaction markers & modes (matching i2c_smbus.h & PawnIO SmbusPIIX4.p)
const I2C_SMBUS_WRITE: u8 = 0;
const I2C_SMBUS_READ: u8 = 1;
const I2C_SMBUS_BYTE_DATA: u32 = 2;
const I2C_SMBUS_WORD_DATA: u32 = 3;
const I2C_SMBUS_BLOCK_DATA: u32 = 5;

// Corsair DRAM SMBus registers (verified from CorsairDRAMController.h)
const CORSAIR_REG_RESET_BUFFER: u8 = 0x0B;
const CORSAIR_REG_SET_BINARY_DATA: u8 = 0x20;
const CORSAIR_REG_BINARY_START: u8 = 0x21;
const CORSAIR_REG_STATUS: u8 = 0x30;
const CORSAIR_REG_COLOR_BLOCK_1: u8 = 0x31;
const CORSAIR_REG_COLOR_BLOCK_2: u8 = 0x32;
const CORSAIR_REG_GET_BINARY_DATA: u8 = 0x40;
const CORSAIR_REG_GET_CHECKSUM: u8 = 0x42;
const CORSAIR_REG_GET_DEVICE_INFO: u8 = 0x61;
const CORSAIR_REG_WRITE_CONFIG: u8 = 0x82;

const CORSAIR_ID_EFFECT_CONFIG: u8 = 1;
const CORSAIR_ID_COLOR_DATA: u8 = 2;

const CORSAIR_MODE_COLOR_SHIFT: u8 = 0x00;
const CORSAIR_MODE_COLOR_PULSE: u8 = 0x01;
const CORSAIR_MODE_RAINBOW_WAVE: u8 = 0x03;
const CORSAIR_MODE_RAINBOW: u8 = 0x08;
const CORSAIR_MODE_STATIC: u8 = 0x10;

// ENE DRAM registers (G.Skill Trident Z / TeamGroup / Geil)
const ENE_REG_DEVICE_NAME: u16 = 0x1000;
const ENE_REG_MICRON_CHECK: u16 = 0x1030;
const ENE_REG_CONFIG_TABLE: u16 = 0x1C00;
const ENE_REG_COLORS_DIRECT_V1: u16 = 0x8000;
const ENE_REG_COLORS_DIRECT_V2: u16 = 0x8100;
const ENE_REG_DIRECT: u16 = 0x8020;
const ENE_REG_MODE: u16 = 0x8021;
const ENE_REG_APPLY: u16 = 0x80A0;

type FnPawnioVersion = unsafe extern "system" fn(*mut u32) -> i32;
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

struct PawnIoLib {
    module: HMODULE,
    version: FnPawnioVersion,
    open: FnPawnioOpen,
    load: FnPawnioLoad,
    execute: FnPawnioExecute,
    close: FnPawnioClose,
}

unsafe impl Send for PawnIoLib {}
unsafe impl Sync for PawnIoLib {}

impl Drop for PawnIoLib {
    fn drop(&mut self) {
        if !self.module.is_null() {
            unsafe {
                FreeLibrary(self.module);
            }
        }
    }
}

impl PawnIoLib {
    fn load() -> Result<Arc<Self>, String> {
        let mut candidates = vec![PathBuf::from(r"C:\Program Files\PawnIO\PawnIOLib.dll")];
        if let Ok(pf) = std::env::var("ProgramFiles") {
            let p = PathBuf::from(pf).join(r"PawnIO\PawnIOLib.dll");
            if !candidates.contains(&p) {
                candidates.push(p);
            }
        }
        if let Ok(exe) = std::env::current_exe()
            && let Some(dir) = exe.parent()
        {
            candidates.push(dir.join("PawnIOLib.dll"));
        }
        let dll_path = candidates
            .into_iter()
            .find(|p| p.is_file())
            .ok_or("PawnIO is not installed (C:\\Program Files\\PawnIO\\PawnIOLib.dll missing).")?;

        let wide: Vec<u16> = OsStr::new(&dll_path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let module = LoadLibraryW(wide.as_ptr());
            if module.is_null() {
                return Err(format!("Could not load {}", dll_path.display()));
            }
            let Some(ver) = GetProcAddress(module, c"pawnio_version".as_ptr().cast()) else {
                FreeLibrary(module);
                return Err("pawnio_version missing in PawnIOLib.dll".into());
            };
            let Some(open) = GetProcAddress(module, c"pawnio_open".as_ptr().cast()) else {
                FreeLibrary(module);
                return Err("pawnio_open missing in PawnIOLib.dll".into());
            };
            let Some(load) = GetProcAddress(module, c"pawnio_load".as_ptr().cast()) else {
                FreeLibrary(module);
                return Err("pawnio_load missing in PawnIOLib.dll".into());
            };
            let Some(exec) = GetProcAddress(module, c"pawnio_execute".as_ptr().cast()) else {
                FreeLibrary(module);
                return Err("pawnio_execute missing in PawnIOLib.dll".into());
            };
            let Some(close) = GetProcAddress(module, c"pawnio_close".as_ptr().cast()) else {
                FreeLibrary(module);
                return Err("pawnio_close missing in PawnIOLib.dll".into());
            };
            let lib = Arc::new(Self {
                module,
                version: mem::transmute::<unsafe extern "system" fn() -> isize, FnPawnioVersion>(ver),
                open: mem::transmute::<unsafe extern "system" fn() -> isize, FnPawnioOpen>(open),
                load: mem::transmute::<unsafe extern "system" fn() -> isize, FnPawnioLoad>(load),
                execute: mem::transmute::<unsafe extern "system" fn() -> isize, FnPawnioExecute>(exec),
                close: mem::transmute::<unsafe extern "system" fn() -> isize, FnPawnioClose>(close),
            });
            let mut v = 0u32;
            if (lib.version)(&mut v) != 0 {
                return Err("PawnIO driver service is not responding.".into());
            }
            Ok(lib)
        }
    }
}

struct GlobalSmbusLock(HANDLE);

impl GlobalSmbusLock {
    fn acquire() -> Option<Self> {
        unsafe {
            let h = CreateMutexA(
                ptr::null(),
                0,
                c"Global\\Access_SMBUS.HTP.Method".as_ptr().cast(),
            );
            if h.is_null() {
                return None;
            }
            let w = WaitForSingleObject(h, 2500);
            if w == WAIT_OBJECT_0 || w == WAIT_ABANDONED {
                Some(Self(h))
            } else {
                CloseHandle(h);
                None
            }
        }
    }
}

impl Drop for GlobalSmbusLock {
    fn drop(&mut self) {
        unsafe {
            ReleaseMutex(self.0);
            CloseHandle(self.0);
        }
    }
}

pub struct PawnIoSmbusBus {
    lib: Arc<PawnIoLib>,
    handle: HANDLE,
    pub name: String,
}

unsafe impl Send for PawnIoSmbusBus {}
unsafe impl Sync for PawnIoSmbusBus {}

impl Drop for PawnIoSmbusBus {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                (self.lib.close)(self.handle);
            }
        }
    }
}

impl PawnIoSmbusBus {
    fn open_blob(
        lib: Arc<PawnIoLib>,
        blob: &[u8],
        label: &str,
        piix4_port: Option<u64>,
    ) -> Result<Arc<Self>, i32> {
        let mut handle: HANDLE = ptr::null_mut();
        let hr = unsafe { (lib.open)(&mut handle) };
        if hr != 0 {
            return Err(hr);
        }
        let hr = unsafe { (lib.load)(handle, blob.as_ptr(), blob.len()) };
        if hr != 0 {
            unsafe {
                (lib.close)(handle);
            }
            return Err(hr);
        }
        if let Some(port) = piix4_port {
            let _lock = GlobalSmbusLock::acquire();
            let input = [port];
            let mut out = [0u64; 1];
            let mut ret_sz = 0usize;
            let hr = unsafe {
                (lib.execute)(
                    handle,
                    c"ioctl_piix4_port_sel".as_ptr(),
                    input.as_ptr(),
                    1,
                    out.as_mut_ptr(),
                    1,
                    &mut ret_sz,
                )
            };
            if hr != 0 {
                unsafe {
                    (lib.close)(handle);
                }
                return Err(hr);
            }
        }
        // Set sleep mode = ALWAYSSLEEP (2) so SMBus polling stays gentle on CPU
        let sleep_in = [2u64];
        let mut ret_sz = 0usize;
        let _ = unsafe {
            (lib.execute)(
                handle,
                c"ioctl_set_sleep_mode".as_ptr(),
                sleep_in.as_ptr(),
                1,
                ptr::null_mut(),
                0,
                &mut ret_sz,
            )
        };

        let id_in = [0u64];
        let mut id_out = [0u64; 3];
        let mut bus_name = label.to_owned();
        if unsafe {
            (lib.execute)(
                handle,
                c"ioctl_identity".as_ptr(),
                id_in.as_ptr(),
                1,
                id_out.as_mut_ptr(),
                3,
                &mut ret_sz,
            )
        } == 0
        {
            let pci_vendor = (id_out[2] & 0xFFFF) as u16;
            let pci_device = ((id_out[2] >> 16) & 0xFFFF) as u16;
            let name_bytes = id_out[0].to_le_bytes();
            let nul = name_bytes.iter().position(|&b| b == 0).unwrap_or(8);
            let hw = String::from_utf8_lossy(&name_bytes[..nul]).trim().to_owned();
            if !hw.is_empty() {
                bus_name = format!("{hw} ({label} · {:04X}:{:04X})", pci_vendor, pci_device);
            }
        }
        Ok(Arc::new(Self {
            lib,
            handle,
            name: bus_name,
        }))
    }
}

struct LockedSmbusBus<'a> {
    bus: &'a PawnIoSmbusBus,
    _lock: GlobalSmbusLock,
}

impl LockedSmbusBus<'_> {
    fn xfer(
        &self,
        addr: u8,
        rw: u8,
        cmd: u8,
        mode: u32,
        data: &mut [u8; 34],
    ) -> Result<(), String> {
        let mut in_words = [0u64; 9];
        in_words[0] = addr as u64;
        in_words[1] = rw as u64;
        in_words[2] = cmd as u64;
        in_words[3] = mode as u64;
        unsafe {
            ptr::copy_nonoverlapping(
                data.as_ptr(),
                in_words[4..].as_mut_ptr() as *mut u8,
                34,
            );
        }
        let mut out_words = [0u64; 5];
        let mut ret_sz = 0usize;
        let hr = unsafe {
            (self.bus.lib.execute)(
                self.bus.handle,
                c"ioctl_smbus_xfer".as_ptr(),
                in_words.as_ptr(),
                9,
                out_words.as_mut_ptr(),
                5,
                &mut ret_sz,
            )
        };
        if hr != 0 {
            return Err(format!("SMBus xfer failed (0x{:08X})", hr as u32));
        }
        unsafe {
            ptr::copy_nonoverlapping(
                out_words.as_ptr() as *const u8,
                data.as_mut_ptr(),
                34,
            );
        }
        Ok(())
    }

    fn read_byte(&self, addr: u8, cmd: u8) -> Result<u8, String> {
        let mut data = [0u8; 34];
        self.xfer(addr, I2C_SMBUS_READ, cmd, I2C_SMBUS_BYTE_DATA, &mut data)?;
        Ok(data[0])
    }

    fn write_byte(&self, addr: u8, cmd: u8, val: u8) -> Result<(), String> {
        let mut data = [0u8; 34];
        data[0] = val;
        self.xfer(addr, I2C_SMBUS_WRITE, cmd, I2C_SMBUS_BYTE_DATA, &mut data)
    }

    fn write_word(&self, addr: u8, cmd: u8, val: u16) -> Result<(), String> {
        let mut data = [0u8; 34];
        data[0] = (val & 0xFF) as u8;
        data[1] = ((val >> 8) & 0xFF) as u8;
        self.xfer(addr, I2C_SMBUS_WRITE, cmd, I2C_SMBUS_WORD_DATA, &mut data)
    }

    fn write_block(&self, addr: u8, cmd: u8, payload: &[u8]) -> Result<(), String> {
        let len = payload.len().min(32);
        let mut data = [0u8; 34];
        data[0] = len as u8;
        data[1..1 + len].copy_from_slice(&payload[..len]);
        self.xfer(addr, I2C_SMBUS_WRITE, cmd, I2C_SMBUS_BLOCK_DATA, &mut data)
    }
}

impl PawnIoSmbusBus {
    fn lock(&self) -> Result<LockedSmbusBus<'_>, String> {
        let _lock = GlobalSmbusLock::acquire()
            .ok_or("Timed out acquiring Windows Global SMBus mutex.")?;
        Ok(LockedSmbusBus { bus: self, _lock })
    }

    pub fn read_byte(&self, addr: u8, cmd: u8) -> Result<u8, String> {
        self.lock()?.read_byte(addr, cmd)
    }
}

pub fn crc8_smbus(data: &[u8]) -> u8 {
    let mut crc = 0u8;
    for &byte in data {
        crc ^= byte;
        for _ in 0..8 {
            if (crc & 0x80) != 0 {
                crc = (crc << 1) ^ 0x07;
            } else {
                crc <<= 1;
            }
        }
    }
    crc
}

// =============================================================================
// CORSAIR VENGEANCE / DOMINATOR DRAM SMBUS CONTROLLER
// =============================================================================

fn corsair_model_for_pid(pid: u16) -> (&'static str, usize, bool) {
    match pid {
        0x0100 | 0x0101 => ("Corsair Vengeance RGB Pro DDR4", 10, false),
        0x0200 | 0x0201 => ("Corsair Dominator Platinum RGB DDR4", 12, true),
        0x0300 | 0x0301 => ("Corsair Vengeance RGB Pro SL DDR4", 10, false),
        0x0400 | 0x0401 => ("Corsair Vengeance RGB RS DDR4", 6, false),
        0x0600 | 0x0601 => ("Corsair Dominator Platinum RGB DDR5", 12, true),
        0x0800..=0x0803 => ("Corsair Dominator Titanium RGB DDR5", 12, true),
        0x0700..=0x0705 => ("Corsair Vengeance RGB DDR5", 10, false),
        _ => ("Corsair Vengeance RGB DRAM", 10, false),
    }
}

pub fn build_corsair_direct_packet(colors: &[RgbColor], led_count: usize, reverse: bool) -> Vec<u8> {
    let fallback = colors.first().copied().unwrap_or(RgbColor::BLACK);
    let mut pkt = Vec::with_capacity(led_count * 3 + 2);
    pkt.push(led_count as u8);
    for idx in 0..led_count {
        let src = if reverse { led_count - 1 - idx } else { idx };
        let c = colors.get(src).copied().unwrap_or(fallback);
        pkt.push(c.r);
        pkt.push(c.g);
        pkt.push(c.b);
    }
    let crc = crc8_smbus(&pkt);
    pkt.push(crc);
    pkt
}

pub struct CorsairDramDevice {
    pub id: String,
    pub name: String,
    pub addr: u8,
    pub firmware: String,
    pub protocol_version: u8,
    pub led_count: usize,
    pub reverse: bool,
    bus: Arc<PawnIoSmbusBus>,
}

impl CorsairDramDevice {
    fn probe(bus: Arc<PawnIoSmbusBus>, addr: u8, slot_idx: usize) -> Option<Self> {
        let info = {
            let locked = bus.lock().ok()?;
            let b43 = locked.read_byte(addr, 0x43).ok()?;
            if !matches!(b43, 0x1A..=0x1C) {
                return None;
            }
            let b44 = locked.read_byte(addr, 0x44).ok()?;
            if !matches!(b44, 0x01 | 0x03 | 0x04) {
                return None;
            }

            // Read 32-byte Corsair Device Info block atomically under Global SMBus mutex
            locked.write_byte(addr, CORSAIR_REG_GET_DEVICE_INFO, 0x00).ok()?;
            locked.write_byte(addr, CORSAIR_REG_BINARY_START, 0x00).ok()?;
            let mut info = [0u8; 32];
            for slot in &mut info {
                *slot = locked.read_byte(addr, CORSAIR_REG_GET_BINARY_DATA).ok()?;
            }
            let dev_crc = locked.read_byte(addr, CORSAIR_REG_GET_CHECKSUM).ok()?;
            let calc_crc = crc8_smbus(&info);
            if dev_crc != calc_crc {
                return None;
            }
            info
        };

        let pid = u16::from_le_bytes([info[2], info[3]]);
        let fw = format!(
            "{}.{}.{}",
            info[9],
            info[8],
            u16::from_le_bytes([info[10], info[11]])
        );
        let protocol_version = info[28];
        let (model_name, led_count, reverse) = corsair_model_for_pid(pid);

        Some(Self {
            id: format!("smbus:corsair:0x{addr:02x}"),
            name: format!("{model_name} (Slot {})", slot_idx + 1),
            addr,
            firmware: fw,
            protocol_version,
            led_count,
            reverse,
            bus,
        })
    }

    fn wait_ready(&self) {
        for _ in 0..5 {
            if let Ok(st) = self.bus.read_byte(self.addr, CORSAIR_REG_STATUS)
                && (st & 0x08) == 0
            {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn write_direct_word_fallback(&self, locked: &LockedSmbusBus<'_>, pkt: &[u8]) -> Result<(), String> {
        let mut i = 0usize;
        while i < pkt.len() {
            let mut reg0 = if i == 0 { 0x90u8 } else { 0xA0u8 };
            let mut reg1 = 0x00u8;
            let mut word0 = pkt[i] as u16;
            i += 1;
            if i < pkt.len() {
                word0 |= (pkt[i] as u16) << 8;
                i += 1;
            }
            if i < pkt.len() {
                reg1 = 0xA0;
                reg0 |= pkt[i] & 0x0F;
                reg1 |= (pkt[i] & 0xF0) >> 4;
                i += 1;
            }
            let mut word1 = 0u16;
            if i < pkt.len() {
                word1 = pkt[i] as u16;
                i += 1;
            }
            if i < pkt.len() {
                word1 |= (pkt[i] as u16) << 8;
                i += 1;
            }
            locked.write_word(self.addr, reg0, word0)?;
            if reg1 != 0 {
                locked.write_word(self.addr, reg1, word1)?;
            }
        }
        Ok(())
    }

    pub fn set_direct_colors(&self, colors: &[RgbColor]) -> Result<(), String> {
        if self.protocol_version >= 4 {
            let pkt = build_corsair_direct_packet(colors, self.led_count, self.reverse);
            let first_len = pkt.len().min(32);
            let locked = self.bus.lock()?;
            let res = locked.write_block(self.addr, CORSAIR_REG_COLOR_BLOCK_1, &pkt[..first_len]);
            if res.is_ok() {
                if pkt.len() > 32 {
                    locked.write_block(self.addr, CORSAIR_REG_COLOR_BLOCK_2, &pkt[32..])?;
                }
                return Ok(());
            }
            return self.write_direct_word_fallback(&locked, &pkt);
        }

        // Legacy protocol (<4): binary buffer with 4 bytes/LED (R, G, B, 0xFF) + CRC8 verification
        let fallback = colors.first().copied().unwrap_or(RgbColor::BLACK);
        let mut buf = Vec::with_capacity(self.led_count * 4);
        for idx in 0..self.led_count {
            let src = if self.reverse {
                self.led_count - 1 - idx
            } else {
                idx
            };
            let c = colors.get(src).copied().unwrap_or(fallback);
            buf.extend_from_slice(&[c.r, c.g, c.b, 0xFF]);
        }
        let committed = {
            let locked = self.bus.lock()?;
            locked.write_byte(self.addr, CORSAIR_REG_RESET_BUFFER, 0x00)?;
            locked.write_byte(self.addr, CORSAIR_REG_BINARY_START, 0x00)?;
            for &b in &buf {
                locked.write_byte(self.addr, CORSAIR_REG_SET_BINARY_DATA, b)?;
            }
            let calc = crc8_smbus(&buf);
            let dev_crc = locked.read_byte(self.addr, CORSAIR_REG_GET_CHECKSUM)?;
            if calc == dev_crc {
                locked.write_byte(self.addr, CORSAIR_REG_WRITE_CONFIG, CORSAIR_ID_COLOR_DATA)?;
                true
            } else {
                false
            }
        };
        if committed {
            self.wait_ready();
        }
        Ok(())
    }

    pub fn set_hardware_mode(
        &self,
        mode_idx: usize,
        c1: RgbColor,
        c2: RgbColor,
        brightness_pct: u8,
        speed: u8,
    ) -> Result<(), String> {
        let mode = match mode_idx {
            0 => CORSAIR_MODE_STATIC,
            1 => CORSAIR_MODE_COLOR_PULSE,
            2 => CORSAIR_MODE_COLOR_SHIFT,
            3 => CORSAIR_MODE_RAINBOW_WAVE,
            4 => CORSAIR_MODE_RAINBOW,
            _ => return self.set_direct_colors(&[RgbColor::BLACK]),
        };
        let hw_speed = match speed {
            0..=33 => 0x00,
            34..=66 => 0x01,
            _ => 0x02,
        };
        let hw_bright = ((brightness_pct.min(100) as u16 * 255) / 100) as u8;
        let random_flag = u8::from(!matches!(mode, CORSAIR_MODE_RAINBOW_WAVE | CORSAIR_MODE_RAINBOW));
        let mut eff = [0u8; 20];
        eff[0] = mode;
        eff[1] = hw_speed;
        eff[2] = random_flag;
        eff[3] = 0x01; // direction down
        eff[4] = c1.r;
        eff[5] = c1.g;
        eff[6] = c1.b;
        eff[7] = hw_bright;
        eff[8] = c2.r;
        eff[9] = c2.g;
        eff[10] = c2.b;
        eff[11] = hw_bright;

        let committed = {
            let locked = self.bus.lock()?;
            locked.write_byte(self.addr, CORSAIR_REG_RESET_BUFFER, 0x00)?;
            locked.write_byte(self.addr, CORSAIR_REG_BINARY_START, 0x00)?;
            for &b in &eff {
                locked.write_byte(self.addr, CORSAIR_REG_SET_BINARY_DATA, b)?;
            }
            let calc = crc8_smbus(&eff);
            let dev_crc = locked.read_byte(self.addr, CORSAIR_REG_GET_CHECKSUM)?;
            if calc == dev_crc {
                locked.write_byte(self.addr, CORSAIR_REG_WRITE_CONFIG, CORSAIR_ID_EFFECT_CONFIG)?;
                true
            } else {
                false
            }
        };
        if committed {
            self.wait_ready();
        }
        Ok(())
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        let modes = vec![
            RgbModeInfo { index: 0, name: "Static".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 1, name: "Color Pulse".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 2, name: "Color Shift".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 3, name: "Rainbow Wave".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 4, name: "Rainbow".into(), raw_bytes: Vec::new() },
            RgbModeInfo { index: 5, name: "Off".into(), raw_bytes: Vec::new() },
        ];
        let active_mode_name = modes
            .get(active_mode)
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "Direct".into());
        RgbDeviceInfo {
            id: self.id.clone(),
            backend: RgbBackend::DirectSmbus,
            index: self.addr as u32,
            device_type: "DRAM".into(),
            icon: "🧠".into(),
            name: self.name.clone(),
            vendor: "Corsair DRAM (Native PawnIO SMBus)".into(),
            description: format!(
                "{} @ 0x{:02X} · FW {} · Proto v{} · {} LEDs",
                self.bus.name, self.addr, self.firmware, self.protocol_version, self.led_count
            ),
            led_count: self.led_count,
            active_mode_index: active_mode,
            active_mode_name,
            modes,
            zones: vec![RgbZoneInfo {
                index: 0,
                name: "DIMM Light Bar".into(),
                led_count: self.led_count as u32,
            }],
            preview_hex: preview_hex.to_owned(),
            lamp_array_id: None,
        }
    }
}

// =============================================================================
// ENE DRAM SMBUS CONTROLLER (G.Skill Trident Z / TeamGroup / Kingston ENE)
// =============================================================================

pub struct EneDramDevice {
    pub id: String,
    pub name: String,
    pub addr: u8,
    pub signature: String,
    pub led_count: usize,
    direct_reg: u16,
    bus: Arc<PawnIoSmbusBus>,
}

impl EneDramDevice {
    fn read_reg(bus: &LockedSmbusBus<'_>, addr: u8, reg: u16) -> Result<u8, String> {
        bus.write_word(addr, 0x00, reg.swap_bytes())?;
        bus.read_byte(addr, 0x81)
    }

    fn write_reg(bus: &LockedSmbusBus<'_>, addr: u8, reg: u16, val: u8) -> Result<(), String> {
        bus.write_word(addr, 0x00, reg.swap_bytes())?;
        bus.write_byte(addr, 0x01, val)
    }

    fn probe(bus: Arc<PawnIoSmbusBus>, addr: u8, slot_idx: usize) -> Option<Self> {
        let (text, leds) = {
            let locked = bus.lock().ok()?;
            let mut sig = [0u8; 16];
            for (i, b) in sig.iter_mut().enumerate() {
                *b = Self::read_reg(&locked, addr, ENE_REG_DEVICE_NAME + i as u16).ok()?;
            }
            let nul = sig.iter().position(|&b| b == 0).unwrap_or(15);
            let text = String::from_utf8_lossy(&sig[..nul]).trim().to_owned();
            if !matches!(
                text.as_str(),
                "DIMM_LED-0102" | "DIMM_LED-0103" | "AUDA0-E6K5-0101"
            ) {
                return None;
            }
            // Verify not Micron Ballistix (which shares ENE register range)
            let mut micron = [0u8; 6];
            for (i, b) in micron.iter_mut().enumerate() {
                *b = Self::read_reg(&locked, addr, ENE_REG_MICRON_CHECK + i as u16).unwrap_or(0);
            }
            if &micron == b"Micron" {
                return None;
            }
            let leds = Self::read_reg(&locked, addr, ENE_REG_CONFIG_TABLE + 0x02)
                .unwrap_or(5)
                .clamp(1, 16) as usize;
            (text, leds)
        };
        let direct_reg = if text == "AUDA0-E6K5-0101" {
            ENE_REG_COLORS_DIRECT_V2
        } else {
            ENE_REG_COLORS_DIRECT_V1
        };
        Some(Self {
            id: format!("smbus:ene:0x{addr:02x}"),
            name: format!("ENE Aura RGB DRAM (Slot {})", slot_idx + 1),
            addr,
            signature: text,
            led_count: leds,
            direct_reg,
            bus,
        })
    }

    pub fn set_direct_colors(&self, colors: &[RgbColor]) -> Result<(), String> {
        let fallback = colors.first().copied().unwrap_or(RgbColor::BLACK);
        let locked = self.bus.lock()?;
        Self::write_reg(&locked, self.addr, ENE_REG_DIRECT, 1)?;
        Self::write_reg(&locked, self.addr, ENE_REG_APPLY, 1)?;
        for i in 0..self.led_count {
            let c = colors.get(i).copied().unwrap_or(fallback);
            let base = self.direct_reg + (i * 3) as u16;
            Self::write_reg(&locked, self.addr, base, c.r)?;
            Self::write_reg(&locked, self.addr, base + 1, c.b)?;
            Self::write_reg(&locked, self.addr, base + 2, c.g)?;
        }
        Ok(())
    }

    pub fn set_off(&self) -> Result<(), String> {
        let locked = self.bus.lock()?;
        Self::write_reg(&locked, self.addr, ENE_REG_DIRECT, 0)?;
        Self::write_reg(&locked, self.addr, ENE_REG_MODE, 0)?;
        Self::write_reg(&locked, self.addr, ENE_REG_APPLY, 1)
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        RgbDeviceInfo {
            id: self.id.clone(),
            backend: RgbBackend::DirectSmbus,
            index: self.addr as u32,
            device_type: "DRAM".into(),
            icon: "🧠".into(),
            name: self.name.clone(),
            vendor: "ENE Aura DRAM (Native PawnIO SMBus)".into(),
            description: format!(
                "{} @ 0x{:02X} · {} · {} LEDs",
                self.bus.name, self.addr, self.signature, self.led_count
            ),
            led_count: self.led_count,
            active_mode_index: active_mode,
            active_mode_name: "Direct".into(),
            modes: vec![
                RgbModeInfo { index: 0, name: "Direct / Static".into(), raw_bytes: Vec::new() },
                RgbModeInfo { index: 1, name: "Off".into(), raw_bytes: Vec::new() },
            ],
            zones: vec![RgbZoneInfo {
                index: 0,
                name: "DIMM Light Bar".into(),
                led_count: self.led_count as u32,
            }],
            preview_hex: preview_hex.to_owned(),
            lamp_array_id: None,
        }
    }
}

pub enum DirectSmbusController {
    Corsair(CorsairDramDevice),
    Ene(EneDramDevice),
}

impl DirectSmbusController {
    pub fn id(&self) -> &str {
        match self {
            Self::Corsair(d) => &d.id,
            Self::Ene(d) => &d.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            Self::Corsair(d) => &d.name,
            Self::Ene(d) => &d.name,
        }
    }

    pub fn apply_effect(
        &mut self,
        effect: RgbEffect,
        color: RgbColor,
        brightness_pct: u8,
        phase: f32,
    ) -> Result<(), String> {
        let led_count = match self {
            Self::Corsair(d) => d.led_count,
            Self::Ene(d) => d.led_count,
        };
        let colors: Vec<RgbColor> = match effect {
            RgbEffect::Blackout => vec![RgbColor::BLACK; led_count],
            RgbEffect::Rainbow => {
                let val = (brightness_pct.min(100) as f32) / 100.0;
                (0..led_count)
                    .map(|i| {
                        let hue = (phase * 60.0 + (i as f32) * (360.0 / led_count.max(1) as f32)) % 360.0;
                        RgbColor::from_hsv(hue, 1.0, val)
                    })
                    .collect()
            }
            _ => vec![color; led_count],
        };
        match self {
            Self::Corsair(d) => d.set_direct_colors(&colors),
            Self::Ene(d) => {
                if effect == RgbEffect::Blackout {
                    d.set_off()
                } else {
                    d.set_direct_colors(&colors)
                }
            }
        }
    }

    pub fn set_hardware_mode(
        &mut self,
        mode_idx: usize,
        c1: RgbColor,
        c2: RgbColor,
        brightness_pct: u8,
        speed: u8,
    ) -> Result<(), String> {
        match self {
            Self::Corsair(d) => d.set_hardware_mode(mode_idx, c1, c2, brightness_pct, speed),
            Self::Ene(d) => {
                if mode_idx == 1 {
                    d.set_off()
                } else {
                    d.set_direct_colors(&[c1])
                }
            }
        }
    }

    pub fn to_device_info(&self, preview_hex: &str, active_mode: usize) -> RgbDeviceInfo {
        match self {
            Self::Corsair(d) => d.to_device_info(preview_hex, active_mode),
            Self::Ene(d) => d.to_device_info(preview_hex, active_mode),
        }
    }
}

pub struct SmbusScanResult {
    pub controllers: Vec<DirectSmbusController>,
    pub status: String,
    pub needs_admin: bool,
}

pub fn scan_smbus_dram() -> SmbusScanResult {
    let lib = match PawnIoLib::load() {
        Ok(l) => l,
        Err(err) => {
            return SmbusScanResult {
                controllers: Vec::new(),
                status: err,
                needs_admin: false,
            };
        }
    };

    let mut buses = Vec::new();
    let mut saw_access_denied = false;

    // 1. Try Intel i801 SMBus
    match PawnIoSmbusBus::open_blob(lib.clone(), PAWNIO_SMBUS_I801, "Intel i801", None) {
        Ok(b) => buses.push(b),
        Err(hr) if hr == E_ACCESSDENIED => saw_access_denied = true,
        Err(_) => {}
    }

    // 2. Try AMD PIIX4 SMBus (Port 0 = main DRAM/SPD bus, Port 1 = auxiliary)
    if !saw_access_denied {
        for port in [0u64, 1u64] {
            match PawnIoSmbusBus::open_blob(
                lib.clone(),
                PAWNIO_SMBUS_PIIX4,
                if port == 0 { "AMD PIIX4 Port 0" } else { "AMD PIIX4 Port 1" },
                Some(port),
            ) {
                Ok(b) => buses.push(b),
                Err(hr) if hr == E_ACCESSDENIED => {
                    saw_access_denied = true;
                    break;
                }
                Err(_) => {}
            }
        }
    }

    if saw_access_denied {
        return SmbusScanResult {
            controllers: Vec::new(),
            status: "PawnIO SMBus ready — restart RustCoreWatch as Administrator to detect & control RGB RAM (Corsair/G.Skill).".into(),
            needs_admin: true,
        };
    }

    if buses.is_empty() {
        return SmbusScanResult {
            controllers: Vec::new(),
            status: "PawnIO active · no supported AMD PIIX4 or Intel i801 SMBus controller found.".into(),
            needs_admin: false,
        };
    }

    let mut controllers = Vec::new();
    let mut corsair_slots = 0usize;
    let mut ene_slots = 0usize;
    let mut active_bus_name: Option<String> = None;

    for bus in &buses {
        // Safe Corsair DRAM LED MCU probe range (NEVER touches 0x50..=0x57 SPD EEPROM)
        for addr in (0x58u8..=0x5Fu8).chain(0x18u8..=0x1Fu8) {
            if let Some(dev) = CorsairDramDevice::probe(bus.clone(), addr, corsair_slots) {
                corsair_slots += 1;
                controllers.push(DirectSmbusController::Corsair(dev));
            }
            thread::sleep(Duration::from_millis(4));
        }
        // Safe ENE DRAM probe range (0x70..=0x77)
        for addr in 0x70u8..=0x77u8 {
            if let Some(dev) = EneDramDevice::probe(bus.clone(), addr, ene_slots) {
                ene_slots += 1;
                controllers.push(DirectSmbusController::Ene(dev));
            }
            thread::sleep(Duration::from_millis(3));
        }
        if !controllers.is_empty() {
            active_bus_name = Some(bus.name.clone());
            break; // Found RAM on primary DRAM SMBus port
        }
    }

    let status_bus = active_bus_name.as_deref().unwrap_or(&buses[0].name);
    let status = if controllers.is_empty() {
        format!(
            "PawnIO SMBus active ({status_bus}) · 0 RGB RAM controllers detected"
        )
    } else {
        format!(
            "PawnIO SMBus active ({status_bus}) · {} RGB RAM module(s) ready",
            controllers.len()
        )
    };
    SmbusScanResult {
        controllers,
        status,
        needs_admin: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc8_smbus_standard_test_vector() {
        // Standard CRC-8/SMBUS (poly 0x07, init 0x00) check value for "123456789" is 0xF4
        assert_eq!(crc8_smbus(b"123456789"), 0xF4);
    }

    #[test]
    fn corsair_direct_packet_encodes_count_colors_and_crc() {
        let colors = [
            RgbColor { r: 255, g: 0, b: 128 },
            RgbColor { r: 0, g: 255, b: 64 },
        ];
        let pkt = build_corsair_direct_packet(&colors, 2, false);
        assert_eq!(pkt.len(), 2 * 3 + 2);
        assert_eq!(pkt[0], 2);
        assert_eq!(&pkt[1..4], &[255, 0, 128]);
        assert_eq!(&pkt[4..7], &[0, 255, 64]);
        assert_eq!(pkt[7], crc8_smbus(&pkt[..7]));

        let rev = build_corsair_direct_packet(&colors, 2, true);
        assert_eq!(&rev[1..4], &[0, 255, 64]);
        assert_eq!(&rev[4..7], &[255, 0, 128]);
    }
}
