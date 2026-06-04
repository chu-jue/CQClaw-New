# CQClaw Agent CLI

The skill should work after a user installs the CQClaw client. Do not assume a
source checkout or a developer path.

Use `cqclaw` in examples. If the command is not on `PATH`, resolve it with:

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
  echo "CQClaw CLI not found. Install/open CQClaw, then restart the terminal." >&2
  exit 127
fi
```

Use `"$CQCLAW_CMD"` in scripts when command discovery is needed.

The agent CLI prints JSON by default.

## Service

```bash
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
