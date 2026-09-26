"""
Which CHANNELS an artifact carries, and the refusal that a reader has to ask first.

Three iterations in a row found, by hand, the same shape of defect: a number was attributed to an artifact
that cannot hold it. The reader's cell width was modelled on a precision the artifact did not state; a
comparison was run between a subset and its superset; the FSE'26 stability rows belong to a run whose report
holds compositions while the run the record names holds none. Each was repaired where it was found, and each
repair was about one field. What was missing is the question one level up: **what does this artifact carry at
all?**

The answer has three values, not two, and that is the point of this module. A field is rendered for EVERY
row, for SOME of them, or for NONE — and "some" is the case that keeps being read as "every". The decisive
composition's own comment claims it "exists for EVERY service" while the same comment, two sentences later,
admits a service "whose named metric the block did not decompose". Measured with the engine's own parser, it
is present on 86.45% of `re1`'s rows, 90.72% of `re3`'s, and **0.00%** of the FSE'26 artifact's — so the
opening clause is the wrong half, and a signal that has to be simulated over every candidate of a case cannot
be built on that line as it stands.

A count always travels with the population it counts over, so a channel reports BOTH: how many of the
artifact's CASES reach it and how many of its ROWS do. `declared-precision` is a header field and is
therefore scoped to cases alone, which the type says rather than leaving to the reader.

**The census had the defect it exists to catch, and the artifact's own header caught it.** Its first row
grammar required a non-empty service id, which dropped the unlabelled series the engine ranks — 1422 rows on
the FSE'26 artifact, one per case. That error can only run one way: a row that is not counted can never make
a channel look LESS universal, so every `every` was optimistic. The engine's parser had the same defect and
was repaired for the same reason (`services=` disagreed with the parsed count in 1421 of 1422 cases), and the
repair is what this module needed too — plus the check itself: a block that renders fewer rows than the
`services=` it declares is counted and named, because a coverage verdict computed over a short block is an
artifact of the READER and would otherwise travel as a property of the artifact.

**Three more defects of the same family, each found by pointing the census at another artifact.** A channel
RENDERED on every row and UNDETERMINED on some of them is two statements, and folding them into one number
made `onset every` read as "every row carries an onset" while 12.5% of the FSE'26 artifact prints `onset=-`;
the census now reports both numbers, and prints the second only when it differs. A FETCHED artifact carries a
BOM and a timestamp on every line, and every anchor here is `^`, so the fetched FSE'26 report answered
`0 cases, 0 rows` with every channel `none` for a file holding 1422 cases and 71161 compositions — a reading
about the TRANSPORT reported as a property of the artifact, which is the same class of error a probe made
once before; the prefix is stripped now. And the producer prints TWO undetermined markers (`-` and an empty
value), so the capture has to be optional or a row that renders `dominant=` with nothing after it reads as a
row that does not render the channel at all.

**And the census's own population was the next defect of the same class, found by asking the module the one
question it answers.** It reported "every channel" from a hand-written list of seven, while the artifact's
fields are declared exhaustively and TYPE-ENFORCED one module away — `SERVICE_FIELD_AUDIT` is a
`Record<keyof DiagnosedService, string>`, so a new parsed field breaks the build until it is classified — and
the signals that read them carry a `reads:` list naming the field of each. Nothing connected the three. Two
consequences, both measured: the list carried the failed-edge SCORE while the COUNT the record's own
best-holding candidate reads had no channel, and the latency COUNT while the RISE the `lat` term reads had
none — the two families covered in OPPOSITE halves, so a candidate reading either half of either had to name
the other half's channel and was told the other half's reach (100% where the rise is valued on 52.0% of the
shipped rows); and six quantities the declared signals read had no channel at all. The population is now a
table of {@link DECLARATIONS} whose every entry names the producer's own KEY LITERAL, with the marker DERIVED
from it so the declaration and the matcher cannot drift apart again.

@module scripts/dump_capability
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: A case's block starts here. The header carries the case's own fields, `services=` among them.
CASE_HEADER = re.compile(r'^DIAG datapack=(\S+)(.*)$')
#: The transport prefix a FETCHED artifact carries on every line: a byte-order mark and/or an ISO timestamp
#: followed by EXACTLY one space — the producer's own indentation starts after it, and a pattern that consumed
#: the run of spaces would turn a two-space service row into a line that starts a row nowhere. A reader that
#: does not strip it measures the TRANSPORT: a count of lines that START with a literal is 0 across a whole
#: artifact, which is how a probe once reported `metricDecisive lines: 0` for a file holding **71161** of
#: them, and how this census answered `0 cases, 0 rows` (every channel `none`) for
#: `artifacts/r35107871516/fse26-results.txt`, which holds 1422 cases.
TRANSPORT = re.compile(r'^\ufeff?(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?')

#: A service row. Three shapes are legal and all three are candidates: a named row (`  adservice [#1]`), the
#: unlabelled series the block still ranks (`   [#4]`), and the unlabelled row it does not (`   ` alone). A
#: reader requiring a non-empty id drops the last two — which is what the engine's own parser once did, and
#: what made its parsed count disagree with the header in 1421 of 1422 cases, unchecked.
SERVICE_ROW = re.compile(r'^ {2,3}(?:(?P<id>\S+) +)?(?P<marker>\[[^]]*\])? *selfAnomaly=')

#: The row's IDENTITY, which is not a `key=value` field and therefore takes a pattern of its own. Two
#: channels read it: the id (which the unlabelled series does NOT have — one row per case, 1422 of them on the
#: FSE'26 artifact, and dropping them from the engine changes `n` and therefore every metric term in the case)
#: and the `[...]` label tag (`GT` and `#n`). The id pattern requires the first token to be a NON-BRACKET, and
#: that is what tells `  adservice [#1]` apart from `   [#4]`: the producer writes `${id}${tag}` and the tag
#: is the bracketed one, so a row that starts with a bracket has no id.
ROW_IDENTITY_PATTERNS: dict[str, str] = {
    'service-id': r'^ {2,3}([^\[\s]\S*)(?: +\[[^\]]*\])? +selfAnomaly=',
    'row-labels': r'^ {2,3}(?:\S+ )?\[([^\]]*)\]',
}

#: The scopes a field of the artifact can be carried at. `row` and `header` are `<key>=<value>`; `case-line`
#: is a two-space line of its own inside the case; `sub-line` is a four-space line belonging to the row above
#: it; `row-identity` is the id and the label tag, which have no key at all.
ROW = 'row'
CASE_LINE = 'case-line'
HEADER = 'header'
SUB_LINE = 'sub-line'
ROW_IDENTITY = 'row-identity'
SCOPES: tuple[str, ...] = (ROW, ROW_IDENTITY, CASE_LINE, HEADER, SUB_LINE)

#: The scopes whose population is a CASE's, not a row's.
CASE_SCOPES: frozenset[str] = frozenset({HEADER, CASE_LINE})


@dataclass(frozen=True)
class ChannelDeclaration:
    """
    One field of the artifact, declared once, with the producer's own literal as the connection.

    **Why this is a table and not four tuples.** The census's population used to be a hand-written list of
    seven names, and each name was paired with a hand-written regex. Nothing connected either half to the
    artifact: the list was a claim about what the dump carries and the regexes were a second claim about how
    it prints them. Both were wrong — for `latEdges` and not `latRise`, for `failedEdge` and not
    `failedEdgeRecords` — and the two errors were in OPPOSITE halves of the same two families, so a candidate
    reading either half of either family had to name the other half's channel and was told the other half's
    reach. `key` is the producer's literal and `marker` is DERIVED from it, so the name and the matcher cannot
    drift apart again; `fields` names the parsed field this line carries, which is what connects the census to
    the reader that declares its own field list (`SERVICE_FIELD_AUDIT`, a `Record<keyof DiagnosedService, str>`).

    @field channel - The census's name for the field, stable across reports.
    @field scope - A member of {@link SCOPES}.
    @field key - The producer's KEY LITERAL (`failedEdgeRecords`), or `None` for {@link ROW_IDENTITY}, whose
        pattern is `key`-less and declared in {@link ROW_IDENTITY_PATTERNS}.
    @field fields - The parsed field name(s) this line carries, from `DiagnosedService` / `DiagnosedCase`, or
        `()` for a line no reader parses. Every `keyof DiagnosedService` must appear exactly once across the
        table, which is what the TypeScript fence asserts.
    @field value - The value's own pattern, so a field the reader requires to be a NUMBER cannot be counted as
        carried when it prints something else (`decimals=abc` fails the reader's `HEADER_RE` outright).
    @field why - Which half of which family it is, and who reads it. The reason is the deliverable: "nobody
        screens this" and "this was screened and closed" are different statements.
    """

    channel: str
    scope: str
    key: str | None
    fields: tuple[str, ...]
    why: str
    value: str = r'\S*'

    @property
    def marker(self) -> re.Pattern[str]:
        """The pattern that finds this field, DERIVED from {@link key} so the two cannot disagree."""
        if self.scope == ROW_IDENTITY:
            assert self.key is None, 'a row-identity channel has no key literal'
            return re.compile(ROW_IDENTITY_PATTERNS[self.channel])
        assert self.key is not None, f'{self.channel} needs a key literal'
        escaped = re.escape(self.key)
        if self.scope == SUB_LINE:
            # `metricKept(38): …` and `metricDecisive: …` are one grammar: an optional parenthesised count,
            # then a colon. Anchored at exactly four spaces because that IS the producer's indentation —
            # measured over 1,162,386 sub-lines in the local artifacts, every one of them at four.
            return re.compile(rf'^ {{4}}{escaped}(?:\([^)]*\))?: ?({self.value})$')
        if self.scope == CASE_LINE:
            return re.compile(rf'^ {{2}}{escaped}=({self.value})$')
        return re.compile(rf'\b{escaped}=({self.value})')


#: EVERY field the artifact carries, one row per field. Ordered as the report prints them: the identity, then
#: the case's own fields, then the row's, then the sub-lines — so a reader can find the family it cares about.
#:
#: The `fields` column is the connection to the READER's declaration: `SERVICE_FIELD_AUDIT` is typed
#: `Record<keyof DiagnosedService, string>`, so adding a field to the parsed row breaks the build until it is
#: classified there — and the fence added with this table asserts that the census's declared fields EQUAL that
#: map's keys, in both directions. Before it, six quantities the record's own declared signals read
#: (`failedEdgeRecords`, `latRise`, `metricKept`, `metrics`, `err`/`fatal`, `logic`/`http`) had no channel at
#: all, so the gate "name the channels you read and the reach you need of each" could not be satisfied by the
#: candidates the record says are live.
DECLARATIONS: tuple[ChannelDeclaration, ...] = (
    # ── the row's identity: not a field, and the reach is the finding ──
    ChannelDeclaration(
        'service-id',
        ROW_IDENTITY,
        None,
        ('serviceId',),
        'the row\'s own name; the unlabelled series has NONE (one row per case), and `n` is the divisor of '
        'every metric term, so a reader that drops those rows computes a different term for every service',
    ),
    ChannelDeclaration(
        'row-labels',
        ROW_IDENTITY,
        None,
        ('isGroundTruth', 'predictedRank'),
        'the `[...]` tag: `GT` for the case\'s ground truth, `#n` for the engine\'s own rank. A row carrying '
        'no tag is a service the engine neither predicted nor labelled, which is a count this artifact states',
    ),
    # ── the case's fields ──
    ChannelDeclaration(
        'datapack',
        HEADER,
        'datapack',
        ('datapack',),
        'the case\'s identity, and the block\'s grammar requires it, so its reach is `every` by construction',
    ),
    ChannelDeclaration(
        'fault-type',
        HEADER,
        'faultType',
        ('faultType',),
        'the unit that can regress, and the unit every per-type reading is grouped by',
    ),
    ChannelDeclaration(
        'ground-truth',
        HEADER,
        'GT',
        ('groundTruth',),
        'the answer every verdict is computed against',
    ),
    ChannelDeclaration(
        'services-declared',
        HEADER,
        'services',
        ('services',),
        'the row population the block CLAIMS, which is what the parser can be caught disagreeing with',
        value=r'\d+',
    ),
    ChannelDeclaration(
        'log-mode',
        HEADER,
        'logMode',
        ('logSignalMode',),
        'the log gate the block was produced under; two runs of one case differ by it',
    ),
    ChannelDeclaration(
        'inject-time',
        HEADER,
        'inject',
        ('injectTimeMs',),
        'the anchor every `onset` delay is measured from — the dump\'s only TIME, and OPTIONAL, so a block '
        'without it states delays that cannot be turned into a delay at all',
        value=r'\d+',
    ),
    ChannelDeclaration(
        'declared-precision',
        HEADER,
        'decimals',
        ('fieldDecimals',),
        'the render precision, and the field most often reached for as a constant instead; the value pattern '
        'requires digits because the reader\'s own `HEADER_RE` fails outright on anything else',
        value=r'\d+',
    ),
    ChannelDeclaration(
        'failed-edge-graph',
        CASE_LINE,
        'edges',
        ('edges',),
        'the case\'s failed-edge topology, which the two topology signals (`inDegree`, `reaches`) read; '
        'optional, so a block without it answers `none` rather than an empty graph',
        value=r'.*',
    ),
    ChannelDeclaration(
        'prediction',
        CASE_LINE,
        'prediction',
        ('prediction',),
        'the engine\'s own ranking for the case — the line a reconstruction is checked against, case for case',
        value=r'.*',
    ),
    # ── the row's fields ──
    ChannelDeclaration(
        'self-anomaly',
        ROW,
        'selfAnomaly',
        ('selfAnomaly',),
        'the metric term\'s input, read by the `metric` scalar (a term, so never a candidate)',
    ),
    ChannelDeclaration(
        'log-score',
        ROW,
        'logScore',
        ('logScore',),
        'the log term\'s input, read by the `log` scalar',
    ),
    ChannelDeclaration(
        'failed-edge',
        ROW,
        'failedEdge',
        ('failedEdgeScore',),
        'the failed-edge SCORE — the engine\'s term, read by `failedEdge`. The VOLUME behind it is a separate '
        'field ({@link DECLARATIONS} `failed-edge-records`), and the register\'s sentence about per-edge '
        'counts is true of this one and false of that one',
    ),
    ChannelDeclaration(
        'failed-edge-records',
        ROW,
        'failedEdgeRecords',
        ('failedEdgeRecords',),
        'the failed-edge RECORD COUNT — the quantity `edgeRecords` reads, and the one signal the separator '
        'verdict reports as holding (AUC 0.908 on replace-code) where the SCORE above does not (0.457)',
    ),
    ChannelDeclaration(
        'latency-rise',
        ROW,
        'latRise',
        ('latRise',),
        'the inbound latency RISE — the `lat` term\'s input, and the half of its family the census used to '
        'omit while carrying the other half\'s reach',
    ),
    ChannelDeclaration(
        'latency-edges',
        ROW,
        'latEdges',
        ('latEdges',),
        'the measured inbound EDGE COUNT — the quantity `inLatEdges` reads, and the half whose reach the '
        'census used to report for the rise above',
    ),
    ChannelDeclaration(
        'dominant-metric',
        ROW,
        'dominant',
        ('dominantMetric',),
        'the metric that drove the score; the four `decisive*` scalars read it as the SELECTOR of which '
        'rendered decomposition is the decisive one',
    ),
    ChannelDeclaration(
        'error-count',
        ROW,
        'err',
        ('errorCount',),
        'the ERROR line count — half of `errLines`, whose sum is `error-count + fatal-count`',
    ),
    ChannelDeclaration(
        'fatal-count',
        ROW,
        'fatal',
        ('fatalCount',),
        'the FATAL line count — the other half of `errLines`',
    ),
    ChannelDeclaration(
        'logic-count',
        ROW,
        'logic',
        ('logicExceptionCount',),
        'the logic-signature line count — one half of `sigLines`',
    ),
    ChannelDeclaration(
        'http-count',
        ROW,
        'http',
        ('httpExceptionCount',),
        'the HTTP-signature line count, the other half of `sigLines`; `sigLines` is their UNION with the '
        'overlap below subtracted, and dividing by their SUM is a different quantity',
    ),
    ChannelDeclaration(
        'signature-overlap',
        ROW,
        'both',
        ('bothExceptionCount',),
        'how many lines carry BOTH signature flags — the term that makes `sigLines` a union rather than a sum',
    ),
    ChannelDeclaration(
        'onset',
        ROW,
        'onset',
        ('onsetDelayMs',),
        'the delay after injection — the dump\'s only TIME, read by the `onset` scalar and by `temporal` '
        'through the engine\'s own slope map',
    ),
    # ── the sub-lines, each belonging to the row above it ──
    ChannelDeclaration(
        'metric-list',
        SUB_LINE,
        'metrics',
        (),
        'the metric NAME list and its declared size. RENDERED ON EVERY ROW AND PARSED BY NO READER — the '
        'reader\'s inventory comes from the three lines below — so a truncation check built on it would be '
        'the first thing to read it',
        value=r'.*',
    ),
    ChannelDeclaration(
        'decisive-composition',
        SUB_LINE,
        'metricDecisive',
        ('decisiveOutcome',),
        'the composition of the metric that drove the score, read by the four `decisive*` scalars; rendered '
        'with a `-` where the named metric carries none, so its channel reach and its VALUE reach differ',
    ),
    ChannelDeclaration(
        'error-messages',
        SUB_LINE,
        'ERR',
        (),
        'the ERROR/FATAL message lines. RENDERED AND PARSED BY NOBODY — the counts on the row are what the '
        '`errLines` scalar reads — so this is the channel a message-level candidate would have to start from',
        value=r'.*',
    ),
    ChannelDeclaration(
        'exceptions',
        SUB_LINE,
        'exc',
        (),
        'the exception CLASS labels for the row. RENDERED AND PARSED BY NOBODY: the signatures the log term '
        'gates on are counted on the row, and the label vocabulary is a different axis',
        value=r'.*',
    ),
    ChannelDeclaration(
        'metric-kept',
        SUB_LINE,
        'metricKept',
        ('metricOutcomes',),
        'the metrics the guards KEPT — the inventory `kept` reads, and the matched stratum the register\'s '
        '`kept<=` confound check is drawn on',
        value=r'.*',
    ),
    ChannelDeclaration(
        'metric-drop',
        SUB_LINE,
        'metricDrop',
        ('metricOutcomes',),
        'the metrics the guards dropped, with their reason — the inventory `transientDrops` reads',
        value=r'.*',
    ),
    ChannelDeclaration(
        'metric-top',
        SUB_LINE,
        'metricTop',
        ('metricOutcomes',),
        'the score DECOMPOSITION of the top metrics — the inventory `bestDev` and `bestRise` read, and the '
        'only place the breakdown\'s eight numbers are rendered',
        value=r'.*',
    ),
)

#: Every channel, in the order the report prints them.
CHANNELS: tuple[str, ...] = tuple(declaration.channel for declaration in DECLARATIONS)

#: The channels that are a property of a CASE rather than of a row — a header field has no rows to be absent
#: from, and reporting a row count for it would invent a frontier it does not have.
CASE_SCOPED: frozenset[str] = frozenset(
    declaration.channel for declaration in DECLARATIONS if declaration.scope in CASE_SCOPES
)

#: The channels that carry a rendered line but NO parsed field: three lines the producer writes and no reader
#: parses. They are channels — the census reports what the artifact CARRIES — and their exclusion from the
#: field equality is DERIVED from the table rather than listed separately, so a channel cannot end up excluded
#: by being forgotten.
NO_FIELD_CHANNELS: frozenset[str] = frozenset(d.channel for d in DECLARATIONS if not d.fields)

#: Markers grouped by scope, so the scanner does not ask the table a question per line per channel.
ROW_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (d.channel, d.marker) for d in DECLARATIONS if d.scope == ROW
)
ROW_IDENTITY_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (d.channel, d.marker) for d in DECLARATIONS if d.scope == ROW_IDENTITY
)
CASE_LINE_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (d.channel, d.marker) for d in DECLARATIONS if d.scope == CASE_LINE
)
HEADER_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (d.channel, d.marker) for d in DECLARATIONS if d.scope == HEADER
)
SUB_LINE_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (d.channel, d.marker) for d in DECLARATIONS if d.scope == SUB_LINE
)

#: How many rows the block SAYS it has, taken from the `services-declared` declaration so the key literal has
#: one owner. A census that counts rows must be able to disagree with it, because a parser that drops a row
#: silently reports a smaller population as if it were the whole one.
SERVICES_DECLARED = re.compile(
    r'\b'
    + re.escape(next(d.key for d in DECLARATIONS if d.channel == 'services-declared') or '')
    + r'=(\d+)'
)

#: How far a channel reaches. `some` is the value this module exists for: a field rendered for the ground
#: truth and the engine's predictions but not for the bystanders looks exactly like a field rendered for all.
EVERY = 'every'
SOME = 'some'
NONE = 'none'


class CapabilityError(RuntimeError):
    """An artifact was asked for a channel it does not carry far enough."""


def isValued(value: str) -> bool:
    """
    Whether a marker's captured value is a VALUE rather than one of the block's two undetermined markers.

    Both `-` (`onset=-`, and now `metricDecisive: -`) and an EMPTY value (`dominant= err=0`) mean "rendered
    and undetermined", so neither counts towards a channel's valued reach.

    @param value - The captured text after the marker.
    @returns: `True` when the marker carries a value.
    """
    return value not in ('', '-')


def strip_transport(line: str) -> str:
    """
    Remove the byte-order mark and timestamp a FETCHED artifact carries in front of every line.

    The block's grammar is anchored (`^DIAG`, `^ {2}`), so a prefixed artifact reads as zero cases unless the
    prefix goes first — and zero cases is indistinguishable, in the output, from an artifact that renders
    nothing. The engine's own reader strips the same prefix for the same reason.

    @param line - One line, as it came off the transport.
    @returns: The line as the producer wrote it.
    """
    return TRANSPORT.sub('', line)


@dataclass(frozen=True)
class ChannelCoverage:
    """
    How far one channel reaches, over BOTH populations the artifact has — and how far it carries a VALUE.

    `rows_reached` is `None` for a case-scoped channel, which is not the same as zero rows carrying it: the
    question does not apply, and a reader that conflated the two would report a header field as missing from
    every row of every case.

    `*_valued` counts the rows whose marker carries a value rather than the producer's `-`. The two are
    different statements and this module folded them together until it was measured: `onset every` read as
    "every row carries an onset" while 12.5% of the shipped FSE'26 artifact's rows print `onset=-`.
    """

    channel: str
    cases_reached: int
    total_cases: int
    rows_reached: int | None
    total_rows: int
    cases_valued: int = 0
    rows_valued: int | None = None

    @property
    def reach(self) -> str:
        """
        `every` / `some` / `none`, judged on the population the channel is scoped to.

        `none` means the artifact NEVER RENDERS the channel — no case reaches it — which is a different
        statement from "it reaches no row". A channel is rendered per case, and a block may print one outside
        any row (a sub-line whose subject the parser could not attribute): the artifact carries it, the rows do
        not, and calling that `none` would report a producer's gap where there is a rendering shape.

        **Two clauses here are load-bearing and each was added after a measurement.**

        1. For a ROW-scoped channel, `none` requires the row count to be zero TOO. The first version asked
           only the case count, which was a proxy that agreed with every channel the census then had — each
           one also set a case flag — and stopped agreeing the moment two channels were added that do not.
           It answered `none` for a channel **71105 of 72527 rows carry**. The scanner now credits the case
           for those two as well (a channel's case count and its row count are different claims and both are
           reported), and this clause means the verdict no longer DEPENDS on that.
        2. `total_rows == 0` is `none` even when a case reached the channel, because `0 == 0` satisfies
           `reached == total` and the vacuous reading is `every`. An artifact with no rows can answer
           "every row carries it" about nothing at all.
        """
        if self.channel in CASE_SCOPED:
            if self.cases_reached == 0:
                return NONE
            return EVERY if self.cases_reached == self.total_cases else SOME
        if self.rows_reached == 0 and self.cases_reached == 0:
            return NONE
        if self.total_rows == 0:
            return NONE
        if self.rows_reached == self.total_rows:
            return EVERY
        return SOME

    @property
    def value_reach(self) -> str:
        """The same three values for the VALUE, so a universal channel with holes cannot read as complete."""
        if self.channel in CASE_SCOPED:
            if self.cases_valued == 0:
                return NONE
            return EVERY if self.cases_valued == self.total_cases else SOME
        if self.rows_valued == 0 and self.cases_valued == 0:
            return NONE
        if self.total_rows == 0:
            return NONE
        if self.rows_valued == self.total_rows:
            return EVERY
        return SOME


@dataclass(frozen=True)
class DumpCapability:
    """What an artifact can be ASKED, and how much of it answers."""

    cases: int
    rows: int
    by_channel: tuple[ChannelCoverage, ...]
    short_blocks: int = 0
    """
    Blocks whose parsed row count is BELOW the `services=` they declare.

    Not a detail: the coverage verdicts below are computed over the rows that were parsed, so a block the
    parser read short is a block whose `every` may be an artifact of the parser. There is no surplus
    direction — a block cannot render more rows than it declares — so this is the only count that matters.
    """

    def channel(self, name: str) -> ChannelCoverage:
        """
        One channel's coverage.

        @param name - A member of {@link CHANNELS}.
        @returns: Its coverage.
        @raises KeyError: If the name is not a channel, so that a typo cannot read as "not carried".
        """
        for one in self.by_channel:
            if one.channel == name:
                return one
        raise KeyError(name)


def capability_of(text: str) -> DumpCapability:
    """
    Read an artifact's channel coverage out of its own text.

    @param text - The dump, as written (a transport prefix per line is tolerated: the markers are searched
        for, not anchored, except where the block's indentation is the structure).
    @returns: Its case and row counts, and one coverage entry per channel in {@link CHANNELS}.
    """
    cases = 0
    rows = 0
    short_blocks = 0
    declared_rows = 0
    rows_in_case = 0
    case_reached: dict[str, int] = dict.fromkeys(CHANNELS, 0)
    row_reached: dict[str, int] = dict.fromkeys(CHANNELS, 0)
    case_valued: dict[str, int] = dict.fromkeys(CHANNELS, 0)
    row_valued: dict[str, int] = dict.fromkeys(CHANNELS, 0)
    case_open: dict[str, bool] = dict.fromkeys(CHANNELS, False)
    row_open: dict[str, bool] = dict.fromkeys(CHANNELS, False)
    case_valued_open: dict[str, bool] = dict.fromkeys(CHANNELS, False)
    row_valued_open: dict[str, bool] = dict.fromkeys(CHANNELS, False)
    in_case = False
    in_row = False

    def close_row() -> None:
        """Attribute the flags accumulated since the last service row to that row."""
        nonlocal in_row
        if not in_row:
            return
        for name in CHANNELS:
            if row_open[name]:
                row_reached[name] += 1
            if row_valued_open[name]:
                row_valued[name] += 1
        in_row = False

    def close_case(parsed_rows: int, declared: int) -> None:
        """
        Attribute the flags accumulated since the last case header to that case, and check its own count.

        @param parsed_rows - The rows this reader found in the block.
        @param declared - The `services=` the block carries, or 0 when it declares none.
        """
        nonlocal in_case, short_blocks
        if not in_case:
            return
        close_row()
        if declared and parsed_rows < declared:
            short_blocks += 1
        for name in CHANNELS:
            if case_open[name]:
                case_reached[name] += 1
            if case_valued_open[name]:
                case_valued[name] += 1
        in_case = False

    for raw in text.splitlines():
        # The transport first: every anchor below is `^`, so an unstripped prefix makes this reader report an
        # artifact with zero cases — a reading about the fetch reported as a property of the artifact.
        line = strip_transport(raw)
        header = CASE_HEADER.match(line)
        if header is not None:
            close_case(rows_in_case, declared_rows)
            cases += 1
            in_case = True
            rows_in_case = 0
            declared = SERVICES_DECLARED.search(line)
            declared_rows = int(declared.group(1)) if declared is not None else 0
            case_open = dict.fromkeys(CHANNELS, False)
            row_open = dict.fromkeys(CHANNELS, False)
            case_valued_open = dict.fromkeys(CHANNELS, False)
            row_valued_open = dict.fromkeys(CHANNELS, False)
            # The header's own fields, over the WHOLE line rather than the part after `datapack=`: the
            # grammar's first field is a channel of the case like any other, and searching only the tail
            # would report the one field the block cannot be a block without as the one it never carries.
            for name, marker in HEADER_MARKERS:
                found = marker.search(line)
                if found is None:
                    continue
                case_open[name] = True
                if isValued(found.group(1)):
                    case_valued_open[name] = True
            continue
        if not in_case:
            continue
        row = SERVICE_ROW.match(line)
        if row is not None:
            close_row()
            rows += 1
            rows_in_case += 1
            in_row = True
            row_open = dict.fromkeys(CHANNELS, False)
            row_valued_open = dict.fromkeys(CHANNELS, False)
            for name, marker in ROW_MARKERS:
                found = marker.search(line)
                if found is None:
                    continue
                row_open[name] = True
                case_open[name] = True
                if isValued(found.group(1)):
                    row_valued_open[name] = True
                    case_valued_open[name] = True
            # The row's identity is not a `key=value` field, so it has its own two patterns. Both are
            # ROW-scoped, and both credit the CASE like every other row marker does: a channel's case count and
            # its row count are different claims — "some case renders this" against "some row carries it" —
            # and the census reports both. Crediting only the row made these two the one pair whose case count
            # was a structural zero, which is what a `reach` that read the case count turned into `none`.
            for name, marker in ROW_IDENTITY_MARKERS:
                found = marker.search(line)
                if found is None:
                    continue
                row_open[name] = True
                case_open[name] = True
                if isValued(found.group(1)):
                    row_valued_open[name] = True
                    case_valued_open[name] = True
            continue
        # A two-space line that is not a row is a CASE-level field (`edges=`, `prediction=`), and it is
        # scoped to the case because there is one of it per block rather than one per service.
        for name, marker in CASE_LINE_MARKERS:
            found = marker.search(line)
            if found is not None:
                case_open[name] = True
                if isValued(found.group(1)):
                    case_valued_open[name] = True
                break
        else:
            for name, marker in SUB_LINE_MARKERS:
                found = marker.search(line)
                if found is not None:
                    case_open[name] = True
                    if isValued(found.group(1)):
                        case_valued_open[name] = True
                    if in_row:
                        row_open[name] = True
                        if isValued(found.group(1)):
                            row_valued_open[name] = True
                    break
    close_case(rows_in_case, declared_rows)

    by_channel = tuple(
        ChannelCoverage(
            channel=name,
            cases_reached=case_reached[name],
            total_cases=cases,
            rows_reached=None if name in CASE_SCOPED else row_reached[name],
            total_rows=rows,
            cases_valued=case_valued[name],
            rows_valued=None if name in CASE_SCOPED else row_valued[name],
        )
        for name in CHANNELS
    )
    return DumpCapability(cases, rows, by_channel, short_blocks)


def declarations_as_data() -> list[dict[str, Any]]:
    """
    The table as DATA — the projection the TypeScript fence reads, kept equal to it by a test rather than by
    care.

    **Why a projection at all.** The fence that finds this class of defect can only be written where the
    producer is, and the producer is TypeScript: it builds the artifact and holds the typed field map
    (`SERVICE_FIELD_AUDIT`, a `Record<keyof DiagnosedService, string>`). For the two sides to be compared, this
    table's three mechanical columns have to be readable there. Parsing the module's source text would make the
    fence depend on its FORMATTING — a fence that can be disarmed by reindenting the thing it guards — so the
    projection is written to a file that both sides read, and a test asserts it equals this table in both
    directions. The `why` prose stays here: a reason is for a reader, and a fence needs a column.

    @returns: One entry per declaration, in table order: `channel`, `scope`, `key` (`None` for the row's
        identity) and `fields`.
    """
    return [
        {
            'channel': declaration.channel,
            'scope': declaration.scope,
            'key': declaration.key,
            'fields': list(declaration.fields),
        }
        for declaration in DECLARATIONS
    ]


def format_declarations_json() -> str:
    """
    {@link declarations_as_data} as the committed file's own bytes.

    **ONE CHANNEL PER LINE**, framed here instead of by `json.dumps(indent=…)`: the file's purpose is to be
    diffed when a field is added, and a pretty-printer that puts a five-element `fields` array on five lines
    turns a one-channel change into a fifteen-line diff. Each entry is still serialised by `json.dumps`, so
    the escaping is not hand-rolled; only the array's framing is, and it is newline-terminated so the file
    ends the way every other file in the tree does.

    @returns: The JSON text, one object per line, newline-terminated.
    """
    entries = declarations_as_data()
    if not entries:
        return '[]\n'
    return '[\n' + ',\n'.join(f'  {json.dumps(entry)}' for entry in entries) + '\n]\n'


def describe(capability: DumpCapability) -> str:
    """
    One line a report can print so an artifact's reach travels with any number read from it.

    A channel at `SOME` prints BOTH of its numbers, because "some" without a denominator is the reading this
    module exists to stop: `decisive-composition some (9991/11557 rows)` is a different claim from
    `decisive-composition every`.

    @param capability - The artifact's coverage.
    @returns: `1422 cases, 72527 rows; decisive-composition none; onset every; …`, with a block count first
        when any block was parsed short of what it declares — an `every` computed over a short block is an
        artifact of the parser, and it would otherwise travel as a property of the artifact.
    """
    parts: list[str] = []
    for one in capability.by_channel:
        if one.reach == EVERY:
            parts.append(f'{one.channel} every')
        elif one.reach == NONE:
            parts.append(f'{one.channel} none')
        elif one.channel in CASE_SCOPED:
            parts.append(f'{one.channel} some ({one.cases_reached}/{one.total_cases} cases)')
        else:
            parts.append(f'{one.channel} some ({one.rows_reached}/{one.total_rows} rows)')
        # The VALUE travels beside the rendering whenever the two COUNTS differ, which is not the same
        # condition as the two verdicts differing. `metric-kept` on the re1 artifact reaches 1888 of 11557
        # rows and carries a body on 1887: one row prints `metricKept(0):` with nothing after the colon,
        # because every metric of that service — the case's own ground truth — was dropped as a transient
        # return. Both verdicts read `some`, so a rule that printed the second number only when the VERDICTS
        # differed would hide the one row a candidate on that channel cannot be evaluated on, which is the
        # reading this module exists to stop one level down. Only a ROW-scoped channel can say this: a header
        # field IS a value (`decimals=N`), so the two counts cannot differ there and a branch for it would be
        # unreachable code pretending to be coverage.
        if one.rows_valued is not None and one.rows_valued != one.rows_reached:
            parts[-1] += f', valued {one.rows_valued}/{one.total_rows} rows'
    scope = (
        f'{capability.cases} cases, {capability.rows} rows'
        if capability.short_blocks == 0
        else f'{capability.cases} cases, {capability.rows} rows '
        f'({capability.short_blocks} parsed short of their own services=)'
    )
    return f'{scope}; ' + '; '.join(parts)


def require_channel(
    capability: DumpCapability,
    channel: str,
    *,
    name: str,
    reader: str,
    reach: str = EVERY,
) -> None:
    """
    Refuse a read the artifact cannot serve, before any number is attributed to it.

    The requirement is stated, not inferred: a reader that SUMS a channel over every candidate a case could
    promote needs `every`, while a reader that only asks whether the artifact has the channel at all needs
    `some`. Both are legal questions and they are different, so the caller says which one it is and the
    refusal names it.

    @param capability - The artifact's coverage.
    @param channel - The channel the reader is about to read.
    @param name - How to name the artifact in the refusal.
    @param reader - What is doing the reading, so the message says which code has to change.
    @param reach - The reach required: {@link EVERY} or {@link SOME}.
    @raises CapabilityError: If the channel reaches less far than required.
    """
    if reach not in (EVERY, SOME):
        raise ValueError(f'reach must be {EVERY!r} or {SOME!r}, not {reach!r}')
    measured = capability.channel(channel)
    order = {NONE: 0, SOME: 1, EVERY: 2}
    if order[measured.reach] >= order[reach]:
        return
    scope = 'cases' if channel in CASE_SCOPED else 'rows'
    reached = measured.cases_reached if channel in CASE_SCOPED else measured.rows_reached
    total = measured.total_cases if channel in CASE_SCOPED else measured.total_rows
    raise CapabilityError(
        f'{name} cannot answer {reader}: {channel} reaches {measured.reach} of its {scope} '
        f'({reached}/{total}) and the reader requires {reach} — read the channel that does reach, or measure '
        f'it on an artifact that carries it'
    )


#: The committed projection the TypeScript fence reads. Named here so the regeneration command and the test
#: that keeps it equal to the table cannot spell the path two different ways.
DECLARATIONS_PATH = Path(__file__).resolve().parent / 'dump_capability.channels.json'


def main(argv: list[str] | None = None) -> int:
    """
    The one command this module has: print the channel table, so a fence in another language can read it.

    The output goes to STDOUT and the test that compares it against the committed file reads that file, so
    regeneration is `python3 scripts/dump_capability.py --channels > scripts/dump_capability.channels.json`
    — a command a failure message can name rather than a step someone has to remember.

    @param argv - The command line, `sys.argv[1:]` by default.
    @returns: 0 on success, 2 when the request is not understood.
    """
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0] if __doc__ else None)
    parser.add_argument(
        '--channels',
        action='store_true',
        help='Print the channel table as JSON, one channel per line.',
    )
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    if not args.channels:
        parser.error('pass --channels')
    sys.stdout.write(format_declarations_json())
    return 0


if __name__ == '__main__':
    sys.exit(main())
