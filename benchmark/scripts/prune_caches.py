"""Reclaim the Actions cache entries that can never be reused.

## The measurement this script exists for

`GET /repos/{owner}/{repo}/actions/cache/usage` on this repository reports **10 743 940 592 bytes
against a 10 GB budget** across 84 entries:

| family                              | entries | size      | reusable after the run that wrote it? |
| ----------------------------------- | ------- | --------- | ------------------------------------- |
| `codeql-overlay-base-database-*`     | 80      | 5 686 MB  | no — the key embeds the commit SHA    |
| `RCAEvalJSON-*`                      | 1       | 3 952 MB  | yes — read by every RCAEval battery   |
| `node-cache-Linux-x64-pnpm-*`        | 1       | 332 MB    | yes — the lockfile digest            |
| `setup-python-*`                     | 1       | 161 MB    | yes — the toolchain pin               |

Eighty of eighty-four entries are a pair per commit SHA, written by the CodeQL job and then addressed
by a name no later commit can produce. GitHub's own limits -- 10 GB per repository by default, with
usage beyond it billed, eviction oldest-last-access-first, and removal of anything not accessed in
seven days -- mean such an entry is consumed by churn: nothing can address it, so nothing keeps it
alive, and it holds budget until the policy takes it. They are not a cache; they are a log. Because
the budget is over quota, **every save evicts something**, and what gets evicted is chosen by LRU —
which is how the artifact that actually is reused (3 952 MB, ~30 minutes to rebuild) competes with
entries that nothing will ever read again.

## What it does, and the rule that keeps it safe

It deletes entries whose key starts with an **explicitly listed** prefix, keeping the newest
`--keep-recent` of each prefix. A key that matches no listed prefix is never deleted — deny by
default, because the failure mode of a pattern list that is too broad is a benchmark that silently
re-downloads 3.3 GB or, worse, a cache hit that no longer matches its key's meaning.

`--apply` is required to delete anything. The default is a dry run that prints the same plan, so the
first dispatch of `.github/workflows/cache-prune.yml` is a reading rather than an action.

## Why the newest entries are kept at all

CodeQL's overlay database is produced during the analysis job and restored by the *next* job of the
same workflow run (the `analysis` matrix shares it). Deleting every entry would remove the one the
currently-running analysis is about to read, which costs a rebuild rather than a correctness bug —
but it is a cost this script has no reason to impose, and `keep_recent=2` covers the two languages
the CodeQL job analyses.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

#: Page size the caches API accepts (its maximum).
PER_PAGE = 100

#: The one family this repository has measured to be write-once-and-never-read.
CODEQL_OVERLAY = 'codeql-overlay-base-database-'

#: The default deletion scope. Exactly one prefix, and it is named rather than derived: a pattern
#: derived from "whatever is big" would select the entries that ARE reused.
DEFAULT_PREFIXES: tuple[str, ...] = (CODEQL_OVERLAY,)

#: Prefixes a caller must not add by accident, checked so the guard is a fact and not a comment.
PROTECTED_PREFIXES: tuple[str, ...] = ('RCAEvalJSON', 'RCAEval-datasets', 'node-cache-', 'setup-python-')

#: One cache entry, reduced to what the decision reads.
@dataclass(frozen=True)
class Entry:
    """One cached artifact."""

    id: int
    key: str
    size_in_bytes: int
    created_at: str


#: The plan: what to delete, what to keep, and the bytes that come back.
@dataclass(frozen=True)
class Plan:
    """A deletion plan, with the accounting that makes it reviewable."""

    to_delete: tuple[Entry, ...]
    kept: tuple[Entry, ...]
    unmatched: tuple[Entry, ...]

    @property
    def bytes_reclaimed(self) -> int:
        """Total size of the entries that would be deleted."""
        return sum(entry.size_in_bytes for entry in self.to_delete)


def parse_entry(raw: dict) -> Entry:
    """Read one API entry.

    @param raw: One element of the caches listing.
    @returns The entry.
    @raises KeyError: when a field the decision needs is absent, so a schema change fails here rather
        than silently classifying every entry as unmatched.
    """
    return Entry(
        id=int(raw['id']),
        key=str(raw['key']),
        size_in_bytes=int(raw['size_in_bytes']),
        created_at=str(raw['created_at']),
    )


def select_deletions(
    entries: Iterable[Entry],
    prefixes: Sequence[str] = DEFAULT_PREFIXES,
    keep_recent: int = 2,
) -> Plan:
    """Choose which entries to delete.

    @param entries: Every entry the repository holds, in any order.
    @param prefixes: The key prefixes that are in scope.
    @param keep_recent: How many of each prefix to keep, newest first.
    @returns The plan.
    @raises ValueError: when `keep_recent` is below one (which would delete the entry the running
        analysis is about to read) or when no prefix is given (an empty scope deletes nothing, and a
        caller that thinks it pruned would keep paying for the eviction).
    """
    if keep_recent < 1:
        raise ValueError(f'keep_recent must be at least 1, got {keep_recent}')
    if not prefixes:
        raise ValueError('at least one prefix is required; an empty scope is not a prune')

    by_prefix: dict[str, list[Entry]] = {prefix: [] for prefix in prefixes}
    unmatched: list[Entry] = []
    for entry in entries:
        for prefix in prefixes:
            if entry.key.startswith(prefix):
                by_prefix[prefix].append(entry)
                break
        else:
            unmatched.append(entry)

    to_delete: list[Entry] = []
    kept: list[Entry] = []
    for prefix in prefixes:
        # Newest first: `created_at` is an ISO-8601 UTC string, so the lexicographic order is the
        # chronological one and no parsing is needed to get it wrong.
        ordered = sorted(by_prefix[prefix], key=lambda entry: entry.created_at, reverse=True)
        kept.extend(ordered[:keep_recent])
        to_delete.extend(ordered[keep_recent:])

    return Plan(tuple(to_delete), tuple(kept), tuple(unmatched))


def list_caches(fetch: Callable[[str], dict], repo: str) -> list[Entry]:
    """Read every cache entry, following pagination.

    @param fetch: Callable taking a URL and returning decoded JSON.
    @param repo: `owner/name`.
    @returns Every entry, in the API's order.
    """
    entries: list[Entry] = []
    page = 1
    while True:
        payload = fetch(
            f'https://api.github.com/repos/{repo}/actions/caches?per_page={PER_PAGE}&page={page}'
        )
        batch = [parse_entry(raw) for raw in payload.get('actions_caches', [])]
        entries.extend(batch)
        # A short page is the last one. The alternative -- trusting `total_count` -- would loop
        # forever on a repository whose caches are being written while the listing pages.
        if len(batch) < PER_PAGE:
            return entries
        page += 1


def http_fetch(
    token: str,
    opener: Callable[[urllib.request.Request], object] = urllib.request.urlopen,
) -> Callable[[str], dict]:
    """Build a GET caller for the GitHub API.

    @param token: A token with `actions: write`.
    @param opener: The transport; injectable so the caller can be exercised without a network.
    @returns The callable `list_caches` expects.
    """

    def fetch(url: str) -> dict:
        return json.loads(_call(token, url, 'GET', opener).decode('utf-8'))

    return fetch


def http_delete(
    token: str,
    opener: Callable[[urllib.request.Request], object] = urllib.request.urlopen,
) -> Callable[[str], None]:
    """Build a DELETE caller for the GitHub API.

    @param token: A token with `actions: write`.
    @param opener: The transport; injectable, for the reason `http_fetch` records.
    @returns The callable `main` uses.
    """

    def remove(url: str) -> None:
        _call(token, url, 'DELETE', opener)

    return remove


def _call(
    token: str,
    url: str,
    method: str,
    opener: Callable[[urllib.request.Request], object],
) -> bytes:
    """Perform one API call.

    @param token: The API token.
    @param url: Absolute URL.
    @param method: HTTP method.
    @param opener: The transport.
    @returns The response body.
    """
    request = urllib.request.Request(url, headers=_headers(token), method=method)
    with opener(request) as response:  # type: ignore[attr-defined]
        return response.read()  # type: ignore[attr-defined,no-any-return]


def _headers(token: str) -> dict[str, str]:
    """The three headers every call here needs.

    @param token: The API token.
    @returns Header map.
    """
    return {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    }


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    """Parse the command line.

    @param argv: Arguments after the script name.
    @returns The parsed arguments.
    """
    parser = argparse.ArgumentParser(description='Reclaim Actions cache entries that cannot be reused.')
    parser.add_argument(
        '--repo',
        default='',
        help='owner/name (default: $GITHUB_REPOSITORY)',
    )
    parser.add_argument(
        '--prefix',
        action='append',
        dest='prefixes',
        help=f'key prefix in scope; repeatable (default: {DEFAULT_PREFIXES[0]})',
    )
    parser.add_argument(
        '--keep-recent',
        type=int,
        default=2,
        help='keep this many of each prefix, newest first (default: 2)',
    )
    parser.add_argument(
        '--apply',
        action='store_true',
        help='delete; without it the same plan is printed and nothing changes',
    )
    return parser.parse_args(argv)


def main(
    argv: Sequence[str],
    fetch_factory: Callable[[str], Callable[[str], dict]] = http_fetch,
    delete_factory: Callable[[str], Callable[[str], None]] = http_delete,
    environ: dict[str, str] | None = None,
) -> int:
    """Run the prune.

    @param argv: Arguments after the script name.
    @param fetch_factory: Builds the GET caller from a token; injectable so the plan can be tested.
    @param delete_factory: Builds the DELETE caller from a token.
    @param environ: Environment to read the token from (default: `os.environ`).
    @returns Process exit code: 0 when the plan was printed (and applied), 1 when a delete failed.
    """
    args = parse_args(argv)
    env = os.environ if environ is None else environ
    # ONE owner for the default: `parse_args` cannot read an injected environment, so it declares no
    # default and this line reads it. Two defaults would be two answers to "which repository".
    repo = args.repo or env.get('GITHUB_REPOSITORY', '')
    if repo == '':
        print('prune_caches: --repo or $GITHUB_REPOSITORY is required', file=sys.stderr)
        return 2
    token = env.get('GITHUB_TOKEN', '')
    if token == '':
        print('prune_caches: $GITHUB_TOKEN is required', file=sys.stderr)
        return 2

    prefixes = tuple(args.prefixes) if args.prefixes else DEFAULT_PREFIXES
    #   Both refusals come BEFORE the listing: an argument that cannot produce a legal plan must not
    #   spend a call, and a caller that reads "0 entries in scope" afterwards would be reading the
    #   consequence of its own typo as a fact about the repository.
    if args.keep_recent < 1:
        print(f'prune_caches: --keep-recent must be at least 1, got {args.keep_recent}', file=sys.stderr)
        return 2
    for prefix in prefixes:
        if prefix == '':
            print('prune_caches: an empty prefix would match every key', file=sys.stderr)
            return 2
        if prefix.startswith(PROTECTED_PREFIXES):
            print(f'prune_caches: {prefix!r} names a family that IS reused; refusing', file=sys.stderr)
            return 2

    entries = list_caches(fetch_factory(token), repo)
    plan = select_deletions(entries, prefixes, args.keep_recent)
    total = sum(entry.size_in_bytes for entry in entries)

    print(f'entries:   {len(entries)} ({total / 1e9:.2f} GB)')
    print(f'in scope:  {len(plan.kept) + len(plan.to_delete)} -> keep {len(plan.kept)}, '
          f'delete {len(plan.to_delete)}')
    print(f'out of scope (never touched): {len(plan.unmatched)}')
    print(f'reclaimed: {plan.bytes_reclaimed / 1e9:.2f} GB')
    for entry in plan.to_delete:
        print(f'  delete {entry.key} ({entry.size_in_bytes / 1e6:.0f} MB, created {entry.created_at})')

    if not args.apply:
        print('dry run: nothing deleted. Pass --apply to delete.')
        return 0

    remove = delete_factory(token)
    failures = 0
    for entry in plan.to_delete:
        try:
            remove(f'https://api.github.com/repos/{repo}/actions/caches/{entry.id}')
        except urllib.error.HTTPError as error:
            # A 404 is the entry having been evicted while this loop ran, which is the outcome the
            # loop wanted; anything else is reported and counted, so a partial prune is visible.
            if error.code != 404:
                failures += 1
                print(f'  FAILED {entry.key}: HTTP {error.code}', file=sys.stderr)
    print(f'deleted {len(plan.to_delete) - failures} of {len(plan.to_delete)}')
    return 0 if failures == 0 else 1


if __name__ == '__main__':  # pragma: no cover - the entry point, exercised by the workflow
    sys.exit(main(sys.argv[1:]))
