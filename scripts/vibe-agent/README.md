# Sending messages with a saved VK configuration

`vibe-agent send` uses `OpenCode,Default` by default for every role. Set
`VIBE_AGENT_EXECUTOR_PROFILE` to select a different saved VK agent/configuration:

```bash
export VIBE_AGENT_EXECUTOR_PROFILE="OpenCode,Default"
vibe-agent send reviewer "Review the changes"

VIBE_AGENT_EXECUTOR_PROFILE="Codex,High" vibe-agent send implementer "Implement the fix"
```

The value must contain two nonempty comma-separated names. Names are matched
case-insensitively against VK's saved configurations; spaces, hyphens, and
underscores are accepted when matching names. Unknown or ambiguous names fail
before any session changes. An unset or blank value uses `OpenCode,Default`.

VK loads the complete saved configuration, including its model, reasoning,
prompt, command, and environment settings. Roles identify recipients and do not
choose profiles. `submit`, `review`, `help`, and delayed `request-review` use the
same send selection.

An existing recipient session is reused when its executor type matches, even
when the configuration changes. A different executor type creates and registers
a new session, preserving the old session and history. Every new session's first
message preserves the caller's message and appends:

> Use `vibe-agent full_summary` as a standalone command to catch up.

Both `docker-compose.yaml` and `docker-compose.qa.yaml` forward
`VIBE_AGENT_EXECUTOR_PROFILE`, with `OpenCode,Default` as the deployment default.
Set it in the deployment environment (or Compose `.env`) and recreate the service
to apply a deployment-wide selection.
