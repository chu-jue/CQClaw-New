#!/usr/bin/env python3
"""Cross-platform CLI for CQClaw."""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import hashlib
import io
import json
import os
import platform
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any, List, Optional


APP_NAME = "CQClaw"
CLI_NAME = "cqclaw"
LEGACY_CLI_NAME = "aas"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_OPEN_PATH = "/log-insight.html"
RUNTIME_DIR = Path("data") / "runtime"
STATE_NAME = "cqclaw.json"
PID_NAME = "cqclaw.pid"
LOG_NAME = "cqclaw.log"
LEGACY_STATE_NAME = "aas.json"
LEGACY_PID_NAME = "aas.pid"
LEGACY_LOG_NAME = "aas.log"
UPDATE_SOURCE_NAME = "cqclaw-update-source.json"
PYTHON_CONFIG_NAME = "cqclaw-python.json"
ENTERPRISE_CONFIG_NAME = "enterprise.json"
ENTERPRISE_SOURCE_NAME = "enterprise-source.json"
ENTERPRISE_SOURCE_TEXT_NAME = "enterprise-source.txt"
AUTOSTART_LABEL = "com.cqclaw.app"
LEGACY_AUTOSTART_LABEL = "com.android-automation-studio.aas"
WINDOWS_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
WINDOWS_RUN_VALUE = "CQClaw"
LEGACY_WINDOWS_RUN_VALUE = "Android Automation Studio"


def is_windows() -> bool:
    return os.name == "nt"


def project_root() -> Path:
    env_home = os.environ.get("QCLAW_HOME") or os.environ.get("AAS_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path(__file__).resolve().parents[1]


def runtime_dir(root: Path) -> Path:
    return root / RUNTIME_DIR


def state_path(root: Path) -> Path:
    return runtime_dir(root) / STATE_NAME


def legacy_state_path(root: Path) -> Path:
    return runtime_dir(root) / LEGACY_STATE_NAME


def pid_path(root: Path) -> Path:
    return runtime_dir(root) / PID_NAME


def legacy_pid_path(root: Path) -> Path:
    return runtime_dir(root) / LEGACY_PID_NAME


def log_path(root: Path) -> Path:
    return runtime_dir(root) / LOG_NAME


def legacy_log_path(root: Path) -> Path:
    return runtime_dir(root) / LEGACY_LOG_NAME


def update_source_path(root: Path) -> Path:
    return runtime_dir(root) / UPDATE_SOURCE_NAME


def enterprise_config_path(root: Path) -> Path:
    return root / "data" / ENTERPRISE_CONFIG_NAME


def enterprise_source_path(root: Path) -> Path:
    return root / "data" / ENTERPRISE_SOURCE_NAME


def enterprise_source_text_path(root: Path) -> Path:
    return root / "data" / ENTERPRISE_SOURCE_TEXT_NAME


def python_config_path(root: Path) -> Path:
    return runtime_dir(root) / PYTHON_CONFIG_NAME


def macos_launch_agent_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{AUTOSTART_LABEL}.plist"


def legacy_macos_launch_agent_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LEGACY_AUTOSTART_LABEL}.plist"


def windows_run_location() -> str:
    return f"HKCU\\{WINDOWS_RUN_KEY}\\{WINDOWS_RUN_VALUE}"


def normalize_open_path(path: Optional[str]) -> str:
    value = (path or DEFAULT_OPEN_PATH).strip() or DEFAULT_OPEN_PATH
    return "/" + value.lstrip("/")


def display_host(host: str) -> str:
    return "127.0.0.1" if host in {"0.0.0.0", "::"} else host


def server_url(host: str, port: int, open_path: str = DEFAULT_OPEN_PATH) -> str:
    base = f"http://{display_host(host)}:{port}"
    return urllib.parse.urljoin(base, normalize_open_path(open_path))


def state_url(
    state: dict,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    open_path: str = DEFAULT_OPEN_PATH,
) -> str:
    return state.get("url") or server_url(
        state.get("host", host),
        int(state.get("port", port)),
        state.get("openPath", open_path),
    )


def choose_python(root: Path, explicit: Optional[str] = None) -> str:
    if explicit:
        return explicit
    env_python = os.environ.get("QCLAW_PYTHON") or os.environ.get("AAS_PYTHON")
    if env_python:
        return env_python
    configured = read_python_config(root)
    if configured:
        return configured
    return sys.executable


def read_python_config(root: Path) -> str:
    path = python_config_path(root)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    return str(data.get("python") or data.get("executable") or "").strip()


def write_python_config(root: Path, python_executable: str, source: str = "manual") -> None:
    value = str(python_executable or "").strip()
    if not value:
        raise ValueError("python executable is empty")
    runtime_dir(root).mkdir(parents=True, exist_ok=True)
    payload = {
        "python": value,
        "source": source,
        "savedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    python_config_path(root).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clear_python_config(root: Path) -> None:
    try:
        python_config_path(root).unlink()
    except FileNotFoundError:
        pass


def python_executable_available(python_executable: str) -> bool:
    if not python_executable:
        return False
    value = python_executable.strip().strip('"')
    if not value:
        return False
    if os.path.isabs(value) or os.sep in value or (os.altsep and os.altsep in value):
        return Path(value).exists()
    return shutil.which(value) is not None


def python_version(python_executable: str) -> str:
    if not python_executable:
        return "not configured"
    try:
        result = subprocess.run(
            [python_executable, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f"unavailable ({exc})"
    version = (result.stdout or "").strip()
    if result.returncode != 0 or not version:
        detail = (result.stderr or "").strip()
        return f"unavailable ({detail or 'exit ' + str(result.returncode)})"
    return version


def normalized_python_identity(python_executable: str) -> str:
    resolved = shutil.which(python_executable) or python_executable
    return os.path.normcase(os.path.abspath(str(resolved)))


def build_server_command(
    root: Path,
    python_executable: str,
    host: str,
    port: int,
    open_path: str,
) -> List[str]:
    return [
        python_executable,
        str(root / "server.py"),
        "--host",
        host,
        "--port",
        str(port),
        "--no-open",
        "--open-path",
        normalize_open_path(open_path),
    ]


def autostart_python_executable(python_executable: str) -> str:
    if not is_windows():
        return python_executable
    resolved = shutil.which(python_executable) or python_executable
    try:
        path = Path(resolved)
        if path.name.lower() == "python.exe":
            pythonw = path.with_name("pythonw.exe")
            if pythonw.exists():
                return str(pythonw)
    except OSError:
        pass
    return python_executable


def build_autostart_command(
    root: Path,
    python_executable: str,
    host: str,
    port: int,
    open_path: str,
    open_at_login: bool = False,
) -> List[str]:
    command = [
        autostart_python_executable(python_executable),
        str(root / "tools" / "aas_cli.py"),
        "start",
        "--host",
        host,
        "--port",
        str(port),
        "--open-path",
        normalize_open_path(open_path),
        "--wait",
        "20",
    ]
    if not open_at_login:
        command.append("--no-open")
    return command


def install_macos_autostart(
    root: Path,
    python_executable: str,
    host: str,
    port: int,
    open_path: str,
    open_at_login: bool = False,
) -> dict:
    runtime_dir(root).mkdir(parents=True, exist_ok=True)
    path = macos_launch_agent_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    command = build_autostart_command(root, python_executable, host, port, open_path, open_at_login)
    plist = {
        "Label": AUTOSTART_LABEL,
        "ProgramArguments": command,
        "WorkingDirectory": str(root),
        "EnvironmentVariables": {
            "QCLAW_HOME": str(root),
            "AAS_HOME": str(root),
            "PATH": os.environ.get("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"),
        },
        "RunAtLoad": True,
        "KeepAlive": False,
        "StandardOutPath": str(log_path(root)),
        "StandardErrorPath": str(log_path(root)),
    }
    with path.open("wb") as handle:
        plistlib.dump(plist, handle)
    try:
        path.chmod(0o644)
    except OSError:
        pass
    return {"ok": True, "enabled": True, "target": str(path), "command": command}


def install_windows_autostart(
    root: Path,
    python_executable: str,
    host: str,
    port: int,
    open_path: str,
    open_at_login: bool = False,
) -> dict:
    import winreg

    command = build_autostart_command(root, python_executable, host, port, open_path, open_at_login)
    command_line = subprocess.list2cmdline(command)
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, WINDOWS_RUN_VALUE, 0, winreg.REG_SZ, command_line)
    return {"ok": True, "enabled": True, "target": windows_run_location(), "command": command}


def install_autostart(
    root: Path,
    python_executable: str,
    host: str,
    port: int,
    open_path: str,
    open_at_login: bool = False,
) -> dict:
    if is_windows():
        return install_windows_autostart(root, python_executable, host, port, open_path, open_at_login)
    if platform.system() == "Darwin":
        return install_macos_autostart(root, python_executable, host, port, open_path, open_at_login)
    return {"ok": False, "enabled": False, "error": "autostart is only supported on macOS and Windows"}


def macos_autostart_status() -> dict:
    path = macos_launch_agent_path()
    if not path.exists():
        return {"ok": True, "enabled": False, "target": str(path)}
    command = []
    try:
        with path.open("rb") as handle:
            command = list(plistlib.load(handle).get("ProgramArguments") or [])
    except (OSError, plistlib.InvalidFileException, ValueError):
        command = []
    return {"ok": True, "enabled": True, "target": str(path), "command": command}


def windows_autostart_status() -> dict:
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_QUERY_VALUE) as key:
            command, _ = winreg.QueryValueEx(key, WINDOWS_RUN_VALUE)
        return {"ok": True, "enabled": True, "target": windows_run_location(), "command": command}
    except FileNotFoundError:
        return {"ok": True, "enabled": False, "target": windows_run_location()}
    except OSError as exc:
        return {"ok": False, "enabled": False, "target": windows_run_location(), "error": str(exc)}


def autostart_status() -> dict:
    if is_windows():
        return windows_autostart_status()
    if platform.system() == "Darwin":
        return macos_autostart_status()
    return {"ok": False, "enabled": False, "error": "autostart is only supported on macOS and Windows"}


def disable_macos_autostart() -> dict:
    path = macos_launch_agent_path()
    legacy_path = legacy_macos_launch_agent_path()
    removed_paths = []
    try:
        path.unlink()
        removed_paths.append(str(path))
    except FileNotFoundError:
        pass
    try:
        legacy_path.unlink()
        removed_paths.append(str(legacy_path))
    except FileNotFoundError:
        pass
    return {"ok": True, "enabled": False, "target": str(path), "removed": bool(removed_paths), "removedPaths": removed_paths}


def disable_windows_autostart() -> dict:
    import winreg

    removed_values = []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, WINDOWS_RUN_VALUE)
    except FileNotFoundError:
        pass
    else:
        removed_values.append(WINDOWS_RUN_VALUE)
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, WINDOWS_RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, LEGACY_WINDOWS_RUN_VALUE)
    except FileNotFoundError:
        pass
    else:
        removed_values.append(LEGACY_WINDOWS_RUN_VALUE)
    return {"ok": True, "enabled": False, "target": windows_run_location(), "removed": bool(removed_values), "removedValues": removed_values}


def disable_autostart() -> dict:
    if is_windows():
        return disable_windows_autostart()
    if platform.system() == "Darwin":
        return disable_macos_autostart()
    return {"ok": False, "enabled": False, "error": "autostart is only supported on macOS and Windows"}


def enable_autostart_from_args(root: Path, args: argparse.Namespace) -> bool:
    result = install_autostart(
        root,
        choose_python(root, getattr(args, "python", None)),
        args.host,
        int(args.port),
        args.open_path,
        bool(getattr(args, "open_at_login", False)),
    )
    if result.get("ok"):
        print(f"autostart: enabled ({result.get('target')})")
        return True
    print(f"autostart: failed: {result.get('error') or 'unknown error'}", file=sys.stderr)
    return False


def read_state(root: Path) -> dict:
    for path in (state_path(root), legacy_state_path(root)):
        if not path.exists():
            continue
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
            state["_statePath"] = str(path)
            return state
        except (OSError, json.JSONDecodeError):
            continue
    return {}


def write_state(root: Path, state: dict) -> None:
    runtime_dir(root).mkdir(parents=True, exist_ok=True)
    state_path(root).write_text(json.dumps(state, indent=2), encoding="utf-8")
    pid = state.get("pid")
    if pid:
        pid_path(root).write_text(str(pid), encoding="utf-8")


def clear_state(root: Path) -> None:
    for path in (state_path(root), pid_path(root), legacy_state_path(root), legacy_pid_path(root)):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def process_running(pid: Optional[int]) -> bool:
    if not pid or pid <= 0:
        return False
    if is_windows():
        if windows_process_running(pid):
            return True
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True,
            text=True,
            check=False,
        )
        return str(pid) in (result.stdout or "")
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def windows_process_running(pid: int) -> bool:
    if not is_windows():
        return False
    try:
        kernel32 = ctypes.windll.kernel32
        process_query_limited_information = 0x1000
        handle = kernel32.OpenProcess(process_query_limited_information, False, int(pid))
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return False
            return exit_code.value == 259
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        return False


def url_reachable(url: str, timeout: float = 0.6) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout):
            return True
    except (OSError, urllib.error.URLError):
        return False


def api_url(url: str, path: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return urllib.parse.urljoin(url, path)
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))


def request_server_shutdown(url: str, timeout: float = 2.0) -> bool:
    shutdown_url = api_url(url, "/api/server/shutdown")
    request = urllib.request.Request(
        shutdown_url,
        data=b"{}",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError):
        return False


def wait_for_service_stopped(pid: int, port: int, url: str, timeout: float = 6.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        pid_ok = not pid or not process_running(pid)
        port_ok = not unique_pids(listening_pids(port))
        http_ok = not url_reachable(url)
        if pid_ok and (port_ok or http_ok):
            return True
        time.sleep(0.2)
    return (not pid or not process_running(pid)) and not unique_pids(listening_pids(port))


def wait_for_url(url: str, timeout: float = 8.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0):
                return True
        except (OSError, urllib.error.URLError):
            time.sleep(0.2)
    return False


def windows_listening_pids(port: int) -> List[int]:
    if not is_windows():
        return []
    try:
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return []
    pids = set()
    marker = f":{int(port)}"
    for line in (result.stdout or "").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        proto, local_addr, state, pid_text = parts[0], parts[1], parts[-2], parts[-1]
        if not proto.upper().startswith("TCP"):
            continue
        if state.upper() != "LISTENING":
            continue
        if not local_addr.endswith(marker):
            continue
        try:
            pids.add(int(pid_text))
        except ValueError:
            continue
    return sorted(pids)


def posix_listening_pids(port: int) -> List[int]:
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{int(port)}", "-sTCP:LISTEN", "-t"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return []
    pids = set()
    for line in (result.stdout or "").splitlines():
        try:
            pids.add(int(line.strip()))
        except ValueError:
            continue
    return sorted(pids)


def listening_pids(port: int) -> List[int]:
    if is_windows():
        return windows_listening_pids(port)
    return posix_listening_pids(port)


def unique_pids(values: List[int]) -> List[int]:
    current_pid = os.getpid()
    cleaned = []
    for value in values:
        try:
            pid = int(value)
        except (TypeError, ValueError):
            continue
        if pid <= 0 or pid == current_pid:
            continue
        if pid not in cleaned:
            cleaned.append(pid)
    return cleaned


def service_state(
    root: Path,
    host: str = DEFAULT_HOST,
    port: int = DEFAULT_PORT,
    open_path: str = DEFAULT_OPEN_PATH,
) -> dict:
    state = read_state(root)
    pid = int(state.get("pid") or 0)
    resolved_port = int(state.get("port", port))
    url = state_url(state, host, resolved_port, open_path)
    pid_running = process_running(pid)
    http_running = url_reachable(url)
    port_pids = listening_pids(resolved_port) if not pid_running else []
    return {
        "state": state,
        "pid": pid,
        "pidRunning": pid_running,
        "httpRunning": http_running,
        "portPids": port_pids,
        "running": pid_running or http_running or bool(port_pids),
        "port": resolved_port,
        "url": url,
}


def stop_pids(pids: List[int]) -> bool:
    targets = unique_pids(pids)
    if not targets:
        return True
    ok = True
    for pid in targets:
        if not stop_process(pid):
            ok = False
    return ok


def stop_service_processes(pid: int, port: int, timeout: float = 6.0) -> dict:
    candidates = []
    if pid:
        candidates.append(pid)
    candidates.extend(listening_pids(port))
    targets = unique_pids(candidates)
    failed = []
    for target in targets:
        if not stop_process(target, timeout=timeout):
            failed.append(target)
    released = not unique_pids(listening_pids(port))
    return {
        "ok": released or not failed,
        "targets": targets,
        "failed": failed,
        "released": released,
    }


def release_port(port: int, timeout: float = 6.0) -> bool:
    pids = unique_pids(listening_pids(port))
    if not pids:
        return True
    print(f"Port {port} is in use by pid(s): {', '.join(str(pid) for pid in pids)}")
    print(f"Stopping process(es) on port {port}...")
    stop_pids(pids)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not unique_pids(listening_pids(port)):
            return True
        time.sleep(0.2)
    return not unique_pids(listening_pids(port))


def stop_process(pid: int, timeout: float = 6.0) -> bool:
    if not process_running(pid):
        return True
    if is_windows():
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        deadline = time.time() + timeout
        while time.time() < deadline:
            if not process_running(pid):
                return True
            time.sleep(0.2)
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", f"Stop-Process -Id {int(pid)} -Force -ErrorAction SilentlyContinue"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    else:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        except OSError:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                return True
            except PermissionError:
                return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not process_running(pid):
            return True
        time.sleep(0.2)
    if not is_windows():
        try:
            os.killpg(pid, signal.SIGKILL)
        except OSError:
            try:
                os.kill(pid, signal.SIGKILL)
            except PermissionError:
                return False
            except OSError:
                pass
    return not process_running(pid)


def tail_lines(path: Path, count: int) -> str:
    if not path.exists():
        return ""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-count:])


AGENT_WORKFLOW_SCHEMA: dict[str, Any] = {
    "type": "cqclaw-workflow",
    "version": 1,
    "description": "CQClaw workflow JSON accepted by `cqclaw agent workflow preview|run`.",
    "root": {
        "name": "string workflow name",
        "stopOnError": "boolean, default true",
        "devices": "optional serial list; CLI --devices overrides this",
        "steps": "array of enabled action objects",
    },
    "variables": ["{serial}", "{alias}", "{model}", "{product}", "{groups}", "{date}", "{time}", "{datetime}"],
    "commonStepFields": {
        "kind": "required action type",
        "name": "optional display name",
        "enabled": "boolean, disabled steps are ignored",
        "continueOnError": "boolean, continue workflow after this step fails",
        "timeout": "seconds",
    },
    "stepKinds": {
        "app_action": {
            "description": "Start, stop, clear, or uninstall an app.",
            "fields": {
                "operation": "force_stop | clear_data | uninstall | start_app | start_activity",
                "packageName": "required except start_activity",
                "activity": "required for start_activity, e.g. com.demo/.MainActivity",
            },
            "default": {"kind": "app_action", "operation": "start_app", "packageName": "", "timeout": 30},
        },
        "tap_text": {
            "description": "Find visible UI text/id through dump/OCR helpers and tap it.",
            "fields": {
                "keyword": "text, content description, or resource-id keyword",
                "matchType": "contains | exact | regex",
                "matchIndex": "zero-based match index",
                "retry": "attempt count",
                "retryIntervalMs": "delay between retries",
                "enabledOnly": "prefer enabled nodes",
                "fallbackOcr": "try OCR if dump matching fails",
                "onlyOcr": "use OCR only",
                "area": "optional area constraint",
            },
            "default": {
                "kind": "tap_text",
                "keyword": "确定",
                "matchType": "contains",
                "matchIndex": 0,
                "retry": 3,
                "retryIntervalMs": 700,
                "enabledOnly": True,
                "continueOnError": True,
                "timeout": 30,
            },
        },
        "input_text": {
            "description": "Input text into the focused field.",
            "fields": {"text": "text to input", "inputMode": "auto | adb_input"},
            "default": {"kind": "input_text", "text": "", "inputMode": "auto", "timeout": 30},
        },
        "keyevent": {
            "description": "Send Android keyevent.",
            "fields": {"key": "Android keycode name or number, e.g. ENTER, BACK, 66"},
            "default": {"kind": "keyevent", "key": "ENTER", "timeout": 15},
        },
        "adb_shell": {
            "description": "Run `adb -s SERIAL shell <command>`.",
            "fields": {"command": "shell command string"},
            "default": {"kind": "adb_shell", "command": "pm list packages | head", "timeout": 30},
        },
        "adb_raw": {
            "description": "Run raw adb arguments after `adb -s SERIAL`.",
            "fields": {"command": "adb argument string, e.g. reboot or logcat -c"},
            "default": {"kind": "adb_raw", "command": "devices", "timeout": 30},
        },
        "adb_script": {
            "description": "Run multi-line ADB/DSL script. Supports CQClaw DSL calls like tapText(), waitTextAndTap(), assertText().",
            "fields": {
                "commands": "script text",
                "allowLocalCommands": "allow non-adb local commands",
                "continueOnLineError": "continue within script after failed line",
                "cwd": "optional working directory",
            },
            "default": {
                "kind": "adb_script",
                "commands": "adb shell getprop ro.product.model\ntapText(\"确定\")\nwaitTextAndTap(\"登录\", 5000)",
                "allowLocalCommands": False,
                "continueOnLineError": False,
                "continueOnError": True,
                "timeout": 60,
            },
        },
        "screenshot": {
            "description": "Capture screenshot to local output path.",
            "fields": {"destDir": "optional local directory", "filename": "supports variables"},
            "default": {"kind": "screenshot", "filename": "screenshot_{serial}_{datetime}.png", "continueOnError": True, "timeout": 30},
        },
        "screen_record": {
            "description": "Record the device screen and pull the mp4.",
            "fields": {"seconds": "1-180", "destDir": "optional local directory", "filename": "supports variables", "remoteTempDir": "optional device temp dir"},
            "default": {"kind": "screen_record", "filename": "record_{serial}_{datetime}.mp4", "seconds": 10, "continueOnError": True, "timeout": 240},
        },
        "pull_file": {
            "description": "Pull file or directory from device.",
            "fields": {"remotePath": "device path", "destDir": "local directory"},
            "default": {"kind": "pull_file", "remotePath": "/sdcard/Download/", "destDir": "", "continueOnError": True, "timeout": 180},
        },
        "push_file": {
            "description": "Push local file or directory to device.",
            "fields": {"localPath": "local source", "remotePath": "device destination"},
            "default": {"kind": "push_file", "localPath": "", "remotePath": "/sdcard/Download/", "continueOnError": True, "timeout": 180},
        },
        "set_clipboard": {
            "description": "Set device clipboard text.",
            "fields": {"text": "clipboard text"},
            "default": {"kind": "set_clipboard", "text": "", "timeout": 30},
        },
        "agent_clipboard": {
            "description": "Read or write device clipboard through CQClaw agent bridge.",
            "fields": {"operation": "read | set | set_and_paste", "text": "text for write operations"},
            "default": {"kind": "agent_clipboard", "operation": "read", "text": "", "timeout": 30},
        },
        "permission_grant": {
            "description": "Grant or guide permissions for an app.",
            "fields": {
                "packageName": "target package",
                "permissionMode": "settings_page or runtime command mode",
                "permissions": "newline-separated permission names",
                "verifyAfterGrant": "boolean",
                "continueOnPermissionError": "boolean",
            },
            "default": {
                "kind": "permission_grant",
                "packageName": "",
                "permissionMode": "settings_page",
                "permissions": "CAMERA\nRECORD_AUDIO\nACCESS_FINE_LOCATION",
                "verifyAfterGrant": True,
                "continueOnPermissionError": True,
                "continueOnError": True,
                "timeout": 60,
            },
        },
        "script": {
            "description": "Run a local script once on the host.",
            "fields": {"path": "script path", "args": "argument string", "cwd": "optional working directory"},
            "default": {"kind": "script", "path": "", "args": "", "cwd": "", "timeout": 300},
        },
        "inline_script": {
            "description": "Run inline Python or shell script once on the host.",
            "fields": {"language": "python | shell", "code": "script code", "args": "argument string", "cwd": "optional working directory"},
            "default": {"kind": "inline_script", "language": "python", "code": "print('hello from inline script')", "args": "", "cwd": "", "timeout": 300},
        },
    },
}


def agent_json_print(payload: dict[str, Any], code: int = 0) -> int:
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return code


def agent_error(command: str, message: str, code: int = 1, **extra: Any) -> int:
    payload: dict[str, Any] = {
        "ok": False,
        "command": command,
        "error": message,
        "errors": [message],
    }
    payload.update(extra)
    return agent_json_print(payload, code)


def agent_payload(command: str, data: Any = None, ok: Optional[bool] = None, **meta: Any) -> dict[str, Any]:
    if ok is None:
        ok = bool(data.get("ok", True)) if isinstance(data, dict) else True
    payload: dict[str, Any] = {
        "ok": bool(ok),
        "command": command,
        "data": data if data is not None else {},
        "errors": [],
        "meta": meta,
    }
    if isinstance(data, dict):
        error = data.get("error") or data.get("stderr")
        if not ok and error:
            payload["errors"].append(str(error))
    return payload


def agent_start_namespace(args: argparse.Namespace) -> argparse.Namespace:
    return argparse.Namespace(
        host=args.host,
        port=args.port,
        open_path=args.open_path,
        no_open=True,
        kill_port=False,
        wait=args.wait,
        python=getattr(args, "python", None),
        open_at_login=False,
        autostart=False,
    )


def agent_candidate_ports(root: Path, args: argparse.Namespace, current: dict[str, Any]) -> List[int]:
    ports = []
    state_port = int(current.get("port") or args.port)
    for port in (state_port, args.port):
        if port not in ports:
            ports.append(port)
    for offset in range(1, 21):
        port = args.port + offset
        if port not in ports:
            ports.append(port)
    return ports


def agent_service(root: Path, args: argparse.Namespace, command: str, ensure: bool = True) -> tuple[Optional[str], Optional[dict[str, Any]], int]:
    current = service_state(root, args.host, args.port, args.open_path)
    if current["httpRunning"]:
        return current["url"], {
            "started": False,
            "running": True,
            "pid": current["pid"],
            "url": current["url"],
            "port": current["port"],
        }, 0
    health, status = agent_request(current["url"], "/api/health", timeout=1.5)
    if status and 200 <= status < 300 and health.get("ok"):
        return current["url"], {
            "started": False,
            "running": True,
            "pid": current["pid"],
            "url": current["url"],
            "port": current["port"],
            "health": health,
            "detectedBy": "/api/health",
        }, 0
    if current["pidRunning"] and current["pid"]:
        return current["url"], {
            "started": False,
            "running": True,
            "pid": current["pid"],
            "url": current["url"],
            "port": current["port"],
            "reachable": False,
            "note": "process is running but HTTP was not reachable from this environment",
        }, 0
    if not ensure or getattr(args, "no_ensure", False):
        return current["url"], {
            "started": False,
            "running": bool(current["running"]),
            "pid": current["pid"],
            "url": current["url"],
            "port": current["port"],
        }, 0

    stdout_buffer = io.StringIO()
    stderr_buffer = io.StringIO()
    attempted_ports = []
    result_code = 1
    next_state = current
    for candidate_port in agent_candidate_ports(root, args, current):
        attempted_ports.append(candidate_port)
        if candidate_port != args.port and unique_pids(listening_pids(candidate_port)):
            continue
        start_args = agent_start_namespace(args)
        start_args.port = candidate_port
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            result_code = cmd_start(start_args)
        next_state = service_state(root, args.host, candidate_port, args.open_path)
        if result_code == 0 and next_state["httpRunning"]:
            break
    if result_code != 0 or not next_state["httpRunning"]:
        return None, {
            "started": False,
            "running": bool(next_state["running"]),
            "pid": next_state["pid"],
            "url": next_state["url"],
            "port": next_state["port"],
            "attemptedPorts": attempted_ports,
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
        }, result_code or 1
    return next_state["url"], {
        "started": True,
        "running": True,
        "pid": next_state["pid"],
        "url": next_state["url"],
        "port": next_state["port"],
        "attemptedPorts": attempted_ports,
        "stdout": stdout_buffer.getvalue(),
        "stderr": stderr_buffer.getvalue(),
    }, 0


def agent_request(
    base_url: str,
    path: str,
    method: str = "GET",
    payload: Optional[dict[str, Any]] = None,
    timeout: float = 30.0,
) -> tuple[dict[str, Any], int]:
    url = api_url(base_url, path)
    data = None
    headers = {"Accept": "application/json"}
    if method.upper() != "GET":
        data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    request = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            if not body:
                return {"ok": True}, response.status
            return json.loads(body), response.status
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {"ok": False, "error": body or str(exc)}
        parsed.setdefault("ok", False)
        parsed.setdefault("status", exc.code)
        return parsed, exc.code
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": str(exc)}, 0


def agent_prepare(args: argparse.Namespace, command: str, ensure: bool = True) -> tuple[Optional[str], Optional[dict[str, Any]], int]:
    root = project_root()
    if not (root / "server.py").exists():
        return None, {"error": f"server.py not found in {root}", "home": str(root)}, 2
    return agent_service(root, args, command, ensure=ensure)


def parse_csv_values(value: str) -> List[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def read_workflow_file(path_text: str) -> dict[str, Any]:
    path = Path(path_text).expanduser()
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"name": path.stem, "stopOnError": True, "steps": data}
    if not isinstance(data, dict):
        raise ValueError("workflow file must contain an object or step array")
    if "steps" not in data and isinstance(data.get("workflow"), dict):
        data = {**data.get("workflow", {}), **{k: v for k, v in data.items() if k != "workflow"}}
    if not isinstance(data.get("steps"), list):
        raise ValueError("workflow file must include a steps array")
    return data


def workflow_payload_from_args(args: argparse.Namespace) -> dict[str, Any]:
    workflow = read_workflow_file(args.file)
    devices = parse_csv_values(args.devices) if args.devices else workflow.get("devices", [])
    if isinstance(devices, str):
        devices = parse_csv_values(devices)
    return {
        "type": workflow.get("type") or "cqclaw-workflow",
        "version": workflow.get("version") or 1,
        "name": workflow.get("name") or Path(args.file).stem,
        "stopOnError": bool(workflow.get("stopOnError", True)),
        "devices": devices,
        "steps": workflow.get("steps") or [],
    }


def bool_xml_attr(value: str) -> bool:
    return str(value or "").strip().lower() == "true"


def parse_bounds(value: str) -> Optional[dict[str, int]]:
    match = re.fullmatch(r"\[(\-?\d+),(\-?\d+)\]\[(\-?\d+),(\-?\d+)\]", str(value or "").strip())
    if not match:
        return None
    x1, y1, x2, y2 = [int(item) for item in match.groups()]
    return {
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "width": max(0, x2 - x1),
        "height": max(0, y2 - y1),
        "cx": (x1 + x2) // 2,
        "cy": (y1 + y2) // 2,
    }


def dump_nodes(xml_text: str) -> List[dict[str, Any]]:
    if not xml_text.strip():
        return []
    root = ET.fromstring(xml_text)
    nodes = []
    for index, element in enumerate(root.iter("node")):
        attrs = element.attrib
        bounds = parse_bounds(attrs.get("bounds", ""))
        node = {
            "id": str(index),
            "text": attrs.get("text", ""),
            "contentDesc": attrs.get("content-desc", ""),
            "resourceId": attrs.get("resource-id", ""),
            "className": attrs.get("class", ""),
            "package": attrs.get("package", ""),
            "clickable": bool_xml_attr(attrs.get("clickable", "")),
            "enabled": bool_xml_attr(attrs.get("enabled", "")),
            "focusable": bool_xml_attr(attrs.get("focusable", "")),
            "focused": bool_xml_attr(attrs.get("focused", "")),
            "scrollable": bool_xml_attr(attrs.get("scrollable", "")),
            "selected": bool_xml_attr(attrs.get("selected", "")),
            "bounds": bounds,
        }
        node["label"] = node["text"] or node["contentDesc"] or node["resourceId"] or node["className"]
        if bounds:
            node["center"] = [bounds["cx"], bounds["cy"]]
            node["tapCommand"] = f"input tap {bounds['cx']} {bounds['cy']}"
        nodes.append(node)
    return nodes


def node_search_text(node: dict[str, Any]) -> str:
    return "\n".join(str(node.get(key, "")) for key in ("text", "contentDesc", "resourceId", "className", "package")).lower()


def filter_dump_nodes(nodes: List[dict[str, Any]], query: str, clickable_only: bool = False, limit: int = 30) -> List[dict[str, Any]]:
    needle = str(query or "").strip().lower()
    matched = []
    for node in nodes:
        if clickable_only and not node.get("clickable"):
            continue
        if needle and needle not in node_search_text(node):
            continue
        matched.append(node)
        if len(matched) >= limit:
            break
    return matched


def summarize_dump_result(result: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    xml_text = str(result.get("xml") or "")
    try:
        nodes = dump_nodes(xml_text)
    except ET.ParseError as exc:
        nodes = []
        result = {**result, "parseError": str(exc)}
    matches = filter_dump_nodes(nodes, args.query, args.clickable_only, args.limit) if args.query else []
    actionable = [node for node in nodes if node.get("clickable") or node.get("text") or node.get("contentDesc") or node.get("resourceId")]
    summary: dict[str, Any] = {
        "ok": result.get("ok", False),
        "serial": result.get("serial"),
        "screenshotPath": result.get("screenshotPath", ""),
        "xmlPath": result.get("xmlPath", ""),
        "nodeCount": len(nodes),
        "actionableCount": len(actionable),
        "query": args.query,
        "matchCount": len(matches),
        "matches": matches,
        "error": result.get("error", ""),
    }
    if getattr(args, "include_image_data", False):
        summary["imageData"] = result.get("imageData", "")
    if args.format == "nodes":
        summary["nodes"] = nodes[: args.limit]
    elif args.format == "raw":
        summary["xml"] = xml_text
        if getattr(args, "include_image_data", False):
            summary["imageData"] = result.get("imageData", "")
    else:
        summary["topNodes"] = actionable[: min(args.limit, 20)]
    return summary


def cmd_agent_ensure(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "ensure", ensure=True)
    if code or not base_url:
        return agent_error("ensure", (info or {}).get("error") or "failed to start service", code or 1, data=info or {})
    health, status = agent_request(base_url, "/api/health", timeout=args.timeout)
    ok = status and 200 <= status < 300 and bool(health.get("ok"))
    return agent_json_print(agent_payload("ensure", {"service": info, "health": health}, ok=ok, serverUrl=base_url), 0 if ok else 1)


def cmd_agent_devices(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "devices", ensure=True)
    if code or not base_url:
        return agent_error("devices", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    query = []
    if args.include_process_packages:
        query.append("includeProcessPackages=true")
    if args.refresh_process_packages:
        query.append("refreshProcessPackages=true")
    path = "/api/devices" + (("?" + "&".join(query)) if query else "")
    result, _status = agent_request(base_url, path, timeout=args.timeout)
    devices = result.get("devices", [])
    if args.online:
        devices = [device for device in devices if device.get("state") == "device"]
    data = {**result, "devices": devices, "count": len(devices)}
    return agent_json_print(agent_payload("devices", data, ok=bool(result.get("ok", True)), serverUrl=base_url), 0 if result.get("ok", True) else 2)


def cmd_agent_shell(args: argparse.Namespace) -> int:
    command_parts = list(args.command or [])
    if command_parts and command_parts[0] == "--":
        command_parts = command_parts[1:]
    command = args.command_text or " ".join(command_parts).strip()
    if not command:
        return agent_error("shell", "shell command is required", 3)
    base_url, info, code = agent_prepare(args, "shell", ensure=True)
    if code or not base_url:
        return agent_error("shell", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, _status = agent_request(base_url, "/api/device/shell", "POST", {"serial": args.serial, "command": command, "timeout": args.timeout}, timeout=args.timeout + 5)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("shell", result, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_screenshot(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "screenshot", ensure=True)
    if code or not base_url:
        return agent_error("screenshot", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, _status = agent_request(base_url, "/api/device/screenshot", "POST", {"serial": args.serial}, timeout=args.timeout)
    if not args.include_image_data and isinstance(result, dict):
        result.pop("imageData", None)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("screenshot", result, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_dump(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "dump", ensure=True)
    if code or not base_url:
        return agent_error("dump", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, _status = agent_request(base_url, "/api/device/dump-analyze", "POST", {"serial": args.serial, "timeout": args.timeout}, timeout=args.timeout + 5)
    summary = summarize_dump_result(result, args)
    ok = bool(summary.get("ok"))
    return agent_json_print(agent_payload("dump", summary, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_top_activity(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "top-activity", ensure=True)
    if code or not base_url:
        return agent_error("top-activity", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, _status = agent_request(base_url, "/api/device/top-activity", "POST", {"serial": args.serial}, timeout=args.timeout)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("top-activity", result, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_apps(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "apps", ensure=True)
    if code or not base_url:
        return agent_error("apps", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    payload = {
        "serial": args.serial,
        "includeSystem": args.include_system,
        "refreshMode": "quick" if args.quick else "full",
        "skipPermissions": args.skip_permissions,
        "forceRefresh": args.force_refresh,
    }
    result, _status = agent_request(base_url, "/api/device/apps", "POST", payload, timeout=args.timeout)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("apps", result, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_clipboard(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "clipboard", ensure=True)
    if code or not base_url:
        return agent_error("clipboard", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    payload = {"serial": args.serial, "operation": args.clipboard_action, "timeout": args.timeout}
    if args.clipboard_action == "write":
        payload["text"] = args.text or ""
    result, _status = agent_request(base_url, "/api/device/clipboard", "POST", payload, timeout=args.timeout + 5)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("clipboard", result, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_inspect(args: argparse.Namespace) -> int:
    base_url, info, code = agent_prepare(args, "inspect", ensure=True)
    if code or not base_url:
        return agent_error("inspect", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    top, _ = agent_request(base_url, "/api/device/top-activity", "POST", {"serial": args.serial}, timeout=args.timeout)
    dump_result, _ = agent_request(base_url, "/api/device/dump-analyze", "POST", {"serial": args.serial, "timeout": args.timeout}, timeout=args.timeout + 5)
    dump_args = argparse.Namespace(query=args.query, clickable_only=args.clickable_only, limit=args.limit, format="summary", include_image_data=False)
    dump_summary = summarize_dump_result(dump_result, dump_args)
    data = {
        "serial": args.serial,
        "topActivity": top,
        "dump": dump_summary,
    }
    ok = bool(top.get("ok") or dump_summary.get("ok"))
    return agent_json_print(agent_payload("inspect", data, ok=ok, serverUrl=base_url, serial=args.serial), 0 if ok else 4)


def cmd_agent_workflow_schema(args: argparse.Namespace) -> int:
    return agent_json_print(agent_payload("workflow schema", AGENT_WORKFLOW_SCHEMA, ok=True), 0)


def cmd_agent_workflow_preview(args: argparse.Namespace) -> int:
    try:
        payload = workflow_payload_from_args(args)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return agent_error("workflow preview", str(exc), 3)
    base_url, info, code = agent_prepare(args, "workflow preview", ensure=True)
    if code or not base_url:
        return agent_error("workflow preview", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, _status = agent_request(base_url, "/api/preview", "POST", payload, timeout=args.timeout)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("workflow preview", result, ok=ok, serverUrl=base_url, workflow=payload.get("name")), 0 if ok else 3)


def cmd_agent_workflow_run(args: argparse.Namespace) -> int:
    try:
        payload = workflow_payload_from_args(args)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        return agent_error("workflow run", str(exc), 3)
    base_url, info, code = agent_prepare(args, "workflow run", ensure=True)
    if code or not base_url:
        return agent_error("workflow run", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, _status = agent_request(base_url, "/api/run", "POST", payload, timeout=args.timeout)
    ok = bool(result.get("ok"))
    return agent_json_print(agent_payload("workflow run", result, ok=ok, serverUrl=base_url, workflow=payload.get("name")), 0 if ok else 4)


def cmd_agent_call(args: argparse.Namespace) -> int:
    payload = {}
    if args.data:
        try:
            payload = json.loads(args.data)
        except json.JSONDecodeError as exc:
            return agent_error("call", f"invalid --data JSON: {exc}", 3)
    base_url, info, code = agent_prepare(args, "call", ensure=not args.no_ensure)
    if code or not base_url:
        return agent_error("call", (info or {}).get("error") or "service unavailable", code or 1, data=info or {})
    result, status = agent_request(base_url, args.path, args.method, payload, timeout=args.timeout)
    ok = bool(status and 200 <= status < 300 and result.get("ok", True))
    return agent_json_print(agent_payload("call", result, ok=ok, serverUrl=base_url, status=status), 0 if ok else 4)


def cmd_start(args: argparse.Namespace) -> int:
    root = project_root()
    if not (root / "server.py").exists():
        print(f"server.py not found in {root}", file=sys.stderr)
        return 2
    current = service_state(root, args.host, args.port, args.open_path)
    pid = current["pid"]
    if current["running"] and current["port"] == args.port and (current["pidRunning"] or current["httpRunning"]):
        if args.kill_port:
            if current["pidRunning"]:
                print(f"Stopping existing {APP_NAME} pid {pid}...")
                if not stop_process(pid):
                    print(f"Failed to stop pid {pid}.", file=sys.stderr)
                    return 1
            if not release_port(args.port):
                print(f"Failed to release port {args.port}.", file=sys.stderr)
                return 1
            clear_state(root)
        else:
            url = current["url"]
            print(f"{APP_NAME} is already running.")
            if current["pidRunning"]:
                print(f"pid: {pid}")
            elif current["portPids"]:
                print(f"pid: {current['portPids'][0]} (detected by port)")
            elif pid:
                print(f"stale pid: {pid}")
            else:
                print("pid: unknown")
            print(f"url: {url}")
            if args.autostart and not enable_autostart_from_args(root, args):
                return 1
            if not args.no_open:
                webbrowser.open(url)
            return 0
    elif current["running"] and current["port"] == args.port and current["portPids"]:
        if not args.kill_port:
            print(f"Port {args.port} is already in use by pid(s): {', '.join(str(pid) for pid in current['portPids'])}", file=sys.stderr)
            print(f"Use `{CLI_NAME} start --kill-port` to stop them, or `{CLI_NAME} start --port {args.port + 1}` to use another port.", file=sys.stderr)
            return 1
        if not release_port(args.port):
            print(f"Failed to release port {args.port}.", file=sys.stderr)
            return 1
        clear_state(root)
    else:
        occupied_pids = unique_pids(listening_pids(args.port))
        if occupied_pids:
            if not args.kill_port:
                print(f"Port {args.port} is already in use by pid(s): {', '.join(str(item) for item in occupied_pids)}", file=sys.stderr)
                print(f"Use `{CLI_NAME} start --kill-port` to stop them, or `{CLI_NAME} start --port {args.port + 1}` to use another port.", file=sys.stderr)
                return 1
            if not release_port(args.port):
                print(f"Failed to release port {args.port}.", file=sys.stderr)
                return 1
            clear_state(root)

    current = service_state(root, args.host, args.port, args.open_path)
    pid = current["pid"]
    if args.kill_port and current["running"]:
        print(f"Port {args.port} still appears to be in use after --kill-port.", file=sys.stderr)
        return 1
    if current["running"]:
        url = current["url"]
        print(f"{APP_NAME} is already running.")
        if current["pidRunning"]:
            print(f"pid: {pid}")
        elif current["portPids"]:
            print(f"pid: {current['portPids'][0]} (detected by port)")
        elif pid:
            print(f"stale pid: {pid}")
        else:
            print("pid: unknown")
        print(f"url: {url}")
        if args.autostart and not enable_autostart_from_args(root, args):
            return 1
        if not args.no_open:
            webbrowser.open(url)
        return 0

    runtime_dir(root).mkdir(parents=True, exist_ok=True)
    url = server_url(args.host, args.port, args.open_path)
    py = choose_python(root, args.python)
    if not python_executable_available(py):
        print(f"Python executable not found: {py}", file=sys.stderr)
        print(f"Use `{CLI_NAME} python --set <python>` to choose the runtime Python.", file=sys.stderr)
        return 1
    cmd = build_server_command(root, py, args.host, args.port, args.open_path)
    log_file = log_path(root)
    creationflags = 0
    popen_kwargs: dict = {
        "cwd": str(root),
        "stdin": subprocess.DEVNULL,
    }
    if is_windows():
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        popen_kwargs["creationflags"] = creationflags
    else:
        popen_kwargs["start_new_session"] = True

    with log_file.open("ab") as output:
        output.write(f"\n--- {CLI_NAME} start {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n".encode("utf-8"))
        proc = subprocess.Popen(cmd, stdout=output, stderr=subprocess.STDOUT, **popen_kwargs)

    state = {
        "pid": proc.pid,
        "host": args.host,
        "port": args.port,
        "openPath": normalize_open_path(args.open_path),
        "url": url,
        "log": str(log_file),
        "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "platform": platform.platform(),
    }
    write_state(root, state)
    ready = wait_for_url(url, timeout=args.wait)
    if not ready and not process_running(proc.pid):
        print(f"{APP_NAME} failed to start.", file=sys.stderr)
        log_tail = tail_lines(log_file, 30)
        if log_tail:
            print(log_tail, file=sys.stderr)
        clear_state(root)
        return 1
    print(f"{APP_NAME} started.")
    print(f"pid: {proc.pid}")
    print(f"url: {url}")
    print(f"log: {log_file}")
    if not ready:
        print("status: starting, HTTP endpoint is not ready yet")
    if args.autostart and not enable_autostart_from_args(root, args):
        return 1
    if not args.no_open:
        webbrowser.open(url)
    return 0


def cmd_stop(args: argparse.Namespace) -> int:
    root = project_root()
    current = service_state(root)
    pid = current["pid"]
    if not current["running"]:
        clear_state(root)
        print(f"{APP_NAME} is not running.")
        return 0
    if request_server_shutdown(current["url"]):
        if wait_for_service_stopped(pid, current["port"], current["url"]):
            clear_state(root)
            print(f"{APP_NAME} stopped.")
            print("method: server shutdown")
            return 0
        print("Server shutdown request was accepted, falling back to process cleanup...", file=sys.stderr)
    stop_result = stop_service_processes(pid, current["port"])
    if stop_result["ok"]:
        clear_state(root)
        if stop_result["targets"]:
            print(f"{APP_NAME} stopped.")
            print(f"stopped pid(s): {', '.join(str(item) for item in stop_result['targets'])}")
        else:
            print(f"{APP_NAME} stopped.")
        return 0
    if not stop_result["targets"]:
        if current["httpRunning"]:
            print(f"{APP_NAME} is reachable at {current['url']}, but no process id could be detected.", file=sys.stderr)
            print(f"Close it from Task Manager or restart the computer if it was started outside {CLI_NAME}.", file=sys.stderr)
            return 1
    failed_text = ", ".join(str(item) for item in stop_result["failed"]) or str(pid)
    print(f"Failed to stop pid(s): {failed_text}.", file=sys.stderr)
    print(f"Port {current['port']} released: {stop_result['released']}", file=sys.stderr)
    return 1


def cmd_restart(args: argparse.Namespace) -> int:
    stop_args = argparse.Namespace()
    cmd_stop(stop_args)
    return cmd_start(args)


def cmd_status(args: argparse.Namespace) -> int:
    root = project_root()
    current = service_state(root)
    pid = current["pid"]
    if current["running"]:
        print(f"{APP_NAME}: running")
        if current["pidRunning"]:
            print(f"pid: {pid}")
        elif current["portPids"]:
            print(f"pid: {current['portPids'][0]} (detected by port)")
            if pid:
                print(f"stale pid: {pid}")
        elif pid:
            print(f"stale pid: {pid}")
        else:
            print("pid: unknown")
        print(f"url: {current['url']}")
        print(f"health: pid={current['pidRunning']} http={current['httpRunning']}")
    else:
        print(f"{APP_NAME}: stopped")
        if pid:
            print(f"stale pid: {pid}")
    print(f"home: {root}")
    print(f"log: {log_path(root)}")
    return 0


def cmd_open(args: argparse.Namespace) -> int:
    root = project_root()
    state = read_state(root)
    host = state.get("host", args.host)
    port = int(state.get("port", args.port))
    url = server_url(host, port, args.path)
    webbrowser.open(url)
    print(f"opened: {url}")
    return 0


def cmd_logs(args: argparse.Namespace) -> int:
    root = project_root()
    path = log_path(root)
    if not path.exists():
        print(f"No log file yet: {path}")
        return 0
    text = tail_lines(path, args.lines)
    if text:
        print(text)
    if args.follow:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            handle.seek(0, os.SEEK_END)
            try:
                while True:
                    line = handle.readline()
                    if line:
                        print(line, end="")
                    else:
                        time.sleep(0.3)
            except KeyboardInterrupt:
                return 0
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    root = project_root()
    configured_py = read_python_config(root)
    py = choose_python(root, args.python)
    current = service_state(root)
    pid = current["pid"]
    print(f"app: {APP_NAME}")
    print(f"home: {root}")
    print(f"cli python: {sys.executable}")
    print(f"cli python version: {python_version(sys.executable)}")
    print(f"configured python: {configured_py or 'not set'}")
    if configured_py:
        print(f"configured python exists: {python_executable_available(configured_py)}")
        print(f"configured python version: {python_version(configured_py)}")
    print(f"runtime python: {py}")
    print(f"runtime python exists: {python_executable_available(py)}")
    print(f"runtime python version: {python_version(py)}")
    if normalized_python_identity(sys.executable) != normalized_python_identity(py):
        print("python note: CLI and runtime Python are different; this is OK if the configured runtime Python is intentional.")
    print(f"server.py: {(root / 'server.py').exists()}")
    print("environment: global Python, no project venv")
    print(f"adb: {shutil.which('adb') or 'not found'}")
    print(f"ocr: {'installed' if module_available(py, 'easyocr') else 'not installed'}")
    print(f"runtime: {runtime_dir(root)}")
    print(f"state: {state_path(root)}")
    print(f"log: {log_path(root)}")
    enterprise = read_enterprise_config(root)
    print(f"enterprise config: {enterprise_config_path(root)}")
    print(f"enterprise source: {enterprise.get('_enterpriseSource') or read_enterprise_source_pointer(root) or 'not set'}")
    print(f"enterprise loaded: {bool(enterprise)}")
    print(f"update source: {read_update_source(root) or 'not set'}")
    if enterprise.get("agentApkPath"):
        print(f"agent apk: {enterprise.get('agentApkPath')}")
    print(f"status: {'running' if current['running'] else 'stopped'}")
    print(f"status detail: pid={current['pidRunning']} http={current['httpRunning']}")
    auto = autostart_status()
    print(f"autostart: {'enabled' if auto.get('enabled') else 'disabled'}")
    if pid:
        print(f"pid: {pid}")
    return 0


def cmd_python(args: argparse.Namespace) -> int:
    root = project_root()
    if args.reset:
        clear_python_config(root)
        print("configured python: reset")
        return 0
    if args.set:
        write_python_config(root, args.set, args.source)
        print(f"configured python: {args.set}")
        print(f"configured python exists: {python_executable_available(args.set)}")
        print(f"configured python version: {python_version(args.set)}")
        return 0

    configured = read_python_config(root)
    selected = choose_python(root, None)
    print(f"cli python: {sys.executable}")
    print(f"cli python version: {python_version(sys.executable)}")
    print(f"configured python: {configured or 'not set'}")
    if configured:
        print(f"configured python exists: {python_executable_available(configured)}")
        print(f"configured python version: {python_version(configured)}")
    print(f"runtime python: {selected}")
    print(f"runtime python exists: {python_executable_available(selected)}")
    print(f"runtime python version: {python_version(selected)}")
    return 0


def module_available(python_executable: str, module_name: str) -> bool:
    try:
        result = subprocess.run(
            [
                python_executable,
                "-c",
                f"import importlib.util, sys; sys.exit(0 if importlib.util.find_spec({module_name!r}) else 1)",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return False
    return result.returncode == 0


def cmd_install_ocr(args: argparse.Namespace) -> int:
    root = project_root()
    req = root / "requirements-ocr.txt"
    if not req.exists():
        print(f"requirements-ocr.txt not found in {root}", file=sys.stderr)
        return 2
    py = choose_python(root, args.python)
    print("Installing optional OCR dependencies...")
    print("This installs into the current user/global Python environment, not a project .venv.")
    print("It may download large packages such as torch, torchvision, opencv-python-headless, numpy, and pillow.")
    install_args = [py, "-m", "pip", "install"]
    if not args.system:
        install_args.append("--user")
    install_args.extend(["-r", str(req)])
    result = subprocess.run(install_args, cwd=str(root), check=False)
    if result.returncode == 0:
        print("OCR dependencies installed.")
    return result.returncode


def read_local_version(root: Path) -> str:
    path = root / "version.txt"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return "0.0.0"
    return value or "0.0.0"


def version_key(value: str) -> tuple:
    parts = []
    for item in re_split_version(value):
        try:
            parts.append(int(item))
        except ValueError:
            parts.append(item.lower())
    return tuple(parts)


def re_split_version(value: str) -> List[str]:
    cleaned = str(value or "0").strip().lstrip("vV")
    tokens = []
    current = ""
    last_digit = None
    for char in cleaned:
        if char.isalnum():
            is_digit = char.isdigit()
            if current and last_digit is not None and is_digit != last_digit:
                tokens.append(current)
                current = char
            else:
                current += char
            last_digit = is_digit
        elif current:
            tokens.append(current)
            current = ""
            last_digit = None
    if current:
        tokens.append(current)
    return tokens or ["0"]


def update_download_dir(root: Path) -> Path:
    path = root / "data" / "updates" / "downloads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def update_log_path(root: Path) -> Path:
    path = root / "data" / "updates" / "update.log"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def read_json_file(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


ENTERPRISE_POINTER_KEYS = (
    "enterpriseSource",
    "enterpriseConfigSource",
    "enterpriseJsonPath",
    "enterpriseJson",
    "configSource",
    "configPath",
    "defaults.enterpriseSource",
    "defaults.enterpriseConfigSource",
)


def read_enterprise_json_payload(path: Path) -> tuple[dict, str]:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return {}, ""
    if not text:
        return {}, ""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}, text
    if isinstance(data, dict):
        return data, manifest_value(data, *ENTERPRISE_POINTER_KEYS)
    if isinstance(data, str):
        return {}, data.strip()
    return {}, ""


def read_enterprise_source_pointer(root: Path) -> str:
    env_source = str(os.environ.get("QCLAW_ENTERPRISE_SOURCE") or "").strip()
    if env_source:
        return env_source
    data, source = read_enterprise_json_payload(enterprise_source_path(root))
    source = source or manifest_value(data, "source", "path", *ENTERPRISE_POINTER_KEYS)
    if source:
        return source
    try:
        return enterprise_source_text_path(root).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def read_enterprise_source_config(source: str) -> dict:
    source = str(source or "").strip()
    if not source:
        return {}
    try:
        parsed = urllib.parse.urlparse(source)
        if parsed.scheme in {"http", "https"}:
            with urllib.request.urlopen(source, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else {}
        path = Path(source).expanduser()
        if path.is_dir():
            path = path / ENTERPRISE_CONFIG_NAME
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError, ValueError, urllib.error.URLError):
        return {}


def read_enterprise_config(root: Path) -> dict:
    local_data, embedded_source = read_enterprise_json_payload(enterprise_config_path(root))
    source = embedded_source or read_enterprise_source_pointer(root)
    source_data = read_enterprise_source_config(source)
    if source_data:
        return {**local_data, **source_data, "_enterpriseSource": source}
    return local_data


def enterprise_update_source(root: Path) -> str:
    data = read_enterprise_config(root)
    for key in ("updateSource", "defaultUpdateSource", "manifestSource", "source", "defaults.updateSource"):
        value = manifest_value(data, key)
        if value:
            return value
    return ""


def read_update_source(root: Path) -> str:
    env_source = os.environ.get("QCLAW_UPDATE_SOURCE")
    if env_source:
        return env_source
    path = update_source_path(root)
    data = read_json_file(path)
    source = str(data.get("source") or "").strip()
    return source or enterprise_update_source(root)


def write_update_source(root: Path, source: str) -> None:
    runtime_dir(root).mkdir(parents=True, exist_ok=True)
    update_source_path(root).write_text(json.dumps({
        "source": source,
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
    }, indent=2), encoding="utf-8")


def load_update_manifest(source: str) -> tuple[Path, dict]:
    source_path = Path(source).expanduser()
    manifest_path = source_path / "manifest.json" if source_path.is_dir() else source_path
    if not manifest_path.exists():
        raise FileNotFoundError(f"manifest.json not found: {manifest_path}")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("manifest.json must be a JSON object")
    return manifest_path, data


def manifest_value(manifest: dict, *paths: str) -> str:
    for path in paths:
        current = manifest
        for part in path.split("."):
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(part)
        value = str(current or "").strip()
        if value:
            return value
    return ""


def package_path_from_manifest(manifest_path: Path, manifest: dict) -> Path:
    package = manifest_value(manifest, "package", "file", "release.url", "release.package", "release.file")
    if not package:
        raise ValueError("manifest.json missing package or release.url")
    path = Path(package).expanduser()
    if not path.is_absolute():
        path = manifest_path.parent / path
    if not path.exists():
        raise FileNotFoundError(f"update package not found: {path}")
    return path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_update_package(root: Path, package_path: Path) -> Path:
    target = update_download_dir(root) / package_path.name
    if package_path.resolve() != target.resolve():
        shutil.copy2(package_path, target)
    return target


def verify_update_package(path: Path, expected_sha256: str) -> str:
    actual = sha256_file(path)
    if expected_sha256 and actual.lower() != expected_sha256.lower():
        raise ValueError(f"sha256 mismatch: expected {expected_sha256}, got {actual}")
    return actual


def launch_temp_updater(root: Path, args: argparse.Namespace, package_path: Path, manifest: dict, sha256_value: str, restart_after: bool) -> Path:
    updater_src = root / "tools" / "cqclaw_updater.py"
    if not updater_src.exists():
        raise FileNotFoundError(f"updater not found: {updater_src}")
    temp_dir = Path(tempfile.gettempdir()) / f"cqclaw-updater-{int(time.time())}-{os.getpid()}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    updater_dst = temp_dir / "cqclaw_updater.py"
    shutil.copy2(updater_src, updater_dst)
    command = [
        choose_python(root, getattr(args, "python", None)),
        str(updater_dst),
        "--root",
        str(root),
        "--package",
        str(package_path),
        "--sha256",
        sha256_value,
        "--target-version",
        str(manifest.get("latestVersion") or manifest.get("version") or ""),
        "--log",
        str(update_log_path(root)),
    ]
    if restart_after:
        command.extend([
            "--restart",
            "--host",
            str(getattr(args, "host", DEFAULT_HOST)),
            "--port",
            str(getattr(args, "port", DEFAULT_PORT)),
            "--open-path",
            normalize_open_path(getattr(args, "open_path", DEFAULT_OPEN_PATH)),
        ])
    stdout = subprocess.DEVNULL
    stderr = subprocess.DEVNULL
    popen_kwargs = {"cwd": str(temp_dir), "stdin": subprocess.DEVNULL, "stdout": stdout, "stderr": stderr}
    if is_windows():
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    else:
        popen_kwargs["start_new_session"] = True
    subprocess.Popen(command, **popen_kwargs)
    return updater_dst


def cmd_update(args: argparse.Namespace) -> int:
    root = project_root()
    if args.set_source:
        write_update_source(root, args.set_source)
        print(f"update source: {args.set_source}")
        return 0

    source = args.source or read_update_source(root)
    if not source:
        print(f"No update source configured. Use `{CLI_NAME} update --set-source <shared-folder>` first.", file=sys.stderr)
        return 2
    try:
        manifest_path, manifest = load_update_manifest(source)
        package_path = package_path_from_manifest(manifest_path, manifest)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"update: failed to read source: {exc}", file=sys.stderr)
        return 1

    local_version = read_local_version(root)
    latest_version = str(manifest.get("latestVersion") or manifest.get("version") or "").strip() or "0.0.0"
    expected_sha256 = str(manifest.get("sha256") or "").strip()
    newer = version_key(latest_version) > version_key(local_version)
    print(f"source: {manifest_path.parent}")
    print(f"local: {local_version}")
    print(f"latest: {latest_version}")
    print(f"package: {package_path}")
    if manifest.get("notes"):
        print(f"notes: {manifest.get('notes')}")
    if args.check:
        print("status: update available" if newer else "status: already up to date")
        return 0
    if not newer and not args.force:
        print("Already up to date. Use --force to reinstall this version.")
        return 0
    if args.dry_run:
        print("dry-run: package will be copied, verified, then installed by a temporary updater process.")
        return 0

    try:
        local_package = copy_update_package(root, package_path)
        actual_sha256 = verify_update_package(local_package, expected_sha256)
    except (OSError, ValueError) as exc:
        print(f"update: package verification failed: {exc}", file=sys.stderr)
        return 1

    current = service_state(root)
    restart_after = current["running"] and not args.no_restart
    try:
        updater = launch_temp_updater(root, args, local_package, manifest, actual_sha256, restart_after)
    except OSError as exc:
        print(f"update: failed to launch updater: {exc}", file=sys.stderr)
        return 1
    print("update: temporary updater launched.")
    print(f"updater: {updater}")
    print(f"log: {update_log_path(root)}")
    if restart_after:
        print("restart: service was running and will be restarted after update.")
    else:
        print("restart: disabled or service was not running.")
    return 0


def cmd_uninstall(args: argparse.Namespace) -> int:
    if is_windows():
        print(f"Run uninstall.ps1 from the project directory to remove the global {CLI_NAME} command.")
    else:
        print(f"Run ./uninstall.sh from the project directory to remove the global {CLI_NAME} command.")
    return 0


def cmd_autostart_status(args: argparse.Namespace) -> int:
    result = autostart_status()
    if not result.get("ok"):
        print(f"autostart: unsupported ({result.get('error')})", file=sys.stderr)
        return 1
    print(f"autostart: {'enabled' if result.get('enabled') else 'disabled'}")
    if result.get("target"):
        print(f"target: {result['target']}")
    command = result.get("command")
    if command:
        if isinstance(command, list):
            print("command: " + " ".join(command))
        else:
            print(f"command: {command}")
    return 0


def cmd_autostart_enable(args: argparse.Namespace) -> int:
    root = project_root()
    if not (root / "server.py").exists():
        print(f"server.py not found in {root}", file=sys.stderr)
        return 2
    if not enable_autostart_from_args(root, args):
        return 1
    return 0


def cmd_autostart_disable(args: argparse.Namespace) -> int:
    result = disable_autostart()
    if not result.get("ok"):
        print(f"autostart: unsupported ({result.get('error')})", file=sys.stderr)
        return 1
    print(f"autostart: disabled ({result.get('target')})")
    return 0


def add_start_options(parser: argparse.ArgumentParser, include_autostart: bool = True) -> None:
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--open-path", default=DEFAULT_OPEN_PATH)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--kill-port", action="store_true", help="stop the process occupying the target port before starting")
    parser.add_argument("--wait", default=8.0, type=float, help="seconds to wait for HTTP readiness")
    parser.add_argument("--python", help="Python executable used to run server.py")
    parser.add_argument("--open-at-login", action="store_true", help="open the browser when autostart launches at login")
    if include_autostart:
        parser.add_argument("--autostart", action="store_true", help="enable user login autostart after starting")


def add_agent_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--open-path", default=DEFAULT_OPEN_PATH)
    parser.add_argument("--wait", default=8.0, type=float, help="seconds to wait when auto-starting the local server")
    parser.add_argument("--timeout", default=30.0, type=float, help="seconds for the CQClaw API request or ADB operation")
    parser.add_argument("--python", help="Python executable used to auto-start server.py")
    parser.add_argument("--no-ensure", action="store_true", help="do not auto-start the local server")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=CLI_NAME, description="CQClaw CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="start the local server")
    add_start_options(start)
    start.set_defaults(func=cmd_start)

    stop = sub.add_parser("stop", help="stop the local server")
    stop.set_defaults(func=cmd_stop)

    restart = sub.add_parser("restart", help="restart the local server")
    add_start_options(restart)
    restart.set_defaults(func=cmd_restart)

    status = sub.add_parser("status", help="show server status")
    status.set_defaults(func=cmd_status)

    logs = sub.add_parser("logs", help="show server logs")
    logs.add_argument("-n", "--lines", default=80, type=int)
    logs.add_argument("-f", "--follow", action="store_true")
    logs.set_defaults(func=cmd_logs)

    open_cmd = sub.add_parser("open", help="open a page in the browser")
    open_cmd.add_argument("--host", default=DEFAULT_HOST)
    open_cmd.add_argument("--port", default=DEFAULT_PORT, type=int)
    open_cmd.add_argument("--path", default=DEFAULT_OPEN_PATH)
    open_cmd.set_defaults(func=cmd_open)

    doctor = sub.add_parser("doctor", help="print local diagnostics")
    doctor.add_argument("--python", help="Python executable used to run server.py")
    doctor.set_defaults(func=cmd_doctor)

    python_cmd = sub.add_parser("python", help="show or configure the Python interpreter used by CQClaw")
    python_cmd.add_argument("--set", metavar="PYTHON", help="lock CQClaw runtime to this Python executable")
    python_cmd.add_argument("--reset", action="store_true", help="remove the locked Python interpreter")
    python_cmd.add_argument("--source", default="manual", help=argparse.SUPPRESS)
    python_cmd.set_defaults(func=cmd_python)

    install_ocr = sub.add_parser("install-ocr", help="install optional EasyOCR fallback dependencies")
    install_ocr.add_argument("--python", help="Python executable used for pip install")
    install_ocr.add_argument("--system", action="store_true", help="install into the interpreter environment instead of --user")
    install_ocr.set_defaults(func=cmd_install_ocr)

    update = sub.add_parser("update", help="update CQClaw from a shared-folder release source")
    update.add_argument("--from", dest="source", help="shared folder or manifest.json path to read this time")
    update.add_argument("--set-source", help="save a shared folder or manifest.json path as the default update source")
    update.add_argument("--check", action="store_true", help="only check whether a newer version is available")
    update.add_argument("--dry-run", action="store_true", help="show update plan without copying or installing")
    update.add_argument("--force", action="store_true", help="install even when the manifest version is not newer")
    update.add_argument("--no-restart", action="store_true", help="do not restart the service after updating")
    update.add_argument("--host", default=DEFAULT_HOST)
    update.add_argument("--port", default=DEFAULT_PORT, type=int)
    update.add_argument("--open-path", default=DEFAULT_OPEN_PATH)
    update.add_argument("--python", help="Python executable used to run the temporary updater")
    update.set_defaults(func=cmd_update)


    autostart = sub.add_parser("autostart", help="manage user login autostart")
    autostart.set_defaults(func=cmd_autostart_status)
    autostart_sub = autostart.add_subparsers(dest="autostart_action")
    autostart_enable = autostart_sub.add_parser("enable", help="enable user login autostart")
    add_start_options(autostart_enable, include_autostart=False)
    autostart_enable.set_defaults(func=cmd_autostart_enable)
    autostart_disable = autostart_sub.add_parser("disable", help="disable user login autostart")
    autostart_disable.set_defaults(func=cmd_autostart_disable)
    autostart_status_cmd = autostart_sub.add_parser("status", help="show autostart status")
    autostart_status_cmd.set_defaults(func=cmd_autostart_status)

    uninstall = sub.add_parser("uninstall", help="show uninstall instructions")
    uninstall.set_defaults(func=cmd_uninstall)

    agent = sub.add_parser("agent", help="machine-readable Android automation commands for AI agents")
    agent_sub = agent.add_subparsers(dest="agent_command", required=True)

    agent_ensure = agent_sub.add_parser("ensure", help="ensure the local CQClaw API is running and return health JSON")
    add_agent_options(agent_ensure)
    agent_ensure.set_defaults(func=cmd_agent_ensure)

    agent_devices = agent_sub.add_parser("devices", help="list adb devices as JSON")
    add_agent_options(agent_devices)
    agent_devices.add_argument("--online", action="store_true", help="only return devices in the `device` state")
    agent_devices.add_argument("--include-process-packages", action="store_true")
    agent_devices.add_argument("--refresh-process-packages", action="store_true")
    agent_devices.set_defaults(func=cmd_agent_devices)

    agent_shell = agent_sub.add_parser("shell", help="run an adb shell command through CQClaw")
    add_agent_options(agent_shell)
    agent_shell.add_argument("--serial", required=True)
    agent_shell.add_argument("--command", dest="command_text", help="shell command string")
    agent_shell.add_argument("command", nargs=argparse.REMAINDER, help="command after --, e.g. -- getprop ro.product.model")
    agent_shell.set_defaults(func=cmd_agent_shell)

    agent_screenshot = agent_sub.add_parser("screenshot", help="capture a device screenshot and return the local path")
    add_agent_options(agent_screenshot)
    agent_screenshot.add_argument("--serial", required=True)
    agent_screenshot.add_argument("--include-image-data", action="store_true", help="include base64 data URL in JSON")
    agent_screenshot.set_defaults(func=cmd_agent_screenshot)

    agent_dump = agent_sub.add_parser("dump", help="capture screenshot + UI XML and return parsed nodes/matches")
    add_agent_options(agent_dump)
    agent_dump.add_argument("--serial", required=True)
    agent_dump.add_argument("--query", default="", help="text/id/class/package substring to match")
    agent_dump.add_argument("--clickable-only", action="store_true", help="only include clickable matches")
    agent_dump.add_argument("--limit", default=30, type=int)
    agent_dump.add_argument("--format", choices=["summary", "nodes", "raw"], default="summary")
    agent_dump.add_argument("--include-image-data", action="store_true", help="include base64 data URL in JSON")
    agent_dump.set_defaults(func=cmd_agent_dump)

    agent_inspect = agent_sub.add_parser("inspect", help="return top activity plus parsed dump summary")
    add_agent_options(agent_inspect)
    agent_inspect.add_argument("--serial", required=True)
    agent_inspect.add_argument("--query", default="", help="optional dump query")
    agent_inspect.add_argument("--clickable-only", action="store_true")
    agent_inspect.add_argument("--limit", default=20, type=int)
    agent_inspect.set_defaults(func=cmd_agent_inspect)

    agent_top_activity = agent_sub.add_parser("top-activity", help="inspect current foreground package/activity")
    add_agent_options(agent_top_activity)
    agent_top_activity.add_argument("--serial", required=True)
    agent_top_activity.set_defaults(func=cmd_agent_top_activity)

    agent_apps = agent_sub.add_parser("apps", help="list device apps")
    add_agent_options(agent_apps)
    agent_apps.add_argument("--serial", required=True)
    agent_apps.add_argument("--include-system", action=argparse.BooleanOptionalAction, default=True)
    agent_apps.add_argument("--quick", action="store_true", help="prefer quick package listing")
    agent_apps.add_argument("--skip-permissions", action="store_true")
    agent_apps.add_argument("--force-refresh", action="store_true")
    agent_apps.set_defaults(func=cmd_agent_apps)

    agent_clipboard = agent_sub.add_parser("clipboard", help="read or write device clipboard")
    add_agent_options(agent_clipboard)
    agent_clipboard.add_argument("clipboard_action", choices=["read", "write"])
    agent_clipboard.add_argument("--serial", required=True)
    agent_clipboard.add_argument("--text", default="")
    agent_clipboard.set_defaults(func=cmd_agent_clipboard)

    agent_workflow = agent_sub.add_parser("workflow", help="create, preview, or run CQClaw workflow JSON")
    workflow_sub = agent_workflow.add_subparsers(dest="workflow_action", required=True)

    workflow_schema = workflow_sub.add_parser("schema", help="print workflow schema and step templates")
    add_agent_options(workflow_schema)
    workflow_schema.set_defaults(func=cmd_agent_workflow_schema)

    workflow_preview = workflow_sub.add_parser("preview", help="preview workflow commands without executing them")
    add_agent_options(workflow_preview)
    workflow_preview.add_argument("--file", required=True)
    workflow_preview.add_argument("--devices", default="", help="comma-separated serial list; overrides workflow devices")
    workflow_preview.set_defaults(func=cmd_agent_workflow_preview)

    workflow_run = workflow_sub.add_parser("run", help="execute workflow JSON")
    add_agent_options(workflow_run)
    workflow_run.add_argument("--file", required=True)
    workflow_run.add_argument("--devices", default="", help="comma-separated serial list; overrides workflow devices")
    workflow_run.set_defaults(func=cmd_agent_workflow_run)

    agent_call = agent_sub.add_parser("call", help="call a CQClaw HTTP API endpoint directly")
    add_agent_options(agent_call)
    agent_call.add_argument("method", choices=["GET", "POST", "get", "post"])
    agent_call.add_argument("path", help="API path, e.g. /api/health")
    agent_call.add_argument("--data", default="", help="JSON request body for POST")
    agent_call.set_defaults(func=cmd_agent_call)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
