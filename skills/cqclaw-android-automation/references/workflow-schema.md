# CQClaw Workflow Schema

Use `cqclaw agent workflow schema` for the current full schema. This file
keeps the compact rules needed to draft workflows.

## Root

```json
{
  "name": "Workflow name",
  "stopOnError": true,
  "steps": []
}
```

The CLI option `--devices SERIAL1,SERIAL2` supplies target devices at preview or
run time.

Supported variables in string fields:

- `{serial}`
- `{alias}`
- `{model}`
- `{product}`
- `{groups}`
- `{date}`
- `{time}`
- `{datetime}`

## Common Step Fields

```json
{
  "kind": "adb_shell",
  "name": "Human readable step name",
  "enabled": true,
  "continueOnError": false,
  "timeout": 30
}
```

Disabled steps are ignored.

## Common Step Kinds

### app_action

```json
{
  "kind": "app_action",
  "operation": "start_app",
  "packageName": "com.example.app",
  "timeout": 30
}
```

Operations:
`force_stop`, `clear_data`, `uninstall`, `start_app`, `start_activity`.

For `start_activity`, use:

```json
{
  "kind": "app_action",
  "operation": "start_activity",
  "activity": "com.example.app/.MainActivity"
}
```

### tap_text

```json
{
  "kind": "tap_text",
  "keyword": "Login",
  "matchType": "contains",
  "matchIndex": 0,
  "retry": 3,
  "retryIntervalMs": 700,
  "enabledOnly": true,
  "continueOnError": true,
  "timeout": 30
}
```

Use this for text/id based UI interaction before using raw coordinates.

### adb_script

```json
{
  "kind": "adb_script",
  "commands": "adb shell getprop ro.product.model\ntapText(\"OK\")\nwaitTextAndTap(\"Login\", 5000)",
  "allowLocalCommands": false,
  "continueOnLineError": false,
  "continueOnError": true,
  "timeout": 60
}
```

Useful DSL calls include:
`tapText`, `tapTextContains`, `tapTextExact`, `tapById`, `waitText`,
`waitTextAndTap`, `assertText`, `tap`, `swipeUp`, `scrollToText`, `inputText`,
`setClipboard`, `paste`, `launchApp`, `killApp`, `currentActivity`,
`screenshot`, and `dumpUI`.

### input_text

```json
{
  "kind": "input_text",
  "text": "value",
  "inputMode": "auto",
  "timeout": 30
}
```

### keyevent

```json
{
  "kind": "keyevent",
  "key": "BACK",
  "timeout": 15
}
```

### screenshot

```json
{
  "kind": "screenshot",
  "filename": "evidence_{serial}_{datetime}.png",
  "continueOnError": true,
  "timeout": 30
}
```

### adb_shell

```json
{
  "kind": "adb_shell",
  "command": "getprop ro.product.model",
  "timeout": 30
}
```

### pull_file and push_file

```json
{
  "kind": "pull_file",
  "remotePath": "/sdcard/Download/",
  "destDir": "",
  "continueOnError": true,
  "timeout": 180
}
```

```json
{
  "kind": "push_file",
  "localPath": "/path/to/file",
  "remotePath": "/sdcard/Download/",
  "continueOnError": true,
  "timeout": 180
}
```

## Planning Pattern

For a natural-language automation request:

1. Inspect current screen.
2. Draft workflow JSON.
3. Preview workflow.
4. If preview is valid, run workflow.
5. Verify result with dump/screenshot/top-activity.
6. If a visible step fails, dump again and revise selectors.
