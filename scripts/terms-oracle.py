#!/usr/bin/env python3
"""Re-score a recorded FSE'26 run at any weight vector, offline.

The term dump written by `benchmarks/src/run-fse26.ts --terms-dump` carries, for every
candidate of every case, the engine's own named terms with the `weight` and `slope` that
produced each contribution. Because a contribution is exactly `weight * slope`, the score a
candidate would have had at a different weight is arithmetic:

    score'(v) = sum_i  w'_i * slope_i(v)

That turns a weight or architecture screen from one dispatch per candidate configuration
into a local computation over one dispatch, which is the difference between sweeping a
surface and sampling four points of it.

Three re-scaling regimes are offered because the shipped ranking is a sum of terms measured
in incompatible units (a log1p of a [0,1] anomaly against a count against a rate), and the
question of whether those units are the reason a weight does not transfer between corpora
can only be answered by holding the weights fixed and changing the units:

    none    the recorded slopes, i.e. the engine's own arithmetic (the self-check)
    minmax  each term linearly rescaled to [0,1] within the case
    rank    each term replaced by its percentile rank within the case

`none` is a CHECK rather than an option: on an unmodified dump it must reproduce the run's
own Top@1 exactly, and a screen that does not reproduce the control is measuring its own
bug.

Usage:
    python3 scripts/terms-oracle.py fse26-terms.ndjson
    python3 scripts/terms-oracle.py fse26-terms.ndjson --set latWeight=0 --set logWeight=0.5
    python3 scripts/terms-oracle.py fse26-terms.ndjson --normalize rank --set latWeight=0.5
    python3 scripts/terms-oracle.py a.ndjson --diff b.ndjson
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from typing import Any, Iterable, Sequence

# The (weight, slope) a term contributes. A term ABSENT for a candidate records neither, which
# is not the same as a measured slope of zero: an absent term has no slope at all, so it cannot
# be re-weighted into existence and a screen that treated `null` as 0 would silently claim it
# could.
Term = tuple[str, float | None, float | None]


def load_cases(path: str) -> list[dict[str, Any]]:
    """Read the ndjson dump, one case per line."""
    cases: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                cases.append(json.loads(line))
            except json.JSONDecodeError as err:
                raise SystemExit(f"{path}:{line_no}: not JSON: {err}") from err
    return cases


def term_slopes(candidate: dict[str, Any]) -> dict[str, float]:
    """The candidate's slopes, keyed by term name. Absent terms are simply not present."""
    slopes: dict[str, float] = {}
    for entry in candidate.get("terms") or []:
        name, _weight, slope = entry
        if slope is None:
            continue
        slopes[name] = float(slope)
    return slopes


def rescale(
    slopes_by_candidate: Sequence[dict[str, float]], mode: str
) -> list[dict[str, float]]:
    """Apply a per-case rescaling to every term.

    The rescaling is PER TERM and WITHIN THE CASE, because the question it answers is whether
    a coefficient can be shared across cases whose channels are measured in different units.
    A rescaling across cases would be a different question — and on this corpus an unanswerable
    one, since the cases are different systems.
    """
    if mode == "none":
        return [dict(s) for s in slopes_by_candidate]

    names: set[str] = set()
    for slopes in slopes_by_candidate:
        names.update(slopes)

    out = [dict(s) for s in slopes_by_candidate]
    for name in names:
        values = [s[name] for s in slopes_by_candidate if name in s]
        if len(values) < 2:
            # One measured candidate has no distribution to be placed in. Leaving the value as
            # recorded is the only choice that does not invent a rank for a population of one.
            continue
        lo, hi = min(values), max(values)
        if hi - lo <= 0:
            for s in out:
                if name in s:
                    s[name] = 1.0 if mode == "rank" else 0.0
            continue
        if mode == "minmax":
            for s in out:
                if name in s:
                    s[name] = (s[name] - lo) / (hi - lo)
        elif mode == "rank":
            # Percentile rank in [0, 1], ties sharing the mean rank — the same convention
            # `rankNormalizeScores` uses, so the two instruments agree about what a tie is.
            order = sorted(values)
            rank_of: dict[float, list[int]] = defaultdict(list)
            for index, value in enumerate(order):
                rank_of[value].append(index)
            mean_rank = {
                value: sum(indices) / len(indices) for value, indices in rank_of.items()
            }
            for s in out:
                if name in s:
                    s[name] = mean_rank[s[name]] / (len(order) - 1)
    return out


def score_case(
    case: dict[str, Any],
    weights: dict[str, float],
    mode: str,
) -> list[tuple[str, float]]:
    """Rank one case's candidates under `weights` and `mode`, best first."""
    candidates = case.get("candidates") or []
    slopes_by_candidate = [term_slopes(c) for c in candidates]
    rescaled = rescale(slopes_by_candidate, mode)

    scored: list[tuple[str, float]] = []
    for candidate, slopes in zip(candidates, rescaled):
        total = 0.0
        for name, slope in slopes.items():
            weight = weights.get(name)
            if weight is None:
                # No override: the term keeps the weight the run recorded for it. This is what
                # makes `--set` a partial override rather than a full re-specification.
                weight = recorded_weight(candidate, name)
                if weight is None:
                    continue
            total += weight * slope
        scored.append((str(candidate.get("id")), total))

    # Descending score, ties broken by service id — the engine's own deterministic tiebreak, so
    # a screen and the run it screens agree about cases the weights made equal.
    scored.sort(key=lambda pair: (-pair[1], pair[0]))
    return scored


def recorded_weight(candidate: dict[str, Any], name: str) -> float | None:
    for entry in candidate.get("terms") or []:
        if entry[0] == name:
            return None if entry[1] is None else float(entry[1])
    return None


def hits(ranking: Sequence[tuple[str, float]], accepted: Iterable[str], k: int) -> bool:
    accepted_set = set(accepted)
    return any(service in accepted_set for service, _ in ranking[:k])


def evaluate(
    cases: Sequence[dict[str, Any]],
    weights: dict[str, float],
    mode: str,
) -> dict[str, Any]:
    """Top@1/@3/@5 over the corpus, with a per-fault-type breakdown and the per-case verdicts."""
    total = len(cases)
    at1 = at3 = at5 = 0
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    verdicts: dict[str, str] = {}
    for case in cases:
        ranking = score_case(case, weights, mode)
        accepted = case.get("accepted") or []
        fault_type = str(case.get("faultType"))
        by_type[fault_type][0] += 1
        if hits(ranking, accepted, 1):
            at1 += 1
            by_type[fault_type][1] += 1
        if hits(ranking, accepted, 3):
            at3 += 1
        if hits(ranking, accepted, 5):
            at5 += 1
        verdicts[str(case.get("datapack"))] = ranking[0][0] if ranking else ""
    return {
        "total": total,
        "at1": at1,
        "at3": at3,
        "at5": at5,
        "by_type": {k: tuple(v) for k, v in sorted(by_type.items())},
        "verdicts": verdicts,
    }


def parse_overrides(pairs: Sequence[str]) -> dict[str, float]:
    weights: dict[str, float] = {}
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"--set expects name=value, got {pair!r}")
        name, raw = pair.split("=", 1)
        try:
            weights[name] = float(raw)
        except ValueError as err:
            raise SystemExit(f"--set {pair!r}: not a number: {raw!r}") from err
    return weights


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dump", help="fse26-terms.ndjson from --terms-dump")
    parser.add_argument(
        "--set",
        action="append",
        default=[],
        metavar="TERM=WEIGHT",
        help="override one term's weight (repeatable); unset terms keep the recorded weight",
    )
    parser.add_argument(
        "--normalize",
        choices=("none", "minmax", "rank"),
        default="none",
        help="per-case, per-term rescaling applied before weighting",
    )
    parser.add_argument("--diff", metavar="OTHER", help="report per-case flips against another dump")
    parser.add_argument("--by-type", action="store_true", help="print the per-fault-type table")
    args = parser.parse_args(argv)

    cases = load_cases(args.dump)
    weights = parse_overrides(args.set)
    result = evaluate(cases, weights, args.normalize)

    total = result["total"]
    if total == 0:
        raise SystemExit(f"{args.dump}: no cases")

    def pct(n: int) -> str:
        return f"{100.0 * n / total:.2f}%"

    print(
        f"cases={total} Top@1={result['at1']} ({pct(result['at1'])}) "
        f"Top@3={result['at3']} ({pct(result['at3'])}) "
        f"Top@5={result['at5']} ({pct(result['at5'])}) "
        f"normalize={args.normalize}"
        + (f" overrides={weights}" if weights else "")
    )

    if args.by_type:
        print(f"{'faultType':32s} {'n':>5s} {'top1':>6s} {'rate':>8s}")
        for fault_type, (count, correct) in result["by_type"].items():
            rate = 100.0 * correct / count if count else 0.0
            print(f"{fault_type:32s} {count:5d} {correct:6d} {rate:7.2f}%")

    if args.diff:
        other = evaluate(load_cases(args.diff), {}, "none")
        gained, lost = [], []
        for datapack, verdict in result["verdicts"].items():
            previous = other["verdicts"].get(datapack)
            if previous is None or previous == verdict:
                continue
            case = next(c for c in cases if str(c.get("datapack")) == datapack)
            accepted = set(case.get("accepted") or [])
            if verdict in accepted:
                gained.append(datapack)
            elif previous in accepted:
                lost.append(datapack)
        print(f"vs control: +{len(gained)} -{len(lost)} (net {len(gained) - len(lost):+d})")
        for label, items in (("GAINED", gained), ("LOST", lost)):
            for datapack in items:
                print(f"  {label} {datapack}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
