#!/usr/bin/env sh
set -eu

QCLAW_BIN="$HOME/.local/bin/cqclaw"
AAS_BIN="$HOME/.local/bin/aas"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.cqclaw.app.plist"
LEGACY_LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.android-automation-studio.aas.plist"

if [ -f "$QCLAW_BIN" ]; then
  rm "$QCLAW_BIN"
  echo "Removed $QCLAW_BIN"
else
  echo "cqclaw command was not installed at $QCLAW_BIN"
fi

if [ -f "$AAS_BIN" ]; then
  rm "$AAS_BIN"
  echo "Removed $AAS_BIN"
else
  echo "legacy aas command was not installed at $AAS_BIN"
fi

if [ -f "$LAUNCH_AGENT" ]; then
  rm "$LAUNCH_AGENT"
  echo "Removed $LAUNCH_AGENT"
fi
if [ -f "$LEGACY_LAUNCH_AGENT" ]; then
  rm "$LEGACY_LAUNCH_AGENT"
  echo "Removed $LEGACY_LAUNCH_AGENT"
fi

echo "Project files and local data were not removed."
