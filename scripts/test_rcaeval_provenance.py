"""The converted RCAEval artifact's identity: its key, its stamp, and the sites that used to guess.

**The defect these tests were written against, measured on 2026-09-25.** `cache-datasets.yml`
triggered on a change to `scripts/convert-parquet-to-json.py` and keyed its cache on the constant
`RCAEvalJSON`, so the trigger could never act:

| run | commit | `Restore cached JSON` | `Convert Parquet to JSON` |
| --- | --- | --- | --- |
| `35505798520` | `2b15f6e` — **the commit that fixed the bridge** | hit, 2 min 27 s | **skipped** |
| `35496563670` … `31244207795` | nine more, six of them the weekly schedule | hit | skipped |

The last conversion was `31242187872` on 2026-08-08, whose log is the only record anywhere that the
artifact came from **pandas 3.0.5 / pyarrow 25.0.0** — installed unpinned, and named in no key.

**The constant was typed at twenty-six sites in eleven workflows**, and the same blocks carried
`restore-keys: RCAEval-json-`, a prefix that can never match `RCAEvalJSON` — so the fallback was dead
at every one of them. A key that is spelled in twenty-six places and names nothing in any of them
is not a key; it is a habit.

So the rules below are, in both directions wherever a rule has two halves:

1. the key is DERIVED from the files that decide the artifact, and a one-byte change to any of them
   moves it while a change to a test file does not;
2. no workflow may type a key for this artifact — every `key:` in `.github/` is either the derivation
   or on the recorded list of upstream constants, and each recorded constant must still be used;
3. the workflow's `paths:` trigger and the digest's file set are the SAME declaration;
4. the pin has one owner, and the bridge installs from it;
5. the stamp is invisible to every reader of the artifact, checked against the readers themselves.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import re
import runpy
import shutil
import sys
import tempfile
import unittest
from typing import Callable
from unittest import mock

import rcaeval_provenance as prov

SCRIPTS = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parent
WORKFLOWS = REPO_ROOT / '.github/workflows'
ACTIONS = REPO_ROOT / '.github/actions'
ACTION = ACTIONS / 'rcaeval-json/action.yml'
CACHE_WORKFLOW = WORKFLOWS / 'cache-datasets.yml'
BENCHMARK_WORKFLOW = WORKFLOWS / 'benchmark-rcaeval.yml'


class _Clock:
    """A monotonic clock whose sleeping advances it, so a bounded wait is testable in microseconds."""

    def __init__(self) -> None:
        self.time = 0.0
        self.slept: list[float] = []

    def now(self) -> float:
        """@returns The current time."""
        return self.time

    def sleep(self, seconds: float) -> None:
        """Advance the clock and record the interval.

        @param seconds - The interval.
        """
        self.slept.append(seconds)
        self.time += seconds

#: The composite action's invocation, as a workflow writes it. The `./` prefix is what makes it
#: local; matching it exactly is what stops a site from silently going back to `actions/cache`.
ACTION_USES = 'uses: ./.github/actions/rcaeval-json'

#: The roles the action may be asked to play. `prepare` expects a miss and converts; `consume`
#: requires a hit and refuses a foreign artifact; `save` publishes.
ACTION_MODES = ('prepare', 'consume', 'save')

#: A cache step's `key`, in a workflow or in the action. The VALUE is the thing under test.
KEY_LINE = re.compile(r'^(\s*)key:\s*(.*)$')

#: The stamp's neighbourhood: a cache step that reaches for the artifact's path itself, rather than
#: through the action that owns the path. Every spelling of the directory is caught — `~`,
#: `$HOME` and a bare path — because the rule is about the DIRECTORY, not about how it is written.
CACHE_PATH_LINE = re.compile(r'^\s*path:\s*.*RCAEval-json.*$')

#: The predicate every walker of the artifact directory must carry: only a DIRECTORY is descended
#: into, and never one whose name starts with a dot. Both halves matter -- the stamp is a file, so
#: the first half excludes it, and it is dot-prefixed, so the second half would exclude it too.
DOT_DIRECTORY_PREDICATE = re.compile(
    r"\w+\.isDirectory\(\)\s*&&\s*!\s*\w+\.name\.startsWith\(['\"]\.['\"]\)"
)

#: Any test for a directory at all, which is what makes a line a reader's decision point.
IS_DIRECTORY = re.compile(r'\w+\.isDirectory\(\)')

#: A cache step's `path:` as an EXACT declaration of the artifact directory. A substring test is
#: defeated by a suffix -- `path: ~/RCAEval-json-old` contains `path: ~/RCAEval-json` -- which the
#: mutation pass demonstrated by surviving on the first version of this fence.
ARTIFACT_PATH_LINE = re.compile(r'^\s*path:\s*~/RCAEval-json\s*$', re.M)


def workflow_files() -> list[pathlib.Path]:
    """Every workflow, derived from the filesystem so a new one enters these rules by existing.

    @returns The workflow paths, sorted.
    """
    return sorted(WORKFLOWS.glob('*.yml'))


def action_sites() -> list[tuple[pathlib.Path, int, str]]:
    """Every invocation of the artifact action: its file, its line, and the mode it asks for.

    @returns One tuple per site.
    """
    sites: list[tuple[pathlib.Path, int, str]] = []
    for path in workflow_files():
        lines = path.read_text('utf-8').split('\n')
        for index, line in enumerate(lines):
            if ACTION_USES not in line:
                continue
            mode = ''
            for follower in lines[index + 1: index + 6]:
                match = re.match(r'^\s*mode:\s*(\S+)\s*$', follower)
                if match:
                    mode = match.group(1)
                    break
            sites.append((path, index + 1, mode))
    return sites


def key_values() -> list[tuple[str, int, str]]:
    """Every `key:` declaration under `.github/`, with its raw value.

    @returns One tuple per declaration: the file's name, its line, and the value as written.
    """
    found: list[tuple[str, int, str]] = []
    for path in sorted(list(WORKFLOWS.glob('*.yml')) + list(ACTIONS.rglob('*.yml'))):
        for index, line in enumerate(path.read_text('utf-8').split('\n'), 1):
            match = KEY_LINE.match(line)
            if match:
                found.append((str(path.relative_to(REPO_ROOT)), index, match.group(2).strip()))
    return found


def walkers_that_descend_directories() -> list[pathlib.Path]:
    """The TypeScript modules that could meet the stamp: they read a directory AND test for one.

    Derived from the filesystem rather than listed, because a rule about a reader's population is
    only worth having if a new reader enters it. The test for a directory is what selects them: a
    module that lists a flat directory of charters (`rcaeval-topology.ts` reads a config directory)
    cannot admit the stamp and is correctly not a member.

    @returns The module paths, sorted.
    """
    members: list[pathlib.Path] = []
    for root in (REPO_ROOT / 'benchmarks/src', SCRIPTS):
        for path in sorted(root.glob('*.ts')):
            text = path.read_text('utf-8')
            if 'readdirSync(' in text and 'isDirectory()' in text:
                members.append(path)
    return members


def action_outputs() -> set[str]:
    """The output names the action declares, read from the action itself.

    @returns The names.
    """
    names: set[str] = set()
    inside = False
    for line in ACTION.read_text('utf-8').split('\n'):
        if line.startswith('outputs:'):
            inside = True
            continue
        if inside:
            if line and not line.startswith(' '):
                break
            match = re.match(r'^  ([\w-]+):\s*$', line)
            if match:
                names.add(match.group(1))
    return names


def action_step_ids() -> dict[str, str]:
    """The `id` of every step that invokes the action, mapped to the workflow that names it.

    @returns The ids, which are what a caller's `steps.<id>.outputs.<name>` refers to.
    """
    ids: dict[str, str] = {}
    for path in workflow_files():
        lines = path.read_text('utf-8').split('\n')
        for index, line in enumerate(lines):
            if ACTION_USES not in line:
                continue
            for back in range(index - 1, max(-1, index - 4), -1):
                match = re.match(r'^\s+id:\s*(\S+)\s*$', lines[back])
                if match:
                    ids[match.group(1)] = path.name
                    break
    return ids


def job_graph(path: pathlib.Path) -> dict[str, list[str]]:
    """A workflow's jobs and what each `needs`, read from the text.

    THREE spellings, and the first version of this reader handled one of the two it claimed to,
    which the rule below caught on its first run: `needs: a`, `needs: [a, b]` — a FLOW sequence, whose
    comma-separated list is not `\\S+` — and the block form on following lines. A graph rather than a
    flat scan because the property under test is TRANSITIVE: an ablation job does not name the job
    that waits, it names the job that does.

    @param path - The workflow file.
    @returns Job name -> the jobs it needs, directly.
    """
    graph: dict[str, list[str]] = {}
    job: str | None = None
    collecting: str | None = None
    for line in path.read_text('utf-8').split('\n'):
        header = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', line)
        if header:
            job = header.group(1)
            graph.setdefault(job, [])
            collecting = None
            continue
        if job is None:
            continue
        flow = re.match(r'^\s+needs:\s*\[([^\]]*)\]\s*$', line)
        if flow:
            graph[job] = [item.strip() for item in flow.group(1).split(',') if item.strip()]
            collecting = None
            continue
        inline = re.match(r'^\s+needs:\s*(\S+)\s*$', line)
        if inline:
            graph[job] = [inline.group(1)]
            collecting = None
            continue
        if re.match(r'^\s+needs:\s*$', line):
            collecting = job
            continue
        if collecting is not None:
            item = re.match(r'^\s+-\s*(\S+)\s*$', line)
            if item:
                graph[job].append(item.group(1))
                continue
            collecting = None
    return graph


def reaches(graph: dict[str, list[str]], start: str, target: str) -> bool:
    """Whether `start` reaches `target` through `needs`, transitively.

    @param graph - The job graph.
    @param start - The job to walk from.
    @param target - The job to reach.
    @returns Whether a path exists.
    """
    seen: set[str] = set()
    queue = [start]
    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)
        if current == target:
            return True
        queue.extend(graph.get(current, []))
    return False


def requirements_reachable(entry: str) -> set[str]:
    """Every requirements file reachable from `entry` through `-r`, `entry` included.

    @param entry - The filename, relative to `scripts/`.
    @returns The filenames reached, by their basenames.
    """
    seen: set[str] = set()
    queue = [entry]
    while queue:
        current = queue.pop()
        if current in seen:
            continue
        seen.add(current)
        for line in (SCRIPTS / current).read_text('utf-8').split('\n'):
            match = re.match(r'^\s*-r\s+(\S+)\s*$', line)
            if match:
                queue.append(pathlib.Path(match.group(1)).name)
    return seen


def _write_producer(root: pathlib.Path) -> pathlib.Path:
    """Materialise the bridge and its pin file under `root`, so a digest can be taken of them.

    @param root - The directory to populate; created if absent.
    @returns `root`.
    """
    root.mkdir(parents=True, exist_ok=True)
    (root / prov.PRODUCER_FILES[0]).write_text('print("bridge")\n', encoding='utf-8')
    (root / prov.PRODUCER_FILES[1]).write_text('pandas==1.0.0\n', encoding='utf-8')
    return root


class TheKeyNamesItsProducer(unittest.TestCase):
    """Rule 1. The key is a function of the files that decide the artifact, and of nothing else."""

    def test_the_key_is_DERIVED_and_not_the_constant_it_replaced(self) -> None:
        key = prov.cache_key(SCRIPTS)
        self.assertTrue(key.startswith(prov.KEY_PREFIX), key)
        # The regression, as a permanent fence: the old key was `RCAEvalJSON`, which is a prefix of
        # every derived key and would satisfy a `startswith` check alone. Assert the SUFFIX.
        self.assertNotEqual(key, 'RCAEvalJSON')
        suffix = key.removeprefix(prov.KEY_PREFIX)
        self.assertEqual(len(suffix), prov.KEY_DIGEST_CHARS)
        self.assertTrue(all(c in '0123456789abcdef' for c in suffix), suffix)

    def test_the_key_is_the_digest_of_the_producer(self) -> None:
        # The key may not be a second, independent derivation: it has to be THE digest, truncated.
        digest = prov.producer_digest(SCRIPTS).removeprefix('sha256:')
        self.assertEqual(prov.cache_key(SCRIPTS), prov.KEY_PREFIX + digest[: prov.KEY_DIGEST_CHARS])

    def test_a_ONE_BYTE_change_to_the_bridge_MOVES_the_key(self) -> None:
        # The whole finding, in one assertion. `2b15f6e` changed the bridge by more than a byte and
        # the key did not move; this is the check that would have caught it.
        with tempfile.TemporaryDirectory() as tmp:
            before = prov.cache_key(_write_producer(pathlib.Path(tmp)))
            bridge = pathlib.Path(tmp) / prov.PRODUCER_FILES[0]
            bridge.write_text(bridge.read_text('utf-8') + '\n', encoding='utf-8')
            self.assertNotEqual(before, prov.cache_key(pathlib.Path(tmp)))

    def test_a_change_to_a_TEST_file_does_NOT_move_the_key(self) -> None:
        # The other direction, and the reason the digest's file set is explicit: a test-runner edit
        # must not force a 20-minute rebuild, or every real invalidation is buried in noise.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp))
            before = prov.cache_key(root)
            (root / 'test_convert_parquet_to_json.py').write_text('# a new test\n', encoding='utf-8')
            self.assertEqual(before, prov.cache_key(root))

    def test_a_change_to_the_PIN_moves_the_key(self) -> None:
        # The pin decides the bytes as surely as the code does, which is why it is in the set -- and
        # why the version is now recoverable from the artifact instead of from a run's log.
        with tempfile.TemporaryDirectory() as tmp:
            before = prov.cache_key(_write_producer(pathlib.Path(tmp)))
            pin = pathlib.Path(tmp) / prov.PRODUCER_FILES[1]
            pin.write_text('pandas==9.9.9\n', encoding='utf-8')
            self.assertNotEqual(before, prov.cache_key(pathlib.Path(tmp)))

    def test_the_key_does_not_depend_on_WHERE_the_checkout_is(self) -> None:
        # The cache is repository-wide and the digest is over names and bytes with no absolute path,
        # so two copies of the same tree in different directories must agree. Asserted by copying.
        with tempfile.TemporaryDirectory() as tmp:
            first = _write_producer(pathlib.Path(tmp) / 'a')
            second = pathlib.Path(tmp) / 'b'
            shutil.copytree(first, second)
            self.assertEqual(prov.cache_key(first), prov.cache_key(second))

    def test_a_MISSING_producer_file_raises_rather_than_hashing(self) -> None:
        # A partially copied producer must not yield a digest that looks valid, or the key would
        # silently name a set that is not there.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp))
            (root / prov.PRODUCER_FILES[1]).unlink()
            with self.assertRaises(FileNotFoundError):
                prov.producer_digest(root)

    def test_every_producer_file_EXISTS_in_this_repository(self) -> None:
        # A filename in the set that does not exist would make every derivation raise at run time;
        # assert the set against the filesystem rather than trusting the tuple.
        for name in prov.PRODUCER_FILES:
            self.assertTrue((SCRIPTS / name).is_file(), name)

    def test_the_bridge_is_in_the_set_and_the_set_is_not_EMPTY(self) -> None:
        # The population may not be vacuous: a digest over nothing has one value, so every rule
        # above would hold for an empty set.
        self.assertGreaterEqual(len(prov.PRODUCER_FILES), 2)
        self.assertIn('convert-parquet-to-json.py', prov.PRODUCER_FILES)


class NoWorkflowTypesTheArtifactKey(unittest.TestCase):
    """Rule 2, both directions: nothing may name the artifact's key by hand, and no record may rot."""

    def test_no_workflow_names_the_path_as_a_CACHE_path(self) -> None:
        # The path, the key, the restore and the trust are the action's. If a workflow reaches for
        # `~/RCAEval-json` in a cache step, it has its own key again, and the key can drift.
        offenders = [
            (path.name, index)
            for path in workflow_files()
            for index, line in enumerate(path.read_text('utf-8').split('\n'), 1)
            if CACHE_PATH_LINE.match(line)
        ]
        self.assertEqual(offenders, [])

    def test_the_action_owns_the_path_AND_the_key(self) -> None:
        # The complement of the rule above: the action must actually cache the path, or the rule
        # would be satisfied by nothing caching it at all. EVERY `path:` in the action must be the
        # artifact directory -- the action has two (the restore and the save), and comparing the whole
        # set is what a substring test cannot do: `path: ~/RCAEval-json-old` contains the right text
        # and caches the wrong directory, which a mutation proved by SURVIVING the substring version.
        text = ACTION.read_text('utf-8')
        paths = re.findall(r'^\s*path:\s*(\S+)\s*$', text, re.M)
        self.assertEqual(paths, ['~/RCAEval-json', '~/RCAEval-json'], 'the action caches a wrong path')
        self.assertIn('${{ steps.key.outputs.key }}', text)

    def test_every_key_under_GITHUB_is_derived_or_a_RECORDED_upstream_constant(self) -> None:
        # Total, and the reason it is total: the defect was a key that had a value nobody derived.
        # Every `key:` in `.github/` therefore has to be one of exactly three shapes -- the derived
        # expression, a recorded upstream constant, or the outputs declaration's empty name.
        allowed = {'${{ steps.key.outputs.key }}', ''} | set(prov.UPSTREAM_CONSTANT_KEYS)
        for where, line, value in key_values():
            self.assertIn(value, allowed, f'{where}:{line} declares an underived key: {value!r}')

    def test_every_RECORDED_upstream_constant_is_STILL_USED(self) -> None:
        # The other direction. A recorded constant that no longer appears is a note about a key that
        # does not exist, and it would keep a real problem looking decided.
        used = {value for _, _, value in key_values()}
        for constant in prov.UPSTREAM_CONSTANT_KEYS:
            self.assertIn(constant, used, f'{constant} is recorded but used nowhere')

    def test_every_recorded_upstream_constant_carries_a_REASON(self) -> None:
        for constant, reason in prov.UPSTREAM_CONSTANT_KEYS.items():
            self.assertGreater(len(reason), 80, constant)

    def test_every_site_goes_through_the_ACTION(self) -> None:
        sites = action_sites()
        # Non-vacuity: twenty-six sites typed the constant in eleven workflows; if this reads zero
        # the rest of this class asserts nothing at all.
        self.assertGreaterEqual(len(sites), 20)
        self.assertGreaterEqual(len({path.name for path, _, _ in sites}), 8)

    def test_every_site_asks_for_a_DECLARED_mode(self) -> None:
        for path, line, mode in action_sites():
            self.assertIn(mode, ACTION_MODES, f'{path.name}:{line} asks for mode {mode!r}')

    def test_every_declared_mode_is_USED(self) -> None:
        # Both directions: a mode the action implements but nothing invokes is dead, and a mode a
        # site invokes but the action does not implement is a failure at run time. The action's own
        # input default is `prepare`, so `prepare` is invoked implicitly by the producer.
        used = {mode for _, _, mode in action_sites()}
        self.assertEqual(used, set(ACTION_MODES))

    def test_every_site_has_CHECKED_OUT_the_repository_it_needs(self) -> None:
        # The action runs `$GITHUB_WORKSPACE/scripts/...`, so a job that restores before checking out
        # would fail -- or worse, succeed against a stale script from another step's checkout.
        for path in workflow_files():
            lines = path.read_text('utf-8').split('\n')
            job = None
            checked: set[str] = set()
            for index, line in enumerate(lines, 1):
                header = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', line)
                if header:
                    job = header.group(1)
                    checked = set()
                if 'actions/checkout@' in line:
                    checked.add(job or '')
                if ACTION_USES in line:
                    self.assertIn(job, checked, f'{path.name}:{index} restores before checking out')

    def test_the_action_INVOKES_the_module_for_every_thing_it_claims(self) -> None:
        # The action is a wrapper; if it stops calling the module the rules above would still pass
        # while the key went back to being whatever the YAML said.
        text = ACTION.read_text('utf-8')
        self.assertIn('rcaeval_provenance.py', text)
        for flag in ('--key', '--verify'):
            self.assertIn(flag, text, flag)

    def test_every_output_a_caller_READS_is_one_the_action_DECLARES(self) -> None:
        # Found by re-reading this change rather than by running it: the producer's conditions were
        # changed to route through the action and kept asking for `cache-hit`, which is the shape
        # `actions/cache` uses and NOT an output this action declares -- a condition that would have
        # read empty and taken the same branch for a hit and a miss, converting nothing while looking
        # correct. Both halves are checked: the declared names, and the ones asked for.
        declared = action_outputs()
        self.assertEqual(declared, {'key', 'hit'})
        # Exactly one site branches on the result -- the producer -- and the other twenty-five
        # consumers need only the side effect, so they carry no `id` to be read by. That is why this
        # half of the rule is about the sites that DO name one: an unnamed site cannot read an output.
        ids = action_step_ids()
        self.assertGreaterEqual(len(ids), 1)
        asked = set()
        for path in workflow_files():
            for match in re.finditer(r'steps\.([\w-]+)\.outputs\.([\w-]+)', path.read_text('utf-8')):
                if match.group(1) in ids:
                    asked.add(match.group(2))
                    self.assertIn(
                        match.group(2),
                        declared,
                        f'{path.name} reads {match.group(1)}.outputs.{match.group(2)}, '
                        f'which the action does not declare',
                    )
        self.assertTrue(asked, 'nothing reads an output of the action, so this rule is vacuous')

    def test_the_ACTION_LINE_AND_KEY_LINE_patterns_answer_BOTH_WAYS(self) -> None:
        # Without this, three assertions above are satisfiable by a regex that never matches: a
        # `CACHE_PATH_LINE` that matches nothing passes the zero-offender test, and `KEY_LINE` that
        # matches nothing makes the total rule vacuous. Both directions are asserted here.
        self.assertTrue(CACHE_PATH_LINE.match('          path: ~/RCAEval-json'))
        self.assertTrue(CACHE_PATH_LINE.match('          path: $HOME/RCAEval-json'))
        self.assertIsNone(CACHE_PATH_LINE.match('            --data-dir ~/RCAEval-json \\'))
        self.assertEqual(KEY_LINE.match('          key: ${{ steps.k.outputs.key }}').group(2),
                         '${{ steps.k.outputs.key }}')
        self.assertIsNone(KEY_LINE.match('          restore-keys: |'))


class TheTriggerAndTheKeyAreOneDeclaration(unittest.TestCase):
    """Rule 3. The workflow's `paths:` and the digest's file set are derived from the same tuple."""

    @staticmethod
    def triggered_scripts() -> list[str]:
        """The `scripts/…` entries of `cache-datasets.yml`'s push trigger.

        @returns The paths, as written.
        """
        lines = CACHE_WORKFLOW.read_text('utf-8').split('\n')
        found: list[str] = []
        inside = False
        for line in lines:
            if re.match(r'^\s*paths:\s*$', line):
                inside = True
                continue
            if inside:
                match = re.match(r"^\s*-\s*'([^']+)'\s*$", line)
                if match:
                    found.append(match.group(1))
                else:
                    break
        return [entry for entry in found if entry.startswith('scripts/')]

    def test_the_trigger_names_EXACTLY_the_producer_files(self) -> None:
        # Both directions. The defect was a trigger that named the bridge while the key named the
        # constant; deriving both from one tuple is what makes that unexpressible, and this is the
        # assertion that keeps them derived.
        self.assertEqual(
            set(self.triggered_scripts()),
            {f'scripts/{name}' for name in prov.PRODUCER_FILES},
        )

    def test_the_trigger_also_names_the_WORKFLOW_and_the_ACTION(self) -> None:
        # A change to either is a change to how the artifact is built or named, and the run that
        # would act on the new key is this one.
        lines = CACHE_WORKFLOW.read_text('utf-8')
        self.assertIn("'.github/workflows/cache-datasets.yml'", lines)
        self.assertIn("'.github/actions/rcaeval-json/action.yml'", lines)

    def test_the_bridge_installs_from_the_file_the_key_DIGESTS(self) -> None:
        # The pin had no owner: it was `pip install pandas pyarrow` inline, so the artifact's producer
        # was recorded nowhere and is now recoverable only from a 2026-08-08 log.
        text = CACHE_WORKFLOW.read_text('utf-8')
        self.assertIn(f'pip install -r scripts/{prov.PRODUCER_FILES[1]}', text)
        self.assertNotIn('pip install pandas', text)

    def test_the_pin_has_ONE_owner(self) -> None:
        # Both directions: the dev file must pull the pin in, and must not repeat it. A pin written
        # in two places is two pins, and the gap between them is how the artifact's reader drifted
        # from the reader the gate measures.
        dev = (SCRIPTS / 'requirements-fse26-dev.txt').read_text('utf-8')
        self.assertIn(f'-r {prov.PRODUCER_FILES[1]}', dev)
        for package in ('pandas==', 'pyarrow=='):
            self.assertNotIn(package, dev, f'{package} is pinned in two files')

    def test_the_bridge_runs_under_the_interpreter_the_record_names(self) -> None:
        # `PRODUCER_PYTHON` is a record, not a mechanism: the digest covers the files that decide the
        # values, and the interpreter's remaining contribution is the JSON float representation,
        # which has been shortest-round-trip since 3.1. What this asserts is that the record cannot
        # drift from the workflow silently. `converter-tests` measures the bridge under 3.13, and
        # that divergence is stated in the module's docstring rather than closed in the commit that
        # already moves the artifact twice.
        match = re.search(r'python-version:\s*[\'"]?([\d.]+)', CACHE_WORKFLOW.read_text('utf-8'))
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), prov.PRODUCER_PYTHON)

    def test_the_producer_STAMPS_what_it_converted_and_then_VERIFIES_it(self) -> None:
        # A gap the mutation pass found: replacing the stamp step with anything else left every test
        # green, because the module's own round-trip was tested and nothing asserted the WORKFLOW
        # calls it. The job would then fail at its verify step at run time — loud, but only for one
        # run, and the fence would not have said so.
        text = CACHE_WORKFLOW.read_text('utf-8')
        lines = text.split('\n')
        stamp = next((i for i, line in enumerate(lines) if '--stamp' in line), None)
        verify = next((i for i, line in enumerate(lines) if '--verify' in line), None)
        self.assertIsNotNone(stamp, 'cache-datasets.yml never stamps what it converted')
        self.assertIsNotNone(verify, 'cache-datasets.yml never verifies the artifact it publishes')
        # Order matters: a conversion must be stamped before the artifact is checked, or the check
        # would refuse a dataset this checkout has just produced.
        self.assertLess(stamp, verify)
        for index in (stamp, verify):
            out_dir = ' '.join(lines[index: index + 3])
            self.assertIn('--out-dir', out_dir)
            self.assertIn('RCAEval-json', out_dir)
        # And the stamp may only be written by the run that CONVERTED. Stamping a restored artifact
        # would forge provenance for a dataset this checkout did not produce, which is the one thing
        # the stamp exists to prevent.
        condition = '\n'.join(lines[max(0, stamp - 5): stamp])
        self.assertIn("if: steps.cacheJson.outputs.hit != 'true'", condition)

    def test_the_pip_cache_notices_every_pin_the_gate_installs(self) -> None:
        # A third owner for the same pins is the pip cache's dependency list: if a transitively
        # included file is missing from it, a pin change resolves against a stale wheel set and the
        # gate measures a version nobody installed. Derived from the workflow's own `-r` graph in
        # both directions, so adding a requirements file cannot leave the list behind.
        ci = (WORKFLOWS / 'ci.yml').read_text('utf-8')
        install = re.search(r'pip install -r (\S+)', ci)
        self.assertIsNotNone(install)
        entry = pathlib.Path(install.group(1)).name
        listed = {
            pathlib.Path(line.strip()).name
            for line in re.search(r'cache-dependency-path:\s*\|(.+)', ci, re.S).group(1).split('\n')
            if line.strip().startswith('scripts/')
        }
        self.assertEqual(listed, requirements_reachable(entry))


class TheStampSaysWhoMadeTheArtifact(unittest.TestCase):
    """The artifact states its producer, and the reader refuses one that does not."""

    def test_a_stamp_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            out = pathlib.Path(tmp) / 'artifact'
            written = prov.write_stamp(out, root)
            self.assertEqual(written, prov.stamp_path(out))
            self.assertEqual(prov.verify_stamp(out, root), [])

    def test_an_artifact_with_NO_stamp_is_refused(self) -> None:
        # The unknown case, and the one that matters most: the 39 GB artifact that ten runs restored
        # had no way to state anything about itself, and a check that skips an unknown artifact would
        # have accepted it.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            problems = prov.verify_stamp(pathlib.Path(tmp) / 'nothing-here', root)
            self.assertEqual(len(problems), 1)
            self.assertIn('producer is unknown', problems[0])

    def test_an_artifact_another_bridge_made_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = pathlib.Path(tmp)
            first = _write_producer(base / 'first')
            out = base / 'artifact'
            prov.write_stamp(out, first)
            second = _write_producer(base / 'second')
            bridge = second / prov.PRODUCER_FILES[0]
            bridge.write_text('print("a different bridge")\n', encoding='utf-8')
            problems = prov.verify_stamp(out, second)
            self.assertEqual(len(problems), 1)
            self.assertIn('producerDigest mismatch', problems[0])

    def test_a_STALE_SCHEMA_is_refused(self) -> None:
        # A block whose shape changed is an unknown block, not a partial one.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            out = pathlib.Path(tmp) / 'artifact'
            prov.write_stamp(out, root)
            block = json.loads(prov.stamp_path(out).read_text('utf-8'))
            block['schemaVersion'] = prov.SCHEMA_VERSION + 1
            prov.stamp_path(out).write_text(json.dumps(block), encoding='utf-8')
            problems = prov.verify_stamp(out, root)
            self.assertEqual(len(problems), 1)
            self.assertIn('schemaVersion', problems[0])

    def test_an_UNREADABLE_stamp_is_refused_rather_than_treated_as_absent(self) -> None:
        # Two different faults with two different messages: "there is no record" and "the record is
        # corrupt" send a reader to different places, and collapsing them hides the second.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            out = pathlib.Path(tmp) / 'artifact'
            prov.write_stamp(out, root)
            prov.stamp_path(out).write_text('{not json', encoding='utf-8')
            problems = prov.verify_stamp(out, root)
            self.assertEqual(len(problems), 1)
            self.assertIn('unreadable', problems[0])

    def test_the_block_names_the_pin_it_was_built_with(self) -> None:
        # The version the artifact came from is unrecoverable today; the block is what makes it
        # recoverable from the artifact rather than from a log.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            block = prov.stamp_block(root)
            self.assertEqual(block['pinned'], prov.PRODUCER_FILES[1])
            self.assertEqual(len(block['pinnedSha256']), 64)
            self.assertTrue(block['producerDigest'].startswith('sha256:'))

    def test_the_revision_field_prefers_GITHUB_SHA_and_degrades_to_unknown(self) -> None:
        # This test's FIRST version asserted `producerRevision == 'unknown'` against a temp root and
        # PASSED locally while FAILING in CI: `converter_revision` reads `GITHUB_SHA` before it falls
        # back to git, so on a runner the field held the commit and the assertion was a statement
        # about the machine rather than about the module. Fourth instance of this repository's own
        # rule that a number belongs to its environment, and the second time CI caught it in a gate's
        # own reading. So BOTH branches are driven explicitly, and neither reads the ambient env.
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            with mock.patch.dict(os.environ, {'GITHUB_SHA': 'a' * 40}):
                self.assertEqual(prov.stamp_block(root)['producerRevision'], 'a' * 40)
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop('GITHUB_SHA', None)
                # A root that is not a git checkout: the fallback has nothing to read and must
                # degrade rather than raise, because a stamp that can fail is not a stamp.
                self.assertEqual(prov.stamp_block(root)['producerRevision'], 'unknown')

    def test_a_STAMP_written_under_a_git_root_records_the_revision(self) -> None:
        # The other direction of the revision path: this repository IS a git checkout, so the field
        # is a commit sha here and the fallback above is not the only shape it takes.
        self.assertRegex(prov.stamp_block(SCRIPTS)['producerRevision'], r'^[0-9a-f]{40}$|^unknown$')


class TheStampIsInvisibleToEveryReader(unittest.TestCase):
    """Rule 5: the readers themselves decide the stamp's name, so the name is checked against them."""

    def test_the_stamp_is_a_DOT_FILE_with_no_counted_extension(self) -> None:
        # The workflow's own census counts `*.json`, `*.csv` and `*.txt`. A stamp with any of those
        # suffixes would be counted as an artifact in the very table that reports the artifact's shape.
        self.assertTrue(prov.STAMP_NAME.startswith('.'))
        self.assertNotIn(prov.STAMP_NAME.rsplit('.', 1)[-1], {'json', 'csv', 'txt'})

    def test_every_reader_excludes_a_DOT_directory(self) -> None:
        readers = walkers_that_descend_directories()
        # Non-vacuity: nine modules descend the artifact directory. A rule over an empty population
        # passes for a predicate that always returns true, which is the trap this repository keeps
        # meeting.
        self.assertGreaterEqual(len(readers), 9)
        for path in readers:
            text = path.read_text('utf-8')
            # EVERY decision point, not one per file. `run-rcaeval.ts` tests for a directory twice,
            # and the first version of this rule ("the file contains the predicate") let one of the
            # two be mutated away while the other kept the file green -- a mutation that SURVIVED and
            # is the reason this rule is written per LINE.
            bare = [
                line.strip()
                for line in text.split('\n')
                if IS_DIRECTORY.search(line) and not DOT_DIRECTORY_PREDICATE.search(line)
            ]
            self.assertEqual(
                bare, [], f'{path.name} descends a directory without excluding dot names: {bare}'
            )
            self.assertTrue(DOT_DIRECTORY_PREDICATE.search(text), path.name)

    def test_the_reader_predicate_answers_BOTH_WAYS(self) -> None:
        self.assertTrue(DOT_DIRECTORY_PREDICATE.search("entry.isDirectory() && !entry.name.startsWith('.'))"))
        self.assertIsNone(DOT_DIRECTORY_PREDICATE.search('entry.isDirectory())'))
        self.assertIsNone(DOT_DIRECTORY_PREDICATE.search("entry.name.startsWith('.'))"))
        # And the per-line rule needs the coarser pattern to be able to SEE the bare form, or the
        # assertion above would pass over a file whose only decision point lost its filter.
        self.assertTrue(IS_DIRECTORY.search('        if (entry.isDirectory()) {'))
        self.assertIsNone(IS_DIRECTORY.search("        if (entry.name.startsWith('.')) {"))


class TheCommandLine(unittest.TestCase):
    """The three flags the action and the workflow call, and the exits they must produce."""

    def test_key_prints_the_GITHUB_OUTPUT_form(self) -> None:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(prov.main(['--root', str(SCRIPTS), '--key']), 0)
        self.assertEqual(out.getvalue().strip(), f'key={prov.cache_key(SCRIPTS)}')

    def test_stamp_writes_and_verify_accepts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            out = pathlib.Path(tmp) / 'artifact'
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                self.assertEqual(prov.main(['--root', str(root), '--stamp', '--out-dir', str(out)]), 0)
            self.assertIn('stamped', printed.getvalue())
            with contextlib.redirect_stdout(io.StringIO()) as ok:
                self.assertEqual(prov.main(['--root', str(root), '--verify', '--out-dir', str(out)]), 0)
            self.assertIn('stamp OK', ok.getvalue())

    def test_verify_reports_every_problem_and_exits_nonzero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_producer(pathlib.Path(tmp) / 'producer')
            with contextlib.redirect_stderr(io.StringIO()) as errors:
                status = prov.main(['--root', str(root), '--verify', '--out-dir', str(pathlib.Path(tmp) / 'absent')])
            self.assertEqual(status, 1)
            self.assertIn('ERROR', errors.getvalue())

    def test_a_missing_producer_is_an_ERROR_not_a_traceback(self) -> None:
        # The action calls this from a workflow; an exception would be an unreadable failure.
        with tempfile.TemporaryDirectory() as tmp:
            with contextlib.redirect_stderr(io.StringIO()) as errors:
                status = prov.main(['--root', tmp, '--key'])
            self.assertEqual(status, 1)
            self.assertIn('ERROR', errors.getvalue())

    def test_exactly_one_flag_is_required(self) -> None:
        for argv in ([], ['--key', '--stamp'], ['--verify'], ['--key', '--await'],
                     ['--stamp', '--await', '--verify']):
            with self.assertRaises(SystemExit) as ctx:
                with contextlib.redirect_stderr(io.StringIO()):
                    prov.main(argv)
            self.assertEqual(ctx.exception.code, 2, argv)

    def test_the_default_root_is_the_modules_own_directory(self) -> None:
        # A default of `.` would derive a key from whatever directory the caller happened to be in,
        # which for a workflow step is the repository root -- where the bridge is not.
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(prov.main(['--key']), 0)
        self.assertEqual(out.getvalue().strip(), f'key={prov.cache_key(SCRIPTS)}')

    def test_the_entrypoint_exits_with_the_status(self) -> None:
        saved = sys.argv
        sys.argv = ['rcaeval_provenance.py', '--root', str(SCRIPTS), '--key']
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as ctx:
                    runpy.run_path(str(SCRIPTS / 'rcaeval_provenance.py'), run_name='__main__')
        finally:
            sys.argv = saved
        self.assertEqual(ctx.exception.code, 0)


class TheWaitIsBoundedAndCheckable(unittest.TestCase):
    """The third consequence: the artifact is produced by ANOTHER workflow started by the same push.

    Measured 2026-09-25: a push that changed the bridge read four `failure` jobs on the benchmark's
    push run, because `consume` refuses an artifact whose producer is this commit's bridge and which
    does not exist YET. The refusal is correct — the alternative is reading another bridge's dataset
    and reporting it as a measurement of this tree — so what was missing is a declared wait.
    """

    def setUp(self) -> None:
        self.lines: list[str] = []
        self.asked: list[str] = []
        self.clock = _Clock()

    def _waiter(self, answers: list[bool]) -> Callable[..., bool]:
        """A checker that answers from `answers`, logging every key it was asked about.

        @param answers - The answers, consumed in order; the last one repeats.
        @returns The checker.
        """
        self.asked: list[str] = []

        def check(key: str, *, repo: str, token: str) -> bool:
            self.asked.append(key)
            return answers[min(len(self.asked) - 1, len(answers) - 1)]

        return check

    def test_a_published_key_returns_at_once_and_NEVER_SLEEPS(self) -> None:
        # The common case by far: a push that does not touch the bridge has the artifact already, so
        # the wait must cost one API call and no sleeping. A wait that always sleeps once would add
        # half a minute to every benchmark run.
        status = prov.await_cache_key(
            SCRIPTS,
            repo='o/r',
            token='t',
            checker=self._waiter([True]),
            clock=self.clock.now,
            sleep=self.clock.sleep,
            log=self.lines.append,
        )
        self.assertEqual(status, 0)
        self.assertEqual(self.clock.slept, [], 'a first-check hit must not sleep')
        self.assertEqual(len(self.asked), 1)
        # And it asks about the DERIVED key, which is what makes "the artifact for THIS tree" a
        # question with an answer rather than a guess about a run's state.
        self.assertEqual(self.asked[0], prov.cache_key(SCRIPTS))

    def test_a_key_that_appears_later_is_waited_for(self) -> None:
        status = prov.await_cache_key(
            SCRIPTS,
            repo='o/r',
            token='t',
            checker=self._waiter([False, False, True]),
            clock=self.clock.now,
            sleep=self.clock.sleep,
            log=self.lines.append,
        )
        self.assertEqual(status, 0)
        self.assertEqual(self.clock.slept, [prov.AWAIT_INTERVAL_SECONDS] * 2)
        self.assertIn('published', ' '.join(self.lines))

    def test_the_bound_is_a_BOUND_and_the_message_names_the_PRODUCER(self) -> None:
        # A wait with no bound cannot be told from a stuck one, which is the lesson the landing
        # instrument was built for. And a bound that expires must say WHOSE fault it is: this artefact
        # is produced by another workflow, so the reader has to be sent to that run.
        status = prov.await_cache_key(
            SCRIPTS,
            repo='o/r',
            token='t',
            max_minutes=1,
            interval_seconds=30,
            checker=self._waiter([False]),
            clock=self.clock.now,
            sleep=self.clock.sleep,
            log=self.lines.append,
        )
        self.assertEqual(status, 1)
        self.assertEqual(len(self.clock.slept), 2, 'one minute at thirty seconds is two sleeps')
        joined = ' '.join(self.lines)
        self.assertIn(prov.PRODUCER_WORKFLOW, joined)
        self.assertIn(prov.cache_key(SCRIPTS), joined)

    def test_zero_minutes_checks_ONCE_and_gives_up(self) -> None:
        # The degenerate bound must not loop: `elapsed + interval > deadline` at elapsed 0 is the
        # condition that ends it, and a version testing `>=` would sleep before the first check.
        status = prov.await_cache_key(
            SCRIPTS,
            repo='o/r',
            token='t',
            max_minutes=0,
            checker=self._waiter([False]),
            clock=self.clock.now,
            sleep=self.clock.sleep,
            log=self.lines.append,
        )
        self.assertEqual(status, 1)
        self.assertEqual(self.clock.slept, [])
        self.assertEqual(len(self.asked), 1)

    def test_a_FORBIDDEN_token_fails_at_once_rather_than_at_the_bound(self) -> None:
        # A 401/403 answers the same way seventy times. Retrying it would make a misconfigured
        # permission look like a slow producer, and the message has to name the missing scope.
        def forbidden(key: str, *, repo: str, token: str) -> bool:
            raise prov.CacheListForbidden(
                'the token cannot list caches for o/r (HTTP 403); the job needs `actions: read`'
            )

        status = prov.await_cache_key(
            SCRIPTS,
            repo='o/r',
            token='t',
            checker=forbidden,
            clock=self.clock.now,
            sleep=self.clock.sleep,
            log=self.lines.append,
        )
        self.assertEqual(status, 1)
        self.assertEqual(self.clock.slept, [])
        self.assertIn('actions: read', ' '.join(self.lines))

    def test_a_TRANSIENT_failure_is_retried_and_does_not_abort_the_wait(self) -> None:
        # A 5xx or a socket timeout is not "the artifact is absent", and treating it as one would
        # fail the job for a reason that has nothing to do with the producer. The fixture raises the
        # shape the SUBJECT actually sees — a `URLError`, which is what `urlopen` raises for a 502 and
        # what `HTTPError` subclasses — and not a bare `RuntimeError`, which is a shape no real
        # failure arrives in: the first version of this fixture used `RuntimeError` and it kept
        # passing only because the module then caught every exception.
        attempts: list[int] = []

        def flaky(key: str, *, repo: str, token: str) -> bool:
            attempts.append(1)
            if len(attempts) < 3:
                raise prov.urllib.error.URLError('HTTP 502')
            return True

        status = prov.await_cache_key(
            SCRIPTS,
            repo='o/r',
            token='t',
            checker=flaky,
            clock=self.clock.now,
            sleep=self.clock.sleep,
            log=self.lines.append,
        )
        self.assertEqual(status, 0)
        self.assertEqual(len(attempts), 3)
        self.assertIn('retrying', ' '.join(self.lines))

    def test_a_DEFECT_in_the_checker_propagates_instead_of_burning_the_bound(self) -> None:
        # Found by the mutation pass, and it is the difference between a wrong diagnosis and a slow
        # one: with a bare `except Exception`, a `TypeError` raised INSIDE the checker was treated as
        # "the answer did not arrive", so the wait retried every thirty seconds for the full bound and
        # then reported "no cache after 35 minutes" — sending the reader to the producer's run for a
        # fault that is entirely local. The mutation that exposed it hung the harness for the whole
        # bound, which is how a broken wait announces itself.
        def broken(key: str, *, repo: str, token: str) -> bool:
            raise TypeError("cache_exists() got an unexpected keyword argument 'repo'")

        with self.assertRaises(TypeError):
            prov.await_cache_key(
                SCRIPTS,
                repo='o/r',
                token='t',
                checker=broken,
                clock=self.clock.now,
                sleep=self.clock.sleep,
                log=self.lines.append,
            )
        self.assertEqual(self.clock.slept, [], 'a local defect must not be retried')

    def test_a_missing_environment_variable_fails_BEFORE_the_wait(self) -> None:
        # A wait that cannot ask the API must say so in a second, not after its bound. The names are
        # asserted LITERALLY rather than by iterating `AWAIT_ENV`, because the first version read its
        # expectation from the constant under test — so dropping a member from the tuple also dropped
        # it from the expectation, and the mutation SURVIVED. A check that reads its own subject
        # cannot see the subject change.
        with mock.patch.dict(os.environ, {}, clear=True):
            with contextlib.redirect_stderr(io.StringIO()) as errors:
                status = prov.main(['--root', str(SCRIPTS), '--await'])
        self.assertEqual(status, 2)
        for name in ('GITHUB_REPOSITORY', 'GITHUB_TOKEN'):
            self.assertIn(name, errors.getvalue())
        self.assertEqual(set(prov.AWAIT_ENV), {'GITHUB_REPOSITORY', 'GITHUB_TOKEN'})

    def test_the_CLI_delegates_to_the_wait_with_the_environment_it_read(self) -> None:
        # The delegation is the line the coverage gate reported as the module's only uncovered
        # statement: every wait test drove `await_cache_key` directly and every CLI test stopped at
        # the missing-variable check, so nothing ran `main` -> `await_cache_key`. A mode whose entry
        # point is never executed is a mode nobody has run.
        with mock.patch.dict(
            os.environ,
            {'GITHUB_REPOSITORY': 'AgentiX-E/micro-kinetic-ts', 'GITHUB_TOKEN': 'secret'},
            clear=False,
        ):
            with mock.patch.object(prov, 'cache_exists', lambda key, *, repo, token: True):
                with contextlib.redirect_stdout(io.StringIO()) as out:
                    self.assertEqual(prov.main(['--root', str(SCRIPTS), '--await']), 0)
            self.assertIn('published', out.getvalue())
            with mock.patch.object(prov, 'cache_exists', lambda key, *, repo, token: False):
                with contextlib.redirect_stdout(io.StringIO()) as failed:
                    self.assertEqual(
                        prov.main(['--root', str(SCRIPTS), '--await', '--max-minutes', '0']), 1
                    )
            self.assertIn(prov.PRODUCER_WORKFLOW, failed.getvalue())

    def test_the_default_bound_is_licensed_by_the_PRODUCERS_own_job_bound(self) -> None:
        # The number is not chosen for comfort, and both inequalities are asserted against an OWNER:
        # longer than the producer's own measured conversion (or it would expire on a conversion that
        # was going to finish), and shorter than the producer job's declared bound (so an expiry
        # indicts the producer rather than the consumer). The job that waits then declares a bound
        # longer than the wait, so it cannot be killed before its own check answers.
        self.assertGreater(
            prov.AWAIT_MAX_MINUTES * 60,
            prov.PRODUCER_CONVERSION_SECONDS,
            'the wait would expire before the producer has finished its slowest conversion',
        )
        produced = re.search(
            r'^  cache:\n(?:.*\n)*?    timeout-minutes: (\d+)',
            (REPO_ROOT / '.github/workflows/cache-datasets.yml').read_text('utf-8'),
            re.M,
        )
        self.assertIsNotNone(produced, 'cache-datasets.yml no longer bounds its producer job')
        self.assertLess(prov.AWAIT_MAX_MINUTES, int(produced.group(1)))
        waited = re.search(
            r'^  artifact:\n(?:.*\n)*?    timeout-minutes: (\d+)',
            BENCHMARK_WORKFLOW.read_text('utf-8'),
            re.M,
        )
        self.assertIsNotNone(waited, 'benchmark-rcaeval.yml no longer bounds the job that waits')
        self.assertGreater(int(waited.group(1)), prov.AWAIT_MAX_MINUTES)


class TheRealCheckerReadsGitHubsAnswer(unittest.TestCase):
    """`cache_exists` is the only part of the wait the unit tests could not drive through a return
    value, and the first version of them INJECTED a checker everywhere — so the function that actually
    talks to GitHub was never executed, which the coverage gate reported as ten missed statements in
    a module the fence claimed to cover. A stub is not a substitute for the subject."""

    class _Response:
        """A context manager over a JSON body, as `urlopen` returns one."""

        def __init__(self, payload: bytes) -> None:
            self.payload = payload

        def read(self) -> bytes:
            """@returns The body."""
            return self.payload

        def __enter__(self) -> TheRealCheckerReadsGitHubsAnswer._Response:
            """@returns self."""
            return self

        def __exit__(self, *exc: object) -> bool:
            """@param exc - Ignored.
            @returns False, so nothing is suppressed."""
            return False

    def _urlopen(self, payload: bytes, *, error: Exception | None = None) -> None:
        """Patch `urlopen` so `cache_exists` runs its own code against a controlled answer.

        @param payload - The JSON body to answer with.
        @param error - An exception to raise instead.
        """
        captured: list[object] = []

        def opener(request: object, timeout: int = 0) -> object:
            captured.append(request)
            if error is not None:
                raise error
            return self._Response(payload)

        self.requests = captured
        patcher = mock.patch.object(prov.urllib.request, 'urlopen', opener)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_listed_key_is_True_and_an_absent_one_is_False(self) -> None:
        self._urlopen(b'{"total_count": 1, "actions_caches": [{"key": "RCAEvalJSON-x"}]}')
        self.assertTrue(prov.cache_exists('RCAEvalJSON-x', repo='o/r', token='t'))
        self._urlopen(b'{"total_count": 0, "actions_caches": []}')
        self.assertFalse(prov.cache_exists('RCAEvalJSON-x', repo='o/r', token='t'))

    def test_the_request_asks_the_REPOSITORY_and_quotes_the_KEY(self) -> None:
        # The key is a URL parameter, so a key with a character that needs quoting must not change
        # WHICH cache is asked about — an unquoted key would answer about a different one and the
        # wait would return a false negative for the whole bound.
        self._urlopen(b'{"total_count": 0}')
        prov.cache_exists('RCAEvalJSON-a b+c', repo='AgentiX-E/micro-kinetic-ts', token='secret')
        request = self.requests[0]
        self.assertIn('/repos/AgentiX-E/micro-kinetic-ts/actions/caches?key=', request.full_url)
        self.assertNotIn('a b+c', request.full_url)
        self.assertIn('RCAEvalJSON-a%20b%2Bc', request.full_url)
        self.assertEqual(request.get_header('Authorization'), 'Bearer secret')

    def test_a_401_or_403_is_PERMANENT_and_a_500_is_not(self) -> None:
        # The distinction the wait is built on: a token that cannot read the cache list answers the
        # same way seventy times, while a 5xx may clear. Collapsing them either wastes the bound or
        # fails a job for a reason that has nothing to do with the producer.
        for code in (401, 403):
            self._urlopen(
                b'', error=prov.urllib.error.HTTPError('u', code, 'no', {}, None)  # type: ignore[arg-type]
            )
            with self.assertRaises(prov.CacheListForbidden) as caught:
                prov.cache_exists('k', repo='o/r', token='t')
            self.assertIn('actions: read', str(caught.exception))
        self._urlopen(b'', error=prov.urllib.error.HTTPError('u', 502, 'bad', {}, None))  # type: ignore[arg-type]
        with self.assertRaises(prov.urllib.error.HTTPError):
            prov.cache_exists('k', repo='o/r', token='t')


class EveryConsumerNeedsTheWait(unittest.TestCase):
    """The wait is a JOB, so the declaration that uses it has to depend on it — transitively."""

    def consumers(self) -> set[str]:
        """The jobs that restore the artifact.

        @returns The job names.
        """
        found: set[str] = set()
        job = None
        for line in BENCHMARK_WORKFLOW.read_text('utf-8').split('\n'):
            header = re.match(r'^  ([A-Za-z0-9_-]+):\s*$', line)
            if header:
                job = header.group(1)
            if ACTION_USES in line and job:
                found.add(job)
        return found

    def test_the_workflow_HAS_a_job_that_waits(self) -> None:
        graph = job_graph(BENCHMARK_WORKFLOW)
        self.assertIn('artifact', graph)
        self.assertEqual(graph['artifact'], [], 'the wait is the root of this dependency')
        self.assertIn('--await', BENCHMARK_WORKFLOW.read_text('utf-8'))

    def test_every_consumer_reaches_the_wait_TRANSITIVELY(self) -> None:
        # Transitively, because the ablation jobs name the rcaeval jobs rather than the wait: a rule
        # that demanded a direct `needs` would pass while the ablations started before the artifact
        # existed, and they are the longest jobs in the file.
        graph = job_graph(BENCHMARK_WORKFLOW)
        consumers = self.consumers()
        self.assertGreaterEqual(len(consumers), 7)
        for job in sorted(consumers):
            self.assertTrue(
                reaches(graph, job, 'artifact'),
                f'{job} restores the artifact without waiting for the producer to publish it',
            )

    def test_the_wait_job_declares_the_PERMISSION_its_check_needs(self) -> None:
        # `cache_exists` queries the caches API, which needs `actions: read`. A `permissions:` block
        # REPLACES the defaults, so without this line the wait would fail on a 403 — and the failure
        # would look like a missing artifact.
        text = BENCHMARK_WORKFLOW.read_text('utf-8')
        block = re.search(r'^permissions:\n((?:  \S.*\n|    .*\n)+)', text, re.M)
        self.assertIsNotNone(block, 'benchmark-rcaeval.yml declares no permissions block')
        self.assertIn('actions: read', block.group(1))

    def test_the_graph_reader_answers_BOTH_WAYS(self) -> None:
        # `reaches` is what the rule above is built on, so a version that returned True for
        # everything would satisfy it vacuously. And the READER is driven over all three `needs:`
        # spellings, because the first version of it handled one of the two it claimed to and the
        # rule above passed over a graph in which every `[a, b]` job had no dependencies at all.
        graph = {'a': ['b'], 'b': ['c'], 'c': [], 'd': []}
        self.assertTrue(reaches(graph, 'a', 'c'))
        self.assertTrue(reaches(graph, 'b', 'b'))
        self.assertFalse(reaches(graph, 'd', 'c'))
        self.assertFalse(reaches(graph, 'missing', 'c'))

        with tempfile.TemporaryDirectory() as tmp:
            sample = pathlib.Path(tmp) / 'w.yml'
            sample.write_text(
                'jobs:\n'
                '  one:\n    needs: a\n    runs-on: ubuntu-latest\n'
                '  two:\n    needs: [a, b]\n    runs-on: ubuntu-latest\n'
                '  three:\n    needs:\n      - a\n      - b\n    runs-on: ubuntu-latest\n'
                '  four:\n    runs-on: ubuntu-latest\n',
                'utf-8',
            )
            parsed = job_graph(sample)
        self.assertEqual(parsed['one'], ['a'])
        self.assertEqual(parsed['two'], ['a', 'b'])
        self.assertEqual(parsed['three'], ['a', 'b'])
        self.assertEqual(parsed['four'], [])


if __name__ == '__main__':
    unittest.main()
