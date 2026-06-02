#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications/CQClaw}"
APP_BUNDLE="${APP_BUNDLE:-$HOME/Applications/CQClaw.app}"
WITH_OCR=0
ENABLE_AUTOSTART=0
START_NOW=0

usage() {
  echo "Usage: install-cqclaw.command [--with-ocr] [--enable-autostart] [--start-now]"
}

for arg in "$@"; do
  case "$arg" in
    --with-ocr)
      WITH_OCR=1
      ;;
    --enable-autostart)
      ENABLE_AUTOSTART=1
      ;;
    --start-now)
      START_NOW=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

find_source_root() {
  for candidate in "$SCRIPT_DIR" "$SCRIPT_DIR/.." "$SCRIPT_DIR/../.."; do
    if [ -f "$candidate/server.py" ] && [ -f "$candidate/tools/aas_cli.py" ]; then
      CDPATH= cd -- "$candidate" && pwd
      return 0
    fi
  done
  echo "Could not find CQClaw source root near $SCRIPT_DIR" >&2
  return 1
}

create_app_bundle() {
  app_dir="$1"
  install_dir="$2"
  mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
  cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>CQClaw</string>
  <key>CFBundleDisplayName</key>
  <string>CQClaw</string>
  <key>CFBundleIdentifier</key>
  <string>com.cqclaw.client</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleExecutable</key>
  <string>CQClaw</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST
  cat > "$app_dir/Contents/MacOS/CQClaw" <<EOF
#!/usr/bin/env sh
export QCLAW_HOME="$install_dir"
export AAS_HOME="\$QCLAW_HOME"
cd "\$QCLAW_HOME"
exec /usr/bin/env python3 "\$QCLAW_HOME/desktop/cqclaw_client.py"
EOF
  chmod +x "$app_dir/Contents/MacOS/CQClaw"
}

SOURCE_ROOT=$(find_source_root)
mkdir -p "$INSTALL_DIR"

echo "CQClaw source: $SOURCE_ROOT"
echo "CQClaw install: $INSTALL_DIR"

rsync -a --delete \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  --exclude ".DS_Store" \
  --exclude "dist" \
  --exclude "build" \
  --exclude "data/runtime" \
  --exclude "data/tmp-scripts" \
  "$SOURCE_ROOT/" "$INSTALL_DIR/"

cd "$INSTALL_DIR"
if [ "$WITH_OCR" = "1" ]; then
  ./install.sh --with-ocr
else
  ./install.sh
fi

create_app_bundle "$APP_BUNDLE" "$INSTALL_DIR"

if [ "$ENABLE_AUTOSTART" = "1" ]; then
  "$INSTALL_DIR/bin/cqclaw" autostart enable --no-open
fi
if [ "$START_NOW" = "1" ]; then
  "$INSTALL_DIR/bin/cqclaw" start --no-open
fi

echo ""
echo "CQClaw installed."
echo "CLI: cqclaw"
echo "Client: $APP_BUNDLE"
echo "Web: cqclaw open"
