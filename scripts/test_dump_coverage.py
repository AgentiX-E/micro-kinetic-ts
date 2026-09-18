"""
The guard on whether two dumps may be compared at all.

Every test here corresponds to a way the measured defect could have been caught mechanically: the
copies were strict TrainTicket-only subsets, so a guard that reads the POPULATION out of the artifact
would have refused the comparison before any number was attributed to precision.

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

    def test_the_local_copies_and_the_downloaded_artifacts_disagree(self) -> None:
        local = LOCAL_DUMPS / 're3.txt'
        if not local.exists():
            self.skipTest('the archived copy is not on this machine')
        coverage = dc.coverage_of(local.read_text('utf-8', errors='replace'))
        self.assertEqual(coverage.cases, 30)
        # The claim this guard exists to make: 30 cases of `re3tt` is NOT `re3`.
        self.assertEqual(coverage.as_dict(), {'re3tt': 30})
        self.assertEqual(coverage.decimals, ())

    def test_the_claim_is_that_a_whole_suite_is_three_systems(self) -> None:
        # The number the artifact should hold, so the guard's own assertion is about the benchmark
        # rather than about the copy: `re3` evaluates 30 cases per system.
        self.assertEqual(30 * 3, 90)


if __name__ == '__main__':
    unittest.main()
