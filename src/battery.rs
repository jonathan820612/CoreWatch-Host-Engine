use crate::{
    dashboard_actions,
    details::{number, rows, text},
    devices::ComApartment,
};
use serde::{Deserialize, Serialize};
use std::{
    os::windows::process::CommandExt,
    path::PathBuf,
    process::Command,
};
use wmi::WMIConnection;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub name: String,
    pub status: String,
    pub charge_percent: Option<u64>,
    pub estimated_minutes: Option<u64>,
    pub design_capacity_mwh: Option<u64>,
    pub full_charge_capacity_mwh: Option<u64>,
    pub health_percent: Option<f64>,
    pub wear_percent: Option<f64>,
    pub cycle_count: Option<u64>,
    pub voltage_mv: Option<u64>,
    pub charge_rate_mw: Option<u64>,
    pub discharge_rate_mw: Option<u64>,
    pub ac_online: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralBattery {
    pub name: String,
    pub category: String,
    pub battery_percent: u8,
    pub instance_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatterySnapshot {
    pub has_battery: bool,
    pub batteries: Vec<BatteryInfo>,
    pub peripherals: Vec<PeripheralBattery>,
    pub power_plan: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BatteryAction {
    BatteryReport,
    SleepStudy,
    OpenPowerSettings,
    OpenBluetoothSettings,
}

fn status_label(code: Option<u64>) -> &'static str {
    match code {
        Some(1) => "Discharging",
        Some(2) => "AC Connected",
        Some(3) => "Fully Charged",
        Some(4) => "Low",
        Some(5) => "Critical",
        Some(6) => "Charging",
        Some(7) => "Charging & High",
        Some(8) => "Charging & Low",
        Some(9) => "Charging & Critical",
        _ => "Unknown",
    }
}

pub fn snapshot() -> BatterySnapshot {
    let _com = ComApartment::enter();
    let cimv2 = WMIConnection::new().ok();
    let root_wmi = WMIConnection::with_namespace_path(r"ROOT\WMI").ok();

    let static_data = rows(
        root_wmi.as_ref(),
        "SELECT DesignedCapacity FROM BatteryStaticData",
    );
    let full_data = rows(
        root_wmi.as_ref(),
        "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity",
    );
    let cycle_data = rows(root_wmi.as_ref(), "SELECT CycleCount FROM BatteryCycleCount");
    let live_data = rows(
        root_wmi.as_ref(),
        "SELECT PowerOnline, Voltage, ChargeRate, DischargeRate FROM BatteryStatus",
    );

    let win32_bats = rows(
        cimv2.as_ref(),
        "SELECT Name, BatteryStatus, EstimatedChargeRemaining, EstimatedRunTime, DesignVoltage FROM Win32_Battery",
    );

    let mut batteries = Vec::new();
    for (idx, row) in win32_bats.iter().enumerate() {
        let design = static_data
            .get(idx)
            .and_then(|r| number(r, "DesignedCapacity"))
            .filter(|&v| v > 0);
        let full = full_data
            .get(idx)
            .and_then(|r| number(r, "FullChargedCapacity"))
            .filter(|&v| v > 0);
        let (health_percent, wear_percent) = match (design, full) {
            (Some(d), Some(f)) => {
                let h = ((f as f64 / d as f64) * 100.0).clamp(0.0, 100.0);
                let h_r = (h * 10.0).round() / 10.0;
                (Some(h_r), Some(((100.0 - h_r) * 10.0).round() / 10.0))
            }
            _ => (None, None),
        };
        let cycle_count = cycle_data
            .get(idx)
            .and_then(|r| number(r, "CycleCount"))
            .filter(|&v| v > 0);
        let live = live_data.get(idx);
        let ac_online = live.and_then(|r| match r.get("PowerOnline") {
            Some(wmi::Variant::Bool(b)) => Some(*b),
            _ => None,
        });
        let voltage_mv = live
            .and_then(|r| number(r, "Voltage"))
            .or_else(|| number(row, "DesignVoltage"))
            .filter(|&v| v > 0);
        let charge_rate_mw = live
            .and_then(|r| number(r, "ChargeRate"))
            .filter(|&v| v > 0 && v < 500_000);
        let discharge_rate_mw = live
            .and_then(|r| number(r, "DischargeRate"))
            .filter(|&v| v > 0 && v < 500_000);
        let estimated_minutes = number(row, "EstimatedRunTime").filter(|&m| m > 0 && m < 10_000);

        batteries.push(BatteryInfo {
            name: text(row, "Name").unwrap_or("Internal Battery").to_owned(),
            status: status_label(number(row, "BatteryStatus")).to_owned(),
            charge_percent: number(row, "EstimatedChargeRemaining"),
            estimated_minutes,
            design_capacity_mwh: design,
            full_charge_capacity_mwh: full,
            health_percent,
            wear_percent,
            cycle_count,
            voltage_mv,
            charge_rate_mw,
            discharge_rate_mw,
            ac_online,
        });
    }

    let peripherals = scan_bluetooth_peripherals();
    BatterySnapshot {
        has_battery: !batteries.is_empty(),
        batteries,
        peripherals,
        power_plan: crate::native::power_plan(),
    }
}

fn scan_bluetooth_peripherals() -> Vec<PeripheralBattery> {
    let Ok(sysdir) = crate::network::system_directory() else {
        return Vec::new();
    };
    let ps = sysdir.join(r"WindowsPowerShell\v1.0\powershell.exe");
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$devs = Get-PnpDevice -Class Bluetooth -Status OK
$out = @()
foreach ($d in $devs) {
    $prop = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
    if ($prop -and $null -ne $prop.Data) {
        $lvl = [int]$prop.Data
        if ($lvl -ge 0 -and $lvl -le 100) {
            $out += [pscustomobject]@{
                name = [string]$d.FriendlyName
                category = 'Bluetooth'
                batteryPercent = $lvl
                instanceId = [string]$d.InstanceId
            }
        }
    }
}
if ($out.Count -gt 0) { $out | ConvertTo-Json -Compress } else { '[]' }
"#;
    let Ok(output) = Command::new(ps)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if raw.is_empty() || raw == "[]" {
        return Vec::new();
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RawPerip {
        name: String,
        category: String,
        battery_percent: u8,
        instance_id: String,
    }
    let items: Vec<RawPerip> = if raw.starts_with('[') {
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        serde_json::from_str::<RawPerip>(&raw)
            .map(|x| vec![x])
            .unwrap_or_default()
    };
    items
        .into_iter()
        .map(|p| PeripheralBattery {
            name: p.name,
            category: p.category,
            battery_percent: p.battery_percent,
            instance_id: p.instance_id,
        })
        .collect()
}

pub fn execute(action: BatteryAction, exports_root: &str) -> Result<String, String> {
    match action {
        BatteryAction::BatteryReport | BatteryAction::SleepStudy => {
            let is_sleep = matches!(action, BatteryAction::SleepStudy);
            let dir = if !exports_root.trim().is_empty() {
                PathBuf::from(exports_root)
            } else {
                std::env::temp_dir()
            };
            let _ = std::fs::create_dir_all(&dir);
            let filename = if is_sleep {
                "corewatch-sleepstudy.html"
            } else {
                "corewatch-battery-report.html"
            };
            let out_path = dir.join(filename);
            let flag = if is_sleep {
                "/sleepstudy"
            } else {
                "/batteryreport"
            };
            let powercfg = crate::network::system_directory()?.join("powercfg.exe");
            let output = Command::new(powercfg)
                .args([flag, "/output", &out_path.to_string_lossy()])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Failed to run powercfg: {e}"))?;
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr).trim().to_owned();
                let out = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                return Err(format!(
                    "powercfg {flag} failed: {}",
                    if !err.is_empty() { err } else { out }
                ));
            }
            dashboard_actions::shell_open(&out_path.to_string_lossy(), None, false)?;
            Ok(format!("Generated and opened {}", out_path.display()))
        }
        BatteryAction::OpenPowerSettings => {
            dashboard_actions::shell_open("ms-settings:powersleep", None, false)?;
            Ok("Opened Windows Power & Battery Settings.".into())
        }
        BatteryAction::OpenBluetoothSettings => {
            dashboard_actions::shell_open("ms-settings:bluetooth", None, false)?;
            Ok("Opened Windows Bluetooth & Devices Settings.".into())
        }
    }
}
