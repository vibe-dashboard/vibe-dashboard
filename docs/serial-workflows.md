# Durable serial workflows

A serial run snapshots a version-3 YAML template, its role message settings,
JSON Schemas, grouped Beads issues, and decision authority. Editing configuration
does not change an existing run. Only the orchestrator invokes workflow mutations.

## Configuration contracts

Coordinator checkpoints use strict version-2 YAML with `roles`, `prompts`,
`response_schemas`, `message_types`, `handlers`, and `outcome_handlers`. The
serial workflow CLI uses an explicit version-3 parser: the same messaging sections
plus `templates`. These entry points select different message contracts; neither
tries older configuration or completion-marker formats on validation failure.

For example, a serial configuration can define implementation and review turns:

```yaml
version: 3
roles:
  orchestrator: {can_emit_actions: [send_message]}
  impl: {can_emit_actions: []}
  reviewer: {can_emit_actions: []}
prompts:
  implement: {text: "Implement the grouped issues."}
  review: {text: "Review the implementation against the grouped issues."}
response_schemas:
  role_result:
    schema_id: vd.workflow.role-result
    schema_version: 1
    schema_file: schemas/role-result.schema.json
message_types:
  implement:
    from_role: orchestrator
    to_role: impl
    prompt_id: implement
    response_schema_id: role_result
    fresh: false
    allowed_actions: []
  review:
    from_role: orchestrator
    to_role: reviewer
    prompt_id: review
    response_schema_id: role_result
    fresh: false
    allowed_actions: []
handlers: {}
outcome_handlers: {}
templates:
  change:
    version: 1
    items:
      - id: implement
        label: Implement
        message_type: implement
        outcomes:
          complete: {action: advance}
          waiting: {action: wait}
      - id: review
        label: Review
        message_type: review
        outcomes:
          approved: {action: advance}
          changes_requested: {action: reset, resets_to: implement}
          waiting: {action: wait}
```

Schema files resolve relative to the configuration file. For this example,
`schemas/role-result.schema.json` contains:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["run_id", "item_id", "revision", "dispatch_id", "outcome", "details"],
  "properties": {
    "run_id": {"type": "string", "minLength": 1},
    "item_id": {"type": "string", "minLength": 1},
    "revision": {"type": "integer", "minimum": 1},
    "dispatch_id": {"type": "string", "minLength": 1},
    "outcome": {"type": "string", "minLength": 1},
    "details": {"type": "object"}
  }
}
```

The YAML spelling is `resets_to`; `resetsTo` is the normalized persisted runtime
field. Reset targets must name an earlier item. Outcomes select their configured
effects; they do not emit coordinator XML actions. Template version, role prompts,
and actual schema content/hash are captured when a run is created.

## Role results

Each dispatched message contains its full authoritative JSON Schema, schema
ID/version/hash, allowed outcomes and their effects, grouped bead IDs, and exact
correlation values. Return one JSON object, without prose, XML, or markdown fences:

```json
{"run_id":"run-id","item_id":"review","revision":2,"dispatch_id":"dispatch-id","outcome":"changes_requested","details":{"reason":"Explain the requested correction"}}
```

Use the exact values from the dispatched message. Outcome names are configured;
they do not imply behavior. A reset increments the revision and invalidates all
results from the target item onward. The actual accepted VK process is verified
separately; declaring a process identity in text cannot authorize advancement.

The auto-nudge overseer checkpoint is a different message contract. It uses the
schema-identified `auto-nudge-result` XML envelope containing JSON taught in that
checkpoint's prompt. A new teammate process or callback does not substitute for
the checkpoint envelope. Callback records still suppress duplicate sends while
work is active. `DONE`, `CREATED FORM`, prose and legacy action tags never complete
either contract.

For a coordinator checkpoint, use the exact schema metadata from its message in
the following shape (`SCHEMA_HASH_FROM_PROMPT` is a placeholder, not a literal
hash):

```xml
<auto-nudge-result schema_id="vd.auto-nudge.overseer-result" schema_version="1" schema_hash="SCHEMA_HASH_FROM_PROMPT" format="json">
{"outcome":"complete","actions":[]}
</auto-nudge-result>
```

The configured schema ID and version can differ from this default example. Copy
all three metadata values from the initiating checkpoint. Human-readable Markdown
may precede the single final envelope; nothing may follow it. Its JSON must pass
the authoritative schema and role/action permissions. Duplicate keys, unknown
fields/actions, and mismatched schema metadata are rejected. An invalid completed
checkpoint receives at most one schema-correction request, then remains visibly
invalid if the correction also fails. A valid `complete` applies to that trigger;
it does not permanently mark the workspace complete.

## Decisions and forms

An outcome mapped to `action: wait` pauses the current item. Put the question and
relevant context in `details`; the role result has the same shape regardless of
whether a human or a decision-maker will answer it.

The orchestrator persists a wait before attaching a generated Beads form to the
first grouped issue. It binds run, item, revision, dispatch and wait identity.
The form offers the configured non-wait outcomes and optional JSON result details.
Choose exactly one outcome. Submissions are checked against the original item's
result schema before they can advance or reset the run.

Human mode consumes saved `user` submissions from the Beads form boundary. In
decision-maker mode, the orchestrator sends the same decision to the snapshotted
session through durable identified dispatch. Only that accepted process's final
JSON response can answer it. Missing authority or invalid terminal decisions need
attention; there is no automatic human/agent fallback.

The decision-maker's response has **eight** fields, copied from its decision
message:

```json
{"run_id":"run-id","wait_id":"wait-id","form_id":"workflow_wait-id","item_id":"review","revision":2,"dispatch_id":"dispatch-id","outcome":"approved","details":{}}
```

Keep `wait_id` and `form_id` in this response. The orchestrator checks all wait
correlations, then removes only those two fields and validates the resulting
six-field ordinary role result against the original item schema. That schema's
`additionalProperties: false` applies to the projection, not to the eight-field
decision envelope. Choose a configured non-wait outcome and supply any required
`details`; do not copy an illustrative outcome blindly. No `actor` or process ID
field is accepted: authority comes from the saved human submission or exact
accepted decision process at the orchestration boundary. Late, stale, or duplicate
answers cannot advance a reissued wait or a later item/revision.

The daemon reconciles attachment, delivery and answers across restarts. To request
the same reconciliation explicitly:

```sh
vibe-agent workflow resume --run-id change-123 --expected-version 8 --idempotency-key inspect-answer-1
```

`resume` reads persisted evidence; it does not accept caller-supplied answer JSON
or an actor flag. It may leave the run waiting if no answer is available.

## Explicit authority updates

```sh
vibe-agent workflow update-authority --run-id change-123 \
  --authority decision_maker --decision-session SESSION_UUID \
  --reason "Delegate the pending decision" \
  --expected-version 8 --idempotency-key authority-change-1
```

Use `--authority human` to return to human decisions. The operation audits the
old/new authority, reason and invoking session. A pending wait receives a new form
and decision identity; answers to the old form/process are rejected. Reissuing
the same authority with an explicit reason can also recover an invalid form wait.
An already running old decision process is not silently cancelled; normal VK
admission still prevents overlapping turns.

## Messaging

`vibe-agent send` returns after VK accepts the work and its durable response route
is registered. `--respond` is an alias for the default routing behavior;
`--fire-and-forget` opts out. There is no response-lifetime timeout. Removed
`--timeout` and `--timeout-ms` flags produce migration guidance. Callback command
execution deadlines and the script-oriented `vk send --sync` interface retain
their separate semantics. If local route binding fails after acceptance, the CLI
reports the accepted process and route identity for reconciliation; do not resend.

The [sender correction/undo design](message-correction-and-undo.md) defines the
proposed explicit immediate/queued choice and queued-only mutation commands. Those
commands require the implementation's durable mutation fences; the current CLI
does not yet expose them.

## Automatic CI notifications

CI failures use identified queue delivery rather than direct follow-up. A busy
session retains the notification in its single queue slot; an unrelated occupied
slot produces a conflict rather than replacement. Webhook replay retains the same
notification queue identity, and a durable accepted process is reconciled exactly.

VD checks the identified reconciliation API before writing. Older VK versions may
return the web app for an unknown API path, so HTTP 200 alone is insufficient.
Missing or malformed support stops delivery with a matching-backend error; there
is no direct-send compatibility fallback. The matching VK backend must include
the atomic single-active-coding-agent migration. A source fix does not activate
that migration in an already running older backend.

## External issue integration design

The [bidirectional external-hook design](external-workflow-hooks.md) defines
proposed outgoing form/status events, incoming correlated decisions, durable
receipts, retries, and loop prevention. Provider integration is successor scope;
the current workflow configuration does not enable those proposed records.

## Codex usage evidence

[Codex usage-exhaustion research](codex-usage-evidence.md) records verified
structured error fixtures, a real transient-error negative control, and the
classification/deduplication contract. A matching VK backend exposes canonical
`usage_limit_events` on the exact terminal process REST result. The daemon records
durable `rate-limited` state for that process and pauses automatic checkpoint and
serial dispatch for its workspace while it remains the latest exhausted turn.
Automatic queued/response sends to the exhausted session are deferred. A later
process is evaluated independently; no reset time is guessed from the message.

With Discord enabled, each process/thread/turn event creates one durable outbox
item linking to `${VK_ORIGIN}/workspaces/<workspace-id>`. Delivery failures retry
through the existing outbox; delivered receipts suppress local replay. A missing
`VK_ORIGIN` is reported without discarding evidence and can be repaired before the
next cycle. Disabling Discord retains rate-limited evidence; enabling it later
can enqueue the alert. Dry-run does not persist evidence or send alerts. Neither
usage percentages nor VK exit status alone can establish exhaustion, and an older
backend without the evidence field does not enable detection. Discord's webhook
has no application idempotency receipt: a response lost after remote acceptance
can still cause a duplicate remote message on retry.
