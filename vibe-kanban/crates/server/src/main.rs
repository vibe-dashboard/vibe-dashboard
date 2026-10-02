use anyhow::{self, Error as AnyhowError};
use axum::Router;
use deployment::{Deployment, DeploymentError};
use server::{
    middleware::{make_http_span, origin::validate_origin},
    routes,
    runtime::relay_registration,
    startup,
};
use sqlx::Error as SqlxError;
use strip_ansi_escapes::strip;
use thiserror::Error;
use tokio_util::sync::CancellationToken;
use tower_http::{trace::TraceLayer, validate_request::ValidateRequestHeaderLayer};
use tracing_subscriber::{EnvFilter, prelude::*};
use utils::{
    perf_trace,
    port_file::write_port_file_with_proxy,
    sentry::{self as sentry_utils, SentrySource, sentry_layer},
    signoz,
};

const DEFAULT_TRACING_TARGETS: &[&str] = &[
    "server",
    "services",
    "db",
    "executors",
    "deployment",
    "local_deployment",
    "utils",
    "embedded_ssh",
    "desktop_bridge",
    "relay_hosts",
    "relay_client",
    "relay_webrtc",
    "ws_bridge",
];

const DEFAULT_TRACING_DIRECTIVES: &[&str] = &["warn", "codex_core=off"];

#[derive(Debug, Error)]
pub enum VibeKanbanError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlx(#[from] SqlxError),
    #[error(transparent)]
    Deployment(#[from] DeploymentError),
    #[error(transparent)]
    Other(#[from] AnyhowError),
}

#[tokio::main]
async fn main() -> Result<(), VibeKanbanError> {
    // Install rustls crypto provider before any TLS operations
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    sentry_utils::init_once(SentrySource::Backend);

    let log_level = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    let perf_tracing_enabled = perf_trace::enabled();
    let log_filter_string = perf_trace::tracing_filter_string(
        &log_level,
        false,
        DEFAULT_TRACING_TARGETS,
        DEFAULT_TRACING_DIRECTIVES,
    );
    let signoz_filter_string = perf_trace::tracing_filter_string(
        &log_level,
        perf_tracing_enabled,
        DEFAULT_TRACING_TARGETS,
        DEFAULT_TRACING_DIRECTIVES,
    );
    let env_filter =
        EnvFilter::try_new(log_filter_string.as_str()).expect("Failed to create tracing filter");
    let (signoz_layer, signoz_provider, signoz_endpoint, signoz_enabled) =
        match signoz::init_layer("vibe-kanban-backend", &signoz_filter_string) {
            Some(signoz::SignozTracing {
                layer,
                provider,
                endpoint_diagnostics,
            }) => (
                Some(layer),
                Some(provider),
                Some(endpoint_diagnostics),
                true,
            ),
            None => (
                None,
                None,
                signoz::resolved_endpoint_for_diagnostics(),
                false,
            ),
        };
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(env_filter))
        .with(signoz_layer)
        .with(sentry_layer(SentrySource::Backend))
        .init();
    if perf_tracing_enabled {
        tracing::info!(
            signoz_enabled,
            signoz_endpoint_configured = signoz_endpoint.is_some(),
            signoz_endpoint_source = signoz_endpoint
                .as_ref()
                .map(|endpoint| endpoint.source)
                .unwrap_or("not configured"),
            signoz_endpoint_scheme = signoz_endpoint
                .as_ref()
                .map(|endpoint| endpoint.scheme.as_str())
                .unwrap_or("not configured"),
            signoz_endpoint_host = signoz_endpoint
                .as_ref()
                .map(|endpoint| endpoint.host.as_str())
                .unwrap_or("not configured"),
            signoz_endpoint_port = signoz_endpoint.as_ref().and_then(|endpoint| endpoint.port),
            signoz_endpoint_path = signoz_endpoint
                .as_ref()
                .map(|endpoint| endpoint.path.as_str())
                .unwrap_or("not configured"),
            "Performance tracing enabled. HTTP spans, SQLx query logs, \
             and WebSocket send paths are traceable."
        );
    }
    startup::begin_startup_diagnostics();

    let shutdown_token = CancellationToken::new();

    let deployment = startup::initialize_deployment(shutdown_token.clone()).await?;
    let port = std::env::var("BACKEND_PORT")
        .or_else(|_| std::env::var("PORT"))
        .ok()
        .and_then(|s| {
            // Remove any ANSI codes, then turn into String
            let cleaned =
                String::from_utf8(strip(s.as_bytes())).expect("UTF-8 after stripping ANSI");
            cleaned.trim().parse::<u16>().ok()
        })
        .unwrap_or_else(|| {
            tracing::info!("No PORT environment variable set, using port 0 for auto-assignment");
            0
        }); // Use 0 to find free port if no specific port provided

    let proxy_port = std::env::var("PREVIEW_PROXY_PORT")
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .unwrap_or(0);

    let host = std::env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());

    let main_listener = tokio::net::TcpListener::bind(format!("{host}:{port}")).await?;
    let actual_main_port = main_listener.local_addr()?.port();

    let proxy_listener = tokio::net::TcpListener::bind(format!("{host}:{proxy_port}")).await?;
    let actual_proxy_port = proxy_listener.local_addr()?.port();
    startup::log_startup_phase("http_bind_complete");

    if let Err(e) = write_port_file_with_proxy(actual_main_port, Some(actual_proxy_port)).await {
        tracing::warn!("Failed to write port file: {}", e);
    }

    tracing::info!(
        "Main server on :{}, Preview proxy on :{}",
        actual_main_port,
        actual_proxy_port
    );

    deployment
        .client_info()
        .set_server_addr(main_listener.local_addr()?)
        .expect("client server address already set");
    deployment
        .client_info()
        .set_preview_proxy_port(actual_proxy_port)
        .expect("client preview proxy port already set");
    startup::log_startup_phase("client_info_registered");

    let app_router = routes::router(deployment.clone(), perf_tracing_enabled);

    // Production only: open browser
    if !cfg!(debug_assertions) {
        tracing::info!("Opening browser...");
        let browser_port = actual_main_port;
        tokio::spawn(async move {
            if let Err(e) =
                utils::browser::open_browser(&format!("http://127.0.0.1:{browser_port}")).await
            {
                tracing::warn!(
                    "Failed to open browser automatically: {}. Please open http://127.0.0.1:{} manually.",
                    e,
                    browser_port
                );
            }
        });
    }

    let proxy_router: Router = {
        let router = routes::preview::subdomain_router(deployment.clone());
        let router = if perf_tracing_enabled {
            router.layer(
                TraceLayer::new_for_http()
                    .make_span_with(|request: &axum::extract::Request| make_http_span(request)),
            )
        } else {
            router
        };
        router.layer(ValidateRequestHeaderLayer::custom(validate_origin))
    };

    let main_shutdown = shutdown_token.clone();
    let proxy_shutdown = shutdown_token.clone();

    let main_server = axum::serve(main_listener, app_router)
        .with_graceful_shutdown(async move { main_shutdown.cancelled().await });
    let proxy_server = axum::serve(proxy_listener, proxy_router)
        .with_graceful_shutdown(async move { proxy_shutdown.cancelled().await });

    let mut main_handle = tokio::spawn(async move {
        if let Err(e) = main_server.await {
            tracing::error!("Main server error: {}", e);
        }
    });
    let mut proxy_handle = tokio::spawn(async move {
        if let Err(e) = proxy_server.await {
            tracing::error!("Preview proxy error: {}", e);
        }
    });
    startup::log_startup_phase("server_ready");

    relay_registration::spawn_relay(&deployment).await;
    startup::log_startup_phase("relay_startup_spawn_complete");

    let mut main_done = false;
    let mut proxy_done = false;
    tokio::select! {
        _ = shutdown_signal() => {
            tracing::info!("Shutdown signal received");
        }
        result = &mut main_handle => {
            main_done = true;
            if let Err(error) = result {
                tracing::error!(%error, "Main server task failed");
            } else {
                tracing::warn!("Main server task completed; shutting down");
            }
        }
        result = &mut proxy_handle => {
            proxy_done = true;
            if let Err(error) = result {
                tracing::error!(%error, "Preview proxy task failed");
            } else {
                tracing::warn!("Preview proxy task completed; shutting down");
            }
        }
    }

    shutdown_token.cancel();

    if !main_done && let Err(error) = main_handle.await {
        tracing::error!(%error, "Main server task failed during shutdown");
    }
    if !proxy_done && let Err(error) = proxy_handle.await {
        tracing::error!(%error, "Preview proxy task failed during shutdown");
    }

    perform_cleanup_actions(&deployment).await;

    if let Some(provider) = signoz_provider
        && let Err(error) = provider.shutdown()
    {
        tracing::warn!(%error, "Failed to flush SigNoz OpenTelemetry spans");
    }

    Ok(())
}

pub async fn shutdown_signal() {
    // Always wait for Ctrl+C
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::error!("Failed to install Ctrl+C handler: {e}");
        }
    };

    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

        // Try to install SIGTERM handler, but don't panic if it fails
        let terminate = async {
            if let Ok(mut sigterm) = signal(SignalKind::terminate()) {
                sigterm.recv().await;
            } else {
                tracing::error!("Failed to install SIGTERM handler");
                // Fallback: never resolves
                std::future::pending::<()>().await;
            }
        };

        tokio::select! {
            _ = ctrl_c => {},
            _ = terminate => {},
        }
    }

    #[cfg(not(unix))]
    {
        // Only ctrl_c is available, so just await it
        ctrl_c.await;
    }
}

pub async fn perform_cleanup_actions(deployment: &server::DeploymentImpl) {
    startup::perform_cleanup_actions(deployment).await;
}
