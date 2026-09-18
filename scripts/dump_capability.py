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

@module scripts/dump_capability
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: A case's block starts here. The header carries `services=`, and `decimals=` when the producer declares
#: its render precision — a case-level property, not a row's.
CASE_HEADER = re.compile(r'^DIAG datapack=(\S+)(.*)$')
DECLARED_PRECISION = re.compile(r'\bdecimals=\d+\b')
#: The transport prefix a FETCHED artifact carries on every line: a byte-order mark and/or an ISO timestamp
#: followed by EXACTLY one space — the producer's own indentation starts after it, and a pattern that consumed
#: the run of spaces would turn a two-space service row into a line that starts a row nowhere. A reader that
#: does not strip it measures the TRANSPORT: a count of lines that START with a literal is 0 across a whole
#: artifact, which is how a probe once reported `metricDecisive lines: 0` for a file holding **71161** of
#: them, and how this census answered `0 cases, 0 rows` (every channel `none`) for
#: `artifacts/r35107871516/fse26-results.txt`, which holds 1422 cases.
TRANSPORT = re.compile(r'^\ufeff?(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?')
#: How many rows the block SAYS it has. A census that counts rows must be able to disagree with it, because
#: a parser that drops a row silently reports a smaller population as if it were the whole one.
SERVICES_DECLARED = re.compile(r'\bservices=(\d+)\b')

#: A service row. Three shapes are legal and all three are candidates: a named row (`  adservice [#1]`), the
#: unlabelled series the block still ranks (`   [#4]`), and the unlabelled row it does not (`   ` alone). A
#: reader requiring a non-empty id drops the last two — which is what the engine's own parser once did, and
#: what made its parsed count disagree with the header in 1421 of 1422 cases, unchecked.
SERVICE_ROW = re.compile(r'^ {2,3}(?:(?P<id>\S+) +)?(?P<marker>\[[^]]*\])? *selfAnomaly=')

#: Row-level channel markers: they sit on the service row itself. The captured group is the VALUE, and it is
#: OPTIONAL (`\S*`) because the block has two ways of saying "rendered and undetermined": the `-` marker
#: (`onset=-`, `latRise=-`) and an EMPTY value (`dominant= err=0`, which is how a row with no named metric
#: prints). A channel that is RENDERED on every row and UNDETERMINED on some of them is two different
#: statements, and folding them into one number is how `onset every` came to read as "every row carries an
#: onset" when 12.5% of the shipped artifact's rows print `onset=-`.
DASH = ''

ROW_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ('onset', re.compile(r'\bonset=(\S*)')),
    ('latency-edges', re.compile(r'\blatEdges=(\S*)')),
    ('failed-edge', re.compile(r'\bfailedEdge=(\S*)')),
    ('dominant-metric', re.compile(r'\bdominant=(\S*)')),
    ('signature-overlap', re.compile(r'\bboth=(\S*)')),
)

#: Sub-line channel markers: they belong to the service row that PRECEDES them, so the census has to follow
#: the block's structure rather than count lines. `metricDecisive` is the one that matters — it is the
#: metric-decomposition channel a per-candidate simulation would have to read.
SUB_LINE_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ('decisive-composition', re.compile(r'^\s+metricDecisive: ?(\S*)')),
)

#: Every channel, in the order the report prints them: the two that were measured to be missing somewhere
#: first, then the row-level ones the dumps have always carried.
CHANNELS: tuple[str, ...] = (
    'declared-precision',
    'decisive-composition',
    'signature-overlap',
    'onset',
    'latency-edges',
    'failed-edge',
    'dominant-metric',
)

#: The channels that are a property of a CASE rather than of a row — a header field has no rows to be absent
#: from, and reporting a row count for it would invent a frontier it does not have.
CASE_SCOPED: frozenset[str] = frozenset({'declared-precision'})

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
        any row (a sub-line whose subject the parser could not attribute): the artifact carries it, the rows
        do not, and calling that `none` would report a producer's gap where there is a rendering shape.
        """
        if self.total_cases == 0 or self.cases_reached == 0:
            return NONE
        if self.channel in CASE_SCOPED:
            return EVERY if self.cases_reached == self.total_cases else SOME
        if self.rows_reached == self.total_rows:
            return EVERY
        return SOME

    @property
    def value_reach(self) -> str:
        """The same three values for the VALUE, so a universal channel with holes cannot read as complete."""
        if self.total_cases == 0 or self.cases_valued == 0:
            return NONE
        if self.channel in CASE_SCOPED:
            return EVERY if self.cases_valued == self.total_cases else SOME
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
            declared = SERVICES_DECLARED.search(header.group(2))
            declared_rows = int(declared.group(1)) if declared is not None else 0
            case_open = dict.fromkeys(CHANNELS, False)
            row_open = dict.fromkeys(CHANNELS, False)
            case_valued_open = dict.fromkeys(CHANNELS, False)
            row_valued_open = dict.fromkeys(CHANNELS, False)
            # A declared precision is a NUMBER by construction (`decimals=N`), so rendering it and valuing
            # it are the same event and the two counts cannot drift apart here.
            if DECLARED_PRECISION.search(header.group(2)) is not None:
                case_open['declared-precision'] = True
                case_valued_open['declared-precision'] = True
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
            continue
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
        # The VALUE travels beside the rendering whenever the two differ, because a universal channel with
        # holes is the reading this whole module exists to prevent one level down. Only a ROW-scoped channel
        # can say that: a declared precision IS a value (`decimals=N`), so the two counts cannot differ there
        # and a branch for it would be unreachable code pretending to be coverage.
        if one.value_reach != one.reach and one.rows_valued is not None:
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
