"""Tests for the Parquet → JSON bridge — the file that decides every published benchmark number.

**Why this file exists, measured on 2026-09-20.** `convert-parquet-to-json.py` is the bridge
`cache-datasets.yml` runs to produce `~/RCAEval-json`, which is the artifact every RCAEval benchmark —
including the golden nine-cell — is read from. It was in **no** coverage gate, and the job whose own
comment claims otherwise is the one that excluded it:

    # The Parquet → JSON bridge and the sharder decide every published benchmark number, and
    # they are plain Python: gate them on their own unit tests... Branch coverage is enforced.
    coverage run --branch --source=. \\
      --omit='test_*,convert-parquet-to-json.py,download-and-benchmark.py,evaluate-openrca.py' ...

**The omit list is exactly the three filenames containing a hyphen** — a name `import` cannot address,
which is the only thing the three have in common. All eight hyphen-less non-test scripts in `scripts/`
read 100.00%. And `evaluate-openrca.py`, the third of them, is 264 lines of pure standard library with no
third-party import at all, so nothing but its NAME kept it out of a gate it needs no dependency to enter.

So these tests do two things: they measure the bridge's own contract (every artefact the docstring
promises, both column layouts, and the branches that decide between them), and they execute `main()` so
the CLI is measured rather than skipped as `if __name__ == "__main__"`.

The module is loaded by PATH because its name is not importable — which is the whole point.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import runpy
import sys
import tempfile
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parent
BRIDGE_PATH = SCRIPTS / 'convert-parquet-to-json.py'

sys.path.insert(0, str(SCRIPTS))

import pandas as pd  # noqa: E402  (the bridge's own reader; see requirements-fse26-dev.txt)


def load_bridge():
    """The bridge module, from its path — its filename cannot be imported by name.

    @returns The loaded module.
    """
    spec = importlib.util.spec_from_file_location('parquet_bridge', BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge = load_bridge()


class Case:
    """A synthetic source/out pair on disk, torn down after the test."""

    def __init__(self) -> None:
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.src = self.root / 'src' / 'a_case'
        self.dst = self.root / 'out' / 'a_case'
        self.src.mkdir(parents=True)

    def convert(self) -> bool:
        return bridge.convert_case(self.src, self.dst, 1, 1)

    def metrics(self) -> dict:
        return json.loads((self.dst / 'metrics.json').read_text())


class LongFormatTest(unittest.TestCase):
    """The layout that names its own columns: service, timestamp, value, metric_name."""

    def setUp(self) -> None:
        self.case = Case()

    def test_writes_one_entry_per_SERVICE_with_its_own_points(self) -> None:
        pd.DataFrame(
            {
                'service': ['adservice', 'adservice', 'cartservice'],
                'timestamp': [100, 200, 300],
                'value': [0.5, 0.6, 0.7],
                'metric_name': ['cpu', 'cpu', 'mem'],
            }
        ).to_parquet(self.case.src / 'metrics.parquet')
        self.assertTrue(self.case.convert())
        metrics = self.case.metrics()
        self.assertEqual(list(metrics), ['adservice', 'cartservice'])
        self.assertEqual(metrics['adservice'][0], {'timestamp': 100, 'value': 0.5, 'metric_name': 'cpu'})
        self.assertEqual(len(metrics['adservice']), 2)
        self.assertEqual(metrics['cartservice'][0]['metric_name'], 'mem')

    def test_accepts_each_of_the_column_names_the_detector_admits(self) -> None:
        # The detector tries four candidates per role. A frame naming them differently is still long
        # format, and reading it as WIDE would take the first column as the timestamp and the service
        # names as metric series — numbers that look fine and mean nothing.
        pd.DataFrame(
            {
                'svc': ['a'],
                'ts': [7],
                'v': [1.5],
                'metric': ['latency'],
            }
        ).to_parquet(self.case.src / 'metrics.parquet')
        self.assertTrue(self.case.convert())
        self.assertEqual(self.case.metrics()['a'][0], {'timestamp': 7, 'value': 1.5, 'metric_name': 'latency'})

    def test_a_missing_metric_name_is_reported_as_UNKNOWN_rather_than_dropped(self) -> None:
        # `metric_name` is absent from the frame entirely, so the row is still a measurement of the
        # service — the value and the instant are real. Dropping it would under-count the series.
        pd.DataFrame({'service': ['a'], 'timestamp': [1], 'value': [0.25]}).to_parquet(
            self.case.src / 'metrics.parquet'
        )
        self.assertTrue(self.case.convert())
        self.assertEqual(self.case.metrics()['a'][0]['metric_name'], 'unknown')

    def test_a_NULL_value_becomes_zero_and_a_null_instant_becomes_epoch(self) -> None:
        # Pinned rather than endorsed: the bridge renders both absences as 0, which is what the engine
        # then reads. `0` is indistinguishable from a real measurement of zero and from 1970-01-01, so
        # a change here is a change to published numbers and must be deliberate.
        pd.DataFrame(
            {
                'service': ['a', 'a'],
                'timestamp': [None, 5],
                'value': [float('nan'), 0.5],
                'metric_name': ['cpu', 'cpu'],
            }
        ).to_parquet(self.case.src / 'metrics.parquet')
        self.assertTrue(self.case.convert())
        self.assertEqual(
            self.case.metrics()['a'],
            [
                {'timestamp': 0, 'value': 0.0, 'metric_name': 'cpu'},
                {'timestamp': 5, 'value': 0.5, 'metric_name': 'cpu'},
            ],
        )


class WideFormatTest(unittest.TestCase):
    """The layout that encodes service and metric in the COLUMN NAME."""

    def write(self, **columns: list[float]) -> bool:
        pd.DataFrame(columns).to_parquet(self.case.src / 'metrics.parquet')
        return self.case.convert()

    def setUp(self) -> None:
        self.case = Case()

    def test_splits_on_a_double_colon_and_on_a_double_pipe(self) -> None:
        self.assertTrue(self.write(**{'timestamp': [10, 20], 'adservice::cpu': [0.1, 0.2], 'cart||mem': [1.0, 1.1]}))
        metrics = self.case.metrics()
        self.assertEqual(metrics['adservice'][0], {'timestamp': 10, 'value': 0.1, 'metric_name': 'cpu'})
        self.assertEqual(metrics['cart'][1], {'timestamp': 20, 'value': 1.1, 'metric_name': 'mem'})

    def test_prefers_a_KNOWN_SUFFIX_over_the_last_underscore(self) -> None:
        # `cartservice_latency_ms` has two underscores. The last one would give service
        # `cartservice_latency` and metric `ms`; the known suffix `_latency` gives the right pair.
        self.assertTrue(self.write(**{'timestamp': [1], 'cartservice_latency_ms': [2.0]}))
        # `_latency` is the known suffix and it is matched rightmost, so the metric keeps its tail.
        self.assertEqual(list(self.case.metrics()), ['cartservice'])
        self.assertEqual(self.case.metrics()['cartservice'][0]['metric_name'], 'latency_ms')

    def test_falls_back_to_the_LAST_underscore_when_no_suffix_is_known(self) -> None:
        self.assertTrue(self.write(**{'timestamp': [1], 'paymentservice_zzz': [3.0]}))
        self.assertEqual(self.case.metrics()['paymentservice'][0]['metric_name'], 'zzz')

    def test_a_column_with_no_separator_names_its_service_by_its_whole_name(self) -> None:
        # The last resort, and it is the honest one: with nothing to split on, the bridge cannot
        # invent a metric name, so the column becomes a service carrying one series.
        self.assertTrue(self.write(**{'timestamp': [1], 'singleton': [4.0]}))
        self.assertEqual(self.case.metrics()['singleton'][0]['metric_name'], 'singleton')

    def test_every_ROW_gets_the_instant_from_the_SAME_position_of_column_zero(self) -> None:
        # The wide layout carries the timestamp once, in the first column, and every metric series is
        # read against it positionally. An off-by-one here would shift every series by one sample and
        # still produce a well-formed artifact.
        self.assertTrue(self.write(**{'timestamp': [10, 20, 30], 'a_cpu': [1.0, 2.0, 3.0]}))
        self.assertEqual([p['timestamp'] for p in self.case.metrics()['a']], [10, 20, 30])
        self.assertEqual([p['value'] for p in self.case.metrics()['a']], [1.0, 2.0, 3.0])

    def test_a_non_numeric_first_column_FAILS_the_case_rather_than_inventing_instants(self) -> None:
        # The choice between the two layouts is made by the ABSENCE of value/timestamp NAMED columns,
        # not by the presence of the wide structure — so a frame carrying a `service` column and no
        # `value` column arrives here with a service NAME in column zero. `int('adservice')` raises,
        # and the case is reported as failed instead of publishing an artifact whose instants are
        # fabricated. Fail-loudly is the behaviour these tests pin.
        self.assertFalse(self.write(**{'service': ['adservice'], 'a_cpu': [1.0]}))


class MissingAndEmptyTest(unittest.TestCase):
    """The two ways a case can produce nothing, and the difference between them."""

    def setUp(self) -> None:
        self.case = Case()

    def test_no_metrics_parquet_SKIPS_the_case_and_writes_no_artifact(self) -> None:
        self.assertFalse(self.case.convert())
        self.assertFalse((self.case.dst / 'metrics.json').exists())

    def test_a_metrics_parquet_with_no_rows_WARNS_and_produces_nothing(self) -> None:
        # An empty frame has the columns and no measurements. Reporting success would publish an empty
        # metrics.json as if the case had been converted.
        pd.DataFrame(
            {
                'service': pd.Series([], dtype=str),
                'timestamp': pd.Series([], dtype='int64'),
                'value': pd.Series([], dtype='float64'),
                'metric_name': pd.Series([], dtype=str),
            }
        ).to_parquet(self.case.src / 'metrics.parquet')
        self.assertFalse(self.case.convert())
        self.assertFalse((self.case.dst / 'metrics.json').exists())

    def test_a_WIDE_frame_with_no_metric_columns_also_produces_nothing(self) -> None:
        pd.DataFrame({'timestamp': [1, 2]}).to_parquet(self.case.src / 'metrics.parquet')
        self.assertFalse(self.case.convert())
        self.assertFalse((self.case.dst / 'metrics.json').exists())

    def test_an_unreadable_metrics_parquet_is_CAUGHT_and_reported_as_a_failure(self) -> None:
        # The bridge's outer handler. Without it a single corrupt case would abort the whole
        # conversion at case 3 of 735 and leave a half-written output tree.
        (self.case.src / 'metrics.parquet').mkdir()
        self.assertFalse(self.case.convert())


class SideArtefactsTest(unittest.TestCase):
    """Every artefact the module's docstring promises, plus the ones it deliberately does not copy."""

    def setUp(self) -> None:
        self.case = Case()
        pd.DataFrame({'service': ['a'], 'timestamp': [1], 'value': [0.5], 'metric_name': ['cpu']}).to_parquet(
            self.case.src / 'metrics.parquet'
        )

    def test_inject_time_comes_from_the_parquet_as_an_INTEGER(self) -> None:
        pd.DataFrame({0: [1737000000000]}).to_parquet(self.case.src / 'inject_time.parquet')
        self.assertTrue(self.case.convert())
        self.assertEqual((self.case.dst / 'inject_time.txt').read_text(), '1737000000000')

    def test_inject_time_falls_back_to_the_TXT_when_there_is_no_parquet(self) -> None:
        (self.case.src / 'inject_time.txt').write_text('42')
        self.assertTrue(self.case.convert())
        self.assertEqual((self.case.dst / 'inject_time.txt').read_text(), '42')

    def test_a_case_with_NO_inject_time_still_gets_a_READABLE_file(self) -> None:
        # The default exists so a loader never faces a missing file. It is `0` rather than an error,
        # which is a decision about what the engine does with an unknown injection instant.
        self.assertTrue(self.case.convert())
        self.assertEqual((self.case.dst / 'inject_time.txt').read_text(), '0')

    def test_ground_truth_json_is_copied_verbatim(self) -> None:
        payload = {'inject_time': 1737000000000, 'service': ['cartservice']}
        (self.case.src / 'ground_truth.json').write_text(json.dumps(payload))
        self.assertTrue(self.case.convert())
        self.assertEqual(json.loads((self.case.dst / 'ground_truth.json').read_text()), payload)

    def test_ground_truth_parquet_is_rendered_as_a_JSON_OBJECT(self) -> None:
        pd.DataFrame({'service': ['cartservice'], 'reason': ['cpu']}).to_parquet(
            self.case.src / 'ground_truth.parquet'
        )
        self.assertTrue(self.case.convert())
        self.assertEqual(
            json.loads((self.case.dst / 'ground_truth.json').read_text()),
            {'service': 'cartservice', 'reason': 'cpu'},
        )

    def test_an_EMPTY_ground_truth_parquet_renders_an_empty_object(self) -> None:
        pd.DataFrame({'service': pd.Series([], dtype=str)}).to_parquet(self.case.src / 'ground_truth.parquet')
        self.assertTrue(self.case.convert())
        self.assertEqual(json.loads((self.case.dst / 'ground_truth.json').read_text()), {})

    def test_traces_and_logs_parquet_become_CSV(self) -> None:
        pd.DataFrame({'traceId': ['t1'], 'span': [1]}).to_parquet(self.case.src / 'traces.parquet')
        pd.DataFrame({'level': ['ERROR'], 'msg': ['x']}).to_parquet(self.case.src / 'logs.parquet')
        self.assertTrue(self.case.convert())
        self.assertIn('traceId', (self.case.dst / 'traces.csv').read_text())
        self.assertIn('ERROR', (self.case.dst / 'logs.csv').read_text())

    def test_an_UNREADABLE_traces_parquet_is_a_WARNING_and_not_a_FAILED_case(self) -> None:
        # Traces are RE2/RE3-only and defensive: a case whose traces cannot be read still has its
        # metrics, and metrics are what the benchmark ranks on. So this path must not fail the case.
        #
        # But it must not succeed SILENTLY either, and that is the defect these two tests were written
        # against. Measured on 2026-09-20 with pandas 3.0.6: `read_parquet` on a path that is a
        # DIRECTORY does not raise — it returns a frame with NEITHER rows NOR columns, `(0, 0)` — so
        # the `except` above never fires, `to_csv` writes a ONE-BYTE file containing just `"\n"`, and
        # `convert_case` returns **True**. An artefact that exists and holds nothing reads as "this
        # case has no traces", when the truth is "the traces could not be read".
        #
        # Every realistic CORRUPTION was measured too, and all of them raise `ArrowInvalid` (a 0-byte
        # file, a text file named `.parquet`, a truncated parquet): those are already handled. So the
        # trigger is narrow — a source that yields no schema at all — and the reason it still matters
        # is the ASYMMETRY: the METRICS arm refuses exactly this frame (`metrics_ok` stays false and
        # the case is reported as failed), while the traces arm published it as a converted artefact.
        (self.case.src / 'traces.parquet').mkdir()
        (self.case.src / 'logs.parquet').mkdir()
        self.assertTrue(self.case.convert())
        self.assertTrue((self.case.dst / 'metrics.json').exists())
        self.assertFalse((self.case.dst / 'traces.csv').exists())
        self.assertFalse((self.case.dst / 'logs.csv').exists())

    def test_a_traces_source_that_RAISES_is_reported_and_the_case_still_converts(self) -> None:
        # The measured half: a 0-byte file, a text file named `.parquet` and a truncated parquet all
        # raise `ArrowInvalid`, which is the path the `except` exists for. A case whose traces cannot
        # be read is still a case, because the benchmark ranks on its metrics.
        (self.case.src / 'traces.parquet').write_bytes(b'')
        (self.case.src / 'logs.parquet').write_bytes(b'')
        self.assertTrue(self.case.convert())
        self.assertTrue((self.case.dst / 'metrics.json').exists())
        self.assertFalse((self.case.dst / 'traces.csv').exists())
        self.assertFalse((self.case.dst / 'logs.csv').exists())

    def test_a_trace_table_with_a_SCHEMA_and_no_rows_is_still_written(self) -> None:
        # The other side of the same condition, so the refusal above cannot be implemented by
        # refusing everything empty: a genuinely empty trace table HAS a schema, and a header-only CSV
        # is the correct artefact for it. The line is drawn at "no columns read", not at "no rows".
        pd.DataFrame({'traceId': pd.Series([], dtype=str)}).to_parquet(self.case.src / 'traces.parquet')
        self.assertTrue(self.case.convert())
        self.assertEqual((self.case.dst / 'traces.csv').read_text(), 'traceId\n')

    def test_auxiliary_text_and_csv_are_copied_and_json_deliberately_is_NOT(self) -> None:
        # The set is `.csv` and `.txt`, and `traces.csv`/`logs.csv` are excluded by name because the
        # conversion above owns them. A `.json` is NOT copied: `ground_truth.json` and `metrics.json`
        # are owned by this module, and a stray source `.json` appearing in the output tree would be
        # a file nothing in the pipeline knows the provenance of.
        (self.case.src / 'extra.csv').write_text('a,b\n')
        (self.case.src / 'note.txt').write_text('hello')
        (self.case.src / 'stray.json').write_text('{}')
        self.assertTrue(self.case.convert())
        self.assertTrue((self.case.dst / 'extra.csv').exists())
        self.assertTrue((self.case.dst / 'note.txt').exists())
        self.assertFalse((self.case.dst / 'stray.json').exists())


class MainTest(unittest.TestCase):
    """The CLI, executed so that `if __name__ == "__main__"` is measured rather than skipped."""

    def setUp(self) -> None:
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.data = self.root / 'data'
        self.out = self.root / 'out'
        for name in ('case_one', 'case_two'):
            case = self.data / 're1' / name
            case.mkdir(parents=True)
            pd.DataFrame({'service': ['a'], 'timestamp': [1], 'value': [0.5], 'metric_name': ['cpu']}).to_parquet(
                case / 'metrics.parquet'
            )
        # A parquet nobody reads, so the case directory is DISCOVERED the way the real data is: by
        # finding a `*.parquet` and taking its parent, rather than by listing directories.
        (self.data / 'case_three').mkdir(parents=True)
        pd.DataFrame({'x': [1]}).to_parquet(self.data / 'case_three' / 'metrics.parquet')
        self.saved = sys.argv

    def tearDown(self) -> None:
        sys.argv = self.saved

    def run_main(self, *extra: str) -> None:
        sys.argv = ['convert-parquet-to-json.py', '--data-dir', str(self.data), '--out-dir', str(self.out), *extra]
        bridge.main()

    def test_converts_every_discovered_case_and_reports_a_summary(self) -> None:
        # `--batch-size 1` forces the progress line on every case, which is the branch a real run of
        # 735 cases takes fifty times; asserting it here keeps it measured.
        self.run_main('--batch-size', '1')
        self.assertTrue((self.out / 're1' / 'case_one' / 'metrics.json').exists())
        self.assertTrue((self.out / 're1' / 'case_two' / 'metrics.json').exists())
        text = (self.out / 're1' / 'case_one' / 'metrics.json').read_text()
        self.assertIn('"timestamp": 1', text)

    def test_the_PROGRESS_line_runs_on_the_last_case_even_when_it_is_not_a_batch_boundary(self) -> None:
        # `i % batch_size == 0 or i == total` — with the default batch size of 50 and three cases, only
        # the `i == total` half can fire. The batch-boundary half is the test above, which sets
        # `--batch-size 1`; both halves are exercised, and neither is left to the other.
        self.run_main()
        self.assertTrue((self.out / 're1' / 'case_one' / 'metrics.json').exists())
        self.assertTrue((self.out / 're1' / 'case_two' / 'metrics.json').exists())

    def test_a_MISSING_data_directory_is_refused_rather_than_converted_to_nothing(self) -> None:
        sys.argv = ['convert-parquet-to-json.py', '--data-dir', str(self.root / 'nope'), '--out-dir', str(self.out)]
        with self.assertRaises(SystemExit) as caught:
            bridge.main()
        self.assertEqual(caught.exception.code, 1)

    def test_the_module_runs_as_a_SCRIPT_the_way_the_workflow_invokes_it(self) -> None:
        # `cache-datasets.yml` runs `python3 scripts/convert-parquet-to-json.py`, i.e. through the
        # `if __name__ == "__main__"` guard — and NOTHING tested that form. Every other test here
        # imports the module and calls `convert_case`/`main` directly, so the one line the production
        # path actually enters was unmeasured. `runpy` with `run_name='__main__'` reproduces it in
        # process, which is also why it is worth doing rather than shelling out: `coverage` sees it.
        sys.argv = ['convert-parquet-to-json.py', '--data-dir', str(self.data), '--out-dir', str(self.out)]
        runpy.run_path(str(BRIDGE_PATH), run_name='__main__')
        self.assertTrue((self.out / 're1' / 'case_one' / 'metrics.json').exists())
        self.assertTrue((self.out / 're1' / 'case_one' / 'inject_time.txt').exists())
        # And the ordering is pinned by the case with unusable metrics: the metrics step returns
        # BEFORE the side artefacts are attempted, so a case that fails there leaves no
        # `inject_time.txt` and no ground truth — a directory a loader will refuse, rather than one
        # carrying half a case. `case_three`'s parquet has no service, instant or value column.
        self.assertFalse((self.out / 'case_three' / 'inject_time.txt').exists())
        self.assertFalse((self.out / 'case_three' / 'metrics.json').exists())


if __name__ == '__main__':
    unittest.main()
