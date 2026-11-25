use serde::Deserialize;
use windows::Win32::{
    Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
    Graphics::Dxgi::{CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIFactory1},
    Media::Audio::{
        EDataFlow, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eMultimedia, eRender,
    },
    NetworkManagement::WindowsFirewall::{
        INetFwPolicy2, NET_FW_MODIFY_STATE_OK, NET_FW_PROFILE_TYPE2, NET_FW_PROFILE2_ALL,
        NET_FW_PROFILE2_DOMAIN, NET_FW_PROFILE2_PRIVATE, NET_FW_PROFILE2_PUBLIC, NetFwPolicy2,
    },
    System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize, STGM_READ,
        StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
    },
};
use windows::core::BSTR;

pub struct ComApartment;

impl ComApartment {
    pub fn enter() -> Option<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .is_ok()
                .then_some(Self)
        }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub struct Gpu {
    pub name: String,
    pub dedicated: usize,
    pub high: u32,
    pub low: u32,
    pub single: bool,
}

pub fn gpu() -> Option<Gpu> {
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let mut best: Option<Gpu> = None;
        let mut candidates = 0;
        for index in 0.. {
            let Ok(adapter) = factory.EnumAdapters1(index) else {
                break;
            };
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            candidates += 1;
            if best
                .as_ref()
                .is_some_and(|gpu| gpu.dedicated >= desc.DedicatedVideoMemory)
            {
                continue;
            }
            let length = desc
                .Description
                .iter()
                .position(|&ch| ch == 0)
                .unwrap_or(desc.Description.len());
            best = Some(Gpu {
                name: String::from_utf16_lossy(&desc.Description[..length]),
                dedicated: desc.DedicatedVideoMemory,
                high: desc.AdapterLuid.HighPart as u32,
                low: desc.AdapterLuid.LowPart,
                single: false,
            });
        }
        best.map(|mut gpu| {
            gpu.single = candidates == 1;
            gpu
        })
    }
}

pub fn audio() -> (Option<String>, Option<String>) {
    let Ok(enumerator) = (unsafe {
        CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_INPROC_SERVER)
    }) else {
        return (None, None);
    };
    (
        endpoint(&enumerator, eRender),
        endpoint(&enumerator, eCapture),
    )
}

fn endpoint(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> Option<String> {
    unsafe {
        let device = enumerator.GetDefaultAudioEndpoint(flow, eMultimedia).ok()?;
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let mut value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        let result = PropVariantToStringAlloc(&value);
        let _ = PropVariantClear(&mut value);
        let text = result.ok()?;
        let name = text.to_string().ok();
        CoTaskMemFree(Some(text.as_ptr().cast()));
        name
    }
}

const FIREWALL_PROFILES: [(NET_FW_PROFILE_TYPE2, &str); 3] = [
    (NET_FW_PROFILE2_DOMAIN, "Domain"),
    (NET_FW_PROFILE2_PRIVATE, "Private"),
    (NET_FW_PROFILE2_PUBLIC, "Public"),
];

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FirewallGroup {
    Discovery,
    Sharing,
}

impl FirewallGroup {
    fn resource(self) -> BSTR {
        // Built-in indirect names from the firewall rule store, independent of Windows UI language.
        BSTR::from(match self {
            Self::Discovery => "@FirewallAPI.dll,-32752",
            Self::Sharing => "@FirewallAPI.dll,-28502",
        })
    }

    fn label(self) -> &'static str {
        match self {
            Self::Discovery => "Network Discovery",
            Self::Sharing => "File and Printer Sharing",
        }
    }
}

pub struct Firewall {
    policy: INetFwPolicy2,
    active: i32,
}

impl Firewall {
    pub fn read() -> windows::core::Result<Self> {
        let policy: INetFwPolicy2 =
            unsafe { CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER)? };
        let active = unsafe { policy.CurrentProfileTypes()? };
        Ok(Self { policy, active })
    }

    pub fn status(&self) -> Option<String> {
        let mut states = Vec::new();
        for (profile, label) in FIREWALL_PROFILES {
            if self.active & profile.0 != 0 {
                let state = unsafe { self.policy.get_FirewallEnabled(profile).ok()? };
                states.push(format!(
                    "{label} {}",
                    if state.0 != 0 { "on" } else { "off" }
                ));
            }
        }
        (!states.is_empty()).then(|| states.join(" · "))
    }

    pub fn group_status(&self, group: FirewallGroup) -> Option<&'static str> {
        let group = group.resource();
        let mut enabled = 0;
        let mut disabled = 0;
        for (profile, _) in FIREWALL_PROFILES {
            if self.active & profile.0 != 0 {
                if unsafe { self.policy.IsRuleGroupEnabled(profile.0, &group).ok()? }.0 != 0 {
                    enabled += 1;
                } else {
                    disabled += 1;
                }
            }
        }
        match (enabled, disabled) {
            (0, 0) => None,
            (0, _) => Some("Off"),
            (_, 0) => Some("On"),
            _ => Some("Mixed"),
        }
    }
}

pub fn set_firewall_group(group: FirewallGroup, enabled: bool) -> Result<(), String> {
    let label = group.label();
    if !crate::native::elevated() {
        return Err(format!(
            "Restart CoreWatch as administrator to change {label}."
        ));
    }
    let _com = ComApartment::enter().ok_or("Could not initialize Windows Firewall access.")?;
    let problem = |error| format!("Could not change {label}. {error}");
    let firewall = Firewall::read().map_err(problem)?;
    let group = group.resource();
    unsafe {
        if firewall.policy.LocalPolicyModifyState().map_err(problem)? != NET_FW_MODIFY_STATE_OK {
            return Err(format!(
                "Windows Firewall policy prevents a local change to {label}."
            ));
        }
        // The PowerShell dashboard changes the built-in group across all profiles.
        firewall
            .policy
            .EnableRuleGroup(NET_FW_PROFILE2_ALL.0, &group, enabled.into())
            .map_err(problem)?;
        for (profile, name) in FIREWALL_PROFILES {
            let result = firewall
                .policy
                .IsRuleGroupEnabled(profile.0, &group)
                .map_err(|error| {
                    format!(
                        "Windows could not verify {label} on the {name} firewall profile. {error}"
                    )
                })?;
            if (result.0 != 0) != enabled {
                return Err(format!(
                    "Windows did not report the requested {label} state on the {name} firewall profile."
                ));
            }
        }
    }
    Ok(())
}

pub fn set_firewall(enabled: bool) -> Result<(), String> {
    let _com = ComApartment::enter().ok_or("Could not initialize Windows Firewall access.")?;
    let error = |error| format!("Windows Firewall rejected the change. {error}");
    let firewall = Firewall::read().map_err(error)?;
    let mut original = Vec::new();
    for (profile, _) in FIREWALL_PROFILES {
        original.push((
            profile,
            unsafe { firewall.policy.get_FirewallEnabled(profile) }.map_err(error)?,
        ));
    }
    for (index, &(profile, value)) in original.iter().enumerate() {
        if (value.0 != 0) == enabled {
            continue;
        }
        if let Err(failure) =
            unsafe { firewall.policy.put_FirewallEnabled(profile, enabled.into()) }
        {
            let mut restored = true;
            for &(profile, value) in &original[..index] {
                if (value.0 != 0) != enabled {
                    restored &=
                        unsafe { firewall.policy.put_FirewallEnabled(profile, value).is_ok() };
                }
            }
            return Err(if restored {
                error(failure)
            } else {
                format!(
                    "{} Review the profiles for partial changes.",
                    error(failure)
                )
            });
        }
    }
    for (profile, label) in FIREWALL_PROFILES {
        if (unsafe { firewall.policy.get_FirewallEnabled(profile) }
            .map_err(error)?
            .0
            != 0)
            != enabled
        {
            return Err(format!(
                "Windows did not report the requested firewall state for the {label} profile."
            ));
        }
    }
    Ok(())
}
