/**
 * The ONE order convention for corpus and artifact sequences.
 *
 * ## Why this is a module and not a lambda at each site
 *
 * Fourteen sites in this repository order a sequence, and two conventions lived among them. Twelve used
 * `localeCompare`, which answers from **ICU and the active locale** — machine state, not properties of the two
 * strings — and two hand-rolled a comparison on `<`. `packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts`
 * held **both**: its suite's case directories were sorted with `a.name.localeCompare(b.name)` while its edge
 * list, eight hundred lines later, was ordered by `<` with the reason written beside it:
 *
 * > *"Replacing the comparator with `localeCompare` would silence an unreachable arm and blind that control, so
 * > it stays."*
 *
 * One file, two conventions, and the machine-dependent one was on the case list — so a SUITE's case order was a
 * property of the machine while an EDGE list's was a property of the data. That is the register's
 * *"a partition with two owners has no convention"* arriving as an ordering rather than as a value.
 *
 * ## What `localeCompare` costs, stated as the failure rather than as a preference
 *
 * `'é'.localeCompare('z')` is negative and `'é' < 'z'` is false. Both are correct answers to different
 * questions: the first asks "where does French collation put these", the second asks "where do these bytes
 * sort". A corpus's order has to be the second, because the first changes when a machine's ICU version or
 * `LANG` does — and a changed order changes which cases a `slice(0, n)` selects, i.e. a published population.
 *
 * ## The home is this package, and that is a layering fact rather than a preference
 *
 * `rcaeval-loader.ts` sorts a suite's case directories, so the convention has to live where the LOADER can
 * reach it — inside `@agentix-e/micro-kinetic`. A comparator placed in `benchmarks/src` could only be read back
 * by the loader through a dependency inversion, which is the same defect `DEFAULT_FAILED_EDGE_MODE` had when it
 * lived in the wrong package carrying four declaring sites.
 *
 * @module benchmarks/case-order
 */

/**
 * Canonical order for corpus paths: code units, never `localeCompare`.
 *
 * Three arms rather than `a < b ? -1 : 1`, because `Array.prototype.sort` asks whether two keys are EQUAL and a
 * two-arm comparator answers `1` — claiming an order for two paths that have none, which makes the sort's
 * result depend on the algorithm's own stability assumptions rather than on the data.
 *
 * @param a - Left path or key.
 * @param b - Right path or key.
 * @returns Negative when `a` sorts first, zero when equal, positive when `b` sorts first.
 */
export function compareCasePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * A copy of `items` in canonical order by `keyOf(item)`.
 *
 * A copy, because sorting in place would make the caller's array's order a side effect of a function whose name
 * says "in order" — and the sequences this is used on are frequently `readonly` views of a cache.
 *
 * @param items - The sequence to order.
 * @param keyOf - The string key to order it by.
 * @returns A new array in {@link compareCasePaths} order.
 */
export function inCaseOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareCasePaths(keyOf(a), keyOf(b)));
}
