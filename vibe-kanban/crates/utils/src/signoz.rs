use std::env;

use opentelemetry::trace::TracerProvider as _;
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::{Resource, trace::SdkTracerProvider};
use tracing_subscriber::{EnvFilter, Layer};

use crate::perf_trace;

pub struct SignozTracing<S>
where
    S: tracing::Subscriber + for<'span> tracing_subscriber::registry::LookupSpan<'span>,
{
    pub layer: Box<dyn Layer<S> + Send + Sync>,
    pub provider: SdkTracerProvider,
    pub endpoint_diagnostics: OtlpEndpointDiagnostics,
}

pub fn init_layer<S>(
    default_service_name: &'static str,
    filter_directives: &str,
) -> Option<SignozTracing<S>>
where
    S: tracing::Subscriber
        + for<'span> tracing_subscriber::registry::LookupSpan<'span>
        + Send
        + Sync,
{
    if !perf_trace::enabled() {
        return None;
    }

    let endpoint = match resolve_otlp_traces_endpoint() {
        Ok(endpoint) => endpoint,
        Err(error) => {
            eprintln!(
                "SigNoz OTLP export is disabled: {error}. \
                 Set OTEL_EXPORTER_OTLP_TRACES_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT \
                 to a valid http:// or https:// endpoint."
            );
            return None;
        }
    };
    for warning in &endpoint.warnings {
        eprintln!("SigNoz OTLP endpoint warning: {warning}");
    }

    let endpoint_diagnostics = endpoint.diagnostics();
    let exporter = match SpanExporter::builder()
        .with_http()
        .with_endpoint(endpoint.endpoint.clone())
        .build()
    {
        Ok(exporter) => exporter,
        Err(_error) => {
            eprintln!(
                "Failed to initialize SigNoz OTLP span exporter for {} endpoint \
                 {}://{}{}{}. Performance traces will remain local.",
                endpoint_diagnostics.source,
                endpoint_diagnostics.scheme,
                endpoint_diagnostics.host,
                endpoint_diagnostics
                    .port
                    .map(|port| format!(":{port}"))
                    .unwrap_or_default(),
                endpoint_diagnostics.path
            );
            return None;
        }
    };
    let env_filter = match EnvFilter::try_new(filter_directives) {
        Ok(filter) => filter,
        Err(error) => {
            eprintln!(
                "Failed to initialize SigNoz tracing filter: {error}. \
                 Performance traces will remain local."
            );
            return None;
        }
    };

    let service_name = service_name(default_service_name);
    let provider = SdkTracerProvider::builder()
        .with_resource(Resource::builder().with_service_name(service_name).build())
        .with_batch_exporter(exporter)
        .build();

    opentelemetry::global::set_tracer_provider(provider.clone());

    let tracer = provider.tracer(default_service_name);
    let layer = tracing_opentelemetry::layer()
        .with_tracer(tracer)
        .with_filter(env_filter)
        .boxed();

    Some(SignozTracing {
        layer,
        provider,
        endpoint_diagnostics,
    })
}

pub fn enabled() -> bool {
    perf_trace::enabled() && resolve_otlp_traces_endpoint().is_ok()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedOtlpEndpoint {
    endpoint: String,
    source: &'static str,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OtlpEndpointDiagnostics {
    pub source: &'static str,
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    pub path: String,
}

impl ResolvedOtlpEndpoint {
    fn diagnostics(&self) -> OtlpEndpointDiagnostics {
        endpoint_diagnostics(&self.endpoint, self.source)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum OtlpEndpointConfigError {
    MissingEndpoint,
    InvalidEndpoint {
        var_name: &'static str,
        reason: String,
    },
}

impl std::fmt::Display for OtlpEndpointConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingEndpoint => write!(
                formatter,
                "no non-empty OTLP HTTP endpoint is configured for traces"
            ),
            Self::InvalidEndpoint { var_name, reason } => {
                write!(
                    formatter,
                    "{var_name} is not a valid OTLP HTTP endpoint: {reason}"
                )
            }
        }
    }
}

pub fn resolved_endpoint_for_diagnostics() -> Option<OtlpEndpointDiagnostics> {
    resolve_otlp_traces_endpoint()
        .ok()
        .map(|endpoint| endpoint.diagnostics())
}

fn resolve_otlp_traces_endpoint() -> Result<ResolvedOtlpEndpoint, OtlpEndpointConfigError> {
    resolve_otlp_traces_endpoint_from(
        env::var("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").ok(),
        env::var("OTEL_EXPORTER_OTLP_ENDPOINT").ok(),
    )
}

fn resolve_otlp_traces_endpoint_from(
    traces_endpoint: Option<String>,
    generic_endpoint: Option<String>,
) -> Result<ResolvedOtlpEndpoint, OtlpEndpointConfigError> {
    let mut warnings = Vec::new();

    if let Some(endpoint) = traces_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
    {
        match validate_http_endpoint("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", endpoint) {
            Ok(()) => {
                return Ok(ResolvedOtlpEndpoint {
                    endpoint: endpoint.to_string(),
                    source: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
                    warnings,
                });
            }
            Err(error) => warnings.push(format!(
                "Ignoring OTEL_EXPORTER_OTLP_TRACES_ENDPOINT because {error}; \
                 falling back to OTEL_EXPORTER_OTLP_ENDPOINT if it is valid."
            )),
        }
    }

    if let Some(endpoint) = generic_endpoint
        .as_deref()
        .map(str::trim)
        .filter(|endpoint| !endpoint.is_empty())
    {
        validate_http_endpoint("OTEL_EXPORTER_OTLP_ENDPOINT", endpoint)?;
        return Ok(ResolvedOtlpEndpoint {
            endpoint: append_traces_path(endpoint),
            source: "OTEL_EXPORTER_OTLP_ENDPOINT",
            warnings,
        });
    }

    if let Some(warning) = warnings.into_iter().next() {
        return Err(OtlpEndpointConfigError::InvalidEndpoint {
            var_name: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            reason: warning,
        });
    }

    Err(OtlpEndpointConfigError::MissingEndpoint)
}

fn validate_http_endpoint(
    var_name: &'static str,
    endpoint: &str,
) -> Result<(), OtlpEndpointConfigError> {
    if endpoint.chars().any(char::is_whitespace) {
        return Err(OtlpEndpointConfigError::InvalidEndpoint {
            var_name,
            reason: "contains whitespace".to_string(),
        });
    }

    let Some(after_scheme) = endpoint
        .strip_prefix("http://")
        .or_else(|| endpoint.strip_prefix("https://"))
    else {
        return Err(OtlpEndpointConfigError::InvalidEndpoint {
            var_name,
            reason: "missing http:// or https:// scheme".to_string(),
        });
    };

    if after_scheme.is_empty() || after_scheme.starts_with('/') {
        return Err(OtlpEndpointConfigError::InvalidEndpoint {
            var_name,
            reason: "missing host".to_string(),
        });
    }

    Ok(())
}

fn append_traces_path(endpoint: &str) -> String {
    let endpoint = endpoint.trim_end_matches('/');
    if endpoint.ends_with("/v1/traces") {
        endpoint.to_string()
    } else {
        format!("{endpoint}/v1/traces")
    }
}

fn endpoint_diagnostics(endpoint: &str, source: &'static str) -> OtlpEndpointDiagnostics {
    let (scheme, without_scheme) = endpoint
        .split_once("://")
        .expect("validated OTLP endpoint includes a scheme");
    let endpoint_without_fragment = without_scheme
        .split_once('#')
        .map_or(without_scheme, |part| part.0);
    let endpoint_without_query = endpoint_without_fragment
        .split_once('?')
        .map_or(endpoint_without_fragment, |part| part.0);
    let (authority, path) = endpoint_without_query
        .split_once('/')
        .map_or((endpoint_without_query, "/"), |(authority, path)| {
            (authority, if path.is_empty() { "/" } else { path })
        });
    let authority_without_userinfo = authority.rsplit_once('@').map_or(authority, |part| part.1);
    let (host, port) = split_host_port(authority_without_userinfo);

    OtlpEndpointDiagnostics {
        source,
        scheme: scheme.to_string(),
        host: host.to_string(),
        port,
        path: if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{path}")
        },
    }
}

fn split_host_port(authority: &str) -> (&str, Option<u16>) {
    if let Some((host, rest)) = authority
        .strip_prefix('[')
        .and_then(|rest| rest.split_once(']'))
    {
        let port = rest.strip_prefix(':').and_then(|port| port.parse().ok());
        return (host, port);
    }

    authority
        .rsplit_once(':')
        .and_then(|(host, port)| Some((host, Some(port.parse::<u16>().ok()?))))
        .unwrap_or((authority, None))
}

fn service_name(default_service_name: &'static str) -> String {
    service_name_from(env::var("OTEL_SERVICE_NAME").ok(), default_service_name)
}

fn service_name_from(
    configured_name: Option<String>,
    default_service_name: &'static str,
) -> String {
    configured_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| default_service_name.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        OtlpEndpointConfigError, append_traces_path, endpoint_diagnostics,
        resolve_otlp_traces_endpoint_from, service_name_from,
    };

    #[test]
    fn service_name_uses_default_when_env_is_not_supplied() {
        assert_eq!(
            service_name_from(None, "vibe-kanban-test"),
            "vibe-kanban-test"
        );
        assert_eq!(
            service_name_from(Some("  ".to_string()), "vibe-kanban-test"),
            "vibe-kanban-test"
        );
    }

    #[test]
    fn service_name_uses_configured_name() {
        assert_eq!(
            service_name_from(Some("custom-service".to_string()), "vibe-kanban-test"),
            "custom-service"
        );
    }

    #[test]
    fn resolves_signal_specific_endpoint_as_full_trace_url() {
        let endpoint = resolve_otlp_traces_endpoint_from(
            Some(" https://signoz.example/otel/v1/traces ".to_string()),
            Some("https://generic.example".to_string()),
        )
        .unwrap();

        assert_eq!(endpoint.endpoint, "https://signoz.example/otel/v1/traces");
        assert_eq!(endpoint.source, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
        assert!(endpoint.warnings.is_empty());
    }

    #[test]
    fn appends_trace_path_to_generic_endpoint() {
        let endpoint = resolve_otlp_traces_endpoint_from(
            None,
            Some("https://signoz.example/otel/".to_string()),
        )
        .unwrap();

        assert_eq!(endpoint.endpoint, "https://signoz.example/otel/v1/traces");
        assert_eq!(endpoint.source, "OTEL_EXPORTER_OTLP_ENDPOINT");
    }

    #[test]
    fn does_not_duplicate_trace_path_on_generic_endpoint() {
        assert_eq!(
            append_traces_path("https://signoz.example/v1/traces"),
            "https://signoz.example/v1/traces"
        );
    }

    #[test]
    fn falls_back_to_valid_generic_endpoint_when_signal_endpoint_is_invalid() {
        let endpoint = resolve_otlp_traces_endpoint_from(
            Some("signoz.example/v1/traces".to_string()),
            Some("https://generic.example".to_string()),
        )
        .unwrap();

        assert_eq!(endpoint.endpoint, "https://generic.example/v1/traces");
        assert_eq!(endpoint.source, "OTEL_EXPORTER_OTLP_ENDPOINT");
        assert_eq!(endpoint.warnings.len(), 1);
        assert!(endpoint.warnings[0].contains("missing http:// or https:// scheme"));
    }

    #[test]
    fn rejects_invalid_generic_endpoint_instead_of_using_sdk_localhost_default() {
        let error = resolve_otlp_traces_endpoint_from(None, Some("127.0.0.1:4318".to_string()))
            .unwrap_err();

        assert_eq!(
            error,
            OtlpEndpointConfigError::InvalidEndpoint {
                var_name: "OTEL_EXPORTER_OTLP_ENDPOINT",
                reason: "missing http:// or https:// scheme".to_string(),
            }
        );
    }

    #[test]
    fn rejects_missing_or_blank_endpoints() {
        assert_eq!(
            resolve_otlp_traces_endpoint_from(None, None).unwrap_err(),
            OtlpEndpointConfigError::MissingEndpoint
        );
        assert_eq!(
            resolve_otlp_traces_endpoint_from(Some("  ".to_string()), Some("".to_string()))
                .unwrap_err(),
            OtlpEndpointConfigError::MissingEndpoint
        );
    }

    #[test]
    fn endpoint_diagnostics_redacts_userinfo_query_and_fragment() {
        let diagnostics = endpoint_diagnostics(
            "https://token:secret@collector.example:443/otlp/v1/traces?key=secret#frag",
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
        );

        assert_eq!(diagnostics.source, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
        assert_eq!(diagnostics.scheme, "https");
        assert_eq!(diagnostics.host, "collector.example");
        assert_eq!(diagnostics.port, Some(443));
        assert_eq!(diagnostics.path, "/otlp/v1/traces");
    }

    #[test]
    fn endpoint_diagnostics_handles_root_and_ipv6_endpoints() {
        let diagnostics = endpoint_diagnostics("http://[::1]:4318", "OTEL_EXPORTER_OTLP_ENDPOINT");

        assert_eq!(diagnostics.scheme, "http");
        assert_eq!(diagnostics.host, "::1");
        assert_eq!(diagnostics.port, Some(4318));
        assert_eq!(diagnostics.path, "/");
    }
}
