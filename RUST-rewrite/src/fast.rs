use crate::native;
use serde::Serialize;
use std::{collections::HashMap, time::Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
#[derive(Serialize, Default, Clone)]
pub struct FastSample {
    pub cpu_percent: Option<f32>,
    pub cpu_name: String,
    pub cpu_mhz: Option<u64>,
    pub cpu_mhz_live: bool,
    pub ram: Option<Usage>,
    pub commit: Option<Usage>,
    pub uptime_seconds: u64,
    pub top_process: Option<TopProcess>,
    pub traffic: Option<Traffic>,
}

#[derive(Serialize, Clone)]
pub struct Usage {
    pub used: u64,
    pub total: u64,
}

#[derive(Serialize, Clone)]
pub struct TopProcess {
    #[serde(flatten)]
    process: ResourceConsumer,
    cpu_spike: bool,
    top_cpu: Option<ResourceConsumer>,
    top_ram: ResourceConsumer,
    token: Option<String>,
}

#[derive(Serialize, Clone)]
struct ResourceConsumer {
    name: String,
    pid: u32,
    cpu_percent: f32,
    memory: u64,
}

impl ResourceConsumer {
    fn from_process(process: &sysinfo::Process, cores: f32) -> Self {
        Self {
            name: process.name().to_string_lossy().into_owned(),
            pid: process.pid().as_u32(),
            cpu_percent: (process.cpu_usage() / cores).clamp(0.0, 100.0),
            memory: process.memory(),
        }
    }
}

fn top_process(system: &System, cores: f32) -> Option<TopProcess> {
    let eligible = system.processes().values().filter(|process| {
        if process.pid().as_u32() <= 4 {
            return false;
        }
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        !matches!(
            name.trim_end_matches(".exe"),
            "idle" | "system" | "memory compression"
        )
    });
    let ram = eligible
        .clone()
        .max_by_key(|process| (process.memory(), process.pid()))?;
    let cpu = eligible
        .filter(|process| process.cpu_usage().is_finite() && process.cpu_usage() > 0.0)
        .max_by(|a, b| {
            a.cpu_usage()
                .total_cmp(&b.cpu_usage())
                .then_with(|| a.pid().cmp(&b.pid()))
        });
    let spike = cpu.filter(|process| (process.cpu_usage() / cores).round() >= 10.0);
    let selected = spike.unwrap_or(ram);
    Some(TopProcess {
        process: ResourceConsumer::from_process(selected, cores),
        cpu_spike: spike.is_some(),
        top_cpu: cpu.map(|cpu| ResourceConsumer::from_process(cpu, cores)),
        top_ram: ResourceConsumer::from_process(ram, cores),
        token: crate::tasks::process_token(selected),
    })
}

#[derive(Serialize, PartialEq, Debug, Clone)]
pub struct Traffic {
    rx: f64,
    tx: f64,
}

type Counters = HashMap<u64, (u64, u64)>;

pub struct Collector {
    system: System,
    previous_network: Option<(Instant, Counters)>,
    pub primed: bool,
    clock: Option<CpuClock>,
    fallback_mhz: Option<u64>,
}

impl Default for Collector {
    fn default() -> Self {
        Self {
            system: System::new(),
            previous_network: None,
            primed: false,
            clock: CpuClock::open(),
            fallback_mhz: None,
        }
    }
}

struct CpuClock {
    query: crate::pdh::Query,
    performance: crate::pdh::Counter,
    base_mhz: u32,
}

impl CpuClock {
    fn open() -> Option<Self> {
        use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};
        let base_mhz: u32 = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            .ok()?
            .get_value("~MHz")
            .ok()?;
        if base_mhz == 0 {
            return None;
        }
        let query = crate::pdh::Query::open()?;
        let performance = query.add(r"\Processor Information(_Total)\% Processor Performance")?;
        query.collect();
        Some(Self {
            query,
            performance,
            base_mhz,
        })
    }

    fn mhz(&self) -> Option<u64> {
        if !self.query.collect() {
            return None;
        }
        let performance = self.performance.value()?;
        (5.0..=300.0)
            .contains(&performance)
            .then(|| (f64::from(self.base_mhz) * performance / 100.0).round() as u64)
    }
}

impl Collector {
    pub fn sample(&mut self, refresh_processes: bool, current: &mut FastSample) {
        if refresh_processes {
            self.system.refresh_cpu_all();
            self.system.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cpu().with_memory(),
            );
            current.cpu_name = self
                .system
                .cpus()
                .first()
                .map_or("", |cpu| cpu.brand())
                .trim()
                .to_owned();
            self.fallback_mhz = self
                .system
                .cpus()
                .iter()
                .map(|cpu| cpu.frequency())
                .filter(|&mhz| mhz > 0)
                .max();
            let cores = self.system.cpus().len().max(1) as f32;
            current.top_process = top_process(&self.system, cores);
        } else {
            self.system.refresh_cpu_usage();
        }
        let clock = self.clock.as_ref().and_then(CpuClock::mhz);
        current.cpu_mhz_live = clock.is_some();
        current.cpu_mhz = clock.or(self.fallback_mhz);
        self.system.refresh_memory();
        let cpu = self.system.global_cpu_usage();
        current.cpu_percent = (self.primed && !current.cpu_name.is_empty() && cpu.is_finite())
            .then_some(cpu.clamp(0.0, 100.0));
        current.ram = usage(self.system.used_memory(), self.system.total_memory());
        current.commit = native::memory_commit().and_then(|(used, total)| usage(used, total));
        current.uptime_seconds = System::uptime();
        self.primed = true;

        let now = Instant::now();
        current.traffic = native::adapters().and_then(|adapters| {
            let counters = adapters
                .into_iter()
                .filter(|nic| nic.online && nic.eligible)
                .map(|nic| (nic.luid, nic.counters))
                .collect();
            let previous = self.previous_network.replace((now, counters))?;
            let current = self.previous_network.as_ref()?;
            traffic_delta(
                &previous.1,
                &current.1,
                now.duration_since(previous.0).as_secs_f64(),
            )
        });
    }

    pub fn reset_baseline(&mut self) {
        self.primed = false;
        self.previous_network = None;
    }
}

fn usage(used: u64, total: u64) -> Option<Usage> {
    (total > 0).then_some(Usage { used, total })
}

fn traffic_delta(previous: &Counters, current: &Counters, elapsed: f64) -> Option<Traffic> {
    if elapsed <= 0.0 {
        return None;
    }
    let mut rx = 0.0;
    let mut tx = 0.0;
    for (id, &(new_rx, new_tx)) in current {
        if let Some(&(old_rx, old_tx)) = previous.get(id) {
            rx += new_rx.saturating_sub(old_rx) as f64;
            tx += new_tx.saturating_sub(old_tx) as f64;
        }
    }
    Some(Traffic {
        rx: rx / elapsed,
        tx: tx / elapsed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates_ignore_new_and_removed_adapters_and_counter_resets() {
        let previous = HashMap::from([(1, (100, 200)), (2, (999, 999)), (3, (200, 2))]);
        let current = HashMap::from([(1, (300, 260)), (3, (1, 12)), (4, (10_000, 20_000))]);
        assert_eq!(
            traffic_delta(&previous, &current, 2.0),
            Some(Traffic {
                rx: 100.0,
                tx: 35.0
            })
        );
        assert_eq!(traffic_delta(&previous, &current, 0.0), None);
    }
}
