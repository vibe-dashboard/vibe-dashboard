# Performance Tracing

Use the local server's structured tracing when investigating function-level,
HTTP-level, SQL query-level, or WebSocket send-path bottlenecks.

## Quick start

```bash
VK_PERF_TRACING=1 \
OTEL_EXPORTER_OTLP_ENDPOINT='http://localhost:4318' \
OTEL_SERVICE_NAME='vibe-kanban-backend' \
RUST_LOG=info \
pnpm run backend:dev:watch
```

`VK_PERF_TRACING=1` keeps the normal application log level, installs the HTTP
tracing middleware, and enables these additional span targets for the SigNoz
OTLP exporter:

- `perf.agent_startup=debug` for agent turn startup spans, including
  full workspace/session/execution IDs and Codex app-server/MCP startup timing;
- `tower_http=debug` for HTTP request spans and response latency;
- `sqlx::query=debug` for SQLx query timings;
- `server::middleware::signed_ws=trace` for signed/plain WebSocket upgrade,
  send, receive, flush, and close paths;
- `ws_bridge=trace` for proxied WebSocket bridge send paths.

Performance spans are not printed to stdout unless `RUST_LOG` explicitly asks
for those targets. For deeper targeted console diagnostics, add explicit module
directives:

```bash
VK_PERF_TRACING=1 \
RUST_LOG='server=trace,services=debug,db=debug,sqlx::query=debug,tower_http=debug,ws_bridge=trace' \
pnpm run backend:dev:watch
```

## Sending traces to SigNoz

Performance spans are exported to SigNoz through OpenTelemetry OTLP. Export is
opt-in and only starts when both `VK_PERF_TRACING=1` and an OTLP endpoint are
configured. Sentry remains available for errors/breadcrumbs, but performance
traces should go to SigNoz.

The stdout formatter and SigNoz exporter use separate filters: `RUST_LOG=info`
keeps console output quiet, while the SigNoz layer still receives the
performance span targets listed above.

For SigNoz Cloud, use the regional ingest endpoint and ingestion key:

```bash
VK_PERF_TRACING=1 \
OTEL_EXPORTER_OTLP_ENDPOINT='https://ingest.<region>.signoz.cloud:443' \
OTEL_EXPORTER_OTLP_HEADERS='signoz-ingestion-key=<your-ingestion-key>' \
OTEL_SERVICE_NAME='vibe-kanban-backend' \
OTEL_RESOURCE_ATTRIBUTES="service.version=$(git rev-parse --short HEAD)" \
RUST_LOG=info \
pnpm run backend:dev:watch
```

For a local/self-hosted SigNoz OpenTelemetry Collector using OTLP/HTTP:

```bash
VK_PERF_TRACING=1 \
OTEL_EXPORTER_OTLP_ENDPOINT='http://localhost:4318' \
OTEL_SERVICE_NAME='vibe-kanban-backend' \
RUST_LOG=info \
pnpm run backend:dev:watch
```

For Docker/Coolify deployments, `localhost` and `127.0.0.1` refer to the Vibe
Kanban container itself, not the SigNoz host/container. Use the SigNoz collector
hostname or service URL that is reachable from the VK container.

Use `http://` or `https://` endpoints. `OTEL_EXPORTER_OTLP_ENDPOINT` is treated
as the collector base URL and VK appends `/v1/traces` for OTLP/HTTP. Set
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` only when traces need a different full
trace URL from other OTLP signals. If an endpoint is blank or malformed, VK logs
a startup warning and does not silently fall back to the SDK default localhost
collector.

The desktop app runs the local backend in the same process; when
`VK_PERF_TRACING=1`, the desktop process installs the same performance filter
directives and SigNoz OTLP tracing layer.

### SigNoz smoke-test checklist

For a profiling run that sends data to SigNoz:

1. Start the backend with `VK_PERF_TRACING=1`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
   and `OTEL_SERVICE_NAME`.
2. Load a session in the browser and wait for the spinner to resolve.
3. Trigger or observe an agent message stream.
4. In SigNoz, refresh the Services page and open the configured service.
5. In Traces, confirm spans are present for session load or message streaming,
   such as `http.request`, `sessions.find_by_workspace_id`,
   `events.stream_execution_processes.initial_snapshot`,
   `normalized_logs.*`, `agent.turn`, `codex.spawn_app_server`,
   `codex.mcp_startup`, and `ws.send`.
6. Confirm HTTP span data uses route templates rather than raw query strings or
   full request URIs.

## Mobile web freeze diagnostics

Frontend mobile freeze diagnostics are disabled by default and do not send
network telemetry. They write safe metadata only to `console.debug` and to an
in-memory ring buffer on `window.__VK_MOBILE_PERF_DIAGNOSTICS__`.

Enable before starting the web app:

```bash
VITE_VK_MOBILE_PERF_DIAGNOSTICS=1 pnpm run local-web:dev
```

Or enable at runtime from the browser console, then reload if you want startup
and page-lifecycle events too:

```js
window.__VK_MOBILE_PERF_DIAGNOSTICS__?.enable();
```

Inspect recent events:

```js
window.__VK_MOBILE_PERF_DIAGNOSTICS__?.snapshot();
```

Disable runtime diagnostics:

```js
window.__VK_MOBILE_PERF_DIAGNOSTICS__?.disable();
```

The diagnostics capture long tasks, event-loop stalls, memory snapshots when
browser APIs allow it, page visibility/pagehide/pageshow/freeze/resume events,
mobile viewport and keyboard-related resize signals, WebSocket patch/log batch
sizes, conversation timeline/virtualizer update counts, scroll metrics, and
composer input/send sizes. Prompt text, message bodies, log contents, secrets,
and file contents are intentionally not recorded.

## WebSocket notes

HTTP tracing records the upgrade request/response only. After a connection is
upgraded, WebSocket sends and receives no longer pass through HTTP middleware,
so the server instruments those paths explicitly. Look for spans/events named:

- `ws.upgrade`
- `ws.send`
- `ws.recv`
- `ws.bridge.send`

Message logs include the message kind, byte length, and whether a close frame
was present. Payload contents are intentionally not logged.

## Agent startup notes

Agent startup tracing is intentionally grouped under low-cardinality span names
so SigNoz can aggregate runs cleanly while still exposing concrete IDs as span
attributes. Look for:

- `agent.turn`: follow-up or queued-message submission to process startup;
- `agent.turn.start_execution_inner`: local execution setup, including the
  full `workspace_id`, `session_id`, and `execution_process_id`;
- `agent.turn.executor_spawn`: the executor-specific child process spawn wait;
- `codex.spawn_app_server`: Codex app-server setup in the background task;
- `codex.rpc.initialize`, `codex.get_account`, `codex.thread_start`,
  `codex.thread_fork`, `codex.turn_start`: the Codex RPC startup sequence;
- `codex.mcp_startup`: collective MCP startup timing. This span records
  server counts, update counts, ready/failed/cancelled server names, and emits
  `codex.mcp_startup.update` events for per-server status changes. Error text
  is not recorded; only error lengths are included to avoid leaking secrets.
- `codex.mcp_server_startup`: per-server MCP startup spans, keyed by
  `mcp_server`, with final `mcp_status` and `elapsed_ms` when Codex emits both
  starting and terminal updates for that server.

First model-configuration and output milestones are recorded as
`codex.session_configured`, `codex.first_reasoning_delta`, and
`codex.first_message_delta` events on the same trace. These help separate time
to show the model/reasoning-effort banner from time to first model output.

Low-level sink polling events such as `ws.sink.start_send`,
`ws.sink.poll_ready`, and `ws.sink.poll_flush` are intentionally gated behind an
additional flag because they can be very noisy:

```bash
VK_PERF_TRACING=1 VK_WS_POLL_TRACING=1 RUST_LOG=info pnpm run backend:dev:watch
```

## SQL query notes

SQLx query logs are emitted by SQLx itself under the `sqlx::query` target. Keep
this at `debug` while profiling and avoid leaving very verbose tracing enabled
in normal development sessions unless you need the data.
