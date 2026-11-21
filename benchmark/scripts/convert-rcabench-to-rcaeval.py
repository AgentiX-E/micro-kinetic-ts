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

            That is `--families core`, the default and the mode of every reading taken so
            far. `--families full` carries the `_sum` and `_metrics_histogram` sources as
            well, plus two signals derived from the spans; the reason is a census rather
            than a preference, and it is written above `FAMILY_MODES`.

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

  ground    RCABench's ground truth is a SET — for an edge-injected fault it is the edge's two
            endpoints, and 1,053 of the 1,422 packs declare two — so `ground_truth.json` records
            the set as `root_cause_services` (the plural of the field the RCAEval loader already
            reads) and its first member as `root_cause_service`. `rcabench_ground_truth` carries
            the same list as provenance. `rcabench_fault` keeps the full fault name, because the
            case directory name carries a short code (the loader's pack regex admits only
            `[a-z0-9]+` there, and the results table prints one column per fault).

Usage:
  python3 scripts/convert-rcabench-to-rcaeval.py \\
      --src ~/RCABench-raw --dst ~/RCABench-conv [--stride 7] [--limit 60] [--families core|full]
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


# ── The two family modes ────────────────────────────────────────────────────────────────
#
# `core` carries the seven families of {@link METRIC_MAP} and nothing else. That is the mode
# every reading taken so far used, and it is the default so no published number moves.
#
# The `_sum` and `_metrics_histogram` files were DROPPED from `core` on the reasoning that a
# gauge with no estimator would look like evidence and score nothing. A census of the archive
# says that reasoning was too broad: it also deleted the only two channels a JVM fault has.
#
#   jvm.gc.duration            `*_metrics_histogram`   40 of 40 sampled packs
#   jvm.memory.used            `*_metrics_sum`         40 of 40
#   hubble_http_request_duration_*  `*_metrics`        only 23 of 40 -- 17 of 40 packs had NO
#                                                    latency channel at all in `core` mode
#
# `full` carries the same three sources under the names the engine's keyword channels already
# read, plus two signals derived from the spans (a per-service error rate and a per-service
# latency, both in 10-second buckets). The derived pair is what gives a `response-replace-code`
# fault a signature at all: the archive carries no error-rate gauge -- `hubble_http_requests_total`
# is a counter -- while the spans carry `attr.status_code` on every pack sampled.
#
# The names follow the FSE'26 bridge (`scripts/fse26_convert.py`), which reads the SAME archive
# through a different loader: histogram families get a `.max` suffix, sums and gauges keep their
# own name. That is deliberate -- two readers of one archive should not invent two vocabularies.
FAMILY_MODES = ("core", "full")

# Histogram families collapse to one scalar per bucket: the archive's histogram row carries the
# bucket's max, which is the quantity `fse26_convert.py` emits as `{metric}.max`.
HIST_SUFFIX = ".max"

# Ten seconds. `fse26_convert.py` buckets the same derived signals at this width, and the whole
# archive's scrape interval is 5 s or 10 s, so a narrower bucket would carry single spans.
DERIVED_BUCKET_SECONDS = 10

DERIVED_ERROR_RATE = "http.response.error_rate"
DERIVED_LATENCY = "http.server.request.duration"


def is_error_status(value) -> bool:
    """Whether an OTEL status cell names a failure.

    Both spellings the archive uses are accepted (`Error`), and a numeric code is measured against
    400 rather than string-compared, because a pack that records `500` in this column is reporting the
    same event as one that records `Error`.
    """
    if value is None:
        return False
    text = str(value).strip()
    if not text:
        return False
    if text.isdigit():
        return int(text) >= 400
    return text.lower() in ("error", "fail", "failed", "failure")


def read_metrics(pack: Path, window: str, families: str = "core") -> dict[str, dict[str, list[tuple[int, float]]]]:
    """The carried families, per entity and family, for one window."""
    frames = []
    for source, mode in (("metrics", "core"), ("metrics_sum", "full"), ("metrics_histogram", "full")):
        if mode == "full" and families != "full":
            continue
        path = pack / f"{window}_{source}.parquet"
        if not path.exists():
            continue
        table = pq.read_table(path).to_pandas()
        # Guard BEFORE the filter, not after it. A window file that exists and carries no rows has no
        # `metric` column at all, and `table["metric"]` on a columnless frame raises KeyError -- so the
        # emptiness check placed below the filter never runs. A pack that recorded its windows as empty
        # is not an error; it is a pack with nothing to convert.
        if table.empty or "metric" not in table.columns:
            continue
        if families == "core":
            table = table[table["metric"].isin(METRIC_MAP)]
            if table.empty:
                continue
            table = table.assign(family=table["metric"].map(METRIC_MAP))
        else:
            # MAPPED FAMILIES KEEP THEIR MAPPED NAME. `container.cpu.usage` is still `cpu` and the hubble
            # p90 is still `latency-90`, exactly as in `core`, so the only difference between the two
            # modes is the families `full` ADDS. An arm that also renamed the families it shares would be
            # changing two things at once and could not price either.
            suffix = HIST_SUFFIX if source == "metrics_histogram" else ""
            table = table.assign(family=table["metric"].astype(str).map(lambda m: METRIC_MAP.get(m, m)) + suffix)
        table = table.assign(source=source)
        frames.append(table)
    if not frames:
        return {}
    import pandas as pd

    table = pd.concat(frames, ignore_index=True)
    hubble = table["metric"].astype(str).str.startswith(HUBBLE_PREFIX)
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


def derive_span_signals(traces) -> dict[str, dict[str, list[tuple[int, float]]]]:
    """Per-service error rate and mean latency, in {@link DERIVED_BUCKET_SECONDS} buckets.

    Attributed to the span's OWN service: a `response-replace-code` fault is visible because the
    injected service's own server spans start returning failures, and the archive carries
    `attr.status_code` on every pack sampled. Both signals are between 0 and 1 or in milliseconds, so
    neither brings a scale the calibration has not seen.

    An empty bucket is ABSENT rather than zero: a service that emitted no span in a bucket has no error
    rate, and writing `0.0` there would be an observation the archive never made.
    """
    import pandas as pd

    if traces is None or traces.empty:
        return {}
    # `attr.status_code` is present on every pack in the archive, but a pack without it must produce a
    # latency series and NO error rate rather than raise -- a missing column is a different observation
    # from a column of `Unset`, and neither is a reason to lose the pack.
    table = traces.copy()
    if "attr.status_code" not in table.columns:
        table["attr.status_code"] = None
    table = table[["time", "service_name", "duration", "attr.status_code"]]
    table = table[table["service_name"].notna() & (table["service_name"] != "")]
    if table.empty:
        return {}
    table["ts"] = epoch_seconds(table["time"].dt.tz_localize(None))
    table["bucket"] = (table["ts"] // DERIVED_BUCKET_SECONDS) * DERIVED_BUCKET_SECONDS
    table["failed"] = table["attr.status_code"].map(is_error_status).astype(float)
    grouped = table.groupby(["service_name", "bucket"], sort=True).agg(
        spans=("failed", "size"),
        failed=("failed", "sum"),
        duration=("duration", "mean"),
    )
    out: dict[str, dict[str, list[tuple[int, float]]]] = {}
    for (service, bucket), row in grouped.iterrows():
        out.setdefault(str(service), {}).setdefault(DERIVED_ERROR_RATE, []).append(
            (int(bucket), float(row["failed"]) / float(row["spans"]))
        )
        # RCABench durations are nanoseconds; the derived latency is milliseconds so that it carries
        # the unit `inferUnit` assigns to a `latency`/`duration` name.
        out[str(service)].setdefault(DERIVED_LATENCY, []).append(
            (int(bucket), float(row["duration"]) / 1_000_000.0)
        )
    return out


def merge_windows(pack: Path, families: str = "core") -> dict[str, list[dict]]:
    """Both windows as one `metrics.json` body, as the RCAEval packs carry it."""
    merged: dict[str, dict[str, list[tuple[int, float]]]] = {}
    for window in ("normal", "abnormal"):
        for entity, entity_families in read_metrics(pack, window, families).items():
            for family, points in entity_families.items():
                merged.setdefault(entity, {}).setdefault(family, []).extend(points)
    if families == "full":
        for entity, entity_families in derive_span_signals(load_traces(pack)).items():
            for family, points in entity_families.items():
                merged.setdefault(entity, {}).setdefault(family, []).extend(points)
    rows: dict[str, list[dict]] = {}
    for entity, entity_families in merged.items():
        out = []
        for family, points in entity_families.items():
            for ts, value in sorted(points):
                out.append({"timestamp": ts, "value": value, "metric_name": family})
        rows[entity] = out
    return rows


def load_traces(pack: Path):
    """Both windows of spans as one frame, or `None` when the pack carries no span file.

    Read ONCE and shared by the two products it feeds -- `traces.csv` for the loader's own span
    channels, and the derived per-service signals -- because a pack can hold a million spans and the
    walk this bridge does over the archive is hours long.
    """
    import pandas as pd

    frames = []
    for window in ("normal", "abnormal"):
        path = pack / f"{window}_traces.parquet"
        if path.exists():
            frames.append(pq.read_table(path).to_pandas())
    if not frames:
        return None
    table = pd.concat(frames, ignore_index=True)
    return None if table.empty else table


def write_traces(pack: Path, dest: Path) -> int:
    """Both windows as `traces.csv`, in the column names the loader reads."""
    table = load_traces(pack)
    if table is None:
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
    ap.add_argument(
        "--start",
        type=int,
        default=0,
        help="Resume: skip the first N packs of the selection. Case numbering does NOT restart, so a "
        "walk interrupted at pack 1059 can be continued without rewriting the 1058 cases already on disk.",
    )
    ap.add_argument("--case-prefix", default="re3tt", help="Case directory prefix")
    ap.add_argument(
        "--families",
        choices=FAMILY_MODES,
        default="core",
        help="core: the seven mapped families. full: every family in the pack, plus the two derived "
        "span signals. See the header.",
    )
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
    # `--start` slices the SELECTION but not the NUMBERING: the case directory name carries the pack's
    # position in the selection, so restarting the count would publish a second case for one pack.
    chosen = chosen[args.start :]
    dst.mkdir(parents=True, exist_ok=True)

    written = 0
    skipped: list[tuple[str, str]] = []
    for index, pack in enumerate(chosen, start=args.start + 1):
        # ONE UNREADABLE PACK MUST NOT END A 1,400-PACK WALK. This is not hypothetical: the first full
        # conversion of the archive died at pack 1,059 on a `normal_traces.parquet` whose footer was
        # truncated by an interrupted extraction, and it died AFTER writing 59 GB -- with nothing said
        # about which pack, how far it had got, or that 1,058 cases were already on disk. A corpus is an
        # input; an input with one bad member is a fact to report, not an exception to propagate.
        try:
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
            injected = point.get("source_service") or point.get("app_name") or target
            # The corpus's own declaration WINS over anything recovered from a name or a config field.
            # `injection.json.ground_truth.service` is the set the benchmark itself publishes, and the 1,422
            # packs were checked: its first member equals the injection point's source on 1,421 of them, and
            # on the one it does not (`ts4-ts-food-service-container-kill-lv5htg`, whose config names
            # `ts-food-service` while its ground truth is `ts-config-service`) the declaration is the answer
            # the benchmark will score against. A disagreement between a name and a declaration is settled by
            # the benchmark, not by the name.
            primary = services[0] if services else injected

            metrics = merge_windows(pack, args.families)
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
                        # The ACCEPTED SET, under the plural of the field the loader already reads. 1,053 of
                        # the 1,422 packs declare two elements, because an edge-injected fault is neither
                        # endpoint alone; a scorer that reads one of them counts the other as a miss, which is
                        # exactly what happened before this field existed (32.28% -> 42.69%).
                        "root_cause_services": services,
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
        except Exception as exc:  # noqa: BLE001 - the reason is RECORDED, not swallowed
            skipped.append((pack.name, f"{type(exc).__name__}: {exc}"))
            print(f"[{index}/{len(chosen)}] SKIPPED {pack.name}: {type(exc).__name__}: {exc}",
                  file=sys.stderr, flush=True)
    print(f"converted {written} packs -> {dst}", flush=True)
    if skipped:
        # Printed LAST and in full, because the count is the population a reading is taken over: a
        # conversion that silently dropped a member would make every later percentage a share of a
        # denominator nobody named.
        print(f"skipped {len(skipped)} pack(s):", file=sys.stderr, flush=True)
        for name, reason in skipped:
            print(f"  {name}: {reason}", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
