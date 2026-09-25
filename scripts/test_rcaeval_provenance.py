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
from unittest import mock

import rcaeval_provenance as prov

SCRIPTS = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parent
WORKFLOWS = REPO_ROOT / '.github/workflows'
ACTIONS = REPO_ROOT / '.github/actions'
ACTION = ACTIONS / 'rcaeval-json/action.yml'
CACHE_WORKFLOW = WORKFLOWS / 'cache-datasets.yml'

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
        for argv in ([], ['--key', '--stamp'], ['--verify']):
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


if __name__ == '__main__':
    unittest.main()
