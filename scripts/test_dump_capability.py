"""
The census of what an artifact carries, and the refusal that stops a number being read from one that does not.

Every test here corresponds to a way one of the three measured defects could have been caught mechanically:
the reader's error bar was modelled on a precision no artifact had declared, a comparison was run between a
subset and its superset, and a stability table was read from a report that holds no compositions.

@module scripts/test_dump_capability
"""

from __future__ import annotations

import contextlib
import io
import json
import runpy
import sys
import unittest
from pathlib import Path
from unittest import mock

import dump_capability as dc

LOCAL_DUMPS = Path('/Users/lambertyan/WorkBuddy/2026-08-08-10-23-08/.bench-cache/rcaeval-dumps')
FSE26_DUMP = Path('/Users/lambertyan/WorkBuddy/2026-08-08-10-23-08/.bench-cache/dump-35035314921.txt')
#: The three-decimal FSE'26 artifact the stability screen and the separator verdict are read from. Under
#: `artifacts/`, which is git-ignored, so every test that reads it skips rather than fails on a machine that
#: has never fetched it — and the numbers are recorded in `docs/artifact-capability-audit.md` for the same
#: reason the artifact is not the record.
SHIPPED_FSE26 = Path(__file__).resolve().parent.parent / 'artifacts/r35107871516/fse26-results.txt'

#: A row carrying every row-level channel, in the shape the producer writes it. The row-level keys are the
#: producer's own literals, in its own order (`packages/kinetic/src/benchmarks/fse26-diagnose.ts`), so a
#: fixture that drifts from the producer is caught by the TypeScript fence rather than read as a legal shape.
FULL_ROW = (
    '  adservice [#1] selfAnomaly=0.255 logScore=0.000 failedEdge=1.000 failedEdgeRecords=9 '
    'latRise=- latEdges=0 dominant=latency-50 err=0 fatal=0 logic=0 http=0 both=0 onset=34000\n'
)

#: A row with neither an id nor a label — the unlabelled series the block still ranks. Its own channel now
#: reports the absence, because `n` is the divisor of every metric term and a reader that drops these rows
#: computes a different term for every service in the case.
UNLABELLED_ROW = (
    '   selfAnomaly=0.100 logScore=0.000 failedEdge=0.000 failedEdgeRecords=0 latRise=- latEdges=0 '
    'dominant=- err=0 fatal=0 logic=0 http=0 both=0 onset=-\n'
)

#: Every sub-line the producer can write for a row, so a fixture cannot reach `every` by rendering a subset.
FULL_SUB_LINES = (
    '    metrics(2): cpu, mem\n'
    '    metricKept(1): cpu=0.9\n'
    '    metricDrop(1): mem:transient-return\n'
    '    metricTop(1/1): cpu=0.9{dev=0.4,trend=0.1,cv=0.2,burst=0,rise=12,drop=0,base=0.02}\n'
    '    metricDecisive: cpu=0.9{dev=0.4,trend=0.1}\n'
    '    ERR: Connection refused\n'
    '    exc(1): IOException\n'
)


def case(datapack: str, *rows: str, decimals: int | None = 3, decisive: bool = True) -> str:
    """
    One case's block, in the block's own structure: header, case lines, rows, and the sub-lines of a row.

    The indentation is load-bearing — `metricDecisive` is a 4-space sub-line, which is what makes it a
    channel of the ROW that precedes it rather than a line the census could count on its own.

    The header and the two case lines carry every field the producer can write, so a channel that is only
    reachable through one of them cannot pass by being absent from the fixture.
    """
    tail = '' if decimals is None else f' decimals={decimals}'
    head = (
        f'DIAG datapack={datapack} faultType=cpu GT=[adservice] services={len(rows)}'
        f' logMode=logicHttp inject=1000{tail}\n'
        '  edges=a>b,b>c\n'
        '  prediction=[adservice]\n'
    )
    body = ''
    for row in rows:
        body += row
        if decisive:
            body += '    metricDecisive: latency-50=0.255{dev=0.192,trend=0.062}\n'
    return head + body


#: One case with EVERY channel rendered, so a channel added to the table without a producer that writes it
#: fails the equality above rather than passing on a fixture that never mentions it.
FULL_CASE = (
    'DIAG datapack=a_cpu_1 faultType=cpu GT=[adservice] services=1 logMode=logicHttp inject=1000 decimals=3\n'
    '  edges=a>b\n'
    '  prediction=[adservice]\n' + FULL_ROW + FULL_SUB_LINES
)


class CapabilityOfTest(unittest.TestCase):
    """What an artifact can be ASKED, read from its own text."""

    def test_a_fully_rendered_artifact_reaches_every_case_and_every_row(self) -> None:
        capability = dc.capability_of(FULL_CASE)
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.rows, 1)
        for name in dc.CHANNELS:
            coverage = capability.channel(name)
            self.assertEqual(coverage.reach, dc.EVERY, name)
            # BOTH counts, for every channel: the case count is a separate claim from the row count and the
            # census reports both. Asserting only the verdict left it possible to stop crediting the case for a
            # whole scope — the row count keeps the verdict right, so nothing would have failed.
            self.assertEqual(coverage.cases_reached, 1, name)

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


class DeclarationTableTest(unittest.TestCase):
    """
    The population itself: one table, one key literal per channel, and no room for a name and a matcher to
    drift apart — which is what happened for `latEdges`/`latRise` and `failedEdge`/`failedEdgeRecords`.

    The TypeScript fence (`benchmarks/__tests__/fse26-capability-census.test.ts`) is the other half: it builds
    a dump with the producer and asserts this table's `key`s equal the artifact's fields, both directions, and
    that the declared `fields` equal `SERVICE_FIELD_AUDIT`'s keys — the typed `Record<keyof DiagnosedService>`.
    """

    def test_the_report_is_DERIVED_from_the_table_rather_than_listed_beside_it(self) -> None:
        self.assertEqual(dc.CHANNELS, tuple(d.channel for d in dc.DECLARATIONS))
        self.assertEqual(len(set(dc.CHANNELS)), len(dc.CHANNELS))
        # The `services=` reader is derived too, so the key literal has exactly one owner.
        self.assertIn('services-declared', dc.CHANNELS)
        self.assertEqual(
            dc.SERVICES_DECLARED.pattern,
            r'\b' + next(d.key for d in dc.DECLARATIONS if d.channel == 'services-declared') + r'=(\d+)',
        )

    def test_the_population_is_BIG_enough_for_an_equality_to_mean_anything(self) -> None:
        # A one-sided check passes on an empty table. The counts are the producer's grammar: the identity's two
        # channels, the case's nine fields, the row's thirteen, the sub-line's seven.
        self.assertGreaterEqual(len(dc.DECLARATIONS), 31)
        self.assertEqual(set(d.scope for d in dc.DECLARATIONS), set(dc.SCOPES))
        per_scope = {scope: sum(1 for d in dc.DECLARATIONS if d.scope == scope) for scope in dc.SCOPES}
        self.assertEqual(per_scope[dc.ROW], 13)
        self.assertEqual(per_scope[dc.SUB_LINE], 7)
        self.assertEqual(per_scope[dc.HEADER], 7)
        self.assertEqual(per_scope[dc.CASE_LINE], 2)
        self.assertEqual(per_scope[dc.ROW_IDENTITY], 2)

    def test_every_channel_declares_the_field_it_carries_and_why(self) -> None:
        # `why` is the deliverable: "nobody screens this" and "this was screened and closed" are different
        # statements, and a blank reason would let the second read as the first.
        for declaration in dc.DECLARATIONS:
            self.assertTrue(declaration.why.strip(), declaration.channel)
            self.assertTrue(
                declaration.fields or declaration.channel in dc.NO_FIELD_CHANNELS,
                f'{declaration.channel} declares no field and is not a declared no-field channel',
            )

    def test_a_channel_that_carries_NO_parsed_field_says_so_by_name(self) -> None:
        # Three lines the producer renders and no reader parses. They are channels — the census reports what
        # the artifact CARRIES — and they are excluded from the field equality by an explicit set rather than
        # by being forgotten, because an exclusion nobody decided is not an exclusion.
        self.assertEqual(
            dc.NO_FIELD_CHANNELS,
            frozenset({'metric-list', 'error-messages', 'exceptions'}),
        )
        for name in dc.NO_FIELD_CHANNELS:
            self.assertEqual(dc.DECLARATIONS[dc.CHANNELS.index(name)].fields, ())

    def test_a_key_is_DERIVED_into_a_marker_that_cannot_match_its_neighbour(self) -> None:
        # The measured drift, in both directions: `failedEdge` is a PREFIX of `failedEdgeRecords`, so a
        # marker written as a bare substring search finds the count where the score was meant — and the two
        # belong to opposite halves of one family, so the reach a candidate is told is the other half's.
        score = dc.DECLARATIONS[dc.CHANNELS.index('failed-edge')].marker
        count = dc.DECLARATIONS[dc.CHANNELS.index('failed-edge-records')].marker
        row = '  a [#1] failedEdge=1.000 failedEdgeRecords=9\n'
        self.assertEqual(score.search(row).group(1), '1.000')
        self.assertEqual(count.search(row).group(1), '9')
        self.assertIsNone(score.search('  a [#1] failedEdgeRecords=9\n'))
        self.assertIsNone(count.search('  a [#1] failedEdge=1.000\n'))
        # And the same for the other family, whose two halves are `latEdges` and `latRise`.
        edges = dc.DECLARATIONS[dc.CHANNELS.index('latency-edges')].marker
        rise = dc.DECLARATIONS[dc.CHANNELS.index('latency-rise')].marker
        self.assertEqual(edges.search('  a [#1] latRise=3.5 latEdges=2\n').group(1), '2')
        self.assertEqual(rise.search('  a [#1] latRise=3.5 latEdges=2\n').group(1), '3.5')

    def test_the_two_families_both_carry_BOTH_halves(self) -> None:
        # The defect this table exists for: the list held the failed-edge SCORE but not the COUNT, and the
        # latency COUNT but not the RISE, so either half of either family had to name the other half's
        # channel and was told the other half's reach.
        for pair in (('failed-edge', 'failed-edge-records'), ('latency-edges', 'latency-rise')):
            for name in pair:
                self.assertIn(name, dc.CHANNELS, name)
            fields = {
                dc.DECLARATIONS[dc.CHANNELS.index(name)].fields[0] for name in pair
            }
            self.assertEqual(len(fields), 2, f'{pair} declare one field twice')

    def test_a_NUMBER_valued_field_cannot_be_counted_as_carried_on_a_non_number(self) -> None:
        # The reader's own `HEADER_RE` fails outright on `decimals=abc`, so a census that counted it as
        # carried would report a precision the reader will not see.
        declarations = {d.channel: d for d in dc.DECLARATIONS}
        header = 'DIAG datapack=x faultType=y GT=[a] services=2 logMode=m inject=7 decimals=3\n'
        for name in ('declared-precision', 'services-declared', 'inject-time'):
            self.assertIsNotNone(declarations[name].marker.search(header), name)
        self.assertIsNone(
            declarations['declared-precision'].marker.search('DIAG datapack=x services=2 decimals=abc\n'),
            'a non-numeric precision is not a declared precision',
        )


class ReachIsJudgedOnItsOWNScopeTest(unittest.TestCase):
    """
    The two clauses of `reach` that a measurement added, each pinned on a coverage object built by hand.

    Built by hand rather than from a fixture on purpose: the clause is a statement about TWO counts, and a
    fixture can only produce the pairs the producer happens to write. The pairs below are the ones the
    scanner's own two shapes produce — a row channel with no case flag and rows that carry it, and a
    population of no rows at all — and neither is reachable from the concrete syntax alone.
    """

    def _coverage(self, **overrides: object) -> dc.ChannelCoverage:
        base: dict[str, object] = {
            'channel': 'onset',
            'cases_reached': 0,
            'total_cases': 1,
            'rows_reached': 1,
            'total_rows': 2,
            'cases_valued': 0,
            'rows_valued': 1,
        }
        base.update(overrides)
        return dc.ChannelCoverage(**base)  # type: ignore[arg-type]

    def test_a_ROW_channel_with_no_case_flag_is_SOME_and_never_NONE(self) -> None:
        # The measured defect: the first version asked the CASE count first, and answered `none` for the two
        # row-identity channels — a channel 71105 of the shipped artifact's 72527 rows carry.
        self.assertEqual(self._coverage().reach, dc.SOME)
        self.assertEqual(self._coverage().value_reach, dc.SOME)
        self.assertEqual(self._coverage(rows_reached=0).reach, dc.NONE)

    def test_an_EMPTY_population_is_never_EVERY_however_far_a_case_reached(self) -> None:
        # `0 == 0` satisfies `reached == total`, so without this clause a block with no rows reports every row
        # channel as `every` — a universal claim about nothing. Reachable through the one shape that sets a case
        # flag without a row: a sub-line the parser cannot attribute to any row.
        empty = self._coverage(rows_reached=0, total_rows=0, cases_reached=1)
        self.assertEqual(empty.reach, dc.NONE)
        self.assertEqual(empty.value_reach, dc.NONE)
        self.assertEqual(self._coverage(rows_valued=0, total_rows=0, cases_valued=1).value_reach, dc.NONE)

    def test_every_row_carrying_it_is_EVERY_and_part_of_them_is_SOME(self) -> None:
        # Both directions, so neither the union clause nor the empty clause can be satisfied by a property
        # that answers one value for everything.
        self.assertEqual(self._coverage(rows_reached=2, cases_reached=1).reach, dc.EVERY)
        self.assertEqual(self._coverage(rows_reached=1, cases_reached=1).reach, dc.SOME)

    def test_a_CASE_scoped_channel_is_answered_over_CASES_and_ignores_the_row_counts(self) -> None:
        coverage = self._coverage(
            channel='declared-precision', cases_reached=1, rows_reached=None, rows_valued=None
        )
        self.assertEqual(coverage.reach, dc.EVERY)
        self.assertEqual(coverage.value_reach, dc.NONE)
        self.assertEqual(self._coverage(channel='declared-precision', cases_reached=0).reach, dc.NONE)

    def test_the_UNLABELLED_series_is_counted_and_its_absent_id_is_a_NUMBER_not_a_caveat(self) -> None:
        # One row per case with no id at all — the ten unlabelled `k8s.*` series. `n` is the divisor of every
        # metric term, so a reader that drops the row computes a different term for every service.
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, UNLABELLED_ROW, UNLABELLED_ROW))
        self.assertEqual(capability.rows, 3)
        self.assertEqual(capability.channel('service-id').rows_reached, 1)
        self.assertEqual(capability.channel('service-id').reach, dc.SOME)
        self.assertEqual(capability.channel('row-labels').rows_reached, 1)
        # The CASE count is a different claim and it is recorded too: "some case renders an id" is true here,
        # and it is the count a `reach` that read only cases would have turned into a verdict about rows.
        self.assertEqual(capability.channel('service-id').cases_reached, 1)

    def test_a_channel_nothing_reaches_is_NONE_in_BOTH_scopes(self) -> None:
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, decimals=None))
        for name in ('declared-precision', 'metric-kept', 'error-messages'):
            coverage = capability.channel(name)
            self.assertEqual(coverage.reach, dc.NONE, name)
            self.assertEqual(coverage.value_reach, dc.NONE, name)

    def test_a_CASE_scoped_field_rendered_WITHOUT_a_value_is_reached_but_not_valued(self) -> None:
        # Which header fields CAN carry the undetermined marker is itself a fact about the two kinds of
        # header field, and it is not symmetric. The three NUMERIC ones (`services`, `inject`, `decimals`)
        # declare a digits-only value because the reader's own `HEADER_RE` requires one — so an unvalued
        # `inject` is ABSENT from the header rather than printed as `-`, and their two numbers cannot differ.
        # The token-valued ones can: `logMode=-` is rendered and undetermined.
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu GT=[a] services=1 logMode=- inject=7 decimals=3\n'
            + FULL_ROW
        )
        self.assertEqual(capability.channel('log-mode').reach, dc.EVERY)
        self.assertEqual(capability.channel('log-mode').value_reach, dc.NONE)
        # And the numeric half, stated as the thing it is: absent, not marked.
        absent = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu GT=[a] services=1 logMode=logicHttp decimals=3\n'
            + FULL_ROW
        )
        self.assertEqual(absent.channel('inject-time').reach, dc.NONE)
        unmarked = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu GT=[a] services=1 logMode=logicHttp inject=- decimals=3\n'
            + FULL_ROW
        )
        self.assertEqual(unmarked.channel('inject-time').reach, dc.NONE)

    def test_a_CASE_line_rendered_WITHOUT_a_value_is_reached_but_not_valued(self) -> None:
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu GT=[a] services=1 logMode=logicHttp inject=7 decimals=3\n'
            '  edges=-\n'
            '  prediction=[]\n' + FULL_ROW
        )
        self.assertEqual(capability.channel('failed-edge-graph').reach, dc.EVERY)
        self.assertEqual(capability.channel('failed-edge-graph').value_reach, dc.NONE)

    def test_the_IDENTITY_is_two_channels_each_with_its_OWN_two_numbers(self) -> None:
        # The row's identity is not a `key=value` field, so it needs its own pair of patterns, and both must
        # tell "rendered" from "carrying something": the id is what the unlabelled series lacks, and the tag
        # is what a service the engine never predicted and the case never labelled lacks.
        odd = FULL_ROW.replace('adservice [#1]', '- []', 1)
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, odd))
        self.assertEqual(capability.rows, 2)
        for name in ('service-id', 'row-labels'):
            coverage = capability.channel(name)
            self.assertEqual(coverage.rows_reached, 2, name)
            self.assertEqual(coverage.rows_valued, 1, name)
            self.assertEqual(coverage.reach, dc.EVERY, name)
            self.assertEqual(coverage.value_reach, dc.SOME, name)

    def test_a_block_with_NO_rows_answers_NONE_for_every_ROW_channel(self) -> None:
        # Zero of zero is 1.0, so a population of nothing satisfies `reached == total` and would report every
        # channel as `every` — the vacuous reading, and the one a truncated fetch produces. The block below
        # also renders a sub-line with no row above it, so the CASE count reaches that channel while no row
        # does: the two counts are different claims and the verdict follows the row.
        capability = dc.capability_of(
            'DIAG datapack=a_cpu_1 faultType=cpu GT=[] services=0 logMode=logicHttp inject=7 decimals=3\n'
            '    metricDecisive: cpu=0.1{dev=0.1}\n'
        )
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.rows, 0)
        self.assertEqual(capability.channel('decisive-composition').cases_reached, 1)
        self.assertEqual(capability.channel('decisive-composition').rows_reached, 0)
        for name in dc.CHANNELS:
            if name in dc.CASE_SCOPED:
                continue
            self.assertEqual(capability.channel(name).reach, dc.NONE, name)
            self.assertEqual(capability.channel(name).value_reach, dc.NONE, name)


class CommittedProjectionTest(unittest.TestCase):
    """
    The file the TypeScript fence reads, kept equal to the table IN BOTH DIRECTIONS.

    The connection runs two edges: this test holds `scripts/dump_capability.channels.json` equal to
    {@link dc.declarations_as_data}, and `benchmarks/__tests__/fse26-capability-census.test.ts` holds that file
    equal to what the PRODUCER emits and to `SERVICE_FIELD_AUDIT`'s keys. Neither edge alone would have found
    the defect — the table was self-consistent (eight tests passed on it) and the producer was correct; what
    was missing was the edge between them.
    """

    def test_the_committed_projection_EQUALS_the_table_and_is_not_a_second_list(self) -> None:
        committed = json.loads(dc.DECLARATIONS_PATH.read_text('utf-8'))
        self.assertEqual(committed, dc.declarations_as_data())
        # Byte equality too, so a reformat that changes nothing semantically still shows up as the diff it is:
        # the file is generated, and a generated file that no longer matches its generator is a stale copy.
        self.assertEqual(dc.DECLARATIONS_PATH.read_text('utf-8'), dc.format_declarations_json())

    def test_the_projection_carries_the_MECHANICAL_columns_and_no_prose(self) -> None:
        # A reason is for a reader and a fence needs a column: shipping the prose into the file would make the
        # projection's shape depend on wording, and a rewording would show as a regenerate.
        for entry in dc.declarations_as_data():
            self.assertEqual(
                sorted(entry),
                ['absent', 'channel', 'fields', 'key', 'pattern', 'scope', 'valueIn'],
            )

    def test_every_mechanical_column_is_DERIVED_rather_than_retyped(self) -> None:
        # The file is a projection of the table, so each column has to be the table's own value: a
        # retyped `pattern` would be a second spelling of the grammar, and the TypeScript edge of the
        # fence applies THIS string — the two halves would then disagree about what a line means while
        # both were self-consistent, which is the shape of the defect this iteration fixes.
        by_channel = {one.channel: one for one in dc.DECLARATIONS}
        for entry in dc.declarations_as_data():
            declaration = by_channel[entry['channel']]
            self.assertEqual(entry['pattern'], declaration.marker.pattern)
            self.assertEqual(entry['valueIn'], declaration.value_in)
            self.assertEqual(entry['key'], declaration.key)
            self.assertEqual(entry['scope'], declaration.scope)
            self.assertEqual(entry['fields'], list(declaration.fields))

    def test_the_ABSENT_markers_travel_with_the_projection_and_match_isValued(self) -> None:
        # "Rendered and undetermined" is a RULE, not a predicate the other language can guess: the
        # TypeScript edge has to apply exactly this tuple, so it is data. Held equal to `isValued` in
        # both directions here, because a projection carrying one rule while the census applied another
        # would make the two halves of the fence measure different things.
        for entry in dc.declarations_as_data():
            self.assertEqual(entry['absent'], list(dc.ABSENT_VALUES))
        for probe in ('', '-', '0', 'x', '  '):
            self.assertEqual(dc.isValued(probe), probe not in dc.ABSENT_VALUES, repr(probe))

    def test_the_placement_vocabulary_is_CLOSED(self) -> None:
        # A placement outside the vocabulary would fall through the marker builder to whichever branch
        # the scope implies, which is how a channel could claim a value where it has none.
        for declaration in dc.DECLARATIONS:
            self.assertIn(declaration.value_in, dc.VALUE_PLACEMENTS, declaration.channel)
        self.assertEqual(set(dc.VALUE_PLACEMENTS), {dc.FIELD, dc.PAREN, dc.BODY})

    def test_the_regeneration_command_prints_EXACTLY_the_committed_bytes(self) -> None:
        # The failure message names a command, so the command has to be the one that works.
        captured = io.StringIO()
        with contextlib.redirect_stdout(captured):
            self.assertEqual(dc.main(['--channels']), 0)
        self.assertEqual(captured.getvalue(), dc.DECLARATIONS_PATH.read_text('utf-8'))

    def test_the_command_REFUSES_an_empty_request_rather_than_printing_nothing(self) -> None:
        # Silence would read as an empty table, which is the one reading that makes the equality vacuous.
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                dc.main([])
        self.assertEqual(caught.exception.code, 2)

    def test_the_module_is_reachable_as_a_COMMAND(self) -> None:
        # Through `runpy` with `__main__` as the name, because that is what a shell does: calling `main()`
        # from a test leaves the guard at the foot of the file unexecuted, and the guard is the only thing
        # that makes the regeneration command in a failure message a command rather than a function.
        saved = sys.argv
        sys.argv = ['dump_capability.py', '--channels']
        captured = io.StringIO()
        try:
            with contextlib.redirect_stdout(captured):
                with self.assertRaises(SystemExit) as caught:
                    runpy.run_path(str(Path(dc.__file__)), run_name='__main__')
        finally:
            sys.argv = saved
        self.assertEqual(caught.exception.code, 0)
        self.assertEqual(captured.getvalue(), dc.DECLARATIONS_PATH.read_text('utf-8'))

    def test_an_EMPTY_table_projects_to_an_empty_array_rather_than_a_blank_file(self) -> None:
        # A table emptied by an edit must still render JSON. The branch exists because the array's framing
        # is hand-assembled around `json.dumps`, and `'[\n' + '' + '\n]\n'` is a file a reader would have to
        # guess at rather than parse.
        with mock.patch.object(dc, 'DECLARATIONS', ()):
            self.assertEqual(dc.declarations_as_data(), [])
            self.assertEqual(dc.format_declarations_json(), '[]\n')


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

    def test_the_VALUE_count_is_printed_whenever_it_differs_even_if_both_verdicts_agree(self) -> None:
        # Both verdicts read `every`/`some` alike while the two COUNTS differ, so a rule keyed on the VERDICT
        # would hide the rows a candidate cannot be evaluated on. The difference has to come from a channel
        # whose value can be undetermined while the channel renders — `onset=-` is the block's explicit
        # marker for that, and the `onset` scalar reads it.
        #
        # It must NOT come from the inventory counts: `metricKept(0):` states a zero in its parentheses and
        # is a measurement, which the test below pins in that direction. The FIRST version of this test used
        # `metricKept(0):` as its source of difference, so correcting the count channels made it fail — and
        # that failure was the defect being asserted, not a regression.
        undetermined = FULL_ROW.replace('onset=34000', 'onset=-')
        self.assertNotEqual(undetermined, FULL_ROW, 'the fixture must actually move the onset')
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW, undetermined))
        coverage = capability.channel('onset')
        self.assertEqual((coverage.rows_reached, coverage.rows_valued), (2, 1))
        self.assertEqual(coverage.reach, dc.EVERY)
        self.assertEqual(coverage.value_reach, dc.SOME)
        # `every` on both verdicts, so the reach count is not printed — and yet the VALUE count must be,
        # because 1 of the 2 rows carries `onset=-` and a candidate reading the delay cannot use it.
        self.assertIn('onset every, valued 1/2 rows', dc.describe(capability))

    def test_a_ZERO_written_in_the_PARENTHESES_is_a_VALUE_not_a_gap(self) -> None:
        # The defect this iteration fixes, pinned where it was wrong. `metricDrop(0):` is rendered with no
        # body because the producer writes the list only while the count is non-zero — and the field the
        # channel declares (`metricOutcomes`) carries the COUNT, so the `0` in the parentheses is the
        # measurement. Read as the body instead, a block that dropped nothing came back as "rendered and
        # undetermined", which is the one reading that makes a measurement indistinguishable from a gap.
        text = case(
            'a_cpu_1',
            FULL_ROW + '    metrics(2): cpu, mem\n' + '    metricKept(0):\n' + '    metricDrop(0):\n',
            decisive=False,
        )
        capability = dc.capability_of(text)
        self.assertEqual(capability.rows, 1)
        for name in ('metric-kept', 'metric-drop'):
            coverage = capability.channel(name)
            self.assertEqual(coverage.reach, dc.EVERY, name)
            self.assertEqual(coverage.value_reach, dc.EVERY, name)
            self.assertEqual((coverage.rows_reached, coverage.rows_valued), (1, 1), name)
        # The sibling that is genuinely BODY-placed keeps its own reading: the decomposition is the value,
        # so a `metricTop` marked `-` is reached and not valued. Without this the fixture would pass on a
        # census that had simply stopped distinguishing the two placements.
        body = dc.capability_of(case('a_cpu_1', FULL_ROW + '    metricTop(0/0): -\n', decisive=False))
        self.assertEqual(body.channel('metric-top').reach, dc.EVERY)
        self.assertEqual(body.channel('metric-top').value_reach, dc.NONE)

    def test_the_PAREN_marker_reads_the_COUNT_and_refuses_a_LINE_without_one(self) -> None:
        # A PAREN channel's value is the number in the parentheses, so the derivation has to be exactly
        # that: `metricTop(1/3)` is a count the pattern must not capture for a channel that expects a
        # single integer, and a `metricKept` line with no parentheses at all is not this channel.
        declaration = {one.channel: one for one in dc.DECLARATIONS}['metric-kept']
        self.assertEqual(declaration.value_in, dc.PAREN)
        self.assertEqual(declaration.value, r'\d+')
        found = declaration.marker.match('    metricKept(38): a=0.5 b=0.4')
        self.assertIsNotNone(found)
        self.assertEqual(found.group(1), '38')
        self.assertIsNone(declaration.marker.match('    metricKept: a=0.5'))
        self.assertIsNone(declaration.marker.match('    metricKept(1/3): a=0.5'))
        # And the count is read as a number rather than compared as text.
        self.assertTrue(dc.isValued('0'))
        self.assertFalse(dc.isValued('-'))

    def test_a_channel_whose_two_counts_AGREE_prints_one_number(self) -> None:
        # The other direction: printing the second number unconditionally would put `valued 72527/72527` on
        # every universal channel and bury the ones where the two actually differ.
        capability = dc.capability_of(case('a_cpu_1', FULL_ROW))
        line = dc.describe(capability)
        self.assertIn('onset every', line)
        self.assertNotIn('onset every, valued', line)
        # `latRise=-` is the producer's undetermined marker, so this one DOES print both.
        self.assertIn('latency-rise every, valued 0/1 rows', line)


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


class ShortBlockTest(unittest.TestCase):
    """
    `short_blocks`: the census's OTHER answer, and the one the READER does not give.

    A block is dropped by the reader when its rendered candidate count disagrees with its own
    `services=` header, and the count was thrown away — so an artifact that lost blocks produced
    verdicts over a smaller population with nothing on screen to say so. The census was the only
    instrument that counted the loss, and the two counts are NOT the same number about the same file.
    Three differences, each asserted below:

    1. the census counts a STRICT shortfall (`parsed < declared`); the reader drops on ANY inequality,
       so a block that rendered MORE rows than it declared is a 0 here and a drop there;
    2. a block that lost its footer but rendered every row it declared is a 0 here and a drop there;
    3. a block that lost rows AND reached its footer is a 1 on both.

    Which is why the reader's report is a PARTITION of its own drops and this is neither a superset nor
    a subset of it — and why the reader needed a report of its own rather than a reading of the census.
    """

    def _fixture(self, rows: int, declared: int, footer: bool = True) -> str:
        head = f'DIAG datapack=a_cpu_1 faultType=cpu GT=[a] services={declared} logMode=logicHttp\n'
        body = ''.join(FULL_ROW for _ in range(rows))
        return head + body + ('  prediction=[a]\n' if footer else '')

    def test_an_INTACT_block_is_not_counted(self) -> None:
        capability = dc.capability_of(self._fixture(2, 2))
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.rows, 2)
        self.assertEqual(capability.short_blocks, 0)

    def test_a_block_that_rendered_FEWER_rows_than_declared_is_counted(self) -> None:
        capability = dc.capability_of(self._fixture(1, 2))
        self.assertEqual(capability.cases, 1)
        self.assertEqual(capability.short_blocks, 1)

    def test_a_block_that_rendered_MORE_rows_than_declared_is_NOT_counted_here(self) -> None:
        # The first difference, and it is the direction that makes this number unusable as a stand-in
        # for the reader's: the reader DROPS this block (2 != 1) while the census reads zero loss.
        capability = dc.capability_of(self._fixture(2, 1))
        self.assertEqual(capability.short_blocks, 0)
        self.assertEqual(capability.rows, 2)

    def test_a_block_that_lost_its_FOOTER_is_counted_when_its_rows_are_short(self) -> None:
        short = dc.capability_of(self._fixture(1, 2, footer=False))
        self.assertEqual(short.short_blocks, 1)
        # …and NOT counted when it rendered every row it declared: the second difference, which is the
        # shape a file cut between two blocks produces.
        whole = dc.capability_of(self._fixture(2, 2, footer=False))
        self.assertEqual(whole.short_blocks, 0)
        self.assertEqual(whole.rows, 2)

    def test_the_CASE_count_includes_a_block_that_was_short(self) -> None:
        # The derivation that relates the two instruments rather than equating them: the census counts a
        # case for every HEADER, so `cases - short_blocks` is the blocks that rendered their declared
        # rows — which is what the reader keeps, LESS every block it dropped for a reason this cannot
        # see (an over-render, or a lost footer with no row loss).
        capability = dc.capability_of(self._fixture(1, 2) + self._fixture(2, 2).replace(
            'datapack=a_cpu_1', 'datapack=a_cpu_2'
        ))
        self.assertEqual(capability.cases, 2)
        self.assertEqual(capability.short_blocks, 1)
        self.assertEqual(capability.cases - capability.short_blocks, 1)


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

    def test_the_two_families_read_as_the_record_says_and_NEVER_as_each_other(self) -> None:
        # The defect this iteration found, as numbers. The list held the failed-edge SCORE while the COUNT
        # (`edgeRecords`, the one signal the separator verdict reports as holding at AUC 0.908 where the score
        # reads 0.457) had no channel, and the latency COUNT while the RISE — the `lat` term's own input — had
        # none. Both halves could only be named by naming the other half, and the reach returned was that
        # half's: `latEdges` is valued on every row while `latRise` is valued on 52.0% of them.
        capability = self._capability(SHIPPED_FSE26)
        rows = capability.rows
        self.assertEqual(capability.channel('failed-edge-records').reach, dc.EVERY)
        self.assertEqual(capability.channel('failed-edge-records').value_reach, dc.EVERY)
        self.assertEqual(capability.channel('latency-edges').value_reach, dc.EVERY)
        rise = capability.channel('latency-rise')
        self.assertEqual(rise.reach, dc.EVERY)
        self.assertEqual(rise.value_reach, dc.SOME)
        self.assertEqual(rise.rows_valued, 37714)
        self.assertLess(rise.rows_valued * 2, rows * 1.05)

    def test_the_UNLABELLED_series_is_ONE_ROW_PER_CASE_on_the_shipped_artifact(self) -> None:
        # Measured, not asserted from a comment: the id is absent exactly as many times as there are cases, so
        # the row the engine ranks and the parsed count used to drop is a NUMBER here — and `n` is the divisor
        # of every metric term in the case.
        capability = self._capability(SHIPPED_FSE26)
        self.assertEqual(capability.rows - capability.channel('service-id').rows_reached, capability.cases)

    def test_the_inventory_and_the_messages_have_their_own_reaches(self) -> None:
        # The channels the record's own declared signals read, with the reach each was missing: `kept` is drawn
        # on the inventory (10.7% of rows) and the register's matched stratum is 487 of 666 pairs.
        capability = self._capability(SHIPPED_FSE26)
        for name, reached in (('metric-kept', 7781), ('metric-drop', 7781), ('metric-top', 7781)):
            coverage = capability.channel(name)
            self.assertEqual((coverage.reach, coverage.rows_reached), (dc.SOME, reached), name)
        self.assertEqual(capability.channel('metric-list').reach, dc.EVERY)
        self.assertEqual(capability.channel('error-messages').rows_reached, 9313)
        self.assertEqual(capability.channel('exceptions').rows_reached, 3945)

    def test_the_TWO_inventory_families_have_DIFFERENT_reaches_and_the_artifact_says_by_how_much(self) -> None:
        # The four inventory signals read TWO lines, and the lines are not written under the same condition:
        # `metricKept`/`metricDrop` carry the line-level fates, and `metricTop` carries the score decomposition
        # the two maxima (`bestDev`, `bestRise`) are read from. Before this iteration NEITHER line had a
        # channel, so the four signals were one undifferentiated "inventory" whose reach nobody could state.
        #
        # On `re1` the difference is exactly ONE row, and it is a difference in REACH rather than in VALUE:
        # `re1ob_adservice_loss_4`'s `adservice [GT]` renders `metricKept(0):` — the case's own ground truth,
        # every one of whose metrics was dropped as a transient return — and renders no `metricTop` at all. So
        # the competition pair reaches 1888 rows and the decomposition 1887, and the ONE row the two maxima
        # cannot be evaluated on is a row on which `kept` reads a well-defined ZERO. Both halves of that
        # sentence are asserted here, because they are different claims: a reach the producer did not write,
        # and a value it did.
        capability = self._capability(LOCAL_DUMPS / 're1.txt')
        self.assertEqual(capability.rows, 11557)
        for name in ('metric-kept', 'metric-drop'):
            coverage = capability.channel(name)
            self.assertEqual((coverage.rows_reached, coverage.rows_valued), (1888, 1888), name)
        top = capability.channel('metric-top')
        self.assertEqual((top.rows_reached, top.rows_valued), (1887, 1887))
        # The label tag and the inventory are written for the same rows on THIS producer, so the one-row gap is
        # a property of `metricTop` rather than of the selection — which is what makes the attribution above a
        # measurement instead of a guess.
        self.assertEqual(capability.channel('row-labels').rows_reached, 1888)

    def test_a_rendered_COUNT_states_one_on_EVERY_local_artifact(self) -> None:
        # The invariant that makes the two count channels checkable WITHOUT the reader, and the one the
        # placement defect violated: the producer writes the number in the parentheses unconditionally, so a
        # count line that is rendered ALWAYS carries a value. Read as the body beside it, this held on 9
        # readings over 7 artifacts — every one of them a row where the count was zero and the list therefore
        # absent, i.e. exactly the rows on which the channel carries its most definite measurement.
        #
        # The artifacts are named rather than globbed, so a machine with a different set of dumps reports the
        # same population; a missing one skips through `_capability`.
        for path in (
            LOCAL_DUMPS / 're1.txt',
            LOCAL_DUMPS / 're2.txt',
            LOCAL_DUMPS / 're3.txt',
            FSE26_DUMP,
            Path(__file__).resolve().parent.parent / 'artifacts/diag-34684319273/fse26-results.txt',
        ):
            capability = self._capability(path)
            for name in ('metric-kept', 'metric-drop'):
                coverage = capability.channel(name)
                if coverage.reach == dc.NONE:
                    continue
                self.assertEqual(
                    coverage.value_reach, coverage.reach, f'{path.name}: {name} on {coverage.rows_reached} rows'
                )
                self.assertEqual(coverage.rows_valued, coverage.rows_reached, f'{path.name}: {name}')

    def test_the_re1_artifact_is_the_one_that_disagreed_with_the_reader(self) -> None:
        # The measured defect in the one artifact that showed it twice, kept as a reading rather than as a
        # comment: `metric-drop` is rendered on 1888 of re1's rows and every one of them states a count, of
        # which 104 state ZERO. Before the placement was stated, those 104 rows were reported as "rendered and
        # undetermined" — the reading that makes "the guards dropped nothing" indistinguishable from "this
        # block did not say".
        capability = self._capability(LOCAL_DUMPS / 're1.txt')
        drop = capability.channel('metric-drop')
        self.assertEqual(drop.rows_reached, 1888)
        self.assertEqual(drop.rows_valued, 1888)
        self.assertEqual(drop.reach, dc.SOME)
        self.assertEqual(drop.value_reach, dc.SOME)
        # `some` on both counts, so a rule keyed on the VERDICT would have been satisfied either way: the 104
        # rows are visible only in the count, which is why the count is reported at all.
        self.assertIn('metric-drop some (1888/11557 rows)', dc.describe(capability))
        self.assertNotIn('metric-drop some (1888/11557 rows), valued', dc.describe(capability))

    def test_an_artifact_can_carry_ONE_inventory_family_and_not_the_other(self) -> None:
        # The same two lines, one producer generation earlier: `metricKept`/`metricDrop` are rendered for 2095
        # rows and `metricTop` for none of them, so `bestDev`/`bestRise` are UNEVALUABLE on that artifact while
        # `kept`/`transientDrops` are measurable. An inventory reach quoted from the competition line would
        # have been a claim about a decomposition the artifact does not hold.
        older = Path(__file__).resolve().parent.parent / 'artifacts/diag-34684319273/fse26-results.txt'
        capability = self._capability(older)
        self.assertEqual(capability.channel('metric-kept').rows_reached, 2095)
        self.assertEqual(capability.channel('metric-top').reach, dc.NONE)
        self.assertIn('metric-top none', dc.describe(capability))


if __name__ == '__main__':
    unittest.main()
