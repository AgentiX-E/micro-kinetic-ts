"""Unit tests for the offline term re-scorer.

`scripts/terms-oracle.py` decides whether a coefficient transfers, so what has to be true is
narrow and checkable: that its control mode reproduces the arithmetic the engine did (a screen
that does not reproduce the run is measuring its own bug), that an absent term is not silently
a measured slope of zero, that the two rescaling regimes mean what the docstring says, and that
an override moves only the term it names.

The dumps here are synthetic and two to five candidates wide. The real one is 37 MB of a CI
artifact, and a gate must not depend on a network call.

The module is loaded by PATH because its name contains a hyphen, which is not addressable by
`import` — the same reason `test_convert_parquet_to_json.py` loads its subject that way.
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

SCRIPT = pathlib.Path(__file__).resolve().parent / 'terms-oracle.py'
SPEC = importlib.util.spec_from_file_location('terms_oracle', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
oracle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(oracle)


def write_dump(cases: list[dict], directory: str, name: str = 'terms.ndjson') -> str:
    """Write cases as ndjson, the format `--terms-dump` produces.

    @param cases - One dict per case, in the dump's shape.
    @param directory - Where to put the file.
    @param name - The file name.
    @returns The path written.
    """
    path = str(pathlib.Path(directory) / name)
    with open(path, 'w', encoding='utf-8') as handle:
        for case in cases:
            handle.write(json.dumps(case) + '\n')
    return path


def candidate(service: str, terms: list[list], score: float = 0.0) -> dict:
    """One candidate row.

    @param service - The service id.
    @param terms - `[name, weight, slope]` triples; null weight or slope means unmeasurable.
    @param score - The score the engine recorded, unused by the oracle.
    @returns The candidate dict.
    """
    return {'id': service, 'score': score, 'terms': terms}


def ranked_case(datapack: str, accepted: list[str], fault: str, rows: list[dict]) -> dict:
    """One case.

    @param datapack - The case id.
    @param accepted - The ground-truth services.
    @param fault - The fault type.
    @param rows - The candidate rows.
    @returns The case dict.
    """
    return {'datapack': datapack, 'accepted': accepted, 'faultType': fault, 'candidates': rows}


class AbsenceIsNotZero(unittest.TestCase):
    """A term with no slope has no contribution at ANY weight, and must not read as a zero slope."""

    def test_a_null_slope_is_dropped_rather_than_read_as_zero(self) -> None:
        slopes = oracle.term_slopes(candidate('a', [['s', 1, 0.5], ['log', None, None]]))
        self.assertEqual(slopes, {'s': 0.5})

    def test_a_null_weight_with_a_measured_slope_is_kept(self) -> None:
        # The engine records the slope it measured even where a gate zeroed the weight, so the
        # slope is what an override would act on. Dropping it would make the term unreachable.
        slopes = oracle.term_slopes(candidate('a', [['failedEdge', 0.0, 1.0]]))
        self.assertEqual(slopes, {'failedEdge': 1.0})

    def test_a_recorded_weight_is_read_back_by_name(self) -> None:
        row = candidate('a', [['s', 1, 0.5], ['log', None, 0.25]])
        self.assertEqual(oracle.recorded_weight(row, 's'), 1.0)
        self.assertIsNone(oracle.recorded_weight(row, 'log'))
        self.assertIsNone(oracle.recorded_weight(row, 'absent'))


class Rescaling(unittest.TestCase):
    """The three regimes, pinned to values a reader can recompute."""

    ROWS = [{'s': 0.9}, {'s': 0.5}, {'s': 0.1}]

    def test_none_is_the_identity(self) -> None:
        self.assertEqual(oracle.rescale(self.ROWS, 'none'), self.ROWS)

    def test_minmax_puts_the_case_minimum_at_zero_and_maximum_at_one(self) -> None:
        out = oracle.rescale(self.ROWS, 'minmax')
        self.assertEqual([row['s'] for row in out], [1.0, 0.5, 0.0])

    def test_rank_is_the_mid_rank_percentile(self) -> None:
        out = oracle.rescale(self.ROWS, 'rank')
        self.assertEqual([row['s'] for row in out], [1.0, 0.5, 0.0])

    def test_rank_shares_the_MEAN_rank_across_a_tie(self) -> None:
        # The convention `rankNormalizeScores` uses, so the two instruments agree about ties. The
        # tie group occupies sorted slots 1 and 2, so its mean rank is 1.5 of a maximum 2 — the
        # value is 0.75 rather than 1.0, and pinning it is the difference between the convention
        # being stated and being believed.
        rows = [{'s': 0.7}, {'s': 0.7}, {'s': 0.1}]
        out = oracle.rescale(rows, 'rank')
        self.assertEqual([row['s'] for row in out], [0.75, 0.75, 0.0])

    def test_a_constant_term_is_flattened_and_cannot_reorder_anything(self) -> None:
        rows = [{'s': 0.9, 'c': 2.0}, {'s': 0.5, 'c': 2.0}]
        for mode, flat in (('minmax', 0.0), ('rank', 1.0)):
            out = oracle.rescale(rows, mode)
            self.assertEqual([row['c'] for row in out], [flat, flat])
            # A constant added to both candidates leaves the order alone, which is the property
            # the value above has to have for the mode to be a rescaling rather than a verdict.
            self.assertEqual([row['s'] for row in out], [1.0, 0.0])

    def test_candidates_that_do_not_carry_the_term_are_left_alone_in_every_mode(self) -> None:
        # A term is measured on whichever candidates have the channel, so the rescaling has to
        # skip the rest rather than invent a value for them — including inside the branch that
        # flattens a constant term.
        spread = [{'c': 1.0}, {'c': 3.0}, {}]
        constant = [{'c': 5.0}, {'c': 5.0}, {}]
        for mode in ('minmax', 'rank'):
            self.assertNotIn('c', oracle.rescale(spread, mode)[2])
            self.assertNotIn('c', oracle.rescale(constant, mode)[2])
            self.assertEqual(oracle.rescale(constant, mode)[0]['c'], 1.0 if mode == 'rank' else 0.0)

    def test_a_term_measured_on_ONE_candidate_is_left_as_recorded(self) -> None:
        rows = [{'s': 0.9, 'solo': 0.4}, {'s': 0.5}]
        for mode in ('minmax', 'rank'):
            out = oracle.rescale(rows, mode)
            self.assertEqual(out[0]['solo'], 0.4)
            self.assertNotIn('solo', out[1])


class Scoring(unittest.TestCase):
    """The control must be the engine's own arithmetic, and an override must touch one term."""

    def test_a_score_is_the_sum_of_weight_times_slope(self) -> None:
        case = ranked_case('c', ['a'], 'Kill', [
            candidate('a', [['s', 1, 0.3], ['podState', 8, 0.5]]),
            candidate('b', [['s', 1, 0.1]]),
        ])
        ranking = oracle.score_case(case, {}, 'none')
        self.assertEqual(ranking[0][0], 'a')
        self.assertAlmostEqual(ranking[0][1], 0.3 + 8 * 0.5)

    def test_ties_are_broken_by_service_id_so_the_screen_matches_the_run(self) -> None:
        case = ranked_case('c', ['m'], 'Kill', [
            candidate('n', [['s', 1, 0.5]]),
            candidate('m', [['s', 1, 0.5]]),
        ])
        self.assertEqual([row[0] for row in oracle.score_case(case, {}, 'none')], ['m', 'n'])

    def test_a_term_with_no_recorded_weight_cannot_be_read_into_the_control(self) -> None:
        # The engine records a slope where it measured one but gated the weight to null; with no
        # override that term contributes NOTHING to the control, which is what keeps the control
        # equal to the run rather than to a re-specification of it.
        case = ranked_case('c', ['a'], 'Kill', [
            candidate('a', [['s', 1, 0.4], ['gated', None, 9.0]]),
            candidate('b', [['s', 1, 0.2]]),
        ])
        self.assertAlmostEqual(oracle.score_case(case, {}, 'none')[0][1], 0.4)
        self.assertAlmostEqual(oracle.score_case(case, {'gated': 1.0}, 'none')[0][1], 9.4)

    def test_an_override_replaces_one_weight_and_leaves_the_rest_recorded(self) -> None:
        case = ranked_case('c', ['a'], 'Kill', [
            candidate('a', [['s', 1, 0.1], ['t', 1, 0.9]]),
            candidate('b', [['s', 1, 0.9], ['t', 1, 0.1]]),
        ])
        self.assertEqual(oracle.score_case(case, {}, 'none')[0][0], 'a')
        flipped = oracle.score_case(case, {'t': 0.0}, 'none')
        self.assertEqual(flipped[0][0], 'b')
        self.assertAlmostEqual(flipped[0][1], 0.9)
        self.assertAlmostEqual(flipped[1][1], 0.1)


class Evaluation(unittest.TestCase):
    """Top@1/@3/@5 and the per-fault-type split, on a corpus whose answers are known by hand."""

    CASES = [
        ranked_case('c1', ['a'], 'Kill', [
            candidate('a', [['s', 1, 0.9]]),
            candidate('b', [['s', 1, 0.5]]),
            candidate('c', [['s', 1, 0.1]]),
        ]),
        ranked_case('c2', ['x'], 'Delay', [
            candidate('x', [['s', 1, 0.1]]),
            candidate('y', [['s', 1, 0.8]]),
            candidate('z', [['s', 1, 0.2]]),
        ]),
    ]

    def test_hits_are_counted_per_case_at_three_depths(self) -> None:
        result = oracle.evaluate(self.CASES, {}, 'none')
        self.assertEqual(result['total'], 2)
        self.assertEqual(result['at1'], 1)   # c1 only: c2's truth is second
        self.assertEqual(result['at3'], 2)
        self.assertEqual(result['at5'], 2)
        self.assertEqual(result['by_type'], {'Delay': (1, 0), 'Kill': (1, 1)})
        self.assertEqual(result['verdicts'], {'c1': 'a', 'c2': 'y'})

    def test_any_of_several_accepted_services_counts_as_a_hit(self) -> None:
        cases = [ranked_case('c', ['a', 'b'], 'Kill', [
            candidate('b', [['s', 1, 0.9]]),
            candidate('a', [['s', 1, 0.1]]),
        ])]
        self.assertEqual(oracle.evaluate(cases, {}, 'none')['at1'], 1)


class CommandLine(unittest.TestCase):
    """The CLI contract: what it prints, what it refuses, and what `--diff` attributes."""

    def setUp(self) -> None:
        self.directory = tempfile.mkdtemp()
        self.dump = write_dump(Evaluation.CASES, self.directory)

    def run_main(self, *args: str) -> str:
        """Run the CLI and capture stdout.

        @param args - Command-line arguments after the dump path.
        @returns What it printed.
        """
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            oracle.main([self.dump, *args])
        return buffer.getvalue()

    def test_the_control_line_reports_all_three_depths(self) -> None:
        printed = self.run_main()
        self.assertIn('cases=2 Top@1=1', printed)
        self.assertIn('Top@3=2', printed)
        self.assertIn('Top@5=2', printed)
        self.assertIn('normalize=none', printed)

    def test_the_type_table_prints_one_row_per_type(self) -> None:
        printed = self.run_main('--by-type')
        self.assertIn('faultType', printed)
        self.assertIn('Kill', printed)
        self.assertRegex(printed, r'Kill\s+1\s+1\s+100\.00%')
        self.assertRegex(printed, r'Delay\s+1\s+0\s+0\.00%')

    def test_overrides_are_echoed_so_a_reader_can_reproduce_the_row(self) -> None:
        self.assertIn("overrides={'s': 0.0}", self.run_main('--set', 's=0'))

    def test_a_diff_attributes_a_flip_to_the_case_that_moved(self) -> None:
        # The other dump ranks `b` first where this one ranks `a`, so the pair disagree about a
        # case whose truth is `a`: this dump gained it. The flips are attributed by VERDICT, not
        # by truth, which is why the two dumps have to differ in their scores rather than their
        # `accepted` lists.
        other = write_dump(
            [ranked_case('c1', ['a'], 'Kill', [
                candidate('a', [['s', 1, 0.1]]),
                candidate('b', [['s', 1, 0.9]]),
            ])],
            self.directory,
            'other.ndjson',
        )
        printed = self.run_main('--diff', other)
        self.assertIn('vs control: +1 -0 (net +1)', printed)
        self.assertIn('GAINED c1', printed)

    def test_a_diff_reports_a_LOST_case_and_ignores_ones_only_one_side_has(self) -> None:
        # Both halves of the attribution: `c2` is absent from the other dump — a case the other
        # run never produced is not a flip — and `c1` moves the other way, which has to be named
        # rather than netted into the total.
        other = write_dump(
            [
                ranked_case('c2', ['x'], 'Delay', [
                    candidate('x', [['s', 1, 0.9]]),
                    candidate('y', [['s', 1, 0.1]]),
                ]),
            ],
            self.directory,
            'other-lost.ndjson',
        )
        printed = self.run_main('--diff', other)
        # `c1` is absent from the other dump and is not a flip; `c2` now ranks `y` where the other
        # ranked its truth `x`, so this dump LOST it.
        self.assertIn('vs control: +0 -1 (net -1)', printed)
        self.assertIn('LOST c2', printed)

    def test_a_rejected_override_names_the_offending_pair(self) -> None:
        for pair, expected in (('s', 'expects name=value'), ('s=abc', 'not a number')):
            with self.assertRaises(SystemExit) as raised:
                oracle.main([self.dump, '--set', pair])
            self.assertIn(expected, str(raised.exception))

    def test_a_dump_that_is_not_json_fails_on_its_line_number(self) -> None:
        broken = str(pathlib.Path(self.directory) / 'broken.ndjson')
        pathlib.Path(broken).write_text('{"ok": 1}\nnot json\n', encoding='utf-8')
        with self.assertRaises(SystemExit) as raised:
            oracle.main([broken])
        self.assertIn('broken.ndjson:2', str(raised.exception))

    def test_an_empty_dump_is_refused_rather_than_reported_as_zero_cases(self) -> None:
        empty = str(pathlib.Path(self.directory) / 'empty.ndjson')
        pathlib.Path(empty).write_text('\n\n', encoding='utf-8')
        with self.assertRaises(SystemExit) as raised:
            oracle.main([empty])
        self.assertIn('no cases', str(raised.exception))

    def test_a_flip_between_two_WRONG_verdicts_is_neither_a_gain_nor_a_loss(self) -> None:
        # Both dumps miss `c2` and miss it differently. A screen that counted any change as a flip
        # would credit this to one of the arms; the attribution has to be about the truth.
        other = write_dump(
            [ranked_case('c2', ['x'], 'Delay', [
                candidate('x', [['s', 1, 0.1]]),
                candidate('y', [['s', 1, 0.4]]),
                candidate('z', [['s', 1, 0.9]]),
            ])],
            self.directory,
            'other-both-wrong.ndjson',
        )
        printed = self.run_main('--diff', other)
        self.assertIn('vs control: +0 -0 (net +0)', printed)
        self.assertNotIn('GAINED', printed)

    def test_the_module_runs_as_a_SCRIPT_and_exits_zero(self) -> None:
        # The `__main__` guard is the branch an importing test never reaches, and `scripts/` is a
        # directory of scripts people run — so the entry point is exercised rather than assumed.
        saved = sys.argv
        sys.argv = [str(SCRIPT), self.dump]
        buffer = io.StringIO()
        try:
            with contextlib.redirect_stdout(buffer):
                with self.assertRaises(SystemExit) as raised:
                    runpy.run_path(str(SCRIPT), run_name='__main__')
        finally:
            sys.argv = saved
        self.assertEqual(raised.exception.code, 0)
        self.assertIn('cases=2', buffer.getvalue())

    def test_a_case_with_no_candidates_reports_an_empty_verdict(self) -> None:
        # A load failure upstream is a real shape of dump; it must not crash the screen.
        lonely = write_dump([ranked_case('c', ['a'], 'Kill', [])], self.directory, 'lonely.ndjson')
        printed = io.StringIO()
        with contextlib.redirect_stdout(printed):
            oracle.main([lonely])
        self.assertIn('Top@1=0', printed.getvalue())


if __name__ == '__main__':
    unittest.main()
