#!/usr/bin/env python3
"""Decide whether a push owes a golden benchmark run, and say WHY when one is missing.

The poller that reads the golden nine-cell needs to answer one question about a commit: *is a
benchmark run owed for this push?* It used to answer it by assertion. It handed the caller's
revision string straight to GitHub's ``head_sha`` filter and, on an empty response, printed

    no benchmark run: this push does not touch a path that can move the engine,
    so no golden is owed

Measured on 2026-09-18: ``head_sha=d2625d0`` returned ``total_count: 0`` while
``head_sha=d2625d05d33576f8d2575858c3d04ed3c6d309ca`` returned three runs for the SAME commit
(``ci.yml``, ``release.yml`` and ``benchmark-rcaeval.yml``). The filter matches the full
forty-character SHA only, and the commit whose golden was reported as not owed was in fact
running one. Two independent faults had to line up for that:

1. **A revision was never RESOLVED to a full SHA.** A short SHA is legal input everywhere else in
   this toolchain, so the abbreviation is the normal case, not the abuse case.
2. **A zero-run answer was EXPLAINED by a sentence rather than by a measurement.** "The paths do
   not match" and "the query was wrong" produced the identical line, so the wrong one was
   indistinguishable from the right one — the failure shape this repository keeps meeting.

So both live here now, each with a single owner: :func:`resolve_commit` for the revision, and
:func:`explain_absent_run` for the zero-run answer, which may only say "none is owed" after
matching the commit's own change set against the workflow's own ``push.paths``.

The trigger patterns are read from ``.github/workflows/benchmark-rcaeval.yml`` rather than
restated, because the filter is a claim about which changes can move the ranking. Its companion is
``benchmarks/__tests__/benchmark-rcaeval-trigger.test.ts``, which asks a different question about
the same list — whether an entry is PRESENT; this module asks whether THIS push matches one.

Usage:
  import golden_run_selector as selector
  sha = selector.resolve_commit('HEAD')
  selector.benchmark_run_owed(selector.changed_files(sha), selector.trigger_paths(text))
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

# The repository this module lives in. Both `git` calls are anchored here, so the answers do not
# depend on the directory the caller happened to be standing in.
REPO_ROOT = Path(__file__).resolve().parent.parent

# The workflow whose golden nine-cell the kill criterion's second half is a claim about.
BENCHMARK_WORKFLOW = 'benchmark-rcaeval.yml'

# GitHub's `head_sha` filter matches the full SHA and nothing shorter. Verified: an abbreviated
# revision returns `total_count: 0`, which is indistinguishable from "no runs exist".
FULL_SHA = re.compile(r'[0-9a-f]{40}')

# Glob constructs GitHub supports that this module deliberately does NOT implement. A pattern is a
# claim about which pushes cost twenty minutes, so an unimplemented construct is REFUSED rather
# than guessed at: silently reading `a?.md` as a literal path would quietly widen the filter.
_UNSUPPORTED_IN_SEGMENT = {
    '?': 'zero-or-one quantifier',
    '!': 'negative pattern',
    '[': 'character class',
    ']': 'character class',
    '{': 'brace expansion',
    '}': 'brace expansion',
    '\\': 'escape',
    '+': 'one-or-more quantifier',
}


class SelectorError(RuntimeError):
    """Base for every refusal this module makes."""


class RevisionError(SelectorError):
    """A revision could not be resolved to a commit, or resolved to something that is not one."""


class QueryError(SelectorError):
    """A query was about to be built that cannot answer the question it is asked."""


class WorkflowShapeError(SelectorError):
    """The workflow does not declare a `push.paths` filter, so the rule cannot be read."""


class UnsupportedPatternError(SelectorError):
    """A pattern uses a construct outside the implemented subset of GitHub's syntax."""


class GoldenOwedError(SelectorError):
    """A benchmark run was owed for this push and the query found none — the query is wrong."""


def resolve_commit(rev: str, *, run=subprocess.run) -> str:
    """
    Resolve any revision to the full forty-character SHA of the commit it names.

    Not a formatting nicety: GitHub's ``head_sha`` filter answers zero runs for an abbreviation, so
    a revision must pass through here before it is queried. `git rev-parse` is also what REJECTS a
    revision that does not exist, which is why an already-full SHA is still resolved rather than
    passed through — a fabricated forty-hex string would otherwise be accepted.

    @param rev: Any revision `git rev-parse` understands.
    @param run: Injected for testing; defaults to ``subprocess.run``.
    @returns: The full SHA, lowercase, forty characters.
    @throws RevisionError: If `git` cannot resolve the revision, or answers with something that is
        not a full SHA.
    """
    argv = ['git', 'rev-parse', '--verify', f'{rev}^{{commit}}']
    completed = run(argv, capture_output=True, text=True, cwd=str(REPO_ROOT), check=False)
    if completed.returncode != 0:
        raise RevisionError(
            f'git rev-parse could not resolve {rev!r}: {completed.stderr.strip() or "no message"}'
        )
    sha = completed.stdout.strip()
    if FULL_SHA.fullmatch(sha) is None:
        raise RevisionError(f'git rev-parse answered {sha!r} for {rev!r}, which is not a full SHA')
    return sha


def changed_files(sha: str, *, base: str | None = None, run=subprocess.run) -> list[str]:
    """
    The paths a commit changed, relative to the repository root.

    With no `base` this is the commit's OWN change set (``git show``), which is what a push of one
    commit changes and the only case this toolchain produces. A caller reading a push of several
    commits must pass the pushed range's base, or one commit's change set stands for the push's.

    A merge commit's ``git show`` is its combined diff and can legitimately be EMPTY; the caller
    then receives an empty list, and :func:`explain_absent_run` reports it as matching no trigger
    rather than inventing a reason.

    @param sha: A full SHA, as returned by :func:`resolve_commit`.
    @param base: The commit to compare against; omitted means the commit's own change set.
    @param run: Injected for testing; defaults to ``subprocess.run``.
    @returns: The changed paths, in git's own order, blanks dropped.
    @throws RevisionError: If `git` cannot produce the change set.
    """
    argv = (
        ['git', 'diff', '--name-only', base, sha]
        if base is not None
        else ['git', 'show', '--name-only', '--format=', sha]
    )
    completed = run(argv, capture_output=True, text=True, cwd=str(REPO_ROOT), check=False)
    if completed.returncode != 0:
        raise RevisionError(
            f'git could not read the change set of {sha!r}: '
            f'{completed.stderr.strip() or "no message"}'
        )
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


def _key_line(
    lines: list[str], key: str, *, start: int = 0, stop: int | None = None
) -> tuple[int, int] | None:
    """
    Find ``<indent><key>:`` on its own line, returning ``(index, indent)`` or ``None``.

    Line-oriented rather than a YAML parse on purpose: the failure this guards against is a
    MISSING ENTRY IN A LIST, and nothing but the list itself can see that. A parse would also
    accept a mapping written a different way, which the trigger filter is not.
    """
    pattern = re.compile(r'( *)' + re.escape(key) + r':\s*')
    for index in range(start, len(lines) if stop is None else stop):
        match = pattern.fullmatch(lines[index])
        if match is not None:
            return index, len(match.group(1))
    return None


def _block_end(lines: list[str], start: int, parent_indent: int) -> int:
    """The first line after `start` that is not blank, not a comment, and indented at or below
    `parent_indent` — that is, the first line that has left the block."""
    for index in range(start, len(lines)):
        line = lines[index]
        if line.strip() == '' or line.lstrip().startswith('#'):
            continue
        if len(line) - len(line.lstrip()) <= parent_indent:
            return index
    return len(lines)


def trigger_paths(workflow_text: str) -> list[str]:
    """
    The workflow's ``on.push.paths`` entries, exactly as written.

    Scoped to the ``push:`` block, so an entry under ``workflow_run:`` or inside a job can never
    satisfy a question about the TRIGGER. Restating the list here instead of reading it would make
    this module a second owner of a rule that already has one, and the two would drift.

    @param workflow_text: The workflow file's contents.
    @returns: The patterns, in declaration order.
    @throws WorkflowShapeError: If there is no ``push:`` trigger, no ``paths:`` under it, or an
        entry this reader cannot account for. A ``push:`` with no filter means EVERY push triggers
        the workflow, so reporting an empty rule would invert the truth.
    """
    lines = workflow_text.splitlines()
    push = _key_line(lines, 'push')
    if push is None:
        raise WorkflowShapeError('the workflow declares no push trigger, so no push owes a run')
    push_index, push_indent = push
    end = _block_end(lines, push_index + 1, push_indent)

    paths = _key_line(lines, 'paths', start=push_index + 1, stop=end)
    if paths is None:
        raise WorkflowShapeError(
            'the push trigger carries no paths filter, which means every push triggers it'
        )
    paths_index, paths_indent = paths

    entries: list[str] = []
    for index in range(paths_index + 1, end):
        line = lines[index]
        if line.strip() == '' or line.lstrip().startswith('#'):
            continue
        if len(line) - len(line.lstrip()) <= paths_indent:
            break
        match = re.fullmatch(r"\s*-\s*'([^']+)'\s*", line)
        if match is None:
            raise WorkflowShapeError(
                f'this reader only understands quoted list entries, and {line.strip()!r} is not one'
            )
        entries.append(match.group(1))
    return entries


def _segment_regex(segment: str) -> str:
    """One path segment as a regex, where `*` stops at the separator and every other character is
    literal. A construct outside the implemented subset is refused, never ignored."""
    if '**' in segment:
        raise UnsupportedPatternError(
            f"{segment!r} embeds '**' inside a segment; this module implements '**' only when it "
            f'stands for a whole segment, because its meaning inside one is not the same construct'
        )
    for char in segment:
        if char in _UNSUPPORTED_IN_SEGMENT:
            raise UnsupportedPatternError(
                f'{segment!r} uses {char!r} ({_UNSUPPORTED_IN_SEGMENT[char]}), which this module '
                f'does not implement; extend it deliberately rather than letting a filter be read '
                f'as something it is not'
            )
    return ''.join('[^/]*' if char == '*' else re.escape(char) for char in segment)


def _pattern_regex(pattern: str) -> str:
    """A whole pattern as an anchored regex, segment by segment."""
    if pattern == '':
        raise UnsupportedPatternError('an empty pattern matches nothing and is not a filter')
    segments = pattern.split('/')
    if '' in segments:
        raise UnsupportedPatternError(
            f'{pattern!r} contains an empty segment, which is a doubled or trailing separator'
        )
    pieces: list[str] = []
    for index, segment in enumerate(segments):
        last = index == len(segments) - 1
        # A spanning `**` that is not last already ends in a separator, so the one that would
        # follow it is suppressed — that is what lets `a/**/b` stand for `a/b` as well as
        # `a/x/y/b`.
        if index > 0 and not (segments[index - 1] == '**' and index - 1 < len(segments) - 1):
            pieces.append('/')
        if segment == '**':
            pieces.append('.*' if last else '(?:[^/]+/)*')
        else:
            pieces.append(_segment_regex(segment))
    return '^' + ''.join(pieces) + '$'


def path_matches(pattern: str, path: str) -> bool:
    """
    Whether a repository-relative path matches a trigger pattern.

    Implements the subset GitHub's ``paths`` filter is used with here: literal characters, ``*``
    within one segment, and ``**`` standing for a whole segment (zero or more of them). Everything
    else raises, so a pattern the module cannot honour fails loudly instead of being read as a
    literal path — a filter that silently narrows is a golden that silently is not run.

    @param pattern: One ``push.paths`` entry.
    @param path: A repository-relative path, without a leading slash.
    @raises UnsupportedPatternError: If `pattern` uses a construct outside the subset.
    """
    return re.fullmatch(_pattern_regex(pattern), path) is not None


def benchmark_run_owed(changed: list[str], patterns: list[str]) -> tuple[bool, tuple[str, ...]]:
    """
    Whether a change set can trigger the benchmark, and WHICH entries say so.

    The matching entries are returned rather than a bare boolean because the caller has to print
    the reason, and "the paths do not match" is only a measurement if it can name the paths it
    checked.

    @param changed: Repository-relative paths the push changed.
    @param patterns: The workflow's ``push.paths`` entries.
    @returns: ``(owed, matched)`` — the entries that matched, in declaration order.
    @raises UnsupportedPatternError: If any pattern uses a construct outside the subset, even when
        no changed path would have matched it.
    """
    matched = tuple(
        pattern for pattern in patterns if any(path_matches(pattern, path) for path in changed)
    )
    return len(matched) > 0, matched


def runs_path(repo: str, sha: str) -> str:
    """
    The API path that lists this commit's runs.

    The choke point the defect slipped through, so the guard lives here rather than at the call
    site: the filter matches the full SHA only, and an abbreviation produces the zero-run answer
    that reads exactly like "no runs exist".

    @param repo: ``owner/name``.
    @param sha: A full SHA, as returned by :func:`resolve_commit`.
    @raises QueryError: If `sha` is not a full SHA.
    """
    if FULL_SHA.fullmatch(sha) is None:
        raise QueryError(
            f'head_sha needs the full 40-character SHA and {sha!r} is {len(sha)} character(s); '
            f'an abbreviated revision answers zero runs, which is indistinguishable from "none '
            f'exist" — resolve it with resolve_commit first'
        )
    return f'/repos/{repo}/actions/runs?head_sha={sha}&per_page=50'


def select_runs(runs: list[dict]) -> dict[str, dict]:
    """
    The most recent run per workflow FILE, keyed by filename.

    Selecting by position was this toolchain's first version of the mistake: a CI run read as a
    benchmark run produced a report about a log with no cells in it. The filename is the key
    because the filename is what decides whether a run can produce the nine cells.

    @param runs: One page of the API's ``workflow_runs``.
    @returns: Filename to run.
    """
    by_path: dict[str, dict] = {}
    for run in sorted(runs, key=lambda one: one['created_at']):
        by_path[run['path'].split('/')[-1]] = run
    return by_path


def explain_absent_run(
    *, revision: str, changed: list[str], patterns: list[str], workflow: str
) -> str:
    """
    The line to print when the query found no benchmark run for a commit.

    There are two ways to get here and only one of them is innocent. If the push's own change set
    matches a trigger entry, the empty answer is the QUERY's, and saying "no golden is owed" would
    tell a reader that an owed golden does not exist — so that case raises. Only a push measured
    against the workflow's own filter and matching none of it earns the sentence.

    @param revision: The revision as the caller wrote it, so the reader can re-run the query.
    @param changed: The commit's changed paths.
    @param patterns: The workflow's ``push.paths`` entries.
    @param workflow: The workflow's filename, named in both answers.
    @returns: The line to print, naming the change set and the rule it was measured against.
    @raises GoldenOwedError: If the change set matches a trigger entry.
    """
    owed, matched = benchmark_run_owed(changed, patterns)
    if owed:
        raise GoldenOwedError(
            f'{workflow} IS triggered by {revision}: {len(changed)} changed path(s) match '
            f'{", ".join(matched)} — so the empty answer belongs to the QUERY, not to the push. '
            f'Resolve the full SHA with resolve_commit and repeat it.'
        )
    if changed:
        naming = f'its {len(changed)} changed path(s): {", ".join(changed)}.'
    else:
        naming = 'its 0 changed path(s), which match nothing.'
    return (
        f'  no benchmark run for {revision}, and none is owed — {naming} None of them matches any '
        f'of the {len(patterns)} trigger path(s) in {workflow}: {", ".join(patterns)}.'
    )
