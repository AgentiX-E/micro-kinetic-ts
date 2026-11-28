#!/usr/bin/env python3
"""Replay the idle guard's two windows over every case's own TRUTH error channel.

The engine refuses a channel that sits at ~0 for more than 40 % of its samples, and an event channel
(`error`, `http.response.error_rate`) is measured over the POST-injection window rather than the whole
recording, because the pre-injection half of a fault case is quiet BY CONSTRUCTION. That rule is a
membership question — `EVENT_METRIC_LABELS` in `packages/tree/src/causal/topology-fault-graph.ts` — and a
membership list is exactly the kind of thing that can be right for one producer and never apply to another.

This tool prices the difference instead of asserting it. For every datapack it rebuilds the error-rate series
the converter derives (percentage of spans with HTTP status >= 400 per service per 10 s window, over the
concatenated normal + abnormal traces) and asks the guard's question twice, on the ground-truth service only:

  whole-file   near-zero samples > 40 % of the WHOLE recording   -> the channel is dropped
  post-window  near-zero samples > 40 % of the POST-anchor half  -> the channel is dropped

`near-zero` is the guard's own definition, `value <= window_peak * 0.001`. A case where the first reading
drops the truth's channel and the second keeps it is a case whose decisive evidence the wrong membership
silently removed. Nothing here re-implements the ENGINE — it re-implements the guard, which is why every
constant below names the line it mirrors.

Usage:
    python3 scripts/fse26_duty_cycle_sweep.py --data-dir /path/to/rcabench --out sweep.json

@module scripts/fse26_duty_cycle_sweep
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path
from typing import Any

# Mirrors `topology-fault-graph.ts`: the duty-cycle threshold, the near-zero band, and the converter's window.
NEAR_ZERO_BAND = 0.001
DUTY_CYCLE_THRESHOLD = 0.4
WINDOW_MS = 10_000

# The archive's fault-phrase vocabulary, taken from the corpus itself (the token before the hash, counted over
# all 1422 datapacks: `code 231, delay 198, method 190, stress 173, abort 104, kill 99, partition 97, body 55,
# loss 48, corrupt 46, exception 43, bandwidth 42, path 39, failure 24, return 21, latency 7, time 2, mysql 2,
# dns 1`). Longer phrases are listed so a service whose own name ends in a fault word keeps its tail, and the
# matcher requires the phrase to END at the datapack's second-to-last token — the name is
# `<namespace>-<service>-<phrase>-<hash>`, so the phrase is anchored on the RIGHT and never on the left.
_FAULT_PHRASES: tuple[tuple[str, ...], ...] = tuple(
    sorted(
        [
            ("response", "replace", "code"),
            ("request", "replace", "method"),
            ("response", "replace", "body"),
            ("request", "replace", "path"),
            ("response", "patch", "body"),
            ("container", "kill"),
            ("pod", "failure"),
            ("pod", "kill"),
            ("request", "abort"),
            ("response", "abort"),
            ("request", "delay"),
            ("response", "delay"),
            ("network", "partition"),
            ("network", "delay"),
            ("network", "loss"),
            ("network", "corrupt"),
            ("network", "bandwidth"),
            ("memory", "stress"),
            ("cpu", "stress"),
            ("code",),
            ("delay",),
            ("method",),
            ("stress",),
            ("abort",),
            ("kill",),
            ("partition",),
            ("body",),
            ("loss",),
            ("corrupt",),
            ("exception",),
            ("bandwidth",),
            ("path",),
            ("failure",),
            ("return",),
            ("latency",),
            ("time",),
            ("mysql",),
            ("dns",),
        ],
        key=len,
        reverse=True,
    )
)


def truth_service(datapack: str) -> str | None:
    """
    Return the ground-truth service named by a datapack directory.

    `ts0-ts-basic-service-response-replace-code-4vn4gg` -> `ts-basic-service`. The name is
    `<namespace>-<service>-<fault phrase>-<hash>`, so the fault phrase is the longest known phrase that ENDS at
    the second-to-last token: anchoring from the right is what keeps a service whose own name carries a fault
    word (`ts-code-service`) from being cut, and what makes the trailing hash irrelevant.

    @param datapack - Datapack directory name.
    @returns The service, or None when no known fault phrase ends the name.
    """
    tokens = datapack.split("-")
    if len(tokens) < 3:
        return None
    end = len(tokens) - 1
    for phrase in _FAULT_PHRASES:
        start = end - len(phrase)
        if start >= 1 and tuple(tokens[start:end]) == phrase:
            # The FIRST match wins, and when it leaves no service the answer is None rather than a shorter
            # phrase's reading: `ts0-response-replace-code-abcd12` has no service in it, and falling through to
            # the `code` phrase would invent `response-replace`.
            return "-".join(tokens[1:start]) if start >= 2 else None
    return None


def near_zero_share(values: list[float], start: int = 0) -> float:
    """
    Return the share of `values[start:]` that sits within {@link NEAR_ZERO_BAND} of that slice's peak.

    @param values - The series, in time order.
    @param start - First index of the window.
    @returns Share in `[0, 1]`; `0.0` for an empty window.
    """
    window = values[start:]
    if not window:
        return 0.0
    peak = max(window)
    if peak <= 0:
        # A window with no level at all is entirely near-zero: the guard's own reading of an idle instrument.
        return 1.0
    band = peak * NEAR_ZERO_BAND
    return sum(1 for v in window if v <= band) / len(window)


def judge(values: list[float], anchor_index: int) -> tuple[bool, bool]:
    """
    Return the guard's two readings for one series: `(dropped_whole_file, dropped_post_window)`.

    The post-injection window is used only when the boundary leaves at least two samples on the claimed side —
    the engine's own floor, because a duty cycle over one sample is not a measurement. Otherwise both readings
    are the whole-recording one, which is what the engine does.

    @param values - The series, in time order.
    @param anchor_index - Index of the first post-injection sample, or -1 when the boundary cannot be placed.
    @returns Whether each reading refuses the channel.
    """
    whole = near_zero_share(values) > DUTY_CYCLE_THRESHOLD
    if anchor_index < 0 or len(values) - anchor_index < 2:
        return whole, whole
    return whole, near_zero_share(values, anchor_index) > DUTY_CYCLE_THRESHOLD


def _error_series(case_dir: Path) -> dict[str, tuple[list[int], list[float]]]:
    """
    Rebuild the converter's `http.response.error_rate` series per service.

    @param case_dir - Datapack directory holding `normal_traces.parquet` / `abnormal_traces.parquet`.
    @returns Per-service `(window_starts, rates)`; empty when the case carries no status column.
    """
    import polars as pl

    frames = []
    for name in ("normal_traces.parquet", "abnormal_traces.parquet"):
        path = case_dir / name
        if not path.exists():
            continue
        schema = pl.scan_parquet(path).collect_schema()
        if "attr.http.response.status_code" not in schema:
            continue
        frame = pl.read_parquet(
            path, columns=["time", "service_name", "attr.http.response.status_code"]
        )
        frames.append(
            frame.with_columns(
                (pl.col("time").dt.epoch("ms") // WINDOW_MS * WINDOW_MS).alias("w"),
                (pl.col("attr.http.response.status_code").cast(pl.Int32) >= 400).alias("e"),
            )
        )
    if not frames:
        return {}
    df = pl.concat(frames).filter(
        pl.col("service_name").is_not_null() & pl.col("e").is_not_null()
    )
    grouped = (
        df.group_by(["service_name", "w"])
        .agg((pl.col("e").sum() / pl.col("e").count() * 100.0).alias("rate"))
        .sort(["service_name", "w"])
    )
    out: dict[str, tuple[list[int], list[float]]] = {}
    for (service,), group in grouped.group_by("service_name", maintain_order=True):
        out[service] = (group["w"].to_list(), group["rate"].to_list())
    return out


def judge_case(case_dir: Path) -> dict[str, Any] | None:
    """
    Judge one datapack against its own truth service.

    @param case_dir - Datapack directory.
    @returns A record, or None when the datapack names no service this tool can parse.
    """
    truth = truth_service(case_dir.name)
    if truth is None:
        return None
    try:
        env = json.loads((case_dir / "env.json").read_text("utf-8"))
        anchor_ms = int(env["ABNORMAL_START"]) * 1000
        series = _error_series(case_dir)
    except (OSError, KeyError, ValueError) as exc:
        return {"datapack": case_dir.name, "truth": truth, "error": str(exc)}
    if truth not in series:
        return {"datapack": case_dir.name, "truth": truth, "absent": True}
    starts, rates = series[truth]
    if len(rates) < 5:
        return {"datapack": case_dir.name, "truth": truth, "short": True}
    anchor = next((i for i, w in enumerate(starts) if w >= anchor_ms), -1)
    whole, post = judge(rates, anchor)
    pre = rates[:anchor] if anchor >= 0 else rates[: len(rates) // 2]
    return {
        "datapack": case_dir.name,
        "truth": truth,
        "samples": len(rates),
        "anchor_index": anchor,
        "dropped_whole": whole,
        "dropped_post": post,
        "pre_peak": round(max(pre), 3) if pre else None,
        "post_peak": round(max(rates[anchor:]), 3) if anchor >= 0 else None,
    }


def summarize(rows: list[dict[str, Any]], unparsed: int = 0) -> dict[str, Any]:
    """
    Reduce per-case records to the census the document quotes.

    @param rows - Records from {@link judge_case}, failures included.
    @param unparsed - How many datapacks named no service this tool could parse, counted by the caller because
        a record that does not exist cannot report its own absence.
    @returns The counts, plus the rescued cases grouped by fault phrase.
    """
    judged = [r for r in rows if "dropped_whole" in r]
    rescued = [r for r in judged if r["dropped_whole"] and not r["dropped_post"]]
    by_type: dict[str, int] = {}
    for r in rescued:
        # The fault phrase is what the grouping is about, so it is read as "everything between the truth
        # service and the datapack's hash", never by splitting on hyphens from the left: a service whose own
        # name carries a hyphen would otherwise be cut. The namespace is dropped on the way.
        _, _, rest = r["datapack"].partition(f"-{r['truth']}-")
        shape = rest.rsplit("-", 1)[0] or r["datapack"]
        by_type[shape] = by_type.get(shape, 0) + 1
    return {
        "cases": len(rows),
        "judged": len(judged),
        "unparsed": unparsed,
        "truth_channel_absent": sum(1 for r in rows if r.get("absent")),
        "too_few_samples": sum(1 for r in rows if r.get("short")),
        "load_errors": sum(1 for r in rows if r.get("error")),
        "dropped_whole": sum(1 for r in judged if r["dropped_whole"]),
        "dropped_post": sum(1 for r in judged if r["dropped_post"]),
        "rescued": len(rescued),
        "rescued_by_fault": dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
    }


def collect(dirs: list[Path], workers: int) -> list[dict[str, Any] | None]:
    """
    Judge every datapack, in one process when asked for one worker.

    A pool of one is not a pool: forking a worker to read one case costs more than the case, and a process
    started from a library that has already opened threads (polars does) is a fork of a threaded process — which
    is why the single-worker path is the SEQUENTIAL one and not `ProcessPoolExecutor(max_workers=1)`.

    @param dirs - Datapack directories.
    @param workers - Worker count; `1` runs in this process.
    @returns One record per judged datapack, `None` for the ones this tool cannot name.
    """
    if workers <= 1:
        return [judge_case(d) for d in dirs]
    # `spawn`, not the platform default: this module imports polars, whose thread pool makes a forked child a
    # copy of a threaded process. The cost is one interpreter start per worker, paid once against a workload of
    # thousands of Parquet reads.
    with ProcessPoolExecutor(max_workers=workers, mp_context=get_context("spawn")) as pool:
        return list(pool.map(judge_case, dirs, chunksize=8))


def main(argv: list[str] | None = None) -> int:
    """
    Run the sweep and write its census.

    @param argv - Command line, defaults to `sys.argv[1:]`.
    @returns Process exit code.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, help="Extracted rcabench tar root.")
    parser.add_argument("--out", required=True, help="Where to write the per-case JSON.")
    parser.add_argument("--workers", type=int, default=8, help="Conversion workers.")
    args = parser.parse_args(argv)

    root = Path(args.data_dir)
    dirs = sorted(p for p in root.iterdir() if p.is_dir())
    raw = collect(dirs, args.workers)
    rows = [r for r in raw if r is not None]
    summary = summarize(rows, unparsed=len(raw) - len(rows))
    Path(args.out).write_text(json.dumps({"summary": summary, "cases": rows}, indent=1), "utf-8")

    print(
        f"judged {summary['judged']} of {summary['cases']} datapacks: "
        f"whole-file drops the truth channel on {summary['dropped_whole']}, "
        f"post-window on {summary['dropped_post']}, rescued {summary['rescued']}"
    )
    print(
        f"absent {summary['truth_channel_absent']}, short {summary['too_few_samples']}, "
        f"load errors {summary['load_errors']}"
    )
    for name, count in list(summary["rescued_by_fault"].items())[:10]:
        print(f"  {name:44s} {count}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    # Unreachable under `coverage run -m unittest discover`, which imports this module rather than executing
    # it; the same exclusion `fse26_cache_select.py` carries, and the behaviour it would run is `main`, whose
    # every branch the tests above reach.
    sys.exit(main())
