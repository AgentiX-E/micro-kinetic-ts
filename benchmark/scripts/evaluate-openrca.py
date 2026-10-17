#!/usr/bin/env python3
"""OpenRCA Evaluation Script — shared across all three project repos.

Usage:
    python scripts/evaluate-openrca.py \\
        --project "Causality Analyzer" \\
        --agent "CA-LLM (causal graph + RCA + DeepSeek)" \\
        --repo "https://github.com/AgentiX-E/causality-analyzer" \\
        --predictions-dir ./predictions \\
        --output evaluation-report.csv

Workflow (called from openrca-evaluate.yml):
    1. Merge all prediction CSVs from --predictions-dir
    2. Download ground truth queries (query.csv) from Google Drive
    3. Clone OpenRCA framework
    4. Run OpenRCA/main/evaluate.py
    5. Generate leaderboard-submission.json
    6. Output report CSV
"""

import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

GOOGLE_DRIVE_FOLDER_ID = "1wGiEnu4OkWrjPxfx5ZTROnU37-5UDoPM"

SHARDS = [
    "telecom-early",
    "telecom-late",
    "bank-early",
    "bank-late",
    "market-cb1",
    "market-cb2",
]


def parse_args():
    p = argparse.ArgumentParser(description="OpenRCA Evaluation Runner")
    p.add_argument("--project", required=True, help="Project display name (e.g. 'Causality Analyzer')")
    p.add_argument("--agent", required=True, help="Agent description for leaderboard")
    p.add_argument("--repo", required=True, help="GitHub repo URL")
    p.add_argument("--predictions-dir", required=True, help="Directory containing per-shard prediction subdirs")
    p.add_argument("--output", default="evaluation-report.csv", help="Output report CSV path")
    p.add_argument("--openrca-dir", default="OpenRCA-framework", help="OpenRCA clone directory")
    p.add_argument("--groundtruth-dir", default="groundtruth", help="Ground truth download directory")
    return p.parse_args()


# ── Step 1: Merge all prediction CSVs ──
def merge_predictions(predictions_dir: str) -> str:
    """Recursively find all CSV files under predictions_dir and concatenate them."""
    predictions_path = Path(predictions_dir)
    merged_path = predictions_path / "all-predictions.csv"

    csv_files = sorted(predictions_path.rglob("*.csv"))
    # Exclude the merged file itself if it already exists
    csv_files = [f for f in csv_files if f != merged_path]

    if not csv_files:
        print(f"[ERROR] No prediction CSV files found under {predictions_dir}")
        print(f"  Directory contents: {list(predictions_path.iterdir()) if predictions_path.exists() else 'NOT FOUND'}")
        sys.exit(1)

    print(f"\n📋 Merging {len(csv_files)} prediction CSVs:")

    header_written = False
    total_rows = 0
    with open(merged_path, "w", newline="") as out:
        writer = csv.writer(out)
        for f in csv_files:
            print(f"  → {f.relative_to(predictions_path)}")
            with open(f) as fh:
                reader = csv.reader(fh)
                for i, row in enumerate(reader):
                    if i == 0 and not header_written:
                        writer.writerow(row)
                        header_written = True
                    elif i > 0:
                        writer.writerow(row)
                        total_rows += 1

    print(f"✅ Merged {total_rows} prediction rows → {merged_path}")
    return str(merged_path)


# ── Step 2: Download ground truth ──
def download_groundtruth(groundtruth_dir: str):
    """Download query.csv files from Google Drive (few KB each, negligible size)."""
    gt_path = Path(groundtruth_dir)
    if gt_path.exists() and any(gt_path.rglob("query.csv")):
        print(f"\n📂 Ground truth already exists at {groundtruth_dir}")
        return

    gt_path.mkdir(parents=True, exist_ok=True)

    print(f"\n📥 Downloading ground truth queries from Google Drive...")
    result = subprocess.run(
        [
            "gdown",
            "--folder",
            f"https://drive.google.com/drive/folders/{GOOGLE_DRIVE_FOLDER_ID}",
            "-O", str(gt_path) + "/",
            "--remaining-ok",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        # gdown may return non-zero when some files already exist — try to proceed
        print(f"[WARN] gdown exited with {result.returncode}")
        # Check if any query.csv files were downloaded
        query_files = list(gt_path.rglob("query.csv"))
        if not query_files:
            print("[ERROR] Failed to download ground truth. Trying alternative approach...")
            # Try downloading just the query.csv files directly
            for system in ["Telecom", "Bank", "Market"]:
                subprocess.run(
                    ["gdown", f"--folder", f"{GOOGLE_DRIVE_FOLDER_ID}", "-O", str(gt_path / system) + "/"],
                    capture_output=True,
                )

    query_files = list(gt_path.rglob("query.csv"))
    print(f"✅ Downloaded {len(query_files)} query.csv files")


# ── Step 3: Clone OpenRCA framework ──
def clone_openrca(openrca_dir: str):
    """Clone Microsoft OpenRCA repository if not already present."""
    openrca_path = Path(openrca_dir)
    if openrca_path.exists():
        print(f"\n📂 OpenRCA framework already exists at {openrca_dir}")
        return

    print(f"\n📥 Cloning OpenRCA framework...")
    subprocess.run(
        ["git", "clone", "https://github.com/microsoft/OpenRCA.git", str(openrca_path)],
        check=True,
    )
    print(f"✅ OpenRCA cloned → {openrca_dir}")


# ── Step 4: Run evaluate.py ──
def run_evaluation(merged_csv: str, groundtruth_dir: str, openrca_dir: str, output: str):
    """Run OpenRCA/main/evaluate.py against merged predictions."""
    print(f"\n🔬 Running OpenRCA evaluation...")

    # Find query.csv files for each system
    query_files = sorted(Path(groundtruth_dir).rglob("query.csv"))
    if not query_files:
        print("[WARN] No query.csv files found — evaluation may produce empty results")
    else:
        print(f"  Ground truth files: {[str(q) for q in query_files]}")

    # OpenRCA evaluate.py expects: -p predictions.csv -q query1.csv query2.csv ... -r report.csv
    cmd = [
        "python",
        str(Path(openrca_dir) / "main" / "evaluate.py"),
        "-p", merged_csv,
        "-r", output,
    ]
    for qf in query_files:
        cmd.extend(["-q", str(qf)])

    print(f"  Command: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            print(f"  [evaluate] {line}")

    if result.returncode != 0:
        print(f"[WARN] evaluate.py exited with {result.returncode}")
        if result.stderr:
            print(f"  stderr: {result.stderr}")
    else:
        print(f"✅ Evaluation complete → {output}")

    return result.returncode


# ── Step 5: Generate leaderboard submission ──
def generate_leaderboard(project: str, agent: str, repo: str, report_csv: str, output_dir: str):
    """Read evaluation report and generate leaderboard-submission.json."""
    print(f"\n📊 Generating leaderboard submission...")

    submission = {
        "project": project,
        "agent": agent,
        "open_source": True,
        "repo": repo,
        "benchmark": "OpenRCA",
        "metrics": {},
    }

    # Try to parse the evaluation report for metrics
    report_path = Path(report_csv)
    if report_path.exists():
        with open(report_path) as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            if rows:
                # Last row typically contains aggregate metrics
                submission["metrics"] = {k: v for k, v in rows[-1].items() if v and v.strip()}

    # Also add per-system breakdown if available
    if report_path.exists():
        with open(report_path) as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            submission["per_system"] = [
                {k: v for k, v in row.items() if v and v.strip()}
                for row in rows
            ]

    output_path = Path(output_dir) / "leaderboard-submission.json"
    with open(output_path, "w") as f:
        json.dump(submission, f, indent=2, ensure_ascii=False)

    print(f"✅ Leaderboard submission → {output_path}")
    return str(output_path)


# ── Main ──
def main():
    args = parse_args()

    print("=" * 60)
    print(f"OpenRCA Evaluation — {args.project}")
    print("=" * 60)
    print(f"  Agent:     {args.agent}")
    print(f"  Repo:      {args.repo}")
    print(f"  Predictions: {args.predictions_dir}")
    print(f"  Output:    {args.output}")

    # 1. Merge predictions
    merged_csv = merge_predictions(args.predictions_dir)

    # 2. Download ground truth
    download_groundtruth(args.groundtruth_dir)

    # 3. Clone OpenRCA
    clone_openrca(args.openrca_dir)

    # 4. Run evaluation
    rc = run_evaluation(merged_csv, args.groundtruth_dir, args.openrca_dir, args.output)

    # 5. Generate leaderboard
    output_dir = Path(args.output).parent or "."
    generate_leaderboard(args.project, args.agent, args.repo, args.output, str(output_dir))

    print("\n" + "=" * 60)
    print("Evaluation pipeline complete.")
    print("=" * 60)

    return rc


if __name__ == "__main__":
    sys.exit(main() or 0)
