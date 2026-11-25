use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Readings {
    pub cpu_temp: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub gpu_power: Option<f64>,
    pub sensor: Option<String>,
    error: Option<String>,
}

#[derive(Default)]
struct SensorState {
    latest: Mutex<Option<(Instant, Readings)>>,
    error: Mutex<Option<String>>,
    paused: AtomicBool,
    stopping: AtomicBool,
}

#[derive(Clone, Default)]
pub struct SensorBridge(Arc<SensorState>);

impl SensorBridge {
    pub fn start(&self) {
        let Some(executable) = helper_path() else {
            return;
        };
        let readings = self.clone();
        thread::spawn(move || {
            while !readings.0.stopping.load(Ordering::Relaxed) {
                if let Err(error) = readings.sample(&executable) {
                    eprintln!("CoreWatch sensor bridge: {error}");
                    *readings.0.error.lock().unwrap() = Some(error);
                }
                *readings.0.latest.lock().unwrap() = None;
                readings.wait(Duration::from_secs(30));
            }
        });
    }

    pub fn latest(&self) -> Option<Readings> {
        self.0
            .latest
            .lock()
            .unwrap()
            .as_ref()
            .filter(|(time, _)| time.elapsed() <= Duration::from_secs(14))
            .map(|(_, readings)| readings.clone())
    }

    pub fn pause(&self, paused: bool) {
        self.0.paused.store(paused, Ordering::Relaxed);
    }

    pub fn stop(&self) {
        self.0.stopping.store(true, Ordering::Relaxed);
    }

    fn wait(&self, duration: Duration) {
        let until = Instant::now() + duration;
        while !self.0.stopping.load(Ordering::Relaxed) && Instant::now() < until {
            thread::sleep(
                until
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_millis(150)),
            );
        }
    }

    fn sample(&self, executable: &Path) -> Result<(), String> {
        let mut session = Session::open(executable)?;
        while !self.0.stopping.load(Ordering::Relaxed) {
            let readings = session.read()?;
            *self.0.latest.lock().unwrap() = Some((Instant::now(), readings));
            *self.0.error.lock().unwrap() = None;
            self.wait(Duration::from_secs(5));
            while self.0.paused.load(Ordering::Relaxed) && !self.0.stopping.load(Ordering::Relaxed)
            {
                self.wait(Duration::from_millis(500));
            }
            if self.0.stopping.load(Ordering::Relaxed) {
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
        })
    }

    fn request(&mut self) -> Result<(), String> {
        self.input
            .write_all(b"\n")
            .and_then(|()| self.input.flush())
            .map_err(|error| error.to_string())
    }

    fn read(&self) -> Result<Readings, String> {
        let line =
            self.output
                .recv_timeout(Duration::from_secs(8))
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => "Sensor helper timed out.".to_owned(),
                    mpsc::RecvTimeoutError::Disconnected => "Sensor helper exited.".to_owned(),
                })??;
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
        for _ in 0..5 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
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
        (Some(bridge), _) => (bridge.latest(), bridge.0.error.lock().unwrap().clone()),
        (None, Some(path)) => match Session::open(path).and_then(|session| session.read()) {
            Ok(reading) => (Some(reading), None),
            Err(error) => (None, Some(error)),
        },
        _ => (None, None),
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
    let executable = std::env::current_exe().ok()?;
    let root = executable.parent()?;
    let filename = "CoreWatchSensorHelper.exe";
    let installed = root.join("sensors").join(filename);
    let present = |path: &Path| {
        path.is_file() && path.with_file_name("LibreHardwareMonitorLib.dll").is_file()
    };
    if present(&installed) {
        return Some(installed);
    }
    if cfg!(debug_assertions) {
        let development = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("bin")
            .join("sensors")
            .join(filename);
        if present(&development) {
            return Some(development);
        }
    }
    None
}
