use crate::native;
use serde::{Deserialize, Serialize};
use std::{
    mem, ptr,
    sync::{
        Mutex,
        atomic::{AtomicU32, Ordering},
    },
    thread,
    time::Duration,
};
use windows_sys::Win32::Graphics::Gdi::{
    CDS_TEST, CDS_TYPE, CDS_UPDATEREGISTRY, ChangeDisplaySettingsExW, DEVMODEW,
    DISP_CHANGE_SUCCESSFUL, DM_DISPLAYFREQUENCY, DM_DISPLAYORIENTATION, DM_PELSHEIGHT,
    DM_PELSWIDTH, ENUM_CURRENT_SETTINGS, EnumDisplaySettingsW,
};

const PREVIEW_SECONDS: u64 = 15;
static NEXT_TOKEN: AtomicU32 = AtomicU32::new(1);
static PREVIEW: Mutex<Option<Preview>> = Mutex::new(None);
struct Preview {
    token: u32,
    device: Vec<u16>,
    previous: DEVMODEW,
    candidate: DEVMODEW,
}

#[derive(Serialize)]
pub struct Choices {
    rates: Vec<u32>,
    current_rate: u32,
    current_orientation: u32,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DisplayChange {
    Refresh { hz: u32 },
    Orientation { orientation: u32 },
}

pub fn options(id: &str) -> Result<Choices, String> {
    let device = active_device(id)?;
    let current =
        mode(&device, ENUM_CURRENT_SETTINGS).ok_or("Current display mode is unavailable.")?;
    let mut rates: Vec<_> = refresh_modes(&device, &current)
        .map(|entry| entry.dmDisplayFrequency)
        .collect();
    rates.sort_unstable();
    rates.dedup();
    Ok(Choices {
        rates,
        current_rate: current.dmDisplayFrequency,
        current_orientation: orientation(&current),
    })
}

pub fn preview(id: &str, change: DisplayChange) -> Result<Option<u32>, String> {
    let mut pending = PREVIEW
        .lock()
        .map_err(|_| "Display preview is unavailable.")?;
    if pending.is_some() {
        return Err("Confirm or revert the current display preview first.".into());
    }
    let device = active_device(id)?;
    let current =
        mode(&device, ENUM_CURRENT_SETTINGS).ok_or("Current display mode is unavailable.")?;
    let mut candidate = current;
    match change {
        DisplayChange::Refresh { hz } => {
            if current.dmDisplayFrequency == hz {
                return Ok(None);
            }
            if !refresh_modes(&device, &current).any(|entry| entry.dmDisplayFrequency == hz) {
                return Err(
                    "The driver does not list this refresh rate for the current display mode."
                        .into(),
                );
            }
            candidate.dmDisplayFrequency = hz;
            candidate.dmFields |= DM_DISPLAYFREQUENCY;
        }
        DisplayChange::Orientation {
            orientation: requested,
        } => {
            if requested > 3 {
                return Err("Invalid display orientation.".into());
            }
            let current_orientation = orientation(&current);
            if current_orientation == requested {
                return Ok(None);
            }
            if requested % 2 != current_orientation % 2 {
                mem::swap(&mut candidate.dmPelsWidth, &mut candidate.dmPelsHeight);
            }
            candidate.Anonymous1.Anonymous2.dmDisplayOrientation = requested;
            candidate.dmFields |= DM_DISPLAYORIENTATION | DM_PELSWIDTH | DM_PELSHEIGHT;
        }
    }
    change_mode(&device, &candidate, CDS_TEST)?;
    change_mode(&device, &candidate, 0)?;
    let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed);
    *pending = Some(Preview {
        token,
        device,
        previous: current,
        candidate,
    });
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(PREVIEW_SECONDS));
        if let Err(error) = finish(token, false) {
            eprintln!("Display preview rollback: {error}");
        }
    });
    Ok(Some(token))
}

pub fn finish(token: u32, keep: bool) -> Result<(), String> {
    let mut pending = PREVIEW
        .lock()
        .map_err(|_| "Display preview is unavailable.")?;
    let Some(preview) = pending.as_ref().filter(|preview| preview.token == token) else {
        return if keep {
            Err("The preview expired and was reverted.".into())
        } else {
            Ok(())
        };
    };
    if keep {
        change_mode(&preview.device, &preview.candidate, CDS_UPDATEREGISTRY)?;
    } else {
        change_mode(&preview.device, &preview.previous, 0)?;
    }
    *pending = None;
    Ok(())
}

pub fn cancel_on_exit() {
    if let Ok(mut state) = PREVIEW.lock()
        && let Some(preview) = state.take()
    {
        let _ = change_mode(&preview.device, &preview.previous, 0);
    }
}

fn active_device(id: &str) -> Result<Vec<u16>, String> {
    let name = native::displays()
        .into_iter()
        .find(|display| display.id == id)
        .ok_or("The selected display is no longer active.")?
        .id;
    Ok(native::wide(&name))
}

fn mode(device: &[u16], index: u32) -> Option<DEVMODEW> {
    let mut mode = DEVMODEW {
        dmSize: mem::size_of::<DEVMODEW>() as u16,
        ..Default::default()
    };
    (unsafe { EnumDisplaySettingsW(device.as_ptr(), index, &mut mode) } != 0).then_some(mode)
}

fn refresh_modes<'a>(
    device: &'a [u16],
    current: &'a DEVMODEW,
) -> impl Iterator<Item = DEVMODEW> + 'a {
    (0..4096)
        .map_while(|index| mode(device, index))
        .filter(|entry| {
            entry.dmPelsWidth == current.dmPelsWidth
                && entry.dmPelsHeight == current.dmPelsHeight
                && entry.dmBitsPerPel == current.dmBitsPerPel
                && orientation(entry) == orientation(current)
                && entry.dmDisplayFrequency >= 24
        })
}

fn orientation(mode: &DEVMODEW) -> u32 {
    unsafe { mode.Anonymous1.Anonymous2.dmDisplayOrientation }
}

fn change_mode(device: &[u16], mode: &DEVMODEW, flags: CDS_TYPE) -> Result<(), String> {
    let result = unsafe {
        ChangeDisplaySettingsExW(device.as_ptr(), mode, ptr::null_mut(), flags, ptr::null())
    };
    if result != DISP_CHANGE_SUCCESSFUL {
        return Err(format!("Windows rejected the display change ({result})."));
    }
    Ok(())
}
