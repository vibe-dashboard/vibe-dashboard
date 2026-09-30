use std::time::Instant;

use axum::{
    extract::{MatchedPath, OriginalUri, Request},
    middleware::Next,
    response::Response,
};
use utils::process_diag;

pub async fn log_api_requests(request: Request, next: Next) -> Response {
    if !crate::startup::runtime_diagnostics_enabled() {
        return next.run(request).await;
    }

    let started_at = Instant::now();
    let method = request.method().clone();
    let uri = request
        .extensions()
        .get::<OriginalUri>()
        .map(|original| original.0.clone())
        .unwrap_or_else(|| request.uri().clone());
    let matched_path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned());
    let request_content_length = request
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());

    let response = next.run(request).await;
    let snapshot = process_diag::sample_current_process();
    let response_content_length = response
        .headers()
        .get(axum::http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());

    tracing::info!(
        method = %method,
        uri = %uri,
        matched_path = matched_path.as_deref().unwrap_or("<unmatched>"),
        status = %response.status(),
        request_content_length,
        response_content_length,
        elapsed_ms = started_at.elapsed().as_millis() as u64,
        rss_mb = process_diag::bytes_to_mb(snapshot.rss_bytes),
        vm_size_mb = process_diag::bytes_to_mb(snapshot.virtual_bytes),
        threads = snapshot.thread_count,
        fds = snapshot.open_fd_count,
        child_processes = snapshot.child_process_count,
        "runtime_diag_http_request"
    );

    response
}
