# Vibe Dashboard

A coding agent dashboard built on top of https://github.com/BloopAI/vibe-kanban and https://github.com/coder/code-server

## Quick start

1. Run `docker compose up`
2. Open http://localhost:3001 in your browser

A docker container will run the following:

- `vibe-kanban`
- `code-server`
- `caddy` as the main UI entrypoint

## Dynamic port forwarding

Caddy forwards `port-<port>.*` subdomains to `localhost:<port>` inside the container:

- `http://port-12345.localhost:3001`

## Configuration

### Local dev container (`docker-compose.yaml`)

#### Optional auth

| Variable | Default | Notes |
| --- | --- | --- |
| `CODE_PASSWORD` | empty | Optional. If set, `code-server` starts with password auth. If empty/unset, it starts with `--auth none`. |

#### Image/version

| Variable | Default | Notes |
| --- | --- | --- |
| `VKVD_IMAGE_VERSION` | `latest` | Fetches image from ghcr.io/vibe-dashboard/vk-vd:${VKVD_IMAGE_VERSION:-latest}. The compose file's pull policy is set to "always", so if you want to pin a specific version, use this arg. |

#### Ports

| Variable | Default | Notes |
| --- | --- | --- |
| `CADDY_PORT` | `3001` | Main Caddy entrypoint host port. |
| `BACKEND_PORT` | `3007` | Backend service port inside the container. Not published directly by compose. |
| `DASHBOARD_PORT` | `3005` | Dashboard service port inside the container. Not published directly by compose. |
| `CODE_PORT` | `3008` | `code-server` service port inside the container. Not published directly by compose. |

#### Optional auth/system

| Variable | Default | Notes |
| --- | --- | --- |
| `SUDO_PASSWORD` | empty | Optional sudo password in the container. |

#### Optional networking/integration

| Variable | Default | Notes |
| --- | --- | --- |
| `ENABLE_TAILSCALE` | `false` | Enables Tailscale startup. |
| `TAILSCALE_AUTHKEY` | empty | Tailscale auth key. |
| `TAILSCALE_HOSTNAME` | `vkdev` | Tailscale node hostname. |
| `VK_ALLOWED_ORIGINS` | empty | Optional backend CORS allowlist. |

#### Optional Vibe Kanban performance tracing / SigNoz

Tracing is disabled by default. To export Vibe Kanban performance spans from
the container to self-hosted SigNoz, set `VK_PERF_TRACING=1` and point the
sibling OpenTelemetry Collector at the SigNoz collector endpoint reachable from
this Docker network:

```bash
VK_PERF_TRACING=1
# VK and spawned Codex/tool processes use this Compose-local collector by default.
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
# Forward from the sibling collector to self-hosted SigNoz over OTLP/HTTP.
# Use the OTLP HTTP base endpoint; do not include /v1/traces here.
SIGNOZ_OTLP_HTTP_ENDPOINT=http://signoz-otel-collector:4318
OTEL_SERVICE_NAME=vibe-kanban-backend
OTEL_RESOURCE_ATTRIBUTES=service.version=local-compose
```

The `otel-collector` service listens internally on OTLP/HTTP `4318` and
OTLP/gRPC `4317`, batches spans, and forwards them over OTLP/HTTP. Set
`SIGNOZ_OTLP_HTTP_ENDPOINT` to the OTLP HTTP base endpoint, such as
`http://host:4318`; the collector exporter appends signal paths like
`/v1/traces`. In
Docker/Coolify, `localhost` and `127.0.0.1` refer to the current container, not
the SigNoz host/container, so use the SigNoz collector hostname or service URL
reachable from the `code-vibe` and `otel-collector` containers.

Direct OTEL overrides still work: set `OTEL_EXPORTER_OTLP_ENDPOINT` or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to bypass the sibling collector. For SigNoz
Cloud, `OTEL_EXPORTER_OTLP_HEADERS` may be needed for auth; it is usually
unnecessary for a local/self-hosted collector.
`VK_WS_POLL_TRACING=1` enables extra noisy WebSocket poll tracing and is not
normally needed.

#### Optional noVNC/Chromium sidecar

The browser sidecar is opt-in. Start it alongside the plugin with:

```bash
COMPOSE_PROFILES=novnc ENABLE_NOVNC_PLUGIN=true docker compose up
```

The noVNC UI and Chromium CDP ports are bound to localhost only. Chromium intentionally binds CDP to loopback inside the sidecar; the `novnc-cdp` bridge exposes it to the Compose network and localhost-published host port. Set `NOVNC_USER` and `NOVNC_PASSWORD` if you want browser UI auth.

Smoke-check CDP from the host and from `code-vibe`:

```bash
curl -fsS http://127.0.0.1:${NOVNC_CDP_PORT:-9223}/json/version
docker compose --profile novnc exec code-vibe curl -fsS http://novnc:9222/json/version
```

| Variable | Default | Notes |
| --- | --- | --- |
| `NOVNC_UI_PORT` | `3090` | Host localhost port for the noVNC web UI. |
| `NOVNC_CDP_PORT` | `9223` | Host localhost port for Chromium DevTools Protocol. |
| `NOVNC_USER` | empty | Optional noVNC UI username. |
| `NOVNC_PASSWORD` | empty | Optional noVNC UI password. |
| `NOVNC_IMAGE` | `lscr.io/linuxserver/chromium:latest` | Browser sidecar image. |


## GitHub auth

Run `gh auth login` once after first starting the container. Git is pre-configured to use `gh` as the credential helper, so no additional setup is needed.

Credentials and other per-instance XDG settings persist in the `user-config`
volume mounted at `/home/vkuser/.config`.

To set your Git identity (also persisted):

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Testing

Run type checks and unit tests:

```bash
npm run check-types
npm test
```

Run Playwright e2e tests:

```bash
npm run test:e2e:install
npm run test:e2e
```

If port `4173` is already in use locally, choose a different isolated e2e port:

```bash
E2E_PORT=4273 npm run test:e2e
```

## Codex auth

Codex caches credentials in `~/.codex/auth.json` when configured for file-based storage; this is persisted via the `codex-data` Docker volume mounted at `/home/vkuser/.codex`.

## Docker-in-Docker support

By default the workspace starts with the normal Docker runtime and does not require Docker-in-Docker. To run Docker inside the dev container, use a Sysbox-capable Docker host and start compose with `VKVD_CONTAINER_RUNTIME=sysbox-runc`. `docker-compose.yaml` persists the inner daemon at `/var/lib/docker` and keeps the host socket mount commented out.

If you need the host Docker socket fallback instead, edit `docker-compose.yaml` and toggle the two Docker volumes: comment out `docker-data:/var/lib/docker`, then uncomment `/var/run/docker.sock:/var/run/docker.sock`. This is easier to set up but not recommended because Docker volumes do not map correctly from inside the container and agents can control the outer Docker context.

Platform notes:

- Linux amd64/arm64: install Sysbox on the Docker host, then run `VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose up -d code-vibe`.
- Mac amd64/arm64: use the Colima Sysbox setup in `scripts/colima/README.md`, then run `VKVD_CONTAINER_RUNTIME=sysbox-runc DOCKER_CONTEXT=colima-vd-sysbox docker compose up -d code-vibe`.
- Docker Desktop Enhanced Container Isolation is a Docker Desktop Business feature. Prefer Colima for Mac Sysbox setup; if your environment intentionally uses ECI, verify Docker-in-Docker manually after startup.

Preflight before starting:

```bash
# Linux or Colima: verify Docker can see the Sysbox runtime.
docker info --format '{{json .Runtimes}}' | grep sysbox-runc

# Mac Colima: install and verify the Sysbox profile.
./scripts/colima/setup-sysbox.sh
./scripts/colima/check-sysbox.sh
```

Start and verify Docker-in-Docker:

```bash
VKVD_CONTAINER_RUNTIME=sysbox-runc docker compose up -d code-vibe
docker compose exec code-vibe docker info
docker compose exec code-vibe docker run --rm alpine:3.20 true
```

When `VKVD_CONTAINER_RUNTIME` is not `sysbox-runc`, the entrypoint logs that Docker-in-Docker is disabled and continues so non-Sysbox workspaces can still run.
