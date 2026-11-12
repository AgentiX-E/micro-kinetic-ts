"""Tests for `prune_caches.py`.

The script decides which cache entries are deleted from a shared, over-quota budget, so every rule it
applies is asserted here rather than argued in the workflow comment:

1. **Deny by default.** A key that matches no listed prefix is never selected. The population is the
   real one: `RCAEvalJSON-*` (3 952 MB, rebuilt in ~30 minutes) sits in the same listing as the 80
   `codeql-overlay-*` entries, and a substring rule would take both.
2. **Newest first.** `keep_recent=2` must keep the two most recently CREATED entries, not the first two
   in the API's order, because the entry a running analysis is about to read is the newest one.
3. **A manual run is a reading.** `--apply` is what deletes; without it the same plan is printed.
4. **A partial prune is visible.** A delete that fails on anything other than 404 makes the process
   exit non-zero, so a half-pruned budget cannot be reported as pruned.

The transport is injected, so no test reaches the network.
"""

from __future__ import annotations

import io
import json
import unittest
import urllib.error
import urllib.request

import prune_caches
from prune_caches import Entry, select_deletions


def entry(identifier: int, key: str, size: int = 1000, created: str = '2026-11-12T00:00:00Z') -> Entry:
    """Build one entry.

    @param identifier: The cache id.
    @param key: The cache key.
    @param size: Size in bytes.
    @param created: Creation timestamp.
    @returns The entry.
    """
    return Entry(id=identifier, key=key, size_in_bytes=size, created_at=created)


def overlay(identifier: int, created: str, size: int = 70_000_000) -> Entry:
    """Build one CodeQL overlay entry.

    @param identifier: The cache id.
    @param created: Creation timestamp.
    @param size: Size in bytes.
    @returns The entry.
    """
    return entry(identifier, f'{prune_caches.CODEQL_OVERLAY}1-{identifier}-javascript', size, created)


class FakeResponse:
    """A response object with the two methods the callers use."""

    def __init__(self, body: bytes = b'') -> None:
        """Store the body.

        @param body: Bytes the call returns.
        """
        self.body = body

    def read(self) -> bytes:
        """Return the body.

        @returns The bytes.
        """
        return self.body

    def __enter__(self) -> 'FakeResponse':
        """Enter the context manager.

        @returns Self.
        """
        return self

    def __exit__(self, *_: object) -> None:
        """Leave the context manager.

        @param _: Unused exception triple.
        """


class FakeOpener:
    """A transport that records requests and replays scripted outcomes."""

    def __init__(self, pages: list[dict] | None = None, failures: dict[int, int] | None = None) -> None:
        """Configure the transport.

        @param pages: One payload per successive GET, in order.
        @param failures: HTTP status to raise for a URL containing the given id.
        """
        self.pages = list(pages or [])
        self.failures = failures or {}
        self.requests: list[urllib.request.Request] = []

    def __call__(self, request: urllib.request.Request) -> FakeResponse:
        """Serve one request.

        @param request: The request.
        @returns The response.
        @raises urllib.error.HTTPError: for a URL whose id is in `failures`.
        """
        self.requests.append(request)
        for marker, status in self.failures.items():
            if f'/{marker}' in request.full_url:
                raise urllib.error.HTTPError(request.full_url, status, 'scripted', {}, io.BytesIO(b''))
        if request.get_method() == 'GET':
            return FakeResponse(json.dumps(self.pages.pop(0)).encode('utf-8'))
        return FakeResponse()

    def methods(self) -> list[str]:
        """The methods requested, in order.

        @returns Method names.
        """
        return [request.get_method() for request in self.requests]


def payload(*entries: dict) -> dict:
    """Wrap entries in the API's envelope.

    @param entries: Raw entries.
    @returns The listing payload.
    """
    return {'total_count': len(entries), 'actions_caches': list(entries)}


def raw(identifier: int, key: str, created: str = '2026-11-12T00:00:00Z', size: int = 1000) -> dict:
    """Build one raw API entry.

    @param identifier: The cache id.
    @param key: The cache key.
    @param created: Creation timestamp.
    @param size: Size in bytes.
    @returns The raw entry.
    """
    return {'id': identifier, 'key': key, 'size_in_bytes': size, 'created_at': created}


class SelectDeletionsTest(unittest.TestCase):
    """The plan, which is the whole decision."""

    def test_keeps_the_newest_two_and_deletes_the_rest(self) -> None:
        """Newest by creation, not by position in the listing."""
        entries = [
            overlay(1, '2026-11-10T00:00:00Z'),
            overlay(3, '2026-11-12T00:00:00Z'),
            overlay(2, '2026-11-11T00:00:00Z'),
        ]
        plan = select_deletions(entries, keep_recent=2)
        self.assertEqual([e.id for e in plan.kept], [3, 2])
        self.assertEqual([e.id for e in plan.to_delete], [1])

    def test_a_key_outside_every_prefix_is_never_selected(self) -> None:
        """The 3.9 GB artifact that is actually reused survives a full-size listing."""
        entries = [
            overlay(1, '2026-11-10T00:00:00Z'),
            overlay(2, '2026-11-11T00:00:00Z'),
            entry(99, 'RCAEvalJSON-80520ccbbc8ffb70', 3_952_000_000),
            entry(98, 'node-cache-Linux-x64-pnpm-abc', 332_000_000),
        ]
        plan = select_deletions(entries, keep_recent=1)
        self.assertEqual([e.key for e in plan.to_delete], [f'{prune_caches.CODEQL_OVERLAY}1-1-javascript'])
        self.assertEqual([e.id for e in plan.unmatched], [99, 98])

    def test_keeps_everything_when_the_population_is_below_the_floor(self) -> None:
        """A short family deletes nothing, rather than the floor being interpreted as a quota."""
        plan = select_deletions([overlay(1, '2026-11-10T00:00:00Z')], keep_recent=2)
        self.assertEqual(plan.to_delete, ())
        self.assertEqual(len(plan.kept), 1)
        self.assertEqual(plan.bytes_reclaimed, 0)

    def test_two_prefixes_keep_their_own_floor(self) -> None:
        """Each prefix is a family with its own retention, not a shared pool."""
        entries = [
            overlay(1, '2026-11-10T00:00:00Z'),
            overlay(2, '2026-11-11T00:00:00Z'),
            entry(3, 'custom-sha-1', 10, '2026-11-10T00:00:00Z'),
            entry(4, 'custom-sha-2', 20, '2026-11-11T00:00:00Z'),
        ]
        plan = select_deletions(entries, (prune_caches.CODEQL_OVERLAY, 'custom-'), keep_recent=1)
        self.assertEqual(sorted(e.id for e in plan.to_delete), [1, 3])
        self.assertEqual(sorted(e.id for e in plan.kept), [2, 4])
        self.assertEqual(plan.bytes_reclaimed, 70_000_010)

    def test_a_zero_floor_is_refused(self) -> None:
        """Deleting the overlay a running analysis is about to read is not a prune."""
        with self.assertRaises(ValueError):
            select_deletions([], keep_recent=0)

    def test_an_empty_scope_is_refused(self) -> None:
        """A caller that thinks it pruned while deleting nothing keeps paying the eviction."""
        with self.assertRaises(ValueError):
            select_deletions([], prefixes=())

    def test_the_default_scope_is_exactly_the_overlay_family(self) -> None:
        """One prefix, named, and no prefix that covers a reused family."""
        self.assertEqual(prune_caches.DEFAULT_PREFIXES, (prune_caches.CODEQL_OVERLAY,))
        for prefix in prune_caches.PROTECTED_PREFIXES:
            self.assertFalse(prune_caches.CODEQL_OVERLAY.startswith(prefix))

    def test_the_real_listing_shape_selects_the_eighty_entries(self) -> None:
        """Non-vacuity: the measured population (80 overlays + 4 others) actually prunes."""
        entries = [overlay(i, f'2026-11-{1 + i % 28:02d}T{i % 24:02d}:00:00Z') for i in range(80)]
        entries += [
            entry(900, 'RCAEvalJSON-x', 3_952_000_000),
            entry(901, 'RCAEval-datasets-v2-pq', 3_300_000_000),
            entry(902, 'node-cache-x', 332_000_000),
            entry(903, 'setup-python-x', 161_000_000),
        ]
        plan = select_deletions(entries)
        self.assertEqual(len(plan.to_delete), 78)
        self.assertEqual(len(plan.unmatched), 4)
        self.assertAlmostEqual(plan.bytes_reclaimed / 1e9, 5.46, places=2)


class ParseEntryTest(unittest.TestCase):
    """Reading the API's schema."""

    def test_reads_the_four_fields_the_decision_uses(self) -> None:
        """The fields are carried through unchanged."""
        parsed = prune_caches.parse_entry(raw(7, 'k', '2026-01-01T00:00:00Z', 42))
        self.assertEqual(parsed, Entry(id=7, key='k', size_in_bytes=42, created_at='2026-01-01T00:00:00Z'))

    def test_a_missing_field_fails_rather_than_becoming_unmatched(self) -> None:
        """A schema change must not silently classify every entry as out of scope."""
        with self.assertRaises(KeyError):
            prune_caches.parse_entry({'id': 1, 'key': 'k', 'size_in_bytes': 1})


class ListCachesTest(unittest.TestCase):
    """Pagination."""

    def test_follows_pages_until_a_short_one(self) -> None:
        """A full page is not the end; a short page is."""
        full = [raw(i, f'k{i}') for i in range(prune_caches.PER_PAGE)]
        opener = FakeOpener([payload(*full), payload(raw(999, 'last'))])
        entries = prune_caches.list_caches(prune_caches.http_fetch('t', opener), 'o/r')
        self.assertEqual(len(entries), prune_caches.PER_PAGE + 1)
        self.assertIn('page=2', opener.requests[1].full_url)
        self.assertEqual(opener.requests[0].get_header('Authorization'), 'Bearer t')

    def test_an_empty_repository_is_one_call(self) -> None:
        """No entries, no second request."""
        opener = FakeOpener([payload()])
        self.assertEqual(prune_caches.list_caches(prune_caches.http_fetch('t', opener), 'o/r'), [])
        self.assertEqual(len(opener.requests), 1)


class MainTest(unittest.TestCase):
    """The command line: a reading by default, an action only when asked."""

    def run_main(self, argv: list[str], opener: FakeOpener, environ: dict[str, str] | None = None) -> tuple[int, str, str]:
        """Run `main` against a scripted transport.

        @param argv: Arguments.
        @param opener: The transport.
        @param environ: Environment override.
        @returns Exit code, stdout and stderr.
        """
        out, err = io.StringIO(), io.StringIO()
        original = prune_caches.sys.stdout, prune_caches.sys.stderr
        prune_caches.sys.stdout, prune_caches.sys.stderr = out, err
        try:
            code = prune_caches.main(
                argv,
                fetch_factory=lambda token: prune_caches.http_fetch(token, opener),
                delete_factory=lambda token: prune_caches.http_delete(token, opener),
                environ={'GITHUB_TOKEN': 't', 'GITHUB_REPOSITORY': 'o/r'} if environ is None else environ,
            )
        finally:
            prune_caches.sys.stdout, prune_caches.sys.stderr = original
        return code, out.getvalue(), err.getvalue()

    def listing(self) -> FakeOpener:
        """A transport holding three overlays and one reused artifact.

        @returns The transport.
        """
        return FakeOpener([
            payload(
                raw(1, f'{prune_caches.CODEQL_OVERLAY}1-a', '2026-11-10T00:00:00Z'),
                raw(2, f'{prune_caches.CODEQL_OVERLAY}1-b', '2026-11-11T00:00:00Z'),
                raw(3, f'{prune_caches.CODEQL_OVERLAY}1-c', '2026-11-12T00:00:00Z'),
                raw(9, 'RCAEvalJSON-x', '2026-11-01T00:00:00Z', 3_952_000_000),
            )
        ])

    def test_a_manual_run_deletes_nothing(self) -> None:
        """The default is the plan, and the plan is the same one `--apply` executes."""
        opener = self.listing()
        code, out, _ = self.run_main([], opener)
        self.assertEqual(code, 0)
        self.assertIn('dry run: nothing deleted', out)
        self.assertEqual(opener.methods(), ['GET'])

    def test_apply_deletes_the_selected_entries_only(self) -> None:
        """The 3.9 GB artifact is not addressed at all."""
        opener = self.listing()
        code, out, _ = self.run_main(['--apply'], opener)
        self.assertEqual(code, 0)
        self.assertIn('deleted 1 of 1', out)
        deletes = [r.full_url for r in opener.requests if r.get_method() == 'DELETE']
        self.assertEqual(deletes, ['https://api.github.com/repos/o/r/actions/caches/1'])

    def test_a_zero_floor_is_refused_before_any_call(self) -> None:
        """`--keep-recent 0` must not reach the API: it would delete the live overlay."""
        opener = self.listing()
        code, _, err = self.run_main(['--apply', '--keep-recent', '0'], opener)
        self.assertEqual(code, 2)
        self.assertIn('at least 1', err)
        self.assertEqual(opener.requests, [])

    def test_a_custom_prefix_and_floor_are_honoured(self) -> None:
        """The two knobs the workflow exposes are the two it passes."""
        opener = self.listing()
        code, out, _ = self.run_main(['--prefix', 'custom-', '--keep-recent', '2'], opener)
        self.assertEqual(code, 0)
        self.assertIn('in scope:  0 -> keep 0, delete 0', out)
        self.assertEqual(opener.methods(), ['GET'])

    def test_an_already_evicted_entry_is_not_a_failure(self) -> None:
        """404 is the outcome the loop wanted."""
        opener = self.listing()
        opener.failures = {1: 404}
        code, _, _ = self.run_main(['--apply'], opener)
        self.assertEqual(code, 0)

    def test_a_failed_delete_makes_a_partial_prune_visible(self) -> None:
        """Anything else is counted, and the process exits non-zero."""
        opener = self.listing()
        opener.failures = {1: 500}
        code, _, err = self.run_main(['--apply'], opener)
        self.assertEqual(code, 1)
        self.assertIn('HTTP 500', err)

    def test_a_missing_repository_is_refused(self) -> None:
        """No repository, no plan."""
        code, _, err = self.run_main([], FakeOpener([]), environ={'GITHUB_TOKEN': 't'})
        self.assertEqual(code, 2)
        self.assertIn('GITHUB_REPOSITORY is required', err)

    def test_a_missing_token_is_refused(self) -> None:
        """No token, no plan -- and the message names the variable rather than an auth failure."""
        code, _, err = self.run_main([], FakeOpener([]), environ={'GITHUB_REPOSITORY': 'o/r'})
        self.assertEqual(code, 2)
        self.assertIn('GITHUB_TOKEN is required', err)

    def test_an_empty_prefix_is_refused(self) -> None:
        """An empty prefix matches every key, which is the whole budget."""
        code, _, err = self.run_main(['--prefix', ''], FakeOpener([]))
        self.assertEqual(code, 2)
        self.assertIn('empty prefix', err)

    def test_a_protected_prefix_is_refused(self) -> None:
        """The families that ARE reused are named, and naming one is an error rather than a scope."""
        for prefix in prune_caches.PROTECTED_PREFIXES:
            code, _, err = self.run_main(['--prefix', prefix], FakeOpener([]))
            self.assertEqual(code, 2, prefix)
            self.assertIn('refusing', err)


if __name__ == '__main__':
    unittest.main()
