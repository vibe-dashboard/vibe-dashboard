# Codex usage-exhaustion evidence

Research for `vkvw-nc33`, performed read-only on 2026-10-23. **A verified structured
exhaustion fixture exists.** The evidence prerequisite for `vkvw-t3u5` is satisfied;
detection and alerts still require implementation and acceptance checks.

## Evidence and provenance

The fixtures under `scripts/vibe-agent/testing/fixtures/` contain decoded provider
notifications from VK's persisted `Stdout` stream, not authored examples or model
transcripts:

| Fixture | Source and finding |
| --- | --- |
| `codex-usage-limit.json` | Codex CLI 0.110.0; source process `a8633e83-d94f-4866-a7f1-bd55e25bcc79`, 2026-04-13. Legacy `codex/event/error` carries `msg.codex_error_info: usage_limit_exceeded`; modern `error` carries `error.codexErrorInfo: usageLimitExceeded`, `willRetry: false`. The terminal `turn/completed` repeats that error with turn status `failed`. |
| `codex-stream-disconnect.json` | Codex CLI 0.86.0; source process `e6d3c411-89ad-4bad-b922-a33a9ba0967e`, 2026-01-29. Structured stream-disconnection codes and `willRetry: true` are a real negative control, not evidence of exhaustion. |

Each fixture includes its original path relative to the VK data directory,
one-based source line numbers, original whole-file SHA-256, CLI version, VK process
state, and the redactions. Thread/turn IDs are consistently replaced; event field
names, discriminator values, messages, retry flags, nulls, and ordering are
preserved. Unrelated account, credentials, prompt, and tool records are omitted.
Resolve source paths beneath `$VK_DATA_DIR` (locally
`/home/vkuser/.local/share/vibe-kanban`). Multiple JSON notifications can occur in
one stored `Stdout` record; source line 21 of the positive case contains both
`task_complete` and `turn/completed`.

The positive case is recorded by VK as **completed, exit code 0**, despite the
provider turn failing. Status-only inspection of failed/killed processes misses
this case. `task_complete` alone is also not proof of successful work: its
`last_agent_message` is null and the same turn has the explicit exhaustion error.

Legacy and modern notifications refer to the same thread and turn. They are
mirrors, not separate exhaustion incidents; the terminal error is further evidence
of that same incident. Alert identity must correlate those observations rather
than hashing their different wire JSON or messages independently.

## Search coverage and limits

The completed scan joined the live SQLite database in `mode=ro` to identify
CODEX-owned processes and matched their persisted JSONL files. It searched
**21,287 completed/failed/killed process files (28,622,675,385 bytes)** for error
discriminator keys and explicit limit-code candidates. It then reconstructed the
newline-delimited JSON stream across `Stdout` chunks in 797 candidate files,
discarding prompt/tool references that were not actual error notifications.

Among the filtered records, 712 recognized error notifications included:

| Structured discriminator | Notification count |
| --- | ---: |
| `usage_limit_exceeded` | 17 |
| `usageLimitExceeded` | 69 |
| `responseStreamDisconnected` | 201 |
| `response_stream_disconnected` | 1 |
| `responseTooManyFailedAttempts` | 131 |
| `other` | 272 |
| `serverOverloaded` / `server_overloaded` | 19 |
| `unauthorized` | 2 |

These are notification counts, **not deduplicated incidents or affected users**.
The 86 exhaustion-coded error notifications also mentioned usage in their error
messages, but the structured code establishes classification. Nested terminal-turn
errors were not included in this histogram. One invalid outer JSONL line was
excluded. Live inventory grew during the investigation; counts describe that scan,
not an immutable snapshot or a claim about all possible Codex versions.

A separate candidate search across 20,379 Codex rollout files (86,344,195,195
bytes) found no qualifying native `event_msg` error record. References in prompts,
tool output, token telemetry, or copied source code are not provider errors. The
VK SQLite `execution_process_logs` table was empty; the evidence came from the
filesystem-backed process stream. Initial broad scans timed out and were not used
as negative evidence; the process scan above completed after chunk reconstruction
was made linear and irrelevant JSON records were filtered before decoding.

## Implementation handoff

Enable classification only for the verified structured usage discriminators at
their actual provider error locations. Normalize the two spellings into one
category while preserving process/session/workspace and provider thread/turn
identity. Deduplicate mirrored errors and terminal repeats for the same turn;
keep separate turns distinct. Do not require VK status `failed` or a nonzero exit.

`usedPercent`, token counts, generic HTTP 429, stream disconnection, retry
exhaustion, authentication failure, server overload, and guessed prose are not
usage-exhaustion evidence. The human-readable reset time in this fixture is not a
structured retry timestamp and must not be parsed into a guessed recovery timer.

Current `vibe-kanban/crates/executors/src/executors/codex/normalize_logs.rs` emits
`ErrorMessage { error_type: Other }` with `metadata: None` for both error paths.
The modern path keeps only the message; the legacy path formats debug error info
into content. The follow-up must preserve supported structured error provenance
through a typed/metadata transport boundary before VD can reliably classify it;
matching the normalized prose would discard the evidence guarantee.

`vkvw-t3u5` should use these fixtures to verify that one exhaustion turn produces
one durable rate-limited event and one retryable Discord-outbox alert containing
the `VK_ORIGIN` workspace URL. Cover restart/replay, dual notification formats,
terminal repeats, successful VK exit, and the real negative control. Any additional
error variant needs its own evidence before enabling classification. Research
does not itself enable alerts, change recovery policy, or authorize an automatic
continuation after a known exhausted turn.
