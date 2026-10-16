# Self-hosting and operations

Start with the [root README](../README.md) if you are evaluating Vibe Dashboard.

## Start

```bash
docker compose up
```

Open <http://localhost:3001>. The container starts Vibe Dashboard, browser VS Code, agent
workspace services, and Caddy.

## Image and ports

| Variable | Default | Notes |
| --- | --- | --- |
| `VKVD_IMAGE_VERSION` | `latest` | `ghcr.io/vibe-dashboard/vk-vd` tag; pin a stable version in production. |
| `CADDY_PORT` | `3001` | Published main entry point. |
| `BACKEND_PORT` | `3007` | Internal backend port. |
| `DASHBOARD_PORT` | `3005` | Internal dashboard port. |
| `CODE_PORT` | `3008` | Internal browser VS Code port. |

Caddy forwards `port-<port>.*` to the matching container port; for example,
<http://port-12345.localhost:3001>.

## Authentication and persistence

| Variable | Default | Notes |
| --- | --- | --- |
| `CODE_PASSWORD` | empty | Enables browser VS Code password auth; otherwise `--auth none`. |
| `SUDO_PASSWORD` | empty | Optional container sudo password. |
| `VK_ALLOWED_ORIGINS` | empty | Optional backend CORS allowlist. |

Run `gh auth login` inside the container. Git uses `gh` as its credential helper. XDG config
persists in `user-config`; Codex file credentials persist in `codex-data`.

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Docker authority

The container mounts `/var/run/docker.sock`, so its processes can control host containers.
Use it only on trusted infrastructure or remove the mount. Sysbox work may change this boundary;
do not treat it as shipped until verified.

## Tailscale

| Variable | Default | Notes |
| --- | --- | --- |
| `ENABLE_TAILSCALE` | `false` | Enables Tailscale startup. |
| `TAILSCALE_AUTHKEY` | empty | Authentication key. |
| `TAILSCALE_HOSTNAME` | `vkdev` | Tailnet node name. |

Turnkey private wildcard routing remains in progress.

## OpenTelemetry and SigNoz

```bash
VK_PERF_TRACING=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
SIGNOZ_OTLP_HTTP_ENDPOINT=http://signoz-otel-collector:4318
OTEL_SERVICE_NAME=vibe-kanban-backend
OTEL_RESOURCE_ATTRIBUTES=service.version=local-compose
```

The collector listens internally on HTTP `4318` and gRPC `4317`. Give
`SIGNOZ_OTLP_HTTP_ENDPOINT` a reachable base URL without `/v1/traces`. Inside Docker,
`localhost` identifies the current container. Direct OTLP endpoint overrides remain supported;
SigNoz Cloud may require `OTEL_EXPORTER_OTLP_HEADERS`. `VK_WS_POLL_TRACING=1` enables noisy
WebSocket tracing.

## Optional noVNC browser

```bash
COMPOSE_PROFILES=novnc ENABLE_NOVNC_PLUGIN=true docker compose up
```

| Variable | Default | Notes |
| --- | --- | --- |
| `NOVNC_UI_PORT` | `3090` | Host-local noVNC port. |
| `NOVNC_CDP_PORT` | `9223` | Host-local Chromium CDP port. |
| `NOVNC_USER` | empty | Optional username. |
| `NOVNC_PASSWORD` | empty | Optional password. |
| `NOVNC_IMAGE` | `lscr.io/linuxserver/chromium:latest` | Sidecar image. |

```bash
curl -fsS http://127.0.0.1:${NOVNC_CDP_PORT:-9223}/json/version
docker compose --profile novnc exec code-vibe curl -fsS http://novnc:9222/json/version
```

## Verification

```bash
npm run check-types
npm test
npm run test:e2e:install
npm run test:e2e
```

Use `E2E_PORT=4273 npm run test:e2e` when `4173` is occupied. Push the branch to your remote
to run the full GitHub Actions suite.
