"""Tests for the golden-run selector — the tool that answers "is a benchmark run owed?".

The defect these tests were written against, measured on 2026-09-18: the poller handed the
caller's revision string straight to GitHub's ``head_sha`` filter, which matches the FULL
forty-character SHA only. ``head_sha=d2625d0`` returned ``total_count: 0`` while
``head_sha=d2625d05d33576f8d2575858c3d04ed3c6d309ca`` returned three runs for the SAME commit
(``ci.yml``, ``release.yml``, ``benchmark-rcaeval.yml``). The poller then printed

    no benchmark run: this push does not touch a path that can move the engine,
    so no golden is owed

— a sentence asserting a reason it had never checked, about a commit whose push had in fact
triggered the benchmark. So the tests below pin two separate things: a revision is RESOLVED
before it is queried, and a zero-run answer is EXPLAINED BY MEASUREMENT rather than asserted.
"""

from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import golden_run_selector as selector  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_PATH = REPO_ROOT / '.github/workflows/benchmark-rcaeval.yml'
WORKFLOW_TEXT = WORKFLOW_PATH.read_text('utf-8')

FULL = 'd2625d05d33576f8d2575858c3d04ed3c6d309ca'
ABBREV = 'd2625d0'


class Completed:
    """The slice of ``subprocess.CompletedProcess`` the selector touches."""

    def __init__(self, stdout: str = '', returncode: int = 0, stderr: str = '') -> None:
        self.stdout = stdout
        self.returncode = returncode
        self.stderr = stderr


class Recorder:
    """A `run` stand-in that records argv and replays one canned result."""

    def __init__(self, *results: Completed) -> None:
        self.calls: list[list[str]] = []
        self.kwargs: list[dict] = []
        self._results = list(results)

    def __call__(self, argv, **kwargs):  # noqa: ANN001, ANN003 - mirrors subprocess.run
        self.calls.append(list(argv))
        self.kwargs.append(kwargs)
        return self._results.pop(0) if len(self._results) > 1 else self._results[0]


class ResolveCommitTest(unittest.TestCase):
    """A revision must become a full SHA before anything is queried with it."""

    def test_an_abbreviated_revision_is_resolved_to_the_full_sha(self) -> None:
        run = Recorder(Completed(stdout=FULL + '\n'))
        self.assertEqual(selector.resolve_commit(ABBREV, run=run), FULL)
        self.assertEqual(run.calls[0], ['git', 'rev-parse', '--verify', f'{ABBREV}^{{commit}}'])

    def test_resolving_happens_even_for_a_revision_that_already_looks_full(self) -> None:
        # Not a short-circuit: `git rev-parse` is also what REJECTS a revision that does not
        # exist, so skipping it for a 40-hex string would accept a fabricated SHA.
        run = Recorder(Completed(stdout=FULL + '\n'))
        self.assertEqual(selector.resolve_commit(FULL, run=run), FULL)
        self.assertEqual(len(run.calls), 1)

    def test_an_unresolvable_revision_is_loud_and_not_an_empty_answer(self) -> None:
        run = Recorder(Completed(stdout='', returncode=128, stderr='unknown revision'))
        with self.assertRaises(selector.RevisionError) as caught:
            selector.resolve_commit('nope', run=run)
        self.assertIn('nope', str(caught.exception))

    def test_output_that_is_not_a_full_sha_is_loud(self) -> None:
        run = Recorder(Completed(stdout='not-a-sha\n'))
        with self.assertRaises(selector.RevisionError):
            selector.resolve_commit(ABBREV, run=run)

    def test_it_resolves_against_the_repository_it_lives_in(self) -> None:
        run = Recorder(Completed(stdout=FULL + '\n'))
        selector.resolve_commit(ABBREV, run=run)
        self.assertEqual(run.kwargs[0]['cwd'], str(REPO_ROOT))

    def test_it_resolves_the_real_head_of_this_checkout(self) -> None:
        # No fake: `git` is present in CI and the module lives inside its own repository, so the
        # resolution is exercised against the real thing rather than only against a stand-in.
        sha = selector.resolve_commit('HEAD')
        self.assertRegex(sha, r'^[0-9a-f]{40}$')
        self.assertEqual(selector.resolve_commit(sha[:7]), sha)


class RunsPathTest(unittest.TestCase):
    """The URL builder is the choke point that the defect slipped past."""

    def test_it_builds_the_api_path_for_a_full_sha(self) -> None:
        self.assertEqual(
            selector.runs_path('AgentiX-E/micro-kinetic-ts', FULL),
            f'/repos/AgentiX-E/micro-kinetic-ts/actions/runs?head_sha={FULL}&per_page=50',
        )

    def test_an_abbreviated_sha_cannot_reach_the_query(self) -> None:
        # This is the measured defect in one assertion: the filter matches the full SHA only, so
        # an abbreviation returns zero runs and the caller reads a false "no run" as an answer.
        with self.assertRaises(selector.QueryError) as caught:
            selector.runs_path('AgentiX-E/micro-kinetic-ts', ABBREV)
        self.assertIn('40', str(caught.exception))


class ChangedFilesTest(unittest.TestCase):
    """The change set is the input the trigger rule is measured against."""

    def test_it_reads_the_commit_own_change_set_by_default(self) -> None:
        run = Recorder(Completed(stdout='a.ts\nb/c.ts\n'))
        self.assertEqual(selector.changed_files(FULL, run=run), ['a.ts', 'b/c.ts'])
        self.assertEqual(run.calls[0], ['git', 'show', '--name-only', '--format=', FULL])

    def test_it_compares_against_a_base_when_one_is_given(self) -> None:
        # A push of several commits needs the range's base, or one commit's change set stands for
        # the push's and the trigger rule is measured against the wrong input.
        run = Recorder(Completed(stdout='a.ts\n'))
        selector.changed_files(FULL, base='HEAD~3', run=run)
        self.assertEqual(run.calls[0], ['git', 'diff', '--name-only', 'HEAD~3', FULL])

    def test_blank_lines_are_dropped(self) -> None:
        run = Recorder(Completed(stdout='a.ts\n\n  \nb.ts\n'))
        self.assertEqual(selector.changed_files(FULL, run=run), ['a.ts', 'b.ts'])

    def test_a_change_set_that_cannot_be_read_is_loud(self) -> None:
        run = Recorder(Completed(returncode=128, stderr='bad object'))
        with self.assertRaises(selector.RevisionError) as caught:
            selector.changed_files(FULL, run=run)
        self.assertIn('bad object', str(caught.exception))

    def test_it_reads_the_real_change_set_of_a_real_commit(self) -> None:
        # No fake: proves both argv forms are what `git` in this checkout actually accepts. The
        # assertions are properties rather than a file list, so committing this file does not
        # rewrite the test.
        #
        # `HEAD` against `HEAD` rather than `HEAD~1`: CI checks out at `fetch-depth: 1`, so a
        # parent commit does not exist there and a test needing one would pass locally and fail
        # in the gate. Comparing a commit with itself exercises the `--base` argv and is empty,
        # which is also the merge-commit case `changed_files` documents.
        head = selector.resolve_commit('HEAD')
        paths = selector.changed_files(head)
        self.assertTrue(paths)
        for path in paths:
            self.assertFalse(path.startswith('/'))
            self.assertEqual(path, path.strip())
        self.assertEqual(selector.changed_files(head, base=head), [])


class SelectRunsTest(unittest.TestCase):
    """One run per workflow file, and the most recent one wins."""

    def run_of(self, path: str, created: str, run_id: int = 1) -> dict:
        return {'id': run_id, 'path': f'.github/workflows/{path}', 'created_at': created}

    def test_it_keys_by_workflow_filename(self) -> None:
        runs = [self.run_of('ci.yml', '2026-09-18T00:00:00Z')]
        self.assertEqual(list(selector.select_runs(runs)), ['ci.yml'])

    def test_the_most_recent_run_of_a_file_wins(self) -> None:
        runs = [
            self.run_of('ci.yml', '2026-09-18T02:00:00Z', 2),
            self.run_of('ci.yml', '2026-09-18T00:00:00Z', 1),
        ]
        self.assertEqual(selector.select_runs(runs)['ci.yml']['id'], 2)

    def test_no_runs_is_an_empty_mapping_not_an_error(self) -> None:
        # Zero runs from the query is a FACT; whether it means "no golden is owed" is a separate
        # question, and answering it is `explain_absent_run`'s job.
        self.assertEqual(selector.select_runs([]), {})


class TriggerPathsTest(unittest.TestCase):
    """The rule is read from the workflow, so there is one owner for it."""

    def test_it_reads_the_real_workflow(self) -> None:
        self.assertEqual(
            selector.trigger_paths(WORKFLOW_TEXT),
            [
                '.github/workflows/benchmark-rcaeval.yml',
                'scripts/convert-parquet-to-json.py',
                'benchmarks/src/**',
                'packages/*/src/**',
            ],
        )

    def test_it_is_scoped_to_the_push_trigger(self) -> None:
        # The same file declares `workflow_run:` and job-level `paths:`; a scan of the whole text
        # would collect their entries and answer a different question.
        text = (
            'on:\n'
            '  push:\n'
            '    paths:\n'
            "      - 'packages/*/src/**'\n"
            '  workflow_run:\n'
            '    paths:\n'
            "      - 'decoy/one/**'\n"
            'jobs:\n'
            '  build:\n'
            '    paths:\n'
            "      - 'decoy/two/**'\n"
        )
        self.assertEqual(selector.trigger_paths(text), ['packages/*/src/**'])

    def test_comments_and_blank_lines_are_not_entries(self) -> None:
        text = (
            'on:\n'
            '  push:\n'
            '    paths:\n'
            '      # a note about the entry below\n'
            "      - 'a/**'\n"
            '\n'
            "      - 'b/**'\n"
        )
        self.assertEqual(selector.trigger_paths(text), ['a/**', 'b/**'])

    def test_a_workflow_with_no_push_trigger_is_loud(self) -> None:
        with self.assertRaises(selector.WorkflowShapeError) as caught:
            selector.trigger_paths('on:\n  workflow_dispatch:\n')
        self.assertIn('push', str(caught.exception))

    def test_a_push_trigger_with_no_paths_filter_is_loud(self) -> None:
        # No filter means EVERY push triggers the workflow; reporting an empty rule would let the
        # caller conclude that no push can ever owe a golden, which is the opposite of the truth.
        with self.assertRaises(selector.WorkflowShapeError):
            selector.trigger_paths('on:\n  push:\n    branches:\n      - main\n')

    def test_the_entry_list_ends_at_a_sibling_key(self) -> None:
        # `paths:` and `branches:` are siblings under `push:`, so the list ends when the next
        # sibling begins. A reader that kept going would collect `branches`' items — `main` — as
        # trigger patterns and quietly widen the filter.
        text = (
            'on:\n'
            '  push:\n'
            '    paths:\n'
            "      - 'a/**'\n"
            '    branches:\n'
            '      - main\n'
        )
        self.assertEqual(selector.trigger_paths(text), ['a/**'])

    def test_a_paths_filter_from_another_block_is_not_the_push_filter(self) -> None:
        # `push:` narrowed by branches and carrying NO filter, with a decoy `paths:` further down
        # the document. A reader that searched the whole file would answer with the decoy's
        # entries — a different question, answered confidently, and the answer is a filter that
        # says "no push owes a golden" when in truth every push does.
        text = (
            'on:\n'
            '  push:\n'
            '    branches:\n'
            '      - main\n'
            '  workflow_dispatch:\n'
            'jobs:\n'
            '  build:\n'
            '    steps:\n'
            '      - with:\n'
            '          paths:\n'
            "            - 'decoy/**'\n"
        )
        with self.assertRaises(selector.WorkflowShapeError):
            selector.trigger_paths(text)

    def test_an_entry_that_is_not_a_quoted_scalar_is_loud(self) -> None:
        text = 'on:\n  push:\n    paths:\n      - a/**\n'
        with self.assertRaises(selector.WorkflowShapeError):
            selector.trigger_paths(text)


class PathMatchesTest(unittest.TestCase):
    """The subset of GitHub's glob syntax the workflow actually uses, and nothing guessed."""

    def test_a_literal_path_matches_only_itself(self) -> None:
        self.assertTrue(selector.path_matches('docs/a.md', 'docs/a.md'))
        self.assertFalse(selector.path_matches('docs/a.md', 'docs/b.md'))
        self.assertFalse(selector.path_matches('docs/a.md', 'docs/a.md.bak'))

    def test_a_single_star_does_not_cross_a_separator(self) -> None:
        self.assertTrue(selector.path_matches('packages/*/src/**', 'packages/tree/src/a.ts'))
        self.assertFalse(selector.path_matches('packages/*/src/**', 'packages/a/b/src/x.ts'))

    def test_a_double_star_spans_separators(self) -> None:
        self.assertTrue(selector.path_matches('benchmarks/src/**', 'benchmarks/src/a/b/c.ts'))
        self.assertTrue(selector.path_matches('benchmarks/src/**', 'benchmarks/src/a.ts'))

    def test_the_engine_pattern_excludes_the_tests_beside_it(self) -> None:
        # The paths rule's whole point: `__tests__` cannot move the engine, so it owes no golden.
        self.assertFalse(selector.path_matches('packages/*/src/**', 'packages/tree/__tests__/a.ts'))
        self.assertFalse(selector.path_matches('packages/*/src/**', 'docs/a.md'))

    def test_a_double_star_may_stand_for_no_segment_at_all(self) -> None:
        self.assertTrue(selector.path_matches('a/**/b', 'a/b'))
        self.assertTrue(selector.path_matches('a/**/b', 'a/x/y/b'))
        self.assertFalse(selector.path_matches('a/**/b', 'a/b/c'))

    def test_the_anchors_are_both_ends(self) -> None:
        self.assertFalse(selector.path_matches('src/**', 'sub/src/a.ts'))

    def test_a_construct_outside_the_subset_is_loud_not_ignored(self) -> None:
        # A pattern is a claim about which pushes cost twenty minutes. Guessing at a construct
        # this module does not implement would make that claim silently.
        for pattern in (
            'a?.md',
            '!docs/**',
            '[abc]/**',
            'a\\*.md',
            'a**b/c',
            'a//b',
            '',
        ):
            with self.subTest(pattern=pattern):
                with self.assertRaises(selector.UnsupportedPatternError):
                    selector.path_matches(pattern, 'anything')


class BenchmarkRunOwedTest(unittest.TestCase):
    """The question the poller actually asks, answered from a change set."""

    PATTERNS = [
        '.github/workflows/benchmark-rcaeval.yml',
        'scripts/convert-parquet-to-json.py',
        'benchmarks/src/**',
        'packages/*/src/**',
    ]

    def test_a_docs_only_push_owes_nothing(self) -> None:
        owed, matched = selector.benchmark_run_owed(['docs/a.md'], self.PATTERNS)
        self.assertFalse(owed)
        self.assertEqual(matched, ())

    def test_a_test_only_push_owes_nothing(self) -> None:
        owed, _ = selector.benchmark_run_owed(
            ['packages/tree/__tests__/a.test.ts', 'benchmarks/__tests__/b.test.ts'], self.PATTERNS
        )
        self.assertFalse(owed)

    def test_an_engine_change_owes_one_and_names_the_entry(self) -> None:
        owed, matched = selector.benchmark_run_owed(['packages/tree/src/score.ts'], self.PATTERNS)
        self.assertTrue(owed)
        self.assertEqual(matched, ('packages/*/src/**',))

    def test_every_matching_entry_is_named(self) -> None:
        owed, matched = selector.benchmark_run_owed(
            ['packages/tree/src/a.ts', 'benchmarks/src/b.ts'], self.PATTERNS
        )
        self.assertTrue(owed)
        self.assertEqual(set(matched), {'packages/*/src/**', 'benchmarks/src/**'})

    def test_the_real_workflow_owes_a_golden_for_the_commit_under_test(self) -> None:
        # The measured case: d2625d0 changed the analyzer under `benchmarks/src/**`, and its push
        # DID start a benchmark run. Anything that says otherwise is wrong about the world.
        owed, matched = selector.benchmark_run_owed(
            [
                'benchmarks/src/fse26-diagnose-analyze.ts',
                'benchmarks/__tests__/fse26-diagnose-analyze.test.ts',
                'docs/fse26-cv-screen.md',
            ],
            selector.trigger_paths(WORKFLOW_TEXT),
        )
        self.assertTrue(owed)
        self.assertEqual(matched, ('benchmarks/src/**',))


class ExplainAbsentRunTest(unittest.TestCase):
    """A zero-run answer is EXPLAINED by measurement, never asserted."""

    PATTERNS = ['benchmarks/src/**', 'packages/*/src/**']

    def explain(self, changed: list[str], revision: str = ABBREV) -> str:
        return selector.explain_absent_run(
            revision=revision,
            changed=changed,
            patterns=self.PATTERNS,
            workflow='benchmark-rcaeval.yml',
        )

    def test_a_push_that_matches_a_trigger_cannot_be_explained_away(self) -> None:
        # The defect's own regression test. This commit's paths DO match, so a query that came
        # back empty is the QUERY's failure, and reporting it as "no golden is owed" told a
        # reader that an owed golden did not exist.
        with self.assertRaises(selector.GoldenOwedError) as caught:
            self.explain(['benchmarks/src/fse26-diagnose-analyze.ts'])
        message = str(caught.exception)
        self.assertIn('benchmark-rcaeval.yml', message)
        self.assertIn('benchmarks/src/**', message)

    def test_a_push_that_matches_nothing_names_what_it_checked(self) -> None:
        line = self.explain(['docs/a.md', 'packages/tree/__tests__/a.test.ts'])
        # The change set is named, so a reader can see the answer is a measurement rather than a
        # restatement of the sentence's own assumption.
        self.assertIn('docs/a.md', line)
        self.assertIn('packages/tree/__tests__/a.test.ts', line)

    def test_a_push_that_matches_nothing_names_the_rule_it_was_measured_against(self) -> None:
        line = self.explain(['docs/a.md'])
        self.assertIn('benchmarks/src/**', line)
        self.assertIn('packages/*/src/**', line)

    def test_an_empty_change_set_is_owed_nothing(self) -> None:
        # `git show --name-only` on a merge can be empty; an empty set matches no pattern, which
        # is the correct answer and not a case to special-case into silence.
        self.assertIn('0', self.explain([]))

    def test_the_revision_is_named_so_the_reader_can_re_run_the_query(self) -> None:
        self.assertIn(ABBREV, self.explain(['docs/a.md']))


class PollerUsesTheSelectorTest(unittest.TestCase):
    """The poller must not re-implement any of this — two owners is how the defect survived."""

    def setUp(self) -> None:
        self.poller = (
            Path('/Users/lambertyan/WorkBuddy/2026-08-08-10-23-08/.bench-cache/poll_sha.py')
        )
        if not self.poller.exists():
            self.skipTest('the poller lives outside the repository')

    def test_the_poller_resolves_the_revision_before_querying(self) -> None:
        text = self.poller.read_text('utf-8')
        self.assertIn('resolve_commit', text)
        self.assertIn('runs_path', text)

    def test_the_poller_does_not_build_a_head_sha_query_by_hand(self) -> None:
        text = self.poller.read_text('utf-8')
        self.assertNotRegex(text, re.compile(r'head_sha=\{' + 'sha' + r'\}'))

    def test_the_poller_does_not_assert_the_paths_rule_in_a_sentence(self) -> None:
        text = self.poller.read_text('utf-8')
        self.assertNotIn('does not touch a path that can move the engine', text)


if __name__ == '__main__':
    unittest.main()
