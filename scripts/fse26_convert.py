#!/usr/bin/env python3
"""
Convert FSE'26 RCABench datapacks (Parquet) into normalised JSON.

RCABench (arXiv:2510.04711) publishes 1,430 fault-propagation-aware RCA cases
collected on Train Ticket. The `rcabench-absolute_anomaly.tar.gz` artifact
(13.4 GB) contains one directory per datapack with `normal_*.parquet` /
`abnormal_*.parquet` observability slices plus `injection.json` and `env.json`.
This bridge reads those Parquet files and emits a single `case.json` per
datapack, mirroring the column mapping of the RCABench platform's own
`convert_metrics` / `convert_traces` / `convert_logs` (see the platform's
`v2/sources/rcabench.py`) so the TypeScript `FSE26Loader` consumes the exact
same normalised view the benchmark's evaluator uses.

Output `case.json` schema (per datapack):

    {
      "datapack": "ts5-ts-order-service-stress-svfvxk",
      "faultType": "CPUStress",
      "groundTruthServices": ["ts-order-service"],
      "injectTimeMs": 1757000000000,
      "metrics": {
        "ts-order-service": [
          {"metric": "container.cpu.usage", "timestamps": [1756998000000], "values": [0.1]}
        ]
      },
      "traces": [
        {"traceId": "...", "spanId": "...", "parentSpanId": "...", "service": "...",
         "operationName": "...", "startTime": 1756998000000, "duration": 12.5, "status": "OK"}
      ],
      "logs": [
        {"timestamp": 1756998000000, "service": "...", "level": "ERROR", "message": "..."}
      ]
    }

All timestamps are Unix milliseconds, all durations milliseconds, log levels are
upper-cased, and trace status is normalised to OK/ERROR (the OTel StatusCode enum
2 = Error; everything else, including unset, is OK).

Ground truth follows the benchmark's dual-label convention: network faults
(`NetworkDelay` / `NetworkLoss` / …) are injected on an EDGE, so both the
injection point's `source_service` and `target_service` are valid answers; every
other fault carries the single injected service (parsed from the datapack name).

Usage:
  python3 scripts/fse26_convert.py --data-dir <extracted-tar> --out-dir <json> \
      [--limit N] [--include dp1,dp2] [--force]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import polars as pl


# ── Constants ported verbatim from the RCABench platform ─────────────────

# Fault types indexed by `injection.json`'s integer `fault_type` (see the
# platform's `datasets/rcabench.py:FAULT_TYPES`).
FAULT_TYPES: list[str] = [
    "PodKill",
    "PodFailure",
    "ContainerKill",
    "MemoryStress",
    "CPUStress",
    "HTTPRequestAbort",
    "HTTPResponseAbort",
    "HTTPRequestDelay",
    "HTTPResponseDelay",
    "HTTPResponseReplaceBody",
    "HTTPResponsePatchBody",
    "HTTPRequestReplacePath",
    "HTTPRequestReplaceMethod",
    "HTTPResponseReplaceCode",
    "DNSError",
    "DNSRandom",
    "TimeSkew",
    "NetworkDelay",
    "NetworkLoss",
    "NetworkDuplicate",
    "NetworkCorrupt",
    "NetworkBandwidth",
    "NetworkPartition",
    "JVMLatency",
    "JVMReturn",
    "JVMException",
    "JVMGarbageCollector",
    "JVMCPUStress",
    "JVMMemoryStress",
    "JVMMySQLLatency",
    "JVMMySQLException",
]

# Datapack-name pattern used by the platform to recover the injected service
# (`datasets/rcabench.py:rcabench_get_service_name`). group(2) is the service.
DATAPACK_PATTERN = re.compile(
    r"(ts|ts\d)-(mysql|ts-rabbitmq|ts-ui-dashboard|ts-\w+-service|"
    r"ts-\w+-\w+-service|ts-\w+-\w+-\w+-service)-(.+)-[^-]+"
)

# Fault types injected on an EDGE (dual-label ground truth).
_NETWORK_PREFIX = "Network"


# ── Pure helpers (unit-testable, no polars) ──────────────────────────────


def get_service_name(datapack_name: str) -> str:
    """Recover the injected service name from a datapack name."""
    match = DATAPACK_PATTERN.match(datapack_name)
    if match is None:
        raise ValueError(f"Invalid datapack name: `{datapack_name}`")
    return match.group(2)


def resolve_ground_truth_services(
    fault_type: str,
    display_config: dict[str, Any],
    datapack_name: str,
) -> list[str]:
    """
    Resolve the accepted ground-truth service labels.

    Network faults inject on an edge, so both the injection point's source and
    target service are valid answers (dual-label). Every other fault carries the
    single injected service recovered from the datapack name.
    """
    if fault_type.startswith(_NETWORK_PREFIX):
        injection_point = display_config.get("injection_point")
        if isinstance(injection_point, dict):
            source = injection_point.get("source_service")
            target = injection_point.get("target_service")
            if source and target:
                return [source, target]
    return [get_service_name(datapack_name)]


def compute_inject_time_ms(env: dict[str, Any]) -> int:
    """
    Compute the injection timestamp in Unix milliseconds.

    Mirrors the platform's `load_inject_time` (SDG builder): the fault is
    injected between the end of the normal window and the start of the abnormal
    window, so the anchor is the midpoint of the gap (or `ABNORMAL_START` when
    the two windows abut).
    """
    normal_start = int(env["NORMAL_START"])
    normal_end = int(env["NORMAL_END"])
    abnormal_start = int(env["ABNORMAL_START"])
    abnormal_end = int(env["ABNORMAL_END"])
    if not (normal_start < normal_end <= abnormal_start < abnormal_end):
        raise ValueError(
            f"Invalid env window ordering: {normal_start} < {normal_end} "
            f"<= {abnormal_start} < {abnormal_end}"
        )
    if normal_end < abnormal_start:
        inject_seconds = (normal_end + abnormal_start) // 2
    else:
        inject_seconds = abnormal_start
    return inject_seconds * 1000


def status_code_to_status(status_code: Any) -> str:
    """Map the OTel StatusCode enum (0=Unset, 1=Ok, 2=Error) to OK/ERROR."""
    return "ERROR" if status_code == 2 else "OK"


# ── Parquet readers (polars) ─────────────────────────────────────────────


def _epoch_ms(df: pl.DataFrame, col: str) -> pl.Expr:
    """Return an expression converting a Datetime column to Unix milliseconds."""
    dtype = df[col].dtype
    if isinstance(dtype, pl.Datetime):
        return pl.col(col).dt.epoch("ms")
    raise TypeError(f"Expected Datetime column `{col}`, got {dtype}")


def read_metrics(normal_path: Path, abnormal_path: Path) -> dict[str, list[dict[str, Any]]]:
    """
    Read normal + abnormal metrics and group into per-service time series.

    Returns ``{service: [{"metric", "timestamps", "values"}, ...]}`` with each
    series sorted by ascending timestamp.
    """
    frames: list[pl.DataFrame] = []
    for path in (normal_path, abnormal_path):
        if not path.exists():
            continue
        schema = pl.scan_parquet(path).collect_schema()
        if "ServiceName" not in schema:
            # Infra-level metrics (node/hubble) lack a service attribution and
            # cannot inform service-level RCA, so they are dropped.
            continue
        frames.append(
            pl.read_parquet(path, columns=["TimeUnix", "MetricName", "Value", "ServiceName"])
        )
    if not frames:
        return {}

    df = pl.concat(frames)
    df = df.rename(
        {
            "TimeUnix": "time",
            "MetricName": "metric",
            "Value": "value",
            "ServiceName": "service",
        }
    )
    df = df.with_columns(
        _epoch_ms(df, "time").alias("time"),
        pl.col("value").cast(pl.Float64),
    )
    df = df.filter(
        pl.col("time").is_not_null()
        & pl.col("metric").is_not_null()
        & pl.col("service").is_not_null()
        & pl.col("value").is_not_null()
    )

    out: dict[str, list[dict[str, Any]]] = {}
    for (service,), service_df in df.group_by("service", maintain_order=False):
        series: list[dict[str, Any]] = []
        for (metric,), metric_df in service_df.group_by("metric", maintain_order=False):
            metric_df = metric_df.sort("time")
            series.append(
                {
                    "metric": metric,
                    "timestamps": metric_df["time"].to_list(),
                    "values": metric_df["value"].to_list(),
                }
            )
        if series:
            out[service] = series
    return out


def read_traces(normal_path: Path, abnormal_path: Path) -> list[dict[str, Any]]:
    """
    Read normal + abnormal trace spans and normalise to the loader's schema.

    `parentSpanId` is omitted for root spans (empty/null parent). `Duration` is
    converted from nanoseconds to milliseconds.
    """
    frames: list[pl.DataFrame] = []
    for path in (normal_path, abnormal_path):
        if not path.exists():
            continue
        frames.append(
            pl.read_parquet(
                path,
                columns=[
                    "Timestamp",
                    "TraceId",
                    "SpanId",
                    "ParentSpanId",
                    "SpanName",
                    "ServiceName",
                    "Duration",
                    "StatusCode",
                ],
            )
        )
    if not frames:
        return []

    df = pl.concat(frames)
    df = df.rename(
        {
            "Timestamp": "time",
            "TraceId": "trace_id",
            "SpanId": "span_id",
            "ParentSpanId": "parent_span_id",
            "SpanName": "span_name",
            "ServiceName": "service",
            "Duration": "duration",
            "StatusCode": "status_code",
        }
    )
    df = df.with_columns(
        _epoch_ms(df, "time").alias("time"),
        (pl.col("duration").cast(pl.Float64) / 1_000_000.0).alias("duration"),
    )
    df = df.filter(
        pl.col("service").is_not_null()
        & pl.col("span_id").is_not_null()
        & pl.col("trace_id").is_not_null()
    )
    df = df.sort("time")

    out: list[dict[str, Any]] = []
    for row in df.iter_rows(named=True):
        entry: dict[str, Any] = {
            "traceId": row["trace_id"],
            "spanId": row["span_id"],
            "service": row["service"],
            "operationName": row["span_name"] if row["span_name"] else "",
            "startTime": row["time"],
            "duration": row["duration"],
            "status": status_code_to_status(row["status_code"]),
        }
        if row["parent_span_id"]:
            entry["parentSpanId"] = row["parent_span_id"]
        out.append(entry)
    return out


def read_logs(normal_path: Path, abnormal_path: Path) -> list[dict[str, Any]]:
    """Read normal + abnormal logs and normalise to the loader's schema."""
    frames: list[pl.DataFrame] = []
    for path in (normal_path, abnormal_path):
        if not path.exists():
            continue
        frames.append(
            pl.read_parquet(path, columns=["Timestamp", "SeverityText", "ServiceName", "Body"])
        )
    if not frames:
        return []

    df = pl.concat(frames)
    df = df.rename(
        {
            "Timestamp": "time",
            "SeverityText": "level",
            "ServiceName": "service",
            "Body": "message",
        }
    )
    df = df.with_columns(
        _epoch_ms(df, "time").alias("time"),
        pl.col("level").str.to_uppercase().fill_null(""),
    )
    # The platform filters ts-ui-dashboard logs out of the dataset.
    df = df.filter(pl.col("service") != "ts-ui-dashboard")
    df = df.filter(pl.col("service").is_not_null() & pl.col("message").is_not_null())
    df = df.sort("time")

    out: list[dict[str, Any]] = []
    for row in df.iter_rows(named=True):
        out.append(
            {
                "timestamp": row["time"],
                "service": row["service"],
                "level": row["level"] or "INFO",
                "message": row["message"],
            }
        )
    return out


# ── Datapack converter ───────────────────────────────────────────────────


def convert_datapack(src_dir: Path, dst_dir: Path) -> Path:
    """Convert a single datapack directory into ``<dst_dir>/case.json``."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    out_path = dst_dir / "case.json"

    injection = json.loads((src_dir / "injection.json").read_text("utf-8"))
    env = json.loads((src_dir / "env.json").read_text("utf-8"))

    fault_type = FAULT_TYPES[int(injection["fault_type"])]
    display_config = injection.get("display_config", {})
    if isinstance(display_config, str):
        display_config = json.loads(display_config)

    ground_truth = resolve_ground_truth_services(fault_type, display_config, src_dir.name)
    inject_time_ms = compute_inject_time_ms(env)

    case: dict[str, Any] = {
        "datapack": src_dir.name,
        "faultType": fault_type,
        "groundTruthServices": ground_truth,
        "injectTimeMs": inject_time_ms,
        "metrics": read_metrics(
            src_dir / "normal_metrics.parquet", src_dir / "abnormal_metrics.parquet"
        ),
    }

    traces = read_traces(src_dir / "normal_traces.parquet", src_dir / "abnormal_traces.parquet")
    if traces:
        case["traces"] = traces

    logs = read_logs(src_dir / "normal_logs.parquet", src_dir / "abnormal_logs.parquet")
    if logs:
        case["logs"] = logs

    out_path.write_text(json.dumps(case, separators=(",", ":")), "utf-8")
    return out_path


def _discover_datapacks(data_dir: Path) -> list[Path]:
    """Return the sorted datapack directories under `data_dir`."""
    datapacks = [
        p for p in data_dir.iterdir() if p.is_dir() and (p / "injection.json").exists()
    ]
    datapacks.sort(key=lambda p: p.name)
    return datapacks


# ── CLI ──────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Convert FSE'26 RCABench Parquet datapacks into normalised JSON."
    )
    parser.add_argument("--data-dir", required=True, help="Extracted rcabench tar root.")
    parser.add_argument("--out-dir", required=True, help="Output JSON root.")
    parser.add_argument("--limit", type=int, default=0, help="Only convert the first N datapacks.")
    parser.add_argument(
        "--include", default="", help="Comma-separated datapack names to convert (overrides limit)."
    )
    parser.add_argument("--force", action="store_true", help="Re-convert already-converted datapacks.")
    args = parser.parse_args(argv)

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)
    if not data_dir.exists():
        print(f"ERROR: data directory not found: {data_dir}", file=sys.stderr)
        return 1

    datapacks = _discover_datapacks(data_dir)
    if args.include:
        wanted = {name for name in args.include.split(",") if name}
        datapacks = [p for p in datapacks if p.name in wanted]
    elif args.limit:
        datapacks = datapacks[: args.limit]

    total = len(datapacks)
    print(f"Converting {total} datapacks from {data_dir} to {out_dir}", flush=True)

    ok = 0
    failed = 0
    for index, datapack in enumerate(datapacks, start=1):
        dst_dir = out_dir / datapack.name
        case_path = dst_dir / "case.json"
        if case_path.exists() and not args.force:
            print(f"[{index}/{total}] SKIP {datapack.name} (already converted)", flush=True)
            ok += 1
            continue
        try:
            convert_datapack(datapack, dst_dir)
            ok += 1
            print(f"[{index}/{total}] OK   {datapack.name}", flush=True)
        except Exception as exc:  # noqa: BLE001 - report per-datapack failures and continue
            failed += 1
            print(f"[{index}/{total}] FAIL {datapack.name}: {exc}", file=sys.stderr, flush=True)

    print(f"Done: {ok} converted/skipped, {failed} failed", flush=True)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
