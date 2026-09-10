#!/usr/bin/env python3
"""
Shard converted FSE'26 RCABench ``case.json`` files into per-category tarballs.

The Parquet → JSON bridge (``fse26_convert_tar.py``) emits one ``case.json`` per
datapack under a flat output root (``<out>/<datapack>/case.json``). Those
documents total ~48.9 GB for the full dataset — too large to cache or upload as
a single blob. This script groups them by their recorded ``faultCategory`` (one
of the 7 benchmark categories) and emits one ``rcabench-<category>.tar.gz`` per
category, so the benchmark can download only the categories it needs.

Each tarball archives its cases at ``<datapack>/case.json``, so extracting a
shard reproduces the exact flat layout the FSE'26 runner discovers — no
conversion is re-run and no TypeScript change is required.

Usage:
  python3 scripts/fse26_shard.py --out-dir <converted-json-root>
"""

from __future__ import annotations

import argparse
import json
import sys
import tarfile
from pathlib import Path
from typing import Any


def discover_case_paths(out_dir: Path) -> list[Path]:
    """
    Return the sorted ``<datapack>/case.json`` paths directly under `out_dir`.

    Matches the flat bridge layout (one level of datapack directories), not a
    recursive walk.
    """
    return sorted(out_dir.glob("*/case.json"))


def read_category(case_path: Path) -> str:
    """Return the ``faultCategory`` recorded in a case document's header."""
    case = json.loads(case_path.read_text("utf-8"))
    return case["faultCategory"]


def write_shard(shard_path: Path, case_paths: list[Path], base: Path) -> None:
    """
    Write a gzip tarball of `case_paths`, archiving each as ``<dp>/case.json``.

    `base` is the converted output root; each entry's arcname is its path
    relative to `base`, so extraction reproduces the flat layout.
    """
    with tarfile.open(shard_path, "w:gz") as tar:
        for case_path in case_paths:
            tar.add(case_path, arcname=str(case_path.relative_to(base)))


def shard(out_dir: Path) -> dict[str, Any]:
    """
    Group the converted cases by ``faultCategory`` and emit per-category shards.

    Writes ``<out>/rcabench-<category>.tar.gz`` for each non-empty category and a
    ``<out>/manifest.json`` describing the shards, then returns the manifest.
    """
    groups: dict[str, list[Path]] = {}
    for case_path in discover_case_paths(out_dir):
        groups.setdefault(read_category(case_path), []).append(case_path)

    shards: list[dict[str, Any]] = []
    for category in sorted(groups):
        case_paths = sorted(groups[category], key=lambda p: p.parent.name)
        shard_path = out_dir / f"rcabench-{category}.tar.gz"
        write_shard(shard_path, case_paths, out_dir)
        shards.append(
            {
                "category": category,
                "cases": len(case_paths),
                "shard": shard_path.name,
                "bytes": shard_path.stat().st_size,
            }
        )

    manifest: dict[str, Any] = {
        "totalCases": sum(s["cases"] for s in shards),
        "shards": shards,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), "utf-8"
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Shard converted FSE'26 case.json files by fault category."
    )
    parser.add_argument("--out-dir", required=True, help="Converted JSON output root.")
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    if not out_dir.exists():
        print(f"ERROR: output directory not found: {out_dir}", file=sys.stderr)
        return 1

    manifest = shard(out_dir)
    for entry in manifest["shards"]:
        print(
            f"{entry['category']}: {entry['cases']} cases -> "
            f"{entry['shard']} ({entry['bytes']} bytes)",
            flush=True,
        )
    print(f"Sharded {manifest['totalCases']} cases into {len(manifest['shards'])} shards", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
