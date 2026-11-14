"""
Unit + integration tests for ``scripts/fse26_shard.py``.

Run with::

    python3 -m unittest discover -s scripts -p 'test_fse26_shard.py'

The sharder groups a flat tree of converted ``<datapack>/case.json`` documents
by their recorded ``faultCategory`` and emits one ``rcabench-<category>.tar.gz``
per category (plus a ``manifest.json``). These tests exercise discovery, category
reading, tarball layout, round-tripping, and the empty-tree edge case against
synthetic JSON documents — no 13.4 GB download.
"""

from __future__ import annotations

import contextlib
import io
import json
import runpy
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fse26_provenance as provenance
import fse26_shard as shard

SCRIPTS_DIR = Path(__file__).resolve().parent


def _write_case(root: Path, datapack: str, category: str) -> Path:
    """Write a minimal converted ``<datapack>/case.json`` and return its path."""
    case_dir = root / datapack
    case_dir.mkdir(parents=True, exist_ok=True)
    case = {
        "datapack": datapack,
        "faultType": "CPUStress",
        "faultCategory": category,
        "groundTruthServices": ["ts-order-service"],
        "injectTimeMs": 1757000000000,
        "metrics": {},
    }
    case_path = case_dir / "case.json"
    case_path.write_text(json.dumps(case), "utf-8")
    return case_path


class TestDiscoverCasePaths(unittest.TestCase):
    def test_finds_flat_case_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp1", "HTTP")
            _write_case(root, "dp2", "Resource")
            paths = shard.discover_case_paths(root)
        self.assertEqual([p.parent.name for p in paths], ["dp1", "dp2"])

    def test_empty_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(shard.discover_case_paths(Path(tmp)), [])


class TestReadCategory(unittest.TestCase):
    def test_reads_recorded_category(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = _write_case(Path(tmp), "dp1", "Network")
            self.assertEqual(shard.read_category(p), "Network")


class TestShard(unittest.TestCase):
    def test_groups_by_category_and_emits_tarballs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            _write_case(root, "dp-http-2", "HTTP")
            _write_case(root, "dp-res-1", "Resource")
            _write_case(root, "dp-dns-1", "DNS")

            manifest = shard.shard(root)

            by_cat = {s["category"]: s for s in manifest["shards"]}
            self.assertEqual(set(by_cat), {"HTTP", "Resource", "DNS"})
            self.assertEqual(by_cat["HTTP"]["cases"], 2)
            self.assertEqual(by_cat["Resource"]["cases"], 1)
            self.assertEqual(by_cat["DNS"]["cases"], 1)
            self.assertEqual(manifest["totalCases"], 4)

            # The HTTP shard archives each case at <datapack>/case.json.
            http_tar = root / by_cat["HTTP"]["shard"]
            self.assertTrue(http_tar.exists())
            with tarfile.open(http_tar, "r:gz") as tar:
                names = sorted(tar.getnames())
            self.assertEqual(names, ["dp-http-1/case.json", "dp-http-2/case.json"])

    def test_round_trip_through_tarball(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            manifest = shard.shard(root)
            shard_name = manifest["shards"][0]["shard"]

            extract_dir = root / "extracted"
            with tarfile.open(root / shard_name, "r:gz") as tar:
                tar.extractall(extract_dir, filter="data")

            case = json.loads((extract_dir / "dp-http-1" / "case.json").read_text("utf-8"))
            self.assertEqual(case["faultCategory"], "HTTP")
            self.assertEqual(case["datapack"], "dp-http-1")

    def test_manifest_is_written(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            shard.shard(root)
            manifest = json.loads((root / "manifest.json").read_text("utf-8"))
        self.assertEqual(manifest["totalCases"], 1)
        self.assertEqual(manifest["shards"][0]["category"], "HTTP")

    def test_empty_dir_returns_empty_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest = shard.shard(Path(tmp))
        self.assertEqual(manifest["shards"], [])
        self.assertEqual(manifest["totalCases"], 0)


class TestManifestProvenance(unittest.TestCase):
    """
    The manifest must let a consumer prove which converter produced the shards.

    Without this, a cache built from an older converter is indistinguishable from
    a current one and is consumed silently — which is how a stale release served
    pre-fix shards to a full CI benchmark run.
    """

    def test_records_provenance_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            manifest = shard.shard(root)

        self.assertEqual(manifest["schemaVersion"], provenance.SCHEMA_VERSION)
        self.assertEqual(manifest["converterDigest"], provenance.converter_digest(SCRIPTS_DIR))
        self.assertTrue(manifest["builtAt"].endswith("Z"), manifest["builtAt"])
        self.assertIn("converterRevision", manifest)

    def test_emitted_manifest_verifies_against_this_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            manifest = shard.shard(root)

        self.assertEqual(provenance.verify_provenance(manifest, SCRIPTS_DIR), [])

    def test_records_shard_size_and_digest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            manifest = shard.shard(root)
            entry = manifest["shards"][0]
            shard_path = root / entry["shard"]

            self.assertEqual(entry["bytes"], shard_path.stat().st_size)
            self.assertEqual(entry["sha256"], provenance.sha256_file(shard_path))
            self.assertEqual(provenance.verify_shards(manifest, root, ["HTTP"]), [])

    def test_explicit_revision_is_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            manifest = shard.shard(root, revision="deadbeef")
        self.assertEqual(manifest["converterRevision"], "deadbeef")

    def test_revision_defaults_to_the_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            with mock.patch.object(shard.provenance, "converter_revision", return_value="auto"):
                manifest = shard.shard(root)
        self.assertEqual(manifest["converterRevision"], "auto")

    def test_cli_records_the_revision(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            with contextlib.redirect_stdout(io.StringIO()):
                rc = shard.main(["--out-dir", str(root), "--converter-revision", "abc123"])
            manifest = json.loads((root / "manifest.json").read_text("utf-8"))
        self.assertEqual(rc, 0)
        self.assertEqual(manifest["converterRevision"], "abc123")


class TestShardMain(unittest.TestCase):
    """`main` validates the converted-JSON root and reports the emitted shards."""

    def test_missing_output_dir_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            rc = shard.main(["--out-dir", str(Path(tmp) / "nope")])
        self.assertEqual(rc, 1)

    def test_reports_and_returns_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_case(root, "dp-http-1", "HTTP")
            _write_case(root, "dp-res-1", "Resource")

            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                rc = shard.main(["--out-dir", str(root)])

            self.assertEqual(rc, 0)
            self.assertTrue((root / "manifest.json").exists())
            self.assertTrue((root / "rcabench-HTTP.tar.gz").exists())
            report = buffer.getvalue()
        self.assertIn("HTTP: 1 cases -> rcabench-HTTP.tar.gz", report)
        self.assertIn("Sharded 2 cases into 2 shards", report)

    def test_empty_root_returns_zero_with_no_shards(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                rc = shard.main(["--out-dir", tmp])
        self.assertEqual(rc, 0)
        self.assertIn("Sharded 0 cases into 0 shards", buffer.getvalue())


class TestShardEntrypoint(unittest.TestCase):
    """The `if __name__ == "__main__"` guard must exit with `main`'s status."""

    def test_missing_output_dir_exits_with_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            saved = sys.argv
            sys.argv = ["fse26_shard.py", "--out-dir", str(Path(tmp) / "nope")]
            try:
                with self.assertRaises(SystemExit) as ctx:
                    runpy.run_path(str(Path(__file__).resolve().parent / "fse26_shard.py"), run_name="__main__")
            finally:
                sys.argv = saved
        self.assertEqual(ctx.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
