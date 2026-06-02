#!/usr/bin/env python3
"""Generate release metadata for CQClaw artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_version() -> str:
    version_file = ROOT / "version.txt"
    if version_file.exists():
        version = version_file.read_text(encoding="utf-8", errors="replace").strip()
        if version:
            return version
    return "dev"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_assets(dist: Path, output_name: str) -> list[dict[str, object]]:
    assets: list[dict[str, object]] = []
    for path in sorted(dist.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(dist).as_posix()
        if relative == output_name:
            continue
        assets.append(
            {
                "name": relative,
                "size": path.stat().st_size,
                "sha256": sha256(path),
            }
        )
    return assets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", default="dist", help="distribution directory")
    parser.add_argument("--output", default="release-manifest.json", help="manifest filename")
    args = parser.parse_args()

    dist = (ROOT / args.dist).resolve()
    dist.mkdir(parents=True, exist_ok=True)

    version = read_version()
    tag = os.environ.get("GITHUB_REF_NAME") or f"v{version}"
    manifest = {
        "name": "CQClaw",
        "version": version,
        "tag": tag,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "assets": build_assets(dist, args.output),
    }

    output = dist / args.output
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
