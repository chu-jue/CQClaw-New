# CQClaw Agent CLI

This skill requires a compatible CQClaw client and CLI to already be installed.
Do not assume a source checkout or a developer path, and do not fall back to
raw `adb` when the CLI is unavailable.

First run:

```bash
cqclaw agent locate
```

Continue only when this returns valid JSON with `ok: true`. If it succeeds, use
`cqclaw` directly in all remaining commands. If the command is not on `PATH`,
resolve an installed CLI with:

```bash
if command -v cqclaw >/dev/null 2>&1; then
  CQCLAW_CMD="$(command -v cqclaw)"
elif [ -n "${CQCLAW_CLI:-}" ] && [ -x "$CQCLAW_CLI" ]; then
  CQCLAW_CMD="$CQCLAW_CLI"
elif [ -n "${QCLAW_HOME:-}" ] && [ -x "$QCLAW_HOME/bin/cqclaw" ]; then
  CQCLAW_CMD="$QCLAW_HOME/bin/cqclaw"
elif [ -n "${AAS_HOME:-}" ] && [ -x "$AAS_HOME/bin/cqclaw" ]; then
  CQCLAW_CMD="$AAS_HOME/bin/cqclaw"
elif [ -x "$HOME/Applications/CQClaw/bin/cqclaw" ]; then
  CQCLAW_CMD="$HOME/Applications/CQClaw/bin/cqclaw"
elif [ -n "${LOCALAPPDATA:-}" ] && [ -f "$LOCALAPPDATA/CQClaw/bin/cqclaw.cmd" ]; then
  CQCLAW_CMD="$LOCALAPPDATA/CQClaw/bin/cqclaw.cmd"
else
  echo "This skill requires a compatible CQClaw CLI. Install/update/open CQClaw, make 'cqclaw agent locate' succeed in a new terminal, then retry." >&2
  exit 127
fi
```

Use `"$CQCLAW_CMD"` in scripts when command discovery is needed.

PowerShell:

```powershell
if (Get-Command cqclaw -ErrorAction SilentlyContinue) {
  $CQCLAW_CMD = (Get-Command cqclaw).Source
} elseif ($env:CQCLAW_CLI -and (Test-Path $env:CQCLAW_CLI)) {
  $CQCLAW_CMD = $env:CQCLAW_CLI
} elseif ($env:QCLAW_HOME -and (Test-Path (Join-Path $env:QCLAW_HOME "bin\cqclaw.cmd"))) {
  $CQCLAW_CMD = Join-Path $env:QCLAW_HOME "bin\cqclaw.cmd"
} elseif ($env:AAS_HOME -and (Test-Path (Join-Path $env:AAS_HOME "bin\cqclaw.cmd"))) {
  $CQCLAW_CMD = Join-Path $env:AAS_HOME "bin\cqclaw.cmd"
} elseif ($env:LOCALAPPDATA -and (Test-Path (Join-Path $env:LOCALAPPDATA "CQClaw\bin\cqclaw.cmd"))) {
  $CQCLAW_CMD = Join-Path $env:LOCALAPPDATA "CQClaw\bin\cqclaw.cmd"
} else {
  throw "This skill requires a compatible CQClaw CLI. Install/update/open CQClaw, make 'cqclaw agent locate' succeed in a new terminal, then retry."
}
```

After resolving a CLI path, run `agent locate` through it and require valid JSON
with `ok: true`. A `cqclaw` executable that does not support the `agent`
subcommand is an old or incompatible CLI. If no compatible installed CLI can
make `agent locate` succeed, stop and tell the user to install or update CQClaw.
Do not continue with raw `adb`, a guessed source checkout, or a path copied from
another computer. The agent CLI prints JSON by default.

## Installation Paths

After resolving the executable, always ask CQClaw for this user's installation
and data paths:

```bash
"$CQCLAW_CMD" agent locate
```

The returned JSON includes:

- `data.home`: authoritative CQClaw installation root
- `data.homeSource`: whether the root came from `QCLAW_HOME`, `AAS_HOME`, or
  the CLI program directory
- `data.cliPath`: resolved CLI executable
- `data.programPath`: installed CQClaw CLI program file
- `data.environment`: relevant environment variable values
- `data.paths`: data, runtime, profiles, settings, and server paths

Use these returned values instead of paths copied from examples, source
checkouts, previous sessions, or another user's computer. Do not recursively
search the user's whole disk for CQClaw.

## Service

```bash
cqclaw agent locate
cqclaw agent ensure
cqclaw agent call GET /api/health
```

If the API is already running on the recorded runtime port, commands reuse it.

## Devices

```bash
cqclaw agent devices --online
cqclaw agent devices --include-process-packages
```

Use the returned `data.devices[].serial`.

## Observe

```bash
cqclaw agent inspect --serial SERIAL
cqclaw agent top-activity --serial SERIAL
cqclaw agent screenshot --serial SERIAL
cqclaw agent dump --serial SERIAL
cqclaw agent dump --serial SERIAL --query "Login"
cqclaw agent dump --serial SERIAL --query "OK" --clickable-only
cqclaw agent dump --serial SERIAL --format nodes --limit 80
```

`dump` returns:

- `screenshotPath`
- `xmlPath`
- `nodeCount`
- `actionableCount`
- `matches[]`
- `matches[].center`
- `matches[].tapCommand`

Use the returned coordinates only for the same screen state that produced the
dump.

## Act

```bash
cqclaw agent shell --serial SERIAL -- getprop ro.product.model
cqclaw agent shell --serial SERIAL -- input keyevent BACK
cqclaw agent shell --serial SERIAL -- input tap 540 1534
cqclaw agent clipboard read --serial SERIAL
cqclaw agent clipboard write --serial SERIAL --text "hello"
cqclaw agent apps --serial SERIAL --no-include-system --quick
```

Prefer workflow actions for multi-step tasks.

## Workflow

```bash
cqclaw agent workflow schema
cqclaw agent workflow list
cqclaw agent workflow show --name "Open app and capture result"
cqclaw agent workflow preview --file flow.json --devices SERIAL
cqclaw agent workflow run --file flow.json --devices SERIAL
cqclaw agent workflow save --file flow.json --name "Open app and capture result" --source learned
cqclaw agent workflow preview --profile "Open app and capture result" --devices SERIAL
cqclaw agent workflow run --profile "Open app and capture result" --devices SERIAL
cqclaw agent workflow report --name "Open app and capture result"
cqclaw agent workflow delete --name "Open app and capture result" --yes
```

Example:

```json
{
  "name": "Open app and capture result",
  "stopOnError": true,
  "steps": [
    {
      "kind": "app_action",
      "name": "Start app",
      "operation": "start_app",
      "packageName": "com.example.app",
      "timeout": 30
    },
    {
      "kind": "tap_text",
      "name": "Tap login",
      "keyword": "Login",
      "matchType": "contains",
      "retry": 3,
      "timeout": 30
    },
    {
      "kind": "screenshot",
      "name": "Capture result",
      "filename": "result_{serial}_{datetime}.png",
      "continueOnError": true,
      "timeout": 30
    }
  ]
}
```

After a workflow is verified, use `workflow save` to add it to the Web
Automation page's saved profiles. `workflow run --profile` replays it without
the original JSON file and updates its success/failure counters, verification
status, evidence paths, and latest learning report.

## Raw API Fallback

Use this only when a high-level command is missing:

```bash
cqclaw agent call POST /api/device/shell --data '{"serial":"SERIAL","command":"id"}'
```
