use crate::{dashboard_actions, dashboard_runtimes, native, preferences::Directories};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use windows::{
    Win32::{
        Foundation::HWND,
        System::Com::{
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
            CoTaskMemFree, CoUninitialize,
        },
        UI::Shell::{
            FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS,
            FileOpenDialog, FileSaveDialog, IFileDialog, IShellItem, SHCreateItemFromParsingName,
            SIGDN_FILESYSPATH,
        },
    },
    core::PCWSTR,
};
use winreg::{RegKey, enums::HKEY_CURRENT_USER};

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
const STARTUP_NAME: &str = "RustCoreWatch";
const RELEASES: &str = "https://github.com/jonathan820612/CoreWatch-Host-Engine/releases";

#[derive(Serialize)]
pub struct Startup {
    pub enabled: bool,
    detail: &'static str,
}

fn launch_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(format!("\"{}\" --autostart", exe.display()))
}

pub fn startup() -> Result<Startup, String> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let value = user
        .open_subkey(RUN)
        .and_then(|key| key.get_value::<String, _>(STARTUP_NAME));
    match value {
        Ok(value) if value.eq_ignore_ascii_case(&launch_command()?) => {
            let disabled = user
                .open_subkey(APPROVED)
                .and_then(|key| key.get_raw_value(STARTUP_NAME))
                .ok()
                .and_then(|record| record.bytes.first().copied())
                .is_some_and(|value| value & 1 != 0);
            Ok(Startup {
                enabled: !disabled,
                detail: if disabled {
                    "Disabled in Windows Startup Apps"
                } else {
                    "Enabled for this Windows user"
                },
            })
        }
        Ok(_) => Ok(Startup {
            enabled: false,
            detail: "Startup entry points to a different Rust build",
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Startup {
            enabled: false,
            detail: "Disabled",
        }),
        Err(error) => Err(error.to_string()),
    }
}

pub fn set_startup(enabled: bool) -> Result<(), String> {
    let user = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = user.create_subkey(RUN).map_err(|error| error.to_string())?;
    if enabled {
        if let Ok((approved, _)) = user.create_subkey(APPROVED) {
            ignore_missing(approved.delete_value(STARTUP_NAME))
                .map_err(|error| error.to_string())?;
        }
        run.set_value(STARTUP_NAME, &launch_command()?)
            .map_err(|error| error.to_string())
    } else {
        ignore_missing(run.delete_value(STARTUP_NAME)).map_err(|error| error.to_string())
    }
}

fn ignore_missing(result: std::io::Result<()>) -> std::io::Result<()> {
    result.or_else(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(error)
        }
    })
}

pub fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "restore", "Open RustCoreWatch", true, None::<&str>)?;
    let mode_normal = MenuItem::with_id(app, "mode:normal", "Normal", true, None::<&str>)?;
    let mode_work = MenuItem::with_id(app, "mode:work", "Work / Focus", true, None::<&str>)?;
    let mode_gaming = MenuItem::with_id(app, "mode:gaming", "Gaming", true, None::<&str>)?;
    let mode_stream =
        MenuItem::with_id(app, "mode:streaming", "Streaming / Present", true, None::<&str>)?;
    let mode_night = MenuItem::with_id(app, "mode:night", "Night", true, None::<&str>)?;
    let mode_revert =
        MenuItem::with_id(app, "mode:revert", "Revert Baseline", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let modes_sub = Submenu::with_items(
        app,
        "Switch Mode",
        true,
        &[
            &mode_normal,
            &mode_work,
            &mode_gaming,
            &mode_stream,
            &mode_night,
            &sep,
            &mode_revert,
        ],
    )?;
    let rgb_blackout = MenuItem::with_id(app, "rgb:blackout", "RGB Stealth Blackout", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &modes_sub, &rgb_blackout, &settings, &exit])?;
    let mut tray = TrayIconBuilder::with_id("corewatch")
        .menu(&menu)
        .tooltip("RustCoreWatch")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "rgb:blackout" {
                let rgb = app
                    .state::<std::sync::Arc<crate::rgb_studio::RgbEngine>>()
                    .inner()
                    .clone();
                std::thread::spawn(move || {
                    let _ = rgb.execute(crate::rgb_studio::RgbAction::Blackout);
                });
                return;
            }
            if let Some(mode) = id.strip_prefix("mode:") {
                let mgr = app
                    .state::<std::sync::Arc<crate::profiles::ProfileManager>>()
                    .inner()
                    .clone();
                let rgb = app
                    .state::<std::sync::Arc<crate::rgb_studio::RgbEngine>>()
                    .inner()
                    .clone();
                let handle = app.clone();
                let mode_id = mode.to_owned();
                let action = if mode == "revert" {
                    crate::profiles::ProfileAction::RevertBaseline
                } else {
                    crate::profiles::ProfileAction::Activate {
                        id: mode.to_owned(),
                    }
                };
                std::thread::spawn(move || {
                    if mgr.execute(action).is_ok() {
                        if mode_id != "revert" {
                            rgb.on_profile_activated(&mode_id);
                        }
                        let _ = handle.emit_to("main", "profiles-changed", ());
                    }
                });
                return;
            }
            match id {
                "restore" => restore(app),
                "settings" => {
                    restore(app);
                    let _ = app.emit_to("main", "open-settings", ());
                }
                "quit" => app.exit(0),
                _ => (),
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn restore(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        app.state::<std::sync::Arc<crate::Dashboard>>()
            .minimize(false, false);
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Location {
    Projects,
    Exports,
    Wsl,
    Organizer,
    Editor,
}

impl Location {
    pub fn path(self, directories: &Directories) -> &Path {
        Path::new(match self {
            Self::Projects => &directories.projects_root,
            Self::Exports => &directories.exports_root,
            Self::Wsl => &directories.wsl_install_root,
            Self::Organizer => &directories.organizer_dest_root,
            Self::Editor => &directories.editor_path,
        })
    }

    pub fn is_editor(self) -> bool {
        matches!(self, Self::Editor)
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Editor {
    VsCode,
    Cursor,
}

pub fn detect_editor(editor: Editor) -> Option<PathBuf> {
    let (exe, local, system) = match editor {
        Editor::VsCode => (
            "Code.exe",
            "Programs/Microsoft VS Code",
            "Microsoft VS Code",
        ),
        Editor::Cursor => ("Cursor.exe", "Programs/cursor", "Cursor"),
    };
    let key = format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
    use winreg::enums::HKEY_LOCAL_MACHINE;
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]
        .into_iter()
        .filter_map(|hive| {
            let path: String = RegKey::predef(hive)
                .open_subkey(&key)
                .ok()?
                .get_value("")
                .ok()?;
            Some(PathBuf::from(path.trim_matches('"')))
        })
        .chain(
            std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join(local).join(exe)),
        )
        .chain(
            ["ProgramFiles", "ProgramFiles(x86)"]
                .into_iter()
                .filter_map(std::env::var_os)
                .map(|root| PathBuf::from(root).join(system).join(exe)),
        )
        .find(|path| path.is_absolute() && path.is_file())
}

pub enum Picker {
    Directory,
    Editor,
    Image,
    ThemeOpen,
    ThemeSave,
    ReportSave,
}

pub fn pick(owner: isize, initial: PathBuf, picker: Picker) -> Result<Option<PathBuf>, String> {
    std::thread::spawn(move || {
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let _apartment = Apartment;
            let save = matches!(picker, Picker::ThemeSave | Picker::ReportSave);
            let dialog: IFileDialog = CoCreateInstance(
                if save {
                    &FileSaveDialog
                } else {
                    &FileOpenDialog
                },
                None,
                CLSCTX_INPROC_SERVER,
            )?;
            let mut options = dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST;
            if matches!(picker, Picker::Directory) {
                options |= FOS_PICKFOLDERS;
            } else if !save {
                options |= FOS_FILEMUSTEXIST;
            }
            dialog.SetOptions(options)?;
            if let Some(folder) = initial
                .ancestors()
                .find(|folder| folder.is_absolute() && folder.is_dir())
            {
                let value: Vec<_> = folder
                    .as_os_str()
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();
                if let Ok(item) =
                    SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(value.as_ptr()), None)
                {
                    dialog.SetFolder(&item)?;
                }
            }
            let filter = match picker {
                Picker::Editor => Some(("Executable", "*.exe")),
                Picker::Image => Some(("Images", "*.png;*.jpg;*.jpeg;*.webp")),
                Picker::ThemeOpen | Picker::ThemeSave => Some(("CoreWatch Theme", "*.json")),
                Picker::ReportSave => Some(("Markdown report", "*.md")),
                _ => None,
            };
            if let Some((name, pattern)) = filter {
                use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
                let name = native::wide(name);
                let pattern = native::wide(pattern);
                dialog.SetFileTypes(&[COMDLG_FILTERSPEC {
                    pszName: PCWSTR(name.as_ptr()),
                    pszSpec: PCWSTR(pattern.as_ptr()),
                }])?;
            }
            if save {
                let (ext, name) = if matches!(picker, Picker::ReportSave) {
                    ("md", "corewatch-diagnostics.md")
                } else {
                    ("json", "corewatch-theme.json")
                };
                dialog.SetDefaultExtension(PCWSTR(native::wide(ext).as_ptr()))?;
                dialog.SetFileName(PCWSTR(native::wide(name).as_ptr()))?;
            }
            if let Err(error) = dialog.Show(Some(HWND(owner as _))) {
                if error.code().0 as u32 == 0x800704c7 {
                    return Ok(None);
                }
                return Err(error);
            }
            let result = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            use std::os::windows::ffi::OsStringExt;
            let selected = std::ffi::OsString::from_wide(result.as_wide());
            CoTaskMemFree(Some(result.0.cast()));
            Ok(Some(PathBuf::from(selected)))
        }
    })
    .join()
    .map_err(|_| "The Windows file dialog stopped unexpectedly.")?
    .map_err(|error: windows::core::Error| error.to_string())
}

pub fn open_location(location: Location, directories: &Directories) -> Result<(), String> {
    let path = location.path(directories);
    let path = if location.is_editor() {
        path.parent().ok_or("The editor path is unavailable.")?
    } else {
        path
    };
    dashboard_actions::open_directory(path)
}

#[derive(Serialize)]
pub struct ReleaseStatus {
    current: &'static str,
    latest: Option<String>,
    rust_release: Option<String>,
}

pub fn release_status() -> Result<ReleaseStatus, String> {
    #[derive(Deserialize)]
    struct Asset {
        name: String,
    }
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
        draft: bool,
        assets: Vec<Asset>,
    }
    let url =
        "https://api.github.com/repos/jonathan820612/CoreWatch-Host-Engine/releases?per_page=20";
    let result = dashboard_runtimes::curl(url, "2097152")?
        .args(["--max-time", "15"])
        .output()
        .map_err(|error| error.to_string())?;
    if !result.status.success() {
        return Err(format!(
            "Release check failed. {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    let releases: Vec<Release> =
        serde_json::from_slice(&result.stdout).map_err(|error| error.to_string())?;
    let latest = releases
        .iter()
        .find(|release| !release.draft)
        .map(|release| release.tag_name.clone());
    let rust_release = releases
        .into_iter()
        .find(|release| {
            !release.draft
                && release.assets.iter().any(|asset| {
                    let name = asset.name.to_ascii_lowercase();
                    name.starts_with("corewatch")
                        && name.contains("rust")
                        && [".msi", ".exe", ".zip"]
                            .iter()
                            .any(|suffix| name.ends_with(suffix))
                })
        })
        .map(|release| release.tag_name);
    Ok(ReleaseStatus {
        current: env!("CARGO_PKG_VERSION"),
        latest,
        rust_release,
    })
}

pub fn open_releases() -> Result<(), String> {
    dashboard_actions::shell_open(RELEASES, None, false)
}

pub fn read_file(path: &Path, limit: usize) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(limit as u64 + 1).read_to_end(&mut bytes))
        .map_err(|error| error.to_string())?;
    if bytes.len() > limit {
        return Err("The selected file is too large.".into());
    }
    Ok(bytes)
}

pub fn export_theme(path: &Path, theme: &crate::preferences::Theme) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(theme).map_err(|error| error.to_string())?;
    write_export(path, &bytes)
}

pub fn write_export(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose an export folder.")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn set_opacity(window: &tauri::WebviewWindow, percent: u8) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let alpha = (u16::from(percent.clamp(50, 100)) * 255 / 100) as u8;
    unsafe {
        let flags = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if alpha == 255 && flags & WS_EX_LAYERED as i32 == 0 {
            return Ok(());
        }
        SetWindowLongW(hwnd, GWL_EXSTYLE, flags | WS_EX_LAYERED as i32);
        if SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) == 0 {
            SetWindowLongW(hwnd, GWL_EXSTYLE, flags);
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
