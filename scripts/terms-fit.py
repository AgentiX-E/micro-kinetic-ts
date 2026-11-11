#!/usr/bin/env python3
"""What is left in the weights: separability ceilings and held-out fits over a term dump.

`scripts/terms-oracle.py` answers "what would this weight vector score". This script answers
the three questions that decide whether the additive score has anything left in it at all:

    ceiling   For each case, does ANY weight vector rank an accepted answer first?  An LP per
              case.  Per-case feasibility is not jointly achievable, so the aggregate is a
              strict UPPER BOUND on every single weight vector the architecture admits —
              including ones nobody has tried.  If that bound sits only a little above the
              shipped 75.5%, no amount of tuning can close the gap and the work belongs
              elsewhere.
    global    The best ONE weight vector, hill-climbed on the reported metric itself.  The gap
              between this and `ceiling` is what heterogeneity across cases costs.
    heldout   The same climb under stratified k-fold: fit on k-1 folds, report the held-out
              one.  Every coefficient shipped in this repository was chosen and then reported
              on the same cases; this is the number that says how much of that was real.

Everything is computed from `slope` alone, because a contribution is exactly `weight * slope`.
A contribution is therefore linear in the weights, and none of these questions needs an engine
run: 1.7 s for the whole 1422-case corpus, versus one workflow dispatch per point.

Usage:
    python3 scripts/terms-fit.py fse26-terms.ndjson
    python3 scripts/terms-fit.py fse26-terms.ndjson --only ceiling
    python3 scripts/terms-fit.py fse26-terms.ndjson --folds 5 --eps 1e-6
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from typing import Any, Sequence

import numpy as np
from scipy.optimize import linprog


class Corpus:
    """The dump as a flat candidate matrix plus case boundaries."""

    def __init__(self, cases: Sequence[dict[str, Any]]) -> None:
        names: list[str] = []
        for case in cases:
            for candidate in case.get("candidates") or []:
                for entry in candidate.get("terms") or []:
                    if entry[0] not in names:
                        names.append(entry[0])
        self.names = names
        column_of = {name: index for index, name in enumerate(names)}

        slope_rows: list[list[float]] = []
        weight_rows: list[list[float]] = []
        self.ids: list[str] = []
        self.case_of: list[int] = []
        self.fault_type: list[str] = []
        self.answer_of_case: list[set[str]] = []
        self.bounds: list[tuple[int, int]] = []

        for case_index, case in enumerate(cases):
            start = len(slope_rows)
            accepted = set(case.get("accepted") or [])
            for candidate in case.get("candidates") or []:
                slope_row = [0.0] * len(names)
                weight_row = [0.0] * len(names)
                for name, weight, slope in candidate.get("terms") or []:
                    if slope is None:
                        # Unmeasurable for this candidate: there is no slope, so no weight can
                        # conjure a contribution. Zero here is exact, not a stand-in for
                        # missing data.
                        continue
                    column = column_of[name]
                    slope_row[column] = float(slope)
                    weight_row[column] = 0.0 if weight is None else float(weight)
                slope_rows.append(slope_row)
                weight_rows.append(weight_row)
                self.ids.append(str(candidate.get("id")))
                self.case_of.append(case_index)
            self.bounds.append((start, len(slope_rows)))
            self.fault_type.append(str(case.get("faultType")))
            self.answer_of_case.append(accepted)

        self.slope = np.asarray(slope_rows, dtype=np.float64)
        self.recorded = np.asarray(weight_rows, dtype=np.float64)
        self.case = np.asarray(self.case_of, dtype=np.int64)
        self.id_array = np.asarray(self.ids)
        self.n_cases = len(self.bounds)
        self.base = (self.recorded * self.slope).sum(axis=1)
        self.is_answer = np.asarray(
            [self.ids[row] in self.answer_of_case[self.case_of[row]] for row in range(len(self.ids))],
            dtype=bool,
        )

    def scores(self, weights: dict[str, float]) -> np.ndarray:
        """The recorded run with `weights` substituted for the named terms.

        Applied as a delta against the recorded weight, so overriding one term leaves every
        other contribution arithmetically identical to what the engine produced.
        """
        if not weights:
            return self.base.copy()
        unknown = [name for name in weights if name not in self.names]
        if unknown:
            raise SystemExit(
                f"unknown term(s) {', '.join(sorted(unknown))}; the dump has: {', '.join(self.names)}"
            )
        columns = np.asarray([self.names.index(name) for name in weights], dtype=np.int64)
        values = np.asarray(list(weights.values()), dtype=np.float64)
        slope = self.slope[:, columns]
        return self.base - (self.recorded[:, columns] * slope).sum(axis=1) + slope @ values

    def positions(self, scores: np.ndarray) -> np.ndarray:
        """Each candidate's 0-based rank inside its own case.

        The engine's tiebreak is (descending score, ascending service id); the case is the
        outer key, so one lexsort produces one contiguous block per case and the position is
        the offset within that block.
        """
        order = np.lexsort((self.id_array, -scores, self.case))
        position = np.empty(len(order), dtype=np.int64)
        case_in_order = self.case[order]
        block_start = np.zeros(len(order), dtype=np.int64)
        starts = np.searchsorted(case_in_order, np.arange(self.n_cases), side="left")
        block_start[:] = np.repeat(starts, np.diff(np.append(starts, len(order))))
        position[order] = np.arange(len(order)) - block_start
        return position

    def metrics(self, scores: np.ndarray) -> dict[str, Any]:
        """Top@1/@3/@5 over the corpus, plus the per-fault-type split of Top@1."""
        position = self.positions(scores)
        best = np.full(self.n_cases, 10**9, dtype=np.int64)
        rows = np.where(self.is_answer)[0]
        np.minimum.at(best, self.case[rows], position[rows])
        by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for case_index in range(self.n_cases):
            entry = by_type[self.fault_type[case_index]]
            entry[0] += 1
            entry[1] += int(best[case_index] == 0)
        return {
            "at1": int((best == 0).sum()),
            "at3": int((best <= 2).sum()),
            "at5": int((best <= 4).sum()),
            "at1_cases": np.where(best == 0)[0],
            "best": best,
            "by_type": {name: tuple(value) for name, value in sorted(by_type.items())},
        }

    def case_rows(self, case_index: int) -> tuple[int, int]:
        return self.bounds[case_index]

    def starts(self) -> np.ndarray:
        """Row index where each case begins — the `reduceat` segmentation of the flat matrix."""
        return np.asarray([start for start, _ in self.bounds], dtype=np.int64)

    def top1_mask(self, scores: np.ndarray) -> np.ndarray:
        """Which cases rank an accepted candidate first, computed without sorting.

        Top@1 is a comparison of two maxima per case: the best accepted candidate against the
        best rejected one. `reduceat` over the case segmentation answers that in one pass,
        which is what makes a hill climb affordable — the sort in `metrics` costs ~100 us and
        a fit runs it hundreds of thousands of times.

        Equal maxima are the one case the two-maximum shortcut cannot decide, because the
        engine breaks ties by service id; those cases (float sums, so almost always both
        exactly zero) fall back to the exact path.
        """
        starts = self.starts()
        answers = np.where(self.is_answer, scores, -np.inf)
        others = np.where(self.is_answer, -np.inf, scores)
        best_answer = np.maximum.reduceat(answers, starts)
        best_other = np.maximum.reduceat(others, starts)
        hit = best_answer > best_other
        tied = np.where(~hit & (best_answer == best_other))[0]
        if tied.size:
            exact = self.positions(scores)
            for case_index in tied:
                start, stop = self.bounds[case_index]
                rows = np.arange(start, stop)
                order = np.lexsort((self.id_array[rows], -scores[rows]))
                hit[case_index] = bool(self.is_answer[rows[order[0]]])
            del exact
        return hit


def load(path: str) -> Corpus:
    cases: list[dict[str, Any]] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    if not cases:
        raise SystemExit(f"{path}: no cases")
    return Corpus(cases)


def margins_for(corpus: Corpus, case_index: int, answer: int, start: int, stop: int) -> np.ndarray | None:
    """Rows `(slope[answer] - slope[other])` for every non-answer candidate of one case.

    Returns None when some constraint row is identically zero: that candidate is not separated
    from the answer by any weight vector, so this answer cannot be the top-1.
    """
    block = corpus.slope[start:stop]
    others = np.ones(stop - start, dtype=bool)
    others[answer] = False
    margins = block[answer][None, :] - block[others]
    if np.any(np.all(np.abs(margins) < 1e-12, axis=1)):
        return None
    return margins


def separable(corpus: Corpus, case_index: int, eps: float, allow_negative: bool) -> bool:
    """Is there a weight vector that ranks an accepted candidate of this case first?"""
    start, stop = corpus.case_rows(case_index)
    answers = [
        row - start
        for row in range(start, stop)
        if corpus.ids[row] in corpus.answer_of_case[case_index]
    ]
    if not answers:
        # The answer is not among the candidates at all: no reweighting can repair it. This is
        # the corpus's true floor, and the ceiling must not be read as if it were not.
        return False
    bounds = [(None, None) if allow_negative else (0.0, None)] * len(corpus.names)
    for answer in answers:
        margins = margins_for(corpus, case_index, answer, start, stop)
        if margins is None:
            continue
        result = linprog(
            c=np.zeros(len(corpus.names)),
            A_ub=-margins,
            b_ub=-np.full(margins.shape[0], eps),
            A_eq=np.ones((1, len(corpus.names))),
            b_eq=np.ones(1),
            bounds=bounds,
            method="highs",
        )
        if result.status == 0:
            return True
    return False


def ceiling(corpus: Corpus, eps: float) -> dict[str, Any]:
    """Per fault type: (cases, separable with w >= 0, separable with any sign).

    Both columns are measured on EVERY case rather than the second only where the first fails.
    The unconditional form is what makes the pair readable as a price: the difference is what the
    non-negativity convention costs, and a column computed only on the cases that needed it could
    not be subtracted from the other.
    """
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    for case_index in range(corpus.n_cases):
        entry = by_type[corpus.fault_type[case_index]]
        entry[0] += 1
        entry[1] += int(separable(corpus, case_index, eps, allow_negative=False))
        entry[2] += int(separable(corpus, case_index, eps, allow_negative=True))
    return {name: tuple(value) for name, value in sorted(by_type.items())}


def default_weight(corpus: Corpus, name: str) -> float:
    """The weight the run recorded for a term, as a single number for the whole corpus."""
    column = corpus.names.index(name)
    values = corpus.recorded[:, column]
    finite = values[np.abs(values) > 0]
    if finite.size == 0:
        return 0.0
    return float(np.median(finite))


def top1_on(corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None = None) -> int:
    hit = corpus.top1_mask(corpus.scores(weights))
    if mask is None:
        return int(hit.sum())
    return int(hit[mask].sum())


class TypeGate:
    """Refuse any weight vector that lowers a fault type's Top@1 below the control's.

    A single aggregate number hides the only thing a shipped default may not do: move the corpus
    forward by abandoning the fault shapes it finds hard. The gate is a PENALTY rather than a
    constraint the search understands, because `Top@1` is piecewise constant and a solver that could
    not see a violation would step straight through it; a violation costs more than every case the
    corpus contains, so any improving move that respects the gate beats every one that does not.

    Types below `min_population` are measured and reported but not gated: on a type with four cases a
    single case is 25 pp, and the gate would then be protecting noise from signal.

    The floor is recomputed on the SAME population the fit is scored on. A fold that holds every case
    of a type out cannot compare against the whole corpus's count for it, and a gate that did would
    refuse vectors for a type it was never shown.
    """

    def __init__(self, corpus: Corpus, min_population: int) -> None:
        self.min_population = min_population
        self.control = {
            name: correct
            for name, (count, correct) in corpus.metrics(corpus.scores({}))["by_type"].items()
            if count >= min_population
        }
        self.types = np.asarray(corpus.fault_type)

    def violations(
        self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None = None
    ) -> dict[str, int]:
        """Fault types this vector would lower, with how far.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The population to judge on, as case indices or booleans; None for all.
        @returns Type name to the number of cases lost; empty when the vector is admissible.
        """
        hit = corpus.top1_mask(corpus.scores(weights))
        before = corpus.top1_mask(corpus.scores({}))
        members = None
        if mask is not None:
            # The mask arrives as case INDICES from the fold splitter and as a boolean array from
            # nothing else, so it is normalised once rather than assumed at every call site.
            members = np.zeros(corpus.n_cases, dtype=bool)
            members[mask] = True
        lost: dict[str, int] = {}
        for name in self.control:
            selected = self.types == name
            if members is not None:
                selected = selected & members
            if not selected.any():
                continue
            now = int(hit[selected].sum())
            was = int(before[selected].sum())
            if now < was:
                lost[name] = now - was
        return lost

    def score(self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None) -> int:
        """The objective: cases won, minus a penalty larger than the corpus for any type lost.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The cases the fit is scored on, or None for all.
        @returns The gated objective.
        """
        total = top1_on(corpus, weights, mask)
        penalty = 0
        for lost in self.violations(corpus, weights, mask).values():
            penalty += corpus.n_cases + 1 + abs(lost)
        return total - penalty


def hill_climb(
    corpus: Corpus,
    train: np.ndarray,
    grid: int,
    passes: int,
    eps_grid: float = 0.25,
    gate: TypeGate | None = None,
) -> dict[str, float]:
    """Coordinate ascent on Top@1 over a multiplicative grid around the incumbent.

    @param corpus - The corpus.
    @param train - The cases to fit on.
    @param grid - How many factors per coordinate.
    @param passes - How many sweeps.
    @param eps_grid - The smallest and largest factor, as `eps_grid` and its reciprocal.
    @param gate - The per-type non-regression gate, or None to optimise the aggregate alone.
    @returns The weight overrides the climb settled on; empty when nothing improved.
    """
    def objective(candidate: dict[str, float]) -> int:
        return gate.score(corpus, candidate, train) if gate is not None else top1_on(corpus, candidate, train)

    weights: dict[str, float] = {}
    best = objective(weights)
    factors = np.geomspace(eps_grid, 1.0 / eps_grid, grid)
    for _ in range(passes):
        improved = False
        for name in corpus.names:
            incumbent = weights.get(name, default_weight(corpus, name))
            reference = incumbent if abs(incumbent) > 1e-12 else 0.0
            for factor in factors:
                trial = dict(weights)
                trial[name] = reference * factor if abs(reference) > 1e-12 else float(factor)
                score = objective(trial)
                if score > best:
                    best, weights, improved = score, trial, True
        if not improved:
            break
    return weights


#: The channels whose PRESENCE conditions a case. Each is a term the engine measures only where its
#: source carries the data, so "does this case have a latency channel at all" is a fact about the
#: case, available before scoring and independent of its label.
SIGNATURE_TERMS: tuple[str, ...] = ('lat', 'failedEdge', 'log')


def signatures(corpus: Corpus) -> np.ndarray:
    """A per-case bitmask of which evidence channels the case carries.

    The signature is computed from the dump's own slopes: a term is present for a candidate exactly
    where it read a measurement, so a bit is set when ANY candidate of the case carries that term.
    Nothing about the answer enters, which is what makes a mixture over these buckets dispatchable
    at inference time rather than only measurable in a report.

    @param corpus - The corpus.
    @returns One integer per case, bit `i` set when `SIGNATURE_TERMS[i]` was measurable.
    """
    code = np.zeros(corpus.n_cases, dtype=np.int64)
    for bit, name in enumerate(SIGNATURE_TERMS):
        if name not in corpus.names:
            continue
        measured = corpus.slope[:, corpus.names.index(name)] != 0.0
        present = np.zeros(corpus.n_cases, dtype=bool)
        np.logical_or.at(present, corpus.case, measured)
        code |= present.astype(np.int64) << bit
    return code


def describe_signature(code: int) -> str:
    """Render a signature as `+lat -failedEdge +log`, so a table row names its own channels.

    @param code - The bitmask.
    @returns The rendering.
    """
    marks = ['+' if code >> bit & 1 else '-' for bit in range(len(SIGNATURE_TERMS))]
    return ' '.join(f'{mark}{name}' for mark, name in zip(marks, SIGNATURE_TERMS))


def regime_fit(
    corpus: Corpus,
    folds: Sequence[np.ndarray],
    grid: int,
    passes: int,
    min_cases: int,
    gate: 'TypeGate | None' = None,
) -> dict[str, Any]:
    """Fit one weight vector per channel signature, train on k-1 folds, report the held-out fold.

    A bucket with fewer than `min_cases` training cases falls back to the vector fitted on the whole
    training split: a bucket of six cases would otherwise contribute a vector fitted to noise, and
    the mixture's claim is about what a RECOGNISABLE regime does, not about every cell of a 3-bit
    signature being populated.

    @param corpus - The corpus.
    @param folds - Held-out case indices, one array per fold.
    @param grid - Factors per coordinate in each climb.
    @param passes - Sweeps per climb.
    @param min_cases - Smallest training bucket that gets its own vector.
    @param gate - The per-type non-regression gate, applied to each bucket on its own training
        cases: a bucket's vector is scored on the population it will be used on, which is the only
        population for which "did this lower a shape" is a question that has an answer.
    @returns The per-bucket table and the pooled held-out reading.
    """
    code = signatures(corpus)
    every = np.arange(corpus.n_cases)
    table: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    holdout_hits = 0
    for holdout in folds:
        train = np.setdiff1d(every, holdout)
        fallback = hill_climb(corpus, train, grid, passes, gate=gate)
        for bucket in np.unique(code):
            train_bucket = train[code[train] == bucket]
            vector = (
                hill_climb(corpus, train_bucket, grid, passes, gate=gate)
                if train_bucket.size >= min_cases
                else fallback
            )
            held = holdout[code[holdout] == bucket]
            if held.size == 0:
                continue
            hit_mask = corpus.top1_mask(corpus.scores(vector))
            control_mask = corpus.top1_mask(corpus.scores({}))
            hits = int(hit_mask[held].sum())
            for case_index in held:
                # Per-fault-type held-out counts, because a mixture that buys its total by
                # abandoning a shape is exactly what the acceptance rule forbids.
                entry = by_type[corpus.fault_type[int(case_index)]]
                entry[0] += int(hit_mask[int(case_index)])
                entry[1] += int(control_mask[int(case_index)])
            entry = table[int(bucket)]
            entry[0] += int(held.size)
            entry[1] += hits
            entry[2] += int(control_mask[held].sum())
            entry[3] += 1
            holdout_hits += hits
    return {
        "table": dict(table),
        "by_type": dict(by_type),
        "holdout": holdout_hits,
        "folds": len(folds),
    }


def folds_of(corpus: Corpus, k: int, seed: int) -> list[np.ndarray]:
    """Stratified by fault type, so every fold carries the corpus's mix of fault shapes."""
    rng = np.random.default_rng(seed)
    by_type: dict[str, list[int]] = defaultdict(list)
    for case_index in range(corpus.n_cases):
        by_type[corpus.fault_type[case_index]].append(case_index)
    assignment = np.zeros(corpus.n_cases, dtype=np.int64)
    for members in by_type.values():
        order = rng.permutation(len(members))
        for slot, index in enumerate(order):
            assignment[members[index]] = slot % k
    return [np.where(assignment == fold)[0] for fold in range(k)]


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dump", help="fse26-terms.ndjson from --terms-dump")
    parser.add_argument("--only", choices=("ceiling", "global", "heldout", "regimes"), default=None)
    parser.add_argument("--min-bucket", type=int, default=40)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20261112)
    parser.add_argument("--grid", type=int, default=9)
    parser.add_argument("--passes", type=int, default=3)
    parser.add_argument("--eps", type=float, default=1e-6)
    parser.add_argument(
        "--gate-types",
        type=int,
        default=0,
        metavar="MIN_CASES",
        help="refuse any vector that lowers a fault type with at least MIN_CASES cases",
    )
    args = parser.parse_args(argv)

    corpus = load(args.dump)
    total = corpus.n_cases
    control = corpus.metrics(corpus.scores({}))
    print(
        f"cases={total} control Top@1={control['at1']} ({100.0 * control['at1'] / total:.2f}%) "
        f"Top@3={control['at3']} ({100.0 * control['at3'] / total:.2f}%) "
        f"Top@5={control['at5']} ({100.0 * control['at5'] / total:.2f}%)"
    )

    if args.only in (None, "ceiling"):
        table = ceiling(corpus, args.eps)
        positive = sum(entry[1] for entry in table.values())
        free = sum(entry[2] for entry in table.values())
        print(
            f"\nCEILING  any per-case w>=0: {positive}/{total} "
            f"({100.0 * positive / total:.2f}%)   sign-free: {free}/{total} "
            f"({100.0 * free / total:.2f}%)   shipped: {control['at1']}"
        )
        for name, (count, nonneg, any_sign) in table.items():
            print(f"  {name:32s} {count:5d} {nonneg:6d} {100.0 * nonneg / count:7.2f}%  free={any_sign}")

    if args.only in (None, "global"):
        train = np.arange(total)
        gate = None if args.gate_types <= 0 else TypeGate(corpus, args.gate_types)
        weights = hill_climb(corpus, train, args.grid, args.passes, gate=gate)
        fitted = corpus.metrics(corpus.scores(weights))
        print(
            f"\nGLOBAL one w, fitted in-sample: Top@1={fitted['at1']} "
            f"({100.0 * fitted['at1'] / total:.2f}%) delta={fitted['at1'] - control['at1']:+d}"
        )
        for name, value in sorted(weights.items()):
            print(f"  {name:20s} {value:+.6g}   recorded {default_weight(corpus, name):+.6g}")
        for name, (count, correct) in fitted["by_type"].items():
            before = control["by_type"][name][1]
            print(f"  {name:32s} {before:4d} -> {correct:4d} ({correct - before:+d})")

    if args.only in (None, "heldout"):
        folds = folds_of(corpus, args.folds, args.seed)
        print(f"\nHELDOUT {args.folds}-fold stratified by fault type, seed={args.seed}")
        train_hits = holdout_hits = 0
        for fold_index, holdout in enumerate(folds):
            train = np.setdiff1d(np.arange(total), holdout)
            weights = hill_climb(corpus, train, args.grid, args.passes)
            tr = top1_on(corpus, weights, train)
            ho = top1_on(corpus, weights, holdout)
            train_hits += tr
            holdout_hits += ho
            print(
                f"  fold {fold_index}: train {tr}/{len(train)} "
                f"holdout {ho}/{len(holdout)} weights={ {name: round(float(value), 4) for name, value in weights.items()} }"
            )
        train_total = sum(len(np.setdiff1d(np.arange(total), holdout)) for holdout in folds)
        print(
            f"  pooled train {100.0 * train_hits / train_total:.2f}%  "
            f"holdout {100.0 * holdout_hits / total:.2f}%  "
            f"shipped {100.0 * control['at1'] / total:.2f}%  "
            f"heldout-minus-shipped {holdout_hits - control['at1']:+d}"
        )

    if args.only in (None, "regimes"):
        folds = folds_of(corpus, args.folds, args.seed)
        report = regime_fit(
            corpus,
            folds,
            args.grid,
            args.passes,
            args.min_bucket,
            gate=None if args.gate_types <= 0 else TypeGate(corpus, args.gate_types),
        )
        total_cases = sum(entry[0] for entry in report["table"].values())
        print(
            f"\nREGIMES one vector per channel signature, {report['folds']}-fold held-out, "
            f"min bucket {args.min_bucket}"
        )
        print(f"  {'signature':28s} {'n':>5s} {'control':>8s} {'mixture':>8s} {'delta':>7s}")
        for bucket, (count, hits, control_hits, _folds) in sorted(report["table"].items()):
            print(
                f"  {describe_signature(bucket):28s} {count:5d} {control_hits:8d} {hits:8d} "
                f"{hits - control_hits:+7d}"
            )
        print(f"  {'faultType':32s} {'control':>8s} {'mixture':>8s} {'delta':>7s}")
        for name, (hits, control_hits) in sorted(report["by_type"].items()):
            print(f"  {name:32s} {control_hits:8d} {hits:8d} {hits - control_hits:+7d}")
        regressed = [
            name
            for name, (hits, control_hits) in report["by_type"].items()
            if hits < control_hits
        ]
        print(
            f"  pooled holdout {report['holdout']}/{total_cases} "
            f"({100.0 * report['holdout'] / max(total_cases, 1):.2f}%)  "
            f"shipped {100.0 * control['at1'] / total:.2f}%  "
            f"delta {report['holdout'] - control['at1']:+d}  "
            f"types down: {', '.join(regressed) if regressed else 'none'}"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
