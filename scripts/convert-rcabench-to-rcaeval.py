#!/usr/bin/env python3
"""
Convert RCABench datapacks into the RCAEval case layout.

Input:  a directory of RCABench datapacks, one per fault injection
        (`ts2-ts-order-service-stress-b7twdg/` → `{normal,abnormal}_metrics.parquet`,
        `{normal,abnormal}_{logs,traces}.parquet`, `env.json`, `injection.json`).
Output: case directories the RCAEval loader reads unchanged — `metrics.json`,
        `logs.csv`, `traces.csv`, `inject_time.txt`, `ground_truth.json`.

This is a DATA PREPARATION tool, not part of the engine. Its purpose is that a corpus
published in RCABench's layout can be scored by the SAME runner, through the SAME
loader, as the nine RCAEval cells: one code path, no second harness.

The mapping is a set of DECISIONS. Each one changes what the engine can see, so each
one is stated here rather than left to the reader of the output.

  metrics   Only the families the engine has channels for are carried, and each is
            renamed to the family name the RCAEval packs use. Everything else (k8s
            platform gauges, filesystem capacity, jvm counters) is DROPPED rather than
            renamed: a renamed gauge the engine has no estimator for would sit in the
            case looking like evidence and scoring nothing.

              hubble_http_request_duration_p50_seconds → latency-50
              hubble_http_request_duration_p90_seconds → latency-90
              hubble_http_request_duration_p95_seconds → latency-95
              hubble_http_request_duration_p99_seconds → latency-99
              container.cpu.usage                      → cpu
              container.memory.working_set             → mem
              queueSize                                → queue-size

            The hubble rows are EDGE measurements: `service_name` is the caller and
            `attr.destination_workload` the callee. A per-service series is built by
            taking, per timestamp, the MAXIMUM over callers INTO that service — the
            service's worst observed inbound latency, which is the quantity a
            server-side p90 in the RCAEval packs measures.

  traces    Carried whole, INCLUDING `attr.status_code`. That column is the channel
            the RCAEval RE3 TrainTicket packs do not carry (189,488 spans, no status),
            and it is what makes a failed edge observable at all.

  logs      Carried whole with the parquet's own level column.

  clock     Unix SECONDS for metrics and logs, Unix MILLISECONDS in a column named
            `startTimeMillis` for traces. The name is not cosmetic: the loader reads
            `startTimeMillis` verbatim and treats a bare name it does not know as "no
            clock", which is how the first conversion of this corpus produced 60 cases
            in which every span sat at t=0 (see docs/rcabench-first-reading.md §4).

  duration  RCABench durations are NANOSECONDS; RCAEval's are Jaeger MICROseconds.
            Divided by 1000 here.

  injection `ABNORMAL_START` from `env.json`, in epoch seconds.

  ground    RCABench's ground truth is a SET — for a network fault it is the edge's two
            endpoints — so `ground_truth.json` records the set, the injection point and
            the fault, and leaves the scoring policy to the caller. `root_cause_service`
            is the injection point's SOURCE, which is the entity the fault was applied
            to; `rcabench_fault` keeps the full fault name, because the case directory
            name carries a short code (the loader's pack regex admits only `[a-z0-9]+`
            there, and the results table prints one column per fault).

Usage:
  python3 scripts/convert-rcabench-to-rcaeval.py \\
      --src ~/RCABench-raw --dst ~/RCABench-conv [--stride 7] [--limit 60]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

METRIC_MAP = {
    "hubble_http_request_duration_p50_seconds": "latency-50",
    "hubble_http_request_duration_p90_seconds": "latency-90",
    "hubble_http_request_duration_p95_seconds": "latency-95",
    "hubble_http_request_duration_p99_seconds": "latency-99",
    "container.cpu.usage": "cpu",
    "container.memory.working_set": "mem",
    "queueSize": "queue-size",
}

HUBBLE_PREFIX = "hubble_"

# The case directory name has to satisfy the loader's pack regex
# `re{1-3}{ob|ss|tt}_<service>_<fault>_<instance>`, where the fault token is
# `[a-z0-9]+`, and the results table prints one column per fault token. Both
# constraints are met by a short code; the full RCABench fault name is kept in
# `ground_truth.json` as `rcabench_fault`.
FAULT_CODES = {
    "response-replace-code": "rrc",
    "response-replace-body": "rrb",
    "response-patch-body": "rpb",
    "request-replace-method": "rrm",
    "request-replace-path": "rrp",
    "response-delay": "rd",
    "request-delay": "rq",
    "response-abort": "rsa",
    "request-abort": "ra",
    "stress": "st",
    "container-kill": "ck",
    "pod-kill": "pk",
    "pod-failure": "pf",
    "corrupt": "co",
    "partition": "pa",
    "bandwidth": "bw",
    "loss": "lo",
    "delay": "dly",
    "exception": "ex",
    "return": "rt",
}

SERVICE_STOPWORDS = {"mysql", "rabbitmq", "redis", "dashboard", "exporter", "loadgenerator"}


def epoch_seconds(values) -> np.ndarray:
    """Parquet timestamps → epoch seconds (int64)."""
    return values.astype("datetime64[s]").astype("int64").to_numpy()


def read_metrics(pack: Path, window: str) -> dict[str, dict[str, list[tuple[int, float]]]]:
    """The families {@link METRIC_MAP} keeps, per entity and family, for one window."""
    path = pack / f"{window}_metrics.parquet"
    if not path.exists():
        return {}
    table = pq.read_table(path).to_pandas()
    # Guard BEFORE the filter, not after it. A window file that exists and carries no rows has no
    # `metric` column at all, and `table["metric"]` on a columnless frame raises KeyError -- so the
    # emptiness check placed below the filter never runs. A pack that recorded its windows as empty
    # is not an error; it is a pack with nothing to convert.
    if table.empty or "metric" not in table.columns:
        return {}
    table = table[table["metric"].isin(METRIC_MAP)]
    if table.empty:
        return {}
    table = table.assign(family=table["metric"].map(METRIC_MAP))
    hubble = table["metric"].str.startswith(HUBBLE_PREFIX)
    table.loc[hubble, "entity"] = table.loc[hubble, "attr.destination_workload"]
    table.loc[~hubble, "entity"] = table.loc[~hubble, "service_name"]
    table = table[table["entity"].notna() & (table["entity"] != "")]
    # NaN is NOT JSON. A missing observation arrives as NaN, and `metrics.json` carrying
    # the literal `NaN` is rejected by every strict parser including the loader's — so a
    # pack could be written and then fail to load, which is what the first conversion
    # did on 5 of 5 sampled cases. Dropped here, at the boundary.
    table = table[np.isfinite(table["value"].astype(float))]
    table = table.assign(ts=epoch_seconds(table["time"].dt.tz_localize(None)))
    grouped = table.groupby(["entity", "family", "ts"], sort=True)["value"].max()
    out: dict[str, dict[str, list[tuple[int, float]]]] = {}
    for (entity, family, ts), value in grouped.items():
        out.setdefault(entity, {}).setdefault(family, []).append((int(ts), float(value)))
    return out


def merge_windows(pack: Path) -> dict[str, list[dict]]:
    """Both windows as one `metrics.json` body, as the RCAEval packs carry it."""
    merged: dict[str, dict[str, list[tuple[int, float]]]] = {}
    for window in ("normal", "abnormal"):
        for entity, families in read_metrics(pack, window).items():
            for family, points in families.items():
                merged.setdefault(entity, {}).setdefault(family, []).extend(points)
    rows: dict[str, list[dict]] = {}
    for entity, families in merged.items():
        out = []
        for family, points in families.items():
            for ts, value in sorted(points):
                out.append({"timestamp": ts, "value": value, "metric_name": family})
        rows[entity] = out
    return rows


def write_traces(pack: Path, dest: Path) -> int:
    """Both windows as `traces.csv`, in the column names the loader reads."""
    import pandas as pd

    frames = []
    for window in ("normal", "abnormal"):
        path = pack / f"{window}_traces.parquet"
        if path.exists():
            frames.append(pq.read_table(path).to_pandas())
    if not frames:
        return 0
    table = pd.concat(frames, ignore_index=True)
    if table.empty:
        return 0
    # `startTimeMillis` is read VERBATIM by the loader; a bare name it does not know
    # (`ts`) is read by no branch and leaves every span at start time 0.
    table = table.assign(
        startTimeMillis=(epoch_seconds(table["time"].dt.tz_localize(None)) * 1000).astype("int64")
    )
    # RCABench durations are NANOSECONDS (a plausible gRPC span reads 88,089,622);
    # RCAEval's are Jaeger MICROseconds. Without the /1000 every duration is 1000x too
    # large, which no per-service median can absorb.
    table["duration"] = table["duration"].astype("int64") // 1000
    table["status"] = table["attr.status_code"].fillna("Unset")
    table["operation"] = table["span_name"].fillna("unknown")
    table = table.rename(columns={"service_name": "service"})
    cols = [
        "startTimeMillis",
        "trace_id",
        "span_id",
        "parent_span_id",
        "service",
        "operation",
        "duration",
        "status",
    ]
    table[cols].to_csv(dest / "traces.csv", index=False)
    return len(table)


def write_logs(pack: Path, dest: Path) -> int:
    """Both windows as `logs.csv`, in the column names the loader reads."""
    import pandas as pd

    frames = []
    for window in ("normal", "abnormal"):
        path = pack / f"{window}_logs.parquet"
        if path.exists():
            frames.append(pq.read_table(path).to_pandas())
    if not frames:
        return 0
    table = pd.concat(frames, ignore_index=True)
    if table.empty:
        return 0
    table = table.assign(ts=epoch_seconds(table["time"].dt.tz_localize(None)))
    table = table.rename(columns={"service_name": "service"})
    table[["ts", "service", "level", "message"]].to_csv(dest / "logs.csv", index=False)
    return len(table)


def parse_name(name: str) -> tuple[str, str, str]:
    """`ts2-ts-order-service-stress-b7twdg` → (namespace, target, fault).

    The split is at the SERVICE boundary, not at a fixed token count: a datapack name is
    `<namespace>-<target>-<fault>-<random>`, and both the target and the fault may
    contain hyphens (`ts-order-service`, `response-replace-code`), so neither can be
    recovered by counting tokens from either end.
    """
    parts = name.split("-")
    namespace = parts[0]
    body = "-".join(parts[1:-1])
    toks = body.split("-")
    cut = None
    for i, tok in enumerate(toks):
        if tok.endswith("service") or tok in SERVICE_STOPWORDS:
            cut = i
            break
    if cut is None:
        # No service boundary in the name. The three parts must still be disjoint, so the fault is
        # everything after the first token rather than the whole body -- otherwise the target is
        # repeated inside the fault and a caller comparing the two sees a name that matches itself.
        return namespace, toks[0], "-".join(toks[1:])
    return namespace, "-".join(toks[: cut + 1]), "-".join(toks[cut + 1 :])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Directory of RCABench datapacks")
    ap.add_argument("--dst", required=True, help="Directory to write RCAEval-layout cases to")
    ap.add_argument("--stride", type=int, default=1, help="Keep every Nth pack (sampling)")
    ap.add_argument("--limit", type=int, default=0, help="Stop after this many packs (0 = all)")
    ap.add_argument("--case-prefix", default="re3tt", help="Case directory prefix")
    args = ap.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    # A mistyped `--src` used to surface as a traceback from `iterdir()`, which reads like a bug in
    # the converter rather than a bad argument -- and on a conversion that takes tens of minutes a
    # reader cannot tell the two apart. Named, and non-zero.
    if not src.is_dir():
        print(f"--src {src} is not a directory", file=sys.stderr)
        return 2
    packs = sorted(p for p in src.iterdir() if p.is_dir() and (p / ".finished").exists())
    chosen = packs[:: args.stride]
    if args.limit:
        chosen = chosen[: args.limit]
    dst.mkdir(parents=True, exist_ok=True)

    written = 0
    for index, pack in enumerate(chosen, start=1):
        namespace, target, fault = parse_name(pack.name)
        injection = json.loads((pack / "injection.json").read_text())
        env = json.loads((pack / "env.json").read_text())
        gt = injection.get("ground_truth") or {}
        services = [s for s in (gt.get("service") or []) if s]
        try:
            display = json.loads(injection.get("display_config") or "{}")
        except json.JSONDecodeError:
            display = {}
        point = display.get("injection_point") or {}
        primary = point.get("source_service") or point.get("app_name") or target

        metrics = merge_windows(pack)
        if not metrics:
            # Checked BEFORE the directory exists: this used to `mkdir` first and then skip, which
            # left a case directory holding every artefact except `metrics.json` -- a stray the
            # runner's discovery walks past and a reader counts.
            continue
        fault_code = FAULT_CODES.get(fault, "".join(w[0] for w in fault.split("-")))
        case_dir = dst / f"{args.case_prefix}_{primary}_{fault_code}_{index}"
        case_dir.mkdir(parents=True, exist_ok=True)
        (case_dir / "metrics.json").write_text(json.dumps(metrics))
        (case_dir / "inject_time.txt").write_text(env["ABNORMAL_START"])
        (case_dir / "ground_truth.json").write_text(
            json.dumps(
                {
                    "root_cause_service": primary,
                    "root_cause_metric": fault_code,
                    "rcabench_fault": fault,
                    "rcabench_ground_truth": services,
                    "rcabench_injection_point": point,
                    "rcabench_namespace": namespace,
                    "rcabench_pack": pack.name,
                }
            )
        )
        spans = write_traces(pack, case_dir)
        lines = write_logs(pack, case_dir)
        written += 1
        if index % 25 == 0:
            print(f"[{index}/{len(chosen)}] {pack.name} spans={spans} logs={lines}", flush=True)
    print(f"converted {written} packs -> {dst}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
