use std::fmt::Write;

use thiserror::Error;
use url::Url;

const MAX_URL_LEN: usize = 2_048;
const MAX_HOST_LEN: usize = 253;
const MAX_LABEL_LEN: usize = 63;

#[derive(Debug, Clone)]
pub struct ExternalPreviewTemplateContext<'a> {
    pub branch: &'a str,
    pub repo_slug: &'a str,
    pub repo_name: &'a str,
    pub workspace_token: &'a str,
    pub customer_slug: &'a str,
    pub project_slug: Option<&'a str>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ExternalPreviewTargetError {
    #[error("unknown or unavailable template variable: {0}")]
    UnknownVariable(String),
    #[error("malformed template")]
    MalformedTemplate,
    #[error("branch cannot be normalized to a DNS label")]
    EmptyBranchSlug,
    #[error("invalid project slug")]
    InvalidProjectSlug,
    #[error("invalid allowed host template")]
    InvalidAllowedHostTemplate,
    #[error("invalid destination URL")]
    InvalidUrl,
    #[error("destination URL must use HTTPS")]
    HttpsRequired,
    #[error("destination URL must not contain credentials, query parameters, or a fragment")]
    UnsupportedUrlComponent,
    #[error("destination URL may only use port 443")]
    InvalidPort,
    #[error("destination host does not match the allowed host")]
    HostMismatch,
    #[error("invalid destination host")]
    InvalidHost,
    #[error("destination URL is too long")]
    UrlTooLong,
}

pub fn expand_external_preview_target(
    url_template: &str,
    allowed_host_template: &str,
    context: &ExternalPreviewTemplateContext<'_>,
) -> Result<Url, ExternalPreviewTargetError> {
    validate_project_slug(context.project_slug)?;
    let branch_slug = branch_slug(context.branch)?;
    let allowed_host = expand_template(
        allowed_host_template,
        context,
        &branch_slug,
        TemplateKind::Host,
    )?;
    validate_host(&allowed_host)?;

    let expanded = expand_template(url_template, context, &branch_slug, TemplateKind::Url)?;
    if expanded.len() > MAX_URL_LEN {
        return Err(ExternalPreviewTargetError::UrlTooLong);
    }
    let url = Url::parse(&expanded).map_err(|_| ExternalPreviewTargetError::InvalidUrl)?;
    if url.scheme() != "https" {
        return Err(ExternalPreviewTargetError::HttpsRequired);
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ExternalPreviewTargetError::UnsupportedUrlComponent);
    }
    if url.port().is_some_and(|port| port != 443) {
        return Err(ExternalPreviewTargetError::InvalidPort);
    }
    let host = url
        .host_str()
        .ok_or(ExternalPreviewTargetError::InvalidHost)?;
    validate_host(host)?;
    if host != allowed_host {
        return Err(ExternalPreviewTargetError::HostMismatch);
    }
    if url.as_str().len() > MAX_URL_LEN {
        return Err(ExternalPreviewTargetError::UrlTooLong);
    }
    Ok(url)
}

#[derive(Clone, Copy)]
enum TemplateKind {
    Url,
    Host,
}

fn expand_template(
    template: &str,
    context: &ExternalPreviewTemplateContext<'_>,
    branch_slug: &str,
    kind: TemplateKind,
) -> Result<String, ExternalPreviewTargetError> {
    let mut output = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(open) = rest.find(['{', '}']) {
        output.push_str(&rest[..open]);
        if rest.as_bytes()[open] == b'}' {
            return Err(ExternalPreviewTargetError::MalformedTemplate);
        }
        let after_open = &rest[open + 1..];
        let close = after_open
            .find('}')
            .ok_or(ExternalPreviewTargetError::MalformedTemplate)?;
        let name = &after_open[..close];
        let value = template_value(name, context, branch_slug, kind)?;
        output.push_str(&value);
        rest = &after_open[close + 1..];
    }
    output.push_str(rest);

    if matches!(kind, TemplateKind::Host)
        && output.bytes().any(|byte| {
            !(byte.is_ascii_lowercase() || byte.is_ascii_digit() || b".-".contains(&byte))
        })
    {
        return Err(ExternalPreviewTargetError::InvalidAllowedHostTemplate);
    }
    Ok(output)
}

fn template_value(
    name: &str,
    context: &ExternalPreviewTemplateContext<'_>,
    branch_slug: &str,
    kind: TemplateKind,
) -> Result<String, ExternalPreviewTargetError> {
    let host_value = match name {
        "branchSlug" => Some(branch_slug),
        "repoSlug" => Some(context.repo_slug),
        "workspaceToken" => Some(context.workspace_token),
        "customerSlug" => Some(context.customer_slug),
        "projectSlug" => context.project_slug,
        _ => None,
    };
    if matches!(kind, TemplateKind::Host) {
        return host_value
            .map(str::to_string)
            .ok_or_else(|| ExternalPreviewTargetError::UnknownVariable(name.to_string()));
    }

    match name {
        "branch" => Ok(percent_encode_component(context.branch)),
        "repoName" => Ok(percent_encode_component(context.repo_name)),
        _ => host_value
            .map(str::to_string)
            .ok_or_else(|| ExternalPreviewTargetError::UnknownVariable(name.to_string())),
    }
}

fn percent_encode_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            encoded.push(char::from(byte));
        } else {
            write!(&mut encoded, "%{byte:02X}").expect("writing to String cannot fail");
        }
    }
    encoded
}

fn branch_slug(branch: &str) -> Result<String, ExternalPreviewTargetError> {
    let mut slug = String::with_capacity(branch.len().min(MAX_LABEL_LEN));
    let mut pending_dash = false;
    for byte in branch.bytes() {
        if byte.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() && slug.len() < MAX_LABEL_LEN {
                slug.push('-');
            }
            pending_dash = false;
            if slug.len() < MAX_LABEL_LEN {
                slug.push(char::from(byte.to_ascii_lowercase()));
            }
        } else {
            pending_dash = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        Err(ExternalPreviewTargetError::EmptyBranchSlug)
    } else {
        Ok(slug)
    }
}

fn validate_project_slug(project_slug: Option<&str>) -> Result<(), ExternalPreviewTargetError> {
    let Some(value) = project_slug else {
        return Ok(());
    };
    if value.is_empty()
        || value.len() > MAX_LABEL_LEN
        || value.starts_with('-')
        || value.ends_with('-')
        || value.contains("--")
        || value
            .bytes()
            .any(|byte| !(byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'))
    {
        return Err(ExternalPreviewTargetError::InvalidProjectSlug);
    }
    Ok(())
}

fn validate_host(host: &str) -> Result<(), ExternalPreviewTargetError> {
    if host.is_empty() || host.len() > MAX_HOST_LEN {
        return Err(ExternalPreviewTargetError::InvalidHost);
    }
    for label in host.split('.') {
        if label.is_empty()
            || label.len() > MAX_LABEL_LEN
            || label.starts_with('-')
            || label.ends_with('-')
            || label
                .bytes()
                .any(|byte| !(byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'))
        {
            return Err(ExternalPreviewTargetError::InvalidHost);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context<'a>(branch: &'a str) -> ExternalPreviewTemplateContext<'a> {
        ExternalPreviewTemplateContext {
            branch,
            repo_slug: "dashboard",
            repo_name: "Vibe Dashboard/Web",
            workspace_token: "0123456789abcdef",
            customer_slug: "acme-tools",
            project_slug: Some("dashboard"),
        }
    }

    #[test]
    fn expands_documented_provider_examples() {
        let cases = [
            (
                "https://{branchSlug}.{projectSlug}.pages.dev",
                "{branchSlug}.{projectSlug}.pages.dev",
                "https://feature-login.dashboard.pages.dev/",
            ),
            (
                "https://{projectSlug}-git-{branchSlug}.example-vercel-domain.com",
                "{projectSlug}-git-{branchSlug}.example-vercel-domain.com",
                "https://dashboard-git-feature-login.example-vercel-domain.com/",
            ),
            (
                "https://{branchSlug}--{projectSlug}.netlify.app",
                "{branchSlug}--{projectSlug}.netlify.app",
                "https://feature-login--dashboard.netlify.app/",
            ),
        ];
        for (url, host, expected) in cases {
            assert_eq!(
                expand_external_preview_target(url, host, &context("Feature/Login"))
                    .unwrap()
                    .as_str(),
                expected
            );
        }
    }

    #[test]
    fn percent_encodes_component_variables() {
        let result = expand_external_preview_target(
            "https://preview.example.com/{branch}/{repoName}",
            "preview.example.com",
            &context("feature/a b"),
        )
        .unwrap();
        assert_eq!(
            result.as_str(),
            "https://preview.example.com/feature%2Fa%20b/Vibe%20Dashboard%2FWeb"
        );
    }

    #[test]
    fn expands_every_fixed_identity_variable() {
        let result = expand_external_preview_target(
            "https://{workspaceToken}.{customerSlug}.example.com/{repoSlug}/{projectSlug}",
            "{workspaceToken}.{customerSlug}.example.com",
            &context("main"),
        )
        .unwrap();
        assert_eq!(
            result.as_str(),
            "https://0123456789abcdef.acme-tools.example.com/dashboard/dashboard"
        );
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_targets() {
        let cases = [
            ("http://preview.example.com", "preview.example.com"),
            ("https://user@preview.example.com", "preview.example.com"),
            ("https://preview.example.com?token=x", "preview.example.com"),
            ("https://preview.example.com/#frag", "preview.example.com"),
            ("https://preview.example.com:444", "preview.example.com"),
            ("https://evil.example.com", "preview.example.com"),
            ("https://{unknown}.example.com", "preview.example.com"),
            ("https://{branchSlug.example.com", "preview.example.com"),
            ("https://branchSlug}.example.com", "preview.example.com"),
            ("https://preview.example.com", "{branch}.example.com"),
            ("https://preview.example.com", "Preview.example.com"),
        ];
        for (url, host) in cases {
            assert!(
                expand_external_preview_target(url, host, &context("feature/login")).is_err(),
                "unexpectedly accepted {url} with {host}"
            );
        }
    }

    #[test]
    fn rejects_invalid_labels_and_lengths() {
        assert_eq!(
            expand_external_preview_target(
                "https://{branchSlug}.example.com",
                "{branchSlug}.example.com",
                &context("---"),
            ),
            Err(ExternalPreviewTargetError::EmptyBranchSlug)
        );
        assert!(
            expand_external_preview_target(
                &format!("https://preview.example.com/{}", "x".repeat(MAX_URL_LEN)),
                "preview.example.com",
                &context("main"),
            )
            .is_err()
        );
        assert!(
            expand_external_preview_target(
                "https://{projectSlug}.example.com",
                "{projectSlug}.example.com",
                &ExternalPreviewTemplateContext {
                    project_slug: Some("bad--slug"),
                    ..context("main")
                },
            )
            .is_err()
        );
    }
}
