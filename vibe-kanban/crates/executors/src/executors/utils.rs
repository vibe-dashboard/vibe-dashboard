use std::{
    hash::Hash,
    num::NonZeroUsize,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

use futures::StreamExt;
use lru::LruCache;
use workspace_utils::process_diag;

use super::{BaseCodingAgent, SlashCommandDescription, StandardCodingAgentExecutor};
use crate::{
    executor_discovery::{ExecutorConfigCacheKey, ExecutorDiscoveredOptions},
    profile::ExecutorConfigs,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlashCommandCall<'a> {
    /// The command name in lowercase (without the leading slash)
    pub name: String,
    /// The arguments after the command name
    pub arguments: &'a str,
}

pub fn parse_slash_command<'a, T>(prompt: &'a str) -> Option<T>
where
    T: From<SlashCommandCall<'a>>,
{
    let trimmed = prompt.trim_start();
    let without_slash = trimmed.strip_prefix('/')?;
    let mut parts = without_slash.splitn(2, |ch: char| ch.is_whitespace());
    let name = parts.next()?.trim().to_lowercase();
    if name.is_empty() {
        return None;
    }
    let arguments = parts.next().map(|s| s.trim()).unwrap_or("");
    Some(T::from(SlashCommandCall { name, arguments }))
}

/// Reorder slash commands to prioritize compact then review.
#[must_use]
pub fn reorder_slash_commands(
    commands: impl IntoIterator<Item = SlashCommandDescription>,
) -> Vec<SlashCommandDescription> {
    let mut compact_command = None;
    let mut review_commands = None;
    let mut remaining_commands = Vec::new();

    for command in commands {
        match command.name.as_str() {
            "compact" => compact_command = Some(command),
            "review" => review_commands = Some(command),
            _ => remaining_commands.push(command),
        }
    }

    compact_command
        .into_iter()
        .chain(review_commands)
        .chain(remaining_commands)
        .collect()
}

#[derive(Clone, Debug)]
struct CacheEntry<V> {
    cached_at: Instant,
    value: Arc<V>,
}

pub struct TtlCache<K, V> {
    cache: Mutex<LruCache<K, CacheEntry<V>>>,
    ttl: Duration,
}

impl<K, V> TtlCache<K, V>
where
    K: Hash + Eq,
{
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            cache: Mutex::new(LruCache::new(
                NonZeroUsize::new(capacity).unwrap_or_else(|| NonZeroUsize::new(1).unwrap()),
            )),
            ttl,
        }
    }

    #[must_use]
    pub fn get(&self, key: &K) -> Option<Arc<V>> {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let entry = cache.get(key)?;
        let value = entry.value.clone();
        let expired = entry.cached_at.elapsed() > self.ttl;
        if expired {
            cache.pop(key);
            None
        } else {
            Some(value)
        }
    }

    pub fn put(&self, key: K, value: V) {
        let mut cache = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        cache.put(
            key,
            CacheEntry {
                cached_at: Instant::now(),
                value: Arc::new(value),
            },
        );
    }
}

pub const EXECUTOR_OPTIONS_CACHE_CAPACITY: usize = 64;
pub const DEFAULT_CACHE_TTL: Duration = Duration::from_mins(5);

pub fn executor_options_cache()
-> &'static TtlCache<ExecutorConfigCacheKey, ExecutorDiscoveredOptions> {
    static INSTANCE: OnceLock<TtlCache<ExecutorConfigCacheKey, ExecutorDiscoveredOptions>> =
        OnceLock::new();
    INSTANCE.get_or_init(|| TtlCache::new(EXECUTOR_OPTIONS_CACHE_CAPACITY, DEFAULT_CACHE_TTL))
}

/// Spawn a background task to refresh the global cache for an executor.
/// This should be called on every use to keep the cache warm.
pub fn spawn_global_cache_refresh_for_agent(base_agent: BaseCodingAgent) {
    spawn_global_cache_refresh_for_agent_with_configs(base_agent, ExecutorConfigs::get_cached());
}

fn spawn_global_cache_refresh_for_agent_with_configs(
    base_agent: BaseCodingAgent,
    configs: ExecutorConfigs,
) {
    let profile_id = crate::profile::ExecutorProfileId::new(base_agent);

    if let Some(coding_agent) = configs.get_coding_agent(&profile_id) {
        tokio::spawn(async move {
            if let Ok(mut stream) = coding_agent.discover_options(None, None).await {
                while stream.next().await.is_some() {}
            }
        });
    }
}

/// Preload the global cache for all executors with DEFAULT presets.
/// This should be called on startup to warm the cache.
pub async fn preload_global_executor_options_cache() {
    let configs = ExecutorConfigs::get_cached();
    let executors: Vec<BaseCodingAgent> = configs.executors.keys().copied().collect();
    let preload_started_at = Instant::now();

    tracing::info!(
        executor_count = executors.len(),
        concurrency = executors.len(),
        rss_mb = process_diag::bytes_to_mb(process_diag::sample_current_process().rss_bytes),
        elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
        "startup_diag_preload phase=executor_preload_begin"
    );

    let mut handles = Vec::with_capacity(executors.len());
    for base_agent in executors {
        let configs = configs.clone();
        handles.push(tokio::spawn(async move {
            let started_at = Instant::now();
            let before = process_diag::sample_current_process();
            tracing::info!(
                executor = %base_agent,
                rss_mb_before = process_diag::bytes_to_mb(before.rss_bytes),
                vm_size_mb_before = process_diag::bytes_to_mb(before.virtual_bytes),
                child_processes_before = before.child_process_count,
                threads_before = before.thread_count,
                fds_before = before.open_fd_count,
                elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
                "startup_diag_preload phase=executor_preload_executor_begin"
            );

            let profile_id = crate::profile::ExecutorProfileId::new(base_agent);
            if let Some(coding_agent) = configs.get_coding_agent(&profile_id) {
                match coding_agent.discover_options(None, None).await {
                    Ok(mut stream) => {
                        let mut patch_count = 0_u64;
                        while stream.next().await.is_some() {
                            patch_count += 1;
                        }
                        let after = process_diag::sample_current_process();
                        tracing::info!(
                            executor = %base_agent,
                            patch_count,
                            elapsed_executor_ms = started_at.elapsed().as_millis() as u64,
                            rss_mb_after = process_diag::bytes_to_mb(after.rss_bytes),
                            vm_size_mb_after = process_diag::bytes_to_mb(after.virtual_bytes),
                            child_processes_after = after.child_process_count,
                            threads_after = after.thread_count,
                            fds_after = after.open_fd_count,
                            elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
                            "startup_diag_preload phase=executor_preload_executor_complete"
                        );
                    }
                    Err(error) => {
                        let after = process_diag::sample_current_process();
                        tracing::warn!(
                            executor = %base_agent,
                            ?error,
                            elapsed_executor_ms = started_at.elapsed().as_millis() as u64,
                            rss_mb_after = process_diag::bytes_to_mb(after.rss_bytes),
                            vm_size_mb_after = process_diag::bytes_to_mb(after.virtual_bytes),
                            child_processes_after = after.child_process_count,
                            threads_after = after.thread_count,
                            fds_after = after.open_fd_count,
                            elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
                            "startup_diag_preload phase=executor_preload_executor_failed"
                        );
                    }
                }
            }
        }));
    }

    for handle in handles {
        if let Err(error) = handle.await {
            tracing::warn!(
                ?error,
                elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
                "startup_diag_preload phase=executor_preload_join_failed"
            );
        }
    }

    let after = process_diag::sample_current_process();
    tracing::info!(
        elapsed_preload_ms = preload_started_at.elapsed().as_millis() as u64,
        rss_mb_after = process_diag::bytes_to_mb(after.rss_bytes),
        vm_size_mb_after = process_diag::bytes_to_mb(after.virtual_bytes),
        child_processes_after = after.child_process_count,
        threads_after = after.thread_count,
        fds_after = after.open_fd_count,
        elapsed_ms = process_diag::elapsed_since_start().as_millis() as u64,
        "startup_diag_preload phase=executor_preload_complete"
    );
}
