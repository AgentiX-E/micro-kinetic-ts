"""
Guards on whether two diagnostic dumps can be COMPARED at all.

The failure this exists to prevent was measured, not imagined. An evidence table and a pre-registered
prediction were derived from `.bench-cache/rcaeval-dumps/*.txt`, which turned out to be exact
**TrainTicket-only subsets** of the artifacts the workflow produces — `re3` 30 cases of 90, `re1` 125 of
375, `re2` 50 of 150 — and every shared case byte-identical apart from a header token the copies predate.
So the comparison looked plausible in every way a human checks: same ids, same values, same format. What
differed was the POPULATION, and nothing in the pipeline said so, because nothing asked.

`require_like_for_like` makes that question a prerequisite rather than an afterthought: a comparison of
two dumps is refused unless their populations match, and the refusal names both. The declared render
precision is deliberately NOT part of the check — that is the one thing a comparison is usually ABOUT, so
requiring it to match would forbid the measurement it exists to serve.

@module scripts/dump_coverage
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# `rcaeval-re3_re3tt_ts-auth-service_f1_1`: the suite and the system are in the case id, which is what
# makes a subset detectable from the artifact itself rather than from the filename or from recollection.
SUITE_SYSTEM = re.compile(r'_(re[123])(ob|ss|tt)_')
DATAPACK = re.compile(r'^DIAG datapack=(\S+)')
DECIMALS = re.compile(r'\bdecimals=(\d+)\b')

#: The group a case falls in when its id carries no suite/system marker — an FSE'26 datapack, whose ids
#: are `<system>-<service>-<fault>-<hash>`, or any id this reader does not recognise. Named rather than
#: defaulted to the suite, because a group that failed to be recognised must not silently join another.
UNCLASSIFIED = 'other'


class ComparisonError(RuntimeError):
    """Two artifacts cannot be compared as they stand."""


@dataclass(frozen=True)
class DumpCoverage:
    """
    What a dump is ABOUT: how many cases, of which groups, rendered at which precision.

    `decimals` is a tuple of the DISTINCT declared values, so `()` means "does not state" and a tuple
    longer than one means the file disagrees with itself — both of which a reader wants to see rather
    than have folded away.

    `by_group` is sorted, because it is compared between artifacts and a dict's order is an accident of
    how the file happened to be laid out.
    """

    cases: int
    by_group: tuple[tuple[str, int], ...]
    decimals: tuple[int, ...]

    def as_dict(self) -> dict[str, int]:
        """The per-group counts, as a mapping — for messages and for tests."""
        return dict(self.by_group)


def coverage_of(text: str) -> DumpCoverage:
    """
    Read a diagnostic dump's population and declared precision out of its own text.

    @param text: The dump, as written.
    @returns: Its case count, its per-group counts, and the distinct declared precisions.
    """
    groups: dict[str, int] = {}
    decimals: set[int] = set()
    cases = 0
    for line in text.splitlines():
        match = DATAPACK.match(line)
        if match is None:
            continue
        cases += 1
        where = SUITE_SYSTEM.search(match.group(1))
        group = f'{where.group(1)}{where.group(2)}' if where else UNCLASSIFIED
        groups[group] = groups.get(group, 0) + 1
        declared = DECIMALS.search(line)
        if declared is not None:
            decimals.add(int(declared.group(1)))
    return DumpCoverage(cases, tuple(sorted(groups.items())), tuple(sorted(decimals)))


def describe(coverage: DumpCoverage) -> str:
    """
    One line a report can print beside a number, so the population travels WITH it.

    @param coverage - The artifact's population.
    @returns: `1422 cases (unclassified 1422), 4 decimals`, or `… does not state its precision`.
    """
    groups = ', '.join(f'{name} {count}' for name, count in coverage.by_group)
    stated = (
        f'{", ".join(str(value) for value in coverage.decimals)} decimals'
        if coverage.decimals
        else 'does not state its precision'
    )
    return f'{coverage.cases} cases ({groups}), {stated}'


def require_like_for_like(
    *, left_name: str, left: DumpCoverage, right_name: str, right: DumpCoverage
) -> None:
    """
    Refuse a comparison whose two artifacts are not about the same cases.

    The declared precision is NOT compared: it is the quantity a comparison of two renders is usually
    about, so demanding it match would forbid exactly the measurement this guard supports. What must
    match is the POPULATION — the case count and every group's share of it — because a difference in
    population is a second variable, and a comparison with two variables attributes nothing.

    @param left_name - How to name the first artifact in the refusal.
    @param left - The first artifact's coverage.
    @param right_name - How to name the second artifact in the refusal.
    @param right - The second artifact's coverage.
    @raises ComparisonError: If the two populations differ, naming both and the group-level difference.
    """
    if left.by_group == right.by_group:
        return
    groups = [name for name in dict.fromkeys([*left.as_dict(), *right.as_dict()])]
    detail = ', '.join(
        f'{name}: {left.as_dict().get(name, 0)} vs {right.as_dict().get(name, 0)}' for name in groups
    )
    raise ComparisonError(
        f'{left_name} and {right_name} are about different populations, so a difference between them '
        f'cannot be attributed to anything: {left.cases} cases ({detail}) against {right.cases} cases '
        f'— compare like with like, or state the difference as a property of each artifact separately'
    )
