#!/usr/bin/env python3
"""
Compare two FSE'26 per-case verdict files: which cases FLIPPED.

`compare_fse26_runs.py` reads the two result artefacts and compares them by fault
type, which is the right first question and not a sufficient one: a type's count can
be identical on two runs whose case sets are not, because one case was gained while
another was lost. This repository has already been bitten by the same shape one level
up — iteration 257's joint arm moved two fault types in opposite directions and the
aggregate read `+2 − 2 = 0` — and the fix there was to stop quoting aggregates for a
decision. The fix here is the tool that makes the case level visible.

Usage::

    python3 scripts/compare_fse26_per_case.py base=fse26-per-case.ndjson arm=...

The first run is the baseline. Both files must cover the same cases; a case present in
one and not the other is reported and EXCLUDED from every count, because a corpus
difference is not a flip. Correctness is recomputed from the row's own `accepted` set
and `ranked` list rather than read from a stored flag, so the judgement can be Top-1 or
Top-3 without re-running anything (`--depth`).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable


class Row:
    """One case's answer: the corpus's accepted set and the engine's ranking."""

    __slots__ = ("fault_type", "accepted", "ranked")

    def __init__(self, fault_type: str, accepted: Iterable[str], ranked: Iterable[str]) -> None:
        self.fault_type = fault_type
        self.accepted = frozenset(accepted)
        self.ranked = list(ranked)

    def correct(self, depth: int) -> bool:
        """Whether the truth appears in the engine's first `depth` answers."""
        return any(service in self.accepted for service in self.ranked[:depth])


def load(path: Path) -> dict[str, Row]:
    """
    Read a verdict file into `datapack -> Row`.

    A row that repeats a datapack is an error rather than a last-one-wins: the file is
    one line per case, so a duplicate means the run scored a case twice and no count
    derived from it would mean what it says.
    """
    rows: dict[str, Row] = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            datapack = record["datapack"]
        except (json.JSONDecodeError, KeyError) as exc:
            raise ValueError(f"{path}:{number}: unreadable row ({exc})") from exc
        if datapack in rows:
            raise ValueError(f"{path}:{number}: duplicate datapack {datapack!r}")
        rows[datapack] = Row(
            record.get("faultType", "unknown"), record.get("accepted", []), record.get("ranked", [])
        )
    return rows


def flips(
    base: dict[str, Row], arm: dict[str, Row], depth: int
) -> dict[str, list[str]]:
    """
    Return the cases that changed verdict between `base` and `arm`.

    Keys: `gained` (wrong then right), `lost` (right then wrong), `only_base`,
    `only_arm`. Both directions are reported because a change that gains more than it
    loses can still be refused: the criterion this project applies is zero regressions.
    """
    gained, lost = [], []
    for datapack in sorted(set(base) & set(arm)):
        before = base[datapack].correct(depth)
        after = arm[datapack].correct(depth)
        if after and not before:
            gained.append(datapack)
        elif before and not after:
            lost.append(datapack)
    return {
        "gained": gained,
        "lost": lost,
        "only_base": sorted(set(base) - set(arm)),
        "only_arm": sorted(set(arm) - set(base)),
    }


def per_type(
    base: dict[str, Row], arm: dict[str, Row], depth: int
) -> dict[str, dict[str, int]]:
    """
    Count `base_correct`, `arm_correct`, `gained` and `lost` for every common fault type.

    `gained` and `lost` are kept apart from the difference on purpose: `gained == lost`
    is the shape an aggregate cannot show, and it is the shape that has decided two of
    this project's arms.
    """
    table: dict[str, dict[str, int]] = {}
    for datapack in sorted(set(base) & set(arm)):
        base_row, arm_row = base[datapack], arm[datapack]
        cell = table.setdefault(
            base_row.fault_type,
            {"base_correct": 0, "arm_correct": 0, "gained": 0, "lost": 0, "cases": 0},
        )
        before, after = base_row.correct(depth), arm_row.correct(depth)
        cell["cases"] += 1
        cell["base_correct"] += int(before)
        cell["arm_correct"] += int(after)
        cell["gained"] += int(after and not before)
        cell["lost"] += int(before and not after)
    return table


def render(label: str, base_label: str, base: dict[str, Row], arm: dict[str, Row], depth: int) -> str:
    """Render the whole report as text."""
    outcome = flips(base, arm, depth)
    table = per_type(base, arm, depth)
    lines = [
        f"Per-case comparison, Top@{depth}: {base_label} -> {label}",
        f"  cases compared: {len(set(base) & set(arm))}"
        f"  (base {len(base)}, arm {len(arm)})",
        f"  gained: {len(outcome['gained'])}  lost: {len(outcome['lost'])}"
        f"  net: {len(outcome['gained']) - len(outcome['lost']):+d}",
    ]
    for side in ("only_base", "only_arm"):
        if outcome[side]:
            sample = ", ".join(outcome[side][:5])
            lines.append(f"  EXCLUDED, in {side.replace('_', ' ')} only: {len(outcome[side])} ({sample})")
    lines.append("")
    header = f"  {'fault type':<24}{'cases':>6}{'base':>6}{'arm':>6}{'gained':>7}{'lost':>6}{'net':>6}"
    lines.append(header)
    zero_sum = []
    for fault_type in sorted(table, key=lambda t: (-table[t]["cases"], t)):
        cell = table[fault_type]
        net = cell["gained"] - cell["lost"]
        lines.append(
            f"  {fault_type:<24}{cell['cases']:>6}{cell['base_correct']:>6}{cell['arm_correct']:>6}"
            f"{cell['gained']:>7}{cell['lost']:>6}{net:>+6}"
        )
        if net == 0 and (cell["gained"] or cell["lost"]):
            zero_sum.append(f"{fault_type} (+{cell['gained']}/-{cell['lost']})")
    lines.append("")
    if zero_sum:
        # The section exists because the aggregate above it is what a table of totals
        # would have shown, and it would have shown nothing.
        lines.append("NET-ZERO BUT NOT IDENTICAL (a count-level comparison cannot see these):")
        for entry in zero_sum:
            lines.append(f"  {entry}")
    else:
        lines.append("Every fault type with movement has a NON-ZERO net; no case-level swap is hidden.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """Entry point; returns a process exit code."""
    parser = argparse.ArgumentParser(description="Compare two FSE'26 per-case verdict files.")
    parser.add_argument("runs", nargs="+", metavar="label=path", help="Two or more verdict files.")
    parser.add_argument(
        "--depth", type=int, default=1, help="At-K depth of the judgement (default 1)."
    )
    args = parser.parse_args(argv)
    if len(args.runs) < 2:
        print("ERROR: pass at least two label=path pairs", file=sys.stderr)
        return 2
    if args.depth < 1:
        print("ERROR: --depth must be at least 1", file=sys.stderr)
        return 2

    loaded: list[tuple[str, dict[str, Row]]] = []
    for spec in args.runs:
        label, _, path = spec.partition("=")
        if not path:
            print(f"ERROR: expected label=path, got {spec!r}", file=sys.stderr)
            return 2
        try:
            loaded.append((label, load(Path(path))))
        except (OSError, ValueError) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1

    base_label, base = loaded[0]
    for label, rows in loaded[1:]:
        print(render(label, base_label, base, rows, args.depth))
        print()
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
