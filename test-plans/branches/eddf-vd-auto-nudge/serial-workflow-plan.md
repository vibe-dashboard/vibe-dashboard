# Serial workflow implementation

## Goal

Extend the validated auto-nudge transport foundation with one durable, serial
implementer → code reviewer → tester workflow. Rejection resets existing items
to a configured earlier item and increments the revision. A restart must neither
lose pending work nor duplicate an accepted turn.

Scope source: `vkvw-rjpj2`, processed `task-86i` forms, `task-m9b`, `task-d8z`.
The user authorized plan/review followed by implementation on 2026-10-22.

## Assumptions

Runtime state is local to the VD instance, using the existing persisted runtime
directory. One orchestrator is the transition writer; separate CLI invocations
still require a filesystem lock and expected-version checks. Runs snapshot form
authority. The user selected an explicit audited active-run authority update:
configuration edits alone never change active waits. An update records old/new
authority, reason, expected version and idempotency key; reissue any affected
decision request under a new wait identity and reject old submissions. An
unavailable configured decision-maker causes needs-attention, never fallback.

## Requirements

1. Auto-nudge selects serial runs from registered workspace goal/nudge context.
   A run records an explicit group of related bead IDs; no one-run-per-bead rule.
2. YAML templates have stable item IDs, roles, prompts, result contracts and
   outcome-specific `resets_to` references to earlier items. No phase taxonomy.
3. A run stores template ID/version/hash/full normalized snapshot, one current
   item, revision, state version, and append-only transition history.
4. Results bind run/item/revision/dispatch identity and schema identity. Only
   the current accepted dispatch may advance. Stale results never mutate state.
5. Rejection preserves history, increments revision, resets the target and all
   later items, and invalidates their prior approvals. Earlier completed items
   are explicitly carried forward in history. Retry cannot resend uncertain work.
6. Durable delivery intent precedes VK queue calls. Queue identity/owner/payload
   are stable. Occupied slots are preserved. Only proven unaccepted work may be
   recreated after VK's in-memory queue disappears. Accepted/uncertain intent
   reconciles by exact identity and cannot be blindly retried.
7. Forms bind run/item/revision/form/dispatch. Workspace configuration chooses
   human or one configured decision-maker session. Agents use the same task and
   result contract regardless of authority. Duplicate decisions cannot advance
   twice. Authority comes from the validated submission boundary, not payload text.
8. Bead metadata contains only run ID/status/revision/current ID+label, plus the
   latest 10 compact major transition events. Runtime owns operational identities.
9. Explicit interrupt reserves admission across stop/wait/start and conflicts
   with an occupied queue without replacing it. Unconfirmed termination stays
   needs-attention. Ordinary cancellation is not a recovery signal.

## Design

```mermaid
flowchart LR
  G[Registered workspace goal and grouped beads] --> O[Auto-nudge orchestrator]
  Y[YAML template snapshot] --> R[Atomic run state and transition journal]
  O --> R
  R --> D[Durable dispatch intent]
  D --> Q[VK owned single-slot queue]
  Q --> P[Exact accepted process]
  P --> V[Schema and dispatch-bound result validation]
  V --> R
  R --> B[Compact bead projection]
  R --> F[Correlated form wait]
  F --> A[Validated human or decision-maker submission]
  A --> R
```

Keep workflow runtime modules beside `scripts/vibe-agent/nudge/`. The existing
`packages/workflow-core` runs unrelated in-memory functions and lacks the required
durable state/turn identities; adapting it would add coupling without reuse.

### State and mutation boundary

Use one atomic JSON snapshot per run and a lock covering read/version-check/
transition/write. State contains the complete transition history and pending
projection events; a derived append-only JSONL journal is reconciled by sequence
number. The snapshot is authoritative if a crash occurs between writes. A
replayed idempotency key must match the original command payload before returning
its recorded result. Check idempotency before expected-version so a legitimate
retry can return after the original command advanced the version.

`workflow create/status/start/submit-result/retry/cancel` are narrow orchestrator
operations. Role agents return structured results; they do not edit run state.
CLI mutations require expected version and idempotency key. The daemon uses the
same mutation functions under its existing owner lock. Projection is a retryable
effect, not authority for completing a run.

Dispatch identity includes run/item/revision/attempt. Persist its exact queue
identity and payload before delivery. A retry after a *proven* pre-admission
failure allocates a new attempt; an uncertain attempt blocks retry. Completion
requires a result from the exact accepted process, not role name or timestamp.

Current VK `POST /sessions/:id/queue` only stores a slot; consumption occurs on
process finalization. It does not start a turn in an idle session. The dispatch
adapter therefore needs a reviewed VK idle-drain operation behind the same
atomic admission and durable queue-effect identity, or an equivalent identified
start operation. It must not work around this with a dummy predecessor turn or
an uncorrelated direct follow-up. Matching reserved/indeterminate effects stay
blocked; only an explicitly proven unaccepted identity permits recreation.

### Template and result example

The template section is a new config contract, not valid existing v2 YAML.
Introduce strict version 3 (v2 messaging configuration plus templates), without
switching the daemon's v2 default until the adapter migration is tested. Outcomes
declare their transition explicitly; names never imply behavior.
Each `message_type` below is declared in the same config's existing messaging
section and supplies its target role, prompt, and authoritative response schema.

```yaml
templates:
  reviewed_change:
    version: 1
    items:
      - id: implement
        label: Implement
        message_type: implement_change
        outcomes:
          complete: {action: advance}
          blocked: {action: needs_attention}
          waiting: {action: wait}
      - id: review
        label: Review
        message_type: review_change
        outcomes:
          approved: {action: advance}
          changes_requested: {action: reset, resets_to: implement}
          blocked: {action: needs_attention}
          waiting: {action: wait}
      - id: test
        label: Test
        message_type: test_change
        outcomes:
          passed: {action: advance}
          failed: {action: reset, resets_to: implement}
          blocked: {action: needs_attention}
          waiting: {action: wait}
```

Every dispatch teaches its role-specific authoritative schema ID/version/hash,
exact required correlation values, and an example. Ordinary prose and missing
final results cannot advance. A successful process exit without a valid result
becomes needs-attention. It does not authorize automatic continuation. The final
item's advance completes the run. The payload is exactly:

```json
{"run_id":"run-id","item_id":"review","revision":2,"dispatch_id":"dispatch-id","outcome":"changes_requested","details":{}}
```

The trusted source process ID is a separate adapter input, never agent-declared
authority. Validate schema ID/version/hash, source process and exact dispatch
before examining the outcome. States are queued, active, waiting,
needs_attention, cancelled and completed. Start persists an unaccepted dispatch;
acceptance binds its process. Only proven pre-admission failure permits a new
attempt. Accepted/uncertain dispatches refuse retry. Pure cancellation records
intent only when transport disposition remains unresolved; it cannot assert
that an external queue or child was cancelled.

### Forms and configuration changes

Persist the wait before attaching its form. Reconcile attachment by stable form
identity. Resume only with a trusted persisted submission from the configured
actor and matching correlation. Snapshot workspace authority at run creation;
changing it for an active run requires an explicit future audited operation.
Keep the same role prompt/result shape for human and decision-maker waits.
Per-run locks do not serialize different runs: daemon selection/dispatch also
requires a workspace lock and deterministic queued-run ordering. Journal replay
regenerates missing history suffixes; conflicting or ahead-of-snapshot entries
fail closed and never advance state.

## Build plan

1. Review this plan against production admission, queue and form boundaries.
2. Implement durable runtime and strict template/result validation first, with
   crash-recovery, version/idempotency, reset/revision and stale-result tests.
3. Integrate narrow CLI commands and daemon orchestration, then VK-owned queue
   delivery/reconciliation. Persist intent before I/O and exact acceptance before
   observing outcomes. Add serial workspace scheduling and bead projections.
4. Integrate correlated forms and authority snapshots. Add interrupt reservation
   at the VK boundary before exposing workflow interrupt.
5. Finish message-specific protocol onboarding (`task-m9b`) and remove the
   agent response-wait watcher (`task-8jf`) while preserving callback execution
   deadlines and separate script `vk send --sync` semantics.
6. Exercise matching real VK/VD in CI (`task-d8z`): full serial success, reviewer
   rejection, tester reset, stale approval rejection, queue loss/restart before
   and after acceptance, occupied-slot nonreplacement, form wait/restart/resume,
   duplicate decisions, and interrupt/callback races. Retain the current 14-test
   QA gate and aggregate/no-WebSocket coverage. Run focused checks per slice,
   type checks, implementation review and current-head remote gates.

## Concerns and expansions

VK abnormal-interruption recovery remains separately reviewed `task-yiu` work.
The workflow marks clean missing-result exits needs-attention; it must not add a
second recovery owner. Generic FIFO, role fan-out, rich correction CLI, external
provider adapters and a visual editor remain outside this serial slice.
