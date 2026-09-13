#!/usr/bin/env python3
"""Compare FSE'26 run artifacts: headline numbers plus a per-fault-type delta.

Usage: compare_fse26_runs.py <label>=<path-to-fse26-results.json> [more...]

The first run is the baseline. Each artifact carries the configuration that
produced its numbers, and the header prints that block verbatim, so two runs can
never be compared without their settings being visible -- the failure this
benchmark has already had once, when a `logicHttp` run at 47.3% and a `count` run
at 23.1% published byte-identical `config` blocks.

The per-fault-type table reports the delta against the baseline, not just the
cell, because an aggregate can hide opposite-signed movement on two shards.
"""
from __future__ import annotations

import json
import sys


def load(spec: str) -> tuple[str, dict]:
    label, _, path = spec.partition("=")
    if not path:
        sys.exit(f"usage: <label>=<path-to-fse26-results.json>, got {spec!r}")
    with open(path, encoding="utf-8") as fh:
        return label, json.load(fh)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.exit(__doc__)
    runs = [load(spec) for spec in argv]

    print("Configurations (verbatim from each artifact):")
    for label, doc in runs:
        print(f"  {label:<14} cases={doc['cases']:<5} {doc['config']}")
    print()

    base_label, base = runs[0]
    print(f"Headline, relative to {base_label}:")
    print(f"  {'run':<14} {'Top@1':>8} {'delta pp':>9} {'Top@3':>8} {'Top@5':>8}")
    for label, doc in runs:
        delta_pp = (doc["top1"] - base["top1"]) * 100
        print(
            f"  {label:<14} {doc['top1'] * 100:7.2f}% {delta_pp:+8.2f} "
            f"{doc['top3'] * 100:7.2f}% {doc['top5'] * 100:7.2f}%"
        )
    print()

    fault_types = sorted(
        {t for _, doc in runs for t in doc["perFaultType"]},
        key=lambda t: (-base["perFaultType"].get(t, {}).get("total", 0), t),
    )
    header = f"  {'fault type':<22}{'n':>5}"
    for label, _ in runs:
        header += f"{label[:12]:>13}"
    print("Per fault type (correct/total), with the worst delta across candidates:")
    print(header)

    regressed: list[str] = []
    for fault_type in fault_types:
        total = base["perFaultType"].get(fault_type, {}).get("total", 0)
        row = f"  {fault_type:<22}{total:>5}"
        deltas: list[int] = []
        for _, doc in runs:
            cell = doc["perFaultType"].get(fault_type)
            row += "              -" if cell is None else f"{cell['correct']:>7}/{cell['total']:<5}"
            if cell is not None:
                deltas.append(cell["correct"] - base["perFaultType"][fault_type]["correct"])
        worst = min(deltas) if deltas else 0
        row += f"{worst:>+8}"
        if worst < 0:
            regressed.append(f"{fault_type} ({worst:+d})")
        print(row)

    print()
    print(
        f"REGRESSED types: {', '.join(regressed)}"
        if regressed
        else "No fault type regressed on any candidate."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
