use axum::extract::MatchedPath;

/// Build an HTTP tracing span without recording raw URI/query values.
///
/// Route templates preserve endpoint-level performance visibility while
/// avoiding high-cardinality and potentially sensitive path/query data in logs
/// or exported OpenTelemetry traces.
pub fn make_http_span<B>(request: &http::Request<B>) -> tracing::Span {
    let matched_path = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str)
        .unwrap_or("<unmatched>");

    tracing::debug_span!(
        "http.request",
        http.method = %request.method(),
        http.route = matched_path,
    )
}
