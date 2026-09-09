"""
Unit + integration tests for ``scripts/fse26_convert.py``.

Run with::

    python3 -m unittest discover -s scripts -p 'test_fse26_convert.py'

The pure helpers are exercised directly; the Parquet readers are exercised
end-to-end against synthetic Parquet files that mirror the RCABench schema
(Datetime time columns, nanosecond `Duration`, integer OTel `StatusCode` enum),
so the unit-normalisation and epoch conversion are verified without the 13.4 GB
download.
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


class TestStatusCodeToStatus(unittest.TestCase):
    def test_enum_mapping(self) -> None:
        self.assertEqual(conv.status_code_to_status(0), "OK")
        self.assertEqual(conv.status_code_to_status(1), "OK")
        self.assertEqual(conv.status_code_to_status(2), "ERROR")

    def test_null_treated_as_ok(self) -> None:
        self.assertEqual(conv.status_code_to_status(None), "OK")


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
            "TimeUnix": [_dt(NORMAL_START + 1), _dt(NORMAL_END - 1)],
            "MetricName": ["container.cpu.usage", "container.cpu.usage"],
            "Value": [0.1, 0.2],
            "ServiceName": ["ts-order-service", "ts-order-service"],
        }
    ).write_parquet(src / "normal_metrics.parquet")
    pl.DataFrame(
        {
            "TimeUnix": [_dt(ABNORMAL_START + 1)],
            "MetricName": ["container.memory.usage"],
            "Value": [512.0],
            "ServiceName": ["ts-order-service"],
        }
    ).write_parquet(src / "abnormal_metrics.parquet")

    # Traces: root span (empty parent), an ERROR child, and an unset-status span.
    pl.DataFrame(
        {
            "Timestamp": [_dt(NORMAL_START + 2), _dt(NORMAL_END - 2)],
            "TraceId": ["t1", "t1"],
            "SpanId": ["s0", "s1"],
            "ParentSpanId": ["", "s0"],
            "SpanName": ["GET /orders", "db query"],
            "ServiceName": ["ts-ui-dashboard", "ts-order-service"],
            "Duration": [1_000_000, 2_500_000],
            "StatusCode": [1, 2],
        }
    ).write_parquet(src / "normal_traces.parquet")
    pl.DataFrame(
        {
            "Timestamp": [_dt(ABNORMAL_START + 2)],
            "TraceId": ["t2"],
            "SpanId": ["s2"],
            "ParentSpanId": [""],
            "SpanName": ["GET /health"],
            "ServiceName": ["ts-order-service"],
            "Duration": [500_000],
            "StatusCode": [0],
        }
    ).write_parquet(src / "abnormal_traces.parquet")

    # Logs: one error, one ui-dashboard (filtered), one null-level (→ INFO).
    pl.DataFrame(
        {
            "Timestamp": [_dt(NORMAL_START + 3), _dt(NORMAL_END - 3)],
            "SeverityText": ["error", "WARN"],
            "ServiceName": ["ts-order-service", "ts-ui-dashboard"],
            "Body": ["Connection refused", "high latency"],
        }
    ).write_parquet(src / "normal_logs.parquet")
    pl.DataFrame(
        {
            "Timestamp": [_dt(ABNORMAL_START + 3)],
            "SeverityText": [None],
            "ServiceName": ["ts-order-service"],
            "Body": ["null-level log"],
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
        self.assertEqual(case["groundTruthServices"], ["ts-order-service", "ts-travel-service"])
        expected_inject_ms = ((NORMAL_END + ABNORMAL_START) // 2) * 1000
        self.assertEqual(case["injectTimeMs"], expected_inject_ms)

        # Metrics: one service, two metric series, epoch-ms timestamps.
        order_metrics = case["metrics"]["ts-order-service"]
        by_metric = {m["metric"]: m for m in order_metrics}
        self.assertIn("container.cpu.usage", by_metric)
        self.assertIn("container.memory.usage", by_metric)

        cpu = by_metric["container.cpu.usage"]
        self.assertEqual(cpu["timestamps"], [(NORMAL_START + 1) * 1000, (NORMAL_END - 1) * 1000])
        self.assertEqual(cpu["values"], [0.1, 0.2])

        mem = by_metric["container.memory.usage"]
        self.assertEqual(mem["timestamps"], [(ABNORMAL_START + 1) * 1000])
        self.assertEqual(mem["values"], [512.0])

        # Traces: epoch-ms start times, ns→ms duration, status enum, parent omitted for roots.
        traces = {t["spanId"]: t for t in case["traces"]}
        self.assertEqual(traces["s0"]["status"], "OK")
        self.assertNotIn("parentSpanId", traces["s0"])
        self.assertEqual(traces["s0"]["duration"], 1.0)

        self.assertEqual(traces["s1"]["status"], "ERROR")
        self.assertEqual(traces["s1"]["parentSpanId"], "s0")
        self.assertEqual(traces["s1"]["duration"], 2.5)

        self.assertEqual(traces["s2"]["status"], "OK")
        self.assertEqual(traces["s2"]["duration"], 0.5)

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
        self.assertEqual(case["groundTruthServices"], ["ts-order-service"])


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
