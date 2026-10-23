# Encoded preview host routing

Vibe Dashboard preview hosts use a first-level encoded hostname so Cloudflare TLS
and wildcard routing only need to cover `*.vibedashboard.dev`:

```text
{slotSlug}-{repoSlug}-{workspaceToken}--{customerSlug}.vibedashboard.dev
```

Example:

```text
web-vibekanban-0123456789abcdef--mick-mister.vibedashboard.dev
```

The encoded data must fit in the first DNS label, so V1 uses fixed separators,
dashless routing slugs, and a separately delimited customer slug:

- `slotSlug`: 1–10 lowercase alphanumeric characters.
- `repoSlug`: 1–18 lowercase alphanumeric characters.
- `workspaceToken`: exactly 16 lowercase hexadecimal characters (`[a-f0-9]{16}`).
- `customerSlug`: 1–16 lowercase alphanumeric characters or internal single
  dashes; leading, trailing, and consecutive dashes are rejected. PreviewServer UI
  callers do not expose this value; URL generation uses
  `PREVIEW_URL_DEFAULT_CUSTOMER` unless CLI/API automation passes an override.

Customer omission is an input convenience, not a second hostname form: URL
generation substitutes `PREVIEW_URL_DEFAULT_CUSTOMER`. If neither an explicit
customer nor that default exists, generation fails. A hostname without the
double-dash customer suffix is never a Preview URL.

Each component keeps its independent limit, but the complete first label must
remain within DNS's 63-character limit. Therefore not every combination of
maximum-length components is valid. Old single-delimiter and
`preview-{workspace}-{slot}--{customer}` numeric hosts are
intentionally rejected; this branch is a hard break with no backwards
compatibility for numeric slots.
Resolver routing does not configure or compare a base domain. The strict first
label is recognized under any non-empty parent domain. Base-domain selection is
still required when generating a public URL, but it is separate from routing.

This compact first-label pattern is reserved wherever the resolver is deployed.
Customer hostnames that merely contain dashes are not preview hosts unless the
first label satisfies the full `slotSlug-repoSlug-workspaceToken--customerSlug`
grammar.

For one migration window, the Caddyfile adapter accepts a legacy `base_domain`
option but ignores it, and accepts an existing configuration without `routing`.
Generated and deployed configurations no longer emit `base_domain` and do emit
`routing domain-independent-v1`, which is the new-binary capability gate. This
supports deploying the binary before the configuration without a routing gap.

## Runtime request flow

1. The public Cloudflare Worker receives the encoded preview host.
2. The Worker resolves the customer part to the canonical customer hostname and
   forwards traffic through the customer tunnel.
3. The Worker preserves the original encoded hostname in `X-Vibe-Requested-Host`
   for the private-sandbox V1 deployment.
4. The custom Caddy `vk_preview_resolver` handler reads the requested hostname
   from `X-Vibe-Requested-Host` when present. Otherwise, it ignores generic
   forwarded host headers and uses the actual request `Host`.
5. If the hostname matches the preview syntax, Caddy calls the local resolver API.
6. The resolver returns `ready` with an upstream, `starting`, `not_found`,
   `capacity_full`, or `failed`/`unavailable`.
7. Caddy proxies ready traffic or serves a generated Preview starting,
   not-found, capacity, or failure response.

Preview starting pages auto-refresh for browser navigations. If the resolver
returns `ready` but the upstream has not begun accepting connections yet, Caddy
treats that first-hit dial failure as the same expected startup race and serves
the generated Preview starting page instead of a raw Bad Gateway. When VK has an
authoritative preview process link, starting and process-failure pages include
an **Open logs in VD** action. The link carries the workspace and preview-slot
identities, never a client-selected process ID. VD reloads the latest
server-side process link for that slot and does not fetch raw logs until the user
explicitly clicks **Logs**.

Generic `port-*` routes are intentionally different: opening a port URL does not
start a process. If nothing is listening on that port, Caddy returns plain
no-listener copy and does not auto-refresh by default.

## Run-config audit actor limitations

Preview run-config, slot, start, stop, reuse, and capacity-eviction operations
write rows to `run_config_audit_events`. In V1 every route-generated row records
the literal actor `backend`; the server does not derive a user, service account,
API token, role, source address, or trusted proxy identity.

Consequences:

- `actor = backend` means only that the backend wrote the row. It does not
  identify the person or client that caused the operation.
- A caller that can successfully invoke a PreviewServer route can cause a
  `backend` event. The actor column therefore cannot support attribution,
  non-repudiation, per-user review, or role enforcement.
- The backend ignores caller-supplied actor headers or fields, so clients cannot
  choose the stored actor string. This prevents direct actor-name spoofing but
  does not solve caller attribution.
- Event type and linked workspace/repo/config/slot/process IDs are useful for
  best-effort operational chronology. They are not an authentication or
  security-audit boundary. Foreign-key cleanup may also set linked IDs to null
  after the referenced record is deleted.

Operators should correlate these rows with access-proxy and application logs
when investigating V1 activity. When PreviewServer API authentication and roles
are implemented, replace the fixed actor with a server-verified principal and
record the authentication mechanism/role needed to interpret that identity.
Existing `backend` rows must remain distinguishable as legacy unattributed
events rather than being retroactively assigned to a user.

## Run-config environment boundary

V1 run-config processes use the common script executor. The executor adds
`VK_WORKSPACE_ID`, `VK_WORKSPACE_BRANCH`, `VK_SESSION_ID`, and the assigned
`PORT`, but it does **not** clear the parent process environment. Run configs
therefore inherit every environment variable visible to VK. Treat stored run
config commands as trusted workspace administration, not as an isolation
boundary for untrusted repository code.

Do not describe V1 as having a sanitized environment allowlist. In particular,
an inherited token, credential, proxy setting, or integration secret may be
read by the started process even when it is unrelated to that preview. This is
accepted temporarily for compatibility with existing package managers and
toolchains; it is not the production security target.

The production change should clear the parent environment for PreviewServer
processes and rebuild it from these groups:

- Runtime identity supplied by VK: `PORT`, `VK_WORKSPACE_ID`,
  `VK_WORKSPACE_BRANCH`, and `VK_SESSION_ID`.
- Basic process execution: `PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`, locale
  variables (`LANG`, `LC_*`), and `TERM` where required.
- Explicit non-secret tool configuration needed by the shipped image, including
  narrowly reviewed Node/npm/pnpm/yarn, uv/Python, and Rust/Cargo home/cache
  paths. Prefix-wide inheritance such as every `NPM_CONFIG_*`, `YARN_*`,
  `UV_*`, or `CARGO_*` variable is not an allowlist because those namespaces
  can contain registry credentials and tokens.
- Secrets selected for that run config and injected by the future VarDash
  integration. Secrets must not enter through a checked-in run-config command
  or a blanket copy of the VK environment.

Before enabling environment clearing, inventory the actual variables required
by `Dockerfile.vkvd` and test npm, pnpm, yarn, uv, Python, Cargo, and Rust startup
inside the production image. Authentication variables for GitHub, Jira, Linear,
Sentry, package registries, cloud providers, coding agents, and databases are
excluded unless explicitly attached to that run config. The cutover belongs
with first-class secret injection so compatibility does not require restoring
blanket inheritance.

## Authentication and shared-secret cutover

V1 has no PreviewServer-specific API authentication. The private sandbox relies
on Cloudflare Access plus the existing VK/VD server-trust model. Workspace and
process-link checks prevent selecting another workspace's process, but they do
not identify the caller or replace authentication. The custom
`X-Vibe-Requested-Host` header is likewise accepted without cryptographic
attestation in V1.

Production hardening needs two separate trust boundaries; one secret must not
be reused for both:

1. **Worker to Caddy.** The Worker strips any inbound
   `X-Vibe-Requested-Host` and attestation header, sets the canonical requested
   host itself, and adds a deployment-managed secret. Caddy ignores the custom
   requested-host header unless that secret matches. Direct requests continue
   to route only from their actual `Host`. Caddy removes the attestation header
   before proxying to preview applications.
2. **Caddy to VD resolver.** Caddy authenticates calls to the local
   `/internal/preview/resolve` endpoint with a different deployment-managed
   secret. VD rejects missing or mismatched credentials before parsing or
   resolving a host. This credential is server-to-server and is never emitted
   into the generated starting page or browser JavaScript.

Secret configuration should support a runtime file path, with an environment
value only as a deployment fallback. Files must be read at startup with
owner-only permissions, never logged, and compared in constant time. Enabling
the trusted requested-host path must fail closed when its secret is absent;
silently falling back to unauthenticated header trust would preserve the V1
hole under a production-looking configuration.

The remaining browser-facing `/internal/preview/workspaces/...` management and
log routes should use the application's eventual authenticated principal and
workspace authorization, not expose either shared secret to the browser. Their
authentication cutover must happen with the application auth/role foundation
so audit rows can record the same verified principal. Until that foundation
exists, keep these routes inside the Access-protected sandbox and do not claim
the deployment is suitable for an untrusted public origin.

## Hard-break compatibility contract

The named-host shape is the only supported Preview URL contract for this branch.
Backend and Worker code must be deployed with the same grammar:

- Caddy no longer sends `workspaceId`, numeric `slot`, or `customer`.
- The resolver must map `workspaceToken` to the durable VK workspace ID.
- `repoSlug` and `slotSlug` are lookup slugs for the repo-level run config and
  preview slot; they are not database IDs.
- `customerSlug` is the customer alias used by the Worker/control plane to find
  the canonical customer runtime. Normal VD usage reads it from
  `PREVIEW_URL_DEFAULT_CUSTOMER`; explicit CLI/API overrides remain available
  for automation.
- The Worker must parse or preserve the full encoded preview host, route it to
  the matching canonical customer runtime, and forward the original host in
  `X-Vibe-Requested-Host`. V1 intentionally does not use a requested-host
  shared secret because the deployment is limited to the private/Cloudflare
  Access-protected sandbox. The proper per-customer/runtime secret model is
  tracked separately.

## Resolver API

`vk_preview_resolver` sends a local-only JSON POST to the configured
`resolver_url`:

```json
{
  "host": "web-vibekanban-0123456789abcdef--mick-mister.vibedashboard.dev",
  "workspaceToken": "0123456789abcdef",
  "repoSlug": "vibekanban",
  "slotSlug": "web",
  "customerSlug": "mick-mister",
  "ensure": true,
  "method": "GET",
  "path": "/"
}
```

`ensure` is only true for page-load navigations: `GET`, not a protocol upgrade,
and `Sec-Fetch-Mode: navigate` or `Sec-Fetch-Dest: document`. Asset, API, and
WebSocket requests do not start preview servers by themselves.

Expected response:

```json
{ "status": "ready", "upstream": "http://127.0.0.1:4567" }
```

Other statuses:

- `starting`: render a generated auto-refresh Preview starting page for navigations, plain 503 for non-document requests.
- `not_found`: 404.
- `capacity_full`: 503.
- `failed`, `unavailable`, `error`: 502.

The resolver owns workspace validation, preview process state, max-running-server
capacity, and eviction policy. The Caddy module owns request parsing and proxying.

Log authorization is narrower than ordinary workspace process access: VD first
requires the requested execution process to appear in VK's latest
`preview_process_link` data for the requested workspace, then verifies the
process session belongs to that workspace. Missing or unrelated associations return
a readable not-found state without opening the raw-log WebSocket.

When proxying a ready preview upstream, Caddy forwards preview metadata headers:

- `X-Vibe-Requested-Host`
- `X-Vibe-Preview-Workspace-Token`
- `X-Vibe-Preview-Repo`
- `X-Vibe-Preview-Slot`
- `X-Vibe-Preview-Customer`

Before setting those canonical metadata headers, Caddy removes inbound
`Forwarded`, `X-Forwarded-Host`, `X-Vibe-Requested-Host`, and
`X-Vibe-Preview-*` headers so preview apps cannot receive spoofed preview
metadata from clients.

## Requested-host header trust model

Direct clients can set arbitrary `X-Forwarded-Host` or `X-Vibe-Requested-Host`
headers. For V1, Preview URLs are limited to the private/Cloudflare
Access-protected sandbox, so Caddy accepts `X-Vibe-Requested-Host` as the Worker
preserved-host signal and still ignores generic `X-Forwarded-Host`.

Release guard: do not deploy this no-secret requested-host mode on a public or
direct-origin path. The customer runtime/Caddy ingress must be reachable only
through the private/Cloudflare Access-protected sandbox routing boundary until
`vkvw-murh — Design proper per-customer Preview URL secret seeding` (or an
equivalent platform attestation design) is implemented. If a deployment can
receive public direct-origin traffic, requested-host trust must be disabled or
replaced with stronger attestation before release.

Worker request to Caddy:

- `X-Vibe-Requested-Host: {slotSlug}-{repoSlug}-{workspaceToken}--{customerSlug}.vibedashboard.dev`

Advanced deployments may override the requested-host header name with
`PREVIEW_REQUESTED_HOST_HEADER` or the equivalent Caddyfile option
`trusted_requested_host_header`.
