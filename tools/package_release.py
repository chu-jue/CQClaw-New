#!/usr/bin/env python3
"""Create CQClaw release packages.

Windows installer EXE builds require Inno Setup on Windows:
  powershell -ExecutionPolicy Bypass -File packaging/windows/build-inno.ps1

This script creates source installer zips for Windows/macOS and can invoke the
Windows Inno build when running on a Windows machine with ISCC.exe available.
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


EXCLUDE_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "gen",
    "node_modules",
    "target",
    "dist",
    "build",
}

EXCLUDE_FILES = {
    ".DS_Store",
}


def read_version() -> str:
    path = ROOT / "version.txt"
    if path.exists():
        value = path.read_text(encoding="utf-8", errors="replace").strip()
        if value:
            return value
    return "dev"


def should_skip(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    parts = set(rel.parts)
    if parts & EXCLUDE_DIRS:
        return True
    if rel.as_posix().startswith("data/runtime/") or rel.as_posix().startswith("data/tmp-scripts/"):
        return True
    if path.name in EXCLUDE_FILES:
        return True
    if path.suffix in {".pyc", ".pyo"}:
        return True
    return False


def copy_tree(target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    for source in ROOT.rglob("*"):
        if should_skip(source):
            continue
        relative = source.relative_to(ROOT)
        destination = target / relative
        if source.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)


def make_zip(name: str) -> Path:
    DIST.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="cqclaw-release-") as tmp:
        staging = Path(tmp) / name
        copy_tree(staging)
        archive_base = DIST / name
        archive_path = shutil.make_archive(str(archive_base), "zip", root_dir=Path(tmp), base_dir=name)
        return Path(archive_path)


def build_windows_inno() -> int:
    script = ROOT / "packaging" / "windows" / "build-inno.ps1"
    if platform.system().lower() != "windows":
        print("Windows Inno EXE build must run on Windows with Inno Setup installed.", file=sys.stderr)
        print(f"Run: powershell -ExecutionPolicy Bypass -File {script}", file=sys.stderr)
        return 2
    command = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script)]
    return subprocess.call(command, cwd=str(ROOT))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build CQClaw release packages")
    parser.add_argument("--windows-zip", action="store_true", help="build a Windows installer source zip")
    parser.add_argument("--macos-zip", action="store_true", help="build a macOS installer source zip")
    parser.add_argument("--inno", action="store_true", help="build the Windows Inno Setup EXE on Windows")
    parser.add_argument("--all", action="store_true", help="build both zips and Inno EXE when possible")
    args = parser.parse_args(argv)

    if not any((args.windows_zip, args.macos_zip, args.inno, args.all)):
        args.windows_zip = True
        args.macos_zip = True

    version = read_version()
    outputs = []
    if args.all or args.windows_zip:
        outputs.append(make_zip(f"CQClaw-{version}-windows-source"))
    if args.all or args.macos_zip:
        outputs.append(make_zip(f"CQClaw-{version}-macos"))
    if args.all or args.inno:
        code = build_windows_inno()
        if code != 0 and args.inno:
            return code

    for output in outputs:
        print(f"created: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
