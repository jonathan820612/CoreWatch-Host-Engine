use std::{
    io,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use winreg::{
    RegKey, RegValue,
    enums::{HKEY_CURRENT_USER, REG_BINARY},
};

const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store";
const STATE: &str = "windows.data.bluelightreduction.bluelightreductionstate";
const SETTINGS: &str = "windows.data.bluelightreduction.settings";
const HEADER: &[u8] = b"CB\x01\x00";
const FLAG: &[u8] = &[0x10, 0x00];
const KELVIN: &[u8] = &[0xcf, 0x28];
static EDIT: Mutex<()> = Mutex::new(());

fn paths(name: &str) -> [String; 2] {
    [
        format!(r"{STORE}\DefaultAccount\Current\default${name}\{name}"),
        format!(r"{STORE}\Cache\DefaultAccount\$${name}\Current"),
    ]
}

fn read(name: &str) -> io::Result<(String, Option<Vec<u8>>)> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let [primary, legacy] = paths(name);
    let mut fallback = primary.clone();
    for path in [&primary, &legacy] {
        match user.open_subkey(path) {
            Ok(key) => match key.get_raw_value("Data") {
                Ok(data) if data.vtype == REG_BINARY => {
                    return Ok((path.clone(), Some(data.bytes.into_owned())));
                }
                Ok(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "Night Light data is not binary.",
                    ));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => fallback = path.clone(),
                Err(error) => return Err(error),
            },
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
    }
    Ok((fallback, None))
}

fn write(path: &str, bytes: Vec<u8>) -> Result<(), String> {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(path)
        .and_then(|(key, _)| {
            key.set_raw_value(
                "Data",
                &RegValue {
                    bytes: bytes.into(),
                    vtype: REG_BINARY,
                },
            )
        })
        .map_err(|error| format!("Could not save Windows Night Light. {error}"))
}

fn envelope(bytes: &[u8]) -> Option<(usize, usize)> {
    if !bytes.starts_with(HEADER) {
        return None;
    }
    let ts_end = bytes.get(10..)?.iter().position(|byte| byte & 0x80 == 0)? + 11;
    let len = ts_end + 3;
    let start = len + 1;
    let end = start + usize::from(*bytes.get(len)?);
    (bytes.get(ts_end..len)? == [0x2a, 0x2b, 0x0e] && bytes.get(start..end)?.starts_with(HEADER))
        .then_some((len, end))
}

fn state(bytes: &[u8]) -> Option<bool> {
    let (len, end) = envelope(bytes)?;
    let content = bytes.get(len + 5..end)?;
    if content.starts_with(FLAG) {
        Some(true)
    } else if content.starts_with(&[0xd0, 0x0a]) {
        Some(false)
    } else {
        None
    }
}

pub fn status() -> Option<bool> {
    match read(STATE).ok()?.1 {
        None => Some(false),
        Some(bytes) => state(&bytes),
    }
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn leb128(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    while value >= 128 {
        bytes.push((value as u8 & 0x7f) | 0x80);
        value >>= 7;
    }
    bytes.push(value as u8);
    bytes
}

fn wrap(inner: &[u8], time: u64) -> Vec<u8> {
    let mut bytes = vec![0x43, 0x42, 1, 0, 0x0a, 2, 1, 0, 0x2a, 6];
    bytes.extend(leb128(time));
    bytes.extend([0x2a, 0x2b, 0x0e, inner.len() as u8]);
    bytes.extend(inner);
    bytes.extend([0, 0, 0]);
    bytes
}

fn bump(bytes: &mut Vec<u8>, len: usize) {
    let ts_end = len - 3;
    let previous = bytes[10..ts_end]
        .iter()
        .enumerate()
        .take(9)
        .fold(0u64, |value, (index, byte)| {
            value | (u64::from(byte & 0x7f) << (index * 7))
        });
    bytes.splice(10..ts_end, leb128(timestamp().max(previous + 1)));
}

fn change_state(bytes: Option<Vec<u8>>, enabled: bool) -> Result<Option<Vec<u8>>, String> {
    if let Some(mut bytes) = bytes {
        let old =
            state(&bytes).ok_or("Windows returned an unsupported Night Light state format.")?;
        if old == enabled {
            return Ok(None);
        }
        let (length, _) = envelope(&bytes).ok_or("Invalid Night Light payload.")?;
        let flag = length + 5;
        bytes[length] = if enabled {
            bytes[length]
                .checked_add(2)
                .ok_or("Night Light payload is too large.")?
        } else {
            bytes[length] - 2
        };
        if enabled {
            bytes.splice(flag..flag, FLAG.iter().copied());
        } else {
            bytes.drain(flag..flag + FLAG.len());
        }
        bump(&mut bytes, length);
        return Ok(Some(bytes));
    }
    if !enabled {
        return Ok(None);
    }
    let time = timestamp();
    let mut inner = HEADER.to_vec();
    inner.extend(FLAG);
    inner.extend([0xd0, 0x0a, 2, 0xc6, 0x14]);
    inner.extend(leb128(time));
    inner.extend([0, 0]);
    Ok(Some(wrap(&inner, time)))
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let _edit = EDIT
        .lock()
        .map_err(|_| "Night Light controls are unavailable.")?;
    let (path, bytes) = read(STATE).map_err(|e| e.to_string())?;
    if let Some(next) = change_state(bytes, enabled)? {
        write(&path, next)?;
    }
    Ok(())
}

pub struct Warmth {
    pub percent: u32,
    pub kelvin: u32,
}

pub fn warmth() -> Option<Warmth> {
    let bytes = read(SETTINGS).ok()?.1;
    let kelvin = bytes
        .as_deref()
        .and_then(|bytes| {
            let (len, end) = envelope(bytes)?;
            let content = bytes.get(len + 5..end)?;
            let value = content.windows(4).find(|field| field.starts_with(KELVIN))?;
            Some(u32::from(value[2] & 0x7f) / 2 + (u32::from(value[3]) << 6))
        })
        .unwrap_or(4800)
        .clamp(1200, 6500);
    Some(Warmth {
        percent: ((6500 - kelvin) * 100 + 2650) / 5300,
        kelvin,
    })
}

pub fn set_warmth(percent: u32) -> Result<(), String> {
    if percent > 100 {
        return Err("Night Light strength must be between 0 and 100%.".into());
    }
    let _edit = EDIT
        .lock()
        .map_err(|_| "Night Light controls are unavailable.")?;
    let kelvin = 6500 - 53 * percent;
    let (path, bytes) = read(SETTINGS).map_err(|e| e.to_string())?;
    let mut data = bytes.unwrap_or_else(|| {
        let mut inner = HEADER.to_vec();
        inner.extend([0xca, 0x32, 0, 0xca, 0x3c, 0, 0, 0, 0, 0]);
        wrap(&inner, timestamp())
    });
    let (len, end) =
        envelope(&data).ok_or("Windows returned an unsupported Night Light settings format.")?;
    let value = [
        0xcf,
        0x28,
        ((kelvin & 0x3f) as u8 * 2) | 0x80,
        (kelvin >> 6) as u8,
    ];
    let start = len + 5;
    if let Some(field) = data[start..end]
        .windows(4)
        .position(|field| field.starts_with(KELVIN))
    {
        data[start + field..start + field + 4].copy_from_slice(&value);
    } else {
        data[len] = data[len]
            .checked_add(4)
            .ok_or("Night Light payload is too large.")?;
        data.splice(start..start, value);
    }
    bump(&mut data, len);
    write(&path, data)?;
    // The display service reloads the warmth during an Off → On transition.
    let (path, current) = read(STATE).map_err(|e| e.to_string())?;
    if current.as_deref().and_then(state) == Some(true) {
        let off =
            change_state(current, false)?.ok_or("Night Light failed to prepare the new warmth.")?;
        let on = change_state(Some(off.clone()), true)?
            .ok_or("Night Light failed to prepare the new warmth.")?;
        write(&path, off)?;
        std::thread::sleep(std::time::Duration::from_millis(130));
        write(&path, on)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_known_cloudstore_state_and_rejects_unknown_format() {
        let off = vec![
            0x43, 0x42, 1, 0, 0x0a, 2, 1, 0, 0x2a, 6, 0xe0, 0x82, 0x94, 0xd8, 6, 0x2a, 0x2b, 0x0e,
            0x10, 0x43, 0x42, 1, 0, 0xd0, 0x0a, 2, 0xc6, 0x14, 0xdb, 0x82, 0x94, 0xd8, 6, 0, 0, 0,
            0, 0,
        ];
        assert_eq!(state(&off), Some(false));
        let edited = change_state(Some(off), true).unwrap().unwrap();
        assert_eq!(state(&edited), Some(true));
        assert_eq!(
            state(&change_state(Some(edited), false).unwrap().unwrap()),
            Some(false)
        );
        assert!(change_state(Some(vec![1, 2, 3]), true).is_err());
    }
}
