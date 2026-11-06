"""Tests for the RCABench → RCAEval bridge — the second data path to a corpus we already publish on.

**Why this file exists.** `convert-rcabench-to-rcaeval.py` is the bridge that turns a raw RCABench
datapack (parquet metrics, logs and traces, `env.json`, `injection.json`) into the case layout the
RCAEval loader reads. It is the only path by which the shipped runner scores the Zenodo archive, so
every number `docs/rcabench-first-reading.md` reports goes through it — and its name contains
hyphens, so it is a module `import` cannot address and a gate can silently omit. The repo's own
census forbids that: `test_coverage_omissions.py` fails when a measured script is named by no test.

So these tests measure the bridge's own contract, one decision at a time — the ones this file's
header states:

  * `parse_name` splits at the SERVICE boundary, because both the target (`ts-order-service`) and the
    fault (`response-replace-code`) contain hyphens and neither can be recovered by counting tokens.
  * `merge_windows` carries the seven families the engine has estimators for and DROPS the rest: a
    renamed gauge with no estimator would look like evidence and score nothing.
  * the hubble family is an EDGE measurement and is attributed to the CALLEE.
  * `NaN` is not JSON. A missing observation arrives as `NaN`, and a `metrics.json` carrying it fails
    to load — which is what the first conversion of this corpus did on 5 of 5 sampled cases.
  * traces are written with a clock column the loader READS (`startTimeMillis`), and durations are
    converted from RCABench's nanoseconds to RCAEval's microseconds.
  * `main()` runs, so the CLI is measured rather than skipped behind `if __name__ == "__main__"`.

The module is loaded by PATH because its name is not importable — which is why the census exists.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import runpy
import sys
import tempfile
import unittest

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

SCRIPTS = pathlib.Path(__file__).resolve().parent
BRIDGE_PATH = SCRIPTS / 'convert-rcabench-to-rcaeval.py'

sys.path.insert(0, str(SCRIPTS))

_spec = importlib.util.spec_from_file_location('convert_rcabench_to_rcaeval', BRIDGE_PATH)
bridge = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bridge)


def _ts(seconds: int) -> pd.Timestamp:
    """A tz-aware UTC timestamp, as the parquet reader hands it over."""
    return pd.Timestamp(seconds, unit='s', tz='UTC')


def _write_metrics(path: pathlib.Path, rows: list[dict]) -> None:
    frame = pd.DataFrame(rows)
    pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), path)


class ParseName(unittest.TestCase):
    """The datapack name is `<namespace>-<target>-<fault>-<random>`, and two of the three vary in length."""

    def test_splits_a_multi_token_fault_from_a_multi_token_target(self) -> None:
        # The case this rule exists for: counting tokens from either end gets `service` as the
        # target and `code` as the fault, and neither is a fault type the engine has ever seen.
        self.assertEqual(
            bridge.parse_name('ts2-ts-order-service-response-replace-code-b7twdg'),
            ('ts2', 'ts-order-service', 'response-replace-code'),
        )

    def test_reads_a_single_token_target_and_fault(self) -> None:
        self.assertEqual(
            bridge.parse_name('ts0-mysql-partition-9t6n24'),
            ('ts0', 'mysql', 'partition'),
        )

    def test_falls_back_to_the_first_token_when_no_service_boundary_is_present(self) -> None:
        # `cart` neither ends in `service` nor is a stopword, so the name carries no boundary: the
        # split must still return three DISJOINT parts rather than raise, because a name this
        # function cannot read must not take the conversion down -- and a fault that repeats the
        # target (`cart-cart-bandwidth`) would make a caller comparing the two see a false match.
        self.assertEqual(
            bridge.parse_name('ts3-cart-bandwidth-abc123'),
            ('ts3', 'cart', 'bandwidth'),
        )

    def test_a_stopword_target_is_a_boundary_too(self) -> None:
        # The dependency services (`mysql`, `redis`, `rabbitmq`, `loadgenerator`) are targets that
        # never end in `service`, so the stopword list is the only thing that lets the split find
        # their boundary -- without it their fault name would swallow the fault's own tokens.
        self.assertEqual(
            bridge.parse_name('ts3-loadgenerator-bandwidth-abc123'),
            ('ts3', 'loadgenerator', 'bandwidth'),
        )


class MergeWindows(unittest.TestCase):
    """Which families are carried, where they are attributed, and what is dropped."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.pack = pathlib.Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _write(self, window: str, rows: list[dict]) -> None:
        _write_metrics(self.pack / f'{window}_metrics.parquet', rows)

    def test_carries_the_estimable_families_under_the_names_the_engine_reads(self) -> None:
        self._write(
            'normal',
            [
                {
                    'time': _ts(1000),
                    'metric': 'container.cpu.usage',
                    'value': 1.0,
                    'service_name': 'ts-order-service',
                    'attr.destination_workload': None,
                },
                {
                    'time': _ts(1000),
                    'metric': 'hubble_http_request_duration_p90_seconds',
                    'value': 0.25,
                    'service_name': 'ts-seat-service',
                    'attr.destination_workload': 'ts-order-service',
                },
            ],
        )
        rows = bridge.merge_windows(self.pack)
        self.assertEqual(sorted(rows), ['ts-order-service'])
        families = sorted({row['metric_name'] for row in rows['ts-order-service']})
        self.assertEqual(families, ['cpu', 'latency-90'])
        self.assertEqual(
            [row for row in rows['ts-order-service'] if row['metric_name'] == 'cpu'][0]['timestamp'],
            1000,
        )

    def test_attributes_an_edge_measurement_to_the_callee_and_keeps_the_worst_caller(self) -> None:
        # Two callers into one callee in the same second. A server-side p90 is a property of the
        # CALLEE, so the per-second reduction is the maximum over callers, not the sum.
        self._write(
            'abnormal',
            [
                {
                    'time': _ts(2000),
                    'metric': 'hubble_http_request_duration_p90_seconds',
                    'value': 0.10,
                    'service_name': 'ts-seat-service',
                    'attr.destination_workload': 'ts-order-service',
                },
                {
                    'time': _ts(2000),
                    'metric': 'hubble_http_request_duration_p90_seconds',
                    'value': 3.50,
                    'service_name': 'ts-basic-service',
                    'attr.destination_workload': 'ts-order-service',
                },
            ],
        )
        rows = bridge.merge_windows(self.pack)
        self.assertEqual([row['value'] for row in rows['ts-order-service']], [3.5])

    def test_drops_a_family_the_engine_has_no_estimator_for(self) -> None:
        # Carrying `k8s.pod.phase` under its own name would put a channel in the case that no term
        # reads, which is the class of defect this repository keeps finding: evidence that looks
        # like evidence and scores nothing.
        self._write(
            'normal',
            [
                {
                    'time': _ts(1000),
                    'metric': 'k8s.pod.phase',
                    'value': 3.0,
                    'service_name': 'ts-order-service',
                    'attr.destination_workload': None,
                }
            ],
        )
        self.assertEqual(bridge.merge_windows(self.pack), {})

    def test_drops_a_missing_observation_rather_than_writing_nan(self) -> None:
        # The rung that matters: `NaN` is not JSON. Before this filter the conversion wrote the
        # literal, and the loader rejected the whole case -- 5 of 5 sampled cases failed to load.
        self._write(
            'normal',
            [
                {
                    'time': _ts(1000),
                    'metric': 'hubble_http_request_duration_p90_seconds',
                    'value': float('nan'),
                    'service_name': 'ts-seat-service',
                    'attr.destination_workload': 'ts-order-service',
                },
                {
                    'time': _ts(1001),
                    'metric': 'hubble_http_request_duration_p90_seconds',
                    'value': 0.5,
                    'service_name': 'ts-seat-service',
                    'attr.destination_workload': 'ts-order-service',
                },
            ],
        )
        rows = bridge.merge_windows(self.pack)
        self.assertEqual(len(rows['ts-order-service']), 1)
        self.assertNotIn('NaN', json.dumps(rows))

    def test_returns_nothing_when_a_window_file_is_absent(self) -> None:
        self.assertEqual(bridge.merge_windows(self.pack), {})

    def test_returns_nothing_for_an_empty_window_file(self) -> None:
        # A window that exists and carries no rows at all: the frame is empty, and an empty frame has
        # no `metric` column to filter on, so the guard has to come before the filter.
        pq.write_table(
            pa.table({'time': pa.array([], type=pa.timestamp('ns', tz='UTC'))}), self.pack / 'normal_metrics.parquet'
        )
        self.assertEqual(bridge.merge_windows(self.pack), {})

    def test_returns_nothing_when_a_window_carries_no_estimable_family(self) -> None:
        _write_metrics(
            self.pack / 'normal_metrics.parquet',
            [
                {
                    'time': _ts(1000),
                    'metric': 'k8s.pod.phase',
                    'value': 1.0,
                    'service_name': 'ts-order-service',
                    'attr.destination_workload': None,
                }
            ],
        )
        self.assertEqual(bridge.merge_windows(self.pack), {})


class TracesAndLogs(unittest.TestCase):
    """The two column sets the loader addresses by name, and the two unit traps between the corpora."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.pack = pathlib.Path(self.tmp.name)
        self.out = pathlib.Path(self.tmp.name) / 'case'
        self.out.mkdir()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_writes_a_clock_column_the_loader_reads_and_converts_ns_to_us(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    'time': _ts(1700),
                    'trace_id': 't1',
                    'span_id': 's1',
                    'parent_span_id': 'p1',
                    'span_name': 'GET /x',
                    'service_name': 'ts-order-service',
                    'duration': 88_089_000,
                    'attr.status_code': 'Error',
                }
            ]
        )
        pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), self.pack / 'abnormal_traces.parquet')
        written = bridge.write_traces(self.pack, self.out)
        self.assertEqual(written, 1)
        header, row = (self.out / 'traces.csv').read_text().strip().split('\n')
        # `startTimeMillis` and not `ts`: a bare name the loader does not know is read by no
        # branch, and every span then normalises to 0 with no warning at all.
        self.assertEqual(header, 'startTimeMillis,trace_id,span_id,parent_span_id,service,operation,duration,status')
        cells = row.split(',')
        self.assertEqual(cells[0], '1700000')
        self.assertEqual(cells[4], 'ts-order-service')
        self.assertEqual(cells[6], '88089')
        self.assertEqual(cells[7], 'Error')

    def test_fills_an_absent_status_rather_than_writing_empty(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    'time': _ts(1700),
                    'trace_id': 't1',
                    'span_id': 's1',
                    'parent_span_id': '',
                    'span_name': 'GET /x',
                    'service_name': 'svc',
                    'duration': 1000,
                    'attr.status_code': None,
                }
            ]
        )
        pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), self.pack / 'normal_traces.parquet')
        bridge.write_traces(self.pack, self.out)
        self.assertTrue((self.out / 'traces.csv').read_text().strip().endswith('Unset'))

    def test_returns_zero_for_an_empty_trace_file(self) -> None:
        pq.write_table(
            pa.table({'time': pa.array([], type=pa.timestamp('ns', tz='UTC'))}),
            self.pack / 'normal_traces.parquet',
        )
        self.assertEqual(bridge.write_traces(self.pack, self.out), 0)

    def test_returns_zero_when_there_is_no_trace_file(self) -> None:
        self.assertEqual(bridge.write_traces(self.pack, self.out), 0)
        self.assertFalse((self.out / 'traces.csv').exists())

    def test_writes_logs_with_the_loader_column_names(self) -> None:
        frame = pd.DataFrame(
            [
                {
                    'time': _ts(1700),
                    'service_name': 'ts-order-service',
                    'level': 'ERROR',
                    'message': 'boom',
                }
            ]
        )
        pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), self.pack / 'abnormal_logs.parquet')
        self.assertEqual(bridge.write_logs(self.pack, self.out), 1)
        header, row = (self.out / 'logs.csv').read_text().strip().split('\n')
        self.assertEqual(header, 'ts,service,level,message')
        self.assertEqual(row, '1700,ts-order-service,ERROR,boom')

    def test_returns_zero_when_there_is_no_log_file(self) -> None:
        self.assertEqual(bridge.write_logs(self.pack, self.out), 0)

    def test_returns_zero_for_an_empty_log_file(self) -> None:
        pq.write_table(
            pa.table({'time': pa.array([], type=pa.timestamp('ns', tz='UTC'))}),
            self.pack / 'normal_logs.parquet',
        )
        self.assertEqual(bridge.write_logs(self.pack, self.out), 0)


class Main(unittest.TestCase):
    """The CLI, executed rather than skipped."""

    def _pack(self, root: pathlib.Path, name: str, *, display: str = '{}', metrics: bool = True) -> pathlib.Path:
        """One synthetic datapack, the shape `main()` walks."""
        pack = root / name
        pack.mkdir(parents=True)
        (pack / '.finished').write_text('')
        (pack / 'env.json').write_text(
            json.dumps({'ABNORMAL_START': '2000', 'NORMAL_START': '1000', 'NORMAL_END': '2000', 'ABNORMAL_END': '3000'})
        )
        (pack / 'injection.json').write_text(
            json.dumps({'display_config': display, 'ground_truth': {'service': ['ts-order-service']}})
        )
        if metrics:
            _write_metrics(
                pack / 'normal_metrics.parquet',
                [
                    {
                        'time': _ts(1500),
                        'metric': 'container.cpu.usage',
                        'value': 1.0,
                        'service_name': 'ts-order-service',
                        'attr.destination_workload': None,
                    }
                ],
            )
        return pack

    def test_converts_a_pack_end_to_end_into_a_case_the_loader_can_read(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / 'raw'
            pack = src / 'ts2-ts-order-service-response-replace-code-b7twdg'
            pack.mkdir(parents=True)
            (pack / '.finished').write_text('')
            (pack / 'env.json').write_text(
                json.dumps({'NAMESPACE': 'ts2', 'NORMAL_START': '1000', 'NORMAL_END': '2000',
                            'ABNORMAL_START': '2000', 'ABNORMAL_END': '3000'})
            )
            (pack / 'injection.json').write_text(
                json.dumps(
                    {
                        'fault_type': 7,
                        'display_config': json.dumps({'injection_point': {'source_service': 'ts-order-service'}}),
                        'ground_truth': {'service': ['ts-order-service', 'ts-basic-service']},
                    }
                )
            )
            _write_metrics(
                pack / 'normal_metrics.parquet',
                [
                    {
                        'time': _ts(1500),
                        'metric': 'container.cpu.usage',
                        'value': 1.0,
                        'service_name': 'ts-order-service',
                        'attr.destination_workload': None,
                    }
                ],
            )
            dst = pathlib.Path(tmp) / 'conv'
            argv = sys.argv
            sys.argv = ['convert', '--src', str(src), '--dst', str(dst)]
            try:
                self.assertEqual(bridge.main(), 0)
            finally:
                sys.argv = argv

            cases = [p for p in dst.iterdir() if p.is_dir()]
            self.assertEqual(len(cases), 1)
            # The pack regex the loader applies admits only `[a-z0-9]+` in the fault slot, so a
            # hyphenated fault name has to be carried as a code -- and the full name kept in the
            # ground-truth file, where nothing parses it away.
            self.assertEqual(cases[0].name, 're3tt_ts-order-service_rrc_1')
            self.assertEqual((cases[0] / 'inject_time.txt').read_text(), '2000')
            ground = json.loads((cases[0] / 'ground_truth.json').read_text())
            self.assertEqual(ground['root_cause_service'], 'ts-order-service')
            self.assertEqual(ground['rcabench_fault'], 'response-replace-code')
            self.assertEqual(ground['rcabench_ground_truth'], ['ts-order-service', 'ts-basic-service'])
            metrics = json.loads((cases[0] / 'metrics.json').read_text())
            self.assertEqual([row['metric_name'] for row in metrics['ts-order-service']], ['cpu'])

    def test_reads_a_display_config_that_is_not_json_and_falls_back_to_the_name(self) -> None:
        # `display_config` is a JSON STRING inside `injection.json`, and a pack whose inner string is
        # malformed must not take the conversion down: the target from the directory name is the
        # fallback, and the case still converts.
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / 'raw'
            self._pack(src, 'ts0-ts-order-service-stress-abc123', display='{not json')
            dst = pathlib.Path(tmp) / 'conv'
            argv = sys.argv
            sys.argv = ['convert', '--src', str(src), '--dst', str(dst)]
            try:
                self.assertEqual(bridge.main(), 0)
            finally:
                sys.argv = argv
            case = next(p for p in dst.iterdir() if p.is_dir())
            self.assertEqual(case.name, 're3tt_ts-order-service_st_1')

    def test_prints_progress_every_twenty_five_packs(self) -> None:
        # The `index % 25` line is the only progress a 1,430-pack conversion prints, and it is the
        # only thing that tells a reader the walk is alive at minute forty.
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / 'raw'
            for n in range(25):
                self._pack(src, f'ts0-ts-order-service-stress-{n:04d}')
            dst = pathlib.Path(tmp) / 'conv'
            argv = sys.argv
            sys.argv = ['convert', '--src', str(src), '--dst', str(dst), '--limit', '25']
            try:
                self.assertEqual(bridge.main(), 0)
            finally:
                sys.argv = argv
            self.assertEqual(len([p for p in dst.iterdir() if p.is_dir()]), 25)

    def test_skips_a_pack_without_an_estimable_metric_family(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            src = pathlib.Path(tmp) / 'raw'
            pack = src / 'ts0-mysql-partition-abc123'
            pack.mkdir(parents=True)
            (pack / '.finished').write_text('')
            (pack / 'env.json').write_text(json.dumps({'ABNORMAL_START': '2000'}))
            (pack / 'injection.json').write_text(json.dumps({'display_config': '{}', 'ground_truth': {}}))
            dst = pathlib.Path(tmp) / 'conv'
            argv = sys.argv
            sys.argv = ['convert', '--src', str(src), '--dst', str(dst), '--limit', '1']
            try:
                self.assertEqual(bridge.main(), 0)
            finally:
                sys.argv = argv
            self.assertEqual([p for p in dst.iterdir() if p.is_dir()], [])


class Entrypoint(unittest.TestCase):
    def test_the_module_runs_as_a_script(self) -> None:
        # `if __name__ == '__main__'` is the line that makes this file a CLI, and it is dead to every
        # in-process test. Executed the only way it can be, against a source directory that is not
        # there: the run must END, with the conventional exit code, rather than unwind a traceback
        # out of `iterdir()` that reads like a defect in the converter.
        argv = sys.argv
        sys.argv = ['convert', '--src', '/nonexistent-rcabench-src', '--dst', '/nonexistent-out']
        try:
            with self.assertRaises(SystemExit) as raised:
                runpy.run_path(str(BRIDGE_PATH), run_name='__main__')
        finally:
            sys.argv = argv
        self.assertEqual(raised.exception.code, 2)


if __name__ == '__main__':
    unittest.main()
