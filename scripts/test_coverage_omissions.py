"""The python gate's POPULATION, made a rule rather than a habit.

**The defect these tests were written against, measured on 2026-09-20.** The `converter-tests` job in
`.github/workflows/ci.yml` says of itself:

    # The Parquet → JSON bridge and the sharder decide every published benchmark number, and
    # they are plain Python: gate them on their own unit tests... Branch coverage is enforced.

and the command under that comment excluded the bridge:

    coverage run --branch --source=. \\
      --omit='test_*,convert-parquet-to-json.py,download-and-benchmark.py,evaluate-openrca.py' ...

`convert-parquet-to-json.py` is run by `cache-datasets.yml` to produce `~/RCAEval-json`, which is the
artifact every RCAEval benchmark — including the golden nine-cell — is read from. It was in no coverage
gate at all, and neither was the file the same comment calls the sharder's peer.

**Why the exclusion was an accident.** The three omitted names are exactly the three in `scripts/`
containing a hyphen — a name `import` cannot address — and that is the only thing they have in common:

| script | third-party imports | omitted before |
| --- | --- | --- |
| `convert-parquet-to-json.py` | pandas | yes |
| `download-and-benchmark.py` | `RCAEval.utility` (external, not in any requirements file) | yes |
| `evaluate-openrca.py` | **none — pure standard library** | yes |
| the other eight non-test scripts | polars, or nothing | no, all at 100.00% |

A hyphen is not a statement about what a file decides, and the third row is the proof: 264 lines of pure
standard library, needing no dependency at all, kept out of a gate by four characters in its filename.

So the rule below is: **a module may be omitted from the gate only if the test runner cannot address it
by name AND its reason is recorded here AND that reason still holds.** The last clause is what stops this
list from becoming a graveyard — `download-and-benchmark.py` cannot be imported, and that is CHECKED by
parsing it rather than asserted, so the day it grows a `main()` guard it has to be enrolled.
"""

from __future__ import annotations

import ast
import pathlib
import re
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS.parent
CI_WORKFLOW = REPO_ROOT / '.github/workflows/ci.yml'

# The `--omit` argument as the job writes it, on one line of a shell block.
OMIT = re.compile(r"--omit='([^']+)'")

#: Modules the gate deliberately does NOT measure, each with the reason, and the reason is CHECKED.
#: A name that is absent from this table may not appear in the omit list; a name that is present must
#: still satisfy `is_omitted_for_a_reason_that_still_holds`.
DECIDED_OMISSIONS = {
    'download-and-benchmark.py': (
        'top-level statements: it EXECUTES on import, so it is not a module a test can address — '
        'and its only dependencies are an external package that appears in no requirements file'
    ),
    'evaluate-openrca.py': (
        'three of its six functions are bound to the network (gdown, a GitHub clone, and a '
        'subprocess into the repository it clones), so it cannot reach the 100% this gate holds '
        'every measured module to — and a PARTLY measured module is worse than an honestly '
        'omitted one, because it invites the belief that its network paths are checked'
    ),
}


def omitted_names() -> list[str]:
    """The filenames the gate excludes, read from the workflow that excludes them.

    @returns The names, in the order the workflow lists them.
    """
    text = CI_WORKFLOW.read_text('utf-8')
    match = OMIT.search(text)
    if match is None:
        raise AssertionError(f'no --omit argument found in {CI_WORKFLOW}')
    return [name.strip() for name in match.group(1).split(',') if name.strip()]


def script_names() -> list[str]:
    """Every non-test script in `scripts/`, derived from the FILESYSTEM.

    Derived rather than listed, so a new script enters this fence by existing — which is the only way
    a rule about a population can hold on a day nobody is looking at it.

    @returns The filenames, sorted.
    """
    return sorted(p.name for p in SCRIPTS.glob('*.py') if not p.name.startswith('test_'))


def is_importable_by_name(name: str) -> bool:
    """Whether `import <stem>` could address this file.

    @param name - The filename.
    @returns Whether the stem is a valid module identifier.
    """
    return name.removesuffix('.py').isidentifier()


def has_module_level_side_effects(name: str) -> bool:
    """Whether the file EXECUTES anything at import — the reason a module cannot be tested as one.

    Checked rather than asserted, so the reason in {@link DECIDED_OMISSIONS} is falsifiable: the day
    `download-and-benchmark.py` grows a `main()` guard it stops satisfying its own reason, and this
    fence fails until it is enrolled.

    @param name - The filename.
    @returns Whether a top-level statement other than a definition, an import or a docstring runs.
    """
    tree = ast.parse((SCRIPTS / name).read_text('utf-8'))
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef,
                             ast.ClassDef, ast.If)):
            # An `if` is admitted because `if __name__ == "__main__":` is the guard that makes a file
            # addressable as a module rather than a script.
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant):
            continue  # the module docstring
        return True
    return False


class TheGateReadsWhatItClaims(unittest.TestCase):
    """The specific regression: the file the comment names may not be absent from the command."""

    def test_the_PARQUET_BRIDGE_is_measured(self) -> None:
        # The finding, as a permanent fence. This file decides every published benchmark number, is
        # run by `cache-datasets.yml`, and was excluded by four characters in its name.
        self.assertNotIn('convert-parquet-to-json.py', omitted_names())
        self.assertTrue((SCRIPTS / 'test_convert_parquet_to_json.py').exists())

    def test_every_omitted_name_STILL_EXISTS(self) -> None:
        # A stale entry is an exclusion nobody decided about any more — and it silently stops
        # measuring whatever takes the name next.
        for name in omitted_names():
            if name == 'test_*':
                continue
            self.assertTrue((SCRIPTS / name).exists(), f'{name} is omitted but does not exist')

    def test_an_omitted_name_may_not_be_IMPORTABLE(self) -> None:
        # The rule. A hyphen-less module can be imported by a test, so there is no reading of "the
        # runner cannot address it" under which it is legitimately omitted.
        for name in omitted_names():
            if name == 'test_*':
                continue
            self.assertFalse(
                is_importable_by_name(name),
                f'{name} is importable, so its omission is not about addressability — enrol it',
            )

    def test_every_omission_carries_a_RECORDED_reason(self) -> None:
        # Both directions, so neither half can drift alone: nothing omitted without a decision, and
        # no decision left behind for a file that is no longer omitted.
        self.assertEqual(
            set(name for name in omitted_names() if name != 'test_*'),
            set(DECIDED_OMISSIONS),
        )

    def test_each_RECORDED_reason_still_holds(self) -> None:
        # The falsifiable half. `download-and-benchmark.py` is omitted because it executes on import;
        # if someone guards it, this fails and the fence has to be updated rather than forgotten.
        self.assertTrue(
            has_module_level_side_effects('download-and-benchmark.py'),
            'download-and-benchmark.py no longer runs at import — it can be measured now',
        )
        text = (SCRIPTS / 'evaluate-openrca.py').read_text('utf-8')
        self.assertIn('import subprocess', text)
        self.assertIn('gdown', text)


#: Measured modules whose tests are not NAMED for them: their contract is exercised by the test file
#: listed here, which imports and drives them. Recorded because incidental coverage is a claim that
#: has to be checkable — if that file stops driving the module, it drops toward 0% and nothing says
#: so. The mapping is FALSIFIED by reading the named test for the module's stem, so the day the link
#: is broken this fence fails rather than the aggregate quietly sagging.
#:
#: Found by this fence on its first run (2026-09-20): `fse26_convert_tar.py` reads 100.00% and has no
#: test of its own — 12 references inside `test_fse26_convert.py` are what measure it. That is real
#: coverage and a real dependency, and naming it is the difference between the two being known and
#: being assumed.
COVERED_BY_ANOTHER_TEST = {
    'convert-parquet-to-json.py': 'test_convert_parquet_to_json.py',
    'fse26_convert_tar.py': 'test_fse26_convert.py',
}


def test_file_for(name: str) -> str | None:
    """The test file that measures a module, whether by name or by a recorded substitution.

    @param name - The module's filename.
    @returns The test filename, or None when nothing measures it.
    """
    by_name = f'test_{name.removesuffix(".py")}.py'
    if (SCRIPTS / by_name).exists():
        # A hyphenated module cannot have a file named `test_convert-parquet-to-json.py` that is
        # itself importable, so the by-name branch is only reachable for underscored stems — which is
        # why the replacement below exists rather than being folded in here.
        return by_name
    recorded = COVERED_BY_ANOTHER_TEST.get(name)
    if recorded is None or not (SCRIPTS / recorded).exists():
        return None
    return recorded


class TheMeasuredPopulationIsTheRest(unittest.TestCase):
    """The complement. A rule about what is omitted is only half a rule without this half."""

    def test_every_measured_script_has_a_test_THAT_ADDRESSES_IT(self) -> None:
        # A module under `--source=.` with nothing driving it is measured as 0% and drags the
        # aggregate, which is a slow way to learn what this says immediately. The second half — that
        # the named test really addresses THIS module — is what makes a substitution a link rather
        # than a note: `test_fse26_convert.py` has to keep naming `fse26_convert_tar`.
        omitted = set(omitted_names())
        for name in script_names():
            if name in omitted:
                continue
            recorded = test_file_for(name)
            self.assertIsNotNone(
                recorded,
                f'{name} is measured and no test names it, and none is recorded for it',
            )
            stem = name.removesuffix('.py')
            self.assertIn(
                stem,
                (SCRIPTS / recorded).read_text('utf-8'),
                f'{recorded} does not name {stem}, so it no longer measures it',
            )

    def test_a_RECORDED_substitution_is_not_a_SUBSTITUTE_for_a_stale_entry(self) -> None:
        # Both directions again: a recorded link to a test that has been renamed away would otherwise
        # sit here pointing at nothing, and the module would read 0% with the fence still green.
        for module, recorded in COVERED_BY_ANOTHER_TEST.items():
            self.assertTrue((SCRIPTS / module).exists(), f'{module} is recorded but does not exist')
            self.assertTrue((SCRIPTS / recorded).exists(), f'{recorded} is recorded but does not exist')

    def test_the_population_this_rule_reads_is_NOT_EMPTY(self) -> None:
        # A rule over an empty population passes vacuously — the failure mode this whole repository
        # keeps meeting. Both halves are asserted to have something in them.
        self.assertGreater(len(script_names()), 8)
        self.assertGreater(len(omitted_names()), 1)

    def test_the_PREDICATES_can_answer_the_other_way(self) -> None:
        # Without this, three of the rules above are satisfiable by a predicate that always returns the
        # same answer: `assertFalse(is_importable_by_name(name))` passes for a function that returns
        # False for everything, and `assertIsNotNone(test_file_for(name))` passes for one that returns
        # a name for everything. The mutation pass found this — a mutated `is_importable_by_name`
        # returning constant False SURVIVED — which is the vacuous-check trap inside a check written to
        # catch it. Both directions are asserted here so neither predicate can be a constant.
        self.assertTrue(is_importable_by_name('golden_run_landing.py'))
        self.assertFalse(is_importable_by_name('convert-parquet-to-json.py'))
        self.assertEqual(test_file_for('golden_run_landing.py'), 'test_golden_run_landing.py')
        self.assertIsNone(test_file_for('a_module_nothing_measures.py'))

    def test_the_WORKFLOW_is_the_one_this_repository_runs(self) -> None:
        # The fence reads a path; if the path is wrong the fence silently measures nothing. Assert the
        # document is the gate by finding the job name and the command in it.
        text = CI_WORKFLOW.read_text('utf-8')
        self.assertIn('converter-tests:', text)
        self.assertIn('coverage report --fail-under=95', text)


if __name__ == '__main__':
    unittest.main()
