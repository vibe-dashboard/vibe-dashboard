# Durable serial workflows

A serial run snapshots a version-3 YAML template, its role message settings,
JSON Schemas, grouped Beads issues, and decision authority. Editing configuration
does not change an existing run. Only the orchestrator invokes workflow mutations.

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
