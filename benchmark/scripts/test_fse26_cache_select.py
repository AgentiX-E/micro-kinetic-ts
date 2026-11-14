#!/usr/bin/env python3
"""
Tests for the cache selector.

The selector's whole value is the REFUSALS: a wrong pick publishes a score from a
cache the checkout did not produce, which is the failure `fse26_provenance.py`
exists to catch and which a stale tag name produced once already. So the cases
below are the two refusals, the unknown-digest case and the CLI wiring, rather
than only the happy path.
"""

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from fse26_cache_select import (
    AmbiguousCache,
    NoMatchingCache,
    describe,
    main,
    parse_candidates,
    select_cache,
)

EXPECTED = "sha256:f72899e5b793e4a0896ea3a0f85229e1e2f505b6db119721b59ab0ae08d1d431"
STALE = "sha256:f83af14d9f265b30267ec0c0c8780d3567b1c21a1a12c228222593451f0419a7"


class TestParseCandidates(unittest.TestCase):
    def test_reads_tag_and_digest_and_ignores_blank_lines(self):
        text = f"rcabench-pod-v1\t{EXPECTED}\n\nrcabench-latency-full\t{STALE}\n"
        self.assertEqual(
            parse_candidates(text),
            {"rcabench-pod-v1": EXPECTED, "rcabench-latency-full": STALE},
        )

    def test_an_empty_digest_is_the_pre_provenance_spelling(self):
        self.assertEqual(parse_candidates("rcabench-subset\t\n"), {"rcabench-subset": None})
        self.assertEqual(parse_candidates("rcabench-subset\t   \n"), {"rcabench-subset": None})

    def test_strips_surrounding_whitespace_from_both_fields(self):
        self.assertEqual(parse_candidates(f"  t  \t  {EXPECTED}  \n"), {"t": EXPECTED})

    def test_a_line_without_a_separator_is_malformed_not_a_digestless_tag(self):
        with self.assertRaises(ValueError) as caught:
            parse_candidates("rcabench-full-v2\n")
        self.assertIn("expected 'tag<TAB>digest'", str(caught.exception))

    def test_rejects_an_empty_tag_and_a_duplicate(self):
        with self.assertRaises(ValueError) as caught:
            parse_candidates("\t" + EXPECTED + "\n")
        self.assertIn("empty tag", str(caught.exception))
        with self.assertRaises(ValueError) as caught:
            parse_candidates(f"t\t{EXPECTED}\nt\t{STALE}\n")
        self.assertIn("duplicate tag", str(caught.exception))


class TestSelectCache(unittest.TestCase):
    def test_picks_the_tag_whose_digest_is_this_checkout(self):
        candidates = {"rcabench-pod-v1": EXPECTED, "rcabench-latency-full": STALE}
        self.assertEqual(select_cache(candidates, EXPECTED), "rcabench-pod-v1")

    def test_an_unknown_digest_never_matches(self):
        # A pre-provenance manifest is not a near miss: nothing in it identifies the
        # converter, so treating it as a candidate would publish an unprovable score.
        with self.assertRaises(NoMatchingCache):
            select_cache({"rcabench-subset": None}, EXPECTED)

    def test_no_match_lists_nothing_usable(self):
        with self.assertRaises(NoMatchingCache):
            select_cache({"rcabench-latency-full": STALE}, EXPECTED)

    def test_an_empty_expectation_is_a_refusal_rather_than_a_wildcard(self):
        with self.assertRaises(NoMatchingCache) as caught:
            select_cache({"rcabench-pod-v1": EXPECTED}, "")
        self.assertIn("empty", str(caught.exception))

    def test_two_matches_is_a_refusal_because_a_name_cannot_decide(self):
        candidates = {"b-second": EXPECTED, "a-first": EXPECTED}
        with self.assertRaises(AmbiguousCache) as caught:
            select_cache(candidates, EXPECTED)
        self.assertEqual(str(caught.exception), "a-first, b-second")

    def test_the_digest_comparison_is_exact(self):
        with self.assertRaises(NoMatchingCache):
            select_cache({"t": EXPECTED.upper().replace("SHA256:", "sha256:")}, EXPECTED)


class TestDescribe(unittest.TestCase):
    def test_names_every_candidate_and_marks_the_unknowns(self):
        text = describe({"rcabench-pod-v1": EXPECTED, "rcabench-subset": None})
        self.assertEqual(
            text,
            "  rcabench-pod-v1: " + EXPECTED + "\n"
            "  rcabench-subset: unknown (manifest predates provenance)",
        )

    def test_says_so_when_nothing_was_discovered(self):
        self.assertEqual(describe({}), "  (no candidate caches were discovered)")


class TestMain(unittest.TestCase):
    def _run(self, argv: list[str]) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def _candidates_file(self, text: str) -> str:
        handle = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
        handle.write(text)
        handle.close()
        return handle.name

    def test_prints_the_tag_and_exits_zero(self):
        path = self._candidates_file(f"rcabench-pod-v1\t{EXPECTED}\n")
        code, out, err = self._run(["--expected", EXPECTED, "--candidates", path])
        self.assertEqual((code, out.strip(), err), (0, "rcabench-pod-v1", ""))

    def test_refuses_with_the_full_candidate_list_and_exits_one(self):
        path = self._candidates_file(f"rcabench-latency-full\t{STALE}\nrcabench-subset\t\n")
        code, out, err = self._run(["--expected", EXPECTED, "--candidates", path])
        self.assertEqual(code, 1)
        self.assertEqual(out, "")
        self.assertIn("no released cache was built by this checkout's converter", err)
        self.assertIn(f"rcabench-latency-full: {STALE}", err)
        self.assertIn("rcabench-subset: unknown (manifest predates provenance)", err)

    def test_refuses_an_ambiguous_set_and_exits_three(self):
        path = self._candidates_file(f"a-first\t{EXPECTED}\nb-second\t{EXPECTED}\n")
        code, _out, err = self._run(["--expected", EXPECTED, "--candidates", path])
        self.assertEqual(code, 3)
        self.assertIn("a-first, b-second were all built by", err)
        self.assertIn("Pin `shard_tag`", err)

    def test_a_missing_file_is_a_usage_error(self):
        code, _out, err = self._run(["--expected", EXPECTED, "--candidates", "/nonexistent/x"])
        self.assertEqual(code, 2)
        self.assertIn("ERROR:", err)

    def test_a_malformed_file_is_a_usage_error(self):
        path = self._candidates_file("not-a-pair\n")
        code, _out, err = self._run(["--expected", EXPECTED, "--candidates", path])
        self.assertEqual(code, 2)
        self.assertIn("expected 'tag<TAB>digest'", err)


if __name__ == "__main__":
    unittest.main()
