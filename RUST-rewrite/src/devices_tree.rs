use crate::{
    dashboard_actions,
    details::{number, rows, text},
    devices::ComApartment,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeSet, HashMap},
    time::{SystemTime, UNIX_EPOCH},
};
use wmi::WMIConnection;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEntry {
    pub name: String,
    pub class: String,
    pub manufacturer: String,
    pub driver_version: String,
    pub driver_date: String,
    pub age_years: Option<f64>,
    pub outdated: bool,
    pub error_code: u64,
    pub error_detail: &'static str,
    pub status: String,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesReport {
    pub total: usize,
    pub problem_count: usize,
    pub outdated_count: usize,
    pub disabled_count: usize,
    pub classes: Vec<String>,
    pub devices: Vec<DeviceEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DeviceAction {
    OpenDeviceManager,
    OpenVendor { vendor: String },
}

pub fn cm_error_description(code: u64) -> &'static str {
    match code {
        0 => "",
        1 => "Code 1: Device not configured correctly — reinstall driver.",
        10 => "Code 10: Device failed to start — update driver or check hardware.",
        12 => "Code 12: Insufficient free hardware resources (IRQ/PCIe).",
        14 => "Code 14: Reboot required to finish driver installation.",
        18 => "Code 18: Reinstall drivers for this device.",
        22 => "Code 22: Device is disabled in Device Manager.",
        24 => "Code 24: Device is not present or not working properly.",
        28 => "Code 28: Drivers for this device are NOT installed — install chipset/vendor driver.",
        29 => "Code 29: Device disabled by system firmware/BIOS.",
        31 => "Code 31: Windows cannot load the drivers required for this device.",
        32 => "Code 32: Start driver service is disabled in registry.",
        37 => "Code 37: Windows cannot initialize the device driver.",
        39 => "Code 39: Driver binary is missing or corrupted.",
        43 => "Code 43: Windows stopped this device because it reported hardware problems.",
        45 => "Code 45: Hardware device is currently disconnected.",
        48 => "Code 48: Software driver blocked due to known Windows incompatibility.",
        52 => "Code 52: Windows cannot verify the digital signature for this driver.",
        _ => "Hardware / driver fault reported by Windows Plug and Play.",
    }
}

fn current_year_decimal() -> f64 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    1970.0 + secs / (365.2425 * 86_400.0)
}

pub fn parse_wmi_driver_date(raw: &str) -> Option<(String, f64)> {
    if raw.len() < 8 {
        return None;
    }
    let y: i32 = raw.get(0..4)?.parse().ok()?;
    let m: u32 = raw.get(4..6)?.parse().ok()?;
    let d: u32 = raw.get(6..8)?.parse().ok()?;
    if !(1990..=2100).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let formatted = format!("{y:04}-{m:02}-{d:02}");
    let decimal_year =
        y as f64 + (m.saturating_sub(1) as f64) / 12.0 + (d.saturating_sub(1) as f64) / 365.25;
    let age = (current_year_decimal() - decimal_year).max(0.0);
    Some((formatted, (age * 10.0).round() / 10.0))
}

pub fn scan() -> DevicesReport {
    let _com = ComApartment::enter();
    let wmi = WMIConnection::new().ok();

    struct DriverMeta {
        class: String,
        manufacturer: String,
        version: String,
        date: String,
        age: Option<f64>,
    }

    let mut signed_by_id: HashMap<String, DriverMeta> = HashMap::new();
    for row in rows(
        wmi.as_ref(),
        "SELECT DeviceClass, Manufacturer, DriverVersion, DriverDate, DeviceID FROM Win32_PnPSignedDriver",
    ) {
        let Some(id) = text(&row, "DeviceID") else {
            continue;
        };
        let (date, age) = text(&row, "DriverDate")
            .and_then(parse_wmi_driver_date)
            .map(|(d, a)| (d, Some(a)))
            .unwrap_or_else(|| ("—".into(), None));
        signed_by_id.insert(
            id.to_ascii_lowercase(),
            DriverMeta {
                class: text(&row, "DeviceClass").unwrap_or("Other").to_owned(),
                manufacturer: text(&row, "Manufacturer").unwrap_or("Generic").to_owned(),
                version: text(&row, "DriverVersion").unwrap_or("—").to_owned(),
                date,
                age,
            },
        );
    }

    // Left-join Win32_PnPEntity with Win32_PnPSignedDriver so Code 28 (missing driver!) & errored devices ALWAYS show!
    let mut devices = Vec::new();
    let mut class_set = BTreeSet::new();
    for row in rows(
        wmi.as_ref(),
        "SELECT Name, PNPClass, Manufacturer, DeviceID, ConfigManagerErrorCode FROM Win32_PnPEntity",
    ) {
        let Some(name) = text(&row, "Name") else {
            continue;
        };
        let dev_id = text(&row, "DeviceID").unwrap_or("").to_ascii_lowercase();
        let error_code = number(&row, "ConfigManagerErrorCode").unwrap_or(0);
        let drv = signed_by_id.get(&dev_id);

        // Skip driverless pseudo-root nodes with no error and no signed driver unless they have a fault
        if drv.is_none() && error_code == 0 {
            continue;
        }

        let class = drv
            .map(|d| d.class.clone())
            .filter(|c| !c.is_empty() && c != "Other")
            .or_else(|| text(&row, "PNPClass").map(str::to_owned))
            .unwrap_or_else(|| "Unknown".into());
        class_set.insert(class.clone());
        let manufacturer = drv
            .map(|d| d.manufacturer.clone())
            .filter(|m| !m.is_empty())
            .or_else(|| text(&row, "Manufacturer").map(str::to_owned))
            .unwrap_or_else(|| "Generic".into());
        let driver_version = drv.map_or_else(|| "Not Installed".into(), |d| d.version.clone());
        let driver_date = drv.map_or_else(|| "—".into(), |d| d.date.clone());
        let age_years = drv.and_then(|d| d.age);

        let disabled = error_code == 22;
        let is_ms_inbox = manufacturer.eq_ignore_ascii_case("Microsoft");
        let outdated = error_code == 0 && !is_ms_inbox && age_years.is_some_and(|a| a >= 3.0);
        let status = if disabled {
            "Disabled (#22)".into()
        } else if error_code != 0 {
            format!("Error #{error_code}")
        } else if outdated {
            "Aging Driver".into()
        } else {
            "OK".into()
        };

        devices.push(DeviceEntry {
            name: name.to_owned(),
            class,
            manufacturer,
            driver_version,
            driver_date,
            age_years,
            outdated,
            error_code,
            error_detail: cm_error_description(error_code),
            status,
            disabled,
        });
    }

    devices.sort_by(|a, b| {
        (b.error_code != 0 && !b.disabled)
            .cmp(&(a.error_code != 0 && !a.disabled))
            .then_with(|| b.disabled.cmp(&a.disabled))
            .then_with(|| b.outdated.cmp(&a.outdated))
            .then_with(|| a.class.cmp(&b.class))
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });

    let problem_count = devices
        .iter()
        .filter(|d| d.error_code != 0 && !d.disabled)
        .count();
    let disabled_count = devices.iter().filter(|d| d.disabled).count();
    let outdated_count = devices.iter().filter(|d| d.outdated).count();
    DevicesReport {
        total: devices.len(),
        problem_count,
        outdated_count,
        disabled_count,
        classes: class_set.into_iter().collect(),
        devices,
    }
}

pub fn execute(action: DeviceAction) -> Result<String, String> {
    match action {
        DeviceAction::OpenDeviceManager => {
            dashboard_actions::shell_open("devmgmt.msc", None, false)?;
            Ok("Opened Windows Device Manager (devmgmt.msc).".into())
        }
        DeviceAction::OpenVendor { vendor } => {
            let url = match vendor.to_ascii_lowercase().as_str() {
                "nvidia" => "https://www.nvidia.com/en-us/drivers/",
                "amd" => "https://www.amd.com/en/support/download/drivers.html",
                "intel" => "https://www.intel.com/content/www/us/en/download-center/home.html",
                "realtek" => "https://www.realtek.com/Download/Index",
                _ => return Err("Unknown vendor portal.".into()),
            };
            dashboard_actions::shell_open(url, None, false)?;
            Ok(format!("Opened {vendor} official driver portal."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wmi_driver_dates_and_cm_errors() {
        let (date, age) = parse_wmi_driver_date("20220315000000.000000-000").unwrap();
        assert_eq!(date, "2022-03-15");
        assert!(age >= 1.0);
        assert!(parse_wmi_driver_date("invalid").is_none());
        assert!(cm_error_description(28).contains("NOT installed"));
    }
}
