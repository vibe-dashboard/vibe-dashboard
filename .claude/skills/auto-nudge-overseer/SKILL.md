---
name: auto-nudge-overseer
description: Use when a user asks an overseer agent to complete all milestones, keep going until done, or coordinate a multi-agent milestone workflow that should be monitored for dropped turns.
---

# Auto-nudge overseer

When the user asks you to complete all milestones, keep going until done, or otherwise act as the coordinating overseer for a workspace:

1. Run:
   ```bash
   vibe-agent auto-nudge enable
   ```
   This registers the current workspace for auto-nudge overseer coordination and makes your current session the overseer.
   If the user gave completion criteria, record them at enable time:
   ```bash
   vibe-agent auto-nudge enable --goal "Finish the approved branch work and get review/CI green" --beads vkvw-ke5n2,vkvw-u4m13 --beads-dir /path/to/repo
   ```
   Rerunning `enable` replaces the prior criteria for this workspace.

2. Coordinate teammates with `vibe-agent send ...`. Response routing is the default; use `--fire-and-forget` only when no response is needed.

3. Read the response schema path and identity included in every auto-nudge checkpoint prompt. End with exactly one matching `auto-nudge-result` envelope containing strict JSON. Human-readable Markdown may precede it. Use `{"outcome":"complete","actions":[]}` when the workflow is complete.

4. If the next milestone-completion step needs a user decision or approval, create a beads-form and report the handoff through the structured actions required by the checkpoint schema. Do not use legacy `DONE` or `CREATED FORM` markers.

5. If auto-nudge coordination should stop for this workspace, run:
   ```bash
   vibe-agent auto-nudge disable
   ```

Notes:
- VK owns recovery of prematurely stopped agent turns. Auto-nudge coordinates only registered workspace workflows.
- `vibe-agent auto-nudge status` shows the current workspace registration.
- The default runtime workflow config is `/home/vkuser/.local/share/vibe-dashboard-runtime/data/config/auto_nudge_workflow.yaml`; its response schema files live beside it under `schemas/`.
- The daemon rejects malformed, duplicate-key, unknown-field, or schema-identity-mismatched results and permits one correction attempt before manual recovery.
