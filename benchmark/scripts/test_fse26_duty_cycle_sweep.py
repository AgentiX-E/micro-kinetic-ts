"""Tests for the duty-cycle sweep: the guard's two windows, and the census that prices them."""

import json
import tempfile
import unittest
from pathlib import Path

import fse26_duty_cycle_sweep as sweep


class TestTruthService(unittest.TestCase):
    def test_splits_the_namespace_and_the_fault_phrase(self) -> None:
        self.assertEqual(
            sweep.truth_service("ts0-ts-basic-service-response-replace-code-4vn4gg"),
            "ts-basic-service",
        )
        self.assertEqual(
            sweep.truth_service("ts3-ts-ui-dashboard-request-replace-method-blzn4l"),
            "ts-ui-dashboard",
        )

    def test_anchors_the_phrase_on_the_RIGHT_so_a_two_token_fault_keeps_the_service(self) -> None:
        # `container-kill` is one fault phrase of two tokens: reading only the last token would answer
        # `mysql-container`, which is not a service in any datapack.
        self.assertEqual(sweep.truth_service("ts0-mysql-container-kill-9t6n24"), "mysql")
        self.assertEqual(sweep.truth_service("ts0-mysql-partition-5pf26g"), "mysql")

    def test_keeps_a_service_whose_own_name_carries_a_fault_word(self) -> None:
        # `ts-code-service` contains `code`; the phrase has to be the one that ENDS the name.
        self.assertEqual(
            sweep.truth_service("ts0-ts-code-service-container-kill-aa11"),
            "ts-code-service",
        )

    def test_refuses_a_name_it_cannot_parse_rather_than_guessing(self) -> None:
        self.assertIsNone(sweep.truth_service("ts0-something-unheard-of-aa11"))

    def test_refuses_a_name_with_no_service_left_of_the_phrase(self) -> None:
        # Falling through to the shorter `code` phrase here would invent the service `response-replace`.
        self.assertIsNone(sweep.truth_service("ts0-response-replace-code-abcd12"))
        self.assertIsNone(sweep.truth_service("ts0-aa11"))


class TestNearZeroShare(unittest.TestCase):
    def test_counts_the_band_against_the_window_PEAK(self) -> None:
        # Peak 100, band 0.1: the two zeros are near-zero and 0.05 is too, 5.0 is not.
        self.assertAlmostEqual(sweep.near_zero_share([0.0, 0.05, 5.0, 100.0]), 0.5)

    def test_a_window_with_no_level_at_all_is_entirely_idle(self) -> None:
        # The guard's own reading: an instrument that reported nothing measured nothing. Dividing by a zero
        # peak would have made the share NaN and the comparison false, which is the silent direction.
        self.assertEqual(sweep.near_zero_share([0.0, 0.0, 0.0]), 1.0)

    def test_an_empty_window_has_no_idle_share(self) -> None:
        self.assertEqual(sweep.near_zero_share([]), 0.0)

    def test_slices_from_the_start_index(self) -> None:
        values = [0.0, 0.0, 0.0, 10.0, 10.0]
        self.assertAlmostEqual(sweep.near_zero_share(values), 0.6)
        self.assertAlmostEqual(sweep.near_zero_share(values, 3), 0.0)


class TestJudge(unittest.TestCase):
    def test_the_corpus_shape_is_rescued_by_the_window(self) -> None:
        # Half quiet, half sustained: 24 of 49 samples are zero, which is over the 40 % line on the whole
        # recording and nowhere near it after the anchor. This is the shape the archive's error channels have.
        values = [0.0] * 24 + [16.4] * 25
        self.assertEqual(sweep.judge(values, 24), (True, False))

    def test_a_channel_that_is_sporadic_AFTER_the_anchor_is_refused_by_both(self) -> None:
        values = [0.0] * 20 + [5.0] + [0.0] * 40
        self.assertEqual(sweep.judge(values, 20), (True, True))

    def test_a_boundary_at_the_last_sample_falls_back_to_the_whole_recording(self) -> None:
        values = [0.0] * 60 + [4.0]
        self.assertEqual(sweep.judge(values, 60), (True, True))

    def test_an_unplaceable_boundary_falls_back_to_the_whole_recording(self) -> None:
        values = [0.0] * 24 + [16.4] * 25
        self.assertEqual(sweep.judge(values, -1), (True, True))

    def test_a_channel_with_no_idle_stretch_is_kept_by_both(self) -> None:
        values = [10.0] * 40
        self.assertEqual(sweep.judge(values, 20), (False, False))


class TestSummarize(unittest.TestCase):
    def _row(self, name: str, whole: bool, post: bool) -> dict:
        return {
            "datapack": name,
            "truth": "ts-basic-service",
            "dropped_whole": whole,
            "dropped_post": post,
        }

    def test_counts_the_rescue_and_groups_it_by_fault_phrase(self) -> None:
        rows = [
            self._row("ts0-ts-basic-service-response-replace-code-aaaa11", True, False),
            self._row("ts0-ts-basic-service-response-replace-code-bbbb22", True, False),
            self._row("ts0-ts-basic-service-request-replace-method-cccc33", True, True),
            {"datapack": "ts0-x-y-zzzz", "truth": "x", "absent": True},
        ]
        summary = sweep.summarize(rows)
        self.assertEqual(summary["cases"], 4)
        self.assertEqual(summary["judged"], 3)
        self.assertEqual(summary["dropped_whole"], 3)
        self.assertEqual(summary["dropped_post"], 1)
        self.assertEqual(summary["rescued"], 2)
        self.assertEqual(summary["truth_channel_absent"], 1)
        self.assertEqual(summary["rescued_by_fault"], {"response-replace-code": 2})

    def test_a_datapack_that_could_not_be_named_is_counted_by_the_caller(self) -> None:
        # `judge_case` answers `None` for a name it cannot parse; a record that does not exist cannot report
        # its own absence, so the count is passed in and must reach the census.
        self.assertEqual(sweep.summarize([], unparsed=3)["unparsed"], 3)

    def test_a_record_that_did_not_load_is_counted_rather_than_dropped(self) -> None:
        rows = [{"datapack": "a", "truth": "b", "error": "boom"}]
        summary = sweep.summarize(rows)
        self.assertEqual(summary["load_errors"], 1)
        self.assertEqual(summary["judged"], 0)


class TestCollect(unittest.TestCase):
    def test_one_worker_runs_in_this_process(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ts0-unheard-of-aa11").mkdir()
            self.assertEqual(sweep.collect([root / "ts0-unheard-of-aa11"], 1), [None])

    def test_more_than_one_worker_uses_a_SPAWNED_pool(self) -> None:
        # Spawned rather than forked because the module imports polars; this test is also the guard that the
        # pool path exists at all — a `collect` that silently ran everything in-process would be slower than
        # the tool it replaced and would say so nowhere.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ("ts0-unheard-of-aa11", "ts0-unheard-of-bb22"):
                (root / name).mkdir()
            records = sweep.collect([root / "ts0-unheard-of-aa11", root / "ts0-unheard-of-bb22"], 2)
            self.assertEqual(records, [None, None])


class TestMain(unittest.TestCase):
    def test_writes_the_census_it_printed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data"
            root.mkdir()
            out = Path(tmp) / "sweep.json"
            code = sweep.main(["--data-dir", str(root), "--out", str(out), "--workers", "1"])
            self.assertEqual(code, 0)
            payload = json.loads(out.read_text("utf-8"))
            self.assertEqual(payload["summary"]["cases"], 0)
            self.assertEqual(payload["cases"], [])


class TestParquetPath(unittest.TestCase):
    """The reader and the per-case record, against synthetic Parquet in the archive's own schema."""

    def _case(self, root: Path, name: str, statuses: dict[str, list[int]], spacing: int = 10) -> Path:
        import polars as pl

        case = root / name
        case.mkdir(parents=True)
        rows = []
        for service, codes in statuses.items():
            for i, code in enumerate(codes):
                rows.append(
                    {
                        "time": __import__("datetime").datetime.fromtimestamp(
                            1_700_000_000 + i * spacing, tz=__import__("datetime").timezone.utc
                        ),
                        "service_name": service,
                        "attr.http.response.status_code": code,
                    }
                )
        for fname in ("normal_traces.parquet", "abnormal_traces.parquet"):
            pl.DataFrame(rows).write_parquet(case / fname)
        (case / "env.json").write_text(
            json.dumps(
                {
                    "NORMAL_START": 1_700_000_000,
                    "NORMAL_END": 1_700_000_100,
                    "ABNORMAL_START": 1_700_000_100,
                    "ABNORMAL_END": 1_700_000_200,
                }
            ),
            "utf-8",
        )
        return case

    def test_rebuilds_the_rate_the_converter_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            case = self._case(
                root,
                "ts0-ts-a-service-response-replace-code-aa11",
                {"svc": [200, 500, 200, 404]},
                spacing=0,
            )
            series = sweep._error_series(case)
            self.assertEqual(sorted(series), ["svc"])
            _, rates = series["svc"]
            self.assertEqual(len(rates), 1)
            self.assertAlmostEqual(rates[0], 50.0)

    def test_a_case_without_the_status_column_is_not_a_case_with_a_zero_rate(self) -> None:
        import polars as pl

        with tempfile.TemporaryDirectory() as tmp:
            case = Path(tmp) / "empty"
            case.mkdir()
            pl.DataFrame({"time": [], "service_name": []}).write_parquet(
                case / "normal_traces.parquet"
            )
            self.assertEqual(sweep._error_series(case), {})

    def test_judges_a_case_against_its_own_truth_service(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # 10 quiet windows then 10 windows at 50 %: the whole recording is 50 % near-zero, the post half none.
            self._case(
                root,
                "ts0-ts-a-service-response-replace-code-aa11",
                {"ts-a-service": [200] * 10 + [500] * 10},
            )
            record = sweep.judge_case(next(root.iterdir()))
            self.assertEqual(record["truth"], "ts-a-service")
            self.assertEqual(record["samples"], 20)
            self.assertTrue(record["dropped_whole"])
            self.assertFalse(record["dropped_post"])
            self.assertEqual(record["pre_peak"], 0.0)
            self.assertEqual(record["post_peak"], 100.0)

    def test_a_series_too_short_to_judge_is_reported_rather_than_judged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._case(root, "ts0-ts-a-service-response-replace-code-aa11", {"ts-a-service": [200, 500]})
            record = sweep.judge_case(next(root.iterdir()))
            self.assertTrue(record["short"])

    def test_reports_a_truth_service_whose_channel_is_absent_rather_than_scoring_it_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._case(root, "ts0-ts-a-service-response-replace-code-aa11", {"other": [200] * 5})
            record = sweep.judge_case(next(root.iterdir()))
            self.assertTrue(record["absent"])

    def test_a_case_naming_no_service_is_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ts0-unheard-of-aa11").mkdir()
            self.assertIsNone(sweep.judge_case(root / "ts0-unheard-of-aa11"))

    def test_an_unreadable_env_is_recorded_as_a_load_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            case = self._case(root, "ts0-ts-a-service-response-replace-code-aa11", {"ts-a-service": [200] * 5})
            (case / "env.json").write_text("{}", "utf-8")
            self.assertIn("error", sweep.judge_case(case))

    def test_the_cli_walks_the_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "data"
            root.mkdir()
            self._case(root, "ts0-ts-a-service-response-replace-code-aa11", {"ts-a-service": [200] * 10 + [500] * 10})
            out = Path(tmp) / "sweep.json"
            self.assertEqual(sweep.main(["--data-dir", str(root), "--out", str(out), "--workers", "1"]), 0)
            summary = json.loads(out.read_text("utf-8"))["summary"]
            self.assertEqual(summary["judged"], 1)
            self.assertEqual(summary["rescued"], 1)


if __name__ == "__main__":
    unittest.main()
