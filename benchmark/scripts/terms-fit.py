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

    def scores_rows(self, weights: dict[str, float], rows: np.ndarray) -> np.ndarray:
        """`scores` restricted to a row subset — the same number at a fraction of the cost.

        A fit that owns one signature bucket only ever reads that bucket's rows, and re-deriving
        every other bucket's score on every trial is work that cannot change the answer. The form
        is the same delta as `scores`, taken on the rows asked for.

        @param weights - The overrides, as for `scores`.
        @param rows - The candidate rows to score.
        @returns Those rows' scores under `weights`.
        """
        if not weights:
            return self.base[rows].copy()
        unknown = [name for name in weights if name not in self.names]
        if unknown:
            raise SystemExit(
                f"unknown term(s) {', '.join(sorted(unknown))}; the dump has: {', '.join(self.names)}"
            )
        columns = np.asarray([self.names.index(name) for name in weights], dtype=np.int64)
        values = np.asarray(list(weights.values()), dtype=np.float64)
        slope = self.slope[rows][:, columns]
        recorded = self.recorded[rows][:, columns]
        return self.base[rows] - (recorded * slope).sum(axis=1) + slope @ values

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
        # The control reading is a property of the dump, so it is computed once. A climb asks for
        # it on every trial, and re-deriving it there is the difference between 3 s and 200 s.
        self.before = corpus.top1_mask(corpus.scores({}))

    def _lost(self, corpus: Corpus, hit: np.ndarray, mask: np.ndarray | None) -> dict[str, int]:
        """Fault types `hit` lowers against the control, on the population `mask` selects.

        @param corpus - The corpus.
        @param hit - Per-case Top@1 under the candidate.
        @param mask - The population to judge on, as case indices or booleans; None for all.
        @returns Type name to the number of cases lost; empty when the vector is admissible.
        """
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
            was = int(self.before[selected].sum())
            if now < was:
                lost[name] = now - was
        return lost

    def violations_of(
        self, corpus: Corpus, scores: np.ndarray, mask: np.ndarray | None = None
    ) -> dict[str, int]:
        """Fault types a set of SCORES would lower, with how far.

        The scores-labelled form is what a mixture needs: a per-bucket vector is already a
        different weight vector for every case, so there is no single `scores(weights)` to take.

        @param corpus - The corpus.
        @param scores - Candidate scores, one per row.
        @param mask - The population to judge on, as case indices or booleans; None for all.
        @returns Type name to the number of cases lost; empty when the vector is admissible.
        """
        return self._lost(corpus, corpus.top1_mask(scores), mask)

    def violations(
        self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None = None
    ) -> dict[str, int]:
        """Fault types this vector would lower, with how far.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The population to judge on, as case indices or booleans; None for all.
        @returns Type name to the number of cases lost; empty when the vector is admissible.
        """
        return self.violations_of(corpus, corpus.scores(weights), mask)

    def score_of(self, corpus: Corpus, scores: np.ndarray, mask: np.ndarray | None) -> int:
        """The objective on a set of scores: cases won, minus a penalty larger than the corpus.

        @param corpus - The corpus.
        @param scores - Candidate scores, one per row.
        @param mask - The cases the fit is scored on, or None for all.
        @returns The gated objective.
        """
        hit = corpus.top1_mask(scores)
        total = int(hit.sum()) if mask is None else int(hit[mask].sum())
        penalty = 0
        for lost in self._lost(corpus, hit, mask).values():
            penalty += corpus.n_cases + 1 + abs(lost)
        return total - penalty

    def score(self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None) -> int:
        """The objective: cases won, minus a penalty larger than the corpus for any type lost.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The cases the fit is scored on, or None for all.
        @returns The gated objective.
        """
        return self.score_of(corpus, corpus.scores(weights), mask)


def hill_climb(
    corpus: Corpus,
    train: np.ndarray,
    grid: int,
    passes: int,
    eps_grid: float = 0.25,
    gate: TypeGate | None = None,
    start: dict[str, float] | None = None,
) -> dict[str, float]:
    """Coordinate ascent on Top@1 over a multiplicative grid around the incumbent.

    @param corpus - The corpus.
    @param train - The cases to fit on.
    @param grid - How many factors per coordinate.
    @param passes - How many sweeps.
    @param eps_grid - The smallest and largest factor, as `eps_grid` and its reciprocal.
    @param gate - The per-type non-regression gate, or None to optimise the aggregate alone.
    @param start - The vector the climb begins at; empty means the shipped run.
    @returns The weight overrides the climb settled on; empty when nothing improved.
    """
    def objective(candidate: dict[str, float]) -> int:
        return gate.score(corpus, candidate, train) if gate is not None else top1_on(corpus, candidate, train)

    weights: dict[str, float] = dict(start or {})
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


class Lagrangian:
    """The non-regression rule as a PRICE that can be paid, instead of a wall that cannot.

    `TypeGate.score` charges `n_cases + 1 + |lost|` for a single lowered type, which is more than
    the whole corpus can yield: the admissible set becomes a barrier and a coordinate ascent that
    starts inside it never leaves. Iteration 263 measured exactly that — the gated climb returns
    +1 case where the ungated one returns +131, and a two-case type loss is the only thing between
    the two. A floor that has to be ATTAINED needs a finite price, and the price has to be per type,
    because one type's case is worth what no price affordable to another type would buy.

    The price is learnt rather than tuned: each round the climb maximises `top1 - sum_t price_t *
    lost_t`, and the types it still lowers are the ones whose price rises. This is dual ascent on
    the multipliers of the floor constraints, and it is the instrument the constraint needs — a
    fixed coefficient cannot satisfy a constraint and optimise the objective at once (Hashemi et
    al., 2025, arXiv 2505.20628; Constrained GRPO, 2026, arXiv 2602.05863, shows the same failure
    when per-component terms are not scalarised before the multiplier is read).
    """

    def __init__(
        self,
        corpus: Corpus,
        min_population: int,
        step: float = 2.0,
        cap: float = 64.0,
    ) -> None:
        """@param corpus - The corpus. @param min_population - Smallest gated type.
        @param step - Factor the price of a still-lowered type is multiplied by each round.
        @param cap - Highest price any single type may reach, so a hopeless floor cannot bid the
        corpus away and disguise "no move exists" as "the control is optimal".
        """
        self.oracle = TypeGate(corpus, min_population)
        self.duals: dict[str, float] = {name: 1.0 for name in self.oracle.control}
        self.step = step
        self.cap = cap

    def price_of(self, lost: dict[str, int]) -> float:
        """What a violation costs at the current prices.

        @param lost - Type name to cases lost.
        @returns The charge, in cases.
        """
        return sum(self.duals.get(name, 1.0) * abs(value) for name, value in lost.items())

    def learn(self, lost: dict[str, int]) -> None:
        """Raise the price of every type this round still lowered.

        @param lost - Type name to cases lost.
        """
        for name in lost:
            self.duals[name] = min(self.cap, self.duals.get(name, 1.0) * self.step)

    def violations(
        self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None = None
    ) -> dict[str, int]:
        """The floor reading of a vector — the admission test, unchanged by the price.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The population to judge on; None for all.
        @returns Type name to cases lost; empty when the vector clears the floor.
        """
        return self.oracle.violations(corpus, weights, mask)

    def score(self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None) -> int:
        """The priced objective the climb maximises.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The cases the fit is scored on, or None for all.
        @returns Cases won minus the priced cost of the floor it still breaks.
        """
        total = top1_on(corpus, weights, mask)
        return total - int(round(self.price_of(self.oracle.violations(corpus, weights, mask))))


def repair(
    corpus: Corpus,
    train: np.ndarray,
    grid: int,
    passes: int,
    rounds: int,
    min_population: int,
    eps_grid: float = 0.25,
    step: float = 2.0,
    cap: float = 64.0,
    start: dict[str, float] | None = None,
    surrogate_tau: float | None = None,
    floor: Any = None,
) -> dict[str, Any]:
    """Climb, re-price what is still broken, and climb again from where the last one stopped.

    Two defects are repaired here and neither is a rule change: the climb is WARM-STARTED, and the
    floor is priced instead of walled. Iteration 263's gated fit returned +1 case because both
    were missing, and its conclusion — that no training-time constraint can keep a type whole on
    held-out data — was a conclusion about the instrument.

    @param corpus - The corpus.
    @param train - The cases to fit on.
    @param grid - Factors per coordinate in each climb.
    @param passes - Sweeps per climb.
    @param rounds - Climb/re-price rounds allowed.
    @param min_population - Smallest gated type.
    @param eps_grid - The smallest and largest factor, as `eps_grid` and its reciprocal.
    @param step - Factor a still-lowered type's price is multiplied by each round.
    @param cap - Highest price any single type may reach.
    @param start - The vector the first climb begins at; empty means the shipped run.
    @param surrogate_tau - Fit on the margin surrogate at this scale instead of on `Top@1`, or None.
    @param floor - The floor to clear, as `Lagrangian` (per type) or `CaseFloor` (per case); None
    builds the per-type one from `min_population`.
    @returns The vector, its total, the floor reading, whether it cleared, the round schedule, and
    the best vector the floor turned down.
    """
    lagrangian = Lagrangian(corpus, min_population, step=step, cap=cap) if floor is None else floor
    objective: Any = lagrangian
    if surrogate_tau is not None:
        objective = Surrogate(corpus, tau=surrogate_tau, floor=lagrangian)
    weights: dict[str, float] = dict(start or {})
    schedule: list[tuple[int, int, int]] = []
    # A warm start may already break the floor — the archive's ungated optimum does, by two cases —
    # so the fallback is the SHIPPED vector, which defines the floor and therefore always clears it.
    fallback: dict[str, float] = {}
    accepted: tuple[dict[str, float], int] | None = None
    refused: dict[str, Any] | None = None
    lost: dict[str, int] = {}
    total = top1_on(corpus, weights, train)
    for _round in range(max(rounds, 1)):
        weights = hill_climb(
            corpus, train, grid, passes, eps_grid=eps_grid, gate=objective, start=weights
        )
        total = top1_on(corpus, weights, train)
        lost = lagrangian.violations(corpus, weights, train)
        schedule.append((total, len(lost), int(round(lagrangian.price_of(lost)))))
        if not lost:
            accepted = (dict(weights), total)
            break
        if refused is None or total > refused["total"]:
            refused = {"weights": dict(weights), "total": total, "lost": dict(lost)}
        lagrangian.learn(lost)
    if accepted is None:
        accepted = (fallback, top1_on(corpus, fallback, train))
    best, best_total = accepted
    return {
        "weights": best,
        "total": best_total,
        "lost": {} if best is fallback else dict(lost),
        "feasible": True,
        "schedule": schedule,
        "duals": dict(lagrangian.duals),
        "refused": refused,
    }


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


class Mixture:
    """A weight vector per channel signature, scored on the whole corpus as one array.

    A mixture cannot be written as a single weight vector: `scores(weights)` applies one vector to
    every case, while a mixture gives each case the vector of the bucket its CHANNELS put it in —
    no label, no run, nothing that would not be available at inference time. The object exists so
    that the objective of a fit can be the reading a deployed mixture actually has.
    """

    def __init__(self, corpus: Corpus, code: np.ndarray) -> None:
        self.corpus = corpus
        self.code = code
        self.buckets = [int(bucket) for bucket in np.unique(code)]
        self.rows = {bucket: np.where(code[corpus.case] == bucket)[0] for bucket in self.buckets}

    def scores(self, vectors: dict[int, dict[str, float]]) -> np.ndarray:
        """The corpus under `vectors`, one vector per signature.

        @param vectors - Bucket to overrides; a missing or empty bucket keeps the recorded weights.
        @returns Candidate scores, one per row.
        """
        out = self.corpus.base.copy()
        for bucket, vector in vectors.items():
            rows = self.rows.get(bucket)
            if rows is None or not vector:
                # A signature this corpus does not carry, or a bucket left at what shipped. Both
                # are the recorded reading, and neither is an error worth raising over.
                continue
            out[rows] = self.corpus.scores_rows(vector, rows)
        return out


def joint_climb(
    corpus: Corpus,
    train: np.ndarray,
    code: np.ndarray,
    grid: int,
    passes: int,
    min_cases: int = 40,
    gate: TypeGate | None = None,
    eps_grid: float = 0.25,
) -> dict[int, dict[str, float]]:
    """Coordinate ascent over EVERY bucket's vector at once, scored on the mixture.

    The bucket-wise fit optimises each bucket's own Top@1 on that bucket's own training cases, and
    that decomposition hides one thing: a bucket too small to earn a vector is handed the GLOBAL
    vector and judged on cases it is never applied to, so its guarantee is about a population that
    will not see it. Here the objective is the corpus, scored once through the mixture — the
    number a deployed configuration has — and a bucket below `min_cases` keeps the recorded
    weights rather than borrowing a vector fitted somewhere else.

    This is a different optimisation, not a harder search: the buckets share one metric, so a gain
    in one bucket and a loss in another are the same number, and the gate sees both.

    @param corpus - The corpus.
    @param train - The cases to fit on.
    @param code - Per-case signature from `signatures`.
    @param grid - Factors per coordinate.
    @param passes - Sweeps over every (bucket, term) pair.
    @param min_cases - Smallest TRAINING bucket that earns a vector of its own.
    @param gate - The per-type non-regression gate; None optimises the aggregate alone.
    @param eps_grid - The smallest and largest factor, as `eps_grid` and its reciprocal.
    @returns Bucket to overrides, with buckets that stayed at the recorded weights omitted.
    """
    mixture = Mixture(corpus, code)
    fittable = [
        bucket for bucket in mixture.buckets if int((code[train] == bucket).sum()) >= min_cases
    ]
    vectors: dict[int, dict[str, float]] = {bucket: {} for bucket in fittable}
    current = mixture.scores({})

    def objective(scores: np.ndarray) -> int:
        if gate is not None:
            return gate.score_of(corpus, scores, train)
        return int(corpus.top1_mask(scores)[train].sum())

    best = objective(current)
    factors = np.geomspace(eps_grid, 1.0 / eps_grid, grid)
    for _ in range(passes):
        improved = False
        for bucket in fittable:
            rows = mixture.rows[bucket]
            for name in corpus.names:
                incumbent = vectors[bucket].get(name, default_weight(corpus, name))
                reference = incumbent if abs(incumbent) > 1e-12 else 0.0
                for factor in factors:
                    trial = dict(vectors[bucket])
                    trial[name] = reference * factor if abs(reference) > 1e-12 else float(factor)
                    candidate = current.copy()
                    candidate[rows] = corpus.scores_rows(trial, rows)
                    score = objective(candidate)
                    if score > best:
                        best, vectors[bucket], current, improved = score, trial, candidate, True
        if not improved:
            break
    return {bucket: vector for bucket, vector in vectors.items() if vector}


def shrink(
    corpus: Corpus, vectors: dict[int, dict[str, float]], strength: float
) -> dict[int, dict[str, float]]:
    """Pull every fitted coefficient back toward the weight that shipped.

    A vector fitted on one fold is fitted to that fold: the coefficient carries the sample it saw,
    and the part of it that does not replicate is exactly the part that costs a fault type a case
    on the fold held out. A type gate constrains the SEARCH; shrinkage changes the VARIANCE of the
    reading itself, which is the quantity the held-out report is noisy in.

    @param corpus - The corpus, for each term's recorded weight.
    @param vectors - Bucket to overrides, as `joint_climb` returns them.
    @param strength - The share of the fitted vector kept; 1 keeps it whole, 0 returns the shipped.
    @returns The shrunk vectors, omitting any bucket whose every term landed on the recorded weight.
    """
    if strength >= 1.0:
        return {bucket: dict(vector) for bucket, vector in vectors.items()}
    out: dict[int, dict[str, float]] = {}
    for bucket, vector in vectors.items():
        recorded = {name: default_weight(corpus, name) for name in vector}
        shrunk = {
            name: strength * value + (1.0 - strength) * recorded[name]
            for name, value in vector.items()
        }
        if any(abs(shrunk[name] - recorded[name]) > 1e-12 for name in shrunk):
            out[bucket] = shrunk
    return out


def evaluate(
    corpus: Corpus, vectors: dict[int, dict[str, float]], cases: np.ndarray, code: np.ndarray
) -> dict[str, Any]:
    """A mixture's reading on a set of cases, per signature bucket and per fault type.

    One function for both readings, because the in-sample number and the held-out number are the
    same measurement on different populations, and a report that computed them separately could
    disagree with itself about what "the mixture scored" means.

    @param corpus - The corpus.
    @param vectors - Bucket to overrides.
    @param cases - The case indices to report on.
    @param code - Per-case signature from `signatures`.
    @returns Per-bucket `[n, hits, control]`, per-type `[hits, control]` and the pooled hits.
    """
    mixture = Mixture(corpus, code)
    hit = corpus.top1_mask(mixture.scores(vectors))
    control_hit = corpus.top1_mask(corpus.scores({}))
    table: dict[int, list[int]] = {}
    for bucket in mixture.buckets:
        selected = cases[code[cases] == bucket]
        if selected.size == 0:
            continue
        table[bucket] = [
            int(selected.size),
            int(hit[selected].sum()),
            int(control_hit[selected].sum()),
        ]
    by_type: dict[str, list[int]] = {}
    for case_index in cases:
        entry = by_type.setdefault(corpus.fault_type[int(case_index)], [0, 0])
        entry[0] += int(hit[int(case_index)])
        entry[1] += int(control_hit[int(case_index)])
    return {"table": table, "by_type": by_type, "hits": int(hit[cases].sum())}


def joint_fit(
    corpus: Corpus,
    folds: Sequence[np.ndarray],
    grid: int,
    passes: int,
    min_cases: int,
    gate: TypeGate | None = None,
    strength: float = 1.0,
) -> dict[str, Any]:
    """Fit a mixture jointly on k-1 folds and report the held-out one.

    @param corpus - The corpus.
    @param folds - Held-out case indices, one array per fold.
    @param grid - Factors per coordinate in each climb.
    @param passes - Sweeps per climb.
    @param min_cases - Smallest training bucket that earns a vector of its own.
    @param gate - The per-type non-regression gate, applied to the mixture as a whole.
    @param strength - How much of each fitted vector to keep; see `shrink`.
    @returns The per-bucket table, the per-type split and the pooled held-out reading.
    """
    code = signatures(corpus)
    every = np.arange(corpus.n_cases)
    table: dict[int, list[int]] = defaultdict(lambda: [0, 0, 0, 0])
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    vectors_by_fold: dict[int, dict[int, dict[str, float]]] = {}
    holdout_hits = 0
    for fold_index, holdout in enumerate(folds):
        train = np.setdiff1d(every, holdout)
        vectors = shrink(
            corpus, joint_climb(corpus, train, code, grid, passes, min_cases, gate=gate), strength
        )
        vectors_by_fold[fold_index] = vectors
        report = evaluate(corpus, vectors, holdout, code)
        for bucket, (count, hits, control_hits) in report["table"].items():
            entry = table[bucket]
            entry[0] += count
            entry[1] += hits
            entry[2] += control_hits
            entry[3] += 1
        for name, (hits, control_hits) in report["by_type"].items():
            entry = by_type[name]
            entry[0] += hits
            entry[1] += control_hits
        holdout_hits += report["hits"]
    return {
        "table": dict(table),
        "by_type": dict(by_type),
        "hits": holdout_hits,
        "holdout": holdout_hits,
        "folds": len(folds),
        "vectors": vectors_by_fold,
    }


def render_mixture(report: dict[str, Any], total: int, control: dict[str, Any], title: str) -> str:
    """The mixture's table, its per-type split and its pooled line, as one printable block.

    Both readings render through here — the one fitted on all of the corpus and the one fitted on
    folds — so they can be read side by side without wondering whether the difference is in the
    table or in the heading.

    @param report - As `evaluate` or `joint_fit` returns it.
    @param total - The cases the report covers.
    @param control - The control metrics, for the shipped percentage.
    @param title - The heading line.
    @returns The block.
    """
    lines = [title]
    lines.append(f"  {'signature':28s} {'n':>5s} {'control':>8s} {'mixture':>8s} {'delta':>7s}")
    for bucket, entry in sorted(report["table"].items()):
        count, hits, control_hits = entry[0], entry[1], entry[2]
        lines.append(
            f"  {describe_signature(bucket):28s} {count:5d} {control_hits:8d} {hits:8d} "
            f"{hits - control_hits:+7d}"
        )
    lines.append(f"  {'faultType':32s} {'control':>8s} {'mixture':>8s} {'delta':>7s}")
    for name, (hits, control_hits) in sorted(report["by_type"].items()):
        lines.append(f"  {name:32s} {control_hits:8d} {hits:8d} {hits - control_hits:+7d}")
    regressed = [
        name for name, (hits, control_hits) in report["by_type"].items() if hits < control_hits
    ]
    lines.append(
        f"  pooled {report['hits']}/{total} ({100.0 * report['hits'] / max(total, 1):.2f}%)  "
        f"shipped {100.0 * control['at1'] / total:.2f}%  "
        f"delta {report['hits'] - control['at1']:+d}  "
        f"types down: {', '.join(regressed) if regressed else 'none'}"
    )
    return "\n".join(lines)


def transfer(vectors: dict[int, dict[str, float]], target: Corpus) -> dict[str, Any]:
    """Score a mixture fitted on one corpus on ANOTHER, bucket by bucket.

    A vector that transfers is a claim about the mechanism: the signature says which channels a
    case carries, so if the same signature wants the same coefficients in a corpus it was not
    fitted on, the coefficients belong to the channels. A vector that does not transfer is a claim
    about the corpus — which is what every in-sample coefficient is until this test is run.

    A bucket the source never fitted keeps the recorded weights, and the table says so rather than
    silently reporting a borrowed reading as a fit.

    @param vectors - Bucket to overrides, as `joint_climb` returns them.
    @param target - The corpus to score on.
    @returns The per-bucket table, the pooled reading and the control it is measured against.
    """
    code = signatures(target)
    mixture = Mixture(target, code)
    hit = target.top1_mask(mixture.scores(vectors))
    control_hit = target.top1_mask(target.scores({}))
    table: dict[int, tuple[int, int, int, bool]] = {}
    for bucket in mixture.buckets:
        selected = code == bucket
        table[bucket] = (
            int(selected.sum()),
            int(control_hit[selected].sum()),
            int(hit[selected].sum()),
            bool(vectors.get(bucket)),
        )
    return {
        "table": table,
        "at1": int(hit.sum()),
        "control": int(control_hit.sum()),
        "n_cases": target.n_cases,
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


def members_of(mask: np.ndarray | None, n_cases: int) -> np.ndarray | None:
    """Normalise a population mask, which arrives as case INDICES or as booleans.

    @param mask - The mask, or None for the whole corpus.
    @param n_cases - How many cases the corpus has.
    @returns A boolean membership array, or None.
    """
    if mask is None:
        return None
    arr = np.asarray(mask)
    if arr.dtype == bool and arr.size == n_cases:
        return arr
    members = np.zeros(n_cases, dtype=bool)
    members[arr] = True
    return members


class CaseFloor:
    """No case the shipped ranking answers correctly may stop being answered correctly.

    This is the STRICTEST reading of the non-regression rule and the one a delivered default
    actually owes: a corpus is a set of cases, not a table of counts. `TypeGate` compares counts, so
    a type at 38/39 may lose a case as long as it wins another — and over four iterations that rule
    has refused every arm, because the counts it compares are sums over cases whose margins differ
    by two orders of magnitude (median win 0.947, the thin ones 0.006). A floor over the cases
    themselves cannot be satisfied that way: every case the control wins must still be won.

    Satisfying it is therefore a strictly stronger claim than the type rule, and a vector that
    clears it satisfies the type rule for free.
    """

    def __init__(self, corpus: Corpus, price: float = 1.0, step: float = 2.0, cap: float = 64.0) -> None:
        """@param corpus - The corpus. @param price - The starting price of a lost case.
        @param step - Factor the price rises by each round a case is still lost.
        @param cap - Highest price the floor may reach.
        """
        self.won = corpus.top1_mask(corpus.scores({}))
        self.price = price
        self.step = step
        self.cap = cap

    def violations(
        self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None = None
    ) -> dict[str, int]:
        """The cases the control answered correctly that this vector does not.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The population to judge on; None for all.
        @returns `{'case': -lost}` when any case is lost, else empty.
        """
        hit = corpus.top1_mask(corpus.scores(weights))
        members = members_of(mask, corpus.n_cases)
        guarded = self.won if members is None else self.won & members
        lost = int((guarded & ~hit).sum())
        return {"case": -lost} if lost else {}

    @property
    def duals(self) -> dict[str, float]:
        """The price as a single multiplier, so the report of a fit reads the same for both floors."""
        return {"case": self.price}

    def price_of(self, lost: dict[str, int]) -> float:
        """What a violation costs at the current price.

        @param lost - The violation reading.
        @returns The charge, in cases.
        """
        return sum(self.price * abs(value) for value in lost.values())

    def learn(self, lost: dict[str, int]) -> None:
        """Raise the price of a case that is still lost.

        @param lost - The violation reading.
        """
        if lost:
            self.price = min(self.cap, self.price * self.step)

    def score(self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None) -> int:
        """The priced objective the climb maximises.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The cases the fit is scored on, or None for all.
        @returns Cases won minus the priced cost of the cases it broke.
        """
        total = top1_on(corpus, weights, mask)
        return total - int(round(self.price_of(self.violations(corpus, weights, mask))))


def margins(corpus: Corpus, scores: np.ndarray) -> np.ndarray:
    """Per case, the best accepted candidate's score minus the best rejected one's.

    `Top@1` is the sign of this number and nothing else, which is why a fit that optimises it can
    trade a hundred comfortable wins for sixteen cases it had won by 0.006 and report the total as
    a gain. On the archive those sixteen are exactly the cases the +131 vector loses: every one of
    them was a thin win (median control-won margin 0.947, the lost ones 0.006 to 0.64) and **none**
    of them was a tie, so the loss is real information about the objective and not a tie-break.

    A case whose truth is not among its candidates has no margin: `-inf`, so no surrogate can pay
    for it. A case whose every candidate is accepted has no competitor and is won outright: `+inf`.

    @param corpus - The corpus.
    @param scores - Candidate scores, one per row.
    @returns One margin per case, in case order.
    """
    starts = corpus.starts()
    accepted = np.where(corpus.is_answer, scores, -np.inf)
    rejected = np.where(corpus.is_answer, -np.inf, scores)
    best_accepted = np.maximum.reduceat(accepted, starts)
    best_rejected = np.maximum.reduceat(rejected, starts)
    # A segment with no rejected row reduces to `-inf`; everything is accepted, so the case is won
    # whatever the weights do and the margin is unbounded in the only direction that matters.
    return np.where(
        np.isneginf(best_rejected),
        np.where(np.isneginf(best_accepted), -np.inf, np.inf),
        best_accepted - best_rejected,
    )


def margin_paid(corpus: Corpus, scores: np.ndarray, tau: float) -> np.ndarray:
    """The surrogate, per case, so a fit can be scored on part of the corpus.

    @param corpus - The corpus.
    @param scores - Candidate scores, one per row.
    @param tau - The margin at which the surrogate is about 76 % paid.
    @returns One payment per case: `tanh(margin / tau)`, 1 where every candidate is accepted, 0
    where the truth is not a candidate.
    """
    margin = margins(corpus, scores)
    finite = np.isfinite(margin)
    paid = np.zeros(margin.shape, dtype=np.float64)
    paid[finite] = np.tanh(margin[finite] / tau)
    paid[np.isposinf(margin)] = 1.0
    return paid


def margin_score(corpus: Corpus, scores: np.ndarray, tau: float) -> float:
    """The surrogate a margin-aware fit maximises: `sum tanh(margin / tau)`.

    Bounded, so one case cannot dominate the fit the way an unclipped margin would; monotone in the
    margin, so it never prefers a wrong ranking; and steepest where the margin is small, which is
    where the archive's decisions are decided.

    @param corpus - The corpus.
    @param scores - Candidate scores, one per row.
    @param tau - The margin at which the surrogate is about 76 % paid.
    @returns The surrogate value.
    """
    return float(margin_paid(corpus, scores, tau).sum())


#: The fixed-point scale the surrogate is carried in, because `hill_climb` compares integers and a
#: surrogate worth one case per case must weigh the same as one case in the floor's price.
SURROGATE_SCALE = 1_000_000


class Surrogate:
    """The margin surrogate as an objective, optionally still subject to the type floor.

    A fit scored on this cannot be paid for trading sixteen thin wins for a hundred wide ones: the
    thin ones are where `tanh` is steep and the wide ones are where it is flat. That is the whole
    defect of the step objective, and it is measured — the +131 vector's sixteen losses were the
    thinnest margins on the corpus, from 0.006 where the median win is 0.947.
    """

    def __init__(
        self, corpus: Corpus, tau: float = 0.25, floor: Lagrangian | None = None
    ) -> None:
        """@param corpus - The corpus. @param tau - The margin scale.
        @param floor - The priced type floor, or None to fit on margins alone.
        """
        self.tau = tau
        self.floor = floor

    def score(self, corpus: Corpus, weights: dict[str, float], mask: np.ndarray | None) -> int:
        """The priced surrogate.

        @param corpus - The corpus.
        @param weights - The candidate vector.
        @param mask - The cases the fit is scored on, or None for all.
        @returns The surrogate in fixed point, minus the floor's price in the same units.
        """
        paid = margin_paid(corpus, corpus.scores(weights), self.tau)
        seen = paid if mask is None else paid[mask]
        total = int(round(SURROGATE_SCALE * float(seen.sum())))
        if self.floor is None:
            return total
        return total - int(round(SURROGATE_SCALE * self.floor.price_of(self.floor.violations(corpus, weights, mask))))


def repair_fit(
    corpus: Corpus,
    folds: Sequence[np.ndarray],
    grid: int,
    passes: int,
    rounds: int,
    min_population: int,
    step: float = 2.0,
    cap: float = 64.0,
    surrogate_tau: float | None = None,
) -> dict[str, Any]:
    """The priced floor fitted on everything, then fitted per fold and read on the held-out part.

    Two readings of one instrument. The in-sample one is the configuration that would ship; the
    held-out one is the only number that says whether the floor survives a corpus it was not fitted
    on. Iteration 263 could not separate the two, because its climb never left the control and both
    numbers were the same number.

    @param corpus - The corpus.
    @param folds - Held-out case indices, one array per fold.
    @param grid - Factors per coordinate in each climb.
    @param passes - Sweeps per climb.
    @param rounds - Climb/re-price rounds allowed per fit.
    @param min_population - Smallest gated type.
    @param step - Factor a still-lowered type's price is multiplied by each round.
    @param cap - Highest price any single type may reach.
    @param surrogate_tau - Fit on the margin surrogate at this scale instead of on `Top@1`, or None.
    @returns The in-sample fit, the per-type held-out split, the pooled reading and the per-fold
    vectors.
    """
    every = np.arange(corpus.n_cases)

    def start_from(train: np.ndarray) -> dict[str, float]:
        # The warm start is the `Top@1` optimum of the same population: a margin fit begun there
        # keeps the cases the step objective already won and spends its budget on the thin ones.
        return {} if surrogate_tau is not None else hill_climb(corpus, train, grid, passes)

    inside = repair(
        corpus,
        every,
        grid,
        passes,
        rounds,
        min_population,
        step=step,
        cap=cap,
        start=start_from(every),
        surrogate_tau=surrogate_tau,
    )
    control_hit = corpus.top1_mask(corpus.scores({}))
    by_type: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    vectors: dict[int, dict[str, float]] = {}
    holdout_hits = 0
    improved = 0
    for index, held in enumerate(folds):
        train = np.setdiff1d(every, held)
        out = repair(
            corpus,
            train,
            grid,
            passes,
            rounds,
            min_population,
            step=step,
            cap=cap,
            start=start_from(train),
            surrogate_tau=surrogate_tau,
        )
        vectors[index] = out["weights"]
        improved += int(out["total"] > top1_on(corpus, {}, train))
        hit = corpus.top1_mask(corpus.scores(out["weights"]))
        holdout_hits += int(hit[held].sum())
        for case_index in held:
            entry = by_type[corpus.fault_type[int(case_index)]]
            entry[0] += int(hit[int(case_index)])
            entry[1] += int(control_hit[int(case_index)])
    return {
        "inside": inside,
        "by_type": dict(by_type),
        "holdout": holdout_hits,
        "folds": len(folds),
        "vectors": vectors,
        "improved": improved,
    }


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dump", help="fse26-terms.ndjson from --terms-dump")
    parser.add_argument(
        "--only",
        choices=("ceiling", "global", "heldout", "regimes", "joint", "transfer", "repair"),
        default=None,
    )
    parser.add_argument("--min-bucket", type=int, default=40)
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=20261112)
    parser.add_argument("--grid", type=int, default=9)
    parser.add_argument("--passes", type=int, default=3)
    parser.add_argument("--eps", type=float, default=1e-6)
    parser.add_argument(
        "--rounds",
        type=int,
        default=4,
        metavar="N",
        help="climb/re-price rounds a priced floor is given before it settles",
    )
    parser.add_argument(
        "--price-step",
        type=float,
        default=2.0,
        metavar="FACTOR",
        help="what a still-lowered fault type's price is multiplied by each round",
    )
    parser.add_argument(
        "--surrogate",
        type=float,
        default=None,
        metavar="TAU",
        help="fit on sum tanh(margin/TAU) instead of on Top@1, so a thin win costs what it is",
    )
    parser.add_argument(
        "--price-cap",
        type=float,
        default=64.0,
        metavar="PRICE",
        help="highest price one type may reach, so a hopeless floor cannot bid the corpus away",
    )
    parser.add_argument(
        "--gate-types",
        type=int,
        default=0,
        metavar="MIN_CASES",
        help="refuse any vector that lowers a fault type with at least MIN_CASES cases",
    )
    parser.add_argument(
        "--shrink",
        type=float,
        default=1.0,
        metavar="STRENGTH",
        help="share of each fitted vector to keep, the rest going back to the recorded weight",
    )
    parser.add_argument(
        "--transfer-from",
        metavar="SOURCE",
        default=None,
        help="fit the mixture on SOURCE and score it on the dump, bucket by bucket",
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

    if args.only in (None, "joint"):
        gate = None if args.gate_types <= 0 else TypeGate(corpus, args.gate_types)
        code = signatures(corpus)
        every = np.arange(total)
        # `--folds 0` is the configuration that would ship: one vector per signature, fitted on
        # every case the corpus has. The folds reading is the estimate of what that configuration
        # does on cases it has not seen, and the two are reported through the same renderer so a
        # difference between them can only be a difference in the numbers.
        if args.folds <= 0:
            vectors = shrink(
                corpus, joint_climb(corpus, every, code, args.grid, args.passes, args.min_bucket, gate=gate), args.shrink
            )
            report = evaluate(corpus, vectors, every, code)
            print(
                render_mixture(
                    report,
                    total,
                    control,
                    f"\nJOINT in-sample, one climb over every signature at once, "
                    f"min bucket {args.min_bucket}, shrink {args.shrink:g}",
                )
            )
            rendered = ', '.join(
                f"{describe_signature(bucket)}: "
                f"{ {name: round(float(value), 4) for name, value in vector.items()} }"
                for bucket, vector in sorted(vectors.items())
            )
            print(f"  vectors: {rendered if rendered else 'no bucket above the floor'}")
        else:
            report = joint_fit(
                corpus,
                folds_of(corpus, args.folds, args.seed),
                args.grid,
                args.passes,
                args.min_bucket,
                gate=gate,
                strength=args.shrink,
            )
            print(
                render_mixture(
                    report,
                    total,
                    control,
                    f"\nJOINT one climb over every signature at once, scored on the mixture, "
                    f"{report['folds']}-fold held-out, min bucket {args.min_bucket}, "
                    f"shrink {args.shrink:g}",
                )
            )
            for fold_index, vectors in sorted(report["vectors"].items()):
                rendered = ', '.join(
                    f"{describe_signature(bucket)}: "
                    f"{ {name: round(float(value), 4) for name, value in vector.items()} }"
                    for bucket, vector in sorted(vectors.items())
                )
                print(f"  fold {fold_index}: {rendered if rendered else 'no bucket above the floor'}")

    if args.only in (None, "repair"):
        if args.gate_types <= 0:
            raise SystemExit(
                "--only repair needs --gate-types N: a priced floor is defined by a population "
                "floor, and without one every one-case type becomes a constraint"
            )
        folds = folds_of(corpus, args.folds, args.seed)
        report = repair_fit(
            corpus,
            folds,
            args.grid,
            args.passes,
            args.rounds,
            args.gate_types,
            step=args.price_step,
            cap=args.price_cap,
            surrogate_tau=args.surrogate,
        )
        inside = report["inside"]
        print(
            f"\nREPAIR one priced floor, {args.rounds} rounds, price x{args.price_step:g} to a cap of "
            f"{args.price_cap:g}, types of {args.gate_types}+ cases, {report['folds']}-fold held-out, "
            f"{'margins at tau ' + format(args.surrogate, 'g') if args.surrogate else 'Top@1'}"
        )
        print(f"  {'round':>5s} {'total':>7s} {'types down':>11s} {'charged':>8s}")
        for index, (total, down, price) in enumerate(inside["schedule"]):
            print(f"  {index:5d} {total:7d} {down:11d} {price:8d}")
        refused = inside["refused"]
        print(
            f"  accepted {inside['total']} ({100.0 * inside['total'] / total:.2f}%)  "
            f"shipped {100.0 * control['at1'] / total:.2f}%  delta {inside['total'] - control['at1']:+d}  "
            f"types down: {', '.join(inside['lost']) if inside['lost'] else 'none'}"
        )
        if refused is not None:
            print(
                f"  refused  {refused['total']} ({100.0 * refused['total'] / total:.2f}%)  "
                f"types down: "
                f"{', '.join(f'{name} {value:+d}' for name, value in sorted(refused['lost'].items()))}"
            )
        print(f"  {'faultType':32s} {'control':>8s} {'repair':>8s} {'delta':>7s}")
        for name, (hits, control_hits) in sorted(report["by_type"].items()):
            print(f"  {name:32s} {control_hits:8d} {hits:8d} {hits - control_hits:+7d}")
        regressed = [name for name, (hits, base) in report["by_type"].items() if hits < base]
        print(
            f"  pooled holdout {report['holdout']}/{total} "
            f"({100.0 * report['holdout'] / max(total, 1):.2f}%)  "
            f"shipped {100.0 * control['at1'] / total:.2f}%  "
            f"delta {report['holdout'] - control['at1']:+d}  "
            f"folds improved {report['improved']}/{report['folds']}  "
            f"types down: {', '.join(regressed) if regressed else 'none'}"
        )
        for fold_index, vector in sorted(report["vectors"].items()):
            print(
                f"  fold {fold_index}: "
                f"{ {name: round(float(value), 4) for name, value in vector.items()} }"
                if vector
                else f"  fold {fold_index}: no move cleared the floor"
            )

    if args.transfer_from:
        source = load(args.transfer_from)
        vectors = shrink(
            source,
            joint_climb(
                source,
                np.arange(source.n_cases),
                signatures(source),
                args.grid,
                args.passes,
                args.min_bucket,
            ),
            args.shrink,
        )
        borrowed = transfer(vectors, corpus)
        print(
            f"\nTRANSFER fitted on {args.transfer_from} ({source.n_cases} cases) and scored on "
            f"{corpus.n_cases}, min bucket {args.min_bucket}, shrink {args.shrink:g}"
        )
        print(f"  {'signature':28s} {'n':>5s} {'control':>8s} {'transfer':>9s} {'delta':>7s}  from")
        for bucket, (count, control_hits, hits, used) in sorted(borrowed["table"].items()):
            print(
                f"  {describe_signature(bucket):28s} {count:5d} {control_hits:8d} {hits:9d} "
                f"{hits - control_hits:+7d}  {'source' if used else 'recorded'}"
            )
        print(
            f"  pooled {borrowed['at1']}/{borrowed['n_cases']} "
            f"({100.0 * borrowed['at1'] / borrowed['n_cases']:.2f}%)  "
            f"control {borrowed['control']} ({100.0 * borrowed['control'] / borrowed['n_cases']:.2f}%)  "
            f"delta {borrowed['at1'] - borrowed['control']:+d}"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
