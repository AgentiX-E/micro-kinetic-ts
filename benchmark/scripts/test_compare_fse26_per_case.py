#!/usr/bin/env python3
"""
Tests for the per-case comparator.

The comparator exists because a fault-type count cannot distinguish "two cases gained,
none lost" from "two gained and two lost", and this project has already made a decision
the second shape would have corrupted. So the assertions below are about the shapes the
aggregate hides: the net-zero swap, the excluded corpus difference, and the judge depth.
"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from compare_fse26_per_case import Row, flips, load, main, per_type, render


def _write(rows: list[dict]) -> Path:
    handle = tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False)
    for row in rows:
        handle.write(json.dumps(row) + "\n")
    handle.close()
    return Path(handle.name)


def _row(datapack: str, fault_type: str, accepted: list[str], ranked: list[str]) -> dict:
    return {"datapack": datapack, "faultType": fault_type, "accepted": accepted, "ranked": ranked}


class TestRow(unittest.TestCase):
    def test_top1_reads_only_the_first_answer(self):
        row = Row("t", ["a"], ["b", "a"])
        self.assertFalse(row.correct(1))
        self.assertTrue(row.correct(2))

    def test_any_accepted_service_counts(self):
        # The corpus's ground truth is a SET for edge-shaped faults; a judgement that
        # read only the first member would score a correct answer as a miss.
        row = Row("t", ["a", "b"], ["b"])
        self.assertTrue(row.correct(1))


class TestLoad(unittest.TestCase):
    def test_reads_one_row_per_line_and_skips_blanks(self):
        path = _write([_row("c1", "T", ["a"], ["a"])])
        path.write_text(path.read_text() + "\n", "utf-8")
        rows = load(path)
        self.assertEqual(list(rows), ["c1"])
        self.assertEqual(rows["c1"].ranked, ["a"])

    def test_a_malformed_line_is_an_error_that_names_the_line(self):
        path = _write([])
        path.write_text("{not json}\n", "utf-8")
        with self.assertRaises(ValueError) as caught:
            load(path)
        self.assertIn(":1:", str(caught.exception))

    def test_a_row_without_a_datapack_is_an_error(self):
        path = _write([])
        path.write_text('{"faultType": "T"}\n', "utf-8")
        with self.assertRaises(ValueError) as caught:
            load(path)
        self.assertIn("unreadable row", str(caught.exception))

    def test_a_duplicate_datapack_is_an_error_not_a_last_one_wins(self):
        path = _write([_row("c1", "T", ["a"], ["a"]), _row("c1", "T", ["a"], ["b"])])
        with self.assertRaises(ValueError) as caught:
            load(path)
        self.assertIn("duplicate datapack 'c1'", str(caught.exception))


class TestFlips(unittest.TestCase):
    def test_separates_gained_from_lost(self):
        base = {"a": Row("T", ["x"], ["y"]), "b": Row("T", ["x"], ["x"])}
        arm = {"a": Row("T", ["x"], ["x"]), "b": Row("T", ["x"], ["y"])}
        outcome = flips(base, arm, 1)
        self.assertEqual(outcome["gained"], ["a"])
        self.assertEqual(outcome["lost"], ["b"])

    def test_a_case_in_one_run_only_is_excluded_from_both_counts(self):
        base = {"a": Row("T", ["x"], ["y"]), "gone": Row("T", ["x"], ["x"])}
        arm = {"a": Row("T", ["x"], ["x"]), "new": Row("T", ["x"], ["x"])}
        outcome = flips(base, arm, 1)
        self.assertEqual(outcome["gained"], ["a"])
        self.assertEqual(outcome["only_base"], ["gone"])
        self.assertEqual(outcome["only_arm"], ["new"])

    def test_depth_moves_the_judgement_without_touching_the_data(self):
        base = {"a": Row("T", ["x"], ["y", "x"])}
        arm = {"a": Row("T", ["x"], ["y", "z"])}
        self.assertEqual(flips(base, arm, 1)["gained"], [])
        self.assertEqual(flips(base, arm, 2)["lost"], ["a"])


class TestPerType(unittest.TestCase):
    def test_counts_both_directions_per_type(self):
        base = {
            "a": Row("T", ["x"], ["y"]),
            "b": Row("T", ["x"], ["x"]),
            "c": Row("U", ["x"], ["x"]),
        }
        arm = {
            "a": Row("T", ["x"], ["x"]),
            "b": Row("T", ["x"], ["y"]),
            "c": Row("U", ["x"], ["x"]),
        }
        table = per_type(base, arm, 1)
        self.assertEqual(table["T"], {"base_correct": 1, "arm_correct": 1, "gained": 1, "lost": 1, "cases": 2})
        self.assertEqual(table["U"], {"base_correct": 1, "arm_correct": 1, "gained": 0, "lost": 0, "cases": 1})


class TestRender(unittest.TestCase):
    def test_reports_the_swap_a_count_table_would_hide(self):
        base = {"a": Row("T", ["x"], ["y"]), "b": Row("T", ["x"], ["x"])}
        arm = {"a": Row("T", ["x"], ["x"]), "b": Row("T", ["x"], ["y"])}
        text = render("arm", "base", base, arm, 1)
        self.assertIn("gained: 1  lost: 1  net: +0", text)
        self.assertIn("NET-ZERO BUT NOT IDENTICAL", text)
        self.assertIn("T (+1/-1)", text)

    def test_says_so_when_nothing_is_hidden(self):
        base = {"a": Row("T", ["x"], ["y"])}
        arm = {"a": Row("T", ["x"], ["x"])}
        text = render("arm", "base", base, arm, 1)
        self.assertIn("no case-level swap is hidden", text)
        self.assertNotIn("NET-ZERO", text)

    def test_lists_the_excluded_cases(self):
        base = {"a": Row("T", ["x"], ["x"]), "gone": Row("T", ["x"], ["x"])}
        arm = {"a": Row("T", ["x"], ["x"]), "new": Row("T", ["x"], ["x"])}
        text = render("arm", "base", base, arm, 1)
        self.assertIn("EXCLUDED, in only base only: 1 (gone)", text)
        self.assertIn("EXCLUDED, in only arm only: 1 (new)", text)


class TestMain(unittest.TestCase):
    def _run(self, argv: list[str]) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_prints_one_section_per_arm(self):
        base = _write([_row("a", "T", ["x"], ["y"])])
        arm = _write([_row("a", "T", ["x"], ["x"])])
        code, out, err = self._run([f"base={base}", f"arm={arm}"])
        self.assertEqual(code, 0, err)
        self.assertIn("base -> arm", out)
        self.assertIn("gained: 1", out)

    def test_refuses_fewer_than_two_runs(self):
        code, _out, err = self._run(["only=path"])
        self.assertEqual(code, 2)
        self.assertIn("at least two", err)

    def test_refuses_a_spec_without_a_path_and_a_zero_depth(self):
        code, _out, err = self._run(["base=", "arm=x"])
        self.assertEqual(code, 2)
        self.assertIn("expected label=path", err)
        code, _out, err = self._run(["a=x", "b=y", "--depth", "0"])
        self.assertEqual(code, 2)
        self.assertIn("--depth", err)

    def test_a_missing_file_is_a_read_error(self):
        code, _out, err = self._run(["a=/nonexistent/x.ndjson", "b=/nonexistent/y.ndjson"])
        self.assertEqual(code, 1)
        self.assertIn("ERROR:", err)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
