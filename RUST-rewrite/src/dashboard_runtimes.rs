use crate::{devices::ComApartment, native, network, system_controls};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    os::windows::{fs::OpenOptionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use windows::{
    Foundation::Uri,
    Management::Deployment::{DeploymentOptions, PackageManager},
    core::HSTRING,
};
use windows_sys::Win32::{
    Storage::FileSystem::FILE_SHARE_READ,
    UI::WindowsAndMessaging::{
        HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
    },
};
use winreg::{
    RegKey, RegValue,
    enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE, REG_EXPAND_SZ},
    types::ToRegValue,
};

const MACHINE_ENV: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
const APP_INSTALLER: &str = "Microsoft.DesktopAppInstaller_8wekyb3d8bbwe";
const POWERSHELL_MSIX: &str = "Microsoft.PowerShell_8wekyb3d8bbwe";
const RELEASES: &str = "https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=25";
static INSTALL: Mutex<()> = Mutex::new(());
static JAVA: Mutex<()> = Mutex::new(());

fn env_key(machine: bool, flags: u32) -> io::Result<RegKey> {
    if machine {
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(MACHINE_ENV, flags)
    } else {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags("Environment", flags)
    }
}

fn java_home(key: &RegKey) -> Option<PathBuf> {
    key.get_value::<String, _>("JAVA_HOME")
        .ok()
        .map(PathBuf::from)
}

#[derive(Serialize)]
pub struct JavaRuntime {
    home: PathBuf,
    label: String,
    active: bool,
}

fn java_label(home: &Path) -> Option<String> {
    let mut data = String::new();
    File::open(home.join("release"))
        .ok()?
        .take(16384)
        .read_to_string(&mut data)
        .ok()?;
    let entry = |key: &str| {
        data.lines().find_map(|line| {
            let (name, value) = line.split_once('=')?;
            (name == key).then(|| value.trim_matches('"'))
        })
    };
    let version = entry("JAVA_VERSION")?;
    Some(entry("IMPLEMENTOR").map_or_else(
        || version.to_owned(),
        |vendor| format!("{version} ({vendor})"),
    ))
}

fn match_path(left: &Path, right: &Path) -> bool {
    left.to_string_lossy()
        .trim_end_matches('\\')
        .eq_ignore_ascii_case(right.to_string_lossy().trim_end_matches('\\'))
}

fn java_path_homes(key: &RegKey) -> impl Iterator<Item = PathBuf> {
    key.get_value::<String, _>("Path")
        .unwrap_or_default()
        .split(';')
        .filter_map(|entry| {
            let path = expand(entry.trim().trim_matches('"'))?;
            let bin = PathBuf::from(path);
            bin.file_name()?
                .to_str()?
                .eq_ignore_ascii_case("bin")
                .then(|| bin.parent().map(Path::to_path_buf))
                .flatten()
        })
        .collect::<Vec<_>>()
        .into_iter()
}

fn expand(value: &str) -> Option<String> {
    use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
    let source = native::wide(value);
    let length = unsafe { ExpandEnvironmentStringsW(source.as_ptr(), std::ptr::null_mut(), 0) };
    if length == 0 {
        return None;
    }
    let mut expanded = vec![0; length as usize];
    let written =
        unsafe { ExpandEnvironmentStringsW(source.as_ptr(), expanded.as_mut_ptr(), length) };
    (written > 0 && written <= length)
        .then(|| String::from_utf16_lossy(&expanded[..written as usize - 1]))
}

fn java_homes() -> (Option<PathBuf>, Vec<PathBuf>) {
    let keys: Vec<_> = [true, false]
        .into_iter()
        .filter_map(|machine| env_key(machine, KEY_READ).ok())
        .collect();
    let configured = keys
        .iter()
        .filter_map(java_home)
        .chain(keys.iter().flat_map(java_path_homes));
    let mut homes: Vec<_> = configured
        .filter(|path| path.is_absolute() && path.join("bin\\java.exe").is_file())
        .collect();
    let active = homes.first().cloned().or_else(|| {
        std::env::var_os("JAVA_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute() && path.join("bin\\java.exe").is_file())
    });
    homes.extend(active.iter().cloned());
    for base in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
        .into_iter()
        .filter_map(std::env::var_os)
    {
        let base = PathBuf::from(base);
        for vendor in [
            "Eclipse Adoptium",
            "Java",
            "AdoptOpenJDK",
            "Microsoft",
            "Zulu",
            "Amazon Corretto",
            "BellSoft",
            "Semeru",
        ] {
            if let Ok(entries) = fs::read_dir(base.join(vendor)) {
                homes.extend(
                    entries
                        .flatten()
                        .map(|entry| entry.path())
                        .filter(|path| path.join("bin\\java.exe").is_file()),
                );
            }
        }
    }
    homes.sort_by_key(|path| path.to_string_lossy().to_ascii_lowercase());
    homes.dedup_by(|left, right| match_path(left, right));
    (active, homes)
}

pub fn java_current() -> Option<String> {
    java_runtimes()
        .into_iter()
        .find(|runtime| runtime.active)
        .map(|runtime| runtime.label)
}

pub fn java_runtimes() -> Vec<JavaRuntime> {
    let (active, homes) = java_homes();
    homes
        .into_iter()
        .map(|home| JavaRuntime {
            active: active
                .as_ref()
                .is_some_and(|current| match_path(current, &home)),
            label: java_label(&home).unwrap_or_else(|| {
                home.file_name()
                    .unwrap_or(home.as_os_str())
                    .to_string_lossy()
                    .into_owned()
            }),
            home,
        })
        .collect()
}

fn java_machine_path(previous: &str, path: &Path, homes: &[PathBuf]) -> String {
    let bin = path.join("bin");
    let excluded: Vec<_> = homes.iter().map(|home| home.join("bin")).collect();
    std::iter::once(bin.to_string_lossy().into_owned())
        .chain(previous.split(';').filter_map(|entry| {
            let raw = entry.trim().trim_matches('"').trim_end_matches('\\');
            let expanded = expand(raw).unwrap_or_else(|| raw.to_owned());
            (!raw.is_empty()
                && !raw.eq_ignore_ascii_case(r"%JAVA_HOME%\bin")
                && !excluded
                    .iter()
                    .any(|bin| match_path(bin, Path::new(&expanded))))
            .then(|| entry.to_owned())
        }))
        .collect::<Vec<_>>()
        .join(";")
}

pub fn select_java(path: PathBuf) -> Result<(), String> {
    system_controls::require_admin()?;
    let _guard = JAVA.lock().map_err(|_| "Java settings are unavailable.")?;
    let (_, homes) = java_homes();
    let path = homes
        .iter()
        .find(|home| match_path(home, &path))
        .ok_or("The selected Java installation is unavailable.")?;
    if path.to_string_lossy().contains(';') {
        return Err("The Java installation path contains a PATH separator.".into());
    }
    let write = || -> io::Result<()> {
        let key = env_key(true, KEY_READ | KEY_SET_VALUE)?;
        let user = env_key(false, KEY_READ)
            .ok()
            .filter(|key| java_home(key).is_some());
        let user = if user.is_some() {
            Some(env_key(false, KEY_READ | KEY_SET_VALUE)?)
        } else {
            None
        };
        let previous_path = key.get_raw_value("Path")?;
        let previous_home = key.get_raw_value("JAVA_HOME").ok();
        let path_value = key.get_value::<String, _>("Path")?;
        let updated = java_machine_path(&path_value, path, &homes);
        let data = RegValue {
            vtype: REG_EXPAND_SZ,
            bytes: updated.to_reg_value().bytes,
        };
        key.set_raw_value("Path", &data)?;
        let change = key
            .set_value("JAVA_HOME", &path.as_os_str())
            .and_then(|()| {
                user.as_ref().map_or(Ok(()), |user| {
                    user.set_value("JAVA_HOME", &path.as_os_str())
                })
            });
        if let Err(error) = change {
            let rollback_path = key.set_raw_value("Path", &previous_path);
            let rollback_home = match previous_home {
                Some(value) => key.set_raw_value("JAVA_HOME", &value),
                None => key.delete_value("JAVA_HOME").or_else(|err| {
                    if err.kind() == io::ErrorKind::NotFound {
                        Ok(())
                    } else {
                        Err(err)
                    }
                }),
            };
            rollback_path.and(rollback_home).map_err(|restore| {
                io::Error::other(format!(
                    "{error}. Restoring the previous Java configuration failed. {restore}"
                ))
            })?;
            return Err(error);
        }
        Ok(())
    };
    write().map_err(|error| format!("Could not update JAVA_HOME and PATH. {error}"))?;
    let environment = native::wide("Environment");
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            environment.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            1000,
            std::ptr::null_mut(),
        );
    }
    Ok(())
}

pub fn install_java(major: u8) -> Result<(), String> {
    let id = match major {
        21 => "EclipseAdoptium.Temurin.21.JDK",
        25 => "EclipseAdoptium.Temurin.25.JDK",
        27 => "EclipseAdoptium.Temurin.27.JDK",
        _ => {
            return Err("This Java version is outside the CoreWatch App Installer catalog.".into());
        }
    };
    let _guard = INSTALL
        .try_lock()
        .map_err(|_| "Another runtime installation is in progress.")?;
    let _com =
        ComApartment::enter().ok_or("Could not initialize Windows Package Manager access.")?;
    let package = package(APP_INSTALLER)
        .map_err(|error| error.to_string())?
        .ok_or("Windows App Installer is required to install Java through WinGet.")?;
    let location = package.EffectivePath().map_err(|error| error.to_string())?;
    let output = Command::new(PathBuf::from(location.to_string()).join("winget.exe"))
        .args([
            "install",
            "--id",
            id,
            "--exact",
            "--source",
            "winget",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ])
        .creation_flags(0x08000000)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "WinGet could not install Temurin {major} ({}). {}",
        output.status,
        String::from_utf8_lossy(&output.stdout).trim()
    ))
}

fn package(family: &str) -> windows::core::Result<Option<windows::ApplicationModel::Package>> {
    Ok(PackageManager::new()?
        .FindPackagesByUserSecurityIdPackageFamilyName(&HSTRING::new(), &HSTRING::from(family))?
        .into_iter()
        .filter(|package| package.IsFramework().ok() == Some(false))
        .max_by_key(|package| {
            package
                .Id()
                .ok()
                .and_then(|id| id.Version().ok())
                .map(|v| (v.Major, v.Minor, v.Build, v.Revision))
        }))
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PowerShellChannel {
    Msi,
    Msix,
    Portable,
    None,
}

#[derive(Serialize)]
pub struct PowerShellInstall {
    channel: PowerShellChannel,
    version: Option<String>,
    arch: &'static str,
}

pub fn powershell() -> Result<PowerShellInstall, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let native_arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86" => "x86",
        _ => "x64",
    };
    let mut msi = Vec::new();
    for key in [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ] {
        if let Ok(root) = hklm.open_subkey(key) {
            for name in root.enum_keys().flatten() {
                let Ok(product) = root.open_subkey(name) else {
                    continue;
                };
                let Ok(name) = product.get_value::<String, _>("DisplayName") else {
                    continue;
                };
                if product.get_value::<u32, _>("WindowsInstaller").ok() != Some(1) {
                    continue;
                }
                let arch = match name.as_str() {
                    "PowerShell 7-x64" => "x64",
                    "PowerShell 7-x86" => "x86",
                    "PowerShell 7-arm64" => "arm64",
                    _ => continue,
                };
                let version = product.get_value::<String, _>("DisplayVersion").ok();
                msi.push((arch, version));
            }
        }
    }
    if let Some((arch, version)) = msi.into_iter().max_by_key(|(arch, version)| {
        (
            *arch == native_arch,
            version.as_deref().and_then(version_tuple),
        )
    }) {
        return Ok(PowerShellInstall {
            channel: PowerShellChannel::Msi,
            version,
            arch,
        });
    }
    let _com = ComApartment::enter();
    if let Some(package) = package(POWERSHELL_MSIX).map_err(|error| {
        format!("Could not check the current user's PowerShell packages. {error}")
    })? {
        let version = package
            .Id()
            .and_then(|id| id.Version())
            .map_err(|error| error.to_string())?;
        return Ok(PowerShellInstall {
            channel: PowerShellChannel::Msix,
            version: Some(format!(
                "{}.{}.{}",
                version.Major, version.Minor, version.Build
            )),
            arch: native_arch,
        });
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    let portable = std::env::split_paths(&path)
        .map(|path| path.join("pwsh.exe"))
        .any(|path| path.is_absolute() && path.is_file());
    Ok(PowerShellInstall {
        channel: if portable {
            PowerShellChannel::Portable
        } else {
            PowerShellChannel::None
        },
        version: None,
        arch: native_arch,
    })
}

pub fn powershell_label() -> Option<String> {
    let install = powershell().ok()?;
    Some(match install.channel {
        PowerShellChannel::None => "Install 7".into(),
        PowerShellChannel::Portable => "Portable".into(),
        _ => install
            .version
            .as_deref()
            .and_then(version_tuple)
            .map_or_else(|| "Installed".into(), |(a, b, c)| format!("{a}.{b}.{c}")),
    })
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    prerelease: bool,
    draft: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    digest: Option<String>,
}

#[derive(Serialize)]
pub struct PowerShellUpdate {
    install: PowerShellInstall,
    latest_stable: Option<String>,
    version: Option<String>,
    installer: &'static str,
    available: bool,
    #[serde(skip)]
    asset: Option<(String, String)>,
}

fn version_tuple(value: &str) -> Option<(u32, u32, u32)> {
    let mut parts = value.split('.');
    Some((
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ))
}

fn select_release(install: PowerShellInstall, releases: Vec<Release>) -> PowerShellUpdate {
    let msi = install.channel == PowerShellChannel::Msi;
    let mut latest_stable = None;
    let target = releases
        .into_iter()
        .filter_map(|release| {
            if release.draft || release.prerelease {
                return None;
            }
            let version = release.tag_name.strip_prefix('v')?;
            let (a, b, c) = version_tuple(version)?;
            if a != 7 || version != format!("{a}.{b}.{c}") {
                return None;
            }
            latest_stable =
                Some(latest_stable.map_or((a, b, c), |current| std::cmp::max(current, (a, b, c))));
            let name = if msi {
                format!("PowerShell-{version}-win-{}.msi", install.arch)
            } else {
                format!("PowerShell-{version}.msixbundle")
            };
            let digest = release
                .assets
                .into_iter()
                .find(|asset| asset.name == name)?
                .digest?;
            let hash = digest.strip_prefix("sha256:")?;
            if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return None;
            }
            Some(((a, b, c), version.to_owned(), name, hash.to_owned()))
        })
        .max_by_key(|item| item.0);
    let current = install.version.as_deref().and_then(version_tuple);
    let available = target
        .as_ref()
        .is_some_and(|item| current.is_none_or(|installed| installed < item.0))
        && matches!(
            install.channel,
            PowerShellChannel::None | PowerShellChannel::Msix | PowerShellChannel::Msi
        )
        && (install.channel == PowerShellChannel::None || current.is_some());
    PowerShellUpdate {
        latest_stable: latest_stable.map(|(a, b, c)| format!("{a}.{b}.{c}")),
        version: target.as_ref().map(|item| item.1.clone()),
        install,
        installer: if msi { "MSI" } else { "MSIX" },
        available,
        asset: target.map(|item| (item.2, item.3)),
    }
}

pub(crate) fn curl(url: &str, limit: &str) -> Result<Command, String> {
    let mut command = Command::new(network::system_directory()?.join("curl.exe"));
    command
        .args([
            "--disable",
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--connect-timeout",
            "12",
            "--max-time",
            "240",
            "--max-filesize",
            limit,
            "--user-agent",
            "CoreWatch-Rust",
        ])
        .creation_flags(0x08000000);
    command.arg(url);
    Ok(command)
}

pub fn powershell_update() -> Result<PowerShellUpdate, String> {
    let install = powershell()?;
    if install.channel == PowerShellChannel::Portable {
        return Ok(select_release(install, Vec::new()));
    }
    let output = curl(RELEASES, "8388608")?
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Could not check PowerShell releases. {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let releases = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Could not read PowerShell releases. {error}"))?;
    Ok(select_release(install, releases))
}

pub fn update_powershell(version: String) -> Result<String, String> {
    let _guard = INSTALL
        .try_lock()
        .map_err(|_| "Another runtime installation is in progress.")?;
    let update = powershell_update()?;
    if !update.available || update.version.as_deref() != Some(version.as_str()) {
        return Err("The PowerShell update changed. Check for an update again.".into());
    }
    if update.install.channel == PowerShellChannel::Msi {
        system_controls::require_admin()?;
    }
    let (name, digest) = update
        .asset
        .ok_or("No matching PowerShell installer is available.")?;
    let directory = tempfile::tempdir().map_err(|error| error.to_string())?;
    let path = directory.path().join(&name);
    let url =
        format!("https://github.com/PowerShell/PowerShell/releases/download/v{version}/{name}");
    let output = curl(&url, "268435456")?
        .arg("--output")
        .arg(&path)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "PowerShell download failed. {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    // Deny writes and replacement while hashing and while Windows Installer reads the package.
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).map_err(|error| error.to_string())?;
    if !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(&digest) {
        return Err("The PowerShell package did not match the official SHA-256 digest.".into());
    }
    if update.install.channel == PowerShellChannel::Msi {
        let result = Command::new(network::system_directory()?.join("msiexec.exe"))
            .arg("/i")
            .arg(&path)
            .arg("/norestart")
            .status()
            .map_err(|error| error.to_string())?;
        return match result.code() {
            Some(0) => Ok(format!("Installed PowerShell {version} (MSI).")),
            Some(3010) => Ok(format!(
                "Installed PowerShell {version} (MSI). Windows requires a restart."
            )),
            _ => Err(format!("PowerShell MSI returned {result}.")),
        };
    }
    let _com = ComApartment::enter().ok_or("Could not initialize MSIX deployment.")?;
    let file_url = tauri::Url::from_file_path(&path)
        .map_err(|()| "Could not address the local MSIX package.")?;
    let uri =
        Uri::CreateUri(&HSTRING::from(file_url.as_str())).map_err(|error| error.to_string())?;
    let result = PackageManager::new()
        .and_then(|manager| manager.AddPackageAsync(&uri, None, DeploymentOptions::None))
        .and_then(|operation| operation.join())
        .map_err(|error| format!("PowerShell MSIX deployment failed. {error}"))?;
    let status = result
        .ExtendedErrorCode()
        .map_err(|error| error.to_string())?;
    status
        .ok()
        .map_err(|error| format!("PowerShell MSIX deployment failed. {error}"))?;
    Ok(format!("Installed PowerShell {version} (MSIX)."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_update_stays_on_installed_channel_and_skips_releases_without_its_asset() {
        let releases = || {
            ["7.6.2", "7.6.1"]
                .into_iter()
                .map(|version| Release {
                    tag_name: format!("v{version}"),
                    prerelease: false,
                    draft: false,
                    assets: [
                        format!("PowerShell-{version}.msixbundle"),
                        "PowerShell-7.6.1-win-x64.msi".into(),
                    ]
                    .into_iter()
                    .map(|name| Asset {
                        name,
                        digest: Some(format!("sha256:{}", "1".repeat(64))),
                    })
                    .collect(),
                })
                .collect()
        };
        let update = select_release(
            PowerShellInstall {
                channel: PowerShellChannel::Msi,
                version: Some("7.6.0.0".into()),
                arch: "x64",
            },
            releases(),
        );
        assert_eq!(update.version.as_deref(), Some("7.6.1"));
        assert_eq!(update.latest_stable.as_deref(), Some("7.6.2"));
        assert!(update.available);
        let update = select_release(
            PowerShellInstall {
                channel: PowerShellChannel::None,
                version: None,
                arch: "x64",
            },
            releases(),
        );
        assert_eq!(update.version.as_deref(), Some("7.6.2"));
        assert_eq!(update.installer, "MSIX");
    }
}
