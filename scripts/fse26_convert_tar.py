#!/usr/bin/env python3
"""
Stream-convert the RCABench tar.gz into normalised `case.json` documents.

The full `rcabench-absolute_anomaly.tar.gz` artifact is 13.4 GB; its extracted
Parquet tree is comparable in size, so materialising BOTH on a 14 GB CI runner
would exhaust the disk. This driver therefore converts directly FROM the
archive: it groups tar members by top-level datapack directory, extracts each
datapack to a short-lived temp directory, converts it via
`fse26_convert.convert_datapack`, and removes the temp directory immediately.
Peak disk stays at (archive + one datapack + JSON output) instead of (archive
+ full Parquet tree + JSON output).

Usage:
  python3 scripts/fse26_convert_tar.py --tar <archive.tar.gz> --out-dir <json> \
      [--limit N] [--force]
"""

from __future__ import annotations

import argparse
import sys
import tarfile
import tempfile
from pathlib import Path

import fse26_convert as conv


def iter_datapack_dirs(tar: tarfile.TarFile) -> list[str]:
    """
    Return the sorted top-level datapack directory names in `tar`.

    A directory qualifies as a datapack when it contains an `injection.json`
    member — the same predicate `_discover_datapacks` uses on an extracted tree.
    """
    members_by_dir: dict[str, list[tarfile.TarInfo]] = {}
    for member in tar.getmembers():
        if not member.isfile():
            continue
        parts = member.name.split("/")
        if len(parts) < 2:
            continue
        top = parts[0]
        members_by_dir.setdefault(top, []).append(member)

    datapack_dirs: list[str] = []
    for name, members in members_by_dir.items():
        if any(m.name == f"{name}/injection.json" for m in members):
            datapack_dirs.append(name)
    datapack_dirs.sort()
    return datapack_dirs


def stream_convert_tar(tar_path: Path, out_dir: Path, limit: int = 0, force: bool = False) -> tuple[int, int]:
    """
    Convert datapacks from `tar_path` into `out_dir`, returning (ok, failed).

    Each datapack directory is extracted to a temporary directory, converted,
    and the temporary directory discarded before the next datapack is read, so
    the archive is never fully materialised on disk.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    with tarfile.open(tar_path, "r:gz") as tar:
        datapack_dirs = iter_datapack_dirs(tar)
        if limit:
            datapack_dirs = datapack_dirs[:limit]

        ok = 0
        failed = 0
        total = len(datapack_dirs)
        print(f"Converting {total} datapacks from {tar_path} to {out_dir}", flush=True)

        for index, name in enumerate(datapack_dirs, start=1):
            dst_dir = out_dir / name
            if (dst_dir / "case.json").exists() and not force:
                print(f"[{index}/{total}] SKIP {name} (already converted)", flush=True)
                ok += 1
                continue
            try:
                with tempfile.TemporaryDirectory() as tmp:
                    tmp_root = Path(tmp)
                    # Extract only this datapack's members (they share the
                    # `name/` prefix), preserving the directory layout so
                    # `convert_datapack` reads `name/injection.json` etc.
                    for member in tar.getmembers():
                        if member.isfile() and member.name.startswith(name + "/"):
                            tar.extract(member, tmp_root, filter="data")
                    src = tmp_root / name
                    conv.convert_datapack(src, dst_dir)
                ok += 1
                print(f"[{index}/{total}] OK   {name}", flush=True)
            except Exception as exc:  # noqa: BLE001 - report per-datapack failures and continue
                failed += 1
                print(f"[{index}/{total}] FAIL {name}: {exc}", file=sys.stderr, flush=True)

    return ok, failed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Stream-convert the RCABench tar.gz into normalised JSON."
    )
    parser.add_argument("--tar", required=True, help="Path to rcabench-absolute_anomaly.tar.gz.")
    parser.add_argument("--out-dir", required=True, help="Output JSON root.")
    parser.add_argument("--limit", type=int, default=0, help="Only convert the first N datapacks.")
    parser.add_argument("--force", action="store_true", help="Re-convert already-converted datapacks.")
    args = parser.parse_args(argv)

    tar_path = Path(args.tar)
    if not tar_path.exists():
        print(f"ERROR: archive not found: {tar_path}", file=sys.stderr)
        return 1

    ok, failed = stream_convert_tar(tar_path, Path(args.out_dir), args.limit, args.force)
    print(f"Done: {ok} converted/skipped, {failed} failed", flush=True)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
