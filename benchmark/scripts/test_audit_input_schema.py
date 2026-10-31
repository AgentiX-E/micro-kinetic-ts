#!/usr/bin/env python3
"""
Tests for the input census.

Every arm asserts a VALUE rather than a shape: the fixtures are small enough that each count, each
verdict line and each exit code is checkable by hand, and the degenerate cases are asserted separately
from the empty ones because the whole point of the instrument is that those are different answers.

Run by the `converter-tests` CI job, which enforces branch coverage over this directory::

    coverage run --branch --source=. --omit='test_*' -m unittest discover -s . -p 'test_*.py'
    coverage report --fail-under=95
"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from audit_input_schema import (
    CaseCensus,
    UNCLASSIFIED,
    census_case,
    census_corpus,
    classify,
    format_census,
    main,
    parse_metrics,
    read_case,
    read_declared_services,
    summarize,
    verdict,
)

TOPO = {
    'onlineboutique.yaml': 'version: "1.0"\nservices:\n  - id: frontend\n  - id: cartservice\n',
    'sockshop.yaml': 'version: "1.0"\nservices:\n  - id: orders\n  - id: carts-db\n',
    'trainticket.yaml': 'version: "1.0"\nservices:\n  - id: ts-auth-service\n  - id: ts-order-service\n',
}


def write_config(root: Path, files: dict[str, str] | None = None) -> Path:
    """Write a topology config directory under `root` and return it."""
    config = root / 'configs' / 'topology'
    config.mkdir(parents=True, exist_ok=True)
    for name, text in (files or TOPO).items():
        (config / name).write_text(text, encoding='utf-8')
    return config


def point(timestamp: int, value: float, metric_name: str = 'cpu') -> dict:
    """One row of a `metrics.json` entry."""
    return {'timestamp': timestamp, 'value': value, 'metric_name': metric_name}


class TestDeclaredServices(unittest.TestCase):
    def test_reads_the_ids_of_the_system_it_was_asked_for(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = write_config(Path(tmp))
            self.assertEqual(
                read_declared_services(config, 'OnlineBoutique'), {'frontend', 'cartservice'}
            )
            self.assertEqual(read_declared_services(config, 'SockShop'), {'orders', 'carts-db'})
            self.assertEqual(len(read_declared_services(config, 'TrainTicket')), 2)

    def test_an_UNRECOGNISED_system_names_nothing_rather_than_guessing_a_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(read_declared_services(Path(tmp), UNCLASSIFIED), frozenset())

    def test_a_MISSING_config_file_is_empty_and_not_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            empty = Path(tmp) / 'nowhere'
            empty.mkdir()
            self.assertEqual(read_declared_services(empty, 'SockShop'), frozenset())

    def test_a_config_with_no_service_entries_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = write_config(Path(tmp), {'sockshop.yaml': 'version: "1.0"\nservices: []\n'})
            self.assertEqual(read_declared_services(config, 'SockShop'), frozenset())


class TestClassify(unittest.TestCase):
    def test_reads_the_suite_and_the_system_from_the_case_id_itself(self) -> None:
        self.assertEqual(
            classify('rcaeval-re1_re1ob_currencyservice_cpu_1'), ('re1', 'OnlineBoutique')
        )
        self.assertEqual(classify('rcaeval-re1_re1ss_orders_loss_4'), ('re1', 'SockShop'))
        self.assertEqual(
            classify('rcaeval-re1_re1tt_ts-auth-service_cpu_1'), ('re1', 'TrainTicket')
        )
        self.assertEqual(classify('rcaeval-re2_re2ob_checkoutservice_cpu_1')[0], 're2')
        self.assertEqual(classify('rcaeval-re3_re3ob_adservice_f3_1')[0], 're3')

    def test_an_id_with_no_marker_is_UNRECOGNISED_rather_than_joining_a_group(self) -> None:
        self.assertEqual(classify('some-fse26-datapack-id'), (UNCLASSIFIED, UNCLASSIFIED))
        self.assertEqual(classify('rcaeval-re4_re4ob_x_cpu_1'), (UNCLASSIFIED, UNCLASSIFIED))


class TestCensusCase(unittest.TestCase):
    declared = frozenset({'frontend', 'cartservice'})

    def test_counts_services_metrics_points_and_the_ones_carrying_a_value(self) -> None:
        metrics = {
            'frontend': [point(1, 0.0, 'cpu'), point(2, 4.0, 'mem')],
            'cartservice': [point(1, 0.0, 'cpu'), point(2, 0.0, 'cpu')],
        }
        entry = census_case('rcaeval-re1_re1ob_frontend_cpu_1', metrics, self.declared)
        self.assertEqual(entry.suite, 're1')
        self.assertEqual(entry.system, 'OnlineBoutique')
        self.assertEqual(entry.services, 2)
        self.assertEqual(entry.declared, 2)
        self.assertEqual(entry.undeclared, ())
        self.assertEqual(entry.metric_names, 2)
        self.assertEqual(entry.points, 4)
        # `cartservice` is present but every value is zero, so it does not carry telemetry.
        self.assertEqual(entry.nonzero_services, 1)
        self.assertTrue(entry.carries_telemetry)
        self.assertFalse(entry.degenerate)

    def test_an_undeclared_service_is_named_and_NOT_counted_as_declared(self) -> None:
        # The shape a wrongly-split column leaves behind: a service id the topology has never heard of.
        metrics = {'frontend': [point(1, 1.0)], 'frontend_http_requests': [point(1, 1.0)]}
        entry = census_case('rcaeval-re1_re1ob_frontend_cpu_1', metrics, self.declared)
        self.assertEqual(entry.declared, 1)
        self.assertEqual(entry.undeclared, ('frontend_http_requests',))
        self.assertTrue(entry.carries_telemetry)

    def test_a_case_whose_every_value_is_ZERO_is_degenerate_and_carries_nothing(self) -> None:
        metrics = {'frontend': [point(1, 0.0), point(2, 0.0)], 'cartservice': [point(1, 0.0)]}
        entry = census_case('rcaeval-re1_re1ob_frontend_cpu_1', metrics, self.declared)
        self.assertEqual(entry.services, 2)
        self.assertEqual(entry.metric_names, 1)
        self.assertEqual(entry.points, 3)
        self.assertEqual(entry.nonzero_services, 0)
        # Present in name, zero in value — the exact shape the allegation describes, and a DIFFERENT
        # answer from "the case is empty".
        self.assertFalse(entry.carries_telemetry)
        self.assertTrue(entry.degenerate)

    def test_an_EMPTY_case_is_degenerate_with_nothing_counted(self) -> None:
        entry = census_case('rcaeval-re1_re1ob_frontend_cpu_1', {}, self.declared)
        self.assertEqual((entry.services, entry.metric_names, entry.points), (0, 0, 0))
        self.assertFalse(entry.carries_telemetry)
        self.assertTrue(entry.degenerate)

    def test_a_service_with_NO_rows_is_degenerate_on_points_alone(self) -> None:
        entry = census_case('rcaeval-re1_re1ob_frontend_cpu_1', {'frontend': []}, self.declared)
        self.assertEqual(entry.services, 1)
        self.assertEqual(entry.points, 0)
        self.assertEqual(entry.metric_names, 0)
        self.assertTrue(entry.degenerate)

    def test_a_row_without_a_metric_name_is_counted_as_UNKNOWN_rather_than_dropped(self) -> None:
        metrics = {'frontend': [{'timestamp': 1, 'value': 2.0}]}
        entry = census_case('rcaeval-re1_re1ob_frontend_cpu_1', metrics, self.declared)
        self.assertEqual(entry.metric_names, 1)
        self.assertEqual(entry.points, 1)
        self.assertEqual(entry.nonzero_services, 1)


class TestParseMetrics(unittest.TestCase):
    def test_a_MISSING_file_is_an_empty_mapping_rather_than_an_exception(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(parse_metrics(Path(tmp) / 'absent.json'), {})

    def test_malformed_bytes_and_a_non_OBJECT_both_collapse_to_the_same_empty_answer(self) -> None:
        # Three failures, one answer, decided in one place: a caller that had to distinguish them would
        # be a caller that could invent a fourth.
        with tempfile.TemporaryDirectory() as tmp:
            broken = Path(tmp) / 'broken.json'
            broken.write_text('{not json', encoding='utf-8')
            self.assertEqual(parse_metrics(broken), {})
            listed = Path(tmp) / 'list.json'
            listed.write_text('[1, 2]', encoding='utf-8')
            self.assertEqual(parse_metrics(listed), {})

    def test_a_real_artifact_is_returned_as_the_mapping_it_is(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'metrics.json'
            path.write_text(json.dumps({'frontend': [point(1, 1.0)]}), encoding='utf-8')
            self.assertEqual(parse_metrics(path), {'frontend': [point(1, 1.0)]})


class TestReadCase(unittest.TestCase):
    def test_a_directory_with_an_artifact_is_censused_against_the_declared_set(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case = Path(tmp) / 'rcaeval-re1_re1ss_orders_loss_4'
            case.mkdir()
            (case / 'metrics.json').write_text(
                json.dumps({'orders': [point(1, 3.0, 'latency-90')]}), encoding='utf-8'
            )
            entry = read_case(case, frozenset({'orders'}))
            self.assertEqual(entry.system, 'SockShop')
            self.assertEqual(entry.declared, 1)
            self.assertTrue(entry.carries_telemetry)

    def test_a_directory_without_an_artifact_censuses_as_EMPTY_and_is_degenerate(self) -> None:
        # The walk never supplies such a directory — `census_corpus` discovers cases BY their artifact —
        # so this is the boundary written down: a case that produced no `metrics.json` is a producer
        # failure, reported by the producer's own log, and here it reads as a degenerate case rather
        # than being silently skipped as if it had carried telemetry.
        with tempfile.TemporaryDirectory() as tmp:
            case = Path(tmp) / 'rcaeval-re1_re1ob_frontend_cpu_1'
            case.mkdir()
            entry = read_case(case, frozenset())
            self.assertEqual(entry.services, 0)
            self.assertTrue(entry.degenerate)


class TestSummarize(unittest.TestCase):
    def entry(
        self, case_id: str, value: float, undeclared: tuple[str, ...] = (), undeclared_value: float = 1.0
    ) -> CaseCensus:
        metrics = {'frontend': [point(1, value)]}
        if undeclared:
            metrics.update({name: [point(1, undeclared_value)] for name in undeclared})
        return census_case(case_id, metrics, frozenset({'frontend'}))

    def test_groups_by_suite_and_system_and_orders_deterministically(self) -> None:
        rows = summarize(
            [
                self.entry('rcaeval-re2_re2ob_x_cpu_1', 1.0),
                self.entry('rcaeval-re1_re1tt_x_cpu_1', 1.0),
                self.entry('rcaeval-re1_re1ob_x_cpu_1', 1.0),
            ]
        )
        self.assertEqual(
            [(r.suite, r.system) for r in rows],
            [('re1', 'OnlineBoutique'), ('re1', 'TrainTicket'), ('re2', 'OnlineBoutique')],
        )

    def test_separates_carrying_from_zeroed_and_unions_the_foreign_ids(self) -> None:
        rows = summarize(
            [
                self.entry('rcaeval-re1_re1ss_x_cpu_1', 1.0, ('frontend_http_requests',)),
                # Zeroed on EVERY service, including the foreign one, so the case is the silent shape: it has
                # services and metric names and no value anywhere.
                self.entry('rcaeval-re1_re1ss_y_cpu_2', 0.0, ('orders_net_tcp',), undeclared_value=0.0),
            ]
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].cases, 2)
        self.assertEqual(rows[0].carrying, 1)
        self.assertEqual(rows[0].zeroed, 1)
        self.assertEqual(rows[0].foreign_name_union, ('frontend_http_requests', 'orders_net_tcp'))

    def test_a_UNION_and_a_PER_CASE_count_are_different_readings_of_one_group(self) -> None:
        # The defect this version exists for. Two cases, each carrying ONE foreign name, and the names differ:
        # the union is two while every case carries one. Read from the union alone the group looks twice as
        # contaminated as it is — and a union of a hundred and twenty-five cases is how a handful of extra
        # scraped services came to read as a mislabelled system.
        rows = summarize(
            [
                self.entry('rcaeval-re1_re1ob_x_cpu_1', 1.0, ('carts',)),
                self.entry('rcaeval-re1_re1ob_y_cpu_2', 1.0, ('catalogue',)),
            ]
        )
        self.assertEqual(rows[0].foreign_name_union, ('carts', 'catalogue'))
        self.assertEqual(rows[0].cases_with_foreign, 2)
        self.assertEqual(rows[0].foreign_per_case_min, 1)
        self.assertEqual(rows[0].foreign_per_case_median, 1)
        self.assertEqual(rows[0].foreign_per_case_max, 1)

    def test_the_foreign_POINT_mass_is_reported_beside_the_names(self) -> None:
        # A name is not a quantity: one foreign service with one row and one with every row are the same entry
        # in a name list, and only the mass separates them.
        rows = summarize(
            [
                census_case(
                    'rcaeval-re1_re1ob_x_cpu_1',
                    {'frontend': [point(1, 1.0), point(2, 1.0)], 'carts': [point(1, 1.0)]},
                    frozenset({'frontend'}),
                )
            ]
        )
        self.assertEqual(rows[0].points, 3)
        self.assertEqual(rows[0].foreign_points, 1)
        self.assertAlmostEqual(rows[0].foreign_point_share, 1 / 3)

    def test_a_case_with_NO_rows_has_a_defined_share_and_is_degenerate(self) -> None:
        # A service with an empty row list is a real artifact: the table exists and has nothing in it. It is
        # the `points == 0` degenerate class, and the share must answer 0 rather than divide by zero — a guard
        # nothing reached until this test, which is the only reason it is written down.
        entry = census_case('rcaeval-re1_re1ob_x_cpu_1', {'frontend': []}, frozenset({'frontend'}))
        self.assertEqual(entry.points, 0)
        self.assertEqual(entry.foreign_point_share, 0.0)
        self.assertTrue(entry.degenerate)

    def test_a_group_with_NO_cases_has_a_defined_spread_rather_than_a_crash(self) -> None:
        # `summarize` never sees an empty group — it is built FROM the members — but the median of an empty
        # list raises, and a guard that cannot be reached is a guard nobody has tested. The zero arm is
        # asserted through the one function that can produce it.
        self.assertEqual(summarize([]), [])
        entry = self.entry('rcaeval-re1_re1ob_x_cpu_1', 1.0)
        self.assertEqual(summarize([entry])[0].foreign_per_case_median, 0)

    def test_an_empty_corpus_summarises_to_no_rows(self) -> None:
        self.assertEqual(summarize([]), [])


class TestReport(unittest.TestCase):
    def rows(self) -> list:
        return summarize(
            [
                census_case(
                    'rcaeval-re1_re1ss_x_cpu_1',
                    {'orders': [point(1, 1.0, 'cpu')], 'orders__x': [point(1, 1.0, 'cpu')]},
                    frozenset({'orders'}),
                ),
                census_case(
                    'rcaeval-re1_re1ob_x_cpu_1', {'frontend': [point(1, 0.0)]}, frozenset({'frontend'})
                ),
            ]
        )

    def test_an_EMPTY_corpus_says_so_rather_than_printing_a_table_of_zeros(self) -> None:
        self.assertEqual(
            format_census([], 4), ['no cases found: nothing to census, and saying so beats printing a zero.']
        )

    def test_the_table_names_every_group_the_foreign_examples_AND_the_two_readings(self) -> None:
        text = '\n'.join(format_census(self.rows(), 4))
        self.assertIn('suite', text)
        self.assertIn('re1', text)
        self.assertIn('SockShop', text)
        self.assertIn('orders__x', text)
        self.assertIn('zeroed', text)
        # Both readings ship with the table, and so does the sentence that says they are different: a reader
        # who takes `names(U)` for a per-case count gets the reading that made a handful of extra scraped
        # services look like a mislabelled system.
        self.assertIn('names(U)', text)
        self.assertIn('per-case', text)
        self.assertIn('fpts', text)
        self.assertIn('share', text)
        self.assertIn('A name in ONE', text)
        self.assertIn('A foreign name is not by', text)

    def test_the_two_readings_differ_in_the_RENDERED_table_not_only_in_the_dataclass(self) -> None:
        # The defect was a REPORTING one, so the fixture has to make the two numbers differ: two groups, one
        # where every case carries a foreign name and one where a single case does. The old table printed the
        # same union-size column for both.
        rows = summarize(
            [
                self.entry_like('rcaeval-re1_re1ob_p_cpu_1', ('carts',)),
                self.entry_like('rcaeval-re1_re1ob_q_cpu_2', ('carts',)),
                self.entry_like('rcaeval-re1_re1ss_p_cpu_1', ('carts',)),
                self.entry_like('rcaeval-re1_re1ss_q_cpu_2', ()),
            ]
        )
        text = '\n'.join(format_census(rows, 0))
        onlineboutique = [ln for ln in text.splitlines() if 'OnlineBoutique' in ln][0]
        sockshop = [ln for ln in text.splitlines() if 'SockShop' in ln][0]
        # Same union size (1) in both rows...
        self.assertIn('        1 ', onlineboutique)
        self.assertIn('        1 ', sockshop)
        # ...and DIFFERENT per-case spreads, which is the whole reason both columns exist.
        self.assertIn('1/1/1', onlineboutique)
        self.assertIn('0/0.5/1', sockshop)

    def entry_like(self, case_id: str, foreign: tuple[str, ...]) -> CaseCensus:
        metrics = {'frontend': [point(1, 1.0)]}
        metrics.update({name: [point(1, 1.0)] for name in foreign})
        return census_case(case_id, metrics, frozenset({'frontend'}))

    def test_EXAMPLES_ZERO_keeps_the_COUNT_and_drops_the_names(self) -> None:
        # A summary that names its population's members goes stale with it; the count is the durable
        # half, so it must survive the examples being switched off.
        text = '\n'.join(format_census(self.rows(), 0))
        self.assertNotIn('orders__x', text)
        self.assertIn('re1', text)
        self.assertIn('zeroed', text)

    def test_the_verdict_counts_the_cases_that_carry_telemetry(self) -> None:
        rows = self.rows()
        # re1 has two cases, one of which carries a non-zero value.
        self.assertEqual(verdict(rows, 're1'), 're1: 1 of 2 cases carry non-zero telemetry across 2 systems.')

    def test_a_suite_absent_from_the_corpus_says_so_rather_than_printing_a_zero(self) -> None:
        self.assertEqual(
            verdict(self.rows(), 're3'), 're3: no cases in this corpus — nothing to state.'
        )


class TestCensusCorpus(unittest.TestCase):
    def test_finds_cases_however_deep_the_datasets_own_layout_puts_them(self) -> None:
        # The bridge writes `out_dir / <the parquet's path relative to the data root>`, so the depth is a
        # property of the raw dataset and not of this instrument. A one-level walk would have censused
        # ZERO cases here — a wrong answer that reads exactly like a finding.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = write_config(root)
            (root / 'loose.json').write_text('{}', encoding='utf-8')
            shallow = root / 'rcaeval-re1_re1ob_frontend_cpu_1'
            shallow.mkdir()
            (shallow / 'metrics.json').write_text(
                json.dumps({'frontend': [point(1, 2.0)]}), encoding='utf-8'
            )
            deep = root / 'RE1' / 'RE1-SS' / 'rcaeval-re1_re1ss_orders_loss_1'
            deep.mkdir(parents=True)
            (deep / 'metrics.json').write_text(
                json.dumps({'orders': [point(1, 3.0)]}), encoding='utf-8'
            )
            orphan = root / 'rcaeval-re1_re1tt_x_cpu_9'
            orphan.mkdir()

            found = census_corpus(root, config)
            # The orphan directory has no artifact, so it is not a case: this walk discovers cases BY
            # their artifact and never invents one from a directory name.
            self.assertEqual(
                sorted(c.case_id for c in found),
                ['rcaeval-re1_re1ob_frontend_cpu_1', 'rcaeval-re1_re1ss_orders_loss_1'],
            )
            by_id = {c.case_id: c for c in found}
            self.assertEqual(by_id['rcaeval-re1_re1ob_frontend_cpu_1'].declared, 1)
            self.assertEqual(by_id['rcaeval-re1_re1ss_orders_loss_1'].system, 'SockShop')


class TestCli(unittest.TestCase):
    def run_main(self, argv: list[str]) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = main(argv)
        return code, out.getvalue(), err.getvalue()

    def corpus(self, root: Path, value: float) -> Path:
        case = root / 'rcaeval-re1_re1ob_frontend_cpu_1'
        case.mkdir(parents=True)
        (case / 'metrics.json').write_text(
            json.dumps({'frontend': [point(1, value, 'cpu')]}), encoding='utf-8'
        )
        return write_config(root)

    def test_a_MISSING_corpus_is_a_usage_error_and_not_a_zero_census(self) -> None:
        code, _, err = self.run_main(['--root', '/nonexistent-corpus-xyz'])
        self.assertEqual(code, 2)
        self.assertIn('not found', err)

    def test_a_healthy_corpus_exits_zero_and_prints_all_three_suite_verdicts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = self.corpus(root, 2.0)
            code, out, _ = self.run_main(['--root', str(root), '--config', str(config)])
            self.assertEqual(code, 0)
            self.assertIn('re1: 1 of 1 cases carry non-zero telemetry', out)
            self.assertIn('re2: no cases in this corpus', out)
            self.assertIn('degenerate cases: 0 of 1', out)

    def test_a_degenerate_corpus_exits_zero_UNLESS_the_gate_is_asked_for(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = self.corpus(root, 0.0)
            code, out, _ = self.run_main(['--root', str(root), '--config', str(config)])
            self.assertEqual(code, 0)
            self.assertIn('degenerate cases: 1 of 1', out)
            self.assertIn('rcaeval-re1_re1ob_frontend_cpu_1', out)

            code, _, err = self.run_main(
                ['--root', str(root), '--config', str(config), '--fail-on-degenerate']
            )
            self.assertEqual(code, 1)
            self.assertIn('FAIL', err)

    def test_the_json_flag_writes_the_groups_the_PER_CASE_rows_and_the_degenerate_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = self.corpus(root, 3.0)
            out_path = root / 'census.json'
            code, _, _ = self.run_main(
                ['--root', str(root), '--config', str(config), '--json', str(out_path)]
            )
            self.assertEqual(code, 0)
            written = json.loads(out_path.read_text(encoding='utf-8'))
            self.assertEqual(written['cases'], 1)
            self.assertEqual(written['degenerate'], [])
            self.assertEqual(written['groups'][0]['suite'], 're1')
            # The per-case rows are in the artifact, so every group figure can be RE-DERIVED from it rather
            # than trusted. Publishing the union alone is what made a name in one case of a hundred and
            # twenty-five indistinguishable from a name in all of them.
            self.assertEqual(len(written['per_case']), 1)
            self.assertEqual(written['per_case'][0]['case_id'], 'rcaeval-re1_re1ob_frontend_cpu_1')
            self.assertEqual(written['per_case'][0]['points'], 1)
            self.assertEqual(written['per_case'][0]['foreign_points'], 0)
            # And the group's numbers are exactly the per-case ones folded, which is the property the
            # artifact exists to let a reader check.
            group = written['groups'][0]
            self.assertEqual(group['points'], sum(c['points'] for c in written['per_case']))
            self.assertEqual(
                group['foreign_points'], sum(c['foreign_points'] for c in written['per_case'])
            )

    def test_examples_caps_how_many_degenerate_ids_are_named(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            config = write_config(root)
            for index in range(3):
                case = root / f'rcaeval-re1_re1ob_frontend_cpu_{index}'
                case.mkdir(parents=True)
                (case / 'metrics.json').write_text(
                    json.dumps({'frontend': [point(1, 0.0)]}), encoding='utf-8'
                )
            code, out, _ = self.run_main(
                ['--root', str(root), '--config', str(config), '--examples', '1']
            )
            self.assertEqual(code, 0)
            self.assertIn('degenerate cases: 3 of 3', out)
            # One id, because `--examples 1` caps the list — the count is what must not be capped.
            self.assertEqual(out.count('rcaeval-re1_re1ob_frontend_cpu_'), 1)


if __name__ == '__main__':
    unittest.main()
