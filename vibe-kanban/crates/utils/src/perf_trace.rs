pub const PERF_TRACE_DIRECTIVES: &[&str] = &[
    "perf.agent_startup=debug",
    "tower_http=debug",
    "sqlx::query=debug",
    "server::middleware::signed_ws=trace",
    "ws_bridge=trace",
];

pub fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

pub fn enabled() -> bool {
    env_flag("VK_PERF_TRACING")
}

pub fn ws_poll_tracing_enabled() -> bool {
    env_flag("VK_WS_POLL_TRACING")
}

pub fn tracing_filter_string(
    rust_log: &str,
    perf_tracing_enabled: bool,
    default_targets: &[&str],
    extra_directives: &[&str],
) -> String {
    let base_filter = if rust_log.contains('=') || rust_log.contains(',') {
        rust_log.to_string()
    } else {
        let mut directives = Vec::with_capacity(default_targets.len() + extra_directives.len());
        directives.extend(
            extra_directives
                .iter()
                .map(|directive| (*directive).to_string()),
        );
        directives.extend(
            default_targets
                .iter()
                .map(|target| format!("{target}={rust_log}")),
        );
        directives.join(",")
    };

    if perf_tracing_enabled {
        let mut directives = Vec::with_capacity(1 + PERF_TRACE_DIRECTIVES.len());
        directives.push(base_filter);
        directives.extend(
            PERF_TRACE_DIRECTIVES
                .iter()
                .map(|directive| (*directive).to_string()),
        );
        directives.join(",")
    } else {
        base_filter
    }
}

#[cfg(test)]
mod tests {
    use super::tracing_filter_string;

    #[test]
    fn tracing_filter_uses_default_modules_for_plain_levels() {
        let filter = tracing_filter_string("debug", false, &["server", "utils"], &["warn"]);

        assert_eq!(filter, "warn,server=debug,utils=debug");
    }

    #[test]
    fn tracing_filter_preserves_explicit_directives() {
        let filter = tracing_filter_string("server=trace,sqlx=debug", false, &["server"], &[]);

        assert_eq!(filter, "server=trace,sqlx=debug");
    }

    #[test]
    fn tracing_filter_appends_perf_directives_when_enabled() {
        let filter = tracing_filter_string("info", true, &["server"], &["warn"]);

        assert!(filter.contains("server=info"));
        assert!(filter.contains("tower_http=debug"));
        assert!(filter.contains("perf.agent_startup=debug"));
        assert!(filter.contains("sqlx::query=debug"));
        assert!(filter.contains("server::middleware::signed_ws=trace"));
        assert!(filter.contains("ws_bridge=trace"));
    }
}
