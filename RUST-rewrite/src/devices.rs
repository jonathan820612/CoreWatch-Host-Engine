use windows::Win32::{
    Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
    Graphics::Dxgi::{CreateDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIFactory1},
    Media::Audio::{
        EDataFlow, IMMDeviceEnumerator, MMDeviceEnumerator, eCapture, eMultimedia, eRender,
    },
    NetworkManagement::WindowsFirewall::{
        INetFwPolicy2, NET_FW_PROFILE2_DOMAIN, NET_FW_PROFILE2_PRIVATE, NET_FW_PROFILE2_PUBLIC,
        NetFwPolicy2,
    },
    System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
        CoTaskMemFree, CoUninitialize, STGM_READ,
        StructuredStorage::{PropVariantClear, PropVariantToStringAlloc},
    },
};

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

pub fn firewall() -> Option<String> {
    unsafe {
        let policy: INetFwPolicy2 =
            CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER).ok()?;
        let types = policy.CurrentProfileTypes().ok()?;
        let mut states = Vec::new();
        for (profile, label) in [
            (NET_FW_PROFILE2_DOMAIN, "Domain"),
            (NET_FW_PROFILE2_PRIVATE, "Private"),
            (NET_FW_PROFILE2_PUBLIC, "Public"),
        ] {
            if types & profile.0 != 0 {
                let state = policy.get_FirewallEnabled(profile).ok()?;
                states.push(format!(
                    "{label} {}",
                    if state.0 != 0 { "on" } else { "off" }
                ));
            }
        }
        (!states.is_empty()).then(|| states.join(" · "))
    }
}
