# Sending messages with a saved VK configuration

`vibe-agent send`, `vk send`, and automated follow-ups read the instance config:

```text
/var/lib/vd/instance-config/vibe-agent.json
```

```json
{
  "version": 1,
  "executorProfile": {
    "executor": "OpenCode",
    "variant": "Default",
    "reasoning": "medium"
  }
}
```

The executor profile is an object, not a comma-separated string. `executor` and
`variant` are required nonempty strings. They are matched case-insensitively
against VK's saved configurations; spaces, hyphens, and underscores are accepted
when matching names. `reasoning` is optional: omit it to retain the saved preset's
reasoning setting. For example:

```json
{
  "version": 1,
  "executorProfile": {
    "executor": "Codex",
    "variant": "Default"
  }
}
```

The config file is read for every outgoing message, including in long-running
server and nudge-daemon processes and when delayed callbacks/replies dispatch.
Edits apply to the next message without restarting or redeploying. Use an atomic
file replacement when updating it so sends do not observe partially written JSON.
An existing malformed/unreadable file or unsupported profile fails with a clear
error before sending; it does not silently select another agent.

Both main and QA deployments persist `/var/lib/vd` and seed this file from
`scripts/vibe-agent/vibe-agent.example.json` only if it does not exist. Existing
settings are retained on subsequent startups. Outside the container, a missing
file uses the same built-in default: OpenCode / Default with medium reasoning.
Executor selection has no environment-variable override.

VK continues to own the saved configuration's model, prompt, command, and
environment settings. Optional `reasoning` (for example `medium`, `high`, or
`thinking`) is matched case-insensitively against the selected executor/model's
advertised choices and sent as VK's canonical `reasoning_id` only if supported.
If support cannot be confirmed, the send retains saved reasoning and prints an
explanation to stderr. Omitting reasoning skips capability discovery entirely.

Successful capability lookups are cached for five minutes in
`~/.cache/vibe-agent/reasoning/`, scoped to the VK server, workspace, recipient
session, and preset. Changes to the selected/default preset or session working
directory invalidate the entry. Discovery uses the recipient session's working
directory. Errors and incomplete discovery are not cached; discovery waits at
most five seconds. Configuration-file contents are never cached.

The existing discovery API uses the default preset's command/environment, so an
override is conservatively skipped if the selected preset uses different command
or environment settings. No saved command/environment secrets are stored in the
cache. The current saved profile list is still fetched on every send to validate
selection.

Roles identify recipients and do not choose profiles. `submit`, `review`, `help`,
and delayed `request-review` use the same send selection.

`vk send <session-id> "<prompt>"` also honors this selection. A matching executor
reuses the supplied session. A different executor creates a replacement session
in the same workspace, preserves the old history, and includes the catch-up
instruction below. Its output identifies the actual recipient session; use that
new ID for subsequent sends. If the original session has a registered role, that
role moves to the replacement only after message acceptance. Unregistered
sessions do not acquire a role automatically.

Self-directed automation keeps its original target session: callback completions,
`--respond` replies, nudges, CI notifications, and hotswap resumes. When the
configured executor matches the target, these use the selected preset. When it
differs, they use the target executor's `DEFAULT` preset instead; configuration
names are never applied across executors. In both cases, an optional reasoning
override is checked against the actual target executor/model using the same cache.

For role-based sends, an existing recipient session is reused when its executor
matches, even when the preset changes. A different executor creates a new session,
preserving old history. The role mapping is updated only after VK accepts the first
message. A rejected first send leaves the previous mapping intact. If registration
fails after acceptance, output identifies the accepted session/process (including
`registration_error` with `--json`); do not resend the accepted message. Every new
session's first message preserves the caller's message and appends:

> Use `vibe-agent full_summary` as a standalone command to catch up.
