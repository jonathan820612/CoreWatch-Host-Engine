use crate::{
    devices, native,
    network::{self, Tool},
};
use serde::Deserialize;
use std::ptr;
use windows_sys::Win32::{
    Foundation::{
        ERROR_SERVICE_ALREADY_RUNNING, ERROR_SERVICE_DOES_NOT_EXIST, ERROR_SERVICE_NOT_ACTIVE,
        GetLastError,
    },
    System::Services::*,
};
use wmi::{Variant, WMIConnection};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Setting {
    Telemetry,
    Firewall,
    Realtime,
    Behavior,
    Cloud,
    Ioav,
}

pub fn require_admin() -> Result<(), String> {
    native::elevated()
        .then_some(())
        .ok_or_else(|| "Restart CoreWatch as administrator to change this setting.".into())
}

pub fn set(setting: Setting, enabled: bool) -> Result<(), String> {
    require_admin()?;
    match setting {
        Setting::Telemetry => set_telemetry(enabled),
        Setting::Firewall => devices::set_firewall(enabled),
        _ => set_defender(setting, enabled),
    }
}

struct Service(SC_HANDLE);

impl Drop for Service {
    fn drop(&mut self) {
        unsafe { CloseServiceHandle(self.0) };
    }
}

fn set_telemetry(enabled: bool) -> Result<(), String> {
    let manager = unsafe { OpenSCManagerW(ptr::null(), ptr::null(), SC_MANAGER_CONNECT) };
    if manager.is_null() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let manager = Service(manager);
    for (name, startup, optional) in [
        ("DiagTrack", SERVICE_AUTO_START, false),
        ("dmwappushservice", SERVICE_DEMAND_START, true),
    ] {
        let service = unsafe {
            OpenServiceW(
                manager.0,
                native::wide(name).as_ptr(),
                SERVICE_CHANGE_CONFIG | SERVICE_START | SERVICE_STOP,
            )
        };
        if service.is_null() {
            let code = unsafe { GetLastError() };
            if optional && code == ERROR_SERVICE_DOES_NOT_EXIST {
                continue;
            }
            return Err(format!(
                "{name}: {}",
                std::io::Error::from_raw_os_error(code as i32)
            ));
        }
        let service = Service(service);
        let result = unsafe {
            ChangeServiceConfigW(
                service.0,
                SERVICE_NO_CHANGE,
                if enabled { startup } else { SERVICE_DISABLED },
                SERVICE_NO_CHANGE,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
            )
        };
        if result == 0 {
            return Err(format!("{name}: {}", std::io::Error::last_os_error()));
        }
        let result = if enabled {
            unsafe { StartServiceW(service.0, 0, ptr::null()) }
        } else {
            unsafe {
                ControlService(
                    service.0,
                    SERVICE_CONTROL_STOP,
                    &mut SERVICE_STATUS::default(),
                )
            }
        };
        if result == 0 {
            let code = unsafe { GetLastError() };
            if code
                != if enabled {
                    ERROR_SERVICE_ALREADY_RUNNING
                } else {
                    ERROR_SERVICE_NOT_ACTIVE
                }
            {
                return Err(format!(
                    "{name}: {}",
                    std::io::Error::from_raw_os_error(code as i32)
                ));
            }
        }
    }
    Ok(())
}

fn set_defender(setting: Setting, enabled: bool) -> Result<(), String> {
    let wmi = WMIConnection::with_namespace_path(r"ROOT\Microsoft\Windows\Defender")
        .map_err(|error| error.to_string())?;
    let apply = || -> wmi::WMIResult<()> {
        let status = wmi
            .exec_query("SELECT * FROM MSFT_MpComputerStatus")?
            .next()
            .transpose()?;
        let tamper = status
            .as_ref()
            .and_then(|status| status.get_property("IsTamperProtected").ok());
        if tamper != Some(Variant::Bool(false)) {
            return Ok(());
        }
        let class = wmi.get_object("MSFT_MpPreference")?;
        let input = class
            .get_method("Set")?
            .ok_or(wmi::WMIError::NullPointerResult)?
            .spawn_instance()?;
        let (property, value) = match setting {
            Setting::Realtime => ("DisableRealtimeMonitoring", Variant::Bool(!enabled)),
            Setting::Behavior => ("DisableBehaviorMonitoring", Variant::Bool(!enabled)),
            Setting::Ioav => ("DisableIOAVProtection", Variant::Bool(!enabled)),
            Setting::Cloud => ("MAPSReporting", Variant::UI1(if enabled { 2 } else { 0 })),
            _ => unreachable!(),
        };
        input.put_property(property, value)?;
        if let Some(result) = wmi.exec_method("MSFT_MpPreference", "Set", Some(&input))? {
            let code = result.get_property("ReturnValue")?;
            if !matches!(code, Variant::I4(0) | Variant::UI4(0)) {
                return Err(wmi::WMIError::ConvertVariantError(format!(
                    "Defender returned {code:?}"
                )));
            }
        }
        Ok(())
    };
    apply().map_err(|error| format!("Windows Defender rejected the change. {error}"))?;
    let (class, field) = match setting {
        Setting::Realtime => ("MSFT_MpComputerStatus", "RealTimeProtectionEnabled"),
        Setting::Behavior => ("MSFT_MpComputerStatus", "BehaviorMonitorEnabled"),
        Setting::Ioav => ("MSFT_MpComputerStatus", "IoavProtectionEnabled"),
        Setting::Cloud => ("MSFT_MpPreference", "MAPSReporting"),
        _ => unreachable!(),
    };
    let query = format!("SELECT {field} FROM {class}");
    for _ in 0..4 {
        let current = wmi
            .exec_query(&query)
            .ok()
            .and_then(|mut rows| rows.next()?.ok())
            .and_then(|row| row.get_property(field).ok());
        let current = match current {
            Some(Variant::Bool(value)) => Some(value),
            Some(Variant::UI1(value)) => Some(value != 0),
            Some(Variant::UI4(value)) => Some(value != 0),
            Some(Variant::I4(value)) => Some(value != 0),
            _ => None,
        };
        if current == Some(enabled) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Err("Windows Defender did not apply the requested state. Tamper Protection or a managed policy may control this setting.".into())
}

pub fn set_network_profile(index: u32, private: bool) -> Result<(), String> {
    require_admin()?;
    let adapters = native::adapters().ok_or("Windows network adapters are unavailable.")?;
    if native::default_ipv4_route(&adapters).map(|(current, _)| current) != Some(index) {
        return Err("The active network adapter changed. Refresh and try again.".into());
    }
    let wmi = WMIConnection::with_namespace_path(r"ROOT\StandardCimv2")
        .map_err(|error| error.to_string())?;
    let query = format!("SELECT * FROM MSFT_NetConnectionProfile WHERE InterfaceIndex = {index}");
    let profile = wmi
        .exec_query(query)
        .map_err(|error| error.to_string())?
        .next()
        .transpose()
        .map_err(|error| error.to_string())?
        .ok_or("The active network profile is unavailable.")?;
    match profile
        .get_property("NetworkCategory")
        .map_err(|error| error.to_string())?
    {
        Variant::UI4(0 | 1) | Variant::I4(0 | 1) => (),
        _ => return Err("The network category is managed by Windows or your organization.".into()),
    }
    profile
        .put_property("NetworkCategory", Variant::UI4(u32::from(private)))
        .and_then(|()| wmi.put_instance(&profile))
        .map_err(|error| format!("Windows rejected the network profile change. {error}"))
}

pub fn restart() -> Result<(), String> {
    network::system_tool(Tool::Shutdown, ["/r", "/t", "0"]).map(|_| ())
}
