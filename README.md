# CQClaw

CQClaw is a local Android automation workbench with a web console, CLI, desktop client packaging, and agent-friendly automation commands.

## Quick start

```bash
./install.sh
cqclaw start
```

On Windows:

```bat
install-windows.bat
cqclaw start
```

## Agent CLI

```bash
bin/cqclaw agent ensure
bin/cqclaw agent devices --online
bin/cqclaw agent dump --serial SERIAL --query "Login"
bin/cqclaw agent workflow schema
```

## Packaging

Windows Inno Setup build scripts live in `packaging/windows/`.
macOS installer scripts live in `packaging/macos/`.
