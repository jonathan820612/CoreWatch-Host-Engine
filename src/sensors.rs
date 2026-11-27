use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    os::windows::{io::AsRawHandle, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_operation_count: u64,
    write_operation_count: u64,
    other_operation_count: u64,
    read_transfer_count: u64,
    write_transfer_count: u64,
    other_transfer_count: u64,
}

#[repr(C)]
#[derive(Default)]
struct JobObjectBasicLimitInformation {
    per_process_user_time_limit: i64,
    per_job_user_time_limit: i64,
    limit_flags: u32,
    minimum_working_set_size: usize,
    maximum_working_set_size: usize,
    active_process_limit: u32,
    affinity: usize,
    priority_class: u32,
    scheduling_class: u32,
}

#[repr(C)]
#[derive(Default)]
struct JobObjectExtendedLimitInformation {
    basic_limit_information: JobObjectBasicLimitInformation,
    io_info: IoCounters,
    process_memory_limit: usize,
    job_memory_limit: usize,
    peak_process_memory_used: usize,
    peak_job_memory_used: usize,
}

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: u32 = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

#[link(name = "kernel32")]
unsafe extern "system" {
    fn CreateJobObjectW(attributes: *const core::ffi::c_void, name: *const u16) -> HANDLE;
    fn SetInformationJobObject(
        job: HANDLE,
        info_class: u32,
        info: *const core::ffi::c_void,
        info_len: u32,
    ) -> i32;
    fn AssignProcessToJobObject(job: HANDLE, process: HANDLE) -> i32;
}

struct KillOnCloseJob(HANDLE);
unsafe impl Send for KillOnCloseJob {}

impl KillOnCloseJob {
    fn attach(child: &Child) -> Option<Self> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info = JobObjectExtendedLimitInformation::default();
            info.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok_info = SetInformationJobObject(
                job,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                (&raw const info).cast(),
                std::mem::size_of::<JobObjectExtendedLimitInformation>() as u32,
            );
            if ok_info == 0 {
                CloseHandle(job);
                return None;
            }
            let ok_assign = AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
            if ok_assign == 0 {
                CloseHandle(job);
                return None;
            }
            Some(Self(job))
        }
    }
}

impl Drop for KillOnCloseJob {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[derive(Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Readings {
    pub cpu_temp: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub gpu_power: Option<f64>,
    #[serde(default)]
    pub gpu_load: Option<f64>,
    pub sensor: Option<String>,
    error: Option<String>,
}

// =========================================================================
// NATIVE NVIDIA NVML SENSOR ENGINE (nvml.dll — Standard User, <1ms, Zero Helper)
// =========================================================================
mod nvml {
    use std::ffi::{c_uint, c_void};
    use std::sync::OnceLock;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    #[repr(C)]
    #[derive(Default)]
    struct NvmlUtilization {
        gpu: c_uint,
        memory: c_uint,
    }

    type FnInitV2 = unsafe extern "C" fn() -> c_uint;
    type FnGetHandleByIndexV2 = unsafe extern "C" fn(c_uint, *mut *mut c_void) -> c_uint;
    type FnGetTemperature = unsafe extern "C" fn(*mut c_void, c_uint, *mut c_uint) -> c_uint;
    type FnGetPowerUsage = unsafe extern "C" fn(*mut c_void, *mut c_uint) -> c_uint;
    type FnGetUtilization = unsafe extern "C" fn(*mut c_void, *mut NvmlUtilization) -> c_uint;

    struct NvmlApi {
        get_handle: FnGetHandleByIndexV2,
        get_temp: FnGetTemperature,
        get_power: Option<FnGetPowerUsage>,
        get_util: Option<FnGetUtilization>,
    }

    unsafe impl Send for NvmlApi {}
    unsafe impl Sync for NvmlApi {}

    static NVML: OnceLock<Option<NvmlApi>> = OnceLock::new();

    unsafe fn sym<T>(module: *mut c_void, name: &[u8]) -> Option<T> {
        let ptr = unsafe { GetProcAddress(module, name.as_ptr()) }?;
        Some(unsafe { std::mem::transmute_copy(&ptr) })
    }

    fn api() -> Option<&'static NvmlApi> {
        NVML.get_or_init(|| unsafe {
            let candidates = ["nvml.dll", r"C:\Windows\System32\nvml.dll"];
            let mut module = std::ptr::null_mut();
            for name in candidates {
                let wide = crate::native::wide(name);
                module = LoadLibraryW(wide.as_ptr());
                if !module.is_null() {
                    break;
                }
            }
            if module.is_null() {
                return None;
            }
            let init: FnInitV2 = sym(module, b"nvmlInit_v2\0")
                .or_else(|| sym(module, b"nvmlInit\0"))?;
            if init() != 0 {
                return None;
            }
            let get_handle: FnGetHandleByIndexV2 = sym(module, b"nvmlDeviceGetHandleByIndex_v2\0")
                .or_else(|| sym(module, b"nvmlDeviceGetHandleByIndex\0"))?;
            let get_temp: FnGetTemperature = sym(module, b"nvmlDeviceGetTemperature\0")?;
            let get_power: Option<FnGetPowerUsage> = sym(module, b"nvmlDeviceGetPowerUsage\0");
            let get_util: Option<FnGetUtilization> = sym(module, b"nvmlDeviceGetUtilizationRates\0");
            Some(NvmlApi {
                get_handle,
                get_temp,
                get_power,
                get_util,
            })
        })
        .as_ref()
    }

    #[derive(Clone, Copy, Default)]
    pub struct GpuSample {
        pub temp_c: Option<f64>,
        pub power_w: Option<f64>,
        pub load_pct: Option<f64>,
    }

    pub fn sample_gpu0() -> Option<GpuSample> {
        let api = api()?;
        unsafe {
            let mut dev: *mut c_void = std::ptr::null_mut();
            if (api.get_handle)(0, &mut dev) != 0 || dev.is_null() {
                return None;
            }
            let mut temp_raw: c_uint = 0;
            let temp_c = ((api.get_temp)(dev, 0, &mut temp_raw) == 0 && (10..=125).contains(&temp_raw))
                .then_some(f64::from(temp_raw));
            let power_w = api.get_power.and_then(|f| {
                let mut mw: c_uint = 0;
                (f(dev, &mut mw) == 0 && mw <= 1_000_000).then_some(f64::from(mw) / 1000.0)
            });
            let load_pct = api.get_util.and_then(|f| {
                let mut util = NvmlUtilization::default();
                (f(dev, &mut util) == 0 && util.gpu <= 100).then_some(f64::from(util.gpu))
            });
            (temp_c.is_some() || power_w.is_some() || load_pct.is_some()).then_some(GpuSample {
                temp_c,
                power_w,
                load_pct,
            })
        }
    }
}

fn merge_nvml(mut readings: Option<Readings>) -> Option<Readings> {
    if let Some(gpu) = nvml::sample_gpu0() {
        let target = readings.get_or_insert_with(Readings::default);
        if target.gpu_temp.is_none() {
            target.gpu_temp = gpu.temp_c;
        }
        if target.gpu_power.is_none() {
            target.gpu_power = gpu.power_w;
        }
        if target.gpu_load.is_none() {
            target.gpu_load = gpu.load_pct;
        }
    }
    readings
}

/// Fast one-shot sensor reading for CLI `--snapshot` (NVML instant + helper if available).
pub fn instant_readings() -> Option<Readings> {
    let helper = helper_path()
        .and_then(|path| Session::open(&path).and_then(|s| s.read(None)).ok());
    merge_nvml(helper)
}

#[derive(Default)]
struct SensorState {
    latest: Mutex<Option<(Instant, Readings)>>,
    error: Mutex<Option<String>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
    wake_lock: Mutex<()>,
    wake: Condvar,
    paused: AtomicBool,
    stopping: AtomicBool,
}

#[derive(Clone, Default)]
pub struct SensorBridge(Arc<SensorState>);

impl SensorBridge {
    pub fn start(&self) {
        let mut slot = self.0.worker.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_some() {
            return;
        }
        let readings = self.clone();
        *slot = Some(thread::spawn(move || {
            while !readings.0.stopping.load(Ordering::Acquire) {
                if let Some(executable) = helper_path() {
                    if let Err(error) = readings.sample(&executable) {
                        if readings.0.stopping.load(Ordering::Acquire) {
                            break;
                        }
                        eprintln!("CoreWatch sensor bridge: {error}");
                        *readings.0.error.lock().unwrap_or_else(|e| e.into_inner()) = Some(error);
                    }
                    *readings.0.latest.lock().unwrap_or_else(|e| e.into_inner()) = None;
                }
                readings.wait(Duration::from_secs(10));
            }
        }));
    }

    pub fn latest(&self) -> Option<Readings> {
        let from_helper = self
            .0
            .latest
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|(time, _)| time.elapsed() <= Duration::from_secs(16))
            .map(|(_, readings)| readings.clone());
        merge_nvml(from_helper)
    }

    pub fn pause(&self, paused: bool) {
        self.0.paused.store(paused, Ordering::Release);
        self.0.wake.notify_all();
    }

    pub fn stop(&self) {
        self.0.stopping.store(true, Ordering::Release);
        self.0.wake.notify_all();
        let handle = self
            .0
            .worker
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }

    fn wait(&self, duration: Duration) {
        let until = Instant::now() + duration;
        let mut guard = self.0.wake_lock.lock().unwrap_or_else(|e| e.into_inner());
        while !self.0.stopping.load(Ordering::Acquire) {
            let remaining = until.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let (next, _) = self
                .0
                .wake
                .wait_timeout(guard, remaining)
                .unwrap_or_else(|e| e.into_inner());
            guard = next;
        }
    }

    fn sample(&self, executable: &Path) -> Result<(), String> {
        let mut session = Session::open(executable)?;
        while !self.0.stopping.load(Ordering::Acquire) {
            let readings = session.read(Some(&self.0.stopping))?;
            *self.0.latest.lock().unwrap_or_else(|e| e.into_inner()) =
                Some((Instant::now(), readings));
            *self.0.error.lock().unwrap_or_else(|e| e.into_inner()) = None;
            self.wait(Duration::from_secs(5));
            while self.0.paused.load(Ordering::Acquire) && !self.0.stopping.load(Ordering::Acquire)
            {
                self.wait(Duration::from_millis(500));
            }
            if self.0.stopping.load(Ordering::Acquire) {
                break;
            }
            session.request()?;
        }
        Ok(())
    }
}

struct Session {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<Result<String, String>>,
    _job: Option<KillOnCloseJob>,
}

impl Session {
    fn open(executable: &Path) -> Result<Self, String> {
        let mut child = Command::new(executable)
            .current_dir(executable.parent().ok_or("Sensor directory missing.")?)
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())?;
        let job = KillOnCloseJob::attach(&child);
        let input = child.stdin.take().expect("piped sensor input");
        let mut output = BufReader::new(child.stdout.take().expect("piped sensor output"));
        let (send, receive) = mpsc::sync_channel(1);
        thread::spawn(move || {
            loop {
                let mut line = String::new();
                match output.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) if send.send(Ok(line)).is_ok() => continue,
                    Ok(_) => break,
                    Err(error) => {
                        let _ = send.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });
        Ok(Self {
            child,
            input,
            output: receive,
            _job: job,
        })
    }

    fn request(&mut self) -> Result<(), String> {
        self.input
            .write_all(b"\n")
            .and_then(|()| self.input.flush())
            .map_err(|error| error.to_string())
    }

    fn read(&self, stopping: Option<&AtomicBool>) -> Result<Readings, String> {
        let deadline = Instant::now() + Duration::from_secs(15);
        let line = loop {
            if stopping.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                return Err("Sensor helper stopping.".to_owned());
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err("Sensor helper timed out.".to_owned());
            }
            match self
                .output
                .recv_timeout(remaining.min(Duration::from_millis(200)))
            {
                Ok(res) => break res?,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Sensor helper exited.".to_owned());
                }
            }
        };
        let reading: Readings = serde_json::from_str(&line).map_err(|error| error.to_string())?;
        if let Some(error) = reading.error {
            return Err(error);
        }
        Ok(reading)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.input.write_all(b"EXIT\n");
        let _ = self.input.flush();
        for _ in 0..5 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(40));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Serialize)]
pub struct SensorStatus {
    pub helper_available: bool,
    pub elevated: bool,
    pub pawn_io: &'static str,
    pub reading: Option<Readings>,
    pub error: Option<String>,
}

pub fn status(bridge: Option<&SensorBridge>) -> SensorStatus {
    let helper = helper_path();
    let (reading, error) = match (bridge, &helper) {
        (Some(bridge), _) => (
            bridge.latest(),
            bridge
                .0
                .error
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
        ),
        (None, Some(path)) => match Session::open(path).and_then(|session| session.read(None)) {
            Ok(reading) => (merge_nvml(Some(reading)), None),
            Err(error) => (merge_nvml(None), Some(error)),
        },
        _ => (merge_nvml(None), None),
    };
    SensorStatus {
        helper_available: helper.is_some(),
        elevated: crate::native::elevated(),
        pawn_io: pawn_io_status(),
        reading,
        error,
    }
}

fn pawn_io_status() -> &'static str {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{ERROR_SERVICE_DOES_NOT_EXIST, GetLastError},
        System::Services::{
            CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus,
            SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_STATUS,
            SERVICE_STOPPED,
        },
    };
    let name = crate::native::wide("PawnIO");
    unsafe {
        let manager = OpenSCManagerW(ptr::null(), ptr::null(), SC_MANAGER_CONNECT);
        if manager.is_null() {
            return "Unknown";
        }
        let service = OpenServiceW(manager, name.as_ptr(), SERVICE_QUERY_STATUS);
        let missing = service.is_null() && GetLastError() == ERROR_SERVICE_DOES_NOT_EXIST;
        CloseServiceHandle(manager);
        if service.is_null() {
            return if missing { "Not installed" } else { "Unknown" };
        }
        let mut status = SERVICE_STATUS::default();
        let success = QueryServiceStatus(service, &mut status) != 0;
        CloseServiceHandle(service);
        match (success, status.dwCurrentState) {
            (true, SERVICE_RUNNING) => "Running",
            (true, SERVICE_STOPPED) => "Stopped",
            (true, _) => "Transitioning",
            _ => "Unknown",
        }
    }
}

fn helper_path() -> Option<PathBuf> {
    let filename = "CoreWatchSensorHelper.exe";
    let present = |path: &Path| {
        path.is_file() && path.with_file_name("LibreHardwareMonitorLib.dll").is_file()
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(executable) = std::env::current_exe()
        && let Some(root) = executable.parent()
    {
        candidates.push(root.join("sensors").join(filename));
        candidates.push(root.join(filename));
        candidates.push(root.join("bin").join("sensors").join(filename));
        if let Some(parent) = root.parent() {
            candidates.push(parent.join("bin").join("sensors").join(filename));
            if let Some(grand) = parent.parent() {
                candidates.push(grand.join("bin").join("sensors").join(filename));
                candidates.push(grand.join("legacy-powershell").join("bin").join(filename));
            }
        }
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("bin").join("sensors").join(filename));
    candidates.push(manifest.join("legacy-powershell").join("bin").join(filename));

    candidates.into_iter().find(|path| present(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_discovery_finds_staged_sensor_helper() {
        let found = helper_path();
        assert!(
            found.is_some(),
            "Expected CoreWatchSensorHelper.exe + LibreHardwareMonitorLib.dll in bin/sensors or legacy-powershell/bin"
        );
    }
}
