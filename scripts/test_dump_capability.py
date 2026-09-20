"""
The census of what an artifact carries, and the refusal that stops a number being read from one that does not.

Every test here corresponds to a way one of the three measured defects could have been caught mechanically:
the reader's error bar was modelled on a precision no artifact had declared, a comparison was run between a
subset and its superset, and a stability table was read from a report that holds no compositions.

@module scripts/test_dump_capability
"""

from __future__ import annotations

import unittest
from pathlib import Path

import dump_capability as dc

LOCAL_DUMPS = Path('/Users/lambertyan/WorkBuddy/2026-08-08-10-23-08/.bench-cache/rcaeval-dumps')
FSE26_DUMP = Path('/Users/lambertyan/WorkBuddy/2026-08-08-10-23-08/.bench-cache/dump-35035314921.txt')

#: A row carrying every row-level channel, in the shape the producer writes it.
FULL_ROW = (
    '  adservice [#1] selfAnomaly=0.255 logScore=0.000 failedEdge=1.000 latRise=- latEdges=0 '
    'dominant=latency-50 err=0 fatal=0 logic=0 http=0 both=0 onset=34000\n'
)


def case(datapack: str, *rows: str, decimals: int | None = 3, decisive: bool = True) -> str:
    """
    One case's block, in the block's own structure: header, rows, and the sub-lines that belong to a row.

    The indentation is load-bearing — `metricDecisive` is a 4-space sub-line, which is what makes it a
    channel of the ROW that precedes it rather than a line the census could count on its own.
    """
    tail = '' if decimals is None else f' decimals={decimals}'
    head = f'DIAG datapack={datapack} faultType=cpu services={len(rows)}{tail}\n'
    body = ''
    for row in rows:
        body += row
        if decisive:
            body += '    metricDecisive: latency-50=0.255{dev=0.192,trend=0.062}\n'
    return head + body


class CapabilityOfTest(unittest.TestCase):
    """What an artifact can be ASKED, read from its own text."""

    def test_a_fully_rendered_artifact_reaches_every_case_and_every_row(self) -> None:
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, FULL_ROW))
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.rows, 2)
        for name in dc.CHANNELS:
            self.assertEqual(capability.channel(name).reach, dc.EVERY, name)

    def test_a_channel_on_ONLY_SOME_ROWS_is_reported_as_some_and_never_as_every(self) -> None:
        # The measured defect in miniature: the decisive composition is on the ground truth and the engine's
        # predictions, and a reader that sums it over every candidate of a case needs it on ALL of them.
        one = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu services=3 decimals=3\n'
            + FULL_ROW
            + '    metricDecisive: latency-50=0.255{dev=0.192}\n'
            + FULL_ROW
            + '    metricDecisive: cpu=0.198{dev=0.198}\n'
            + FULL_ROW
        )
        self.assertEqual(one.rows, 3)
        self.assertEqual(one.channel('decisive-composition').rows_reached, 2)
        self.assertEqual(one.channel('decisive-composition').reach, dc.SOME)
        # Both numbers travel, because "some" without a denominator is the reading this module stops.
        self.assertEqual(dc.describe(one).count('decisive-composition some (2/3 rows)'), 1)

    def test_a_channel_the_producer_never_rendered_is_NONE_rather_than_zero(self) -> None:
        # `none` says the artifact cannot answer; a count of zero would say it answered "no evidence".
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu services=1\n'
            '  adservice [#1] selfAnomaly=0.5 logScore=0.0 failedEdge=0.0 onset=-\n'
        )
        for name in ('decisive-composition', 'signature-overlap', 'latency-edges', 'dominant-metric'):
            self.assertEqual(capability.channel(name).reach, dc.NONE, name)
        # …while the ones it does carry are not dragged down with them.
        self.assertEqual(capability.channel('onset').reach, dc.EVERY)
        self.assertEqual(capability.channel('failed-edge').reach, dc.EVERY)

    def test_the_declared_precision_is_scoped_to_CASES_and_reports_no_row_frontier(self) -> None:
        # A header field has no rows to be absent from. Reporting `0 of 3 rows` for it would read as a
        # missing field rather than as a question that does not apply.
        with_precision = dc.capability_of(case('a_cpu_1', FULL_ROW, FULL_ROW))
        without = dc.capability_of(case('a_cpu_1', FULL_ROW, FULL_ROW, decimals=None))
        self.assertEqual(with_precision.channel('declared-precision').reach, dc.EVERY)
        self.assertIsNone(with_precision.channel('declared-precision').rows_reached)
        self.assertEqual(without.channel('declared-precision').reach, dc.NONE)
        self.assertIn('declared-precision none', dc.describe(without))
        self.assertIn('declared-precision every', dc.describe(with_precision))

    def test_precision_is_a_CASE_level_value_so_one_header_declares_for_all_its_rows(self) -> None:
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, FULL_ROW, decimals=4))
        self.assertEqual(capability.channel('declared-precision').cases_reached, 1)
        self.assertEqual(capability.channel('declared-precision').total_cases, 1)

    def test_rows_are_counted_even_when_the_block_renders_no_ranking(self) -> None:
        # A dump with no `[#k]` markers is still a dump with rows, and an artifact whose ranking was never
        # rendered must not report zero rows — that would make `some` unreachable and hide the field.
        text = (
            'DIAG datapack=a_cpu_1 faultType=cpu services=2 decimals=3\n'
            '  adservice selfAnomaly=0.5 logScore=0.0 onset=10 latEdges=1 failedEdge=0.0 dominant=cpu\n'
            '    metricDecisive: cpu=0.5{dev=0.5}\n'
            '  cartservice selfAnomaly=0.4 logScore=0.0 onset=- latEdges=0 failedEdge=0.0 dominant=mem\n'
        )
        capability = dc.capability_of(text)
        self.assertEqual(capability.rows, 2)
        self.assertEqual(capability.channel('decisive-composition').rows_reached, 1)
        self.assertEqual(capability.channel('decisive-composition').reach, dc.SOME)

    def test_an_empty_artifact_carries_nothing_rather_than_everything(self) -> None:
        # Zero cases is not "every channel reaches every case" — the empty artifact answers no question, and
        # the caller decides what that means.
        empty = dc.capability_of('signals: logWeight=1\n')
        self.assertEqual(empty.cases, 0)
        self.assertEqual(empty.rows, 0)
        for name in dc.CHANNELS:
            self.assertEqual(empty.channel(name).reach, dc.NONE, name)

    def test_a_line_inside_a_case_that_carries_NO_channel_is_skipped(self) -> None:
        # Written from a MEASUREMENT rather than from the code, and it is the only test here whose
        # motive is the gate rather than the census.
        #
        # `dump_capability.py` reads an artifact in three shapes — a case header, a service row, and a
        # sub-line belonging to the row above — and it SKIPS any other line inside a case. That skip
        # is a real branch, and on 2026-09-20 the same commit read **100.00% locally and 99.88% in
        # CI**, the whole difference being two arcs of this module (`330->288`, `332->330`) that only
        # a real artifact reaches. The four tests that reach them live in `RealArtifactsTest`, which
        # reads `.bench-cache/` by ABSOLUTE PATH and `skipTest`s where those files are absent — as
        # they are on every runner. So the gate's own number depended on which machine ran it, and
        # the smaller number was the gate's.
        #
        # Reproduced exactly by copying this directory and pointing the two constants at paths that
        # do not exist: `dump_capability.py 174 0 74 2 99.19%`, missing `330->288` and `332->330`.
        # With this test the same reproduction reads `0` partial branches, so the number no longer
        # depends on the machine — and the behaviour below is pinned, which nothing pinned before:
        # a line carrying no channel belongs to NO row and NO channel.
        text = (
            'DIAG datapack=a_cpu_1 faultType=cpu services=2 decimals=3\n'
            '  adservice [#1] selfAnomaly=0.255 onset=34000\n'
            '    metricDecisive: latency-50=0.255{dev=0.192}\n'
            '\n'
            '  -- noise the producer writes between rows --\n'
            '  cartservice [#2] selfAnomaly=0.100 onset=-\n'
        )
        capability = dc.capability_of(text)
        # The two unmatched lines start no row and reach no channel: the population is the SERVICE
        # ROWS, and the blank line is not one of them.
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.rows, 2)
        self.assertEqual(capability.channel('onset').rows_reached, 2)
        self.assertEqual(capability.channel('onset').reach, dc.EVERY)
        self.assertEqual(capability.channel('decisive-composition').rows_reached, 1)

    def test_a_line_before_the_first_header_is_ignored_rather_than_attributed(self) -> None:
        # The producer writes a `signals:` banner. Attributing a marker in it to a case would invent a case.
        capability = dc.capability_of('signals: onset=1 latEdges=1\n' + case('a_cpu_1', FULL_ROW))
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.rows, 1)
        self.assertEqual(capability.channel('onset').rows_reached, 1)

    def test_a_sub_line_that_names_no_row_still_reaches_its_CASE_and_no_row(self) -> None:
        # The block prints sub-lines that belong to no service row. Attributing one to the PREVIOUS case's
        # last row would credit a row that is not its subject; dropping the case attribution would make a
        # channel look absent from an artifact that renders it.
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu services=1 decimals=3\n'
            '    metricDecisive: latency-50=0.255{dev=0.192}\n'
            + FULL_ROW
        )
        coverage = capability.channel('decisive-composition')
        self.assertEqual(coverage.cases_reached, 1)
        self.assertEqual(coverage.rows_reached, 0)
        self.assertEqual(coverage.reach, dc.SOME)
        self.assertIn('decisive-composition some (0/1 rows)', dc.describe(capability))

    def test_the_UNLABELLED_rows_are_counted_because_they_are_candidates_too(self) -> None:
        # The block ranks an unlabelled series (an empty id, with a rank of its own or without one), and the
        # engine's own parser once dropped those rows — which made its parsed count disagree with the
        # header's `services=` in 1421 of 1422 cases, unchecked. A census that dropped them would understate
        # its row population, and that error can only make a channel look MORE universal than it is.
        text = (
            'DIAG datapack=a_cpu_1 faultType=cpu services=3 decimals=3\n'
            '  adservice [#1] selfAnomaly=0.5 logScore=0.0 onset=10 latEdges=1 failedEdge=0.0 dominant=cpu\n'
            '   [#4] selfAnomaly=0.4 logScore=0.0 onset=20 latEdges=1 failedEdge=0.0 dominant=mem\n'
            '   selfAnomaly=0.3 logScore=0.0 onset=30 latEdges=1 failedEdge=0.0 dominant=cpu\n'
        )
        capability = dc.capability_of(text)
        self.assertEqual(capability.rows, 3)
        self.assertEqual(capability.short_blocks, 0)
        self.assertEqual(capability.channel('onset').reach, dc.EVERY)

    def test_a_sub_line_of_an_UNLABELLED_row_reaches_that_row(self) -> None:
        # The sub-line belongs to the row above it whoever that row is; attributing it to a NAMED row would
        # credit a row that is not its subject.
        text = (
            'DIAG datapack=a_cpu_1 faultType=cpu services=2 decimals=3\n'
            '  adservice [#1] selfAnomaly=0.5 logScore=0.0 onset=10 latEdges=1 failedEdge=0.0 dominant=cpu\n'
            '   selfAnomaly=0.3 logScore=0.0 onset=30 latEdges=1 failedEdge=0.0 dominant=cpu\n'
            '    metricDecisive: cpu=0.3{dev=0.3}\n'
        )
        capability = dc.capability_of(text)
        self.assertEqual(capability.channel('decisive-composition').rows_reached, 1)
        self.assertEqual(capability.channel('decisive-composition').reach, dc.SOME)

    def test_a_block_parsed_SHORT_of_its_own_services_is_counted_and_printed(self) -> None:
        # The direction that matters: the reader found fewer rows than the block declares, so every `every`
        # computed over it may be an artifact of the reader rather than a property of the artifact.
        text = (
            'DIAG datapack=a_cpu_1 faultType=cpu services=4 decimals=3\n'
            '  adservice [#1] selfAnomaly=0.5 logScore=0.0 onset=10 latEdges=1 failedEdge=0.0 dominant=cpu\n'
        )
        capability = dc.capability_of(text)
        self.assertEqual(capability.short_blocks, 1)
        self.assertIn('(1 parsed short of their own services=)', dc.describe(capability))
        # A block that declares nothing cannot be short of it, and a surplus cannot happen at all.
        self.assertEqual(dc.capability_of(case('a_cpu_1', FULL_ROW)).short_blocks, 0)

    def test_a_channel_rendered_EVERYWHERE_but_valued_nowhere_is_not_called_complete(self) -> None:
        # The defect this distinction answers, measured on the shipped artifact: `onset` is rendered on all
        # 72527 rows and carries a NUMBER on 63489 of them (87.5%), so `onset every` on its own read as
        # "every row carries an onset". Both numbers are printed whenever they differ.
        text = (
            'DIAG datapack=a_cpu_1 faultType=cpu services=3 decimals=3\n'
            '  adservice [#1] selfAnomaly=0.5 logScore=0.0 onset=34000 latEdges=1 failedEdge=0.0 dominant=cpu\n'
            '    metricDecisive: cpu=0.5{dev=0.5}\n'
            '  cartservice selfAnomaly=0.4 logScore=0.0 onset=- latEdges=1 failedEdge=0.0 dominant= mem\n'
            '    metricDecisive: -\n'
            '  third selfAnomaly=0.3 logScore=0.0 onset=- latEdges=1 failedEdge=0.0 dominant=mem\n'
            '    metricDecisive: mem=0.3{dev=0.3}\n'
        )
        capability = dc.capability_of(text)
        self.assertEqual(capability.rows, 3)
        self.assertEqual(capability.channel('onset').reach, dc.EVERY)
        self.assertEqual(capability.channel('onset').rows_valued, 1)
        self.assertEqual(capability.channel('onset').value_reach, dc.SOME)
        self.assertEqual(capability.channel('dominant-metric').rows_valued, 2)
        # And the sub-line marker's two shapes: a composition, and the `-` the producer prints for a row
        # whose named metric carries none.
        self.assertEqual(capability.channel('decisive-composition').rows_reached, 3)
        self.assertEqual(capability.channel('decisive-composition').rows_valued, 2)
        self.assertEqual(capability.channel('decisive-composition').value_reach, dc.SOME)
        line = dc.describe(capability)
        self.assertIn('onset every, valued 1/3 rows', line)
        self.assertIn('dominant-metric every, valued 2/3 rows', line)
        self.assertIn('decisive-composition every, valued 2/3 rows', line)
        # A channel whose two counts agree prints ONE number: the suffix is for a difference, not a habit.
        self.assertEqual(dc.describe(capability).count('latency-edges every'), 1)
        self.assertNotIn('latency-edges every, valued', dc.describe(capability))

    def test_both_of_the_producers_undetermined_markers_are_not_values(self) -> None:
        # `-` (onset, latRise, and now metricDecisive) and an EMPTY value (`dominant= err=0`, how a row with
        # no named metric prints) both mean rendered-and-undetermined, and a third shape that is neither.
        self.assertFalse(dc.isValued('-'))
        self.assertFalse(dc.isValued(''))
        self.assertTrue(dc.isValued('34000'))
        self.assertTrue(dc.isValued('latency-50'))
        # The property is defined for a case-scoped channel too, so a reader can ask either question of any
        # channel rather than only of the ones that happen to be row-scoped.
        scoped = dc.ChannelCoverage('declared-precision', 3, 4, None, 10, cases_valued=3)
        self.assertEqual(scoped.value_reach, dc.SOME)
        self.assertEqual(scoped.rows_valued, None)

    def test_a_FETCHED_artifact_reports_what_it_holds_and_not_what_the_transport_added(self) -> None:
        # The defect, measured on `artifacts/r35107871516/fse26-results.txt`: every line arrives with a BOM and
        # an ISO timestamp, the block's grammar is anchored, and the census answered `0 cases, 0 rows` with
        # every channel `none` for a file holding 1422 cases and 71161 compositions. Zero cases is not
        # distinguishable, in that output, from an artifact that renders nothing.
        block = case('a_cpu_1', FULL_ROW, FULL_ROW)
        prefixed = ''.join(f'\ufeff2026-09-16T14:25:47.5725271Z {line}\n' for line in block.splitlines())
        plain = dc.capability_of(block)
        through = dc.capability_of(prefixed)
        self.assertEqual(through.cases, 1)
        self.assertEqual(through.rows, 2)
        self.assertEqual(through, plain)
        self.assertEqual(dc.describe(through), dc.describe(plain))

    def test_the_strip_removes_exactly_the_transport(self) -> None:
        # Pinned by shape rather than by example: a BOM, optionally a timestamp and the space after it, and
        # nothing else — a strip that ate more would turn a producer's own line into a line that matches.
        self.assertEqual(dc.strip_transport('DIAG datapack=a'), 'DIAG datapack=a')
        self.assertEqual(dc.strip_transport('\ufeffDIAG datapack=a'), 'DIAG datapack=a')
        self.assertEqual(
            dc.strip_transport('\ufeff2026-09-16T14:25:47.5725271Z DIAG datapack=a'),
            'DIAG datapack=a',
        )
        self.assertEqual(dc.strip_transport('   adservice selfAnomaly=1'), '   adservice selfAnomaly=1')
        # A line the producer really starts with a timestamp is left alone: the pattern needs the Z and the
        # space that the transport's own format carries.
        self.assertEqual(dc.strip_transport('2026-09-16 raw line'), '2026-09-16 raw line')

    def test_a_typo_in_a_channel_name_raises_rather_than_reading_as_not_carried(self) -> None:
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW))
        with self.assertRaises(KeyError):
            capability.channel('onset-delay')


class DescribeTest(unittest.TestCase):
    """The line that lets an artifact's reach travel with a number read from it."""

    def test_it_names_every_channel_and_gives_both_numbers_where_they_differ(self) -> None:
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu services=2 decimals=3\n'
            + FULL_ROW
            + '    metricDecisive: latency-50=0.255{dev=0.192}\n'
            + FULL_ROW
        )
        line = dc.describe(capability)
        self.assertIn('1 cases, 2 rows', line)
        self.assertIn('declared-precision every', line)
        self.assertIn('decisive-composition some (1/2 rows)', line)
        self.assertIn('signature-overlap every', line)

    def test_it_says_a_channel_is_absent_rather_than_omitting_it(self) -> None:
        # An omitted channel reads as "not asked", which is the opposite of "measured and absent".
        line = dc.describe(dc.capability_of(case('a_cpu_1', FULL_ROW, decimals=None, decisive=False)))
        self.assertIn('declared-precision none', line)
        self.assertIn('decisive-composition none', line)

    def test_a_case_scoped_channel_reports_its_own_population_when_it_is_selective(self) -> None:
        # A file whose cases disagree about whether they declare a precision: the number is over CASES, and
        # printing a row count for a header field would invent a frontier the field does not have.
        text = case('a_cpu_1', FULL_ROW, decimals=3) + case('a_cpu_2', FULL_ROW, decimals=None)
        capability = dc.capability_of(text)
        self.assertEqual(capability.cases, 2)
        self.assertEqual(capability.channel('declared-precision').reach, dc.SOME)
        self.assertIn('declared-precision some (1/2 cases)', dc.describe(capability))


class RequireChannelTest(unittest.TestCase):
    """The refusal: a read is refused unless the artifact reaches as far as the reader needs."""

    def test_a_reader_that_sums_over_every_row_is_refused_when_the_channel_is_selective(self) -> None:
        # The measured defect, in miniature: a per-candidate simulation needs the composition on EVERY row a
        # case could promote. The refusal names the artifact, the channel, the measured coverage and the code.
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu services=3 decimals=3\n'
            + FULL_ROW
            + FULL_ROW
            + '    metricDecisive: cpu=0.1{dev=0.1}\n'
            + FULL_ROW
        )
        with self.assertRaises(dc.CapabilityError) as caught:
            dc.require_channel(
                capability,
                'decisive-composition',
                name='the FSE26 dump',
                reader='a per-candidate composition simulation',
            )
        message = str(caught.exception)
        self.assertIn('the FSE26 dump', message)
        self.assertIn('a per-candidate composition simulation', message)
        self.assertIn('reaches some of its rows (1/3)', message)
        self.assertIn('requires every', message)

    def test_a_reader_that_only_asks_whether_it_is_there_passes_on_some(self) -> None:
        # `some` and `every` are different questions and both are legal, so the caller says which one it is.
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu services=2 decimals=3\n'
            + FULL_ROW
            + '    metricDecisive: cpu=0.1{dev=0.1}\n'
            + FULL_ROW
        )
        dc.require_channel(
            capability, 'decisive-composition', name='x', reader='a presence check', reach=dc.SOME
        )

    def test_a_reader_requiring_presence_is_refused_by_an_artifact_that_never_renders_it(self) -> None:
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, decisive=False))
        with self.assertRaises(dc.CapabilityError) as caught:
            dc.require_channel(
                capability, 'decisive-composition', name='the dump', reader='the screen', reach=dc.SOME
            )
        self.assertIn('reaches none of its rows (0/1)', str(caught.exception))

    def test_a_case_scoped_channel_is_refused_on_CASES_and_says_so(self) -> None:
        # The scope is in the message because it decides what the reader can do about it: fewer cases means a
        # different artifact, fewer rows can mean a producer change.
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, decimals=None))
        with self.assertRaises(dc.CapabilityError) as caught:
            dc.require_channel(capability, 'declared-precision', name='the dump', reader='a resolution model')
        self.assertIn('reaches none of its cases (0/1)', str(caught.exception))

    def test_a_reach_that_is_not_a_reach_is_refused_rather_than_defaulted(self) -> None:
        # A typo would otherwise silently mean "some" or "every", and the two ask different questions.
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW))
        with self.assertRaises(ValueError) as caught:
            dc.require_channel(capability, 'onset', name='x', reader='y', reach='all')
        self.assertIn("reach must be 'every' or 'some'", str(caught.exception))

    def test_a_CASE_SCOPED_channel_that_reaches_every_case_passes(self) -> None:
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, decimals=3))
        dc.require_channel(capability, 'declared-precision', name='x', reader='a resolution model')


class RealArtifactsTest(unittest.TestCase):
    """Measured against the artifacts the census was built for, when they are still on disk."""

    def _capability(self, path: Path) -> dc.DumpCapability:
        if not path.exists():
            self.skipTest(f'{path.name} is not on this machine')
        return dc.capability_of(path.read_text('utf-8', errors='replace'))

    def test_the_refreshed_archive_declares_its_precision_and_a_suite_is_three_systems(self) -> None:
        for name, cases in (('re1.txt', 375), ('re2.txt', 150), ('re3.txt', 90)):
            capability = self._capability(LOCAL_DUMPS / name)
            self.assertEqual(capability.cases, cases)
            self.assertEqual(capability.channel('declared-precision').reach, dc.EVERY)
            self.assertEqual(capability.channel('signature-overlap').reach, dc.EVERY)

    def test_the_decisive_composition_is_SELECTIVE_even_in_the_artifact_that_has_it(self) -> None:
        # The claim this exists to check: the field's own comment says it "exists for EVERY service", and a
        # signal summed over every candidate needs exactly that. Measured, it is present on 86.45% of re1's
        # rows — so the same artifact answers `some`, and a reader that required `every` must be refused.
        capability = self._capability(LOCAL_DUMPS / 're1.txt')
        coverage = capability.channel('decisive-composition')
        self.assertEqual(coverage.reach, dc.SOME)
        self.assertLess(coverage.rows_reached, capability.rows)
        with self.assertRaises(dc.CapabilityError):
            dc.require_channel(
                capability, 'decisive-composition', name='re1', reader='a simulation over every candidate'
            )

    def test_the_archived_artifacts_parse_to_exactly_the_rows_they_declare(self) -> None:
        # The precondition every verdict above depends on: 0 blocks parsed short means the row population is
        # the ARTIFACT's own. The row total is asserted against the number the engine's parser reaches on the
        # same file (72527), because two readers agreeing on the population is what makes a cross-check.
        for path in (LOCAL_DUMPS / 're1.txt', LOCAL_DUMPS / 're3.txt', FSE26_DUMP):
            capability = self._capability(path)
            self.assertEqual(capability.short_blocks, 0, path.name)
        self.assertEqual(self._capability(FSE26_DUMP).rows, 72527)

    def test_the_FSE26_artifact_carries_neither_a_precision_nor_a_composition(self) -> None:
        # The record's FSE'26 numbers are read from this artifact, and it states no render precision and
        # renders no decisive composition at all — so both are UNEVALUABLE here rather than zero.
        capability = self._capability(FSE26_DUMP)
        self.assertEqual(capability.cases, 1422)
        self.assertEqual(capability.channel('declared-precision').reach, dc.NONE)
        self.assertEqual(capability.channel('decisive-composition').reach, dc.NONE)
        self.assertEqual(capability.channel('signature-overlap').reach, dc.NONE)
        # The channels it DOES carry reach every row, so the missing three are a producer gap and not a
        # truncated artifact.
        for name in ('onset', 'latency-edges', 'failed-edge', 'dominant-metric'):
            self.assertEqual(capability.channel(name).reach, dc.EVERY, name)


if __name__ == '__main__':
    unittest.main()
