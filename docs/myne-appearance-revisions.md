# @myne appearance snapshots and revisions

Status: **Milestone 3 contract (normative)**. “MUST”, “MUST NOT”, “SHOULD”, and
“MAY” have their RFC 2119 meanings. This document fixes persistence semantics;
the implementation and UI remain tracked separately.

## 1. Portable snapshot boundary

The canonical appearance payload is `MyneAppearanceSnapshotV1` in
[`appearanceSnapshot.ts`](../src/theme/skins/appearanceSnapshot.ts). It is a
complete, normalized value rather than a patch: skin state, selected composition
for each included surface, capability requirements, provenance, and optional
content-addressed asset descriptors. Snapshot, skin, composition-manifest, slot,
and revision versions are independent compatibility axes.

An importer MUST default-deny unknown fields, malformed IDs, unsupported known
capability versions, unsafe paths/media types, duplicate identities, and
non-canonical JSON. JSON is serialized using RFC 8785 property ordering and JSON
primitive representation after schema normalization. Semantically unordered
collections have a schema-defined stable sort. Timestamps are RFC 3339 UTC.
Asset descriptors use SRI `sha256`, `sha384`, or `sha512` integrity values; a
package reader MUST verify byte length and digest before making bytes available.
Assets MUST be package-relative, traversal-free, allowlisted resources. A
snapshot/package MUST NOT contain JavaScript, event handlers, executable URLs,
or an executable extension point. CSS is data and is accepted only through the
separate scoped compiler contract.

Canonical bytes are the input to snapshot content hashes, revision equality,
diffs, signatures, and reproducibility metadata. Provenance describes an export;
it never grants trust or authority. Import validation is all-or-nothing and
returns stable diagnostic codes plus paths. Unsupported data is never silently
dropped. Export MUST re-validate and produce canonical bytes.

## 2. Immutable revision record

The host owns an append-only revision log. A revision record MUST contain:

- an opaque, globally unique `revisionId` and stream/owner identity;
- `parentRevisionId` (absent only for genesis) and the expected previous head;
- the canonical snapshot bytes and their content digest;
- actor identity and source (`user`, `agent`, `import`, `restore`, `undo`, or
  `revert`) as audit metadata, never authorization;
- an RFC 3339 UTC commit time assigned by the persistence service; and
- an optional bounded, plain-text summary and the policy/compiler artifact
  versions required to reproduce activation.

The current v1 stream is `myne.appearance.global`, owned by the authenticated
local user. Every revision repeats that stream and owner identity and binds the
validated candidate source digest, artifact digest (or `null` for token-only
appearance), compiler version, and policy version into its immutable hash.

Committed records and referenced canonical bytes MUST be immutable. Editing or
deleting history in place is forbidden. Domain appearance state belongs to the
host revision service; editor selection, open panels, and unsaved drafts are
ephemeral controller state and are not revisions.

## 3. Atomic optimistic concurrency

Every mutating app, CLI, import, and agent operation MUST call the same
authorized append operation with `expectedCurrentRevisionId`. In one atomic
transaction the service validates authorization, package/schema/capabilities,
compiled artifact availability, and that the expected revision is still head;
then it appends the record and advances head. Validation or storage failure MUST
append nothing and MUST leave head unchanged.

A stale expectation returns a typed conflict containing the expected ID and the
current head ID. It MUST NOT retry, merge, or overwrite implicitly. Callers MAY
fetch the new snapshot, present a semantic diff, and submit a newly confirmed
operation against that head. Idempotency keys SHOULD make a repeated identical
request return the original result rather than append twice.

Compensating commands refresh and validate the persisted generation inside
their serialized operation before resolving default or explicit targets. The
subsequent append uses that same generation and storage CAS rejects any
intervening external writer.

## 4. Restore, undo, redo, and revert

History movement is always a new compensating revision:

- **restore** copies a selected historical snapshot onto the current head;
- **undo** restores the snapshot immediately before the target change;
- **redo** restores a previously undone snapshot, if the caller still selects it;
- **revert** records an explicitly chosen inverse/previous snapshot after diff
  and confirmation.

None changes a head pointer backwards or mutates old records. Each operation
uses current-head optimistic concurrency, the current validator/compiler, the
same authorization and confirmation policy as apply, and records its source and
target revision. If an old snapshot is no longer compatible, the service MUST
return diagnostics and preserve the current active/last-known-good appearance.

## 5. Retention, assets, and privacy

The active head, last-known-good revision, audit/legal holds, named restore
anchors, and every revision reachable within the configured undo window are
retention roots. Compaction MAY replace older contiguous history with a signed
checkpoint that preserves canonical snapshot, boundary parent/digest, actor
audit summary, and creation range; it MUST NOT make a retained restore target
refer to missing data. Retention configuration is host policy and MUST be
reported by app and CLI rather than inferred by clients.

Assets are immutable blobs addressed by verified digest. Garbage collection
MUST mark from all retained revisions, checkpoints, staged transactions, active
preview leases, and last-known-good artifacts before sweeping. Interrupted GC
or compaction MUST be restartable and MUST NOT invalidate a committed revision.

Snapshots and diffs are private user/workspace data by default. Export requires
the same read authorization as inspection and MUST omit host secrets, internal
paths, credentials, and unrelated actor metadata. Import provenance is
untrusted text. Agent writes require an explicit capability grant and traverse
the same preview, confirmation, concurrency, validation, and audit gates as user
writes.

The current v1 retention policy is deliberately narrower and lossless:
`retain-all`, an unbounded undo window, and disabled asset GC. The service and
CLI report this policy rather than implying that data was compacted. Its
checkpoint operation creates a verifiable **audit marker**, not compaction: it
retains every revision and records the boundary snapshot/digest, covered
creation range, source counts, and all revision/asset retention roots. Actual
history deletion and asset sweeping require a future policy version.

## 6. App/CLI parity and recovery

App and CLI MUST expose the same service semantics for inspect, canonical
snapshot, semantic diff, restore, undo, and revert. Machine-readable CLI output
uses stable result/diagnostic codes; human output may add explanation. Neither
client may directly write persistence or activate an unvalidated artifact.

Preview and activation reference the identical validated compiled artifact by
digest. The command service recompiles and validates the binding before CAS,
then commits the snapshot and compiler/policy activation metadata in the same
immutable revision. The browser publishes the already rendered retained
artifact only after the response echoes that binding; it does not recompile
after confirmation. Compile, validation, or persistence failure retains the
previous head and last-known-good artifact. Safe
mode ignores user appearance while preserving history for inspect/export and
recovery. Recovery actions are themselves authorized, concurrency-checked, and
audited.

## 7. Objective contract checks

The contract is satisfied only when automated tests prove canonical byte
stability, strict diagnostics, digest/asset verification, atomic stale-write
rejection, append-only compensating history, retention/GC roots, app/CLI parity,
and last-known-good/safe-mode recovery. Existence of this document alone does
not satisfy implementation beads.

Primary standards: [RFC 8785 JSON Canonicalization
Scheme](https://www.rfc-editor.org/rfc/rfc8785.html), [RFC 3339 timestamps](https://www.rfc-editor.org/rfc/rfc3339),
and [W3C Subresource Integrity](https://www.w3.org/TR/SRI/).
