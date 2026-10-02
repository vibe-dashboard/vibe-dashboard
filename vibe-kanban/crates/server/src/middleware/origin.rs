use std::{net::IpAddr, sync::OnceLock};

use axum::{
    body::Body,
    extract::Request,
    http::{StatusCode, header},
    response::Response,
};
use relay_client::RELAY_HEADER;
use url::Url;

#[derive(Clone, Debug, Eq, PartialEq)]
struct OriginKey {
    https: bool,
    host: String,
    port: u16,
}

impl OriginKey {
    fn from_origin(origin: &str) -> Option<Self> {
        let url = Url::parse(origin).ok()?;
        Self::from_url(&url)
    }

    fn from_allowed_origin(origin: &str) -> Option<Self> {
        let (_, remainder) = origin.split_once("://")?;
        if remainder.contains(['?', '#']) || remainder.contains('@') {
            return None;
        }
        if remainder.contains('/') && !remainder.ends_with('/') {
            return None;
        }

        let url = Url::parse(origin).ok()?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return None;
        }
        let host = url.host_str()?;
        if host.split('.').any(str::is_empty) {
            return None;
        }
        Self::from_url(&url)
    }

    fn from_url(url: &Url) -> Option<Self> {
        let https = match url.scheme() {
            "http" => false,
            "https" => true,
            _ => return None,
        };
        let host = normalize_host(url.host_str()?);
        let port = url.port_or_known_default()?;
        Some(Self { https, host, port })
    }

    fn from_host_header(host: &str, https: bool) -> Option<Self> {
        let authority: axum::http::uri::Authority = host.parse().ok()?;
        let host = normalize_host(authority.host());
        let port = authority.port_u16().unwrap_or_else(|| default_port(https));
        Some(Self { https, host, port })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum AllowedOrigin {
    Exact(OriginKey),
    Pattern(OriginPattern),
}

impl AllowedOrigin {
    fn from_env_entry(origin: &str) -> Result<Option<Self>, String> {
        let origin = origin.trim();
        if origin.is_empty() {
            return Ok(None);
        }
        if origin.contains('*') {
            return OriginPattern::from_allowed_origin(origin)
                .map(Self::Pattern)
                .map(Some)
                .ok_or_else(|| invalid_allowed_origin(origin));
        }
        OriginKey::from_allowed_origin(origin)
            .map(Self::Exact)
            .map(Some)
            .ok_or_else(|| invalid_allowed_origin(origin))
    }

    fn matches(&self, origin: &OriginKey) -> bool {
        match self {
            Self::Exact(allowed) => allowed == origin,
            Self::Pattern(pattern) => pattern.matches(origin),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OriginPattern {
    https: bool,
    suffix: String,
    port: u16,
}

impl OriginPattern {
    fn from_allowed_origin(origin: &str) -> Option<Self> {
        let (scheme, authority) = split_allowed_origin_authority(origin)?;
        let https = match scheme {
            "http" => false,
            "https" => true,
            _ => return None,
        };

        if authority.is_empty() || authority.starts_with('[') || authority.contains('@') {
            return None;
        }

        let (host_pattern, port) = match authority.rsplit_once(':') {
            Some((host, port)) => {
                if host.is_empty() || !port.chars().all(|ch| ch.is_ascii_digit()) {
                    return None;
                }
                (host, port.parse().ok()?)
            }
            None => (authority, default_port(https)),
        };

        let host_pattern = normalize_host(host_pattern);
        let suffix = host_pattern.strip_prefix("*.")?;
        if !valid_wildcard_suffix(suffix) {
            return None;
        }

        Some(Self {
            https,
            suffix: suffix.to_string(),
            port,
        })
    }

    fn matches(&self, origin: &OriginKey) -> bool {
        self.https == origin.https
            && self.port == origin.port
            && wildcard_subdomain_matches(&self.suffix, &origin.host)
    }
}

fn invalid_allowed_origin(origin: &str) -> String {
    format!(
        "Invalid VK_ALLOWED_ORIGINS entry `{origin}`. Expected an exact http(s) origin like \
         `https://app.example.com` or a single-label wildcard origin like \
         `https://*.example.com`. Paths, queries, fragments, userinfo, bare `*`, and partial \
         wildcards such as `https://port-*.example.com` are not allowed."
    )
}

#[allow(clippy::result_large_err)]
pub fn validate_origin<B>(req: &mut Request<B>) -> Result<(), Response> {
    // Relay-proxied requests are authenticated through the relay's own session
    // system, so origin validation is not applicable.
    if is_relay_request(req) {
        return Ok(());
    }

    let Some(origin) = get_origin_header(req) else {
        return Ok(());
    };

    if origin.eq_ignore_ascii_case("null") {
        return Err(forbidden());
    }

    let host = get_host_header(req);

    // quick short-circuit same-origin check
    if host.is_some_and(|host| origin_matches_host(origin, host)) {
        return Ok(());
    }

    let Some(origin_key) = OriginKey::from_origin(origin) else {
        return Err(forbidden());
    };

    if origin_allowed(&origin_key, allowed_origins()) {
        return Ok(());
    }

    if let Some(host_key) =
        host.and_then(|host| OriginKey::from_host_header(host, origin_key.https))
        && host_key == origin_key
    {
        return Ok(());
    }

    Err(forbidden())
}

fn get_origin_header<B>(req: &Request<B>) -> Option<&str> {
    get_header(req, header::ORIGIN)
}

fn get_host_header<B>(req: &Request<B>) -> Option<&str> {
    get_header(req, header::HOST)
}

fn get_header<B>(req: &Request<B>, name: header::HeaderName) -> Option<&str> {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
}

fn is_relay_request<B>(req: &Request<B>) -> bool {
    req.headers()
        .get(RELAY_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim() == "1")
}

fn forbidden() -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .is_some_and(|rest| rest.eq_ignore_ascii_case(host))
}

fn normalize_host(host: &str) -> String {
    let trimmed = host.trim().trim_start_matches('[').trim_end_matches(']');
    let lower = trimmed.to_ascii_lowercase();
    if lower == "localhost" {
        return "localhost".to_string();
    }
    if let Ok(ip) = lower.parse::<IpAddr>() {
        if ip.is_loopback() {
            return "localhost".to_string();
        }
        return ip.to_string();
    }
    lower
}

fn default_port(https: bool) -> u16 {
    if https { 443 } else { 80 }
}

fn origin_allowed(origin: &OriginKey, allowed_origins: &[AllowedOrigin]) -> bool {
    allowed_origins
        .iter()
        .any(|allowed| allowed.matches(origin))
}

fn split_allowed_origin_authority(origin: &str) -> Option<(&str, &str)> {
    let (scheme, remainder) = origin.split_once("://")?;
    if remainder.contains(['?', '#']) {
        return None;
    }

    let authority = match remainder.strip_suffix('/') {
        Some(authority) => authority,
        None => remainder,
    };
    if authority.contains('/') {
        return None;
    }

    Some((scheme, authority))
}

fn valid_wildcard_suffix(suffix: &str) -> bool {
    let labels: Vec<&str> = suffix.split('.').collect();
    if labels.len() < 2 || labels.iter().any(|label| label.is_empty()) {
        return false;
    }

    labels.iter().all(|label| {
        !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

fn wildcard_subdomain_matches(suffix: &str, host: &str) -> bool {
    let Some(prefix) = host.strip_suffix(suffix) else {
        return false;
    };
    let Some(label) = prefix.strip_suffix('.') else {
        return false;
    };

    !label.is_empty() && !label.contains('.')
}

fn parse_allowed_origins(value: &str) -> Result<Vec<AllowedOrigin>, String> {
    value
        .split(',')
        .map(AllowedOrigin::from_env_entry)
        .filter_map(Result::transpose)
        .collect()
}

pub fn validate_allowed_origins_config() -> Result<(), String> {
    let Ok(value) = std::env::var("VK_ALLOWED_ORIGINS") else {
        return Ok(());
    };

    parse_allowed_origins(&value).map(|_| ())
}

fn allowed_origins() -> &'static Vec<AllowedOrigin> {
    static ALLOWED: OnceLock<Vec<AllowedOrigin>> = OnceLock::new();
    ALLOWED.get_or_init(|| {
        let value = match std::env::var("VK_ALLOWED_ORIGINS") {
            Ok(value) => value,
            Err(_) => return Vec::new(),
        };

        parse_allowed_origins(&value)
            .expect("VK_ALLOWED_ORIGINS should have been validated at startup")
    })
}

#[cfg(test)]
mod tests {
    use axum::http::{Request, header};

    use super::*;

    fn make_request(origin: Option<&str>, host: Option<&str>) -> Request<Body> {
        let mut builder = Request::builder().uri("/test").method("GET");
        if let Some(origin) = origin {
            builder = builder.header(header::ORIGIN, origin);
        }
        if let Some(host) = host {
            builder = builder.header(header::HOST, host);
        }
        builder.body(Body::empty()).unwrap()
    }

    fn is_forbidden(result: Result<(), Response>) -> bool {
        matches!(result, Err(resp) if resp.status() == StatusCode::FORBIDDEN)
    }

    #[test]
    fn no_origin_header_allows_request() {
        let mut req = make_request(None, Some("example.com"));
        assert!(validate_origin(&mut req).is_ok());
    }

    #[test]
    fn null_origin_is_forbidden() {
        for null in ["null", "NULL", "Null"] {
            let mut req = make_request(Some(null), Some("example.com"));
            assert!(is_forbidden(validate_origin(&mut req)));
        }
    }

    #[test]
    fn same_origin_allows_request() {
        // HTTP, HTTPS, with port, case-insensitive
        let cases = [
            ("http://example.com", "example.com"),
            ("https://example.com", "example.com"),
            ("http://example.com:8080", "example.com:8080"),
            ("http://EXAMPLE.COM", "example.com"),
        ];
        for (origin, host) in cases {
            let mut req = make_request(Some(origin), Some(host));
            assert!(validate_origin(&mut req).is_ok(), "{origin} vs {host}");
        }
    }

    #[test]
    fn cross_origin_forbidden() {
        let cases = [
            ("http://unknown.com", "example.com"),         // different host
            ("http://example.com:8080", "example.com:80"), // different port
            ("ftp://example.com", "example.com"),          // non-http scheme
            ("not-a-valid-url", "example.com"),            // invalid URL
            ("http://example.com", ""),                    // missing host (invalid)
        ];
        for (origin, host) in cases {
            let host_opt = if host.is_empty() { None } else { Some(host) };
            let mut req = make_request(Some(origin), host_opt);
            assert!(is_forbidden(validate_origin(&mut req)), "{origin}");
        }
    }

    #[test]
    fn loopback_addresses_normalized_and_equivalent() {
        // All loopback forms normalize to "localhost"
        assert_eq!(
            OriginKey::from_origin("http://localhost:3000")
                .unwrap()
                .host,
            "localhost"
        );
        assert_eq!(
            OriginKey::from_origin("http://127.0.0.1:3000")
                .unwrap()
                .host,
            "localhost"
        );
        assert_eq!(
            OriginKey::from_origin("http://[::1]:3000").unwrap().host,
            "localhost"
        );

        // Cross-loopback requests should be allowed
        let mut req = make_request(Some("http://127.0.0.1:3000"), Some("[::1]:3000"));
        assert!(validate_origin(&mut req).is_ok());
    }

    #[test]
    fn default_ports_handled_correctly() {
        assert_eq!(
            OriginKey::from_origin("http://example.com").unwrap().port,
            80
        );
        assert_eq!(
            OriginKey::from_origin("https://example.com").unwrap().port,
            443
        );

        // Explicit default port matches implicit
        let mut req = make_request(Some("http://example.com:80"), Some("example.com"));
        assert!(validate_origin(&mut req).is_ok());
    }

    #[test]
    fn broad_wildcard_entries_are_rejected() {
        for origin in [
            "*",
            "https://*",
            "https://*.com",
            "https://example.*",
            "https://*.*.*",
            "https://foo..example.com",
        ] {
            assert!(AllowedOrigin::from_env_entry(origin).is_err(), "{origin}");
        }
    }

    #[test]
    fn exact_allowed_origin_entries_must_be_origins() {
        assert!(
            AllowedOrigin::from_env_entry("https://vk.example.com/")
                .unwrap()
                .is_some()
        );

        for origin in [
            "https://vk.example.com/path",
            "https://vk.example.com?preview=1",
            "https://vk.example.com#fragment",
            "https://user:password@vk.example.com",
        ] {
            assert!(AllowedOrigin::from_env_entry(origin).is_err(), "{origin}");
        }
    }

    #[test]
    fn wildcard_allowed_origin_entries_must_be_origins() {
        assert!(
            AllowedOrigin::from_env_entry("https://*.example.com/")
                .unwrap()
                .is_some()
        );

        for origin in [
            "https://*.example.com/path",
            "https://*.example.com?preview=1",
            "https://*.example.com#fragment",
            "https://user:password@*.example.com",
        ] {
            assert!(AllowedOrigin::from_env_entry(origin).is_err(), "{origin}");
        }
    }

    #[test]
    fn wildcard_subdomain_entry_matches_expected_hosts() {
        let allowed = AllowedOrigin::from_env_entry("https://*.mydomain.com")
            .unwrap()
            .unwrap();

        assert!(allowed.matches(&OriginKey::from_origin("https://api.mydomain.com").unwrap()));
        assert!(
            !allowed.matches(&OriginKey::from_origin("https://deep.api.mydomain.com").unwrap())
        );
        assert!(!allowed.matches(&OriginKey::from_origin("https://mydomain.com").unwrap()));
        assert!(!allowed.matches(&OriginKey::from_origin("https://api.mydomain.co").unwrap()));
        assert!(!allowed.matches(&OriginKey::from_origin("http://api.mydomain.com").unwrap()));
    }

    #[test]
    fn wildcard_entry_matches_with_explicit_port() {
        let allowed = AllowedOrigin::from_env_entry("https://*.mydomain.com:8443")
            .unwrap()
            .unwrap();

        assert!(
            allowed.matches(&OriginKey::from_origin("https://preview.mydomain.com:8443").unwrap())
        );
        assert!(!allowed.matches(&OriginKey::from_origin("https://preview.mydomain.com").unwrap()));
    }

    #[test]
    fn partial_and_nested_wildcard_entries_are_rejected() {
        for origin in [
            "https://port-*.example.com",
            "https://*foo.example.com",
            "https://foo.*.example.com",
            "https://*.*.example.com",
            "https://**.example.com",
            "https://*.bad-.example.com",
            "https://*.-bad.example.com",
        ] {
            assert!(AllowedOrigin::from_env_entry(origin).is_err(), "{origin}");
        }
    }

    #[test]
    fn parse_allowed_origins_rejects_invalid_entries() {
        let error =
            parse_allowed_origins("https://vk.example.com,https://port-*.example.com").unwrap_err();

        assert!(error.contains("https://port-*.example.com"));
    }

    #[test]
    fn parse_allowed_origins_allows_empty_entries_between_commas() {
        let origins =
            parse_allowed_origins("https://vk.example.com, ,https://*.example.com:8443").unwrap();

        assert_eq!(origins.len(), 2);
    }
}
