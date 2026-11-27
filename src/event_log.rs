use crate::native::wide;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, mem::size_of, ptr, slice};
use windows_sys::Win32::{
    Foundation::{
        ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_DATA, ERROR_NO_MORE_ITEMS, FILETIME, GetLastError,
        SYSTEMTIME,
    },
    System::{EventLog::*, Time::FileTimeToSystemTime},
};

const MAX_RENDER_BYTES: usize = 256 * 1024;
const UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;
pub const CRASH_QUERY: &str = "*[System[(Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=41) or ((Provider[@Name='Microsoft-Windows-WER-SystemErrorReporting'] or Provider[@Name='BugCheck']) and EventID=1001)]]";

#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct Key {
    pub channel: String,
    pub record: u64,
    pub time_ms: u64,
}

#[derive(Clone, Serialize)]
pub struct Record {
    pub key: Key,
    pub provider: String,
    pub event_id: u16,
    pub level: u8,
    pub message: Option<String>,
}

impl Record {
    pub fn crash_tag(&self) -> Option<&'static str> {
        match (
            self.key.channel.as_str(),
            self.provider.as_str(),
            self.event_id,
        ) {
            ("System", "Microsoft-Windows-Kernel-Power", 41) => Some("KP-41"),
            ("System", "Microsoft-Windows-WER-SystemErrorReporting" | "BugCheck", 1001) => {
                Some("BSOD 1001")
            }
            _ => None,
        }
    }

    pub fn utc(&self) -> String {
        utc(self.key.time_ms)
    }
}

pub fn utc(ms: u64) -> String {
    let ticks = ms.saturating_mul(10_000).saturating_add(UNIX_EPOCH_TICKS);
    let filetime = FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    };
    let mut time = SYSTEMTIME::default();
    if unsafe { FileTimeToSystemTime(&filetime, &mut time) } == 0 {
        return "Date unavailable".into();
    }
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02} UTC",
        time.wYear, time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond
    )
}

struct Handle(EVT_HANDLE);

impl Handle {
    fn checked(value: EVT_HANDLE) -> Result<Self, u32> {
        if value == 0 {
            Err(unsafe { GetLastError() })
        } else {
            Ok(Self(value))
        }
    }
}

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { EvtClose(self.0) };
    }
}

pub struct Query {
    handle: Handle,
    channel: String,
}

impl Query {
    pub fn open(channel: &str, filter: &str) -> Result<Self, u32> {
        let name = wide(channel);
        let filter = wide(filter);
        let handle = Handle::checked(unsafe {
            EvtQuery(
                0,
                name.as_ptr(),
                filter.as_ptr(),
                EvtQueryChannelPath | EvtQueryReverseDirection,
            )
        })?;
        Ok(Self {
            handle,
            channel: channel.into(),
        })
    }

    pub fn next(&mut self, reader: &mut Reader) -> Result<Option<Record>, u32> {
        let (mut event, mut returned) = (0, 0);
        if unsafe { EvtNext(self.handle.0, 1, &mut event, 1000, 0, &mut returned) } == 0 {
            return match unsafe { GetLastError() } {
                ERROR_NO_MORE_ITEMS => Ok(None),
                error => Err(error),
            };
        }
        let event = Handle::checked(event)?;
        let mut record = reader.metadata(&event, &self.channel)?;
        record.message = reader.message(&event, &record.provider);
        Ok(Some(record))
    }
}

pub struct Reader {
    system: Handle,
    publishers: HashMap<String, Option<Handle>>,
}

impl Reader {
    pub fn open() -> Result<Self, u32> {
        let system = Handle::checked(unsafe {
            EvtCreateRenderContext(0, ptr::null(), EvtRenderContextSystem)
        })?;
        Ok(Self {
            system,
            publishers: HashMap::new(),
        })
    }

    fn metadata(&self, event: &Handle, channel: &str) -> Result<Record, u32> {
        let (mut bytes, mut count) = (0, 0);
        unsafe {
            EvtRender(
                self.system.0,
                event.0,
                EvtRenderEventValues,
                0,
                ptr::null_mut(),
                &mut bytes,
                &mut count,
            )
        };
        let status = unsafe { GetLastError() };
        if status != ERROR_INSUFFICIENT_BUFFER {
            return Err(status);
        }
        if bytes as usize > MAX_RENDER_BYTES {
            return Err(ERROR_INVALID_DATA);
        }
        // The Windows buffer holds aligned EVT_VARIANT values followed by their pointed-to strings.
        let mut storage =
            vec![EVT_VARIANT::default(); (bytes as usize).div_ceil(size_of::<EVT_VARIANT>())];
        if unsafe {
            EvtRender(
                self.system.0,
                event.0,
                EvtRenderEventValues,
                bytes,
                storage.as_mut_ptr().cast(),
                &mut bytes,
                &mut count,
            )
        } == 0
        {
            return Err(unsafe { GetLastError() });
        }
        let values = storage.get(..count as usize).ok_or(ERROR_INVALID_DATA)?;
        let get = |index: EVT_SYSTEM_PROPERTY_ID, kind: EVT_VARIANT_TYPE| {
            values
                .get(index as usize)
                .filter(|value| value.Type == kind as u32)
                .ok_or(ERROR_INVALID_DATA)
        };
        let provider = unsafe {
            get(EvtSystemProviderName, EvtVarTypeString)?
                .Anonymous
                .StringVal
        };
        let provider = read_string(provider, &storage, bytes as usize).ok_or(ERROR_INVALID_DATA)?;
        let record = unsafe {
            get(EvtSystemEventRecordId, EvtVarTypeUInt64)?
                .Anonymous
                .UInt64Val
        };
        let ticks = unsafe {
            get(EvtSystemTimeCreated, EvtVarTypeFileTime)?
                .Anonymous
                .FileTimeVal
        };
        let event_id = unsafe { get(EvtSystemEventID, EvtVarTypeUInt16)?.Anonymous.UInt16Val };
        let level = get(EvtSystemLevel, EvtVarTypeByte)
            .ok()
            .map_or(0, |value| unsafe { value.Anonymous.ByteVal });
        let time_ms = ticks
            .checked_sub(UNIX_EPOCH_TICKS)
            .ok_or(ERROR_INVALID_DATA)?
            / 10_000;
        Ok(Record {
            key: Key {
                channel: channel.into(),
                record,
                time_ms,
            },
            provider,
            event_id,
            level,
            message: None,
        })
    }

    fn message(&mut self, event: &Handle, provider: &str) -> Option<String> {
        let metadata = self
            .publishers
            .entry(provider.to_owned())
            .or_insert_with(|| {
                Handle::checked(unsafe {
                    EvtOpenPublisherMetadata(0, wide(provider).as_ptr(), ptr::null(), 0, 0)
                })
                .ok()
            });
        let metadata = metadata.as_ref()?.0;
        let mut length = 0;
        unsafe {
            EvtFormatMessage(
                metadata,
                event.0,
                0,
                0,
                ptr::null(),
                EvtFormatMessageEvent,
                0,
                ptr::null_mut(),
                &mut length,
            )
        };
        if !(1..=32768).contains(&length) {
            return None;
        }
        let mut buffer = vec![0u16; length as usize];
        let result = unsafe {
            EvtFormatMessage(
                metadata,
                event.0,
                0,
                0,
                ptr::null(),
                EvtFormatMessageEvent,
                length,
                buffer.as_mut_ptr(),
                &mut length,
            )
        };
        if result == 0 {
            return None;
        }
        let end = buffer
            .iter()
            .position(|&ch| ch == 0)
            .unwrap_or(buffer.len());
        let text = String::from_utf16_lossy(&buffer[..end]);
        let mut snippet: String = text.trim().chars().take(4096).collect();
        if text.trim().chars().count() > 4096 {
            snippet.push('…');
        }
        (!snippet.is_empty()).then_some(snippet)
    }
}

fn read_string(pointer: *const u16, storage: &[EVT_VARIANT], bytes: usize) -> Option<String> {
    let bytes = bytes.min(size_of_val(storage));
    let offset = (pointer as usize).checked_sub(storage.as_ptr() as usize)?;
    if offset >= bytes || !offset.is_multiple_of(size_of::<u16>()) {
        return None;
    }
    // Bound the provider string to the buffer supplied to EvtRender, including its terminator.
    let text = unsafe {
        slice::from_raw_parts(
            storage.as_ptr().cast::<u8>().add(offset).cast::<u16>(),
            (bytes - offset) / 2,
        )
    };
    let end = text.iter().position(|&ch| ch == 0)?;
    String::from_utf16(&text[..end]).ok()
}

pub fn latest_crash() -> Result<Option<Record>, u32> {
    Query::open("System", CRASH_QUERY)?.next(&mut Reader::open()?)
}

pub fn by_key(key: &Key) -> Result<Option<Record>, u32> {
    let filter = format!("*[System[EventRecordID={}]]", key.record);
    let result = Query::open(&key.channel, &filter)?.next(&mut Reader::open()?)?;
    Ok(result.filter(|record| record.key == *key))
}
