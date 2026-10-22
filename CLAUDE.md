# Springboard Development Guide

This application is built with the **Springboard framework**.

## Getting Started

**Before writing any code, run:**

```bash
npx sb docs context
```

This outputs comprehensive framework information including available documentation
sections, key concepts, and workflow guidance.

## Recommended Workflow

1. **Run `sb docs context`** at the start of your session
2. **Write code** using your knowledge + the context from step 1
3. **Fetch specific docs** only when needed: `sb docs get <section>`
4. **View examples** for reference code: `sb docs examples show <name>`

## Other Useful Commands

- `sb docs --help` - See all available commands
- `sb docs types` - Get TypeScript type definitions
- `sb docs examples list` - See available example modules

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete the local handoff steps below. Pushing to remotes is externally visible and must happen only when the user explicitly requests or authorizes it.

**MANDATORY LOCAL WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Commit local changes when requested/appropriate** - Keep the working tree understandable and avoid stranded uncommitted work
5. **Sync/push only with authorization** - If the user explicitly asks you to push, run the appropriate commands, for example:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # verify remote status after an authorized push
   ```
6. **Clean up** - Clear stashes and temporary files you created
7. **Verify** - Report local `git status --short --branch` and validation results
8. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Push only when explicitly requested or authorized by the user
- If push is not authorized, do not push; report the local branch status and the exact commands a user can run to push/sync later
- Do not describe local work as remotely available until the authorized push succeeds
- If an authorized push fails, report the failure and the exact next command or fix needed
<!-- END BEADS INTEGRATION -->
