"""Tests for the golden-landing instrument — the tool that answers "is this run stuck?".

The defect these tests were written against, measured on 2026-09-20. The record said, of three
consecutive golden runs, that the three ``ablation-*`` jobs **do not finish** — one of them
"still ``in_progress`` EIGHT HOURS after starting" — and concluded that *a job that never finishes
denies the record its own standard reader*, because the whole-run log archive answers 404 until a
run completes. The remedy the record applied was ``force-cancel``.

Every clause of that is false, and the causation is inverted:

| run | total | re1 | re2 | re3 | conclusions |
|---|---|---|---|---|---|
| 35497182235 | 61.1 | 13.4 | 48.6 | 27.9 | all ``success`` |
| 35443324311 | 62.1 | 13.5 | 49.4 | 30.1 | all ``success`` |
| 35435866603 | 45.1 | 12.9 | 32.4 | 30.3 | all ``success`` |
| 35433489124 | 62.4 | 13.8 | 49.7 | 30.5 | all ``success`` |
| 35482507910 | 37.4 | 13.4 ``success`` | 26.0 ``cancelled`` | 27.5 ``cancelled`` | cancelled at 37.4 min |
| 35485933840 | 22.3 | 10.9 | 10.6 | 10.7 | cancelled at 22.3 min |
| 35489493441 | 13.5 | 1.1 | 1.4 | 3.4 | cancelled at 13.5 min |

**Every run that was not cancelled has all three ablation jobs ``success``.** Every cancelled run
is one this session cancelled, at 13.5 / 22.3 / 37.4 minutes — into a job that needs 45-62 minutes.
The ablation jobs were never the problem; the cancel was the cause of the 404 it was meant to work
around. And it is destructive: the ablation artifacts were **3 of 3** on the run nobody cancelled,
**0 of 3** and **0 of 3** on two that were, and **1 of 3** on the third (only ``re1``, the job that
had already finished when the cancel arrived).

So there was no instrument that could tell "still working" from "stuck", the answer was a feeling,
and the action taken on it is irreversible. The tests below pin the instrument that replaces the
feeling: **a wait is licensed by the subject's OWN declared bound**, read from the workflow that
owns it, and the tool has no cancel path at all.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden_run_landing as landing  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO_ROOT / '.github/workflows/benchmark-rcaeval.yml'
WORKFLOW_TEXT = WORKFLOW_PATH.read_text('utf-8')

# The nine jobs of `benchmark-rcaeval.yml` and the bound each one declares. Read by the tests as a
# literal so the parser is checked against an independent statement of the same fact, and complete
# so that a job ADDED to the workflow — with or without a bound — fails here.
DECLARED = {
    'synthetic': 15,
    'rcaeval-re1': 60,
    'rcaeval-re2': 60,
    'rcaeval-re3': 60,
    'ablation-re1': 60,
    'ablation-re2': 60,
    'ablation-re3': 60,
    'optimize-rcaeval': 60,
    'dashboard': 10,
}


def job(name, status='in_progress', conclusion=None, started=None, completed=None):
    """One job as GitHub's jobs API returns it, with only the fields the classifier reads."""
    return {
        'name': name,
        'status': status,
        'conclusion': conclusion,
        'started_at': started,
        'completed_at': completed,
    }


def run(status='in_progress', conclusion=None, created=None, updated=None):
    return {
        'status': status,
        'conclusion': conclusion,
        'created_at': created,
        'updated_at': updated,
    }


class JobBoundsTest(unittest.TestCase):
    """The bound's OWNER is the workflow, and a trigger key is not a job."""

    def test_reads_every_job_and_its_declared_bound(self):
        self.assertEqual(landing.job_bounds(WORKFLOW_TEXT), DECLARED)

    def test_the_job_list_is_scoped_to_the_jobs_block(self):
        # `on:` and `jobs:` both hold 2-space-indented keys, so a parser that scanned the whole
        # document for `^  <name>:` would report `push` and `workflow_run` as jobs — and they are
        # TRIGGERS, which declare no bound, so they would arrive as jobs licensed by the platform
        # default. The scoping is asserted directly rather than left to the equality above, so a
        # future trigger key cannot make the two claims agree by accident.
        self.assertEqual(
            landing.workflow_jobs(WORKFLOW_TEXT),
            tuple(DECLARED),
        )
        self.assertNotIn('push', landing.workflow_jobs(WORKFLOW_TEXT))
        self.assertNotIn('workflow_dispatch', landing.workflow_jobs(WORKFLOW_TEXT))

    def test_a_line_at_the_mappings_own_indentation_ends_the_block(self):
        # A job-SHAPED key after the block must not be read as one of this mapping's jobs. The first
        # version of this fixture put only a top-level key there, which made the test unable to fail:
        # with or without the block's end, a 2-space `timeout-minutes` under it matched nothing, so
        # the mutation that removes the end SURVIVED. The fixture now carries a key that WOULD be
        # picked up as a job — `a-nested-thing` — which is what the fence exists to exclude, and a
        # fence no test can fail is not a fence.
        text = (
            'on:\n'
            '  push:\n'
            '    paths: [a]\n'
            'jobs:\n'
            '  a-job:\n'
            '    runs-on: ubuntu-latest\n'
            '    timeout-minutes: 7\n'
            '  b-job:\n'
            '    runs-on: ubuntu-latest\n'
            'not-a-job:\n'
            '  a-nested-thing:\n'
            '    timeout-minutes: 99\n'
        )
        self.assertEqual(landing.workflow_jobs(text), ('a-job', 'b-job'))
        self.assertEqual(landing.job_bounds(text), {'a-job': 7})
        # And `on:`'s trigger keys are not jobs at all, which is the same defect one block up.
        self.assertNotIn('push', landing.workflow_jobs(text))
        self.assertNotIn('a-nested-thing', landing.workflow_jobs(text))

    def test_a_workflow_with_no_jobs_block_yields_nothing(self):
        # The no-block branch, reached rather than assumed: a document that is not this workflow
        # reads as no jobs and no bounds, so every job it is asked about falls back to the platform
        # default with the owner named.
        self.assertEqual(landing.workflow_jobs('name: not a workflow\n'), ())
        self.assertEqual(landing.job_bounds('name: not a workflow\n'), {})

    def test_every_job_declares_its_own_bound(self):
        # The fence. A job with no `timeout-minutes` is not unbounded — GitHub kills it at its own
        # 360-minute default — but a waiter reading only the workflow would then be licensed to wait
        # six hours for a job whose author expected fifteen minutes. The measured worst ablation case
        # is 49.7 minutes, so a missing bound here is the difference between a 50-minute wait and a
        # six-hour one, which is the whole reason this fence exists.
        declared = landing.job_bounds(WORKFLOW_TEXT)
        self.assertEqual(set(declared), set(landing.workflow_jobs(WORKFLOW_TEXT)))
        self.assertNotIn(None, declared.values())

    def test_the_bound_carries_the_owner_that_supplied_it(self):
        declared = landing.job_bounds(WORKFLOW_TEXT)
        self.assertEqual(landing.resolve_bound('ablation-re2', declared).source, 'workflow')
        self.assertEqual(landing.resolve_bound('ablation-re2', declared).minutes, 60)
        # A job the workflow does not bound falls back to the PLATFORM's default, and names it: the
        # number exists either way, and what varies is which owner supplied it. Substituting a
        # constant here would hide exactly the six-hour wait the fence above exists to prevent.
        platform = landing.resolve_bound('a-job-nobody-bounded', declared)
        self.assertEqual(platform.minutes, landing.DEFAULT_JOB_TIMEOUT_MINUTES)
        self.assertEqual(platform.source, 'platform-default')


class ClassifyJobTest(unittest.TestCase):
    """One job, one verdict, against that job's OWN bound."""

    def setUp(self) -> None:
        self.declared = landing.job_bounds(WORKFLOW_TEXT)

    def test_a_job_inside_its_own_bound_is_WORKING(self):
        # THE case the record got wrong. `ablation-re3` on run 35482507910 had been running 27.5
        # minutes of its own 60 when the cancel was issued — the record read that as the jobs not
        # finishing, and the classifier must read it as licensed work with 32.5 minutes left.
        live = landing.classify_job(
            job('ablation-re3', started='2026-09-20T02:02:23Z'),
            self.declared,
            landing.parse_stamp('2026-09-20T02:29:52Z'),
        )
        self.assertEqual(live.verdict, 'WORKING')
        self.assertAlmostEqual(live.elapsed_minutes, 27.483, places=3)
        self.assertAlmostEqual(live.remaining_minutes, 32.517, places=3)
        self.assertEqual(live.bound.source, 'workflow')

    def test_a_job_past_its_own_bound_is_OVERDUE(self):
        live = landing.classify_job(
            job('dashboard', started='2026-09-20T02:00:00Z'),
            self.declared,
            landing.parse_stamp('2026-09-20T02:12:00Z'),
        )
        self.assertEqual(live.verdict, 'OVERDUE')
        # The overshoot is the FINDING, so it is reported rather than clamped to zero.
        self.assertAlmostEqual(live.remaining_minutes, -2.0, places=6)

    def test_a_completed_job_is_COMPLETED_whatever_its_conclusion(self):
        # A cancelled job is still `completed` as far as LIVENESS goes, and that distinction is the
        # one that matters to a waiter: the job will not run again, so waiting on it is meaningless.
        # What it CONCLUDED is a separate fact, carried beside the verdict rather than folded into it.
        done = landing.classify_job(
            job(
                'ablation-re1',
                status='completed',
                conclusion='success',
                started='2026-09-20T02:04:35Z',
                completed='2026-09-20T02:18:00Z',
            ),
            self.declared,
            landing.parse_stamp('2026-09-20T02:29:52Z'),
        )
        self.assertEqual(done.verdict, 'COMPLETED')
        self.assertEqual(done.conclusion, 'success')
        self.assertAlmostEqual(done.elapsed_minutes, 13.417, places=3)
        self.assertIsNone(done.remaining_minutes)
        stopped = landing.classify_job(
            job(
                'ablation-re2',
                status='completed',
                conclusion='cancelled',
                started='2026-09-20T02:03:53Z',
                completed='2026-09-20T02:29:52Z',
            ),
            self.declared,
            landing.parse_stamp('2026-09-20T02:29:52Z'),
        )
        self.assertEqual(stopped.verdict, 'COMPLETED')
        self.assertEqual(stopped.conclusion, 'cancelled')

    def test_a_completed_job_with_no_stamps_reports_no_elapsed_rather_than_zero(self):
        # A job GitHub marks `completed` never having started — a skipped cell, like `benchmark-diff`
        # whose own `if:` condition excluded it. There is no interval to measure, and reporting 0.0
        # would state that the job had been working for no time, which is a different claim from
        # "it never ran".
        skipped = landing.classify_job(
            job('benchmark-diff', status='completed', conclusion='skipped'),
            self.declared,
            landing.parse_stamp('2026-09-20T02:29:52Z'),
        )
        self.assertEqual(skipped.verdict, 'COMPLETED')
        self.assertEqual(skipped.conclusion, 'skipped')
        self.assertIsNone(skipped.elapsed_minutes)

    def test_a_job_that_has_not_started_is_NOT_STARTED_without_an_elapsed(self):
        # A queued job's bound has not begun, so there is no elapsed to compare and no remaining to
        # report. Reporting 0.0 would claim it had been WORKING since the run started.
        queued = landing.classify_job(
            job('ablation-re1', status='queued'),
            self.declared,
            landing.parse_stamp('2026-09-20T02:00:00Z'),
        )
        self.assertEqual(queued.verdict, 'NOT_STARTED')
        self.assertIsNone(queued.elapsed_minutes)
        self.assertIsNone(queued.remaining_minutes)


class LandingTest(unittest.TestCase):
    """The whole run: can a waiter keep waiting, and for how long is that licensed?"""

    def setUp(self) -> None:
        self.declared = landing.job_bounds(WORKFLOW_TEXT)

    def test_the_run_the_record_called_hung_was_WORKING(self):
        # Run 35482507910 as it stood at the instant of the cancel. `re1` had already finished; the
        # other two were 26.0 and 27.5 minutes into their own 60. The verdict is WORKING, and the
        # LICENCE — the longest wait the subject's own bounds permit — is 32.5 minutes. The cancel
        # was issued with 32.5 minutes of licensed wait left, which is the whole finding.
        state = landing.landing(
            run(status='in_progress', created='2026-09-20T01:52:27Z',
                updated='2026-09-20T02:29:52Z'),
            [
                job(
                    'ablation-re1',
                    status='completed',
                    conclusion='success',
                    started='2026-09-20T02:04:35Z',
                    completed='2026-09-20T02:18:00Z',
                ),
                job('ablation-re2', started='2026-09-20T02:03:53Z'),
                job('ablation-re3', started='2026-09-20T02:02:23Z'),
            ],
            self.declared,
            landing.parse_stamp('2026-09-20T02:29:52Z'),
        )
        self.assertEqual(state.verdict, 'WORKING')
        self.assertNotEqual(state.verdict, 'OVERDUE')
        self.assertAlmostEqual(state.licence_minutes, 32.517, places=3)
        self.assertAlmostEqual(state.run_elapsed_minutes, 37.417, places=3)
        by_name = {one.name: one for one in state.jobs}
        self.assertEqual(by_name['ablation-re1'].verdict, 'COMPLETED')
        self.assertEqual(by_name['ablation-re2'].verdict, 'WORKING')
        self.assertAlmostEqual(by_name['ablation-re2'].elapsed_minutes, 25.983, places=3)

    def test_a_completed_run_is_LANDED_and_owes_no_wait(self):
        # The run nobody cancelled: all three ablations succeeded, and the archive exists. There is
        # nothing to wait for and nothing to cancel, which is what LANDED says.
        state = landing.landing(
            run(
                status='completed',
                conclusion='success',
                created='2026-09-20T07:33:18Z',
                updated='2026-09-20T08:34:27Z',
            ),
            [
                job(
                    'ablation-re1',
                    status='completed',
                    conclusion='success',
                    started='2026-09-20T07:45:42Z',
                    completed='2026-09-20T07:59:04Z',
                ),
                job(
                    'ablation-re2',
                    status='completed',
                    conclusion='success',
                    started='2026-09-20T07:45:41Z',
                    completed='2026-09-20T08:34:15Z',
                ),
            ],
            self.declared,
            landing.parse_stamp('2026-09-20T08:40:00Z'),
        )
        self.assertEqual(state.verdict, 'LANDED')
        self.assertIsNone(state.licence_minutes)

    def test_one_overdue_job_makes_the_run_OVERDUE(self):
        # And the bound that decides it is the OVERDUE job's own — `dashboard` declares ten minutes
        # where the ablations declare sixty, so the same elapsed is overdue for one and licensed for
        # the other. A single constant here would call one of the two wrong.
        state = landing.landing(
            run(status='in_progress', created='2026-09-20T01:52:27Z'),
            [
                job('dashboard', started='2026-09-20T02:00:00Z'),
                job('ablation-re1', started='2026-09-20T02:00:00Z'),
            ],
            self.declared,
            landing.parse_stamp('2026-09-20T02:12:00Z'),
        )
        self.assertEqual(state.verdict, 'OVERDUE')
        by_name = {one.name: one for one in state.jobs}
        self.assertEqual(by_name['dashboard'].verdict, 'OVERDUE')
        self.assertEqual(by_name['ablation-re1'].verdict, 'WORKING')
        # Nothing is licensed past a bound that has already elapsed.
        self.assertIsNone(state.licence_minutes)

    def test_a_run_whose_jobs_have_all_finished_LANDS_even_when_it_was_cancelled(self):
        # `cancelled` is a CONCLUSION, and a completed run publishes its archive whatever it
        # concluded. Folding the conclusion into liveness would keep a waiter waiting on a run that
        # will never change again.
        state = landing.landing(
            run(
                status='completed',
                conclusion='cancelled',
                created='2026-09-20T04:34:43Z',
                updated='2026-09-20T04:48:14Z',
            ),
            [job('ablation-re3', status='completed', conclusion='cancelled', started='2026-09-20T04:44:50Z',
                 completed='2026-09-20T04:48:13Z')],
            self.declared,
            landing.parse_stamp('2026-09-20T05:00:00Z'),
        )
        self.assertEqual(state.verdict, 'LANDED')
        self.assertEqual(state.run_conclusion, 'cancelled')

    def test_a_run_of_queued_jobs_is_QUEUED_and_licenses_no_wait(self):
        state = landing.landing(
            run(status='queued', created='2026-09-20T01:52:27Z'),
            [job('ablation-re1', status='queued'), job('ablation-re2', status='queued')],
            self.declared,
            landing.parse_stamp('2026-09-20T01:55:00Z'),
        )
        self.assertEqual(state.verdict, 'QUEUED')
        self.assertIsNone(state.licence_minutes)

    def test_a_bound_the_workflow_does_not_declare_is_named_as_the_platforms(self):
        # The fallback is reachable and must stay honest: a job nobody bounded is WAITING under the
        # platform's 360-minute default, and the report has to say so, because that is the condition
        # under which "it has been running for an hour" is not yet a finding.
        state = landing.landing(
            run(status='in_progress', created='2026-09-20T01:52:27Z'),
            [job('some-future-job', started='2026-09-20T02:00:00Z')],
            self.declared,
            landing.parse_stamp('2026-09-20T02:30:00Z'),
        )
        self.assertEqual(state.verdict, 'WORKING')
        only = state.jobs[0]
        self.assertEqual(only.bound.source, 'platform-default')
        self.assertEqual(only.bound.minutes, 360)
        self.assertAlmostEqual(state.licence_minutes, 330.0, places=6)


class ReportTest(unittest.TestCase):
    """The report is what an operator reads instead of a feeling."""

    def setUp(self) -> None:
        self.declared = landing.job_bounds(WORKFLOW_TEXT)

    def test_names_the_verdict_the_licence_and_that_cancelling_is_not_available(self):
        state = landing.landing(
            run(status='in_progress', created='2026-09-20T01:52:27Z',
                updated='2026-09-20T02:29:52Z'),
            [
                job('ablation-re1', status='completed', conclusion='success',
                    started='2026-09-20T02:04:35Z', completed='2026-09-20T02:18:00Z'),
                job('ablation-re3', started='2026-09-20T02:02:23Z'),
            ],
            self.declared,
            landing.parse_stamp('2026-09-20T02:29:52Z'),
        )
        text = landing.report(state)
        self.assertIn('verdict WORKING', text)
        # The licence is a NUMBER with its owner, not an adjective: the job's own bound, from the
        # workflow that declared it, and how much of it is left.
        self.assertIn('ablation-re3', text)
        self.assertIn('60 min', text)
        self.assertIn('workflow', text)
        self.assertIn('32.5 min left', text)
        # And the one instruction the tool exists to give.
        self.assertIn('DO NOT CANCEL', text)
        self.assertIn('no cancel path', text)
        # A job that has stopped is reported as stopped, with what it concluded beside the verdict.
        self.assertIn('COMPLETED success', text)
        self.assertIn('13.4', text)

    def test_says_the_bound_is_the_platforms_when_the_workflow_names_none(self):
        state = landing.landing(
            run(status='in_progress', created='2026-09-20T01:52:27Z'),
            [job('some-future-job', started='2026-09-20T02:00:00Z')],
            self.declared,
            landing.parse_stamp('2026-09-20T02:30:00Z'),
        )
        text = landing.report(state)
        self.assertIn('platform-default', text)
        self.assertIn('360 min', text)

    def test_a_LANDED_run_says_there_is_nothing_to_wait_for(self):
        state = landing.landing(
            run(status='completed', conclusion='success', created='2026-09-20T07:33:18Z',
                updated='2026-09-20T08:34:27Z'),
            [job('ablation-re1', status='completed', conclusion='success',
                 started='2026-09-20T07:45:42Z', completed='2026-09-20T07:59:04Z')],
            self.declared,
            landing.parse_stamp('2026-09-20T08:40:00Z'),
        )
        text = landing.report(state)
        self.assertIn('verdict LANDED', text)
        self.assertIn('the archive can be read now', text)
        self.assertNotIn('32.5 min left', text)

    def test_a_QUEUED_run_says_nothing_is_licensed_yet(self):
        # The fourth verdict, rendered rather than only classified: a run whose jobs have not started
        # has no elapsed to measure, so the report must not offer a wait it cannot justify — and the
        # `LANDED` / `WORKING` / `OVERDUE` sentences must not leak into it.
        state = landing.landing(
            run(status='queued', created='2026-09-20T01:52:27Z'),
            [job('ablation-re1', status='queued')],
            self.declared,
            landing.parse_stamp('2026-09-20T01:55:00Z'),
        )
        text = landing.report(state)
        self.assertIn('verdict QUEUED', text)
        self.assertIn('no elapsed to measure', text)
        self.assertNotIn('min left', text)
        self.assertNotIn('the archive can be read now', text)

    def test_an_OVERDUE_run_says_the_bound_it_crossed(self):
        state = landing.landing(
            run(status='in_progress', created='2026-09-20T01:52:27Z'),
            [job('dashboard', started='2026-09-20T02:00:00Z')],
            self.declared,
            landing.parse_stamp('2026-09-20T02:12:00Z'),
        )
        text = landing.report(state)
        self.assertIn('verdict OVERDUE', text)
        self.assertIn('past its own bound by 2.0 min', text)


class NoCancelPathTest(unittest.TestCase):
    """The tool must be INCAPABLE of the act it advises against, not merely advised against it."""

    def test_the_module_performs_no_io_beyond_reading_files(self):
        # A cancel is an HTTP POST. This module does no HTTP and spawns no process, so it cannot
        # reach one — the property is structural rather than a rule someone has to remember. It runs
        # as a library over data a caller has already fetched, which is also what makes the fourteen
        # cases above testable without a network.
        source = (Path(landing.__file__)).read_text('utf-8')
        for forbidden in ('import urllib', 'import requests', 'import subprocess', 'import socket',
                          'os.system', 'force-cancel', '/cancel'):
            self.assertNotIn(forbidden, source, f'{forbidden} would give this tool a way to act')


class MainTest(unittest.TestCase):
    """The command line, which must refuse rather than traceback."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def write(self, name, payload):
        path = self.dir / name
        path.write_text(json.dumps(payload), 'utf-8')
        return str(path)

    def test_prints_the_report_and_exits_zero(self):
        run_path = self.write('run.json', run(status='in_progress', created='2026-09-20T01:52:27Z'))
        jobs_path = self.write('jobs.json', {'jobs': [job('ablation-re3', started='2026-09-20T02:02:23Z')]})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = landing.main(['--run', run_path, '--jobs', jobs_path,
                                 '--now', '2026-09-20T02:29:52Z'])
        self.assertEqual(code, 0)
        self.assertIn('verdict WORKING', out.getvalue())

    def test_can_take_the_jobs_on_stdin(self):
        run_path = self.write('run.json', run(status='in_progress', created='2026-09-20T01:52:27Z'))
        stdin = io.StringIO(
            json.dumps({'jobs': [job('ablation-re3', started='2026-09-20T02:02:23Z')]})
        )
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            old = sys.stdin
            sys.stdin = stdin
            try:
                code = landing.main(['--run', run_path, '--jobs', '-', '--now',
                                     '2026-09-20T02:29:52Z'])
            finally:
                sys.stdin = old
        self.assertEqual(code, 0)
        self.assertIn('verdict WORKING', out.getvalue())

    def test_a_missing_file_is_refused_rather_than_raised(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', str(self.dir / 'nope.json'), '--jobs', '-'])
        self.assertEqual(code, 2)
        self.assertIn('cannot read', err.getvalue())

    def test_a_missing_jobs_file_is_refused_by_its_own_name(self):
        # Each payload names ITSELF when it cannot be read: a refusal that said only "cannot read"
        # would send a reader to the wrong file, and the two are fetched by separate commands.
        run_path = self.write('run.json', run())
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', str(self.dir / 'nope.json')])
        self.assertEqual(code, 2)
        self.assertIn('cannot read', err.getvalue())
        self.assertIn('nope.json', err.getvalue())

    def test_a_payload_that_is_not_an_object_is_refused(self):
        run_path = self.write('run.json', [1, 2, 3])
        jobs_path = self.write('jobs.json', {'jobs': []})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path])
        self.assertEqual(code, 2)
        self.assertIn('expected a JSON object', err.getvalue())

    def test_a_bare_array_for_the_jobs_payload_is_refused(self):
        # The shape this tool originally demanded, and the reason it refused every real invocation:
        # the tests had been written to hand it a bare array, so the fixture vouched for a payload
        # the API never sends. The refusal names the shape that IS sent, and the shell command that
        # produces it is in the module's docstring rather than left to be guessed.
        run_path = self.write('run.json', run())
        jobs_path = self.write('jobs.json', [1, 2, 3])
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path])
        self.assertEqual(code, 2)
        self.assertIn("a 'jobs' array", err.getvalue())

    def test_an_envelope_with_no_jobs_array_is_refused(self):
        # The other half of the same check: an object that is not the jobs response. `total_count`
        # alone is what a caller gets for a run with no jobs, and it must be refused rather than read
        # as "there are no jobs", because the two mean different things.
        run_path = self.write('run.json', run())
        jobs_path = self.write('jobs.json', {'total_count': 0})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path])
        self.assertEqual(code, 2)
        self.assertIn("a 'jobs' array", err.getvalue())

    def test_a_bad_timestamp_is_refused_with_the_field_named(self):
        run_path = self.write('run.json', run(status='in_progress', created='not-a-stamp'))
        jobs_path = self.write('jobs.json', {'jobs': []})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path])
        self.assertEqual(code, 2)
        self.assertIn('cannot read the run\u2019s', err.getvalue())

    def test_a_corrupt_stamp_is_refused_even_when_its_partner_is_absent(self):
        # FOUND WHILE WRITING THIS MODULE, and the first version had it: the interval was computed
        # under `if created is not None and updated is not None`, so a `created_at` of
        # 'not-a-stamp' whose `updated_at` was missing was never parsed at all. The report then said
        # `run elapsed \u2014`, which is exactly what a run with NO timestamps says — a refusal and a
        # lack of data rendered identically. A present field is parsed however it would be used.
        run_path = self.write('run.json', {'status': 'in_progress', 'created_at': 'not-a-stamp'})
        jobs_path = self.write('jobs.json', {'jobs': []})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path])
        self.assertEqual(code, 2)
        self.assertIn('cannot read the run\u2019s', err.getvalue())

    def test_a_job_whose_stamp_is_corrupt_is_refused_by_the_same_rule(self):
        run_path = self.write('run.json', run(status='in_progress', created='2026-09-20T01:52:27Z'))
        jobs_path = self.write('jobs.json', {'jobs': [job('ablation-re1', started='whenever')]})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path])
        self.assertEqual(code, 2)
        self.assertIn('cannot read the run\u2019s or a job\u2019s', err.getvalue())

    def test_a_bad_now_is_refused_by_its_own_name(self):
        run_path = self.write('run.json', run())
        jobs_path = self.write('jobs.json', {'jobs': []})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = landing.main(['--run', run_path, '--jobs', jobs_path, '--now', 'later'])
        self.assertEqual(code, 2)
        self.assertIn('cannot read --now', err.getvalue())


if __name__ == '__main__':
    unittest.main()
