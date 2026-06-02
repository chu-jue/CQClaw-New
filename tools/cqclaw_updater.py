#!/usr/bin/env python3
"""Temporary updater process for CQClaw.

This script is copied to the OS temp directory before it runs, so Windows can
replace files inside the project directory without the active CLI process
holding handles there.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path


PROTECTED_TOP_LEVEL = {
    ".git",
    ".venv",
    "__pycache__",
    "data",
}


def log_line(log_path: Path, message: str) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n"
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_cli(root: Path, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    cli = root / "tools" / "aas_cli.py"
    return subprocess.run(
        [sys.executable, str(cli), *args],
        cwd=str(root),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def backup_project(root: Path, backup_dir: Path, version: str) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    safe_version = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in (version or "unknown"))
    backup_path = backup_dir / f"cqclaw-backup-{safe_version}-{time.strftime('%Y%m%d-%H%M%S')}.zip"
    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in root.rglob("*"):
            rel = path.relative_to(root)
            if not rel.parts or rel.parts[0] in PROTECTED_TOP_LEVEL:
                continue
            if path.is_dir():
                continue
            archive.write(path, rel.as_posix())
    return backup_path


def extract_package(package_path: Path, staging_dir: Path) -> Path:
    if staging_dir.exists():
        shutil.rmtree(staging_dir)
    staging_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(package_path, "r") as archive:
        archive.extractall(staging_dir)
    if (staging_dir / "server.py").exists():
        return staging_dir
    candidates = [path for path in staging_dir.iterdir() if path.is_dir() and (path / "server.py").exists()]
    if len(candidates) == 1:
        return candidates[0]
    raise RuntimeError("update package does not contain server.py at root or a single top-level app folder")


def should_skip(rel: Path) -> bool:
    return bool(rel.parts) and rel.parts[0] in PROTECTED_TOP_LEVEL


def copy_payload(payload_root: Path, root: Path) -> None:
    for source in payload_root.rglob("*"):
        rel = source.relative_to(payload_root)
        if should_skip(rel):
            continue
        target = root / rel
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp_target = target.with_name(f".{target.name}.new")
        shutil.copy2(source, tmp_target)
        os.replace(tmp_target, target)


def write_version_if_missing(root: Path, target_version: str) -> None:
    if target_version and not (root / "version.txt").exists():
        (root / "version.txt").write_text(target_version + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="CQClaw temporary updater")
    parser.add_argument("--root", required=True)
    parser.add_argument("--package", required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--target-version", default="")
    parser.add_argument("--log", required=True)
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default="8765")
    parser.add_argument("--open-path", default="/log-insight.html")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    package_path = Path(args.package).expanduser().resolve()
    log_path = Path(args.log).expanduser()
    updates_dir = root / "data" / "updates"
    staging_dir = updates_dir / "staging" / f"cqclaw-{int(time.time())}"
    backup_dir = updates_dir / "backups"

    try:
        log_line(log_path, "update started")
        actual_sha = sha256_file(package_path)
        if actual_sha.lower() != args.sha256.lower():
            raise RuntimeError(f"sha256 mismatch: expected {args.sha256}, got {actual_sha}")
        stop_result = run_cli(root, "stop", timeout=90)
        log_line(log_path, f"stop exit={stop_result.returncode}")
        if stop_result.stdout:
            log_line(log_path, stop_result.stdout.strip())
        if stop_result.stderr:
            log_line(log_path, stop_result.stderr.strip())
        if stop_result.returncode != 0:
            raise RuntimeError("failed to stop running service before update")

        backup_path = backup_project(root, backup_dir, args.target_version)
        log_line(log_path, f"backup: {backup_path}")
        payload_root = extract_package(package_path, staging_dir)
        log_line(log_path, f"payload: {payload_root}")
        copy_payload(payload_root, root)
        write_version_if_missing(root, args.target_version)
        log_line(log_path, "files replaced")

        if args.restart:
            start_result = run_cli(root, "start", "--host", args.host, "--port", args.port, "--open-path", args.open_path, "--no-open", timeout=120)
            log_line(log_path, f"restart exit={start_result.returncode}")
            if start_result.stdout:
                log_line(log_path, start_result.stdout.strip())
            if start_result.stderr:
                log_line(log_path, start_result.stderr.strip())
            if start_result.returncode != 0:
                raise RuntimeError("update finished but restart failed")
        log_line(log_path, "update finished")
        return 0
    except Exception as exc:
        log_line(log_path, f"update failed: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
