"""Unit tests for the FSE'26 run-artifact comparison.

The comparison decides whether a candidate is shippable, so the properties that
matter are the ones a reader would otherwise have to take on trust: that the
configuration of every run is printed (two runs of this benchmark were once
published 24.2pp apart with byte-identical `config` blocks), that a regressed
fault type is reported even when the headline number rises, and that a changed
fault-type inventory between runs does not invent a delta.

The artifacts are synthetic. The real ones are 1-2 KB of JSON downloaded from a
CI run, and a CI gate must not depend on a network call — the same rule that keeps
`benchmarks/__tests__/integration/**` out of the default suite.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import runpy
import sys
import tempfile
import unittest

from compare_fse26_runs import load, main


def artifact(
    *,
    top1: float = 0.4733,
    top3: float = 0.6069,
    top5: float = 0.6575,
    config: dict | None = None,
    cells: dict[str, tuple[int, int]] | None = None,
    cases: int = 1422,
) -> dict:
    per_fault_type = {
        name: {"total": total, "correct": correct, "top1": correct / total}
        for name, (correct, total) in (cells or {}).items()
    }
    return {
        "dataset": "fse26",
        "anchor": {"sotaAvgTop1": 0.21, "sotaBestTop1": 0.37},
        "config": config
        or {
            "logWeight": 1,
            "logSignalMode": "logicHttp",
            "rankNormalization": True,
            "dropMetrics": [],
            "metricRiseCeiling": 0,
            "metricFleetBaseline": False,
        },
        "cases": cases,
        "top1": top1,
        "top3": top3,
        "top5": top5,
        "deltaVsSotaAvg": top1 - 0.21,
        "loadErrors": 0,
        "engineErrors": 0,
        "emptyGraphs": 0,
        "perFaultType": per_fault_type,
    }


def write(document: dict) -> str:
    handle, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(handle, "w", encoding="utf-8") as fh:
        json.dump(document, fh)
    return path


def fault_rows(output: str) -> list[str]:
    """The per-fault-type table's rows, and nothing else.

    Slicing after the header is what keeps the configuration and headline lines
    out: they also start with two spaces, and a test that matched them would be
    asserting about the wrong table. The block is the run of indented lines that
    follows the column header, and it ends at the first blank line.
    """
    lines = output.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("Per fault type"))
    rows: list[str] = []
    for line in lines[start + 2 :]:  # +1 is the column header
        if not line.strip():
            break
        if line.startswith("  "):
            rows.append(line)
    return rows


def run_main(specs: list[str]) -> tuple[int, str]:
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = main(specs)
    return code, out.getvalue()


class LoadTest(unittest.TestCase):
    def test_reads_a_labelled_artifact(self) -> None:
        path = write(artifact(cases=7))
        label, document = load(f"control={path}")
        self.assertEqual(label, "control")
        self.assertEqual(document["cases"], 7)

    def test_rejects_a_spec_without_a_path(self) -> None:
        # A missing `=` would otherwise be read as a path named "", and the
        # failure would surface as a confusing FileNotFoundError instead of usage.
        with self.assertRaises(SystemExit) as caught:
            load("control")
        self.assertIn("usage", str(caught.exception))


class ComparisonTest(unittest.TestCase):
    def test_prints_every_configuration_verbatim(self) -> None:
        # The regression this guards: two runs 24.2pp apart published identical
        # config blocks, so neither artifact could be attributed. The header has
        # to show the settings before it shows any number.
        base = write(artifact())
        candidate = write(artifact(top1=0.4782, config={**artifact()["config"], "metricFleetBaseline": True}))

        _, out = run_main([f"control={base}", f"fleet={candidate}"])

        self.assertIn("Configurations (verbatim from each artifact):", out)
        self.assertIn("'metricFleetBaseline': False", out)
        self.assertIn("'metricFleetBaseline': True", out)

    def test_reports_the_headline_delta_in_percentage_points(self) -> None:
        base = write(artifact(top1=0.4733))
        candidate = write(artifact(top1=0.4782))

        _, out = run_main([f"control={base}", f"fleet={candidate}"])

        self.assertIn("47.33%", out)
        self.assertIn("+0.49", out)

    def test_reports_a_regression_even_when_the_headline_number_rises(self) -> None:
        # The reason the per-type table exists: the logicHttp ablation was worth
        # +24.2pp overall and regressed eight fault types, and the net hid 57
        # individual losses against 164 gains.
        base = write(artifact(cells={"NetworkPartition": (39, 97), "JVMMemoryStress": (4, 171)}))
        candidate = write(
            artifact(
                top1=0.4782,
                cells={"NetworkPartition": (34, 97), "JVMMemoryStress": (7, 171)},
            )
        )

        _, out = run_main([f"control={base}", f"fleet={candidate}"])

        self.assertIn("REGRESSED types: NetworkPartition (-5)", out)

    def test_says_so_plainly_when_nothing_regressed(self) -> None:
        document = artifact(cells={"NetworkPartition": (39, 97)})
        _, out = run_main([f"control={write(document)}", f"same={write(document)}"])

        self.assertIn("No fault type regressed on any candidate.", out)

    def test_does_not_invent_a_delta_for_a_type_the_baseline_lacks(self) -> None:
        # A changed fault-type inventory between runs is a property of the run
        # set, not of the change under test. Reading the baseline's absence as
        # zero would report the new type's whole cell as a gain.
        base = write(artifact(cells={"JVMMemoryStress": (4, 171)}))
        candidate = write(artifact(cells={"JVMMemoryStress": (4, 171), "BrandNewType": (12, 12)}))

        code, out = run_main([f"control={base}", f"extra={candidate}"])

        self.assertEqual(code, 0)
        brand_new = next(line for line in fault_rows(out) if "BrandNewType" in line)
        self.assertIn("12/12", brand_new)
        self.assertTrue(brand_new.rstrip().endswith("-"), brand_new)
        self.assertIn("No fault type regressed on any candidate.", out)

    def test_marks_a_type_the_candidate_lacks_rather_than_dropping_the_row(self) -> None:
        base = write(artifact(cells={"JVMMemoryStress": (4, 171)}))
        candidate = write(artifact(cells={}))

        _, out = run_main([f"control={base}", f"gone={candidate}"])

        jvm = next(line for line in fault_rows(out) if "JVMMemoryStress" in line)
        self.assertIn("4/171", jvm)  # the baseline cell still renders
        self.assertIn("-", jvm)  # and the absent candidate cell is marked

    def test_orders_the_table_by_case_count_then_name(self) -> None:
        document = artifact(cells={"Small": (1, 2), "Big": (10, 20), "AlsoBig": (5, 20)})
        _, out = run_main([f"control={write(document)}", f"same={write(document)}"])

        # Descending total, then name ascending, so the order is total rather
        # than insertion-order — the table is read side by side between runs.
        names = [line.split()[0] for line in fault_rows(out)]
        self.assertEqual(names, ["AlsoBig", "Big", "Small"])

    def test_rejects_a_single_run_rather_than_printing_a_table_of_nothing(self) -> None:
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()):
                main([f"only={write(artifact())}"])


class UsageTest(unittest.TestCase):
    def test_requires_at_least_two_arguments(self) -> None:
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stdout(io.StringIO()):
                main([])


class EntryPointTest(unittest.TestCase):
    def test_runs_as_a_script_and_exits_zero(self) -> None:
        # The `if __name__ == "__main__"` guard is unreachable from an import, so
        # the only honest way to cover it is to execute the module the way a
        # shell does. `runpy` does that in THIS process, which is what makes the
        # guard visible to the coverage run that gates the repository — a
        # `subprocess.run` would exercise it in a child the tracer never sees.
        base = write(artifact(cells={"JVMMemoryStress": (4, 171)}))
        candidate = write(artifact(cells={"JVMMemoryStress": (7, 171)}))
        module = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compare_fse26_runs.py")
        original = sys.argv
        out = io.StringIO()

        sys.argv = [module, f"control={base}", f"fleet={candidate}"]
        try:
            with contextlib.redirect_stdout(out):
                with self.assertRaises(SystemExit) as caught:
                    runpy.run_path(module, run_name="__main__")
        finally:
            sys.argv = original

        self.assertEqual(caught.exception.code, 0)
        self.assertIn("No fault type regressed on any candidate.", out.getvalue())

    def test_exits_non_zero_on_a_bad_usage(self) -> None:
        module = os.path.join(os.path.dirname(os.path.abspath(__file__)), "compare_fse26_runs.py")
        original = sys.argv

        sys.argv = [module]
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as caught:
                    runpy.run_path(module, run_name="__main__")
        finally:
            sys.argv = original

        self.assertNotEqual(caught.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
