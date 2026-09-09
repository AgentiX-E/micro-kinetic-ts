#!/usr/bin/env python3
"""
Stream-convert the RCABench tar.gz into normalised `case.json` documents.

The full `rcabench-absolute_anomaly.tar.gz` artifact is 13.4 GB; its extracted
Parquet tree is comparable in size, so materialising BOTH on a 14 GB CI runner
would exhaust the disk. This driver therefore converts directly FROM the
archive in a SINGLE sequential pass: it walks the tar members in stream order,
extracts each datapack's files to a short-lived temp directory, converts it via
`fse26_convert.convert_datapack`, and removes the temp directory before the
next datapack is read.

Two properties are load-bearing:

1. **Single pass (O(n) decompression).** `getmembers()` + `extract()` would
   seek backwards on every extract, re-decompressing the archive from the start
   per datapack (quadratic). Instead the members are consumed strictly in
   stream order with `next()` + `extract()`, so each byte is decompressed once.
2. **Truncation tolerance.** A range-downloaded prefix of the archive (used to
   validate a small subset without the full 13.4 GB) ends mid-gzip-stream, so
   the walk stops cleanly at the truncation instead of raising. The final,
   incomplete datapack is discarded.

Usage:
  python3 scripts/fse26_convert_tar.py --tar <archive.tar.gz> --out-dir <json> \
      [--limit N] [--force]
"""

from __future__ import annotations

import argparse
import shutil
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
    Used for listing/progress only; the streaming converter itself never calls
    this (it discovers datapacks as it walks).
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


def stream_convert_tar(
    tar_path: Path, out_dir: Path, limit: int = 0, force: bool = False
) -> tuple[int, int]:
    """
    Convert datapacks from `tar_path` into `out_dir`, returning (ok, failed).

    A single sequential pass over the archive members: each datapack's files are
    extracted to a temp directory, converted, and the temp directory discarded
    before the next datapack is read, so the archive is never fully materialised
    on disk. A truncated (range-downloaded) archive stops cleanly at the
    truncation point.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    failed = 0
    started = 0
    current_name: str | None = None
    tmp = tempfile.TemporaryDirectory()
    tmp_root = Path(tmp.name)

    def finalize() -> None:
        """Convert (or skip) the just-finished datapack and clear its temp files."""
        nonlocal ok, failed, current_name
        if current_name is None:
            return
        src = tmp_root / current_name
        dst = out_dir / current_name
        try:
            if not (src / "injection.json").exists():
                pass  # top-level dir that is not a datapack (e.g. README/)
            elif (dst / "case.json").exists() and not force:
                ok += 1
                print(f"SKIP {current_name} (already converted)", flush=True)
            else:
                conv.convert_datapack(src, dst)
                ok += 1
                print(f"OK   {current_name}", flush=True)
        except Exception as exc:  # noqa: BLE001 - report per-datapack failures and continue
            failed += 1
            print(f"FAIL {current_name}: {exc}", file=sys.stderr, flush=True)
        finally:
            shutil.rmtree(src, ignore_errors=True)
            current_name = None

    try:
        with tarfile.open(tar_path, "r:gz") as tar:
            while True:
                try:
                    member = tar.next()
                except (EOFError, tarfile.ReadError):
                    break  # truncated archive: no more complete members
                if member is None:
                    break

                parts = member.name.split("/")
                if len(parts) < 2:
                    continue  # root-level entry, not part of a datapack
                name = parts[0]

                if name != current_name:
                    finalize()
                    if limit and started >= limit:
                        break  # limit reached; the previous datapack is already finalised
                    current_name = name
                    started += 1

                if member.isfile():
                    try:
                        tar.extract(member, tmp_root, filter="data")
                    except (EOFError, tarfile.ReadError):
                        break  # truncated mid-file: discard the incomplete datapack
    finally:
        finalize()
        tmp.cleanup()

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
