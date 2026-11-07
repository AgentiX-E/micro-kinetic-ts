"""
The guard on whether two dumps may be compared at all.

Every test here corresponds to a way the measured defect could have been caught mechanically: the
copies were strict TrainTicket-only subsets, so a guard that reads the POPULATION out of the artifact
would have refused the comparison before any number was attributed to precision.

The archive those copies lived in has since been replaced by the artifacts the workflow produces, and two
tests here had to change with it. One asserted the DEFECT as if it were the benchmark (`re3.txt` is 30 cases);
it now asserts the SHAPE that makes a subset detectable, and the subset it refuses is rebuilt from the
current artifact rather than recalled.

@module scripts/test_dump_coverage
"""

from __future__ import annotations

import unittest
from pathlib import Path

import dump_coverage as dc

LOCAL_DUMPS = Path('/Users/lambertyan/WorkBuddy/2026-08-08-10-23-08/.bench-cache/rcaeval-dumps')


def dump(*cases: str, decimals: int | None = None) -> str:
    """
    One block per case, in the shape the producer writes: a header, then whatever belongs to it.

    The precision goes on the HEADER, which is where the producer puts it and where the reader looks —
    appended anywhere else it would be a line this reader is right to ignore.
    """
    tail = '' if decimals is None else f' decimals={decimals}'
    return ''.join(
        f'DIAG datapack={case} faultType=cpu services=3{tail}\n  edges=a>b\n' for case in cases
    )


def only_system(text: str, marker: str) -> str:
    """
    The subset of a dump a reader gets by keeping one system's cases.

    The defect that motivated this module was three such subsets sitting under whole-suite names, so the way
    to keep the evidence from going stale is to REBUILD the subset in the test rather than to archive it: the
    archive has since been replaced by the artifacts the workflow produces, and a test pinned to the old copy
    asserted the defect as if it were the benchmark.

    @param text - The artifact.
    @param marker - The suite/system marker the kept cases carry, e.g. `_re3tt_`.
    @returns: Those cases' blocks, and nothing else.
    """
    kept: list[str] = []
    keeping = False
    for line in text.splitlines():
        if line.startswith('DIAG datapack='):
            keeping = marker in line
        if keeping:
            kept.append(line)
    return '\n'.join(kept) + '\n'


class CoverageOfTest(unittest.TestCase):
    """What a dump is ABOUT, read from its own text."""

    def test_it_counts_cases_and_groups_them_by_suite_and_system(self) -> None:
        text = dump(
            'rcaeval-re3_re3tt_ts-auth-service_f1_1',
            'rcaeval-re3_re3tt_ts-auth-service_f1_2',
            'rcaeval-re3_re3ob_emailservice_f5_1',
            'rcaeval-re1_re1ss_carts_cpu_1',
        )
        coverage = dc.coverage_of(text)
        self.assertEqual(coverage.cases, 4)
        self.assertEqual(coverage.as_dict(), {'re1ss': 1, 're3ob': 1, 're3tt': 2})

    def test_grouping_is_by_the_ID_not_by_the_file_name(self) -> None:
        # The whole defect: a file named `re3.txt` held one third of `re3`. A reader that trusted the
        # name reported 30 cases as "re3"; a reader that reads the ids says `re3tt 30`.
        coverage = dc.coverage_of(dump('rcaeval-re3_re3tt_ts-auth-service_f1_1'))
        self.assertEqual(coverage.as_dict(), {'re3tt': 1})

    def test_an_id_with_no_marker_is_its_own_group_rather_than_the_suite(self) -> None:
        # An FSE'26 datapack is `<system>-<service>-<fault>-<hash>`. Folding it into a suite would let a
        # file of them claim to be a suite's artifact, which is the same mistake one level down.
        coverage = dc.coverage_of(dump('ts5-ts-order-service-stress-svfvxk'))
        self.assertEqual(coverage.as_dict(), {dc.UNCLASSIFIED: 1})

    def test_it_reports_the_declared_precision_as_distinct_values(self) -> None:
        text = (
            'DIAG datapack=a_re1tt_b_cpu_1 decimals=3\n'
            'DIAG datapack=a_re1tt_b_cpu_2 decimals=3\n'
            'DIAG datapack=a_re1tt_b_cpu_3 decimals=4\n'
        )
        self.assertEqual(dc.coverage_of(text).decimals, (3, 4))
        self.assertEqual(dc.coverage_of('DIAG datapack=a_re1tt_b_cpu_1\n').decimals, ())

    def test_an_empty_dump_is_empty_rather_than_an_error(self) -> None:
        # Zero cases is a FACT about an artifact, and the caller decides what it means.
        self.assertEqual(dc.coverage_of('signals: logWeight=1\n').cases, 0)
        self.assertEqual(dc.coverage_of('').by_group, ())


class DescribeTest(unittest.TestCase):
    """The line that lets a population travel with a number."""

    def test_it_names_every_group_and_the_precision(self) -> None:
        coverage = dc.coverage_of(
            dump('rcaeval-re3_re3tt_a_f1_1', 'rcaeval-re3_re3ob_b_f2_1', decimals=4)
        )
        self.assertEqual(dc.describe(coverage), '2 cases (re3ob 1, re3tt 1), 4 decimals')

    def test_a_dump_that_states_nothing_says_so(self) -> None:
        self.assertIn('does not state its precision', dc.describe(dc.coverage_of(dump('a_re1tt_b_cpu_1'))))


class RequireLikeForLikeTest(unittest.TestCase):
    """The refusal: two artifacts are comparable only when they are about the same cases."""

    def test_it_accepts_two_artifacts_of_the_same_population_at_DIFFERENT_precisions(self) -> None:
        # The case a comparison of two renders is FOR, so the precision must not be part of the check.
        one = dc.coverage_of(dump('a_re3tt_b_f1_1', 'a_re3ob_c_f2_1'))
        two = dc.coverage_of(dump('a_re3tt_b_f1_1', 'a_re3ob_c_f2_1', decimals=4))
        self.assertEqual(one.decimals, ())
        self.assertEqual(two.decimals, (4,))
        dc.require_like_for_like(left_name='three decimals', left=one, right_name='four', right=two)

    def test_it_REFUSES_a_subset_against_its_superset(self) -> None:
        # The measured defect, in miniature: 30 cases against 90, all 30 shared. This is the comparison
        # that was made, and every number read from it was about the smaller population.
        subset = dc.coverage_of(dump(*[f'a_re3tt_b_f1_{i}' for i in range(1, 31)]))
        whole = dc.coverage_of(
            dump(
                *[f'a_re3tt_b_f1_{i}' for i in range(1, 31)],
                *[f'a_re3ob_b_f1_{i}' for i in range(1, 31)],
                *[f'a_re3ss_b_f1_{i}' for i in range(1, 31)],
            )
        )
        with self.assertRaises(dc.ComparisonError) as caught:
            dc.require_like_for_like(
                left_name='the local copy', left=subset, right_name='the artifact', right=whole
            )
        message = str(caught.exception)
        self.assertIn('different populations', message)
        self.assertIn('the local copy', message)
        self.assertIn('the artifact', message)
        # Named per GROUP, because "30 against 90" alone does not say which cases are missing.
        self.assertIn('re3tt: 30 vs 30', message)
        self.assertIn('re3ob: 0 vs 30', message)
        self.assertIn('re3ss: 0 vs 30', message)

    def test_it_refuses_two_artifacts_whose_totals_match_but_whose_GROUPS_do_not(self) -> None:
        # A total is not a population: 2 cases of one system against 1 of each of two would pass a
        # count-only check, and the two are about different systems.
        one = dc.coverage_of(dump('a_re3tt_b_f1_1', 'a_re3tt_b_f1_2'))
        two = dc.coverage_of(dump('a_re3tt_b_f1_1', 'a_re3ob_b_f1_2'))
        with self.assertRaises(dc.ComparisonError) as caught:
            dc.require_like_for_like(left_name='x', left=one, right_name='y', right=two)
        self.assertIn('re3tt: 2 vs 1', str(caught.exception))

    def test_identical_coverage_passes_and_a_single_empty_dump_passes_against_itself(self) -> None:
        empty = dc.coverage_of('')
        dc.require_like_for_like(left_name='a', left=empty, right_name='b', right=empty)


class RealArtifactsTest(unittest.TestCase):
    """Measured against the files this guard was built for, when they are still on disk."""

    def _text(self, name: str) -> str:
        artifact = LOCAL_DUMPS / name
        if not artifact.exists():
            self.skipTest('the archived copy is not on this machine')
        return artifact.read_text('utf-8', errors='replace')

    def test_every_archived_suite_is_three_systems_at_equal_share(self) -> None:
        # The defect: three files under suite names held TrainTicket-only copies — `re3` 30 cases of 90 — so
        # every number read from them was about one system reported as three. The claim is therefore NOT
        # "re3 is 30 cases"; that was the DEFECT, and pinning it would make the archive's repair look like a
        # regression. The claim is the SHAPE: a suite is three systems at equal share, so a single-system
        # artifact under a suite's name is a subset however many cases it holds.
        for name in ('re1.txt', 're2.txt', 're3.txt'):
            coverage = dc.coverage_of(self._text(name))
            self.assertEqual(len(coverage.as_dict()), 3, f'{name}: {coverage.as_dict()}')
            self.assertEqual(len(set(coverage.as_dict().values())), 1, f'{name}: {coverage.as_dict()}')
            # And the archive states the precision it was rendered at, which is what a reader's error bar
            # comes from. Asserted as "states one", not as "states 3": a dispatch may legitimately ask for a
            # different one, and the other binding (`does not state`) is what must stay distinguishable.
            self.assertTrue(coverage.decimals, f'{name} does not state its precision')

    def test_the_MEASURED_defect_is_refused_when_it_is_rebuilt_from_the_archive_itself(self) -> None:
        # The comparison that was actually run, rebuilt from the artifact that is on disk rather than from a
        # stale copy of it: keep one system's cases and compare against the whole suite. Fixing the archive
        # cannot make this test vacuous, because the subset is derived here and would be re-derived if the
        # archive moved on.
        whole = dc.coverage_of(self._text('re3.txt'))
        one_system = dc.coverage_of(only_system(self._text('re3.txt'), '_re3tt_'))
        self.assertEqual(one_system.cases, 30)
        self.assertEqual(one_system.as_dict(), {'re3tt': 30})
        with self.assertRaises(dc.ComparisonError) as caught:
            dc.require_like_for_like(
                left_name='the one-system copy', left=one_system, right_name='re3', right=whole
            )
        self.assertIn('re3ob: 0 vs 30', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
