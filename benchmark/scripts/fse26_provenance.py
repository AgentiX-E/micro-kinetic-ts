#!/usr/bin/env python3
"""
Converter provenance: prove a cached shard set was produced by *this* converter.

The FSE'26 cache is built in a separate repo (``AgentiX-E/rcabench-data``) from a
``--depth 1`` clone of these ``scripts/``, published as Release assets, and
consumed later without re-running the conversion. Nothing in the converted data
says which converter produced it, so a cache built from an older revision is
indistinguishable from a current one — and consuming it publishes a wrong score
with no error anywhere.

That is not hypothetical. ``releases/latest`` resolved to ``rcabench-full-v2``
while the post-fix rebuild had been uploaded to ``rcabench-full``: re-uploading
assets with ``gh release upload --clobber`` never refreshes a release's
``published_at``, so the "latest" pointer kept serving a set built *before* the
label fan-out fix. A full CI benchmark run was dispatched against it and would
have reported the pre-fix score as the post-fix one.

This module makes that failure loud instead of silent. ``converter_digest``
hashes the converter source *set*; the sharder stamps the digest into
``manifest.json``; the consumer recomputes it from its own checkout and refuses
to run on a mismatch. A manifest without provenance fails too — an unknown cache
is not a trusted cache.

Usage::

    # Emit the provenance block for this checkout (used by the sharder).
    python3 scripts/fse26_provenance.py --root scripts --print

    # Verify a downloaded cache against this checkout, including asset integrity.
    python3 scripts/fse26_provenance.py --root scripts \
        --manifest "$HOME/rcabench/manifest.json" \
        --shard-dir "$HOME/rcabench" --categories HTTP,Network
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# Everything that decides the converted bytes. Adding or editing any entry
# changes the digest and thereby invalidates every cached shard -- which is the
# point: the consumers of those bytes must not drift from their producer.
# `fse26_shard.py` is included because it decides the archived layout, which the
# loader depends on; a layout change invalidates the cache as surely as a value
# change. The runtime dependency pin is included because polars reads and writes
# the Parquet, so a version bump moves the output too. Test-only tooling is
# deliberately kept in a separate file: bumping a test runner must not force a
# cache rebuild, or the gate would start producing false alarms.
PROVENANCE_FILES: tuple[str, ...] = (
    "fse26_convert.py",
    "fse26_convert_tar.py",
    "fse26_shard.py",
    "requirements-fse26.txt",
)

SCHEMA_VERSION = 2
DIGEST_PREFIX = "sha256:"
_CHUNK = 1 << 20


def sha256_file(path: Path) -> str:
    """Return the hex sha256 of `path`'s bytes, streamed so size is irrelevant."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def converter_digest(root: Path) -> str:
    """
    Return a ``sha256:...`` digest over the provenance files under `root`.

    Each file contributes its *name* and its bytes to one hash, in the fixed
    `PROVENANCE_FILES` order. Binding the name means swapping two files'
    contents is detectable; the fixed order and the absence of any absolute path
    make the digest independent of filesystem order and of where the checkout
    lives — which matters because the cache build copies the files flat into
    another repository.

    A missing file raises: a partially copied converter must not yield a digest
    that looks valid.
    """
    digest = hashlib.sha256()
    for name in PROVENANCE_FILES:
        path = root / name
        if not path.is_file():
            raise FileNotFoundError(f"converter source not found: {path}")
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"{DIGEST_PREFIX}{digest.hexdigest()}"


def converter_revision(root: Path) -> str:
    """
    Return the best available revision of the checkout at `root`.

    ``GITHUB_SHA`` first (the cache build runs in Actions and knows its own
    SHA), then ``git rev-parse HEAD``, then ``"unknown"``. Provenance is useless
    if it can raise, so every failure path degrades to ``"unknown"`` rather than
    propagating.
    """
    from_env = os.environ.get("GITHUB_SHA")
    if from_env:
        return from_env
    try:
        completed = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return completed.stdout.strip() or "unknown"


def built_at() -> str:
    """Return the current UTC instant as second-precision ISO 8601 (``...Z``)."""
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def provenance(root: Path, revision: str | None = None) -> dict[str, Any]:
    """Return the provenance block stamped into a shard manifest."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "builtAt": built_at(),
        "converterRevision": revision if revision is not None else converter_revision(root),
        "converterDigest": converter_digest(root),
    }


def verify_provenance(manifest: dict[str, Any], root: Path) -> list[str]:
    """
    Return the provenance mismatches between `manifest` and the converter at `root`.

    An empty list means this checkout produced that cache. A manifest predating
    provenance is reported as a failure rather than skipped: the whole purpose is
    to refuse an unknown cache, and "no digest recorded" is the unknown case.
    """
    problems: list[str] = []
    recorded_version = manifest.get("schemaVersion")
    if recorded_version != SCHEMA_VERSION:
        problems.append(
            f"manifest schemaVersion={recorded_version!r}, expected {SCHEMA_VERSION}"
        )
    recorded_digest = manifest.get("converterDigest")
    if not recorded_digest:
        problems.append(
            "manifest has no converterDigest (predates provenance): "
            "the cache's converter revision is unknown"
        )
        return problems
    expected_digest = converter_digest(root)
    if recorded_digest != expected_digest:
        problems.append(
            f"converterDigest mismatch: cache {recorded_digest}, checkout {expected_digest}"
        )
    return problems


def verify_shards(
    manifest: dict[str, Any], shard_dir: Path, categories: Iterable[str]
) -> list[str]:
    """
    Return integrity problems for the shards of `categories` under `shard_dir`.

    Only the requested categories are checked, so a partial download is not
    faulted for shards it deliberately never fetched. Size and digest are both
    reported when both fail: the digest is the authoritative check (it catches a
    same-length but different asset), while the byte count usually identifies a
    truncated download at a glance.
    """
    by_category = {entry["category"]: entry for entry in manifest.get("shards", [])}
    problems: list[str] = []
    for category in categories:
        entry = by_category.get(category)
        if entry is None:
            problems.append(f"{category}: absent from the manifest")
            continue
        path = shard_dir / entry["shard"]
        if not path.is_file():
            problems.append(f"{category}: missing shard asset {path}")
            continue
        expected_bytes = entry.get("bytes")
        actual_bytes = path.stat().st_size
        if expected_bytes != actual_bytes:
            problems.append(
                f"{category}: byte count {actual_bytes}, manifest says {expected_bytes} "
                f"(truncated, clobbered, or an entry predating size records)"
            )
        expected_digest = entry.get("sha256")
        if not expected_digest:
            problems.append(f"{category}: manifest entry has no sha256")
        elif sha256_file(path) != expected_digest:
            problems.append(f"{category}: sha256 does not match the manifest")
    return problems


def _split_categories(value: str) -> list[str]:
    """Split a comma- or whitespace-separated category list, dropping blanks."""
    return [part for part in value.replace(",", " ").split() if part]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Stamp or verify FSE'26 converter provenance."
    )
    parser.add_argument("--root", default=".", help="Directory holding the converter sources.")
    parser.add_argument("--manifest", help="manifest.json to verify against --root.")
    parser.add_argument("--shard-dir", help="Directory holding the downloaded shard assets.")
    parser.add_argument(
        "--categories",
        help="Comma- or space-separated categories to verify (default: every shard).",
    )
    parser.add_argument(
        "--print", dest="emit", action="store_true", help="Print this checkout's provenance block."
    )
    args = parser.parse_args(argv)
    root = Path(args.root)

    if args.emit:
        try:
            block = provenance(root)
        except (OSError, FileNotFoundError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        print(json.dumps(block, indent=2))
        return 0

    if not args.manifest:
        print(
            "ERROR: pass --manifest <path> to verify a cache, or --print to emit provenance",
            file=sys.stderr,
        )
        return 2

    manifest_path = Path(args.manifest)
    if not manifest_path.is_file():
        print(f"ERROR: cannot read manifest: {manifest_path}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text("utf-8"))
    try:
        problems = verify_provenance(manifest, root)
    except (OSError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    categories: list[str] = []
    if args.shard_dir:
        categories = (
            _split_categories(args.categories)
            if args.categories
            else [entry["category"] for entry in manifest.get("shards", [])]
        )
        problems += verify_shards(manifest, Path(args.shard_dir), categories)

    if problems:
        for problem in problems:
            print(f"ERROR: {problem}", file=sys.stderr)
        return 1

    print(
        f"provenance OK: converter {manifest.get('converterRevision')} "
        f"{manifest.get('converterDigest')} built {manifest.get('builtAt')}"
    )
    if args.shard_dir:
        print(f"provenance OK: {len(categories)} shard(s) verified in {args.shard_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
