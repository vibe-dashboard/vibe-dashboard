#[cfg(target_os = "linux")]
use std::{fs, path::Path};
use std::{
    sync::OnceLock,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Default)]
pub struct ProcessSnapshot {
    pub rss_bytes: Option<u64>,
    pub virtual_bytes: Option<u64>,
    pub thread_count: Option<u64>,
    pub open_fd_count: Option<u64>,
    pub child_process_count: Option<u64>,
}

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

pub fn mark_process_start() {
    let _ = PROCESS_START.get_or_init(Instant::now);
}

#[must_use]
pub fn elapsed_since_start() -> Duration {
    PROCESS_START.get_or_init(Instant::now).elapsed()
}

#[must_use]
pub fn sample_current_process() -> ProcessSnapshot {
    #[cfg(target_os = "linux")]
    {
        sample_linux_process()
    }

    #[cfg(not(target_os = "linux"))]
    {
        ProcessSnapshot::default()
    }
}

#[must_use]
pub fn bytes_to_mb(bytes: Option<u64>) -> Option<u64> {
    bytes.map(|value| value / (1024 * 1024))
}

#[cfg(target_os = "linux")]
fn sample_linux_process() -> ProcessSnapshot {
    let status = fs::read_to_string("/proc/self/status").ok();

    ProcessSnapshot {
        rss_bytes: status
            .as_deref()
            .and_then(|text| parse_status_kb_field(text, "VmRSS").map(|kb| kb * 1024)),
        virtual_bytes: status
            .as_deref()
            .and_then(|text| parse_status_kb_field(text, "VmSize").map(|kb| kb * 1024)),
        thread_count: status
            .as_deref()
            .and_then(|text| parse_status_u64_field(text, "Threads")),
        open_fd_count: count_dir_entries("/proc/self/fd"),
        child_process_count: current_thread_children_path()
            .as_deref()
            .and_then(read_children_count),
    }
}

#[cfg(target_os = "linux")]
fn current_thread_children_path() -> Option<String> {
    Some(format!("/proc/self/task/{}/children", std::process::id()))
}

#[cfg(target_os = "linux")]
fn read_children_count(path: &str) -> Option<u64> {
    let children = fs::read_to_string(path).ok()?;
    Some(children.split_whitespace().count() as u64)
}

#[cfg(target_os = "linux")]
fn count_dir_entries(path: impl AsRef<Path>) -> Option<u64> {
    let entries = fs::read_dir(path).ok()?;
    Some(entries.count() as u64)
}

#[cfg(target_os = "linux")]
fn parse_status_kb_field(status: &str, key: &str) -> Option<u64> {
    let raw_value = parse_status_value(status, key)?;
    raw_value.strip_suffix(" kB")?.trim().parse().ok()
}

#[cfg(target_os = "linux")]
fn parse_status_u64_field(status: &str, key: &str) -> Option<u64> {
    parse_status_value(status, key)?.trim().parse().ok()
}

#[cfg(target_os = "linux")]
fn parse_status_value<'a>(status: &'a str, key: &str) -> Option<&'a str> {
    status.lines().find_map(|line| {
        let (field, value) = line.split_once(':')?;
        (field == key).then_some(value.trim())
    })
}
