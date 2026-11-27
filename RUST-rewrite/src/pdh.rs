use std::ptr::{null, null_mut};
use windows_sys::Win32::System::Performance::{
    PDH_CSTATUS_NEW_DATA, PDH_CSTATUS_VALID_DATA, PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE,
    PDH_HCOUNTER, PDH_HQUERY, PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
    PdhGetFormattedCounterValue, PdhOpenQueryW,
};

pub struct Query(PDH_HQUERY);
pub struct Counter(PDH_HCOUNTER);

impl Query {
    pub fn open() -> Option<Self> {
        let mut query = null_mut();
        (unsafe { PdhOpenQueryW(null(), 0, &mut query) } == 0).then_some(Self(query))
    }

    pub fn add(&self, path: &str) -> Option<Counter> {
        let mut counter = null_mut();
        let path = crate::native::wide(path);
        (unsafe { PdhAddEnglishCounterW(self.0, path.as_ptr(), 0, &mut counter) } == 0)
            .then_some(Counter(counter))
    }

    pub fn collect(&self) -> bool {
        unsafe { PdhCollectQueryData(self.0) == 0 }
    }
}

impl Drop for Query {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { PdhCloseQuery(self.0) };
        }
    }
}

impl Counter {
    pub fn value(&self) -> Option<f64> {
        const PDH_FMT_NOCAP100: u32 = 0x0000_8000;
        let mut sample = PDH_FMT_COUNTERVALUE::default();
        let result = unsafe {
            PdhGetFormattedCounterValue(
                self.0,
                PDH_FMT_DOUBLE | PDH_FMT_NOCAP100,
                null_mut(),
                &mut sample,
            )
        };
        if result != 0
            || !matches!(
                sample.CStatus,
                PDH_CSTATUS_VALID_DATA | PDH_CSTATUS_NEW_DATA
            )
        {
            return None;
        }
        let value = unsafe { sample.Anonymous.doubleValue };
        value.is_finite().then_some(value)
    }
}
