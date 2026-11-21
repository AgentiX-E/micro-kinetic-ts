#!/usr/bin/env python3
"""
Select the cached shard set that was produced by *this* checkout's converter.

The FSE'26 consumer used to name its cache with a human-maintained tag, and that
tag went stale exactly once per converter change. The failure is silent in the
direction that matters: `rcabench-latency-full` still carries a valid manifest
for converter ``f83af14d…`` while this checkout computes ``f72899e5…``, so a bare
dispatch is refused by `scripts/fse26_provenance.py` and the operator has to work
out *which* tag the current revision produced by downloading manifests by hand.
On 2026-11-10 that refusal named two digests and no tag, and the answer was a
release whose name (`rcabench-pod-v1`) describes the converter change rather
than the twenty-month-old cache it replaced.

This module removes the name from the decision. The identification of a cache is
its recorded ``converterDigest`` -- the same field the consumer's gate already
checks -- so the tag can be DISCOVERED from the digest instead of remembered.
Selection is deliberately not "pick anything that looks close":

* a candidate whose manifest predates provenance (no digest) is `unknown` and
  never matches, because an unknown cache is not a matching cache;
* zero matches is a REFUSAL that lists every candidate and its digest, so the
  operator can see that a rebuild is needed rather than that a name is wrong;
* two matches is a REFUSAL too. Two tags built by one converter revision may
  still differ in their source data, and choosing between them by name order
  would be the same class of defect this module exists to remove. The operator
  pins `shard_tag` explicitly when that happens.

Usage::

    # The workflow discovers the tags and their manifests, then asks this module.
    python3 scripts/fse26_cache_select.py --expected sha256:f72899e5… \\
        --candidates $HOME/rcabench/candidates.txt

`candidates.txt` is one ``tag<TAB>digest`` line per release; an empty digest
means "that release has no recorded provenance".
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Mapping


class NoMatchingCache(Exception):
    """Raised when no candidate was built by the expected converter revision."""


class AmbiguousCache(Exception):
    """Raised when more than one candidate was built by that revision."""


def parse_candidates(text: str) -> dict[str, str | None]:
    """
    Parse ``tag<TAB>digest`` lines into a mapping.

    Blank lines are ignored so the caller can build the file with `>>` and no
    separator logic. A line without a separator is malformed rather than a tag
    with no digest: the empty digest has its own spelling (a trailing tab), and
    accepting both would make a truncated download look like a pre-provenance
    cache.

    Args:
        text: The file's text.

    Raises:
        ValueError: On a duplicate tag, or a line with no tab separator.
    """
    candidates: dict[str, str | None] = {}
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        tag, separator, digest = raw.partition("\t")
        if not separator:
            raise ValueError(f"line {number}: expected 'tag<TAB>digest', got {raw!r}")
        tag = tag.strip()
        if not tag:
            raise ValueError(f"line {number}: empty tag")
        if tag in candidates:
            raise ValueError(f"line {number}: duplicate tag {tag!r}")
        candidates[tag] = digest.strip() or None
    return candidates


def select_cache(candidates: Mapping[str, str | None], expected: str) -> str:
    """
    Return the single tag whose recorded digest equals `expected`.

    Args:
        candidates: Tag -> recorded digest, or None when the manifest predates
            provenance.
        expected: This checkout's converter digest.

    Raises:
        NoMatchingCache: When no candidate carries that digest.
        AmbiguousCache: When more than one does.
    """
    if not expected:
        raise NoMatchingCache("expected converter digest is empty")
    matches = sorted(
        tag for tag, digest in candidates.items() if digest is not None and digest == expected
    )
    if not matches:
        raise NoMatchingCache(expected)
    if len(matches) > 1:
        raise AmbiguousCache(", ".join(matches))
    return matches[0]


def describe(candidates: Mapping[str, str | None]) -> str:
    """Render the candidate set for a refusal message, one tag per line."""
    if not candidates:
        return "  (no candidate caches were discovered)"
    lines = []
    for tag in sorted(candidates):
        digest = candidates[tag] or "unknown (manifest predates provenance)"
        lines.append(f"  {tag}: {digest}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Entry point; returns a process exit code."""
    parser = argparse.ArgumentParser(
        description="Select the cache whose converter digest matches this checkout."
    )
    parser.add_argument("--expected", required=True, help="This checkout's converter digest.")
    parser.add_argument(
        "--candidates",
        required=True,
        help="File of 'tag<TAB>digest' lines, one per released cache.",
    )
    args = parser.parse_args(argv)

    try:
        candidates = parse_candidates(Path(args.candidates).read_text("utf-8"))
    except (OSError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    try:
        tag = select_cache(candidates, args.expected)
    except NoMatchingCache:
        print(
            "ERROR: no released cache was built by this checkout's converter "
            f"({args.expected}). Rebuild one from this revision and release it.\n"
            f"Known caches:\n{describe(candidates)}",
            file=sys.stderr,
        )
        return 1
    except AmbiguousCache as exc:
        print(
            f"ERROR: {exc} were all built by {args.expected}; the choice between them "
            "cannot be made by name. Pin `shard_tag` to the one to consume.",
            file=sys.stderr,
        )
        return 3

    print(tag)
    return 0


if __name__ == "__main__":  # pragma: no cover
    # Unreachable under `coverage run -m unittest discover`, which imports this
    # module rather than executing it; the same exclusion as `golden_run_landing.py`,
    # and the behaviour it would run is `main`, which every branch above covers.
    sys.exit(main())
