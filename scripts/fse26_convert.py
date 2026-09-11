#!/usr/bin/env python3
"""
Convert FSE'26 RCABench datapacks (Parquet) into normalised JSON.

RCABench (arXiv:2510.04711) publishes 1,430 fault-propagation-aware RCA cases
collected on Train Ticket. The `rcabench-absolute_anomaly.tar.gz` artifact
(13.4 GB) contains one directory per datapack with `normal_*.parquet` /
`abnormal_*.parquet` observability slices plus `injection.json` and `env.json`.
This bridge reads those Parquet files and emits a single `case.json` per
datapack.

The archive's Parquet is ALREADY the platform's normalised view — i.e. the
output of the platform's own `convert_metrics` / `convert_traces` /
`convert_logs` (see its `v2/sources/rcabench.py`), NOT the raw OpenTelemetry
export. Columns are therefore `time` (Datetime), `metric` / `value` /
`service_name`, `trace_id` / `span_id` / `parent_span_id` / `service_name`, and
`level` / `message` — the bridge reads those names directly and only performs
unit normalisation (Datetime → epoch-ms, nanoseconds → milliseconds), so the
TypeScript `FSE26Loader` consumes the exact same normalised view the
benchmark's evaluator uses.

Trace spans are NOT serialised in full: a single datapack can contain millions
of spans (~86 MB as raw JSON), but the engine only consumes the call-graph
edges they imply. The bridge therefore resolves each span's parent service via
a polars self-join and emits the DISTINCT caller → callee edges as `traceEdges`
instead, shrinking the trace component by ~3 orders of magnitude. Metric time
series remain the dominant per-case size (~34 MB/case measured on a 500 MB
prefix subset), so `case.json` is far smaller than the span list but still
substantial.

Output `case.json` schema (per datapack):

    {
      "datapack": "ts5-ts-order-service-stress-svfvxk",
      "faultType": "CPUStress",
      "faultCategory": "Resource",
      "groundTruthServices": ["ts-order-service"],
      "injectTimeMs": 1757000000000,
      "metrics": {
        "ts-order-service": [
          {"metric": "container.cpu.usage", "start": 1756998000000, "step": 5000, "values": [0.1, 0.2]},
          {"metric": "jvm.gc.duration.max", "start": 1756998000000, "step": 5000, "values": [12.0]},
          {"metric": "http.server.request.duration", "start": 1756998000000, "step": 10000, "values": [8.5]},
          {"metric": "http.response.error_rate", "start": 1756998000000, "step": 10000, "values": [0.0]}
        ]
      },
      "traceEdges": [
        ["ts-ui-dashboard", "ts-order-service"]
      ],
      "logs": [
        {"timestamp": 1756998000000, "service": "...", "level": "ERROR", "message": "..."}
      ]
    }

All timestamps are Unix milliseconds and log levels are upper-cased.

The metric map merges four sources (each optional): the gauge metrics
(`normal_metrics.parquet`), the summary metrics (`normal_metrics_sum.parquet`,
same normalised schema), the histogram metrics (`normal_metrics_histogram.parquet`,
emitting `{metric}.max` for `jvm.gc.duration` / `jvm.memory.used`), and the
trace-derived golden signals (`http.server.request.duration` mean latency and
`http.response.error_rate`, bucketed into 10-second windows). These are the
signals the platform's own reference analyzer consumes; without them the engine
cannot see a JVM fault's GC/heap signature nor a replace-code source's error-rate
spike.

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
import gzip
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

# Fault type → benchmark category, ported verbatim from the platform's
# `v2/analysis/aggregation.py:FAULT_TYPE_MAPPING`. The 31 fault types collapse
# into 7 categories used for release-asset sharding: Pod / Resource / HTTP /
# DNS / Time / Network / JVM.
FAULT_CATEGORY: dict[str, str] = {
    "PodKill": "Pod",
    "PodFailure": "Pod",
    "ContainerKill": "Pod",
    "MemoryStress": "Resource",
    "CPUStress": "Resource",
    "JVMCPUStress": "Resource",
    "JVMMemoryStress": "Resource",
    "HTTPRequestAbort": "HTTP",
    "HTTPResponseAbort": "HTTP",
    "HTTPRequestDelay": "HTTP",
    "HTTPResponseDelay": "HTTP",
    "HTTPResponseReplaceBody": "HTTP",
    "HTTPResponsePatchBody": "HTTP",
    "HTTPRequestReplacePath": "HTTP",
    "HTTPRequestReplaceMethod": "HTTP",
    "HTTPResponseReplaceCode": "HTTP",
    "DNSError": "DNS",
    "DNSRandom": "DNS",
    "TimeSkew": "Time",
    "NetworkDelay": "Network",
    "NetworkLoss": "Network",
    "NetworkDuplicate": "Network",
    "NetworkCorrupt": "Network",
    "NetworkBandwidth": "Network",
    "NetworkPartition": "Network",
    "JVMLatency": "JVM",
    "JVMReturn": "JVM",
    "JVMException": "JVM",
    "JVMGarbageCollector": "JVM",
    "JVMMySQLLatency": "JVM",
    "JVMMySQLException": "JVM",
}

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


def fault_category(fault_type: str) -> str:
    """
    Return the benchmark category for a fault type.

    The 31 fault types collapse into 7 categories (Pod / Resource / HTTP / DNS
    / Time / Network / JVM) used to shard the converted output into release
    assets. Raises on an unknown fault type (the mapping is total over
    :data:`FAULT_TYPES`).
    """
    category = FAULT_CATEGORY.get(fault_type)
    if category is None:
        raise ValueError(f"Unknown fault type: `{fault_type}`")
    return category


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


def compact_metric_series(timestamps: list[int], values: list[float]) -> dict[str, Any]:
    """
    Compact a metric series to ``{start, step, values}`` when uniformly sampled.

    Prometheus-style scrapes produce a constant timestamp delta, so storing the
    start + step instead of the full timestamp list roughly halves the serialised
    size. Irregular series (fewer than two samples or a non-constant delta) fall
    back to the explicit ``timestamps`` list.
    """
    if len(timestamps) >= 2:
        step = timestamps[1] - timestamps[0]
        if all(timestamps[i] - timestamps[i - 1] == step for i in range(2, len(timestamps))):
            return {"start": timestamps[0], "step": step, "values": values}
    return {"timestamps": timestamps, "values": values}


def format_bytes(num_bytes: float) -> str:
    """Format a non-negative byte count as a compact human-readable string."""
    if num_bytes < 0:
        raise ValueError(f"Negative byte count: {num_bytes}")
    value = float(num_bytes)
    unit = "B"
    for candidate in ("KB", "MB", "GB", "TB", "PB"):
        if value < 1024.0:
            break
        value /= 1024.0
        unit = candidate
    return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"


def summarize_sizes(sizes: list[int]) -> str:
    """
    Return a one-line aggregate of per-case output sizes.

    Both converter drivers report total / average / min / max case volume so a
    subset run can measure real per-case bytes before choosing fault-category
    shard sizes for the `rcabench-data` release assets.
    """
    if not sizes:
        return "Size: 0 cases"
    total = sum(sizes)
    avg = total / len(sizes)
    return (
        f"Size: {len(sizes)} cases, {format_bytes(total)} total, "
        f"avg {format_bytes(avg)}/case, "
        f"min {format_bytes(min(sizes))}, max {format_bytes(max(sizes))}"
    )


def _json_bytes(obj: Any) -> int:
    """Return the compact-JSON byte size of an object."""
    return len(json.dumps(obj, separators=(",", ":"), allow_nan=False))


def measure_case(case: dict[str, Any]) -> dict[str, Any]:
    """
    Return a byte-level size breakdown of a case document.

    Reports the total compact-JSON size, the gzip-compressed size (level 5), and
    the per-section split (metrics / logs / traceEdges / header), plus metric-
    series statistics (series count, uniformly-sampled count, sample count, and
    the timestamp vs value byte budgets). A subset run can therefore identify
    the dominant component before choosing a compression + sharding scheme for
    the `rcabench-data` release assets.
    """
    metrics = case.get("metrics") or {}
    logs = case.get("logs") or []
    edges = case.get("traceEdges") or []
    meta = {k: v for k, v in case.items() if k not in ("metrics", "logs", "traceEdges")}

    n_series = 0
    n_uniform = 0
    n_samples = 0
    ts_bytes = 0
    val_bytes = 0
    for series_list in metrics.values():
        for s in series_list:
            n_series += 1
            if "start" in s:
                n_uniform += 1
            values = s["values"]
            n_samples += len(values)
            val_bytes += _json_bytes(values)
            if "timestamps" in s:
                ts_bytes += _json_bytes(s["timestamps"])
            else:
                ts_bytes += _json_bytes([s["start"], s["step"]])

    total = _json_bytes(case)
    gzip_bytes = len(
        gzip.compress(
            json.dumps(case, separators=(",", ":"), allow_nan=False).encode("utf-8"),
            compresslevel=5,
        )
    )

    return {
        "total": total,
        "gzip": gzip_bytes,
        "metrics": _json_bytes(metrics) if metrics else 0,
        "logs": _json_bytes(logs) if logs else 0,
        "edges": _json_bytes(edges) if edges else 0,
        "meta": _json_bytes(meta),
        "series": n_series,
        "uniform": n_uniform,
        "samples": n_samples,
        "ts_bytes": ts_bytes,
        "val_bytes": val_bytes,
    }


def summarize_measurements(rows: list[dict[str, Any]]) -> str:
    """
    Aggregate per-case :func:`measure_case` results into a readable summary.

    Emits the total + gzip ratio, the per-section split, and the metric-series
    statistics, so a subset run reveals exactly which component dominates the
    serialised size (and therefore which compression lever is worth pursuing).
    """
    if not rows:
        return "Breakdown: 0 cases"
    total = sum(r["total"] for r in rows)
    gzip_bytes = sum(r["gzip"] for r in rows)
    metrics = sum(r["metrics"] for r in rows)
    logs = sum(r["logs"] for r in rows)
    edges = sum(r["edges"] for r in rows)
    meta = sum(r["meta"] for r in rows)
    series = sum(r["series"] for r in rows)
    uniform = sum(r["uniform"] for r in rows)
    samples = sum(r["samples"] for r in rows)
    ts_bytes = sum(r["ts_bytes"] for r in rows)
    val_bytes = sum(r["val_bytes"] for r in rows)
    ratio = (total / gzip_bytes) if gzip_bytes else 0.0
    return "\n".join(
        [
            f"Breakdown ({len(rows)} cases): total {format_bytes(total)}, "
            f"gzip {format_bytes(gzip_bytes)} ({ratio:.1f}x)",
            f"  metrics {format_bytes(metrics)}, logs {format_bytes(logs)}, "
            f"edges {format_bytes(edges)}, meta {format_bytes(meta)}",
            f"  metric series {series} ({uniform} uniform), samples {samples}",
            f"  metric timestamps {format_bytes(ts_bytes)}, values {format_bytes(val_bytes)}",
        ]
    )


# ── Parquet readers (polars) ─────────────────────────────────────────────


def _epoch_ms(df: pl.DataFrame, col: str) -> pl.Expr:
    """
    Return an expression converting a time column to Unix milliseconds.

    Accepts either a polars Datetime column (the common OTel-export case, where
    `Timestamp`/`TimeUnix` carry a TIMESTAMP logical type) or a raw integer
    epoch column (OTel's `TimeUnixNano` convention). Integer epochs are unit-
    inferred from their magnitude — `>= 1e17` → nanoseconds, `>= 1e14` →
    microseconds, `>= 1e11` → milliseconds, otherwise seconds — so the bridge
    is robust to either serialisation without silently mis-scaling.
    """
    dtype = df[col].dtype
    if isinstance(dtype, pl.Datetime):
        return pl.col(col).dt.epoch("ms")
    if dtype.is_integer():
        first = df[col].drop_nulls().head(1)
        if first.is_empty():
            return pl.col(col).cast(pl.Int64)
        magnitude = abs(int(first.item()))
        if magnitude >= 10**17:
            return pl.col(col).cast(pl.Int64) // 10**6  # ns -> ms
        if magnitude >= 10**14:
            return pl.col(col).cast(pl.Int64) // 10**3  # us -> ms
        if magnitude >= 10**11:
            return pl.col(col).cast(pl.Int64)  # already ms
        return pl.col(col).cast(pl.Int64) * 1000  # s -> ms
    raise TypeError(f"Expected Datetime or integer time column `{col}`, got {dtype}")


def read_metrics(normal_path: Path, abnormal_path: Path) -> dict[str, list[dict[str, Any]]]:
    """
    Read normal + abnormal metrics and group into per-service time series.

    The archive's Parquet is ALREADY the platform's normalised view (the output
    of its `convert_metrics`): columns `time` (Datetime), `metric`, `value`,
    `service_name`, plus `attr.*`. Returns ``{service: [series, ...]}`` where
    each uniformly sampled series is ``{"metric", "start", "step", "values"}``
    and each irregular series is ``{"metric", "timestamps", "values"}``, each
    sorted by ascending timestamp.

    A metric fans out into one row per label set sharing a timestamp, because
    the platform keeps the label dimensions as `attr.*` columns (hubble carries
    `source`/`destination` per network flow, k8s carries the pod attributes).
    The bridge models exactly one time series per ``(service, metric)``, so the
    rows are rolled up with a per-timestamp ``sum`` — the service-level
    aggregate over the label partitions. Concatenating them instead would
    interleave the distinct label series into a sawtooth and destroy the time
    axis (real data: ``[1, 4, 1, 4, …]``, ``[1, 149, 954, 954, 1, 149, …]``),
    fabricating a huge relative deviation on every service emitting the metric.

    The roll-up is scoped per source file: the normal (baseline) and abnormal
    (injection) windows are distinct samples even when a timestamp coincides,
    so they must never be summed together.
    """
    frames: list[pl.DataFrame] = []
    for source_index, path in enumerate((normal_path, abnormal_path)):
        if not path.exists():
            continue
        schema = pl.scan_parquet(path).collect_schema()
        if "service_name" not in schema:
            # Infra-level metrics (node/hubble) lack a service attribution and
            # cannot inform service-level RCA, so they are dropped.
            continue
        frame = pl.read_parquet(
            path, columns=["time", "metric", "value", "service_name"]
        ).with_columns(pl.lit(source_index, dtype=pl.Int8).alias("__source"))
        frames.append(frame)
    if not frames:
        return {}

    df = pl.concat(frames)
    df = df.rename({"service_name": "service"})
    df = df.with_columns(
        _epoch_ms(df, "time").alias("time"),
        pl.col("value").cast(pl.Float64),
    )
    df = df.filter(
        pl.col("time").is_not_null()
        & pl.col("metric").is_not_null()
        & pl.col("service").is_not_null()
        & pl.col("value").is_not_null()
        & pl.col("value").is_finite()
    )
    # Roll up the label fan-out into one sample per (service, metric, time).
    # `__source` stays in the group key (windows never merge) and in the sort
    # (deterministic order for coinciding timestamps), but drops out here.
    df = (
        df.group_by(["service", "metric", "__source", "time"])
        .agg(pl.col("value").sum())
        .sort(["service", "metric", "time", "__source"])
    )

    out: dict[str, list[dict[str, Any]]] = {}
    for (service,), service_df in df.group_by("service", maintain_order=False):
        series: list[dict[str, Any]] = []
        for (metric,), metric_df in service_df.group_by("metric", maintain_order=False):
            series.append(
                {
                    "metric": metric,
                    **compact_metric_series(
                        metric_df["time"].to_list(), metric_df["value"].to_list()
                    ),
                }
            )
        if series:
            out[service] = series
    return out


def read_metrics_histogram(
    normal_path: Path, abnormal_path: Path
) -> dict[str, list[dict[str, Any]]]:
    """
    Read normal + abnormal HISTOGRAM metrics and group into per-service series.

    The archive's histogram Parquet is the platform's ``convert_metrics_histogram``
    output: columns ``time`` (Datetime), ``metric``, ``service_name``, ``count``,
    ``sum``, ``min``, ``max`` (bucket arrays are already dropped), plus ``attr.*``.
    Histograms carry the JVM source signatures that the gauge reader
    (:func:`read_metrics`) cannot see — ``jvm.gc.duration`` (garbage-collection
    time) and ``jvm.memory.used`` (heap pressure). A GC-thrashing source shows a
    sharp ``max`` spike that its victims do not, so each histogram metric emits a
    single ``{metric}.max`` series (the peak per-scrape value).

    Service attribution is coalesced across two columns: hubble histogram metrics
    carry ``service_name`` directly, while k8s metrics (the JVM signatures) carry
    it in ``attr.k8s.service.name`` with a NULL ``service_name``. A single OTel
    histogram metric also fans out into one row per GC collector / memory pool
    per scrape (all sharing the same timestamp), so the peak is taken per
    ``(service, metric, time)`` to yield one clean, strictly-increasing series.
    """
    frames: list[pl.DataFrame] = []
    for path in (normal_path, abnormal_path):
        if not path.exists():
            continue
        schema = pl.scan_parquet(path).collect_schema()
        if "max" not in schema:
            continue
        has_service = "service_name" in schema
        has_k8s_service = "attr.k8s.service.name" in schema
        if not has_service and not has_k8s_service:
            continue
        columns = ["time", "metric", "max"]
        if has_service:
            columns.append("service_name")
        if has_k8s_service:
            columns.append("attr.k8s.service.name")
        frame = pl.read_parquet(path, columns=columns)
        if has_service and has_k8s_service:
            frame = frame.with_columns(
                pl.coalesce(
                    pl.col("service_name").cast(pl.String),
                    pl.col("attr.k8s.service.name").cast(pl.String),
                ).alias("service")
            )
        elif has_service:
            frame = frame.rename({"service_name": "service"})
        else:
            frame = frame.rename({"attr.k8s.service.name": "service"})
        frames.append(frame.select(["time", "metric", "service", "max"]))
    if not frames:
        return {}

    df = pl.concat(frames)
    df = df.rename({"max": "max_value"})
    df = df.with_columns(
        _epoch_ms(df, "time").alias("time"),
        pl.col("max_value").cast(pl.Float64),
        pl.col("service").cast(pl.String),
    )
    df = df.filter(
        pl.col("time").is_not_null()
        & pl.col("metric").is_not_null()
        & pl.col("service").is_not_null()
        & pl.col("max_value").is_not_null()
        & pl.col("max_value").is_finite()
    )
    # Collapse per-scrape fan-out (GC collector / memory pool rows sharing a
    # timestamp) to a single peak value, so each metric emits one clean series.
    df = (
        df.group_by(["service", "metric", "time"])
        .agg(pl.col("max_value").max())
        .sort(["service", "metric", "time"])
    )

    out: dict[str, list[dict[str, Any]]] = {}
    for (service,), service_df in df.group_by("service", maintain_order=False):
        series: list[dict[str, Any]] = []
        for (metric,), metric_df in service_df.group_by("metric", maintain_order=False):
            metric_df = metric_df.sort("time")
            series.append(
                {
                    "metric": f"{metric}.max",
                    **compact_metric_series(
                        metric_df["time"].to_list(), metric_df["max_value"].to_list()
                    ),
                }
            )
        if series:
            out[service] = series
    return out


def read_trace_derived_metrics(
    normal_path: Path, abnormal_path: Path, window_ms: int = 10_000
) -> dict[str, list[dict[str, Any]]]:
    """
    Derive per-service latency + error-rate series from trace spans.

    Mirrors the platform's ``_calculate_duration_metrics`` and
    ``_calculate_http_error_rate``: spans are bucketed into ``window_ms`` windows
    per service. Two series are emitted:

    * ``http.server.request.duration`` — mean span duration in milliseconds
      (``duration`` is always present, nanosecond precision).
    * ``http.response.error_rate`` — percentage of spans whose HTTP response
      status is >= 400 (only when ``attr.http.response.status_code`` is present).

    These are the app-level golden signals the gauge metrics cannot express: the
    replace-code source spikes ``error_rate`` (its responses are rewritten), while
    a memory / bandwidth / killed source spikes its own response duration. A
    single lazy aggregation pass is used, so the multi-million-span trace Parquet
    is never materialised in full.
    """
    paths = [p for p in (normal_path, abnormal_path) if p.exists()]
    if not paths:
        return {}

    # The HTTP status column is OPTIONAL and may differ between the normal and
    # abnormal trace files (one window can carry spans with the attribute while
    # the other does not). Read each file with a consistent schema, padding a
    # null status column when it is absent, so `pl.concat` never mismatches.
    any_status = False
    frames: list[pl.DataFrame] = []
    for path in paths:
        schema = pl.scan_parquet(path).collect_schema()
        has_status = "attr.http.response.status_code" in schema
        if has_status:
            any_status = True
        columns = ["time", "service_name", "duration"]
        if has_status:
            columns.append("attr.http.response.status_code")
        frame = pl.read_parquet(path, columns=columns)
        if has_status:
            frame = frame.with_columns(
                pl.col("attr.http.response.status_code").cast(pl.Int32)
            )
        else:
            frame = frame.with_columns(
                pl.lit(None, dtype=pl.Int32).alias("attr.http.response.status_code")
            )
        frames.append(frame)

    df = pl.concat(frames)
    df = df.rename({"service_name": "service"})
    df = df.with_columns(
        _epoch_ms(df, "time").alias("time"),
        pl.col("duration").cast(pl.Float64) / 1_000_000.0,  # ns -> ms
    )
    df = df.filter(
        pl.col("time").is_not_null()
        & pl.col("service").is_not_null()
        & pl.col("duration").is_not_null()
        & pl.col("duration").is_finite()
        & (pl.col("duration") > 0.0)
    )
    df = df.with_columns(((pl.col("time") // window_ms) * window_ms).alias("window"))

    out: dict[str, list[dict[str, Any]]] = {}

    # Latency: mean span duration per service per window.
    latency = (
        df.group_by(["service", "window"])
        .agg(pl.col("duration").mean().alias("mean_ms"))
        .sort("window")
    )
    for (service,), group in latency.group_by("service", maintain_order=False):
        out.setdefault(service, []).append(
            {
                "metric": "http.server.request.duration",
                **compact_metric_series(
                    group["window"].to_list(), group["mean_ms"].to_list()
                ),
            }
        )

    # Error rate: fraction of >= 400 HTTP statuses per service per window.
    if any_status:
        status_df = df.filter(pl.col("attr.http.response.status_code").is_not_null())
        if status_df.height > 0:
            error = (
                status_df.with_columns(
                    (pl.col("attr.http.response.status_code") >= 400).alias("is_error")
                )
                .group_by(["service", "window"])
                .agg(
                    [
                        pl.col("is_error").sum().alias("error_count"),
                        pl.col("is_error").count().alias("total_count"),
                    ]
                )
                .with_columns(
                    (
                        pl.col("error_count").cast(pl.Float64)
                        / pl.col("total_count")
                        * 100.0
                    ).alias("error_rate")
                )
                .sort("window")
            )
            for (service,), group in error.group_by("service", maintain_order=False):
                out.setdefault(service, []).append(
                    {
                        "metric": "http.response.error_rate",
                        **compact_metric_series(
                            group["window"].to_list(), group["error_rate"].to_list()
                        ),
                    }
                )

    return out


def merge_metric_maps(*maps: dict[str, list[dict[str, Any]]]) -> dict[str, list[dict[str, Any]]]:
    """
    Merge per-service metric maps, concatenating the series lists per service.

    Each argument maps a service to its metric series; the result preserves every
    series (duplicate metric names within a service are harmless — the engine
    scores each series independently and takes the max anomaly). Services absent
    from a map simply contribute no series.
    """
    out: dict[str, list[dict[str, Any]]] = {}
    for metric_map in maps:
        for service, series in metric_map.items():
            out.setdefault(service, []).extend(series)
    return out


def read_trace_edges(normal_path: Path, abnormal_path: Path) -> list[list[str]]:
    """
    Read normal + abnormal trace spans and emit DISTINCT caller → callee edges.

    The engine never consumes per-span details (start time, duration, status,
    operation name) — it only needs the call graph the spans imply. A datapack
    can hold millions of spans (~86 MB serialised), so this reader resolves each
    span's parent service via a polars self-join and returns the distinct
    ``[parent_service, service]`` edges instead of the span list.

    Root spans (empty/null `parent_span_id`) and spans whose parent id cannot be
    resolved (e.g. the parent was filtered out) contribute no edge; self-calls
    (same service on both ends) are dropped, matching the platform's evaluator.
    """
    frames: list[pl.DataFrame] = []
    for path in (normal_path, abnormal_path):
        if not path.exists():
            continue
        frames.append(
            pl.read_parquet(
                path,
                columns=["trace_id", "span_id", "parent_span_id", "service_name"],
            )
        )
    if not frames:
        return []

    df = pl.concat(frames)
    df = df.rename({"service_name": "service"})
    df = df.filter(
        pl.col("service").is_not_null()
        & pl.col("span_id").is_not_null()
        & pl.col("trace_id").is_not_null()
    )

    # Map each span id to its service, then join on parent_span_id to resolve
    # the caller service. Root spans (empty parent id) never match.
    parents = df.select(
        pl.col("span_id").alias("parent_span_id"),
        pl.col("service").alias("parent_service"),
    )
    joined = df.join(parents, on="parent_span_id", how="inner")

    edges_df = joined.filter(pl.col("parent_service") != pl.col("service"))
    edges_df = edges_df.select(["parent_service", "service"]).unique()

    return [
        [row["parent_service"], row["service"]] for row in edges_df.iter_rows(named=True)
    ]


def read_logs(normal_path: Path, abnormal_path: Path) -> list[dict[str, Any]]:
    """
    Read normal + abnormal logs and normalise to the loader's schema.

    The archive's Parquet is ALREADY the platform's normalised view (the output
    of its `convert_logs`): `time` (Datetime), `service_name`, `level`
    (already upper-cased), `message`.
    """
    frames: list[pl.DataFrame] = []
    for path in (normal_path, abnormal_path):
        if not path.exists():
            continue
        frames.append(
            pl.read_parquet(path, columns=["time", "service_name", "level", "message"])
        )
    if not frames:
        return []

    df = pl.concat(frames)
    df = df.rename({"service_name": "service"})
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


def build_case(src_dir: Path) -> dict[str, Any]:
    """Build the normalised case document for a datapack (no disk write)."""
    injection = json.loads((src_dir / "injection.json").read_text("utf-8"))
    env = json.loads((src_dir / "env.json").read_text("utf-8"))

    fault_type = FAULT_TYPES[int(injection["fault_type"])]
    display_config = injection.get("display_config", {})
    if isinstance(display_config, str):
        display_config = json.loads(display_config)

    ground_truth = resolve_ground_truth_services(fault_type, display_config, src_dir.name)
    inject_time_ms = compute_inject_time_ms(env)

    # Merge every observability source into one per-service metric map: the gauge
    # metrics, the summary metrics (same normalised schema), the histogram metrics
    # (jvm.gc.duration / jvm.memory.used peaks), and the trace-derived golden
    # signals (latency + error rate). Each source is optional — a missing file or
    # a schema without the expected column contributes nothing — so the bridge
    # stays robust to per-datapack telemetry differences.
    metrics = merge_metric_maps(
        read_metrics(
            src_dir / "normal_metrics.parquet", src_dir / "abnormal_metrics.parquet"
        ),
        read_metrics(
            src_dir / "normal_metrics_sum.parquet", src_dir / "abnormal_metrics_sum.parquet"
        ),
        read_metrics_histogram(
            src_dir / "normal_metrics_histogram.parquet",
            src_dir / "abnormal_metrics_histogram.parquet",
        ),
        read_trace_derived_metrics(
            src_dir / "normal_traces.parquet", src_dir / "abnormal_traces.parquet"
        ),
    )

    case: dict[str, Any] = {
        "datapack": src_dir.name,
        "faultType": fault_type,
        "faultCategory": fault_category(fault_type),
        "groundTruthServices": ground_truth,
        "injectTimeMs": inject_time_ms,
        "metrics": metrics,
    }

    trace_edges = read_trace_edges(
        src_dir / "normal_traces.parquet", src_dir / "abnormal_traces.parquet"
    )
    if trace_edges:
        case["traceEdges"] = trace_edges

    logs = read_logs(src_dir / "normal_logs.parquet", src_dir / "abnormal_logs.parquet")
    if logs:
        case["logs"] = logs

    return case


def write_case(case: dict[str, Any], dst_dir: Path) -> Path:
    """
    Write `case` to ``<dst_dir>/case.json`` and return the output path.

    `allow_nan=False` guarantees the emitted document is strict JSON: a
    surviving NaN/Infinity (which JS `JSON.parse` rejects) raises here instead
    of producing an unparseable `case.json`.
    """
    dst_dir.mkdir(parents=True, exist_ok=True)
    out_path = dst_dir / "case.json"
    out_path.write_text(
        json.dumps(case, separators=(",", ":"), allow_nan=False), "utf-8"
    )
    return out_path


def convert_datapack(src_dir: Path, dst_dir: Path) -> Path:
    """Convert a single datapack directory into ``<dst_dir>/case.json``."""
    return write_case(build_case(src_dir), dst_dir)


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
    sizes: list[int] = []
    measurements: list[dict[str, Any]] = []
    for index, datapack in enumerate(datapacks, start=1):
        dst_dir = out_dir / datapack.name
        case_path = dst_dir / "case.json"
        if case_path.exists() and not args.force:
            size = case_path.stat().st_size
            sizes.append(size)
            measurements.append(measure_case(json.loads(case_path.read_text("utf-8"))))
            print(
                f"[{index}/{total}] SKIP {datapack.name} "
                f"({format_bytes(size)}, already converted)",
                flush=True,
            )
            ok += 1
            continue
        try:
            case = build_case(datapack)
            write_case(case, dst_dir)
            size = case_path.stat().st_size
            sizes.append(size)
            measurements.append(measure_case(case))
            ok += 1
            print(f"[{index}/{total}] OK   {datapack.name} ({format_bytes(size)})", flush=True)
        except Exception as exc:  # noqa: BLE001 - report per-datapack failures and continue
            failed += 1
            print(f"[{index}/{total}] FAIL {datapack.name}: {exc}", file=sys.stderr, flush=True)

    print(f"Done: {ok} converted/skipped, {failed} failed", flush=True)
    print(summarize_sizes(sizes), flush=True)
    print(summarize_measurements(measurements), flush=True)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
