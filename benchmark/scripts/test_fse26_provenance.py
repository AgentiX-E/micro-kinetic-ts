"""
Unit tests for ``scripts/fse26_provenance.py``.

Run with::

    python3 -m unittest discover -s scripts -p 'test_fse26_provenance.py'

The module exists to make a *stale cache* impossible to consume silently. The
FSE'26 shards are built in a separate repo from a ``--depth 1`` clone of these
converter sources and consumed later without re-conversion, so nothing in the
data itself reveals which converter produced it. These tests pin the two
guarantees that close the hole: the digest is a pure function of the converter
source *set* (stable, path-independent, sensitive to any edit), and verification
reports a manifest that predates provenance as a failure rather than a pass.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import runpy
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import fse26_provenance as provenance


def _write_sources(root: Path, *, shard_body: str = "SHARD", pin: str = "PINS") -> Path:
    """Write every provenance file into `root` and return `root`."""
    root.mkdir(parents=True, exist_ok=True)
    (root / "fse26_convert.py").write_text("CONVERT", "utf-8")
    (root / "fse26_convert_tar.py").write_text("STREAM", "utf-8")
    (root / "fse26_shard.py").write_text(shard_body, "utf-8")
    (root / "requirements-fse26.txt").write_text(pin, "utf-8")
    return root


def _manifest(root: Path, **overrides: object) -> dict:
    """Return a provenance block for `root`, with optional field overrides."""
    block = provenance.provenance(root)
    block.update(overrides)
    return block


class TestSha256File(unittest.TestCase):
    def test_known_vectors(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            empty = Path(tmp) / "empty"
            empty.write_bytes(b"")
            hello = Path(tmp) / "hello"
            hello.write_bytes(b"hello")
            self.assertEqual(
                provenance.sha256_file(empty),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            )
            self.assertEqual(
                provenance.sha256_file(hello),
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            )

    def test_streams_large_input(self) -> None:
        """The digest must not depend on the read-chunk boundary."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "big"
            payload = os.urandom(3 << 20)
            path.write_bytes(payload)
            self.assertEqual(provenance.sha256_file(path), hashlib.sha256(payload).hexdigest())


class TestConverterDigest(unittest.TestCase):
    def test_stable_across_calls(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            self.assertEqual(provenance.converter_digest(root), provenance.converter_digest(root))

    def test_prefixed_and_hex(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            digest = provenance.converter_digest(root)
        self.assertTrue(digest.startswith("sha256:"))
        self.assertEqual(len(digest.removeprefix("sha256:")), 64)

    def test_changes_when_a_source_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            before = provenance.converter_digest(_write_sources(Path(tmp)))
        with tempfile.TemporaryDirectory() as tmp:
            after = provenance.converter_digest(_write_sources(Path(tmp), shard_body="SHARD2"))
        self.assertNotEqual(before, after)

    def test_is_independent_of_location(self) -> None:
        """The cache build copies the sources flat into another repo."""
        with tempfile.TemporaryDirectory() as tmp:
            first = provenance.converter_digest(_write_sources(Path(tmp) / "a", ))
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / "deep" / "b"
            other.mkdir(parents=True)
            second = provenance.converter_digest(_write_sources(other))
        self.assertEqual(first, second)

    def test_names_are_bound_into_the_digest(self) -> None:
        """Swapping two sources' contents must change the digest."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "fse26_convert.py").write_text("A", "utf-8")
            (root / "fse26_convert_tar.py").write_text("B", "utf-8")
            (root / "fse26_shard.py").write_text("C", "utf-8")
            (root / "requirements-fse26.txt").write_text("D", "utf-8")
            first = provenance.converter_digest(root)
            (root / "fse26_convert.py").write_text("B", "utf-8")
            (root / "fse26_convert_tar.py").write_text("A", "utf-8")
            second = provenance.converter_digest(root)
        self.assertNotEqual(first, second)

    def test_ignores_unrelated_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            before = provenance.converter_digest(root)
            (root / "test_fse26_convert.py").write_text("TESTS", "utf-8")
            (root / "README.md").write_text("docs", "utf-8")
            self.assertEqual(provenance.converter_digest(root), before)

    def test_missing_source_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            (root / "fse26_shard.py").unlink()
            with self.assertRaises(FileNotFoundError) as ctx:
                provenance.converter_digest(root)
        self.assertIn("fse26_shard.py", str(ctx.exception))

    def test_runtime_pin_is_bound_into_the_digest(self) -> None:
        """polars writes the Parquet, so a pin bump can move the converted bytes."""
        with tempfile.TemporaryDirectory() as tmp:
            before = provenance.converter_digest(_write_sources(Path(tmp), pin="polars==1.33.1"))
        with tempfile.TemporaryDirectory() as tmp:
            after = provenance.converter_digest(_write_sources(Path(tmp), pin="polars==1.34.0"))
        self.assertNotEqual(before, after)

    def test_missing_runtime_pin_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            (root / "requirements-fse26.txt").unlink()
            with self.assertRaises(FileNotFoundError) as ctx:
                provenance.converter_digest(root)
        self.assertIn("requirements-fse26.txt", str(ctx.exception))

    def test_test_only_tooling_is_not_bound(self) -> None:
        """A coverage bump must not invalidate the cache."""
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            before = provenance.converter_digest(root)
            (root / "requirements-fse26-dev.txt").write_text("coverage==99", "utf-8")
            after = provenance.converter_digest(root)
        self.assertEqual(before, after)


class TestConverterRevision(unittest.TestCase):
    def test_env_wins(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {"GITHUB_SHA": "deadbeef"}):
                self.assertEqual(provenance.converter_revision(Path(tmp)), "deadbeef")

    def test_falls_back_to_git(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(
                    provenance.subprocess, "run", return_value=mock.Mock(stdout="abc123\n")
                ):
                    self.assertEqual(provenance.converter_revision(Path(tmp)), "abc123")

    def test_unknown_when_not_a_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {}, clear=True):
                self.assertEqual(provenance.converter_revision(Path(tmp)), "unknown")

    def test_unknown_when_git_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(provenance.subprocess, "run", side_effect=OSError("no git")):
                    self.assertEqual(provenance.converter_revision(Path(tmp)), "unknown")

    def test_unknown_when_git_returns_blank(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(
                    provenance.subprocess, "run", return_value=mock.Mock(stdout="  \n")
                ):
                    self.assertEqual(provenance.converter_revision(Path(tmp)), "unknown")


class TestBuiltAt(unittest.TestCase):
    def test_is_utc_iso8601(self) -> None:
        stamp = provenance.built_at()
        self.assertTrue(stamp.endswith("Z"), stamp)
        self.assertEqual(stamp.count("."), 0, "second precision keeps the manifest diffable")
        # Round-trips as a real instant.
        from datetime import datetime

        datetime.fromisoformat(stamp.replace("Z", "+00:00"))


class TestProvenance(unittest.TestCase):
    def test_block_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            block = provenance.provenance(root, revision="rev1")
            expected_digest = provenance.converter_digest(root)
        self.assertEqual(
            sorted(block), ["builtAt", "converterDigest", "converterRevision", "schemaVersion"]
        )
        self.assertEqual(block["schemaVersion"], provenance.SCHEMA_VERSION)
        self.assertEqual(block["converterRevision"], "rev1")
        self.assertEqual(block["converterDigest"], expected_digest)

    def test_revision_is_discovered_when_not_supplied(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            with mock.patch.object(provenance, "converter_revision", return_value="auto") as spy:
                block = provenance.provenance(root)
        self.assertEqual(block["converterRevision"], "auto")
        spy.assert_called_once_with(root)


class TestVerifyProvenance(unittest.TestCase):
    def test_matching_manifest_has_no_problems(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            self.assertEqual(provenance.verify_provenance(_manifest(root), root), [])

    def test_digest_mismatch_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            manifest = _manifest(root, converterDigest="sha256:" + "0" * 64)
            problems = provenance.verify_provenance(manifest, root)
        self.assertEqual(len(problems), 1)
        self.assertIn("converterDigest mismatch", problems[0])

    def test_edited_converter_is_reported(self) -> None:
        """The real scenario: the cache was built before a converter fix."""
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            manifest = _manifest(root)
            (root / "fse26_convert.py").write_text("FIXED", "utf-8")
            problems = provenance.verify_provenance(manifest, root)
        self.assertEqual(len(problems), 1)
        self.assertIn("converterDigest mismatch", problems[0])

    def test_missing_digest_is_reported(self) -> None:
        """A manifest predating provenance must fail, not pass vacuously."""
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            manifest = {"totalCases": 1, "shards": []}
            problems = provenance.verify_provenance(manifest, root)
        self.assertEqual(len(problems), 2)
        self.assertIn("schemaVersion", problems[0])
        self.assertIn("no converterDigest", problems[1])

    def test_wrong_schema_version_alone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            manifest = _manifest(root, schemaVersion=1)
            problems = provenance.verify_provenance(manifest, root)
        self.assertEqual(len(problems), 1)
        self.assertIn("schemaVersion", problems[0])


class TestVerifyShards(unittest.TestCase):
    def _manifest_with_shard(self, root: Path) -> tuple[dict, str]:
        payload = b"shard-bytes"
        shard = root / "rcabench-HTTP.tar.gz"
        shard.write_bytes(payload)
        manifest = {
            "totalCases": 1,
            "shards": [
                {
                    "category": "HTTP",
                    "cases": 1,
                    "shard": shard.name,
                    "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                }
            ],
        }
        return manifest, shard.name

    def test_matching_shard_has_no_problems(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _ = self._manifest_with_shard(root)
            self.assertEqual(provenance.verify_shards(manifest, root, ["HTTP"]), [])

    def test_truncated_download_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, name = self._manifest_with_shard(root)
            (root / name).write_bytes(b"short")
            problems = provenance.verify_shards(manifest, root, ["HTTP"])
        self.assertEqual(len(problems), 2)
        self.assertIn("byte count", problems[0])
        self.assertIn("sha256", problems[1])

    def test_same_size_corruption_is_reported(self) -> None:
        """A same-length but different asset must still fail -- size alone is weak."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, name = self._manifest_with_shard(root)
            (root / name).write_bytes(b"SHARD-BYTES")
            problems = provenance.verify_shards(manifest, root, ["HTTP"])
        self.assertEqual(len(problems), 1)
        self.assertIn("sha256", problems[0])

    def test_missing_asset_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, name = self._manifest_with_shard(root)
            (root / name).unlink()
            problems = provenance.verify_shards(manifest, root, ["HTTP"])
        self.assertEqual(len(problems), 1)
        self.assertIn("missing", problems[0])

    def test_category_absent_from_manifest_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _ = self._manifest_with_shard(root)
            problems = provenance.verify_shards(manifest, root, ["HTTP", "Network"])
        self.assertEqual(len(problems), 1)
        self.assertIn("Network", problems[0])

    def test_only_requested_categories_are_checked(self) -> None:
        """A partial download must not be faulted for shards it never fetched."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _ = self._manifest_with_shard(root)
            manifest["shards"].append(
                {"category": "Network", "cases": 1, "shard": "rcabench-Network.tar.gz", "bytes": 1}
            )
            self.assertEqual(provenance.verify_shards(manifest, root, ["HTTP"]), [])

    def test_entry_without_sha256_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _ = self._manifest_with_shard(root)
            del manifest["shards"][0]["sha256"]
            problems = provenance.verify_shards(manifest, root, ["HTTP"])
        self.assertEqual(len(problems), 1)
        self.assertIn("no sha256", problems[0])

    def test_entry_without_bytes_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest, _ = self._manifest_with_shard(root)
            del manifest["shards"][0]["bytes"]
            problems = provenance.verify_shards(manifest, root, ["HTTP"])
        self.assertEqual(len(problems), 1)
        self.assertIn("byte count", problems[0])


class TestMain(unittest.TestCase):
    def test_print_emits_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                rc = provenance.main(["--root", str(root), "--print"])
            payload = json.loads(buffer.getvalue())
            expected_digest = provenance.converter_digest(root)
        self.assertEqual(rc, 0)
        self.assertEqual(payload["converterDigest"], expected_digest)

    def test_check_passes_and_returns_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_sources(root)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(_manifest(root)), "utf-8")

            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                rc = provenance.main(["--root", str(root), "--manifest", str(manifest_path)])

            self.assertEqual(rc, 0)
            self.assertIn("provenance OK", buffer.getvalue())

    def test_check_fails_and_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_sources(root)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps({"totalCases": 0, "shards": []}), "utf-8")

            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                rc = provenance.main(["--root", str(root), "--manifest", str(manifest_path)])

            self.assertEqual(rc, 1)
            self.assertIn("no converterDigest", errors.getvalue())

    def test_check_with_shard_dir_validates_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_sources(root)
            payload = b"shard-bytes"
            (root / "rcabench-HTTP.tar.gz").write_bytes(payload)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    _manifest(
                        root,
                        totalCases=1,
                        shards=[
                            {
                                "category": "HTTP",
                                "cases": 1,
                                "shard": "rcabench-HTTP.tar.gz",
                                "bytes": len(payload),
                                "sha256": hashlib.sha256(payload).hexdigest(),
                            }
                        ],
                    )
                ),
                "utf-8",
            )
            buffer = io.StringIO()
            with contextlib.redirect_stdout(buffer):
                rc = provenance.main(
                    [
                        "--root",
                        str(root),
                        "--manifest",
                        str(manifest_path),
                        "--shard-dir",
                        str(root),
                        "--categories",
                        "HTTP",
                    ]
                )
            self.assertEqual(rc, 0)
            self.assertIn("1 shard", buffer.getvalue())

    def test_requires_manifest_or_print(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                rc = provenance.main(["--root", tmp])
        self.assertEqual(rc, 2)
        self.assertIn("--manifest", errors.getvalue())

    def test_unreadable_manifest_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                rc = provenance.main(["--root", tmp, "--manifest", str(Path(tmp) / "nope.json")])
        self.assertEqual(rc, 1)
        self.assertIn("cannot read manifest", errors.getvalue())

    def test_broken_converter_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with contextlib.redirect_stderr(io.StringIO()):
                rc = provenance.main(["--root", str(root), "--print"])
        self.assertEqual(rc, 1)

    def test_check_against_broken_converter_returns_one(self) -> None:
        """A downloaded manifest must not crash the check when --root is wrong."""
        with tempfile.TemporaryDirectory() as tmp:
            good = Path(tmp) / "good"
            _write_sources(good)
            manifest_path = Path(tmp) / "manifest.json"
            manifest_path.write_text(json.dumps(_manifest(good)), "utf-8")

            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                rc = provenance.main(
                    ["--root", str(Path(tmp) / "empty"), "--manifest", str(manifest_path)]
                )
        self.assertEqual(rc, 1)
        self.assertIn("converter source not found", errors.getvalue())


class TestEntrypoint(unittest.TestCase):
    """The `if __name__ == "__main__"` guard must exit with `main`'s status."""

    def test_print_exits_zero(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = _write_sources(Path(tmp))
            saved = sys.argv
            sys.argv = ["fse26_provenance.py", "--root", str(root), "--print"]
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    with self.assertRaises(SystemExit) as ctx:
                        runpy.run_path(
                            str(Path(__file__).resolve().parent / "fse26_provenance.py"),
                            run_name="__main__",
                        )
            finally:
                sys.argv = saved
        self.assertEqual(ctx.exception.code, 0)

    def test_missing_manifest_exits_with_two(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            saved = sys.argv
            sys.argv = ["fse26_provenance.py", "--root", tmp]
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as ctx:
                        runpy.run_path(
                            str(Path(__file__).resolve().parent / "fse26_provenance.py"),
                            run_name="__main__",
                        )
            finally:
                sys.argv = saved
        self.assertEqual(ctx.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
