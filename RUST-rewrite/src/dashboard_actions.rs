use crate::{
    native,
    network::{self, Tool},
};
use serde::Serialize;
use std::{
    path::Path,
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
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
    shell_open_wide(&exe, Some("--elevated"), true)
}

pub(crate) fn shell_open(target: &str, argument: Option<&str>, admin: bool) -> Result<(), String> {
    shell_open_wide(&native::wide(target), argument, admin)
}

pub fn open_directory(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    if !path.is_absolute() || !path.is_dir() {
        return Err("The configured directory does not exist.".into());
    }
    let target: Vec<_> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    shell_open_wide(&target, None, false)
}

/// Opens Windows File Explorer highlighting the exact file or folder (`explorer.exe /select,"<path>"`).
pub fn reveal_in_explorer(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || !path.exists() {
        return Err("The selected file or folder no longer exists.".into());
    }
    let display = path.to_string_lossy();
    let clean = display.strip_prefix(r"\\?\").unwrap_or(&display);
    let arg = format!("/select,\"{clean}\"");
    std::process::Command::new("explorer.exe")
        .arg(&arg)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not open File Explorer: {e}"))
}

/// Returns true if `path` is a critical Windows system root or user profile root that must never
/// be deleted, recycled, or bulk-reorganized.
pub fn is_protected_system_path(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    let norm = raw
        .strip_prefix(r"\\?\")
        .unwrap_or(&raw)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    if norm.len() <= 2 && norm.ends_with(':') {
        return true; // Drive root like C:, D:
    }
    let sys_drive = std::env::var("SystemDrive")
        .unwrap_or_else(|_| "C:".into())
        .to_ascii_lowercase();
    let protected_exact = [
        format!("{sys_drive}\\windows"),
        format!("{sys_drive}\\windows\\system32"),
        format!("{sys_drive}\\windows\\syswow64"),
        format!("{sys_drive}\\program files"),
        format!("{sys_drive}\\program files (x86)"),
        format!("{sys_drive}\\programdata"),
        format!("{sys_drive}\\users"),
        format!("{sys_drive}\\$recycle.bin"),
        format!("{sys_drive}\\system volume information"),
    ];
    if protected_exact.iter().any(|p| p == &norm) {
        return true;
    }
    if norm.starts_with(&format!("{sys_drive}\\windows\\"))
        || norm.contains("\\$recycle.bin")
        || norm.contains("\\system volume information")
    {
        return true;
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let p = profile.trim_end_matches('\\').to_ascii_lowercase();
        if norm == p {
            return true;
        }
    }
    false
}

/// Safely moves a file or folder into the Windows Recycle Bin (`SHFileOperationW` + `FOF_ALLOWUNDO`),
/// enforcing OS protected-path guardrails.
pub fn recycle_path(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        SHFILEOPSTRUCTW, SHFileOperationW,
    };
    if !path.is_absolute() || !path.exists() {
        return Err("The selected item no longer exists.".into());
    }
    if is_protected_system_path(path) {
        return Err("Refusing to recycle a protected Windows system or profile root path.".into());
    }
    let display = path.to_string_lossy();
    let clean = display.strip_prefix(r"\\?\").unwrap_or(&display);
    let mut double_null: Vec<u16> = std::ffi::OsStr::new(clean)
        .encode_wide()
        .chain([0u16, 0u16])
        .collect();
    let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    op.wFunc = FO_DELETE;
    op.pFrom = double_null.as_mut_ptr();
    op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI) as u16;
    let rc = unsafe { SHFileOperationW(&mut op) };
    if rc != 0 || op.fAnyOperationsAborted != 0 {
        return Err(format!("Windows could not move item to Recycle Bin (code {rc})."));
    }
    Ok(())
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
    pub id: String,
    pub name: String,
    pub active: bool,
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
static IDENTIFYING: AtomicBool = AtomicBool::new(false);

pub fn identify(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    if IDENTIFYING.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let monitors = match window.available_monitors() {
        Ok(m) => m,
        Err(error) => {
            IDENTIFYING.store(false, Ordering::Release);
            return Err(error.to_string());
        }
    };
    let displays = native::displays();
    let generation = OVERLAYS.fetch_add(1, Ordering::Relaxed);
    let mut first_error = None;
    let mut spawned = Vec::new();
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
                spawned.push(overlay);
            }
            Err(error) => {
                first_error.get_or_insert_with(|| error.to_string());
            }
        }
    }
    if spawned.is_empty() {
        IDENTIFYING.store(false, Ordering::Release);
    } else {
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(2300));
            for overlay in spawned {
                let _ = overlay.close();
            }
            IDENTIFYING.store(false, Ordering::Release);
        });
    }
    first_error.map_or(Ok(()), Err)
}
