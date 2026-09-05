#!/usr/bin/env python3
"""
Convert RCAEval Parquet datasets to JSON/CSV for benchmark consumption.

Input:  ~/RCAEval-data/*/ (raw Parquet from Hugging Face)
Output: ~/RCAEval-json/*/ (converted JSON + CSV files)

Each case directory produces:
  - metrics.json        (Parquet → structured JSON)
  - ground_truth.json   (Parquet or direct copy)
  - inject_time.txt     (inject timestamp, int)
  - traces.csv          (Parquet → CSV, RE2/RE3 only)
  - logs.csv            (Parquet → CSV, RE2/RE3 only)

Usage:
  python3 scripts/convert-parquet-to-json.py [--data-dir ~/RCAEval-data] [--out-dir ~/RCAEval-json]
"""

import os, json, sys, time, shutil
from pathlib import Path
from datetime import datetime, timezone


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def convert_case(case_src: Path, case_dst: Path, case_idx: int, total: int) -> bool:
    """Convert a single case directory. Returns True if metrics.json was created successfully."""
    case_dst.mkdir(parents=True, exist_ok=True)
    metrics_ok = False

    try:
        # ── metrics.parquet → metrics.json (REQUIRED) ──
        metrics_pq = case_src / "metrics.parquet"
        if metrics_pq.exists():
            import pandas as pd
            df = pd.read_parquet(metrics_pq)
            metrics_out: dict = {}

            # Detect column layout: "service" column present vs wide format
            svc_col = next(
                (c for c in df.columns if c in ("service", "service_id", "serviceId", "svc")),
                None,
            )
            ts_col = next(
                (c for c in df.columns if c in ("timestamp", "time", "ts", "t")),
                None,
            )
            val_col = next(
                (c for c in df.columns if c in ("value", "val", "v")),
                None,
            )
            metric_col = next(
                (c for c in df.columns if c in ("metric_name", "metric", "name", "metric_name_new")),
                None,
            )

            if svc_col is not None and ts_col is not None and val_col is not None:
                # Long format: rows with service, timestamp, value, metric_name columns
                for _, row in df.iterrows():
                    svc = str(row[svc_col])
                    if svc not in metrics_out:
                        metrics_out[svc] = []
                    metrics_out[svc].append({
                        "timestamp": int(row[ts_col]) if pd.notna(row[ts_col]) else 0,
                        "value": float(row[val_col]) if pd.notna(row[val_col]) else 0.0,
                        "metric_name": str(row[metric_col])
                        if metric_col is not None and metric_col in row and pd.notna(row[metric_col])
                        else "unknown",
                    })
                metrics_ok = len(metrics_out) > 0
            else:
                # Wide format: first column is timestamp, remaining columns are service::metric
                # or service_metric naming. Column names encode service + metric info.
                ts_vals = df.iloc[:, 0].tolist() if len(df.columns) > 0 else []
                for col in df.columns[1:]:
                    col_str = str(col)
                    # Split service name from metric name using common separators
                    if "::" in col_str:
                        parts = col_str.split("::", 1)
                    elif "||" in col_str:
                        parts = col_str.split("||", 1)
                    else:
                        # Try to split at last underscore before a known metric suffix
                        known_suffixes = [
                            "_cpu", "_mem", "_disk", "_latency", "_delay", "_loss",
                            "_error_rate", "_success_rate", "_throughput", "_traffic",
                            "_wait", "_busy", "_usage", "_utilization", "_capacity",
                            "_request_count", "_response_time", "_io", "_network",
                            "_connections", "_queue", "_pool", "_active", "_idle",
                        ]
                        split_at = -1
                        for suffix in known_suffixes:
                            idx = col_str.rfind(suffix)
                            if idx > 0:
                                split_at = max(split_at, idx)
                        if split_at > 0:
                            parts = [col_str[:split_at], col_str[split_at + 1:]]
                        else:
                            # Last resort: split at last underscore
                            last_underscore = col_str.rfind("_")
                            if last_underscore > 0:
                                parts = [col_str[:last_underscore], col_str[last_underscore + 1:]]
                            else:
                                parts = [col_str, col_str]

                    svc = parts[0] if len(parts) >= 1 else col_str
                    metric = parts[1] if len(parts) >= 2 else col_str
                    for idx, val in enumerate(df[col]):
                        ts = int(ts_vals[idx]) if idx < len(ts_vals) else 0
                        if svc not in metrics_out:
                            metrics_out[svc] = []
                        metrics_out[svc].append({
                            "timestamp": ts,
                            "value": float(val) if pd.notna(val) else 0.0,
                            "metric_name": metric,
                        })
                metrics_ok = len(metrics_out) > 0

            if metrics_ok:
                with open(case_dst / "metrics.json", "w") as f:
                    json.dump(metrics_out, f)
            else:
                log(f"  [{case_idx}/{total}] WARN {case_src.name}: metrics.parquet produced empty output")
                return False
        else:
            log(f"  [{case_idx}/{total}] SKIP {case_src.name}: no metrics.parquet found")
            return False

        # ── inject_time ── (defensive — case still loads without it)
        inject_pq = case_src / "inject_time.parquet"
        inject_txt = case_src / "inject_time.txt"
        if inject_pq.exists():
            import pandas as pd
            df = pd.read_parquet(inject_pq)
            val = int(df.iloc[0, 0]) if len(df) > 0 else 0
            (case_dst / "inject_time.txt").write_text(str(val))
        elif inject_txt.exists():
            shutil.copy(inject_txt, case_dst / "inject_time.txt")
        else:
            # Write a default inject_time.txt so loaders don't fail
            (case_dst / "inject_time.txt").write_text("0")

        # ── ground_truth ── (defensive)
        gt_found = False
        for gt_name in ("ground_truth.json", "ground_truth.parquet"):
            gt_src = case_src / gt_name
            if gt_src.exists() and not gt_found:
                gt_found = True
                if gt_src.suffix == ".parquet":
                    import pandas as pd
                    df = pd.read_parquet(gt_src)
                    gt_data = df.iloc[0].to_dict() if len(df) > 0 else {}
                    with open(case_dst / "ground_truth.json", "w") as f:
                        json.dump(gt_data, f, default=str)
                else:
                    shutil.copy(gt_src, case_dst / "ground_truth.json")
                break

        # ── traces.parquet → traces.csv (RE2/RE3 only, defensive) ──
        traces_pq = case_src / "traces.parquet"
        if traces_pq.exists():
            try:
                import pandas as pd
                df = pd.read_parquet(traces_pq)
                df.to_csv(case_dst / "traces.csv", index=False)
            except Exception as te:
                log(f"  [{case_idx}/{total}] WARN {case_src.name}: traces.parquet conversion failed: {te}")

        # ── logs.parquet → logs.csv (RE2/RE3 only, defensive) ──
        logs_pq = case_src / "logs.parquet"
        if logs_pq.exists():
            try:
                import pandas as pd
                df = pd.read_parquet(logs_pq)
                df.to_csv(case_dst / "logs.csv", index=False)
            except Exception as le:
                log(f"  [{case_idx}/{total}] WARN {case_src.name}: logs.parquet conversion failed: {le}")

        # ── Copy auxiliary files (.csv, .txt) ──
        for aux_file in case_src.glob("*"):
            if aux_file.suffix in (".csv", ".txt") and aux_file.name not in (
                "traces.csv", "logs.csv",
            ):
                dst_path = case_dst / aux_file.name
                if not dst_path.exists():
                    shutil.copy(aux_file, dst_path)

        return True
    except Exception as e:
        log(f"  [{case_idx}/{total}] FAIL {case_src.name}: {e}")
        return False


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Convert RCAEval Parquet → JSON/CSV")
    parser.add_argument(
        "--data-dir",
        default=os.path.expanduser("~/RCAEval-data"),
        help="Raw Parquet data directory",
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.expanduser("~/RCAEval-json"),
        help="Output JSON directory",
    )
    parser.add_argument("--batch-size", type=int, default=50, help="Cases per progress report")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)

    if not data_dir.exists():
        log(f"ERROR: Data directory not found: {data_dir}")
        log("Run 'Cache Benchmark Datasets' workflow first to download RCAEval data.")
        sys.exit(1)

    # ── Discover case directories ──
    case_dirs: set[Path] = set()
    for pq in data_dir.rglob("*.parquet"):
        case_dirs.add(pq.relative_to(data_dir).parent)

    case_list = sorted(case_dirs)
    total = len(case_list)
    log(f"Found {total} case directories in {data_dir}")
    log(f"Output directory: {out_dir}")

    out_dir.mkdir(parents=True, exist_ok=True)

    # ── Convert ──
    converted = 0
    failed = 0
    t_start = time.time()

    for i, case_rel in enumerate(case_list, 1):
        case_src = data_dir / case_rel
        case_dst = out_dir / case_rel
        if convert_case(case_src, case_dst, i, total):
            converted += 1
        else:
            failed += 1

        if i % args.batch_size == 0 or i == total:
            elapsed = time.time() - t_start
            rate = i / max(elapsed, 0.1)
            eta = (total - i) / max(rate, 0.01)
            log(
                f"Progress: {i}/{total} cases ({converted} ok, {failed} fail) | "
                f"{rate:.1f} cases/s | ETA {eta:.0f}s | elapsed {elapsed:.0f}s"
            )

    elapsed = time.time() - t_start
    log(f"Complete: {converted}/{total} cases converted, {failed} failed in {elapsed:.0f}s ({elapsed/60:.1f} min)")

    # ── Summary ──
    json_files = len(list(out_dir.rglob("*.json")))
    csv_files = len(list(out_dir.rglob("*.csv")))
    txt_files = len(list(out_dir.rglob("*.txt")))
    size_mb = sum(f.stat().st_size for f in out_dir.rglob("*") if f.is_file()) / (1024 * 1024)

    log(f"Output: {json_files} JSON, {csv_files} CSV, {txt_files} TXT, {size_mb:.0f} MB total")


if __name__ == "__main__":
    main()
