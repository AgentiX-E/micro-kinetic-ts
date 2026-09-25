#!/usr/bin/env python3
"""
The identity of the converted RCAEval artifact (`~/RCAEval-json`): its key, and its stamp.

**The defect this module was written against, measured on 2026-09-25.**

`.github/workflows/cache-datasets.yml` declares, of itself:

    on:
      push:
        paths:
          - 'scripts/convert-parquet-to-json.py'

— *run when the bridge changes* — and then keys the artifact's cache on the constant `RCAEvalJSON`.
A constant cannot notice a change in what it caches, so the trigger and the key contradicted each
other, and the key won:

| run | commit | `Restore cached JSON` | `Convert Parquet to JSON` |
| --- | --- | --- | --- |
| `35505798520` | `2b15f6e` — **the commit that fixed the bridge** | hit, 2 min 27 s | **skipped** |
| `35496563670` | `1990ee74` | hit | skipped |
| `34744258810` | `debf820c` | hit | skipped |
| `34017255876` | `dc1b418b` | hit | skipped |
| `33299890322` | `2770096b` | hit | skipped |
| `32614070810` | `58ea21a8` | hit | skipped |
| `32103694992` | `913dbffd` | hit | skipped |
| `31922943703` | `15a8f1d8` | hit | skipped |
| `31292437613` | `f2fd7c51` | hit | skipped |
| `31244207795` | `27e93e17` | hit | skipped |

**Eleven runs since 2026-08-08 reached that step — ten `skipped` and one cancelled — and eight of the
eleven were the weekly schedule**, whose own declaration is "Weekly refresh (Sunday 2am UTC)". The
last conversion was `31242187872` on **2026-08-08**, where the unpinned `pip install pandas pyarrow`
resolved to **pandas 3.0.5 / pyarrow 25.0.0** — a fact recoverable only from that run's log, because
nothing in the artifact, the key or the workflow records it. The 39 GB artifact the golden nine-cell
is read from is 48 days old as this is written and its producer is unrecorded; the fix that was
*supposed* to invalidate it (`2b15f6e`) could not.

**The same constant was typed at twenty-six sites in eleven workflows.** `benchmark-rcaeval.yml`
alone restored this path in seven jobs with `key: RCAEvalJSON`, so the artifact's name lived
twenty-six times and named nothing in any of them. And `restore-keys: RCAEval-json-` cannot match
that key — a restore key matches by PREFIX, and `RCAEvalJSON` does not begin with `RCAEval-json-` —
so the fallback was dead at all twenty-six.

**What this module owns.** One declaration — {@link PRODUCER_FILES} — is the set of files that
decide the converted bytes, and every consequence is derived from it: the cache key, the stamp
written beside the artifact, the verification at use time, and (via the fence) the workflow's
`paths:` trigger. Add a file to the set and the trigger, the key and the stamp all move together,
which is what makes the four unable to drift apart again.

The digest law itself is not re-stated here: `fse26_provenance.digest_over` is its single owner and
this module supplies only its file set. Verified at use time rather than assumed, because a stamp
that is merely written is a note; `verify_stamp` is what makes it a refusal.

**Two boundaries, stated rather than left implicit.**

1. The stamp records the interpreter that produced the artifact, and `verify_stamp` does **not**
   compare it against the verifier's own. The values in the artifact are decided by pandas and
   pyarrow, which the digest covers as pinned files; the interpreter's contribution is the float
   representation in the JSON, which CPython has emitted by shortest-round-trip since 3.1. The
   commitment that *is* enforced is the producing file set, because that is the one that decides the
   numbers. {@link PRODUCER_PYTHON} is asserted against the workflow that runs the bridge, so the
   producer's interpreter cannot drift without the fence failing.
2. The Parquet LAYER (`~/RCAEval-data`) is a different question and is deliberately not derived
   here: its identity is an upstream Hugging Face revision, which this repository cannot compute and
   this environment cannot resolve. It is carried as `RCAEval-datasets-v2-pq`, a hand-bumped
   constant, on {@link UPSTREAM_CONSTANT_KEYS} with that reason — named rather than silently
   accepted, and named rather than changed for a 3.3 GB re-download whose effect could not be
   measured here.

Usage::

    # The cache key, in the form `$GITHUB_OUTPUT` wants (used by the composite action).
    python3 scripts/rcaeval_provenance.py --root scripts --key

    # Stamp the artifact just converted, so it can state its own producer.
    python3 scripts/rcaeval_provenance.py --root scripts --stamp --out-dir "$HOME/RCAEval-json"

    # Refuse a restored artifact whose producer is not this checkout.
    python3 scripts/rcaeval_provenance.py --root scripts --verify --out-dir "$HOME/RCAEval-json"
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path
from typing import Any

from fse26_provenance import (
    DIGEST_PREFIX,
    converter_revision,
    digest_over,
    sha256_file,
)

#: Everything that decides the converted bytes. Adding or editing any entry changes the digest and
#: thereby the cache key, so the next run of `cache-datasets.yml` converts instead of restoring --
#: which is the whole point, and is what `2b15f6e` discovered it could not do. The dependency pin is
#: in the set for the reason `requirements-fse26.txt` is in the FSE'26 set: the library that reads
#: the Parquet decides the values written. Test-only tooling is deliberately absent: bumping a test
#: runner must not force a 20-minute rebuild, or the signal would be buried in noise.
PRODUCER_FILES: tuple[str, ...] = (
    "convert-parquet-to-json.py",
    "requirements-rcaeval.txt",
)

#: The cache key's prefix. The digest is appended, so the name a reader sees still says WHICH
#: artifact this is while the suffix says which producer made it.
KEY_PREFIX = "RCAEvalJSON-"

#: How many hex characters of the digest the key carries. 16 hex characters is 64 bits; the key is
#: not a security boundary, it is a change detector, and GitHub caps a key at 512 characters.
KEY_DIGEST_CHARS = 16

#: The file written beside the artifact. A leading dot and no extension, both for one reason: nine
#: separate walkers descend `~/RCAEval-json` looking for case directories, and every one of them
#: admits an entry only when it is a directory AND its name does not start with a dot
#: (`run-rcaeval.ts`, `run-ablation.ts`, `run-optimize.ts`, `run-fse26.ts`, `run-prism.ts`,
#: `dump-re3-metrics.ts`, `dump-re3-exceptions.ts`, `dump-bothwrong-evidence.ts`,
#: `dump-loss-metrics.ts`). The workflow's own census counts `*.json`, `*.csv` and `*.txt`, so a
#: stamp with any of those suffixes would be counted as an artifact. Checked by
#: `test_rcaeval_provenance.TheStampIsInvisibleToEveryReader`, which reads those walkers.
STAMP_NAME = ".rcaeval-provenance"

#: The stamp block's own version, bumped when the block's SHAPE changes so a consumer can tell an
#: old stamp from a new one without probing for fields -- the same reason `fse26_provenance` has one.
SCHEMA_VERSION = 1

#: The interpreter the bridge runs under in `cache-datasets.yml`, asserted by the fence against that
#: workflow's `python-version`. `converter-tests` measures the bridge under 3.13; that divergence is
#: a MEASURED row, not an oversight -- it is held this iteration because the artifact's producer is
#: already moving twice over (the bridge's behaviour and its dependency pins), and a third moving
#: part would make a golden reading unattributable.
PRODUCER_PYTHON = "3.12"

#: Cache keys that name content this repository did not produce, each with the reason it cannot be
#: derived, and each MARKED so the fence can require it to still exist. A key that caches a
#: repository-produced artifact may not appear here -- that is the rule this iteration is about.
UPSTREAM_CONSTANT_KEYS: dict[str, str] = {
    "RCAEval-datasets-v2-pq": (
        "the raw Parquet snapshot from the upstream Hugging Face dataset; its identity is an "
        "upstream revision that neither the bridge nor this repository computes, and the change to "
        "derive it would force a 3.3 GB re-download whose effect on the golden cannot be measured "
        "from here. Its `v2` suffix is a HAND bump, which is the same defect one layer up and is "
        "named as a follow-up rather than fixed in the same commit as the layer below"
    ),
}

DEFAULT_ROOT = Path(__file__).resolve().parent


def producer_digest(root: Path) -> str:
    """
    Return the digest over {@link PRODUCER_FILES} under `root`.

    The law is `fse26_provenance.digest_over`'s; this function supplies only the file set, so the two
    artifacts' digests cannot disagree about what a digest is.

    @param root - The directory holding the bridge and its pin file.
    @returns The ``sha256:...`` digest.
    """
    return digest_over(root, PRODUCER_FILES)


def cache_key(root: Path) -> str:
    """
    Return the cache key that names the artifact `root`'s bridge produces.

    Content-addressed, not revision-addressed: two checkouts whose producer files are identical get
    the same key whatever their commit, and a checkout whose producer differs gets a different key
    even if nothing else moved. A key derived from a revision would evict on every unrelated commit,
    and a key that is a constant evicts on nothing — this is the third option and the only one that
    tracks the thing it names.

    @param root - The directory holding the bridge and its pin file.
    @returns The key, `<KEY_PREFIX><KEY_DIGEST_CHARS> hex characters`.
    """
    digest = producer_digest(root)
    return KEY_PREFIX + digest.removeprefix(DIGEST_PREFIX)[:KEY_DIGEST_CHARS]


def stamp_path(out_dir: Path) -> Path:
    """
    Return the path of the stamp beside an artifact directory.

    @param out_dir - The artifact's root.
    @returns The stamp's path.
    """
    return out_dir / STAMP_NAME


def stamp_block(root: Path) -> dict[str, Any]:
    """
    Return the block written beside the artifact: what produced it, and when.

    @param root - The directory holding the bridge and its pin file.
    @returns The stamp block.
    """
    return {
        "schemaVersion": SCHEMA_VERSION,
        "producerDigest": producer_digest(root),
        "producerRevision": converter_revision(root),
        "producerPython": ".".join(platform.python_version_tuple()[:2]),
        "bridge": PRODUCER_FILES[0],
        "pinned": PRODUCER_FILES[1],
        "pinnedSha256": sha256_file(root / PRODUCER_FILES[1]),
    }


def write_stamp(out_dir: Path, root: Path) -> Path:
    """
    Write the stamp beside the artifact at `out_dir`, creating the directory if needed.

    @param out_dir - The artifact's root.
    @param root - The directory holding the bridge and its pin file.
    @returns The stamp's path.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    path = stamp_path(out_dir)
    path.write_text(json.dumps(stamp_block(root), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def verify_stamp(out_dir: Path, root: Path) -> list[str]:
    """
    Return the reasons `out_dir` is not the artifact this checkout's bridge produces.

    An empty list means the artifact states this producer. A missing stamp is reported as a failure
    rather than skipped: "no stamp recorded" is precisely the unknown case, and an unknown artifact
    is the thing this module exists to refuse.

    @param out_dir - The artifact's root.
    @param root - The directory holding the bridge and its pin file.
    @returns One string per problem, empty when there is none.
    """
    path = stamp_path(out_dir)
    if not path.is_file():
        return [
            f"no stamp at {path}: the artifact's producer is unknown, which is what this check "
            f"refuses (an artifact converted before this check existed, or a cache restored under a "
            f"key nothing derived)"
        ]

    try:
        recorded = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"stamp at {path} is unreadable: {exc}"]

    problems: list[str] = []
    if recorded.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(
            f"stamp schemaVersion={recorded.get('schemaVersion')!r}, expected {SCHEMA_VERSION}"
        )
    expected = producer_digest(root)
    if recorded.get("producerDigest") != expected:
        problems.append(
            f"producerDigest mismatch: artifact was produced by {recorded.get('producerDigest')}, "
            f"this checkout's bridge is {expected} -- the artifact is another bridge's, and it must "
            f"be reconverted rather than read"
        )
    return problems


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """
    Parse the command line.

    @param argv - The arguments, defaulting to `sys.argv[1:]`.
    @returns The parsed namespace.
    """
    parser = argparse.ArgumentParser(
        description="Derive, stamp or verify the identity of the converted RCAEval artifact."
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help="Directory holding the bridge and its pin file (default: this file's directory).",
    )
    parser.add_argument(
        "--key", action="store_true", help="Print `key=<value>`, the form $GITHUB_OUTPUT wants."
    )
    parser.add_argument("--stamp", action="store_true", help="Write the stamp for --out-dir.")
    parser.add_argument("--verify", action="store_true", help="Refuse --out-dir if its stamp differs.")
    parser.add_argument("--out-dir", type=Path, help="The artifact's root (required with --stamp/--verify).")
    args = parser.parse_args(argv)

    chosen = [flag for flag, on in (("--key", args.key), ("--stamp", args.stamp), ("--verify", args.verify)) if on]
    if len(chosen) != 1:
        parser.error(f"pass exactly one of --key / --stamp / --verify (got {chosen or 'none'})")
    if chosen[0] != "--key" and args.out_dir is None:
        parser.error(f"{chosen[0]} needs --out-dir")
    return args


def main(argv: list[str] | None = None) -> int:
    """
    Run the command line.

    @param argv - The arguments, defaulting to `sys.argv[1:]`.
    @returns A process exit status.
    """
    args = parse_args(argv)
    try:
        if args.key:
            print(f"key={cache_key(args.root)}")
            return 0
        if args.stamp:
            path = write_stamp(args.out_dir, args.root)
            print(f"stamped {path} with producer {producer_digest(args.root)}")
            return 0
        problems = verify_stamp(args.out_dir, args.root)
    except (OSError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if problems:
        for problem in problems:
            print(f"ERROR: {problem}", file=sys.stderr)
        return 1
    print(f"stamp OK: {args.out_dir} was produced by {producer_digest(args.root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
