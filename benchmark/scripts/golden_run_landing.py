#!/usr/bin/env python3
"""Answer "is this benchmark run still working, or stuck?" — and licence a wait with a number.

**The defect this module exists for, measured on 2026-09-20.** Three consecutive golden runs were
cancelled because the record said the three ``ablation-*`` jobs *do not finish* — one of them "still
``in_progress`` EIGHT HOURS after starting" — and concluded that *a job that never finishes denies
the record its own standard reader*, the whole-run log archive answering 404 until a run completes.
Every clause of that was false, and the causation was inverted:

    run           total   re1            re2            re3            conclusions
    35497182235    61.1   13.4           48.6           27.9           all success
    35443324311    62.1   13.5           49.4           30.1           all success
    35435866603    45.1   12.9           32.4           30.3           all success
    35433489124    62.4   13.8           49.7           30.5           all success
    35482507910    37.4   13.4 success   26.0 cancelled 27.5 cancelled cancelled at 37.4 min
    35485933840    22.3   10.9           10.6           10.7           cancelled at 22.3 min
    35489493441    13.5    1.1            1.4            3.4           cancelled at 13.5 min

**Every run that was not cancelled has all three ablation jobs ``success``.** Every cancelled run is
one this session cancelled, at 13.5 / 22.3 / 37.4 minutes, into work that needs 45-62 minutes. The
jobs were never the problem; **the cancellation caused the 404 it was meant to work around**. And it
destroyed evidence rather than protecting anything: the ablation artifacts were **3 of 3** on the run
nobody cancelled, **0 of 3** and **0 of 3** on two of the cancelled ones, and **1 of 3** on the third
— only ``re1``, the job that had already finished when the cancellation arrived. Five of six
artifacts, and three goldens' worth of ablation evidence, spent on a phantom.

**Why nothing caught it.** There was no instrument that could tell "still working" from "stuck", so
the answer was a FEELING — "this is taking too long" — and the action taken on a feeling is
irreversible. Worse, the record then read its own interruption back as a property of the jobs: the
rows that said ``cancelled`` were cited as proof that the jobs do not finish.

**The rule this module implements.** A wait is licensed by the **subject's own declared bound**, read
from the workflow that owns it — never by a constant, and never by a feeling. So:

- :func:`job_bounds` reads each job's ``timeout-minutes`` from
  ``.github/workflows/benchmark-rcaeval.yml``, scoped to the ``jobs:`` block (``on:``'s trigger keys
  sit at the same indentation and are not jobs);
- :func:`resolve_bound` falls back to GitHub's own 360-minute job default, and **names which owner
  answered**, because the number exists either way and the difference between a fifteen-minute bound
  and a six-hour one is the whole question;
- :func:`classify_job` compares a job's elapsed time against **its own** bound — ``dashboard``
  declares ten minutes where the ablations declare sixty, so one constant would call one of the two
  wrong;
- :func:`landing` reduces the run to one verdict and, when waiting is licensed, to the **soonest**
  moment a pending job could cross its own bound — the number that licenses "read again in N minutes".

**And the property that makes it safe: this module has no cancel path.** It performs no HTTP, spawns
no process and opens no socket; it classifies data a caller has already fetched. The advice it gives
cannot be overridden by the tool that gives it, which is checked by a test over this file's source
rather than left to discipline.

Usage — the two payloads are GitHub's own responses, so nothing here needs a token::

    python3 .git/gh_api.py "/repos/<owner>/<repo>/actions/runs/<id>" > /tmp/run.json
    python3 .git/gh_api.py "/repos/<owner>/<repo>/actions/runs/<id>/jobs?per_page=50" > /tmp/jobs.json
    python3 scripts/golden_run_landing.py --run /tmp/run.json --jobs /tmp/jobs.json
    # and repeat until it says LANDED, which is the only state in which the archive exists
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# The workflow whose jobs bound the golden run, and so the owner of every wait licence derived here.
WORKFLOW_PATH = REPO_ROOT / '.github/workflows/benchmark-rcaeval.yml'

# GitHub's own default job timeout, in minutes. A job the workflow does not bound is NOT unbounded:
# it is bounded by the platform, at six hours. Named as its own owner because a waiter that silently
# substituted one of the two numbers would be unable to say whether it was waiting fifteen minutes or
# three hundred and sixty.
DEFAULT_JOB_TIMEOUT_MINUTES = 360
WORKFLOW_SOURCE = 'workflow'
PLATFORM_SOURCE = 'platform-default'

# GitHub's job timestamps. The `Z` suffix is the whole format the API emits; a stamp that does not
# match is refused rather than guessed at, because a mis-parsed stamp becomes a fabricated elapsed.
STAMP_FORMAT = '%Y-%m-%dT%H:%M:%SZ'

# A job is `completed` as far as LIVENESS goes whatever it concluded, and that is the distinction a
# waiter needs: the job will not run again, so waiting on it is meaningless. What it concluded is a
# separate fact, carried BESIDE the verdict rather than folded into it.
COMPLETED_STATUS = 'completed'

# The jobs mapping's own indentation, and the two lines inside a job this module reads. `on:`'s
# trigger keys sit at the SAME two-space indentation, which is why the scan is scoped to `jobs:`
# before these patterns are applied at all.
_JOBS_HEADER = re.compile(r'^jobs:\s*(#.*)?$')
_JOB_KEY = re.compile(r'^  "?([A-Za-z0-9_.-]+)"?:\s*(#.*)?$')
_JOB_BOUND = re.compile(r'^    timeout-minutes:\s*(\d+)\s*$')


@dataclass(frozen=True)
class Bound:
    """The bound a job's wait is measured against, and WHICH OWNER supplied it."""

    minutes: int
    source: str


@dataclass(frozen=True)
class JobLiveness:
    """One job, its own bound, and what its elapsed time says against it."""

    name: str
    status: str
    conclusion: str | None
    bound: Bound
    verdict: str
    elapsed_minutes: float | None
    remaining_minutes: float | None


@dataclass(frozen=True)
class Landing:
    """The whole run, reduced to the one question a waiter has."""

    verdict: str
    jobs: tuple[JobLiveness, ...]
    licence_minutes: float | None
    run_status: str
    run_conclusion: str | None
    run_elapsed_minutes: float | None


def _jobs_block(text: str) -> str:
    """The workflow's ``jobs:`` mapping with everything before it removed.

    Scoping is not cosmetic. ``on:`` and ``jobs:`` both hold keys at two-space indentation, so a
    parser scanning the whole document reports ``push`` and ``workflow_run`` as jobs — and those are
    TRIGGERS, which declare no ``timeout-minutes``, so each would arrive as a job licensed by the
    platform's six-hour default. Measured on the file this module reads: eleven indented keys, nine
    of them jobs.

    @param text - The workflow file's text.
    @returns Everything after the top-level ``jobs:`` line, or an empty string when there is none.
    """
    lines = text.split('\n')
    for index, line in enumerate(lines):
        if _JOBS_HEADER.match(line):
            return '\n'.join(lines[index + 1 :])
    return ''


def _blocks(block: str) -> list[tuple[str, list[str]]]:
    """Split the jobs block into one entry per job, in file order.

    A line at the mapping's own indentation ends the block, so a `timeout-minutes` that belongs to
    something after the jobs — a second document, a trailing top-level key — is never attributed to
    the last job that happens to precede it. That is a fence over a plausible edit rather than over a
    failure anyone has seen, and it is exercised by a test with exactly that shape.

    @param block - The jobs block, as :func:`_jobs_block` returned it.
    @returns Job name and its own lines.
    """
    found: list[tuple[str, list[str]]] = []
    for line in block.split('\n'):
        if line and not line.startswith(' '):
            break
        as_key = _JOB_KEY.match(line)
        if as_key:
            found.append((as_key.group(1), []))
            continue
        if found:
            found[-1][1].append(line)
    return found


def workflow_jobs(text: str) -> tuple[str, ...]:
    """Every job the workflow defines, in file order.

    @param text - The workflow file's text.
    @returns The job names.
    """
    return tuple(name for name, _ in _blocks(_jobs_block(text)))


def job_bounds(text: str) -> dict[str, int]:
    """Each job's own ``timeout-minutes``, and only the ones the workflow DECLARES.

    A job absent from the result is not unbounded — see :func:`resolve_bound` — it is a job whose
    bound belongs to the platform rather than to this file, and the caller is told which of the two
    it received rather than handed a number with no owner.

    @param text - The workflow file's text.
    @returns Job name to declared minutes, in file order.
    """
    declared: dict[str, int] = {}
    for name, lines in _blocks(_jobs_block(text)):
        for line in lines:
            as_bound = _JOB_BOUND.match(line)
            if as_bound:
                declared[name] = int(as_bound.group(1))
                break
    return declared


def resolve_bound(job: str, declared: dict[str, int]) -> Bound:
    """The bound a job's wait is measured against, and the owner that supplied it.

    @param job - The job's name.
    @param declared - What :func:`job_bounds` read from the workflow.
    @returns The bound, naming ``workflow`` or ``platform-default`` as its source.
    """
    minutes = declared.get(job)
    if minutes is None:
        return Bound(minutes=DEFAULT_JOB_TIMEOUT_MINUTES, source=PLATFORM_SOURCE)
    return Bound(minutes=minutes, source=WORKFLOW_SOURCE)


def parse_stamp(text: str) -> datetime:
    """GitHub's job timestamp as an instant.

    @param text - A stamp in the API's own format, e.g. ``2026-09-20T01:52:27Z``.
    @returns The instant, in UTC.
    """
    return datetime.strptime(text, STAMP_FORMAT).replace(tzinfo=timezone.utc)


def elapsed_minutes(start: datetime, end: datetime) -> float:
    """Minutes between two instants.

    @param start - The earlier instant.
    @param end - The later instant.
    @returns The interval in minutes, fractional.
    """
    return (end - start).total_seconds() / 60


def _instant(value: object) -> datetime | None:
    """One API timestamp field, ABSENT or parsed — never silently skipped.

    The distinction is the point. An absent field is a fact about this payload: there is no interval
    to measure, and None says so. A field that is PRESENT and does not parse is a fault in the
    payload, and it is raised however the value would have been used — because a guard written as
    "parse it only if the other stamp is also present" swallows a corrupt `created_at` whose
    `updated_at` happens to be missing, and the elapsed time it then reports is None, which is
    indistinguishable from "this run has no timestamps".

    @param value - The raw field, or None when the payload omitted it.
    @returns The instant, or None when the field was absent.
    """
    if value is None:
        return None
    return parse_stamp(str(value))


def classify_job(job: dict[str, object], declared: dict[str, int], now: datetime) -> JobLiveness:
    """One job's liveness, measured against ITS OWN bound.

    @param job - One entry of the jobs API's ``jobs`` array.
    @param declared - What :func:`job_bounds` read from the workflow.
    @param now - The instant to measure an unfinished job's elapsed time at.
    @returns The job's liveness.
    """
    name = str(job.get('name', '?'))
    status = str(job.get('status', ''))
    conclusion = job.get('conclusion')
    bound = resolve_bound(name, declared)
    started = _instant(job.get('started_at'))
    completed = _instant(job.get('completed_at'))

    if status == COMPLETED_STATUS:
        # `elapsed_minutes` is None for a job that completed without ever starting — a skipped cell.
        # Reporting 0.0 would state that it had been working for no time, which is a different claim
        # from "it never ran", and a waiter reading the two as one could not tell them apart.
        elapsed = None
        if started is not None and completed is not None:
            elapsed = elapsed_minutes(started, completed)
        return JobLiveness(
            name=name,
            status=status,
            conclusion=conclusion if isinstance(conclusion, str) else None,
            bound=bound,
            verdict='COMPLETED',
            elapsed_minutes=elapsed,
            remaining_minutes=None,
        )

    if started is None:
        # A queued job's bound has not begun, so there is no elapsed to compare and no remaining to
        # report. Reporting 0.0 would claim it had been working since the run was created.
        return JobLiveness(
            name=name,
            status=status,
            conclusion=conclusion if isinstance(conclusion, str) else None,
            bound=bound,
            verdict='NOT_STARTED',
            elapsed_minutes=None,
            remaining_minutes=None,
        )

    elapsed = elapsed_minutes(started, now)
    remaining = bound.minutes - elapsed
    return JobLiveness(
        name=name,
        status=status,
        conclusion=conclusion if isinstance(conclusion, str) else None,
        bound=bound,
        verdict='OVERDUE' if remaining < 0 else 'WORKING',
        elapsed_minutes=elapsed,
        # Not clamped at zero: the OVERSHOOT is the finding, and a waiter told `0 left` cannot tell
        # a job at its limit from one that passed it twenty minutes ago.
        remaining_minutes=remaining,
    )


def landing(
    run: dict[str, object], jobs: list[dict[str, object]], declared: dict[str, int], now: datetime
) -> Landing:
    """The run's one verdict, and the wait its own bounds licence.

    Precedence, in this order and stated once: a completed run has LANDED whatever it concluded (a
    cancelled run publishes its archive, and a waiter that folded the conclusion into liveness would
    keep waiting on a run that will never change again); then any job past its own bound makes the
    run OVERDUE; then any job inside its bound makes it WORKING; otherwise every pending job is still
    queued.

    @param run - The runs API's run object.
    @param jobs - The jobs API's ``jobs`` array.
    @param declared - What :func:`job_bounds` read from the workflow.
    @param now - The instant to measure unfinished jobs at.
    @returns The landing.
    """
    created = _instant(run.get('created_at'))
    updated = _instant(run.get('updated_at'))
    run_elapsed = None
    if created is not None and updated is not None:
        run_elapsed = elapsed_minutes(created, updated)

    classified = tuple(classify_job(one, declared, now) for one in jobs)
    run_status = str(run.get('status', ''))
    conclusion = run.get('conclusion')
    run_conclusion = conclusion if isinstance(conclusion, str) else None

    if run_status == COMPLETED_STATUS:
        return Landing(
            verdict='LANDED',
            jobs=classified,
            licence_minutes=None,
            run_status=run_status,
            run_conclusion=run_conclusion,
            run_elapsed_minutes=run_elapsed,
        )

    pending = tuple(one for one in classified if one.verdict != 'COMPLETED')
    if any(one.verdict == 'OVERDUE' for one in pending):
        return Landing(
            verdict='OVERDUE',
            jobs=classified,
            licence_minutes=None,
            run_status=run_status,
            run_conclusion=run_conclusion,
            run_elapsed_minutes=run_elapsed,
        )

    working = tuple(one for one in pending if one.verdict == 'WORKING')
    if working:
        # The SOONEST a pending job reaches its own bound, so waiting this long cannot pass a
        # boundary unread. A constant here would be the same mistake as a constant bound: it would
        # not know that `dashboard` declares ten minutes and the ablations sixty.
        licence = min(
            one.remaining_minutes for one in working if one.remaining_minutes is not None
        )
        return Landing(
            verdict='WORKING',
            jobs=classified,
            licence_minutes=licence,
            run_status=run_status,
            run_conclusion=run_conclusion,
            run_elapsed_minutes=run_elapsed,
        )

    return Landing(
        verdict='QUEUED',
        jobs=classified,
        licence_minutes=None,
        run_status=run_status,
        run_conclusion=run_conclusion,
        run_elapsed_minutes=run_elapsed,
    )


def _at(value: float | None) -> str:
    """A number for the table, with the absent case spelled rather than zeroed.

    @param value - The number, or None.
    @returns Its text.
    """
    return '\u2014' if value is None else f'{value:.1f}'


def report(state: Landing) -> str:
    """The landing as text an operator reads instead of a feeling.

    @param state - The landing.
    @returns The report, newline-terminated.
    """
    headline = f'golden landing \u2014 run {state.run_status}'
    if state.run_conclusion:
        headline += f' ({state.run_conclusion})'
    lines = [
        headline,
        f'  run elapsed {_at(state.run_elapsed_minutes)} min of the longest job bound',
        '',
        f'  {"job":<18}{"status":<13}{"bound":<28}{"elapsed":>8}{"remaining":>11}  verdict',
    ]
    for one in state.jobs:
        bound = f'{one.bound.minutes} min ({one.bound.source})'
        conclusion = f' {one.conclusion}' if one.conclusion else ''
        lines.append(
            f'  {one.name:<18}{one.status:<13}{bound:<28}{_at(one.elapsed_minutes):>8}'
            f'{_at(one.remaining_minutes):>11}  {one.verdict}{conclusion}'
        )
    lines.append('')

    if state.verdict == 'LANDED':
        lines.append(
            'verdict LANDED \u2014 the run is completed, so the archive can be read now; '
            'there is nothing to wait for and nothing to cancel.'
        )
    elif state.verdict == 'WORKING':
        lines.append(
            'verdict WORKING \u2014 every pending job is inside its OWN bound; the longest '
            f'licensed wait is {_at(state.licence_minutes)} min left.'
        )
    elif state.verdict == 'OVERDUE':
        crossed = next(one for one in state.jobs if one.verdict == 'OVERDUE')
        assert crossed.remaining_minutes is not None  # OVERDUE is only reachable with an elapsed
        lines.append(
            f'verdict OVERDUE \u2014 {crossed.name} is past its own bound by '
            f'{abs(crossed.remaining_minutes):.1f} min; GitHub\u2019s own timeout owns that job, '
            'so read again rather than acting.'
        )
    else:
        lines.append(
            'verdict QUEUED \u2014 no job has started, so there is no elapsed to measure and no '
            'wait licensed yet; read again shortly.'
        )

    lines.append(
        'LICENCE: every pending job is measured against its OWN `timeout-minutes`, read from '
        'benchmark-rcaeval.yml; a job that file does not bound is measured against GitHub\u2019s '
        f'{DEFAULT_JOB_TIMEOUT_MINUTES}-minute default, and the row names which owner answered. A '
        'constant cannot tell "still working" from "stuck".'
    )
    lines.append(
        'DO NOT CANCEL: this tool has no cancel path \u2014 no network, no subprocess \u2014 so it '
        'cannot do the thing it warns against. Cancelling ends the run as `cancelled` and every job '
        'that has not uploaded loses its artifacts: measured on three goldens, 3 of 3 ablation '
        'artifacts on the run nobody cancelled, 0 of 3 and 0 of 3 on two that were, and 1 of 3 on '
        'the third \u2014 only the job that had already finished. Wait for LANDED.'
    )
    return '\n'.join(lines) + '\n'


def _read_json(path: str) -> object:
    """One payload, from a file or from stdin.

    @param path - A path, or ``-`` for stdin.
    @returns The parsed payload.
    """
    text = sys.stdin.read() if path == '-' else Path(path).read_text('utf-8')
    return json.loads(text)


def main(argv: list[str]) -> int:
    """Print the landing, or refuse with a reason.

    @param argv - The arguments after the program name.
    @returns A process exit status.
    """
    parser = argparse.ArgumentParser(description='Classify a benchmark run as working or stuck.')
    parser.add_argument('--run', required=True, help='The runs API response, or - for stdin.')
    parser.add_argument('--jobs', required=True, help='The jobs API response, or - for stdin.')
    parser.add_argument('--now', default=None, help='The instant to measure against, as a job stamp.')
    arguments = parser.parse_args(argv)

    try:
        raw_run = _read_json(arguments.run)
    except (OSError, ValueError) as exc:
        print(f'cannot read {arguments.run}: {exc}', file=sys.stderr)
        return 2
    try:
        raw_jobs = _read_json(arguments.jobs)
    except (OSError, ValueError) as exc:
        print(f'cannot read {arguments.jobs}: {exc}', file=sys.stderr)
        return 2
    if not isinstance(raw_run, dict):
        print('expected a JSON object for the run', file=sys.stderr)
        return 2
    # The two payloads do NOT share a shape, and the tool reads what the API actually sends: the
    # runs endpoint returns the run object, the jobs endpoint returns an envelope around the array.
    # Measured by running this on real responses — the first version accepted a bare array, which is
    # what the *tests* had been written to hand it, so it refused every real invocation with
    # `expected a JSON list of jobs`. A fixture that does not match its subject is not a fixture.
    if not isinstance(raw_jobs, dict) or not isinstance(raw_jobs.get('jobs'), list):
        print(
            "expected a JSON object with a 'jobs' array for the jobs payload "
            '(the jobs API\u2019s own response)',
            file=sys.stderr,
        )
        return 2
    raw_jobs_list = raw_jobs['jobs']

    try:
        now = parse_stamp(arguments.now) if arguments.now else datetime.now(timezone.utc)
    except ValueError as exc:
        print(f'cannot read --now: {exc}', file=sys.stderr)
        return 2

    try:
        declared = job_bounds(WORKFLOW_PATH.read_text('utf-8'))
        state = landing(raw_run, raw_jobs_list, declared, now)
    except ValueError as exc:
        print(f'cannot read the run\u2019s or a job\u2019s timestamps: {exc}', file=sys.stderr)
        return 2

    print(report(state), end='')
    return 0


if __name__ == '__main__':  # pragma: no cover
    raise SystemExit(main(sys.argv[1:]))
