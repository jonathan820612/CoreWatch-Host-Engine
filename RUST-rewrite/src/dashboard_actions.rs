use crate::{
    native,
    network::{self, Tool},
};
use serde::Serialize;
use std::{
    path::Path,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};
use tauri::{AppHandle, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows_sys::Win32::Storage::FileSystem::SetVolumeLabelW;

pub fn relaunch_elevated() -> Result<(), String> {
    if native::elevated() {
        return Err("CoreWatch is already elevated.".into());
    }
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    use std::os::windows::ffi::OsStrExt;
    let exe: Vec<u16> = exe.as_os_str().encode_wide().chain([0]).collect();
    shell_open_wide(&exe, None, true)
}

fn shell_open(target: &str, argument: Option<&str>, admin: bool) -> Result<(), String> {
    shell_open_wide(&native::wide(target), argument, admin)
}

fn shell_open_wide(target: &[u16], argument: Option<&str>, admin: bool) -> Result<(), String> {
    use std::ptr;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    let verb = native::wide(if admin { "runas" } else { "open" });
    let argument = argument.map(native::wide);
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            verb.as_ptr(),
            target.as_ptr(),
            argument
                .as_ref()
                .map_or(ptr::null(), |argument| argument.as_ptr()),
            ptr::null(),
            1,
        )
    } as isize;
    if result <= 32 {
        return Err(format!(
            "Windows could not open the requested item ({result})."
        ));
    }
    Ok(())
}

fn local_mount(mount: &str) -> bool {
    matches!(mount.as_bytes(), [letter, b':', b'\\'] if letter.is_ascii_alphabetic())
        && sysinfo::Disks::new_with_refreshed_list()
            .list()
            .iter()
            .any(|d| d.mount_point() == Path::new(mount))
}

pub fn open_volume(mount: &str) -> Result<(), String> {
    if !local_mount(mount) {
        return Err("The selected drive is no longer mounted.".into());
    }
    shell_open(mount, None, false)
}

pub fn label_volume(mount: &str, label: &str) -> Result<(), String> {
    if !local_mount(mount) {
        return Err("The selected drive is no longer mounted.".into());
    }
    if label.encode_utf16().count() > 32 || label.chars().any(char::is_control) {
        return Err("Enter a volume label of up to 32 characters.".into());
    }
    let mount = native::wide(mount);
    let label = native::wide(label);
    if unsafe { SetVolumeLabelW(mount.as_ptr(), label.as_ptr()) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct PowerPlan {
    id: String,
    name: String,
    active: bool,
}

pub fn power_plans() -> Result<Vec<PowerPlan>, String> {
    let output = network::system_tool(Tool::Powercfg, ["/list"])?;
    let mut plans = Vec::new();
    for line in output.lines() {
        let Some(id) = line.split_whitespace().find(|part| valid_guid(part)) else {
            continue;
        };
        let Some((_, name)) = line.split_once('(') else {
            continue;
        };
        let Some((name, end)) = name.rsplit_once(')') else {
            continue;
        };
        plans.push(PowerPlan {
            id: id.into(),
            name: name.into(),
            active: end.trim() == "*",
        });
    }
    if plans.is_empty() {
        return Err("No Windows power plans were returned.".into());
    }
    Ok(plans)
}

pub fn set_power_plan(id: &str) -> Result<(), String> {
    if !valid_guid(id)
        || !power_plans()?
            .iter()
            .any(|plan| plan.id.eq_ignore_ascii_case(id))
    {
        return Err("The selected power plan is not available.".into());
    }
    network::system_tool(Tool::Powercfg, ["/setactive", id]).map(|_| ())
}

fn valid_guid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, byte)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

static OVERLAYS: AtomicUsize = AtomicUsize::new(0);

pub fn identify(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let displays = native::displays();
    let generation = OVERLAYS.fetch_add(1, Ordering::Relaxed);
    let mut first_error = None;
    for (index, monitor) in monitors.iter().enumerate() {
        let position = monitor.position();
        let size = monitor.size();
        let width = 150.0;
        let height = 100.0;
        let label = format!("identify-{generation}-{index}");
        let number = displays
            .iter()
            .position(|display| display.position == (position.x, position.y))
            .unwrap_or(index)
            + 1;
        let overlay =
            WebviewWindowBuilder::new(app, label, WebviewUrl::App("identify.html".into()))
                .title(format!("Display {number}"))
                .initialization_script(format!("window.coreWatchDisplayNumber = {number};"))
                .inner_size(width, height)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build();
        match overlay {
            Ok(overlay) => {
                let x =
                    position.x + (size.width as f64 - width * monitor.scale_factor()) as i32 / 2;
                let y =
                    position.y + (size.height as f64 - height * monitor.scale_factor()) as i32 / 2;
                let _ = overlay.set_position(PhysicalPosition::new(x, y));
                let _ = overlay.show();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(2300));
                    let _ = overlay.close();
                });
            }
            Err(error) => {
                first_error.get_or_insert_with(|| error.to_string());
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}
