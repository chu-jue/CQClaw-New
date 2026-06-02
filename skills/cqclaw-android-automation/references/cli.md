# CQClaw Agent CLI

All commands are run from:
`/Users/chujue/Documents/Codex/cqclaq-2.0.12`

The agent CLI prints JSON by default.

## Service

```bash
bin/cqclaw agent ensure
bin/cqclaw agent call GET /api/health
```

If the API is already running on the recorded runtime port, commands reuse it.

## Devices

```bash
bin/cqclaw agent devices --online
bin/cqclaw agent devices --include-process-packages
```

Use the returned `data.devices[].serial`.

## Observe

```bash
bin/cqclaw agent inspect --serial SERIAL
bin/cqclaw agent top-activity --serial SERIAL
bin/cqclaw agent screenshot --serial SERIAL
bin/cqclaw agent dump --serial SERIAL
bin/cqclaw agent dump --serial SERIAL --query "Login"
bin/cqclaw agent dump --serial SERIAL --query "OK" --clickable-only
bin/cqclaw agent dump --serial SERIAL --format nodes --limit 80
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
bin/cqclaw agent shell --serial SERIAL -- getprop ro.product.model
bin/cqclaw agent shell --serial SERIAL -- input keyevent BACK
bin/cqclaw agent shell --serial SERIAL -- input tap 540 1534
bin/cqclaw agent clipboard read --serial SERIAL
bin/cqclaw agent clipboard write --serial SERIAL --text "hello"
bin/cqclaw agent apps --serial SERIAL --no-include-system --quick
```

Prefer workflow actions for multi-step tasks.

## Workflow

```bash
bin/cqclaw agent workflow schema
bin/cqclaw agent workflow preview --file flow.json --devices SERIAL
bin/cqclaw agent workflow run --file flow.json --devices SERIAL
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

## Raw API Fallback

Use this only when a high-level command is missing:

```bash
bin/cqclaw agent call POST /api/device/shell --data '{"serial":"SERIAL","command":"id"}'
```
