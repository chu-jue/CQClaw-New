#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WITH_OCR=0
PROFILE_UPDATED=0

python_cmd() {
  if [ -n "${PYTHON:-}" ]; then
    echo "$PYTHON"
  elif command -v python3 >/dev/null 2>&1; then
    echo "python3"
  elif command -v python >/dev/null 2>&1; then
    echo "python"
  else
    echo "Python was not found. Install Python 3 and try again." >&2
    return 127
  fi
}

path_contains() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

path_is_safe_install_dir() {
  case "$1" in
    ""|/bin|/sbin|/usr/bin|/usr/sbin|/System/*|/var/run/*)
      return 1
      ;;
  esac
  [ -d "$1" ] && [ -w "$1" ]
}

choose_bin_dir() {
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
    if path_contains "$dir" && path_is_safe_install_dir "$dir"; then
      echo "$dir"
      return 0
    fi
  done
  old_ifs=$IFS
  IFS=:
  for dir in $PATH; do
    if path_is_safe_install_dir "$dir"; then
      IFS=$old_ifs
      echo "$dir"
      return 0
    fi
  done
  IFS=$old_ifs
  echo "$HOME/.local/bin"
}

profile_file() {
  shell_name=$(basename "${SHELL:-}")
  case "$shell_name" in
    zsh)
      echo "$HOME/.zshrc"
      ;;
    bash)
      if [ "$(uname -s 2>/dev/null || echo "")" = "Darwin" ]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    *)
      echo "$HOME/.profile"
      ;;
  esac
}

ensure_user_path() {
  profile=$(profile_file)
  marker="# CQClaw CLI"
  path_line="export PATH=\"$BIN_DIR:\$PATH\""
  if [ -f "$profile" ] && grep -F "$path_line" "$profile" >/dev/null 2>&1; then
    return 0
  fi
  {
    echo ""
    echo "$marker"
    echo "$path_line"
  } >> "$profile"
  PROFILE_UPDATED=1
}

for arg in "$@"; do
  case "$arg" in
    --with-ocr)
      WITH_OCR=1
      ;;
    -h|--help)
      echo "Usage: ./install.sh [--with-ocr]"
      echo ""
      echo "By default OCR dependencies are not installed."
      echo "Use --with-ocr only if you need EasyOCR fallback."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: ./install.sh [--with-ocr]" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT"

BIN_DIR=$(choose_bin_dir)
QCLAW_BIN="$BIN_DIR/cqclaw"
AAS_BIN="$BIN_DIR/aas"
PY_CMD=$(python_cmd)
PY_EXE=$("$PY_CMD" -c 'import sys; print(sys.executable)')

if [ -f "requirements.txt" ] && grep -v '^[[:space:]]*#' requirements.txt | grep -q '[^[:space:]]'; then
  "$PY_EXE" -m pip install --user -r requirements.txt
fi
if [ "$WITH_OCR" = "1" ] && [ -f "requirements-ocr.txt" ]; then
  "$PY_EXE" -m pip install --user -r requirements-ocr.txt
fi
"$PY_EXE" "$ROOT/tools/aas_cli.py" python --set "$PY_EXE" --source install >/dev/null

mkdir -p "$BIN_DIR"
cat > "$QCLAW_BIN" <<EOF
#!/usr/bin/env sh
export QCLAW_HOME="$ROOT"
export AAS_HOME="\$QCLAW_HOME"
export QCLAW_PYTHON="$PY_EXE"
exec "\$QCLAW_PYTHON" "\$QCLAW_HOME/tools/aas_cli.py" "\$@"
EOF
cat > "$AAS_BIN" <<EOF
#!/usr/bin/env sh
echo "aas is deprecated. Please use cqclaw." >&2
export QCLAW_HOME="$ROOT"
export AAS_HOME="\$QCLAW_HOME"
export QCLAW_PYTHON="$PY_EXE"
exec "\$QCLAW_PYTHON" "\$QCLAW_HOME/tools/aas_cli.py" "\$@"
EOF
chmod +x "$QCLAW_BIN" "$AAS_BIN" "$ROOT/bin/cqclaw" "$ROOT/bin/aas"

echo "CQClaw CLI installed."
echo "Command: cqclaw"
echo "Home: $ROOT"
echo "Python: $PY_EXE"
echo "Try: cqclaw start"
if [ "$WITH_OCR" = "1" ]; then
  echo "OCR: installed"
else
  echo "OCR: skipped. Install later with: cqclaw install-ocr"
fi

if path_contains "$BIN_DIR"; then
  :
else
    ensure_user_path
    echo ""
    echo "Added $BIN_DIR to $(profile_file)."
    echo "For this terminal window, run:"
    echo "source $(profile_file)"
    echo ""
    echo "Or start immediately with:"
    echo "$QCLAW_BIN start"
fi
if [ "$PROFILE_UPDATED" = "0" ]; then
  echo "PATH: ready"
else
  echo "PATH: will be ready in new terminal windows"
fi
