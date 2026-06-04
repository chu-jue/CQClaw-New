---
name: cqclaw-android-automation
description: "Use when controlling Android devices through CQClaw: inspect screens, act on UI, run shell commands, capture evidence, learn a reusable workflow from a user goal, or replay and diagnose a saved CQClaw automation profile."
---

# CQClaw Android Automation

Use CQClaw's agent CLI as the stable automation surface. Prefer it over raw
`adb` because it returns machine-readable JSON and reuses the installed CQClaw
client/server, settings, dump parser, workflow executor, and output paths.

## Runtime

This skill is designed for end users who have installed the CQClaw client. Do
not assume they have the source checkout.

Resolve the CLI and installation root before doing anything else:

1. Use `$CQCLAW_CLI` when the user configured an explicit executable.
2. Use `$QCLAW_HOME/bin/cqclaw` or `$AAS_HOME/bin/cqclaw` when either home is
   configured.
3. Use `cqclaw` when it is on `PATH`.
4. Use common install locations only as a fallback:
   - macOS: `$HOME/Applications/CQClaw/bin/cqclaw`
   - Windows: `%LOCALAPPDATA%\CQClaw\bin\cqclaw.cmd`
5. Run `cqclaw agent locate` through the resolved executable. Treat its
   `data.home` as the authoritative installation root and its `data.paths` as
   the authoritative locations for CQClaw data, profiles, settings, runtime,
   and server files.

If none exists, tell the user to install/open CQClaw and make sure the `cqclaw`
command is available in a new terminal. Do not use a hard-coded developer
machine path. Do not reuse a path seen in this skill, an example, a previous
conversation, or another user's computer.

When a CQClaw file is needed, resolve it relative to the `home` or named path
returned by `agent locate`. When a workflow needs an unrelated user file such
as an APK or upload, use the path supplied by the user or ask them to select it;
do not assume it lives inside CQClaw.

## Modes

- **Learn**: Observe the device, draft a workflow, preview it, run it, repair
  selectors when needed, verify the result, and save the verified workflow.
- **Replay**: Find a saved profile, preview it against the current device, run
  it by name, and report its latest verification evidence.

## Core Workflow

1. Locate this user's CQClaw installation:
   `cqclaw agent locate`
2. Ensure the local API is available:
   `cqclaw agent ensure`
3. List online devices:
   `cqclaw agent devices --online`
4. If more than one online device is returned, ask the user which serial to use.
5. Inspect before acting:
   `cqclaw agent inspect --serial SERIAL`
6. For screen-specific tasks, use dump queries:
   `cqclaw agent dump --serial SERIAL --query "Login"`
7. Before drafting a duplicate workflow, inspect saved profiles:
   `cqclaw agent workflow list`
8. For a new automation goal, create workflow JSON, preview it, run it, verify
   it, then save it into the CQClaw Automation page for future reuse:
   `cqclaw agent workflow preview --file flow.json --devices SERIAL`
   `cqclaw agent workflow run --file flow.json --devices SERIAL`
   `cqclaw agent workflow save --file flow.json --name "Reusable workflow" --source learned`
9. For a saved automation, preview and replay it directly by name:
   `cqclaw agent workflow preview --profile "Reusable workflow" --devices SERIAL`
   `cqclaw agent workflow run --profile "Reusable workflow" --devices SERIAL`
   `cqclaw agent workflow report --name "Reusable workflow"`
10. After execution, verify with `dump`, `screenshot`, `top-activity`, or `shell`
   and report the learning report, verification status, and evidence paths.

## Rules

- Treat every CLI response as JSON and check `ok`.
- Use `agent locate` instead of guessing CQClaw paths or searching an entire
  disk. Re-run it if the CLI is updated, moved, or invoked from another user
  account.
- Do not invent a device serial. Use `devices --online` first.
- Prefer `workflow preview` before `workflow run` unless the user asks for a
  one-shot command or the action is clearly harmless.
- Repair a failed learned workflow from a fresh inspect/dump result. Limit
  automatic repair attempts to 3, then explain the blocker instead of looping.
- For visible UI actions, prefer `tap_text`, `adb_script` DSL calls, or dump
  matches over hard-coded coordinates. Use coordinates only when the dump result
  provides them for the current screen.
- Keep workflow files small and task-local. Include `name`, `stopOnError`, and
  `steps`.
- When the user wants a reusable automation or asks to learn a task, save the
  verified workflow with `workflow save` so it appears in the Web Automation
  page's saved profiles and can be loaded/executed next time.
- Prefer replaying an existing matching profile over generating a duplicate.
  Use `workflow show` before modifying a saved profile.
- Do not put secrets such as passwords in committed workflow files. For one-off
  runs, use temporary files or ask the user for the secret at execution time.

## References

- For exact commands and examples, read `references/cli.md`.
- Before drafting workflow JSON, read `references/workflow-schema.md` or run
  `cqclaw agent workflow schema`.
