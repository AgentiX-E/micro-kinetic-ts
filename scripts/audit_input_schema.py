#!/usr/bin/env python3
"""
The INPUT census: what each converted RCAEval case actually carries, per case and per suite.

## Why this exists

`arXiv:2609.27069` (Buljić, University of Zenica) audits this benchmark and reports, as its second
finding, *"a non-uniform column schema that silently zeroes telemetry for **250 of 375 RE1 cases**"*
— which *"changes how any reimplementation of the benchmark should be read"*. Its Table 3 supplies the
mechanism and the population: the raw frame is **51 columns** on Online Boutique (curated RED metrics)
and **421–439 / 1180–1446** on Sock Shop and Train Ticket (raw cAdvisor), so a reader that assumes one
schema reads nothing for the other two systems. 250 is exactly **125 Sock Shop + 125 Train Ticket**.

That is a claim about the INPUT, and every RE1 number in this repository inherits it: the fold, the
per-term ablation rows, the telemetry-free floor, and the published headline. **A claim about the input
cannot be settled by reading the code that consumes it** — the code either read the columns or it did
not, and only the artifact says which. This module is the artifact's own answer.

## What it measures, and what it refuses to call a zero

For every case directory under the converted corpus it counts:

- **services** — distinct keys in `metrics.json`;
- **declared** — those services that appear in the system's own topology
  (`configs/topology/<system>.yaml`). A column the bridge split wrongly produces a service id the
  topology has never heard of, so this separates "a service the platform really runs" from "a string
  the splitter invented";
- **metric_names** — distinct `metric_name` values;
- **points** — total (timestamp, value) rows;
- **nonzero_services** — services carrying at least one value that is not exactly zero.

`nonzero_services == 0` on a case that HAS services and metric names is the exact shape the allegation
describes: telemetry present in name and **silently zero in value**. It is reported as its own class
rather than folded into "empty", because the two have different causes and therefore different fixes —
which is the ledger's own STARVED/INERT rule applied to the input instead of to a term.

## The gate

`--fail-on-degenerate` exits 1 when any case is degenerate, so this runs as a CHECK in the dataset
workflow rather than as a report nobody reads. A census that could not fail is a description of the
corpus, not a gate on it.

Usage::

    python3 scripts/audit_input_schema.py [--root ~/RCAEval-json] [--config configs/topology]
                                          [--json OUT] [--fail-on-degenerate] [--examples N]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

#: The case id carries its own suite and its own system: `rcaeval-re1_re1ob_currencyservice_cpu_1`.
#: The marker is `re<suite><system>` and it is SEARCHED for rather than anchored, because a corpus
#: directory carries a `rcaeval-` prefix while `benchmarks/src/run-ablation.ts` matches the same token
#: at the START of a bare case name. Anchoring either end would make one of the two populations
#: unrecognised, and an unrecognised case must not silently join a group it does not belong to.
CASE_ID = re.compile(r're([123])(ob|ss|tt)')

#: The system token in a case id, as the name the topology configs and the reports use.
SYSTEM_BY_TOKEN = {'ob': 'OnlineBoutique', 'ss': 'SockShop', 'tt': 'TrainTicket'}

#: What a case whose id this reader does not recognise is filed under. Named rather than defaulted to
#: a suite, because a group that failed to be recognised must not silently join another one.
UNCLASSIFIED = 'unrecognised'

#: A service entry in a topology config. The configs are lists of `- id: <service>`; this reads the id
#: and nothing else, which is all the census needs and all it should depend on.
SERVICE_ID = re.compile(r'^\s*-\s*id:\s*(\S+)\s*$', re.MULTILINE)


@dataclass(frozen=True)
class CaseCensus:
    """What one converted case carries. Frozen, because it is compared and counted, not edited."""

    case_id: str
    suite: str
    system: str
    services: int
    declared: int
    undeclared: tuple[str, ...]
    metric_names: int
    points: int
    nonzero_services: int

    @property
    def carries_telemetry(self) -> bool:
        """Whether the case's telemetry is present AND non-zero — the question the allegation asks.

        A case with services and metric names whose every value is zero is NOT carrying telemetry, and
        calling it a zero rather than an absence is precisely the confusion this property prevents.
        """
        return self.services > 0 and self.metric_names > 0 and self.nonzero_services > 0

    @property
    def degenerate(self) -> bool:
        """Whether this case is one of the shapes that must fail the gate.

        Four shapes, one class each rather than one message: nothing read at all (`services == 0`),
        a table with no metric names, a table with no rows, and the silent one — telemetry present and
        entirely zero, which is what a wrongly-joined column looks like from the artifact's side.
        """
        return (
            self.services == 0
            or self.metric_names == 0
            or self.points == 0
            or self.nonzero_services == 0
        )


@dataclass(frozen=True)
class SuiteCensus:
    """The per-(suite, system) aggregate, and the two numbers the verdict line needs."""

    suite: str
    system: str
    cases: int
    carrying: int
    degenerate: int
    undeclared_services: tuple[str, ...]

    @property
    def zeroed(self) -> int:
        """Cases that ran but carry no non-zero telemetry: the allegation's own count."""
        return self.cases - self.carrying


def read_declared_services(config: Path, system: str) -> frozenset[str]:
    """The service ids a system's topology config declares.

    @param config - The topology config directory.
    @param system - The system name, as `SYSTEM_BY_TOKEN` spells it.
    @returns The declared ids; empty when the config declares no services, which is a fact the caller
        may want to see rather than an error, so nothing is raised here.
    """
    name = {'OnlineBoutique': 'onlineboutique', 'SockShop': 'sockshop', 'TrainTicket': 'trainticket'}
    path = config / f'{name[system]}.yaml' if system in name else None
    if path is None or not path.exists():
        return frozenset()
    return frozenset(SERVICE_ID.findall(path.read_text(encoding='utf-8')))


def classify(case_id: str) -> tuple[str, str]:
    """The (suite, system) a case id declares, or `('unrecognised', 'unrecognised')`.

    @param case_id - A case directory name, with or without the `rcaeval-` prefix.
    @returns The suite and the system.
    """
    match = CASE_ID.search(case_id)
    if match is None:
        return (UNCLASSIFIED, UNCLASSIFIED)
    return (f're{match.group(1)}', SYSTEM_BY_TOKEN[match.group(2)])


def census_case(case_id: str, metrics: dict, declared: frozenset[str]) -> CaseCensus:
    """Count one case's telemetry from its parsed `metrics.json`.

    @param case_id - The case directory name.
    @param metrics - The parsed artifact: `{service: [{timestamp, value, metric_name}, ...]}`.
    @param declared - The service ids the system's topology declares.
    @returns The case's census.
    """
    suite, system = classify(case_id)
    metric_names: set[str] = set()
    points = 0
    nonzero = 0
    undeclared: list[str] = []
    for service, rows in metrics.items():
        if service not in declared:
            undeclared.append(service)
        has_value = False
        for row in rows:
            points += 1
            metric_names.add(str(row.get('metric_name', 'unknown')))
            if row.get('value', 0) != 0:
                has_value = True
        if has_value:
            nonzero += 1
    return CaseCensus(
        case_id=case_id,
        suite=suite,
        system=system,
        services=len(metrics),
        declared=len(metrics) - len(undeclared),
        undeclared=tuple(sorted(undeclared)),
        metric_names=len(metric_names),
        points=points,
        nonzero_services=nonzero,
    )


def parse_metrics(path: Path) -> dict:
    """The parsed artifact, or an empty mapping when it is missing, unreadable or not an object.

    Three failures collapse to one answer HERE and nowhere else: the file is absent, the bytes are not
    JSON, or the JSON is not an object. All three mean the same thing to a census — this case carries no
    telemetry — and keeping the collapse in one place is what stops three callers from each inventing a
    fourth answer. It is a `dict` and never `None`, because a case that carries nothing is a census of
    zero services, not the absence of a census.

    @param path - A path to a `metrics.json`.
    @returns The parsed mapping, or `{}`.
    """
    try:
        parsed = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def read_case(case_dir: Path, declared: frozenset[str]) -> CaseCensus:
    """Census one case directory.

    The caller supplies a directory it has already found a `metrics.json` in — that is what
    {@link census_corpus} discovers — so this reads and counts and makes no decision about absence. A file
    that vanishes between the walk and the read is handled by {@link parse_metrics}, which answers "no
    telemetry" for it exactly as it does for a corrupt one: one answer for one question, in one place.

    @param case_dir - A directory holding a converted case.
    @param declared - The service ids the system's topology declares.
    @returns The census.
    """
    return census_case(case_dir.name, parse_metrics(case_dir / 'metrics.json'), declared)


def summarize(censuses: list[CaseCensus]) -> list[SuiteCensus]:
    """Fold the per-case censuses into one row per (suite, system), deterministically ordered.

    @param censuses - The per-case results.
    @returns One row per group, sorted by suite then system so two runs print the same table.
    """
    groups: dict[tuple[str, str], list[CaseCensus]] = {}
    for entry in censuses:
        groups.setdefault((entry.suite, entry.system), []).append(entry)
    rows: list[SuiteCensus] = []
    for (suite, system), members in groups.items():
        undeclared: set[str] = set()
        for member in members:
            undeclared.update(member.undeclared)
        rows.append(
            SuiteCensus(
                suite=suite,
                system=system,
                cases=len(members),
                carrying=sum(1 for m in members if m.carries_telemetry),
                degenerate=sum(1 for m in members if m.degenerate),
                undeclared_services=tuple(sorted(undeclared)),
            )
        )
    rows.sort(key=lambda r: (r.suite, r.system))
    return rows


def format_census(rows: list[SuiteCensus], examples: int) -> list[str]:
    """The report, as lines. Pure, so every arm of it is testable without a corpus.

    @param rows - The per-group aggregates.
    @param examples - How many undeclared service ids to name per row.
    @returns The report lines.
    """
    if not rows:
        return ['no cases found: nothing to census, and saying so beats printing a zero.']
    lines = [
        f'{"suite":<6} {"system":<15} {"cases":>6} {"carrying":>9} {"zeroed":>7} {"degen":>6} '
        f'{"undeclared":>11}  examples',
    ]
    for row in rows:
        named = ', '.join(row.undeclared_services[:examples]) if examples > 0 else ''
        lines.append(
            f'{row.suite:<6} {row.system:<15} {row.cases:>6} {row.carrying:>9} '
            f'{row.zeroed:>7} {row.degenerate:>6} {len(row.undeclared_services):>11}  {named}'
        )
    return lines


def verdict(rows: list[SuiteCensus], suite: str) -> str:
    """The one sentence the allegation needs: how many of a suite's cases carry telemetry.

    @param rows - The per-group aggregates.
    @param suite - The suite to state the verdict for.
    @returns A line naming the count, or a line saying the suite is absent from the corpus.
    """
    members = [r for r in rows if r.suite == suite]
    if not members:
        return f'{suite}: no cases in this corpus — nothing to state.'
    cases = sum(r.cases for r in members)
    carrying = sum(r.carrying for r in members)
    return f'{suite}: {carrying} of {cases} cases carry non-zero telemetry across {len(members)} systems.'


def census_corpus(root: Path, config: Path) -> list[CaseCensus]:
    """Every `metrics.json` under `root`, as censuses, sorted by path.

    The walk is RECURSIVE because the depth of a converted case is a property of the raw dataset's own
    layout, not of this instrument: the bridge writes `out_dir / <the parquet's path relative to the data
    root>`, so a case can sit one directory deep or two. Anchoring at a fixed depth would have produced a
    census of zero cases against a full corpus — a wrong answer that looks exactly like a finding.

    @param root - The converted corpus.
    @param config - The topology config directory.
    @returns The per-case censuses.
    """
    found: list[CaseCensus] = []
    for case_dir in sorted({path.parent for path in root.rglob('metrics.json')}):
        found.append(read_case(case_dir, read_declared_services(config, classify(case_dir.name)[1])))
    return found


def main(argv: list[str]) -> int:
    """The CLI. Returns the process exit code: 0 census, 1 degenerate, 2 usage.

    @param argv - Arguments after the script name.
    @returns The exit code.
    """
    parser = argparse.ArgumentParser(description='Census the converted RCAEval corpus per case.')
    parser.add_argument('--root', default=os.path.expanduser('~/RCAEval-json'))
    parser.add_argument('--config', default='configs/topology')
    parser.add_argument('--json', default=None)
    parser.add_argument('--examples', type=int, default=4)
    parser.add_argument('--fail-on-degenerate', action='store_true')
    args = parser.parse_args(argv)

    root = Path(args.root)
    if not root.is_dir():
        print(f'ERROR: converted corpus not found: {root}', file=sys.stderr)
        return 2

    censuses = census_corpus(root, Path(args.config))
    rows = summarize(censuses)
    for line in format_census(rows, args.examples):
        print(line)
    for suite in ('re1', 're2', 're3'):
        print(verdict(rows, suite))

    degenerate = [c.case_id for c in censuses if c.degenerate]
    print(f'degenerate cases: {len(degenerate)} of {len(censuses)}')
    for case_id in degenerate[: args.examples]:
        print(f'  {case_id}')

    if args.json is not None:
        Path(args.json).write_text(
            json.dumps(
                {
                    'groups': [r.__dict__ for r in rows],
                    'degenerate': degenerate,
                    'cases': len(censuses),
                },
                indent=2,
            ),
            encoding='utf-8',
        )

    if degenerate and args.fail_on_degenerate:
        print(f'FAIL: {len(degenerate)} degenerate cases', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
