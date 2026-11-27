use crate::native::wide;
use serde::Serialize;
use std::{
    ffi::c_void,
    fs,
    io::Write,
    path::Path,
    ptr,
    time::Instant,
};
use windows_sys::Win32::{
    Foundation::{GetLastError, LocalFree},
    Networking::WinHttp::*,
};

const DPAPI_PREFIX: &str = "dpapi:";
const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x01;

#[repr(C)]
struct CryptoapiBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[link(name = "crypt32")]
unsafe extern "system" {
    fn CryptProtectData(
        data_in: *const CryptoapiBlob,
        data_descr: *const u16,
        optional_entropy: *const CryptoapiBlob,
        reserved: *mut c_void,
        prompt_struct: *const c_void,
        flags: u32,
        data_out: *mut CryptoapiBlob,
    ) -> i32;
    fn CryptUnprotectData(
        data_in: *const CryptoapiBlob,
        data_descr: *mut *mut u16,
        optional_entropy: *const CryptoapiBlob,
        reserved: *mut c_void,
        prompt_struct: *const c_void,
        flags: u32,
        data_out: *mut CryptoapiBlob,
    ) -> i32;
}

/// Encrypts a secret string for the current Windows user via DPAPI (`CryptProtectData`).
pub fn protect_secret(plaintext: &str) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    if plaintext.starts_with(DPAPI_PREFIX) {
        return Ok(plaintext.to_owned());
    }
    let bytes = plaintext.as_bytes();
    let input = CryptoapiBlob {
        cb_data: bytes.len() as u32,
        pb_data: bytes.as_ptr().cast_mut(),
    };
    let mut output = CryptoapiBlob {
        cb_data: 0,
        pb_data: ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pb_data.is_null() {
        return Err(format!(
            "Windows DPAPI encryption failed (OS error {}).",
            unsafe { GetLastError() }
        ));
    }
    let protected = unsafe {
        let slice = std::slice::from_raw_parts(output.pb_data, output.cb_data as usize);
        let encoded = format!("{DPAPI_PREFIX}{}", base64_encode(slice));
        LocalFree(output.pb_data.cast());
        encoded
    };
    Ok(protected)
}

/// Decrypts a DPAPI-protected string. Legacy plaintext values without the `dpapi:` prefix
/// are returned unchanged so existing configs migrate seamlessly on next save.
pub fn unprotect_secret(stored: &str) -> Result<String, String> {
    if stored.is_empty() {
        return Ok(String::new());
    }
    let Some(b64) = stored.strip_prefix(DPAPI_PREFIX) else {
        return Ok(stored.to_owned());
    };
    let raw = base64_decode(b64).ok_or("Stored DPAPI secret is corrupted (invalid base64).")?;
    if raw.is_empty() {
        return Ok(String::new());
    }
    let input = CryptoapiBlob {
        cb_data: raw.len() as u32,
        pb_data: raw.as_ptr().cast_mut(),
    };
    let mut output = CryptoapiBlob {
        cb_data: 0,
        pb_data: ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 || output.pb_data.is_null() {
        return Err(format!(
            "Windows DPAPI decryption failed (OS error {}).",
            unsafe { GetLastError() }
        ));
    }
    let plaintext = unsafe {
        let slice = std::slice::from_raw_parts(output.pb_data, output.cb_data as usize);
        let text = String::from_utf8(slice.to_vec())
            .map_err(|_| "Decrypted secret was not valid UTF-8.".to_owned());
        LocalFree(output.pb_data.cast());
        text
    }?;
    Ok(plaintext)
}

pub fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub fn base64_decode(input: &str) -> Option<Vec<u8>> {
    fn val(b: u8) -> Option<u32> {
        match b {
            b'A'..=b'Z' => Some((b - b'A') as u32),
            b'a'..=b'z' => Some((b - b'a' + 26) as u32),
            b'0'..=b'9' => Some((b - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let clean: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if !clean.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity((clean.len() / 4) * 3);
    for chunk in clean.as_chunks::<4>().0 {
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        let pad_c = chunk[2] == b'=';
        let pad_d = chunk[3] == b'=';
        let c = if pad_c { 0 } else { val(chunk[2])? };
        let d = if pad_d { 0 } else { val(chunk[3])? };
        let triple = (a << 18) | (b << 12) | (c << 6) | d;
        out.push(((triple >> 16) & 0xFF) as u8);
        if !pad_c {
            out.push(((triple >> 8) & 0xFF) as u8);
        }
        if !pad_d {
            out.push((triple & 0xFF) as u8);
        }
    }
    Some(out)
}

/// Crash-safe atomic JSON write helper using a temp file in the destination directory.
pub fn write_json_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) {
    let Some(parent) = path.parent() else {
        return;
    };
    let _ = fs::create_dir_all(parent);
    let Ok(bytes) = serde_json::to_vec_pretty(value) else {
        return;
    };
    if let Ok(mut tmp) = tempfile::NamedTempFile::new_in(parent)
        && tmp.write_all(&bytes).is_ok()
        && tmp.persist(path).is_ok()
    {
        return;
    }
    let _ = fs::write(path, bytes);
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u32,
    pub body: Vec<u8>,
    pub elapsed_ms: u64,
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedUrl<'a> {
    secure: bool,
    host: &'a str,
    port: u16,
    path: &'a str,
}

fn parse_url(url: &str) -> Result<ParsedUrl<'_>, String> {
    let (secure, rest) = if let Some(r) = url.strip_prefix("https://") {
        (true, r)
    } else if let Some(r) = url.strip_prefix("http://") {
        (false, r)
    } else {
        return Err("URL must begin with http:// or https://".into());
    };
    let (authority, path) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    if authority.is_empty() {
        return Err("URL host is empty.".into());
    }
    let default_port = if secure { 443 } else { 80 };
    let (host, port) = if let Some(bracket_end) = authority.strip_prefix('[').and_then(|s| s.find(']')) {
        let h = &authority[1..1 + bracket_end];
        let after = &authority[2 + bracket_end..];
        let p = if let Some(p_str) = after.strip_prefix(':') {
            p_str.parse::<u16>().map_err(|_| "Invalid port in URL.")?
        } else {
            default_port
        };
        (h, p)
    } else if let Some((h, p_str)) = authority.rsplit_once(':') {
        let p = p_str.parse::<u16>().map_err(|_| "Invalid port in URL.")?;
        (h, p)
    } else {
        (authority, default_port)
    };
    Ok(ParsedUrl {
        secure,
        host,
        port,
        path,
    })
}

struct WinHttpHandle(*mut c_void);
impl WinHttpHandle {
    fn new(ptr: *mut c_void) -> Result<Self, String> {
        if ptr.is_null() {
            Err(format!("WinHTTP error {}", unsafe { GetLastError() }))
        } else {
            Ok(Self(ptr))
        }
    }
}
impl Drop for WinHttpHandle {
    fn drop(&mut self) {
        unsafe {
            WinHttpCloseHandle(self.0);
        }
    }
}

/// Native WinHTTP request (zero subprocesses, secrets never appear on process argv).
pub fn http_request(
    method: &str,
    url: &str,
    headers: &[(&str, &str)],
    body: Option<&[u8]>,
    timeout_ms: i32,
    allow_insecure_tls: bool,
    max_bytes: usize,
) -> Result<HttpResponse, String> {
    let parsed = parse_url(url)?;
    let agent = wide("RustCoreWatch/1.0");
    let host_w = wide(parsed.host);
    let method_w = wide(method);
    let path_w = wide(parsed.path);
    let mut header_str = String::new();
    for (k, v) in headers {
        header_str.push_str(k);
        header_str.push_str(": ");
        header_str.push_str(v);
        header_str.push_str("\r\n");
    }
    let headers_w = (!header_str.is_empty()).then(|| wide(&header_str));

    unsafe {
        let session = WinHttpHandle::new(WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            ptr::null(),
            ptr::null(),
            0,
        ))?;
        let _ = WinHttpSetTimeouts(session.0, timeout_ms, timeout_ms, timeout_ms, timeout_ms);
        let conn = WinHttpHandle::new(WinHttpConnect(
            session.0,
            host_w.as_ptr(),
            parsed.port,
            0,
        ))?;
        let flags = if parsed.secure { WINHTTP_FLAG_SECURE } else { 0 };
        let req = WinHttpHandle::new(WinHttpOpenRequest(
            conn.0,
            method_w.as_ptr(),
            path_w.as_ptr(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            flags,
        ))?;
        if parsed.secure && allow_insecure_tls {
            let sec_flags: u32 = SECURITY_FLAG_IGNORE_UNKNOWN_CA
                | SECURITY_FLAG_IGNORE_CERT_DATE_INVALID
                | SECURITY_FLAG_IGNORE_CERT_CN_INVALID
                | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
            let _ = WinHttpSetOption(
                req.0,
                WINHTTP_OPTION_SECURITY_FLAGS,
                (&sec_flags as *const u32).cast(),
                4,
            );
        }
        let payload_bytes = body.unwrap_or(&[]);
        let payload_ptr = if payload_bytes.is_empty() {
            ptr::null()
        } else {
            payload_bytes.as_ptr().cast()
        };
        let hdr_ptr = headers_w
            .as_ref()
            .map_or(ptr::null(), |h| h.as_ptr());
        let hdr_len = if headers_w.is_some() { u32::MAX } else { 0 };
        let start = Instant::now();
        if WinHttpSendRequest(
            req.0,
            hdr_ptr,
            hdr_len,
            payload_ptr,
            payload_bytes.len() as u32,
            payload_bytes.len() as u32,
            0,
        ) == 0
            || WinHttpReceiveResponse(req.0, ptr::null_mut()) == 0
        {
            return Err(format!("WinHTTP request failed (OS error {})", GetLastError()));
        }
        let (mut status, mut sz) = (0u32, 4u32);
        if WinHttpQueryHeaders(
            req.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            ptr::null(),
            (&mut status as *mut u32).cast(),
            &mut sz,
            ptr::null_mut(),
        ) == 0
        {
            return Err(format!("WinHTTP status query failed (OS error {})", GetLastError()));
        }
        let mut out = Vec::new();
        let mut scratch = [0u8; 16 * 1024];
        while out.len() < max_bytes {
            let mut read = 0u32;
            let want = (max_bytes - out.len()).min(scratch.len()) as u32;
            if WinHttpReadData(req.0, scratch.as_mut_ptr().cast(), want, &mut read) == 0 {
                return Err(format!("WinHTTP read failed (OS error {})", GetLastError()));
            }
            if read == 0 {
                break;
            }
            out.extend_from_slice(&scratch[..read as usize]);
        }
        Ok(HttpResponse {
            status,
            body: out,
            elapsed_ms: start.elapsed().as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_roundtrip_and_plaintext_migration() {
        let secret = "ATATT3xFfGF0-test-token-12345";
        let encrypted = protect_secret(secret).unwrap();
        assert!(encrypted.starts_with(DPAPI_PREFIX));
        assert_ne!(encrypted, secret);
        assert_eq!(unprotect_secret(&encrypted).unwrap(), secret);
        // Legacy plaintext passes through safely
        assert_eq!(unprotect_secret("legacy-plain").unwrap(), "legacy-plain");
    }

    #[test]
    fn base64_and_url_parser_roundtrip() {
        let encoded = base64_encode(b"user@example.com:secret_pat");
        assert_eq!(
            String::from_utf8(base64_decode(&encoded).unwrap()).unwrap(),
            "user@example.com:secret_pat"
        );
        let parsed = parse_url("https://team.atlassian.net:8443/rest/api/3/search/jql").unwrap();
        assert!(parsed.secure);
        assert_eq!(parsed.host, "team.atlassian.net");
        assert_eq!(parsed.port, 8443);
        assert_eq!(parsed.path, "/rest/api/3/search/jql");
    }
}
