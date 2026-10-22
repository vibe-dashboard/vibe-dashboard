# Sending messages with a saved VK configuration

`vibe-agent send` and `vk send` use `OpenCode,Default,medium` by default. Set
`VIBE_AGENT_EXECUTOR_PROFILE` to select a saved VK agent/configuration and an
optional reasoning level:

```bash
export VIBE_AGENT_EXECUTOR_PROFILE="OpenCode,Default,medium"
vibe-agent send reviewer "Review the changes"

VIBE_AGENT_EXECUTOR_PROFILE="Codex,Default,high" vibe-agent send implementer "Implement the fix"

# Omit the third component to retain the saved configuration's reasoning:
VIBE_AGENT_EXECUTOR_PROFILE="OpenCode,Default" vibe-agent send reviewer "Review the changes"
```

The value must contain two or three nonempty comma-separated names:
`<agent>,<configuration>[,<reasoning>]`. Agent and configuration names are matched
case-insensitively against VK's saved configurations; spaces, hyphens, and
underscores are accepted when matching names. Unknown or ambiguous profiles fail
before any session changes. An unset or blank value uses `OpenCode,Default,medium`.

VK loads the saved configuration, including its model, prompt, command, and
environment settings. The optional third component requests a reasoning override
(for example `medium`, `high`, or `thinking`). It is matched case-insensitively
against the selected executor/model's advertised choices and sent as VK's canonical
`reasoning_id` only if supported. If support cannot be confirmed, the send retains
the saved reasoning setting and prints an explanation to stderr. Two-component
values always retain saved reasoning and skip capability discovery.

Successful capability lookups are cached for five minutes in
`~/.cache/vibe-agent/reasoning/`, scoped to the VK server, workspace, recipient session,
and preset. Changes to the selected/default preset or session working directory
invalidate the entry. Discovery uses the recipient session's working directory. Errors and
incomplete discovery are not cached; discovery waits at most five seconds.
The existing discovery API uses the default preset's command/environment, so an
override is conservatively skipped if the selected preset uses different command
or environment settings. No saved command/environment secrets are stored in the cache.
The current saved profile list is still fetched on every send to validate selection.

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

An existing recipient session is reused when its executor type matches, even
when the configuration changes. A different executor type creates a new session,
preserving the old session and history. The role mapping is updated only after VK
accepts the first message. A rejected first send leaves the previous mapping
intact. If role registration fails after acceptance, the output identifies the
accepted session/process (including `registration_error` with `--json`); do not
resend the accepted message. Every new session's first message preserves the
caller's message and appends:

> Use `vibe-agent full_summary` as a standalone command to catch up.

Both `docker-compose.yaml` and `docker-compose.qa.yaml` forward
`VIBE_AGENT_EXECUTOR_PROFILE`, with `OpenCode,Default,medium` as the deployment default.
Set it in the deployment environment (or Compose `.env`) and recreate the service
to apply a deployment-wide selection.
