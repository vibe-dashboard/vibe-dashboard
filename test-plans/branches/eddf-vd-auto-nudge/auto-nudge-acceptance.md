# Auto-nudge acceptance

## Runtime contract

- Enable workspace coordination with `vibe-agent auto-nudge enable`.
- The daemon reads `auto_nudge_workflow.yaml` from the runtime data config directory and auto-creates it with `schemas/overseer-result.schema.json` when absent.
- `VD_AUTO_NUDGE_POLL_INTERVAL_SECONDS` defaults to 300 and accepts integer values from 5 through 3600.
- Only registered workspaces are scanned by VD. Premature-turn recovery belongs to VK; VD does not scan or message historical unregistered sessions.
- Every daemon send path observes the shared active-session/once-per-cycle guard.

## Structured checkpoint result

The checkpoint prompt states the schema ID, version, canonical SHA-256 hash, authoritative schema path, and an example. Human Markdown may precede one final block:

```xml
<auto-nudge-result schema_id="vd.auto-nudge.overseer-result" schema_version="1" schema_hash="sha256:..." format="json">
{"outcome":"complete","actions":[]}
</auto-nudge-result>
```

Acceptance checks:

- exact ID/version/hash validation occurs before effects;
- JSON duplicate keys, unknown fields, unsupported actions, malformed metadata, and legacy marker text execute no effects;
- `outcome: complete` closes only the current trigger;
- one correction is attempted for an invalid completed checkpoint, then state becomes `invalid-response` for manual recovery;
- baton-pass detection still wins when a new teammate process exists;
- inline and beads-directory-confined artifact `create_form` actions are validated before attachment and retry idempotently;
- configured outcome handlers use the existing argv/no-shell handler boundary and deduplicate by trigger/outcome/handler;
- handler failure remains visible and does not enqueue later message actions.

## Validation commands

```bash
pnpm vitest --run --config vitest.server.config.ts \
  scripts/vibe-agent/nudge \
  scripts/vibe-agent/testing/auto-nudge.transport.test.ts \
  scripts/vibe-agent/testing/auto-nudge.process.test.ts
npm run check-types
npm run build:vibe-agent-cli
npm run test:vibe-agent:process
npm run test:e2e:vk-mocked-sandbox -- tests/e2e/features/auto-nudge/auto-nudge-vk-compat.spec.ts
git diff --check
```
