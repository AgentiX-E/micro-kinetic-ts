"""Unit tests for the weight-fit instrument.

`scripts/terms-fit.py` is the thing that decides whether the additive score has anything left
in it, so the properties worth pinning are the ones that would otherwise make its verdict
unfalsifiable: that its control equals the run it reads, that a per-case LP answers the
question it claims to (an upper bound over ALL non-negative weight vectors, not a fit), that
the split it reports held-out numbers on is stratified and seeded, and that "the answer is not
among the candidates" is counted as a floor rather than as a failure of the weights.

The corpora here are four to eight cases wide with hand-computable scores. The real dump is
1422 cases and 69 688 candidate rows; a gate must not depend on a 37 MB CI artifact.

The module is loaded by PATH because its name contains a hyphen, which `import` cannot address.
"""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import pathlib
import runpy
import sys
import tempfile
import unittest

import numpy as np

SCRIPT = pathlib.Path(__file__).resolve().parent / 'terms-fit.py'
SPEC = importlib.util.spec_from_file_location('terms_fit', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
fit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fit)


def row(service: str, terms: dict[str, float], weights: dict[str, float] | None = None) -> dict:
    """One candidate row in the dump's shape.

    @param service - The service id.
    @param terms - Term name to slope; a slope of `None` means the term was not measurable.
    @param weights - Term name to recorded weight; defaults to 1 for every measured slope.
    @returns The candidate dict.
    """
    recorded = weights or {}
    return {
        'id': service,
        'score': 0.0,
        'terms': [
            [name, recorded.get(name, 1.0), slope] for name, slope in terms.items()
        ],
    }


def case(datapack: str, accepted: list[str], fault: str, rows: list[dict]) -> dict:
    """One case in the dump's shape.

    @param datapack - The case id.
    @param accepted - The ground-truth services.
    @param fault - The fault type.
    @param rows - The candidate rows.
    @returns The case dict.
    """
    return {'datapack': datapack, 'accepted': accepted, 'faultType': fault, 'candidates': rows}


#: Four cases whose control reading is known by hand: `K1` is ranked correctly, `K2` is not,
#: `D1` needs the second term to separate and `D2`'s truth is not among its candidates at all.
CORPUS = [
    case('K1', ['a'], 'Kill', [
        row('a', {'s': 0.9}), row('b', {'s': 0.5}), row('c', {'s': 0.1}),
    ]),
    case('K2', ['b'], 'Kill', [
        row('a', {'s': 0.9}), row('b', {'s': 0.5}), row('c', {'s': 0.1}),
    ]),
    case('D1', ['a'], 'Delay', [
        row('a', {'s': 0.2, 't': 0.9}), row('b', {'s': 0.9, 't': 0.1}), row('c', {'s': 0.0, 't': 0.0}),
    ]),
    case('D2', ['zzz'], 'Delay', [
        row('a', {'s': 0.2}), row('b', {'s': 0.9}), row('c', {'s': 0.0}),
    ]),
]


#: Four cases where the truth is second on `s` and first on `t`, and `t` ships at weight 0 — the
#: shape of the real finding, small enough to fit in a gate.
IMPROVING = [
    case(f'C{index}', ['a'], 'Kill', [
        row('a', {'s': 0.1, 't': 0.9}, {'t': 0.0}),
        row('b', {'s': 0.9, 't': 0.1}, {'t': 0.0}),
    ])
    for index in range(4)
]


#: Two channel signatures and one term only the `+lat` bucket can see. `D` cases need `t`, which
#: ships at weight 0; the `-lat` bucket holds two cases, fewer than any floor worth fitting on.
JOINT = [
    case('K1', ['a'], 'Kill', [row('a', {'s': 0.9, 'lat': 0.1}), row('b', {'s': 0.1, 'lat': 0.1})]),
    case('K2', ['a'], 'Kill', [row('a', {'s': 0.9, 'lat': 0.1}), row('b', {'s': 0.1, 'lat': 0.1})]),
    case('D1', ['a'], 'Delay', [
        row('a', {'s': 0.1, 't': 0.9, 'lat': 0.1}, {'t': 0.0}),
        row('b', {'s': 0.9, 't': 0.1, 'lat': 0.1}, {'t': 0.0}),
    ]),
    case('D2', ['a'], 'Delay', [
        row('a', {'s': 0.1, 't': 0.9, 'lat': 0.1}, {'t': 0.0}),
        row('b', {'s': 0.9, 't': 0.1, 'lat': 0.1}, {'t': 0.0}),
    ]),
    case('K3', ['a'], 'Kill', [row('a', {'s': 0.9}), row('b', {'s': 0.1})]),
    case('K4', ['a'], 'Kill', [row('a', {'s': 0.9}), row('b', {'s': 0.1})]),
]


def corpus_of(cases: list[dict]) -> 'fit.Corpus':
    """Build a corpus from case dicts.

    @param cases - The cases.
    @returns The corpus.
    """
    return fit.Corpus(cases)


def write(cases: list[dict], directory: str, name: str = 'terms.ndjson') -> str:
    """Write cases as the ndjson a `--terms-dump` run produces.

    @param cases - The cases.
    @param directory - Where to write.
    @param name - The file name.
    @returns The path written.
    """
    path = str(pathlib.Path(directory) / name)
    with pathlib.Path(path).open('w', encoding='utf-8') as handle:
        for item in cases:
            handle.write(json.dumps(item) + '\n')
    return path


class TheControlIsTheRun(unittest.TestCase):
    """A screen whose control is not the run it reads is measuring its own arithmetic."""

    def test_the_base_score_is_the_recorded_weight_times_the_slope(self) -> None:
        corpus = corpus_of(CORPUS)
        self.assertAlmostEqual(corpus.base[0], 0.9)
        # Row 3 is `b` of K1, and its weight is 1 rather than the 0.9 its neighbour carries.
        self.assertAlmostEqual(corpus.base[1], 0.5)

    def test_a_null_slope_contributes_nothing_at_any_weight(self) -> None:
        corpus = corpus_of([case('X', ['a'], 'Kill', [
            row('a', {'s': 0.4, 'logged': None}), row('b', {'s': 0.2}),
        ])])
        self.assertAlmostEqual(corpus.base[0], 0.4)
        # A weight of a million on an unmeasurable term moves nothing, which is the property that
        # keeps `--set` from inventing evidence.
        self.assertAlmostEqual(corpus.scores({'logged': 1e6})[0], 0.4)

    def test_an_override_is_a_delta_against_the_recorded_weight(self) -> None:
        corpus = corpus_of(CORPUS)
        # D1's `a` carries s=0.2 at weight 1 and t=0.9 at weight 1; overriding `t` to 0 has to
        # remove exactly 0.9 and leave the 0.2 alone.
        offset = corpus.bounds[2][0]
        self.assertAlmostEqual(corpus.scores({'t': 0.0})[offset], 0.2)
        self.assertAlmostEqual(corpus.scores({'t': 2.0})[offset], 0.2 + 1.8)

    def test_an_unknown_term_is_refused_rather_than_ignored(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            corpus_of(CORPUS).scores({'nonsense': 1.0})
        self.assertIn('unknown term', str(raised.exception))

    def test_the_control_reproduces_the_run_reading(self) -> None:
        metrics = corpus_of(CORPUS).metrics(corpus_of(CORPUS).scores({}))
        self.assertEqual((metrics['at1'], metrics['at3'], metrics['at5']), (2, 3, 3))


class Positions(unittest.TestCase):
    """Rank within the case, with the engine's own tiebreak."""

    def test_a_tie_is_broken_by_service_id(self) -> None:
        corpus = corpus_of([case('T', ['m'], 'Kill', [
            row('n', {'s': 0.5}), row('m', {'s': 0.5}),
        ])])
        positions = corpus.positions(corpus.scores({}))
        self.assertEqual(list(positions), [1, 0])

    def test_positions_are_contiguous_and_start_at_zero(self) -> None:
        corpus = corpus_of(CORPUS)
        positions = corpus.positions(corpus.scores({}))
        for start, stop in corpus.bounds:
            # The first ROW of a case is not necessarily its best candidate — `D2`'s is ranked
            # second — so the property is that the block is a permutation of 0..n-1.
            self.assertEqual(positions[start:stop].min(), 0)
            self.assertEqual(sorted(positions[start:stop]), list(range(stop - start)))

    def test_the_fast_top1_agrees_with_the_sorted_metrics_ON_A_TIE(self) -> None:
        # Two candidates that both score exactly zero exercise the one case the two-maximum
        # shortcut cannot decide, so the exact fallback is reached rather than trusted.
        corpus = corpus_of([case('Z', ['a'], 'Kill', [
            row('a', {'s': 0.0}), row('b', {'s': 0.0}),
        ]), case('Y', ['b'], 'Kill', [
            row('a', {'s': 0.9}), row('b', {'s': 0.0}),
        ])])
        scores = corpus.scores({})
        self.assertEqual(int(corpus.top1_mask(scores).sum()), corpus.metrics(scores)['at1'])
        self.assertEqual(int(corpus.top1_mask(scores).sum()), 1)


class Separability(unittest.TestCase):
    """The LP answers "does ANY weight vector separate this case", and its floor is the corpus."""

    def test_an_ordering_by_a_single_term_is_separable(self) -> None:
        corpus = corpus_of(CORPUS)
        self.assertTrue(fit.separable(corpus, 0, 1e-6, allow_negative=False))

    def test_a_case_whose_truth_is_ranked_second_by_the_only_term_is_NOT_separable(self) -> None:
        # Every candidate's score is a multiple of the same slope, so no choice of weight can
        # invert that pair: the case is a floor, not a tuning problem.
        corpus = corpus_of(CORPUS)
        self.assertFalse(fit.separable(corpus, 1, 1e-6, allow_negative=False))
        self.assertFalse(fit.separable(corpus, 1, 1e-6, allow_negative=True))

    def test_a_second_term_can_separate_what_the_first_could_not(self) -> None:
        corpus = corpus_of(CORPUS)
        self.assertTrue(fit.separable(corpus, 2, 1e-6, allow_negative=False))

    def test_a_truth_that_is_not_a_candidate_is_a_FLOOR_not_a_failure(self) -> None:
        corpus = corpus_of(CORPUS)
        self.assertFalse(fit.separable(corpus, 3, 1e-6, allow_negative=False))

    def test_a_competitor_indistinguishable_on_every_term_blocks_the_answer(self) -> None:
        corpus = corpus_of([case('X', ['a'], 'Kill', [
            row('a', {'s': 0.4}), row('b', {'s': 0.4}),
        ])])
        start, stop = corpus.bounds[0]
        self.assertIsNone(fit.margins_for(corpus, 0, 0, start, stop))
        self.assertFalse(fit.separable(corpus, 0, 1e-6, allow_negative=False))

    def test_sign_freedom_does_NOT_rescue_a_case_the_single_term_orders_wrongly(self) -> None:
        # The second ceiling column is a price, not a rescue: allowing negative weights cannot
        # invert a pair whose scores differ by a positive multiple of the only slope they have,
        # because flipping the weight flips both sides of the comparison.
        corpus = corpus_of(CORPUS)
        self.assertFalse(fit.separable(corpus, 1, 1e-6, allow_negative=True))
        self.assertTrue(fit.separable(corpus, 0, 1e-6, allow_negative=True))

    def test_the_ceiling_counts_both_columns(self) -> None:
        corpus = corpus_of(CORPUS)
        table = fit.ceiling(corpus, 1e-6)
        self.assertEqual(table['Kill'], (2, 1, 1))
        self.assertEqual(table['Delay'], (2, 1, 1))


class Weights(unittest.TestCase):
    """Reading the recorded weight back as one number, and climbing from it."""

    def test_the_default_follows_the_recorded_magnitude(self) -> None:
        corpus = corpus_of([case('W', ['a'], 'Kill', [
            row('a', {'s': 0.4}, {'s': 3.0}), row('b', {'s': 0.2}, {'s': 3.0}),
        ]), case('V', ['a'], 'Kill', [
            row('a', {'s': 0.4}, {'s': 5.0}), row('b', {'s': 0.2}, {'s': 5.0}),
        ])])
        self.assertEqual(fit.default_weight(corpus, 's'), 4.0)

    def test_a_term_the_run_never_charged_reads_as_zero(self) -> None:
        corpus = corpus_of(IMPROVING)
        self.assertEqual(fit.default_weight(corpus, 't'), 0.0)

    def test_a_climb_finds_the_term_the_shipped_weights_gated_to_zero(self) -> None:
        # The truth is second on `s` in every case and first on `t`, and `t` ships at weight 0 —
        # so the climb has to reach for a term the run never charged for.
        corpus = corpus_of(IMPROVING)
        self.assertEqual(fit.top1_on(corpus, {}), 0)
        weights = fit.hill_climb(corpus, np.arange(4), grid=5, passes=2)
        self.assertGreater(weights.get('t', 0.0), 0.0)
        self.assertEqual(fit.top1_on(corpus, weights), 4)

    def test_a_climb_that_can_do_nothing_returns_no_override(self) -> None:
        # Every case is already correct, so the incumbent cannot be improved and the fit has to
        # report "no change" rather than an arbitrary vector.
        corpus = corpus_of([case('X', ['a'], 'Kill', [
            row('a', {'s': 0.9}), row('b', {'s': 0.1}),
        ])])
        self.assertEqual(fit.hill_climb(corpus, np.arange(1), grid=3, passes=2), {})


class TheTypeGate(unittest.TestCase):
    """A shipped default may not buy its total by abandoning a fault shape."""

    def test_the_floor_is_the_control_reading_of_every_type_in_population(self) -> None:
        gate = fit.TypeGate(corpus_of(CORPUS), 2)
        self.assertEqual(gate.control, {'Delay': 1, 'Kill': 1})

    def test_a_type_below_population_is_measured_but_not_GATED(self) -> None:
        # On a type with four cases a single case is 25 pp, so gating it would protect noise.
        gate = fit.TypeGate(corpus_of(CORPUS), 3)
        self.assertEqual(gate.control, {})

    def test_a_vector_that_lowers_a_type_is_reported_with_how_far(self) -> None:
        corpus = corpus_of(CORPUS)
        gate = fit.TypeGate(corpus, 2)
        # Flipping the sign of the only term ranks `K1`'s truth last, which costs `Kill` its case.
        lost = gate.violations(corpus, {'s': -1.0})
        self.assertEqual(lost, {'Kill': -1})

    def test_the_penalty_outweighs_every_case_the_corpus_contains(self) -> None:
        corpus = corpus_of(CORPUS)
        gate = fit.TypeGate(corpus, 2)
        admitted = gate.score(corpus, {}, None)
        refused = gate.score(corpus, {'s': -1.0}, None)
        self.assertEqual(admitted, 2)
        self.assertLess(refused, 0)
        self.assertGreater(abs(refused - admitted), corpus.n_cases)

    def test_a_masked_fit_can_leave_a_type_out_of_the_penalty(self) -> None:
        # A fold that holds every `Kill` case out can only be judged on what it can see, so the
        # gate must not punish a vector for a type the fit was not shown.
        corpus = corpus_of(CORPUS)
        gate = fit.TypeGate(corpus, 2)
        mask = np.array([False, False, True, True])
        self.assertEqual(gate.score(corpus, {'s': -1.0}, mask), fit.top1_on(corpus, {'s': -1.0}, mask))


class Signatures(unittest.TestCase):
    """The conditioner: which channels a case carries, read without its label."""

    def test_a_bit_is_set_when_ANY_candidate_carries_the_channel(self) -> None:
        corpus = corpus_of([
            case('A', ['a'], 'Kill', [row('a', {'s': 0.5, 'lat': 0.1}), row('b', {'s': 0.1})]),
            case('B', ['a'], 'Kill', [row('a', {'s': 0.5}), row('b', {'s': 0.1})]),
        ])
        codes = fit.signatures(corpus)
        self.assertEqual(int(codes[0]) & 1, 1)
        self.assertEqual(int(codes[1]), 0)

    def test_the_signature_names_its_own_channels(self) -> None:
        self.assertEqual(fit.describe_signature(7), '+lat +failedEdge +log')
        self.assertEqual(fit.describe_signature(0), '-lat -failedEdge -log')
        self.assertEqual(fit.describe_signature(2), '-lat +failedEdge -log')


class TheMixture(unittest.TestCase):
    """One vector per channel signature, fitted on train folds and reported on the held-out one."""

    def test_the_table_covers_every_held_out_case_exactly_once(self) -> None:
        corpus = corpus_of(IMPROVING + CORPUS)
        folds = fit.folds_of(corpus, 2, seed=5)
        report = fit.regime_fit(corpus, folds, grid=3, passes=1, min_cases=2)
        self.assertEqual(sum(entry[0] for entry in report["table"].values()), corpus.n_cases)
        self.assertEqual(sum(entry[1] for entry in report["table"].values()), report["holdout"])
        self.assertEqual(report["folds"], 2)

    def test_every_held_out_case_lands_in_the_per_type_table(self) -> None:
        corpus = corpus_of(IMPROVING + CORPUS)
        report = fit.regime_fit(corpus, fit.folds_of(corpus, 2, seed=5), 3, 1, 2)
        self.assertEqual(set(report["by_type"]), {'Kill', 'Delay'})
        self.assertEqual(
            sum(entry[0] for entry in report["by_type"].values()),
            sum(entry[1] for entry in report["table"].values()),
        )

    def test_a_bucket_present_in_the_TRAIN_folds_and_absent_from_one_is_skipped(self) -> None:
        # A signature carried by a single case is in the training split of every fold that does not
        # hold it out, so the table has to skip the fold it cannot judge rather than divide by zero.
        corpus = corpus_of([
            case('A', ['a'], 'Kill', [row('a', {'s': 0.9, 'lat': 0.1}), row('b', {'s': 0.1})]),
            case('B', ['a'], 'Kill', [row('a', {'s': 0.9}), row('b', {'s': 0.1})]),
            case('C', ['a'], 'Kill', [row('a', {'s': 0.9}), row('b', {'s': 0.1})]),
            case('D', ['a'], 'Delay', [row('a', {'s': 0.9}), row('b', {'s': 0.1})]),
        ])
        report = fit.regime_fit(corpus, fit.folds_of(corpus, 4, seed=3), 3, 1, 2)
        self.assertEqual(sum(entry[0] for entry in report["table"].values()), corpus.n_cases)

    def test_a_bucket_smaller_than_the_floor_falls_back_to_the_global_vector(self) -> None:
        # With a floor above every bucket the mixture must BE the global fit, not a set of vectors
        # fitted on three cases each.
        corpus = corpus_of(IMPROVING)
        fields = fit.regime_fit(corpus, fit.folds_of(corpus, 2, seed=5), 3, 1, 10_000)
        self.assertEqual(len(fields["table"]), len(set(int(code) for code in fit.signatures(corpus))))


class TheJointFit(unittest.TestCase):
    """One climb over every signature's vector, scored on the mixture and not bucket by bucket.

    The bucket-wise fit is a decomposition: it optimises each bucket's own Top@1 on that bucket's
    own training cases. The joint climb optimises the metric a deployed mixture actually has —
    the corpus, scored once — which is a different objective the moment a bucket is too small to
    earn a vector, because the bucket-wise fit then hands it the GLOBAL vector and judges that
    vector on cases it will never be applied to.
    """

    def test_the_mixture_of_no_vector_is_the_control(self) -> None:
        corpus = corpus_of(JOINT)
        mixture = fit.Mixture(corpus, fit.signatures(corpus))
        np.testing.assert_array_equal(mixture.scores({}), corpus.base)
        self.assertEqual(fit.top1_on(corpus, {}), 4)

    def test_a_bucket_vector_moves_only_its_own_bucket(self) -> None:
        corpus = corpus_of(JOINT)
        mixture = fit.Mixture(corpus, fit.signatures(corpus))
        control = mixture.scores({})
        moved = mixture.scores({1: {'s': -1.0}})
        np.testing.assert_array_equal(moved[mixture.rows[0]], control[mixture.rows[0]])
        self.assertFalse(np.allclose(moved[mixture.rows[1]], control[mixture.rows[1]]))

    def test_a_bucket_absent_from_the_corpus_cannot_be_scored_into(self) -> None:
        # `scores` takes a mapping, so a signature the corpus does not carry has no rows to
        # overwrite: the reading must stay the control rather than raise.
        corpus = corpus_of(JOINT)
        mixture = fit.Mixture(corpus, fit.signatures(corpus))
        np.testing.assert_array_equal(mixture.scores({6: {'s': 5.0}}), corpus.base)

    def test_the_row_restricted_reading_agrees_with_the_whole_corpus(self) -> None:
        # The climb reads one bucket's rows at a time for speed; if the restricted form disagreed
        # with `scores` at even one row the joint fit would be fitting a different metric.
        corpus = corpus_of(JOINT)
        rows = np.arange(2, 6)
        for weights in ({}, {'t': 2.0}, {'s': -1.0, 't': 0.5}):
            np.testing.assert_allclose(corpus.scores_rows(weights, rows), corpus.scores(weights)[rows])

    def test_the_joint_climb_finds_the_term_the_recorded_weights_gated_to_zero(self) -> None:
        corpus = corpus_of(JOINT)
        code = fit.signatures(corpus)
        vectors = fit.joint_climb(corpus, np.arange(corpus.n_cases), code, grid=5, passes=2, min_cases=3)
        self.assertGreater(vectors.get(1, {}).get('t', 0.0), 0.0)
        mixture = fit.Mixture(corpus, code)
        self.assertEqual(int(corpus.top1_mask(mixture.scores(vectors)).sum()), 6)

    def test_a_bucket_below_the_floor_keeps_the_recorded_weights(self) -> None:
        # The bucket-wise fit hands this bucket the global vector; the joint climb refuses to
        # invent a vector for two cases and leaves it at what shipped.
        corpus = corpus_of(JOINT)
        code = fit.signatures(corpus)
        vectors = fit.joint_climb(corpus, np.arange(corpus.n_cases), code, grid=5, passes=2, min_cases=3)
        self.assertNotIn(0, vectors)
        self.assertEqual(int((code == 0).sum()), 2)

    def test_the_joint_gate_reads_the_mixture_and_not_one_bucket(self) -> None:
        # Flipping the only term ranks `K1`'s truth last, which costs `Kill` its case. A gate that
        # judged buckets separately could not see this, because the vector that does it is the
        # bucket that contains the case and the corpus is the only population holding both types.
        corpus = corpus_of(CORPUS)
        mixture = fit.Mixture(corpus, fit.signatures(corpus))
        gate = fit.TypeGate(corpus, 2)
        control = mixture.scores({})
        hostile = mixture.scores({0: {'s': -1.0}})
        self.assertEqual(gate.score_of(corpus, control, None), 2)
        self.assertLess(gate.score_of(corpus, hostile, None), gate.score_of(corpus, control, None))
        self.assertEqual(gate.violations_of(corpus, hostile, None), {'Kill': -1})

    def test_the_gated_joint_climb_never_lowers_a_type(self) -> None:
        # The acceptance rule this whole instrument exists for: whatever the joint climb returns,
        # no gated fault type may lose a case against the shipped reading.
        corpus = corpus_of(CORPUS)
        gate = fit.TypeGate(corpus, 2)
        vectors = fit.joint_climb(
            corpus, np.arange(corpus.n_cases), fit.signatures(corpus), 5, 2, 1, gate=gate
        )
        self.assertEqual(gate.violations_of(corpus, fit.Mixture(corpus, fit.signatures(corpus)).scores(vectors), None), {})

    def test_the_joint_report_covers_every_held_out_case_once(self) -> None:
        corpus = corpus_of(JOINT + CORPUS)
        report = fit.joint_fit(corpus, fit.folds_of(corpus, 2, seed=5), grid=3, passes=1, min_cases=2)
        self.assertEqual(sum(entry[0] for entry in report["table"].values()), corpus.n_cases)
        self.assertEqual(sum(entry[1] for entry in report["table"].values()), report["holdout"])
        self.assertEqual(report["folds"], 2)

    def test_every_held_out_case_lands_in_the_per_type_table(self) -> None:
        corpus = corpus_of(JOINT + CORPUS)
        report = fit.joint_fit(corpus, fit.folds_of(corpus, 2, seed=5), 3, 1, 2)
        self.assertEqual(set(report["by_type"]), {'Kill', 'Delay'})
        self.assertEqual(
            sum(entry[0] for entry in report["by_type"].values()),
            sum(entry[1] for entry in report["table"].values()),
        )

    def test_an_unknown_term_in_a_row_restricted_read_is_refused_too(self) -> None:
        # The restricted form repeats the guard rather than delegating it, so it needs its own
        # proof: a typo there would silently score every row at the recorded weights.
        corpus = corpus_of(JOINT)
        with self.assertRaises(SystemExit) as raised:
            corpus.scores_rows({'nonsense': 1.0}, np.arange(2))
        self.assertIn('unknown term', str(raised.exception))

    def test_a_fold_that_holds_out_no_case_of_a_bucket_skips_that_bucket(self) -> None:
        # The report has one row per bucket per fold, and a fold whose held-out cases all sit in
        # one signature cannot contribute to the other's row: it must skip, not divide by zero.
        corpus = corpus_of(JOINT)
        folds = [np.array([index]) for index in range(4)] + [np.array([4, 5])]
        report = fit.joint_fit(corpus, folds, 3, 1, 2)
        self.assertEqual(sorted(report["table"]), [0, 1])
        self.assertEqual(report["table"][0][3], 1)

    def test_the_joint_report_carries_the_vector_it_fitted_for_each_fold(self) -> None:
        corpus = corpus_of(JOINT + CORPUS)
        report = fit.joint_fit(corpus, fit.folds_of(corpus, 2, seed=5), 3, 1, 2)
        self.assertEqual(len(report["vectors"]), 2)
        for vectors in report["vectors"].values():
            for bucket, vector in vectors.items():
                self.assertIn(bucket, report["table"])
                self.assertTrue(vector)


class TheShrink(unittest.TestCase):
    """A coefficient fitted on a fold carries that fold; shrinkage is what removes the part that
    does not replicate, and it acts on the reading's variance rather than on the search."""

    def test_a_strength_of_one_keeps_the_fitted_vector_whole(self) -> None:
        corpus = corpus_of(JOINT)
        vectors = {1: {'t': 9.0}}
        self.assertEqual(fit.shrink(corpus, vectors, 1.0), vectors)

    def test_a_strength_of_zero_returns_the_recorded_weights_and_drops_the_bucket(self) -> None:
        # `t` ships at 0, so every term lands on the recorded weight and the bucket stops being an
        # override at all — reporting it as one would claim a fit that is the control.
        corpus = corpus_of(JOINT)
        self.assertEqual(fit.shrink(corpus, {1: {'t': 9.0}}, 0.0), {})

    def test_half_the_strength_is_the_midpoint_between_the_fit_and_the_recorded_weight(self) -> None:
        corpus = corpus_of([case('W', ['a'], 'Kill', [
            row('a', {'s': 0.4}, {'s': 3.0}), row('b', {'s': 0.2}, {'s': 3.0}),
        ])])
        shrunk = fit.shrink(corpus, {0: {'s': 9.0}}, 0.5)
        self.assertAlmostEqual(shrunk[0]['s'], 0.5 * 9.0 + 0.5 * 3.0)

    def test_the_report_of_a_zero_strength_mixture_is_the_control(self) -> None:
        corpus = corpus_of(JOINT + CORPUS)
        report = fit.joint_fit(corpus, fit.folds_of(corpus, 2, seed=5), 3, 1, 2, strength=0.0)
        self.assertEqual(report["holdout"], sum(entry[2] for entry in report["table"].values()))


class TheTransfer(unittest.TestCase):
    """A vector fitted on one corpus, scored on another: the only test of whether a coefficient
    belongs to the mechanism or to the corpus it was measured on."""

    def test_a_mixture_applied_to_the_corpus_it_was_fitted_on_reproduces_its_fit(self) -> None:
        corpus = corpus_of(JOINT)
        code = fit.signatures(corpus)
        vectors = fit.joint_climb(corpus, np.arange(corpus.n_cases), code, 5, 2, 3)
        report = fit.transfer(vectors, corpus)
        self.assertEqual(report["at1"], int(corpus.top1_mask(fit.Mixture(corpus, code).scores(vectors)).sum()))
        self.assertEqual(report["n_cases"], corpus.n_cases)

    def test_a_bucket_the_source_never_fitted_keeps_the_recorded_weights(self) -> None:
        # The table says which buckets were borrowed, because a dropped bucket that reported the
        # shipped reading as a transfer would make the whole test unfalsifiable.
        corpus = corpus_of(JOINT)
        report = fit.transfer({1: {'t': 9.0}}, corpus)
        self.assertTrue(report["table"][1][3])
        self.assertFalse(report["table"][0][3])
        self.assertEqual(report["table"][0][1], report["table"][0][2])

    def test_an_empty_mixture_reads_as_the_control(self) -> None:
        corpus = corpus_of(JOINT)
        report = fit.transfer({}, corpus)
        self.assertEqual(report["at1"], report["control"])

    def test_the_table_partitions_the_corpus(self) -> None:
        corpus = corpus_of(JOINT + CORPUS)
        report = fit.transfer({}, corpus)
        self.assertEqual(sum(entry[0] for entry in report["table"].values()), corpus.n_cases)


class Splits(unittest.TestCase):
    """The held-out report is only a held-out report if the split is stratified and seeded."""

    def test_every_fold_carries_every_fault_type(self) -> None:
        corpus = corpus_of(CORPUS)
        folds = fit.folds_of(corpus, 2, seed=7)
        self.assertEqual(sum(len(fold) for fold in folds), corpus.n_cases)
        for fold in folds:
            self.assertEqual({corpus.fault_type[index] for index in fold}, {'Kill', 'Delay'})

    def test_the_split_is_reproducible_from_the_seed(self) -> None:
        corpus = corpus_of(CORPUS)
        first = fit.folds_of(corpus, 2, seed=11)
        second = fit.folds_of(corpus, 2, seed=11)
        for left, right in zip(first, second):
            np.testing.assert_array_equal(left, right)

    def test_a_different_seed_moves_a_case(self) -> None:
        corpus = corpus_of(CORPUS)
        first = fit.folds_of(corpus, 2, seed=1)
        other = fit.folds_of(corpus, 2, seed=2)
        self.assertNotEqual([set(fold.tolist()) for fold in first], [set(fold.tolist()) for fold in other])


class CommandLine(unittest.TestCase):
    """All three tables, printed from a dump small enough for a gate to build."""

    def setUp(self) -> None:
        self.directory = tempfile.mkdtemp()
        self.dump = write(CORPUS, self.directory)

    def run_main(self, *args: str) -> str:
        """Run the CLI and capture stdout.

        @param args - Arguments after the dump path.
        @returns What it printed.
        """
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            fit.main([self.dump, *args])
        return buffer.getvalue()

    def test_the_control_line_is_printed_before_any_table(self) -> None:
        printed = self.run_main('--only', 'ceiling')
        self.assertIn('cases=4 control Top@1=2 (50.00%)', printed)
        self.assertIn('CEILING', printed)

    def test_the_ceiling_table_prints_a_row_per_fault_type(self) -> None:
        printed = self.run_main('--only', 'ceiling')
        self.assertRegex(printed, r'Kill\s+2\s+1\s+50\.00%')
        self.assertRegex(printed, r'Delay\s+2\s+1\s+50\.00%')

    def test_the_global_table_reports_the_gain_and_the_weights(self) -> None:
        improving = write(IMPROVING, self.directory, 'improving.ndjson')
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            # One pass, so the climb improves on the LAST iteration and leaves the loop by
            # exhausting it rather than by the no-improvement break.
            fit.main([improving, '--only', 'global', '--grid', '5', '--passes', '1'])
        printed = buffer.getvalue()
        self.assertIn('GLOBAL one w, fitted in-sample: Top@1=4', printed)
        self.assertIn('delta=+4', printed)
        self.assertIn('recorded', printed)

    def test_the_heldout_table_pools_every_fold(self) -> None:
        improving = write(IMPROVING, self.directory, 'improving.ndjson')
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            fit.main([improving, '--only', 'heldout', '--folds', '2', '--grid', '5', '--passes', '2'])
        printed = buffer.getvalue()
        self.assertIn('HELDOUT 2-fold', printed)
        self.assertIn('fold 0: train', printed)
        self.assertIn('heldout-minus-shipped', printed)

    def test_the_module_runs_as_a_SCRIPT_and_exits_zero(self) -> None:
        # The `__main__` guard is the branch an importing test never reaches.
        saved = sys.argv
        sys.argv = [str(SCRIPT), self.dump, '--only', 'ceiling']
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                with self.assertRaises(SystemExit) as raised:
                    runpy.run_path(str(SCRIPT), run_name='__main__')
        finally:
            sys.argv = saved
        self.assertEqual(raised.exception.code, 0)
        self.assertIn('CEILING', buffer.getvalue())

    def test_the_regime_table_prints_a_row_per_signature_and_the_types_down(self) -> None:
        printed = self.run_main('--only', 'regimes', '--folds', '2', '--grid', '3', '--passes', '1')
        self.assertIn('REGIMES', printed)
        self.assertIn('signature', printed)
        self.assertIn('types down:', printed)

    def test_the_type_gate_is_opt_in_and_reported(self) -> None:
        printed = self.run_main('--only', 'global', '--gate-types', '2', '--grid', '3', '--passes', '1')
        self.assertIn('GLOBAL', printed)

    def test_the_joint_table_prints_a_row_per_signature_and_the_vectors_it_fitted(self) -> None:
        printed = self.run_main('--only', 'joint', '--folds', '2', '--grid', '3', '--passes', '1')
        self.assertIn('JOINT', printed)
        self.assertIn('scored on the mixture', printed)
        self.assertIn('types down:', printed)
        self.assertIn('fold 0:', printed)

    def test_the_joint_table_says_so_when_no_bucket_clears_the_floor(self) -> None:
        # A floor above every bucket is a legal configuration and the one that makes the mixture
        # equal to the shipped reading, so the report has to render that rather than print nothing.
        printed = self.run_main(
            '--only', 'joint', '--folds', '2', '--grid', '3', '--passes', '1', '--min-bucket', '100'
        )
        self.assertIn('no bucket above the floor', printed)

    def test_the_joint_table_reports_the_shrinkage_it_was_asked_for(self) -> None:
        printed = self.run_main(
            '--only', 'joint', '--folds', '2', '--grid', '3', '--passes', '1', '--shrink', '0.5'
        )
        self.assertIn('shrink 0.5', printed)

    def test_the_transfer_table_names_the_bucket_it_borrowed_from(self) -> None:
        # The source is the same dump, so every bucket it can fit is borrowed; the point of the
        # test is that the table renders the provenance column rather than that the reading moves.
        printed = self.run_main(
            '--only', 'ceiling', '--transfer-from', self.dump, '--grid', '3', '--passes', '1',
            '--min-bucket', '2',
        )
        self.assertIn('TRANSFER fitted on', printed)
        self.assertIn('recorded', printed)
        self.assertIn('pooled', printed)

    def test_a_zero_fold_run_reports_the_configuration_that_would_ship(self) -> None:
        # The shipped vector is fitted on every case the corpus has, so the in-sample block is the
        # acceptance reading; `--folds 0` is how that block is asked for.
        printed = self.run_main('--only', 'joint', '--folds', '0', '--grid', '3', '--passes', '1')
        self.assertIn('JOINT in-sample', printed)
        self.assertIn('vectors:', printed)
        self.assertNotIn('fold 0:', printed)

    def test_the_in_sample_block_renders_the_same_table_as_the_folded_one(self) -> None:
        # Both go through one renderer, so the column headings must be identical.
        in_sample = self.run_main('--only', 'joint', '--folds', '0', '--grid', '3', '--passes', '1')
        folded = self.run_main('--only', 'joint', '--folds', '2', '--grid', '3', '--passes', '1')
        for line in ('signature', 'faultType', 'pooled'):
            self.assertIn(line, in_sample)
            self.assertIn(line, folded)

    def test_an_empty_dump_is_refused(self) -> None:
        empty = str(pathlib.Path(self.directory) / 'empty.ndjson')
        pathlib.Path(empty).write_text('\n', encoding='utf-8')
        with self.assertRaises(SystemExit) as raised:
            fit.main([empty])
        self.assertIn('no cases', str(raised.exception))


if __name__ == '__main__':
    unittest.main()
