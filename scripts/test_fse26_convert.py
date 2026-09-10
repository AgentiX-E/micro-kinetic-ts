"""
Unit + integration tests for ``scripts/fse26_convert.py``.

Run with::

    python3 -m unittest discover -s scripts -p 'test_fse26_convert.py'

The pure helpers are exercised directly; the Parquet readers are exercised
end-to-end against synthetic Parquet files that mirror the RCABench NORMALISED
schema (the archive is the platform's own converted output, not the raw OTel
export): `time` Datetime, `metric`/`value`/`service_name`, `trace_id`/`span_id`/
`parent_span_id`/`service_name`, and `level`/`message`. The unit-normalisation
and epoch conversion are verified without the 13.4 GB download.
"""

from __future__ import annotations

import datetime
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

import polars as pl

import fse26_convert as conv
import fse26_convert_tar as conv_tar


# ── Pure helpers ─────────────────────────────────────────────────────────


class TestGetServiceName(unittest.TestCase):
    def test_single_dash_service(self) -> None:
        self.assertEqual(conv.get_service_name("ts5-ts-order-service-stress-svfvxk"), "ts-order-service")

    def test_two_dash_service(self) -> None:
        self.assertEqual(
            conv.get_service_name("ts-ts-consign-price-service-mem-xyzabc"), "ts-consign-price-service"
        )

    def test_ui_dashboard(self) -> None:
        self.assertEqual(conv.get_service_name("ts-ts-ui-dashboard-cpu-abc123"), "ts-ui-dashboard")

    def test_mysql(self) -> None:
        self.assertEqual(conv.get_service_name("ts-mysql-networkdelay-aaa111"), "mysql")

    def test_invalid_name_raises(self) -> None:
        with self.assertRaises(ValueError):
            conv.get_service_name("not-a-valid-datapack")


class TestResolveGroundTruthServices(unittest.TestCase):
    def test_network_fault_dual_label(self) -> None:
        result = conv.resolve_ground_truth_services(
            "NetworkDelay",
            {"injection_point": {"source_service": "ts-a-service", "target_service": "ts-b-service"}},
            "ts5-ts-order-service-network-svfvxk",
        )
        self.assertEqual(result, ["ts-a-service", "ts-b-service"])

    def test_network_fault_missing_injection_point(self) -> None:
        result = conv.resolve_ground_truth_services("NetworkDelay", {}, "ts5-ts-order-service-network-svfvxk")
        self.assertEqual(result, ["ts-order-service"])

    def test_network_fault_empty_target(self) -> None:
        result = conv.resolve_ground_truth_services(
            "NetworkLoss",
            {"injection_point": {"source_service": "ts-a-service", "target_service": ""}},
            "ts5-ts-order-service-network-svfvxk",
        )
        self.assertEqual(result, ["ts-order-service"])

    def test_non_network_single_label(self) -> None:
        result = conv.resolve_ground_truth_services("CPUStress", {}, "ts5-ts-order-service-stress-svfvxk")
        self.assertEqual(result, ["ts-order-service"])


class TestFaultCategory(unittest.TestCase):
    """`fault_category` maps each fault type to one of the 7 benchmark categories
    (Pod/Resource/HTTP/DNS/Time/Network/JVM), ported from the platform's
    `FAULT_TYPE_MAPPING`."""

    CATEGORIES = {"Pod", "Resource", "HTTP", "DNS", "Time", "Network", "JVM"}

    def test_every_fault_type_is_mapped(self) -> None:
        self.assertEqual(set(conv.FAULT_TYPES), set(conv.FAULT_CATEGORY.keys()))

    def test_all_categories_are_valid(self) -> None:
        for category in conv.FAULT_CATEGORY.values():
            self.assertIn(category, self.CATEGORIES)

    def test_spot_check_mapping(self) -> None:
        self.assertEqual(conv.fault_category("PodKill"), "Pod")
        self.assertEqual(conv.fault_category("CPUStress"), "Resource")
        self.assertEqual(conv.fault_category("HTTPRequestDelay"), "HTTP")
        self.assertEqual(conv.fault_category("DNSError"), "DNS")
        self.assertEqual(conv.fault_category("TimeSkew"), "Time")
        self.assertEqual(conv.fault_category("NetworkDelay"), "Network")
        self.assertEqual(conv.fault_category("JVMLatency"), "JVM")

    def test_unknown_fault_type_raises(self) -> None:
        with self.assertRaises(ValueError):
            conv.fault_category("NotAFault")


class TestComputeInjectTimeMs(unittest.TestCase):
    def test_gap_uses_midpoint(self) -> None:
        env = {"NORMAL_START": 100, "NORMAL_END": 120, "ABNORMAL_START": 200, "ABNORMAL_END": 220}
        # midpoint = (120 + 200) // 2 = 160 seconds → 160000 ms
        self.assertEqual(conv.compute_inject_time_ms(env), 160000)

    def test_odd_gap_floors(self) -> None:
        env = {"NORMAL_START": 100, "NORMAL_END": 121, "ABNORMAL_START": 200, "ABNORMAL_END": 220}
        # midpoint = (121 + 200) // 2 = 160 seconds (floor of 160.5)
        self.assertEqual(conv.compute_inject_time_ms(env), 160000)

    def test_abutting_windows_use_abnormal_start(self) -> None:
        env = {"NORMAL_START": 100, "NORMAL_END": 200, "ABNORMAL_START": 200, "ABNORMAL_END": 220}
        self.assertEqual(conv.compute_inject_time_ms(env), 200000)

    def test_invalid_ordering_raises(self) -> None:
        env = {"NORMAL_START": 200, "NORMAL_END": 100, "ABNORMAL_START": 300, "ABNORMAL_END": 320}
        with self.assertRaises(ValueError):
            conv.compute_inject_time_ms(env)


class TestFormatBytes(unittest.TestCase):
    """`format_bytes` reports a compact, human-readable byte count."""

    def test_zero(self) -> None:
        self.assertEqual(conv.format_bytes(0), "0 B")

    def test_under_one_kib(self) -> None:
        self.assertEqual(conv.format_bytes(1), "1 B")
        self.assertEqual(conv.format_bytes(1023), "1023 B")

    def test_exact_kib_boundary(self) -> None:
        self.assertEqual(conv.format_bytes(1024), "1.0 KB")

    def test_megabytes(self) -> None:
        self.assertEqual(conv.format_bytes(90_000_000), "85.8 MB")

    def test_gigabytes(self) -> None:
        self.assertEqual(conv.format_bytes(3 * 1024**3), "3.0 GB")

    def test_float_average(self) -> None:
        self.assertEqual(conv.format_bytes(1536.0), "1.5 KB")

    def test_negative_raises(self) -> None:
        with self.assertRaises(ValueError):
            conv.format_bytes(-1)


class TestSummarizeSizes(unittest.TestCase):
    """`summarize_sizes` aggregates per-case volumes into a single line."""

    def test_empty(self) -> None:
        self.assertEqual(conv.summarize_sizes([]), "Size: 0 cases")

    def test_single_case(self) -> None:
        self.assertEqual(
            conv.summarize_sizes([1024]),
            "Size: 1 cases, 1.0 KB total, avg 1.0 KB/case, min 1.0 KB, max 1.0 KB",
        )

    def test_multiple_cases_reports_min_max(self) -> None:
        self.assertEqual(
            conv.summarize_sizes([100, 300]),
            "Size: 2 cases, 400 B total, avg 200 B/case, min 100 B, max 300 B",
        )


class TestMeasureCase(unittest.TestCase):
    """`measure_case` reports a byte-level breakdown of a case document."""

    @staticmethod
    def _case() -> dict:
        return {
            "datapack": "ts5-ts-order-service-stress-svfvxk",
            "faultType": "CPUStress",
            "groundTruthServices": ["ts-order-service"],
            "injectTimeMs": 1757000000000,
            "metrics": {
                "ts-order-service": [
                    {"metric": "container.cpu.usage", "start": 1000, "step": 1000, "values": [1.0, 2.0, 3.0]},
                    {"metric": "container.memory.usage", "timestamps": [1, 5, 6], "values": [512.0, 513.0, 514.0]},
                ]
            },
            "traceEdges": [["ts-ui-dashboard", "ts-order-service"]],
            "logs": [{"timestamp": 1, "service": "ts-order-service", "level": "ERROR", "message": "boom"}],
        }

    def test_sections_partition_total(self) -> None:
        case = self._case()
        m = conv.measure_case(case)
        self.assertEqual(m["total"], len(json.dumps(case, separators=(",", ":"), allow_nan=False)))
        # The four section budgets are a lower bound on `total`; the remainder
        # is just the top-level key names (`"metrics":` / `"logs":` /
        # `"traceEdges":`) and their separators.
        overhead = m["total"] - (m["metrics"] + m["logs"] + m["edges"] + m["meta"])
        self.assertGreaterEqual(overhead, 0)
        self.assertLess(overhead, 64)

    def test_metric_series_statistics(self) -> None:
        m = conv.measure_case(self._case())
        self.assertEqual(m["series"], 2)
        self.assertEqual(m["uniform"], 1)  # cpu compacts; memory is irregular
        self.assertEqual(m["samples"], 6)  # 3 + 3
        self.assertGreater(m["ts_bytes"], 0)
        self.assertGreater(m["val_bytes"], 0)
        # Timestamp + value budgets are a strict subset of the metrics section
        # (the section also carries the metric/service key names).
        self.assertLess(m["ts_bytes"] + m["val_bytes"], m["metrics"])

    def test_gzip_is_a_positive_int(self) -> None:
        m = conv.measure_case(self._case())
        self.assertIsInstance(m["gzip"], int)
        self.assertGreater(m["gzip"], 0)

    def test_header_only_case_has_zero_data_sections(self) -> None:
        case = {"datapack": "dp", "faultType": "CPUStress", "groundTruthServices": ["s"], "injectTimeMs": 1}
        m = conv.measure_case(case)
        self.assertEqual(m["metrics"], 0)
        self.assertEqual(m["logs"], 0)
        self.assertEqual(m["edges"], 0)
        self.assertEqual(m["series"], 0)
        self.assertEqual(m["samples"], 0)
        self.assertEqual(m["total"], m["meta"])


class TestSummarizeMeasurements(unittest.TestCase):
    """`summarize_measurements` aggregates per-case breakdowns into a summary."""

    def test_empty(self) -> None:
        self.assertEqual(conv.summarize_measurements([]), "Breakdown: 0 cases")

    def test_aggregates_totals(self) -> None:
        m = conv.measure_case(TestMeasureCase._case())
        summary = conv.summarize_measurements([m, m])
        self.assertIn("2 cases", summary)
        self.assertIn("total", summary)
        self.assertIn("gzip", summary)
        self.assertIn("metrics", summary)
        self.assertIn("logs", summary)
        self.assertIn("edges", summary)
        self.assertIn("series", summary)
        self.assertIn("uniform", summary)


class TestCompactMetricSeries(unittest.TestCase):
    """`compact_metric_series` collapses uniformly sampled timestamps to a
    `start` + `step` representation, falling back to the explicit list when the
    sampling is irregular (or too short to infer a step)."""

    def test_uniform_series_compacts(self) -> None:
        self.assertEqual(
            conv.compact_metric_series([1000, 2000, 3000], [0.1, 0.2, 0.3]),
            {"start": 1000, "step": 1000, "values": [0.1, 0.2, 0.3]},
        )

    def test_two_sample_uniform_series_compacts(self) -> None:
        self.assertEqual(
            conv.compact_metric_series([1000, 1500], [1.0, 2.0]),
            {"start": 1000, "step": 500, "values": [1.0, 2.0]},
        )

    def test_zero_step_uniform_series_compacts(self) -> None:
        # All samples at one timestamp is still "uniform" (step = 0).
        self.assertEqual(
            conv.compact_metric_series([500, 500, 500], [1.0, 2.0, 3.0]),
            {"start": 500, "step": 0, "values": [1.0, 2.0, 3.0]},
        )

    def test_single_sample_falls_back(self) -> None:
        self.assertEqual(
            conv.compact_metric_series([1000], [0.5]),
            {"timestamps": [1000], "values": [0.5]},
        )

    def test_irregular_series_falls_back(self) -> None:
        self.assertEqual(
            conv.compact_metric_series([1000, 2000, 2500], [1.0, 2.0, 3.0]),
            {"timestamps": [1000, 2000, 2500], "values": [1.0, 2.0, 3.0]},
        )

    def test_empty_series_falls_back(self) -> None:
        self.assertEqual(
            conv.compact_metric_series([], []),
            {"timestamps": [], "values": []},
        )


class TestEpochMs(unittest.TestCase):
    """`_epoch_ms` must normalise both Datetime and integer-epoch time columns."""

    def _apply(self, values: pl.Series) -> list[int]:
        df = pl.DataFrame({"t": values})
        return df.select(conv._epoch_ms(df, "t").alias("ms"))["ms"].to_list()

    def test_datetime_column(self) -> None:
        vals = pl.Series("t", [_dt(NORMAL_START + 1)], dtype=pl.Datetime("ns"))
        self.assertEqual(self._apply(vals), [(NORMAL_START + 1) * 1000])

    def test_int64_nanoseconds(self) -> None:
        ns = (NORMAL_START + 1) * 10**9
        vals = pl.Series("t", [ns], dtype=pl.Int64)
        self.assertEqual(self._apply(vals), [(NORMAL_START + 1) * 1000])

    def test_int64_milliseconds(self) -> None:
        ms = (NORMAL_START + 1) * 1000
        vals = pl.Series("t", [ms], dtype=pl.Int64)
        self.assertEqual(self._apply(vals), [(NORMAL_START + 1) * 1000])

    def test_int64_seconds(self) -> None:
        vals = pl.Series("t", [NORMAL_START + 1], dtype=pl.Int64)
        self.assertEqual(self._apply(vals), [(NORMAL_START + 1) * 1000])


class TestNonFiniteSanitization(unittest.TestCase):
    """NaN/Infinity metric values must be dropped (else `json.dumps` emits
    `NaN`/`Infinity` tokens that JS `JSON.parse` rejects as invalid JSON)."""

    def test_non_finite_metric_values_dropped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pl.DataFrame(
                {
                    "time": [_dt(NORMAL_START + i) for i in range(4)],
                    "metric": ["m", "m", "m", "m"],
                    "value": [0.1, float("nan"), float("inf"), 0.2],
                    "service_name": ["svc", "svc", "svc", "svc"],
                }
            ).write_parquet(root / "normal_metrics.parquet")

            result = conv.read_metrics(root / "normal_metrics.parquet", root / "missing.parquet")

        series = result["svc"]
        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["values"], [0.1, 0.2])
        # Two surviving samples (t0 and t3) → uniform → start + step (3 s gap).
        self.assertEqual(series[0]["start"], (NORMAL_START + 0) * 1000)
        self.assertEqual(series[0]["step"], 3 * 1000)


class TestReadTraceEdges(unittest.TestCase):
    """`read_trace_edges` resolves each span's parent service and emits the
    distinct caller → callee edges (self-calls and unresolvable parents dropped)."""

    def _write_traces(self, root: Path, name: str, rows: list[tuple[str, str, str, str]]) -> Path:
        """Write a traces Parquet from (trace_id, span_id, parent_span_id, service) rows."""
        path = root / name
        pl.DataFrame(
            {
                "trace_id": [r[0] for r in rows],
                "span_id": [r[1] for r in rows],
                "parent_span_id": [r[2] for r in rows],
                "service_name": [r[3] for r in rows],
            }
        ).write_parquet(path)
        return path

    def test_resolves_parent_across_normal_and_abnormal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            normal = self._write_traces(
                root,
                "normal_traces.parquet",
                [("t1", "s0", "", "ts-ui-dashboard"), ("t1", "s1", "s0", "ts-order-service")],
            )
            abnormal = self._write_traces(
                root, "abnormal_traces.parquet", [("t2", "s2", "", "ts-order-service")]
            )
            edges = conv.read_trace_edges(normal, abnormal)
        self.assertEqual(edges, [["ts-ui-dashboard", "ts-order-service"]])

    def test_excludes_self_calls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            normal = self._write_traces(
                root,
                "normal_traces.parquet",
                [("t1", "s0", "", "ts-order-service"), ("t1", "s1", "s0", "ts-order-service")],
            )
            edges = conv.read_trace_edges(normal, root / "missing.parquet")
        self.assertEqual(edges, [])

    def test_ignores_unresolvable_parent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            normal = self._write_traces(
                root,
                "normal_traces.parquet",
                [("t1", "s0", "", "ts-order-service"), ("t1", "s1", "ghost", "ts-station-service")],
            )
            edges = conv.read_trace_edges(normal, root / "missing.parquet")
        self.assertEqual(edges, [])

    def test_deduplicates_repeated_edges(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            normal = self._write_traces(
                root,
                "normal_traces.parquet",
                [
                    ("t1", "a", "", "ts-order-service"),
                    ("t1", "b", "a", "ts-station-service"),
                    ("t2", "c", "", "ts-order-service"),
                    ("t2", "d", "c", "ts-station-service"),
                ],
            )
            edges = conv.read_trace_edges(normal, root / "missing.parquet")
        self.assertEqual(edges, [["ts-order-service", "ts-station-service"]])

    def test_empty_when_no_trace_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            edges = conv.read_trace_edges(root / "missing1.parquet", root / "missing2.parquet")
        self.assertEqual(edges, [])


class TestReadMetricsHistogram(unittest.TestCase):
    """`read_metrics_histogram` emits a `{metric}.max` series per histogram metric
    (the peak per-scrape value), ignoring `count`/`sum`/`min`."""

    def test_emits_max_series_per_metric(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pl.DataFrame(
                {
                    "time": [_dt(NORMAL_START + 1), _dt(NORMAL_START + 6)],
                    "metric": ["jvm.gc.duration", "jvm.gc.duration"],
                    "service_name": ["svc", "svc"],
                    "count": [10, 20],
                    "sum": [100.0, 200.0],
                    "min": [1.0, 1.0],
                    "max": [12.0, 25.0],
                }
            ).write_parquet(root / "normal_metrics_histogram.parquet")

            result = conv.read_metrics_histogram(
                root / "normal_metrics_histogram.parquet", root / "missing.parquet"
            )

        series = result["svc"]
        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["metric"], "jvm.gc.duration.max")
        # Two uniform samples (5 s apart) → compacted to start + step.
        self.assertEqual(series[0]["values"], [12.0, 25.0])
        self.assertEqual(series[0]["start"], (NORMAL_START + 1) * 1000)
        self.assertEqual(series[0]["step"], 5 * 1000)

    def test_ignores_sum_count_min_columns(self) -> None:
        # Only the `max` column is consumed; the others never produce a series.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pl.DataFrame(
                {
                    "time": [_dt(NORMAL_START + 1)],
                    "metric": ["jvm.memory.used"],
                    "service_name": ["svc"],
                    "count": [1],
                    "sum": [512.0],
                    "min": [512.0],
                    "max": [512.0],
                }
            ).write_parquet(root / "normal_metrics_histogram.parquet")

            result = conv.read_metrics_histogram(
                root / "normal_metrics_histogram.parquet", root / "missing.parquet"
            )

        self.assertEqual([s["metric"] for s in result["svc"]], ["jvm.memory.used.max"])

    def test_missing_max_column_is_graceful(self) -> None:
        # A histogram Parquet without a `max` column (schema drift) contributes
        # nothing rather than raising.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pl.DataFrame(
                {
                    "time": [_dt(NORMAL_START + 1)],
                    "metric": ["jvm.gc.duration"],
                    "service_name": ["svc"],
                    "count": [1],
                    "sum": [10.0],
                }
            ).write_parquet(root / "normal_metrics_histogram.parquet")

            result = conv.read_metrics_histogram(
                root / "normal_metrics_histogram.parquet", root / "missing.parquet"
            )

        self.assertEqual(result, {})

    def test_empty_when_no_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = conv.read_metrics_histogram(root / "a.parquet", root / "b.parquet")
        self.assertEqual(result, {})


class TestReadTraceDerivedMetrics(unittest.TestCase):
    """`read_trace_derived_metrics` derives per-service latency + error-rate series
    from trace spans, bucketed into 10 s windows."""

    @staticmethod
    def _write_traces(root: Path, name: str) -> None:
        """Two services in one 10 s window; svc-a has two spans (mean 2 ms, one
        500 → 50% error), svc-b has one span (5 ms, 200 → 0% error)."""
        pl.DataFrame(
            {
                "time": [_dt(NORMAL_START + 1), _dt(NORMAL_START + 5), _dt(NORMAL_START + 3)],
                "service_name": ["svc-a", "svc-a", "svc-b"],
                "duration": [1_000_000, 3_000_000, 5_000_000],
                "attr.http.response.status_code": [200, 500, 200],
            }
        ).write_parquet(root / name)

    def test_derives_latency_and_error_rate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_traces(root, "normal_traces.parquet")

            result = conv.read_trace_derived_metrics(
                root / "normal_traces.parquet", root / "missing.parquet"
            )

        by_metric = {s["metric"]: s for s in result["svc-a"]}
        self.assertIn("http.server.request.duration", by_metric)
        self.assertIn("http.response.error_rate", by_metric)
        # mean(1 ms, 3 ms) = 2.0 ms; one window → explicit timestamps.
        self.assertEqual(by_metric["http.server.request.duration"]["values"], [2.0])
        self.assertEqual(by_metric["http.response.error_rate"]["values"], [50.0])

        # svc-b: single span, all 200 → 0% error.
        by_metric_b = {s["metric"]: s for s in result["svc-b"]}
        self.assertEqual(by_metric_b["http.server.request.duration"]["values"], [5.0])
        self.assertEqual(by_metric_b["http.response.error_rate"]["values"], [0.0])

    def test_skips_error_rate_without_status_column(self) -> None:
        # Without `attr.http.response.status_code`, only latency is derived.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pl.DataFrame(
                {
                    "time": [_dt(NORMAL_START + 1)],
                    "service_name": ["svc-a"],
                    "duration": [2_000_000],
                }
            ).write_parquet(root / "normal_traces.parquet")

            result = conv.read_trace_derived_metrics(
                root / "normal_traces.parquet", root / "missing.parquet"
            )

        metrics = [s["metric"] for s in result["svc-a"]]
        self.assertEqual(metrics, ["http.server.request.duration"])

    def test_empty_when_no_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = conv.read_trace_derived_metrics(root / "a.parquet", root / "b.parquet")
        self.assertEqual(result, {})


class TestMergeMetricMaps(unittest.TestCase):
    """`merge_metric_maps` concatenates per-service series lists."""

    def test_concatenates_per_service(self) -> None:
        merged = conv.merge_metric_maps(
            {"svc": [{"metric": "m1"}]},
            {"svc": [{"metric": "m2"}], "other": [{"metric": "m3"}]},
        )
        self.assertEqual(merged["svc"], [{"metric": "m1"}, {"metric": "m2"}])
        self.assertEqual(merged["other"], [{"metric": "m3"}])

    def test_empty_inputs(self) -> None:
        self.assertEqual(conv.merge_metric_maps(), {})
        self.assertEqual(conv.merge_metric_maps({}, {}), {})

    def test_preserves_duplicate_metric_names(self) -> None:
        # Duplicate names within a service are preserved (each series is scored
        # independently by the engine).
        merged = conv.merge_metric_maps(
            {"svc": [{"metric": "m1"}]}, {"svc": [{"metric": "m1"}]}
        )
        self.assertEqual(merged["svc"], [{"metric": "m1"}, {"metric": "m1"}])


# ── End-to-end synthetic datapack ────────────────────────────────────────

# Window boundaries (Unix seconds, UTC).
NORMAL_START = 1_767_225_600
NORMAL_END = 1_767_225_660
ABNORMAL_START = 1_767_225_720
ABNORMAL_END = 1_767_225_780


def _dt(seconds: int) -> datetime.datetime:
    """UTC datetime for a Unix-second timestamp."""
    return datetime.datetime.fromtimestamp(seconds, tz=datetime.timezone.utc)


def _build_synthetic_datapack(root: Path, datapack_name: str) -> Path:
    """Write a minimal RCABench-format datapack directory under `root`."""
    src = root / datapack_name
    src.mkdir(parents=True, exist_ok=True)

    # Metrics: one service, two metrics, spanning normal + abnormal windows.
    pl.DataFrame(
        {
            "time": [_dt(NORMAL_START + 1), _dt(NORMAL_END - 1)],
            "metric": ["container.cpu.usage", "container.cpu.usage"],
            "value": [0.1, 0.2],
            "service_name": ["ts-order-service", "ts-order-service"],
        }
    ).write_parquet(src / "normal_metrics.parquet")
    pl.DataFrame(
        {
            "time": [_dt(ABNORMAL_START + 1)],
            "metric": ["container.memory.usage"],
            "value": [512.0],
            "service_name": ["ts-order-service"],
        }
    ).write_parquet(src / "abnormal_metrics.parquet")

    # Traces: a root span (empty parent) and a child span. Extra span columns
    # (span_name/duration/attr.status_code) are present but ignored by the edge
    # reader, which reads only the four edge-relevant columns.
    pl.DataFrame(
        {
            "time": [_dt(NORMAL_START + 2), _dt(NORMAL_END - 2)],
            "trace_id": ["t1", "t1"],
            "span_id": ["s0", "s1"],
            "parent_span_id": ["", "s0"],
            "span_name": ["GET /orders", "db query"],
            "service_name": ["ts-ui-dashboard", "ts-order-service"],
            "duration": [1_000_000, 2_500_000],
            "attr.status_code": [1, 2],
        }
    ).write_parquet(src / "normal_traces.parquet")
    pl.DataFrame(
        {
            "time": [_dt(ABNORMAL_START + 2)],
            "trace_id": ["t2"],
            "span_id": ["s2"],
            "parent_span_id": [""],
            "span_name": ["GET /health"],
            "service_name": ["ts-order-service"],
            "duration": [500_000],
            "attr.status_code": [0],
        }
    ).write_parquet(src / "abnormal_traces.parquet")

    # Logs: one error, one ui-dashboard (filtered), one null-level (→ INFO).
    pl.DataFrame(
        {
            "time": [_dt(NORMAL_START + 3), _dt(NORMAL_END - 3)],
            "level": ["error", "WARN"],
            "service_name": ["ts-order-service", "ts-ui-dashboard"],
            "message": ["Connection refused", "high latency"],
        }
    ).write_parquet(src / "normal_logs.parquet")
    pl.DataFrame(
        {
            "time": [_dt(ABNORMAL_START + 3)],
            "level": [None],
            "service_name": ["ts-order-service"],
            "message": ["null-level log"],
        }
    ).write_parquet(src / "abnormal_logs.parquet")

    # Network fault → dual-label ground truth (source + target).
    injection = {
        "fault_type": 17,  # "NetworkDelay"
        "display_config": json.dumps(
            {"injection_point": {"source_service": "ts-order-service", "target_service": "ts-travel-service"}}
        ),
        "engine_config": "{}",
    }
    (src / "injection.json").write_text(json.dumps(injection), "utf-8")

    env = {
        "NORMAL_START": NORMAL_START,
        "NORMAL_END": NORMAL_END,
        "ABNORMAL_START": ABNORMAL_START,
        "ABNORMAL_END": ABNORMAL_END,
    }
    (src / "env.json").write_text(json.dumps(env), "utf-8")

    return src


class TestConvertDatapackEndToEnd(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_network_fault_round_trip(self) -> None:
        src = _build_synthetic_datapack(self.root, "ts5-ts-order-service-network-svfvxk")
        dst = self.root / "out"
        out_path = conv.convert_datapack(src, dst / src.name)

        self.assertTrue(out_path.exists())
        case = json.loads(out_path.read_text("utf-8"))

        # Header fields.
        self.assertEqual(case["datapack"], "ts5-ts-order-service-network-svfvxk")
        self.assertEqual(case["faultType"], "NetworkDelay")
        self.assertEqual(case["faultCategory"], "Network")
        self.assertEqual(case["groundTruthServices"], ["ts-order-service", "ts-travel-service"])
        expected_inject_ms = ((NORMAL_END + ABNORMAL_START) // 2) * 1000
        self.assertEqual(case["injectTimeMs"], expected_inject_ms)

        # Metrics: one service, two metric series, epoch-ms timestamps.
        order_metrics = case["metrics"]["ts-order-service"]
        by_metric = {m["metric"]: m for m in order_metrics}
        self.assertIn("container.cpu.usage", by_metric)
        self.assertIn("container.memory.usage", by_metric)

        cpu = by_metric["container.cpu.usage"]
        # Two samples → uniform → compacted to start + step (58 s gap in ms).
        self.assertEqual(cpu["start"], (NORMAL_START + 1) * 1000)
        self.assertEqual(cpu["step"], (NORMAL_END - NORMAL_START - 2) * 1000)
        self.assertEqual(cpu["values"], [0.1, 0.2])

        mem = by_metric["container.memory.usage"]
        # One sample → falls back to the explicit timestamps list.
        self.assertEqual(mem["timestamps"], [(ABNORMAL_START + 1) * 1000])
        self.assertEqual(mem["values"], [512.0])

        # Trace edges: parent→child resolved, root spans contribute no edge.
        self.assertEqual(case["traceEdges"], [["ts-ui-dashboard", "ts-order-service"]])

        # Logs: upper-cased level, ui-dashboard filtered, null level → INFO.
        self.assertEqual(len(case["logs"]), 2)
        levels = {l["level"] for l in case["logs"]}
        self.assertEqual(levels, {"ERROR", "INFO"})
        self.assertTrue(all(l["service"] == "ts-order-service" for l in case["logs"]))

    def test_non_network_fault_single_label(self) -> None:
        src = _build_synthetic_datapack(self.root, "ts5-ts-order-service-stress-svfvxk")
        # Overwrite injection.json with a non-network fault type (CPUStress = 4).
        injection = {"fault_type": 4, "display_config": "{}", "engine_config": "{}"}
        (src / "injection.json").write_text(json.dumps(injection), "utf-8")

        dst = self.root / "out"
        out_path = conv.convert_datapack(src, dst / src.name)
        case = json.loads(out_path.read_text("utf-8"))

        self.assertEqual(case["faultType"], "CPUStress")
        self.assertEqual(case["faultCategory"], "Resource")
        self.assertEqual(case["groundTruthServices"], ["ts-order-service"])

    def test_derived_metrics_round_trip(self) -> None:
        """`build_case` merges gauge + summary + histogram + trace-derived series
        into one per-service metric map."""
        src = _build_synthetic_datapack(self.root, "ts5-ts-order-service-stress-svfvxk")

        # Histogram: jvm.gc.duration peak → `jvm.gc.duration.max`.
        pl.DataFrame(
            {
                "time": [_dt(NORMAL_START + 1)],
                "metric": ["jvm.gc.duration"],
                "service_name": ["ts-order-service"],
                "count": [10],
                "sum": [100.0],
                "min": [1.0],
                "max": [12.0],
            }
        ).write_parquet(src / "normal_metrics_histogram.parquet")

        # Summary: an app-level latency summary (same normalised schema).
        pl.DataFrame(
            {
                "time": [_dt(NORMAL_START + 1)],
                "metric": ["http.client.request.duration"],
                "value": [4.5],
                "service_name": ["ts-order-service"],
            }
        ).write_parquet(src / "normal_metrics_sum.parquet")

        # Traces: add HTTP status codes so error_rate is derivable (keep the
        # edge-relevant columns so `read_trace_edges` still resolves callers).
        pl.DataFrame(
            {
                "time": [_dt(NORMAL_START + 1), _dt(NORMAL_START + 3)],
                "trace_id": ["t1", "t1"],
                "span_id": ["s0", "s1"],
                "parent_span_id": ["", "s0"],
                "service_name": ["ts-order-service", "ts-order-service"],
                "duration": [1_000_000, 3_000_000],
                "attr.http.response.status_code": [200, 500],
            }
        ).write_parquet(src / "normal_traces.parquet")

        dst = self.root / "out"
        out_path = conv.convert_datapack(src, dst / src.name)
        case = json.loads(out_path.read_text("utf-8"))

        by_metric = {m["metric"]: m for m in case["metrics"]["ts-order-service"]}
        # Gauge, summary, histogram, and both trace-derived signals all present.
        self.assertIn("container.cpu.usage", by_metric)
        self.assertIn("container.memory.usage", by_metric)
        self.assertIn("http.client.request.duration", by_metric)
        self.assertIn("jvm.gc.duration.max", by_metric)
        self.assertIn("http.server.request.duration", by_metric)
        self.assertIn("http.response.error_rate", by_metric)

        self.assertEqual(by_metric["jvm.gc.duration.max"]["values"], [12.0])
        self.assertEqual(by_metric["http.client.request.duration"]["values"], [4.5])
        # Two windows: normal (two spans → mean 2 ms) then abnormal (one span,
        # 0.5 ms from the synthetic builder). Error rate only exists in the
        # normal window (the abnormal trace lacks the status column) → 50%.
        self.assertEqual(by_metric["http.server.request.duration"]["values"], [2.0, 0.5])
        self.assertEqual(by_metric["http.response.error_rate"]["values"], [50.0])


# ── Streaming tar conversion ─────────────────────────────────────────────


def _build_tar(root: Path, tar_path: Path) -> None:
    """Tar+gzip the synthetic datapacks under `root` into `tar_path`."""
    with tarfile.open(tar_path, "w:gz") as tf:
        for datapack in sorted(p for p in root.iterdir() if p.is_dir()):
            tf.add(datapack, arcname=datapack.name)


class TestStreamConvertTar(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_stream_convert_two_datapacks(self) -> None:
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-network-svfvxk")
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-stress-svfvxk")
        tar_path = self.root / "rcabench.tar.gz"
        _build_tar(self.root, tar_path)

        out = self.root / "out"
        ok, failed = conv_tar.stream_convert_tar(tar_path, out)

        self.assertEqual((ok, failed), (2, 0))
        self.assertTrue((out / "ts5-ts-order-service-network-svfvxk" / "case.json").exists())
        self.assertTrue((out / "ts5-ts-order-service-stress-svfvxk" / "case.json").exists())

    def test_limit_converts_only_prefix(self) -> None:
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-network-svfvxk")
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-stress-svfvxk")
        tar_path = self.root / "rcabench.tar.gz"
        _build_tar(self.root, tar_path)

        out = self.root / "out"
        ok, failed = conv_tar.stream_convert_tar(tar_path, out, limit=1)

        self.assertEqual((ok, failed), (1, 0))
        # The datapack dirs sort lexicographically; only the first converts.
        converted = [p.name for p in out.iterdir() if (p / "case.json").exists()]
        self.assertEqual(len(converted), 1)

    def test_iter_datapack_dirs_skips_non_datapacks(self) -> None:
        # A stray top-level file must not be mistaken for a datapack dir.
        stray = self.root / "README.txt"
        stray.write_text("not a datapack", "utf-8")
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-network-svfvxk")
        tar_path = self.root / "rcabench.tar.gz"
        _build_tar(self.root, tar_path)

        with tarfile.open(tar_path, "r:gz") as tf:
            dirs = conv_tar.iter_datapack_dirs(tf)
        self.assertEqual(dirs, ["ts5-ts-order-service-network-svfvxk"])

    def test_truncated_archive_stops_cleanly(self) -> None:
        # A range-downloaded prefix ends mid-gzip-stream. The streaming walk
        # must convert the complete datapacks and discard the incomplete one
        # without raising. (The synthetic parquet compresses ~13x, so a
        # near-full truncation is used to guarantee the first datapack is
        # complete while the second is cut.)
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-network-svfvxk")
        _build_synthetic_datapack(self.root, "ts5-ts-order-service-stress-svfvxk")
        tar_path = self.root / "rcabench.tar.gz"
        _build_tar(self.root, tar_path)

        data = tar_path.read_bytes()
        truncated = tar_path.with_name("rcabench-truncated.tar.gz")
        truncated.write_bytes(data[: int(len(data) * 0.95)])

        out = self.root / "out"
        ok, failed = conv_tar.stream_convert_tar(truncated, out)

        # The complete first datapack converts; the truncated second is
        # discarded or fails, and the walk never raises.
        first = out / "ts5-ts-order-service-network-svfvxk" / "case.json"
        self.assertTrue(first.exists(), "the complete first datapack must convert")
        json.loads(first.read_text("utf-8"))  # valid JSON
        self.assertEqual(ok, 1)
        self.assertLessEqual(failed, 1)


if __name__ == "__main__":
    unittest.main()
