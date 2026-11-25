use crate::native::wide;
use serde::Serialize;
use std::{
    ffi::c_void,
    net::{Ipv4Addr, ToSocketAddrs},
    ptr,
    time::Instant,
};
use windows_sys::Win32::{Foundation::GetLastError, Networking::WinHttp::*};

const HOST: &str = "speed.cloudflare.com";
const DOWNLOAD_BYTES: u32 = 4 * 1024 * 1024;
const UPLOAD_BYTES: usize = 1024 * 1024;

#[derive(Serialize, Default)]
pub struct Results {
    pub dns_ok: bool,
    pub public_ipv4: Option<Ipv4Addr>,
    pub latency_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub packet_loss: Option<f64>,
    pub download_mbps: Option<f64>,
    pub upload_mbps: Option<f64>,
    pub errors: Vec<String>,
}

pub fn run() -> Results {
    let mut result = Results {
        dns_ok: (HOST, 443)
            .to_socket_addrs()
            .is_ok_and(|mut addresses| addresses.next().is_some()),
        ..Results::default()
    };
    match crate::network::ping(Ipv4Addr::new(1, 1, 1, 1), 6) {
        Ok(replies) => {
            let timings: Vec<_> = replies
                .iter()
                .filter(|reply| reply.status == 0)
                .filter_map(|reply| reply.ms.map(f64::from))
                .collect();
            result.packet_loss = Some(100.0 * (1.0 - timings.len() as f64 / replies.len() as f64));
            if !timings.is_empty() {
                result.latency_ms = Some(timings.iter().sum::<f64>() / timings.len() as f64);
            }
            if timings.len() > 1 {
                let jitter = timings
                    .windows(2)
                    .map(|pair| (pair[1] - pair[0]).abs())
                    .sum::<f64>();
                result.jitter_ms = Some(jitter / (timings.len() - 1) as f64);
            }
        }
        Err(error) => result.errors.push(format!("ICMP latency: {error}")),
    }
    let connection = match Connection::new() {
        Ok(connection) => connection,
        Err(error) => {
            result.errors.push(error);
            return result;
        }
    };
    match public_address(&connection) {
        Ok(address) => result.public_ipv4 = address,
        Err(error) => result.errors.push(format!("Public IP lookup: {error}")),
    }

    match connection.request(
        "GET",
        &format!("/__down?bytes={DOWNLOAD_BYTES}"),
        &[],
        DOWNLOAD_BYTES,
        false,
    ) {
        Ok(response) if response.bytes == DOWNLOAD_BYTES => {
            result.download_mbps = mbps(response.bytes, response.seconds)
        }
        Ok(_) => result
            .errors
            .push("HTTPS download returned an incomplete response.".to_owned()),
        Err(error) => result.errors.push(format!("HTTPS download: {error}")),
    }
    match connection.request("POST", "/__up", &vec![0; UPLOAD_BYTES], 4096, false) {
        Ok(response) => result.upload_mbps = mbps(UPLOAD_BYTES as u32, response.seconds),
        Err(error) => result.errors.push(format!("HTTPS upload: {error}")),
    }
    result
}

pub fn external_ipv4() -> Result<Option<Ipv4Addr>, String> {
    public_address(&Connection::new()?)
}

fn public_address(connection: &Connection) -> Result<Option<Ipv4Addr>, String> {
    let trace = connection.request("GET", "/cdn-cgi/trace", &[], 4096, true)?;
    Ok(String::from_utf8_lossy(&trace.body)
        .lines()
        .find_map(|line| line.strip_prefix("ip="))
        .and_then(|address| address.parse().ok()))
}

fn mbps(bytes: u32, seconds: f64) -> Option<f64> {
    (seconds > 0.0).then(|| f64::from(bytes) * 8.0 / (1e6 * seconds))
}

struct Connection {
    handle: Handle,
    _session: Handle,
}

struct Response {
    body: Vec<u8>,
    bytes: u32,
    seconds: f64,
}

struct Handle(*mut c_void);

impl Handle {
    fn new(value: *mut c_void) -> Result<Self, String> {
        if value.is_null() {
            Err(error_code())
        } else {
            Ok(Self(value))
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { WinHttpCloseHandle(self.0) };
    }
}

impl Connection {
    fn new() -> Result<Self, String> {
        unsafe {
            let agent = wide("CoreWatch Rust");
            let session = Handle::new(WinHttpOpen(
                agent.as_ptr(),
                WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                ptr::null(),
                ptr::null(),
                0,
            ))?;
            if WinHttpSetTimeouts(session.0, 3000, 4000, 5000, 5000) == 0 {
                return Err(error_code());
            }
            let host = wide(HOST);
            let handle = Handle::new(WinHttpConnect(session.0, host.as_ptr(), 443, 0))?;
            Ok(Self {
                handle,
                _session: session,
            })
        }
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        data: &[u8],
        limit: u32,
        collect: bool,
    ) -> Result<Response, String> {
        let method = wide(method);
        let path = wide(path);
        let length = data.len() as u32;
        let payload = if length == 0 {
            ptr::null()
        } else {
            data.as_ptr().cast()
        };
        let headers = wide("Cache-Control: no-cache\r\n");
        let mut response = Response {
            body: Vec::new(),
            bytes: 0,
            seconds: 0.0,
        };
        unsafe {
            let request = Handle::new(WinHttpOpenRequest(
                self.handle.0,
                method.as_ptr(),
                path.as_ptr(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                WINHTTP_FLAG_SECURE,
            ))?;
            let disable_redirects = WINHTTP_DISABLE_REDIRECTS;
            if WinHttpSetOption(
                request.0,
                WINHTTP_OPTION_DISABLE_FEATURE,
                (&disable_redirects as *const u32).cast(),
                4,
            ) == 0
            {
                return Err(error_code());
            }
            let start = Instant::now();
            if WinHttpSendRequest(
                request.0,
                headers.as_ptr(),
                u32::MAX,
                payload,
                length,
                length,
                0,
            ) == 0
                || WinHttpReceiveResponse(request.0, ptr::null_mut()) == 0
            {
                return Err(error_code());
            }
            let (mut status, mut size) = (0u32, 4);
            if WinHttpQueryHeaders(
                request.0,
                WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                ptr::null(),
                (&mut status as *mut u32).cast(),
                &mut size,
                ptr::null_mut(),
            ) == 0
            {
                return Err(error_code());
            }
            if !(200..300).contains(&status) {
                return Err(format!("HTTP {status}"));
            }
            let mut scratch = [0u8; 32 * 1024];
            while response.bytes < limit {
                if start.elapsed().as_secs() >= 15 {
                    return Err("HTTPS request timed out".to_owned());
                }
                let mut read = 0;
                let batch = (limit - response.bytes).min(scratch.len() as u32);
                if WinHttpReadData(request.0, scratch.as_mut_ptr().cast(), batch, &mut read) == 0 {
                    return Err(error_code());
                }
                if read == 0 {
                    break;
                }
                response.bytes += read;
                if collect {
                    response.body.extend_from_slice(&scratch[..read as usize]);
                }
            }
            response.seconds = start.elapsed().as_secs_f64();
        }
        Ok(response)
    }
}

fn error_code() -> String {
    format!("WinHTTP error {}", unsafe { GetLastError() })
}
