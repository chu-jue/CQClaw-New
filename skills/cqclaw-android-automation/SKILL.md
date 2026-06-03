---
name: cqclaw-android-automation
description: Use when controlling Android devices through CQClaw: list devices, inspect the current screen, parse UI dump nodes, run shell commands, capture screenshots, inspect foreground activity, manage clipboard, or create/preview/run CQClaw workflow automation from a user goal.
---

# CQClaw Android Automation

Use CQClaw's agent CLI as the stable automation surface. Prefer it over raw
`adb` because it returns machine-readable JSON and reuses the installed CQClaw
client/server, settings, dump parser, workflow executor, and output paths.

## Runtime

This skill is designed for end users who have installed the CQClaw client. Do
not assume they have the source checkout.

Resolve the CLI in this order:

1. Use `cqclaw` when it is on `PATH`.
2. Use `$CQCLAW_CLI` when the user configured an explicit executable.
3. Use `$QCLAW_HOME/bin/cqclaw` or `$AAS_HOME/bin/cqclaw` when either home is
   configured.
4. Use common install locations only as a fallback:
   - macOS: `$HOME/Applications/CQClaw/bin/cqclaw`
   - Windows: `%LOCALAPPDATA%\CQClaw\bin\cqclaw.cmd`

If none exists, tell the user to install/open CQClaw and make sure the `cqclaw`
command is available in a new terminal. Do not use a hard-coded developer
machine path.

## Core Workflow

1. Ensure the local API is available:
   `cqclaw agent ensure`
2. List online devices:
   `cqclaw agent devices --online`
3. If more than one online device is returned, ask the user which serial to use.
4. Inspect before acting:
   `cqclaw agent inspect --serial SERIAL`
5. For screen-specific tasks, use dump queries:
   `cqclaw agent dump --serial SERIAL --query "Login"`
6. For automation plans, create workflow JSON, preview it, then run it:
   `cqclaw agent workflow preview --file flow.json --devices SERIAL`
   `cqclaw agent workflow run --file flow.json --devices SERIAL`
7. After execution, verify with `dump`, `screenshot`, `top-activity`, or `shell`
   and report returned evidence paths.

## Rules

- Treat every CLI response as JSON and check `ok`.
- Do not invent a device serial. Use `devices --online` first.
- Prefer `workflow preview` before `workflow run` unless the user asks for a
  one-shot command or the action is clearly harmless.
- For visible UI actions, prefer `tap_text`, `adb_script` DSL calls, or dump
  matches over hard-coded coordinates. Use coordinates only when the dump result
  provides them for the current screen.
- Keep workflow files small and task-local. Include `name`, `stopOnError`, and
  `steps`.
- Do not put secrets such as passwords in committed workflow files. For one-off
  runs, use temporary files or ask the user for the secret at execution time.

## References

- For exact commands and examples, read `references/cli.md`.
- Before drafting workflow JSON, read `references/workflow-schema.md` or run
  `cqclaw agent workflow schema`.
