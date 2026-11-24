/**
 * The cutoff-average metric, and the floor it shares with every competitor that reports it.
 *
 * ## Why this module exists
 *
 * `sota-comparison.md` holds two families of external numbers that were not comparable to ours: a competitor
 * publishing `Avg@5` and this project publishing `AC@1`. The register recorded that as "not comparable directly"
 * and left it there for three iterations. It is not a definitional gap. `Avg@5` is defined by the abbreviations
 * table of DeCoR (`DOI 10.1186/s13677-026-01009-x`, "Average accuracy over the first five cutoffs") and by
 * `arXiv:2603.02057` as `Avg@k = (1/k) Σ_{j=1..k} AC@j`, and `AC@j` is a step function of one integer — the rank at
 * which the accepted answer first appears. So both numbers are functions of the SAME per-case integer, and every
 * `Avg@5` this project could be compared against is computable from a `truthRank` column it already writes.
 *
 * ## What the metric is not
 *
 * `Avg@5` is not a weaker `AC@1`; it is a different question, and on this benchmark it is a much easier one,
 * because the candidate pool is small. A uniformly random order over a pool of `n` scores
 * `(1/(n·k)) Σ_{j=1..k} min(j, n)` — `0.700` at `n = 4`, `0.500` at `n = 6`, `0.047` at `n = 64`. So a cell whose
 * pool holds four services pays `0.70` for reading no telemetry at all, and an `Avg@5` of `0.4864` on such a cell
 * would be BELOW chance. That is why `uniformFloor` is not decoration: a cutoff average quoted without the floor of
 * its own pool is a number whose scale is unknown, and this repository has already been burned once by quoting an
 * external figure without the population it was measured on.
 *
 * ## Why it is exact rather than sampled
 *
 * The floor is a closed form, not a simulation: the expectation of a step function over a uniform permutation has a
 * closed form, and a Monte-Carlo estimate of it would be a number with an error bar standing in for a number
 * without one. `uniformFloor` therefore carries the double sum's closed form and its tests assert the algebra
 * against an enumeration, so the formula and the definition cannot drift apart.
 */

/** One case, reduced to the only integer either metric reads. */
export interface CutoffCase {
  /** Stable identifier, carried so a refusal can name the row that produced it. */
  readonly caseId: string;
  /** The cell the case belongs to (`RE1:SockShop`), which is how a competitor's dataset is matched. */
  readonly cell: string;
  /** The first 1-based position at which an accepted answer appears, or `null` when it appears nowhere. */
  readonly hitRank: number | null;
  /** How many candidates the order could have placed — the pool the floor is computed over. */
  readonly pool: number;
}

/** A population's reading under one cutoff. */
export interface CutoffReading {
  /** The cutoff `k` this reading was taken at. */
  readonly k: number;
  /** Cases with a non-empty accepted set. */
  readonly cases: number;
  /** `AC@j` for `j = 1..k`, in that order. */
  readonly ac: readonly number[];
  /** `Avg@k`, the mean of `ac`. */
  readonly avg: number;
  /** The mean of the per-case uniform floors, over the SAME cases — never over a nominal pool size. */
  readonly floor: number;
  /** Cases whose accepted answer is absent from the order entirely: unreachable at every cutoff, by construction. */
  readonly absent: number;
}

/** One cell's reading, plus the pooled reading over every cell. */
export interface CutoffTable {
  readonly k: number;
  readonly cells: readonly (CutoffReading & { readonly cell: string })[];
  readonly pooled: CutoffReading;
}

/**
 * The first 1-based position at which an accepted answer appears.
 *
 * `null` is the metric's own statement of "unreachable", and it is distinct from a large rank: a case whose answer
 * appears nowhere contributes `0` to every cutoff, which is what `absent` counts separately rather than letting it
 * hide among the misses.
 */
export function hitRank(ranked: readonly string[], accepted: readonly string[]): number | null {
  for (let index = 0; index < ranked.length; index += 1) {
    if (accepted.includes(ranked[index]!)) return index + 1;
  }
  return null;
}

/** Refuse a cutoff that is not a positive integer, because a fractional one would silently shift every row. */
function requireCutoff(k: number): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`the cutoff must be a positive integer, got ${String(k)}`);
  }
  return k;
}

/** `AC@k` for one case: whether the accepted answer is inside the first `k` positions. */
export function acAt(rank: number | null, k: number): number {
  requireCutoff(k);
  return rank !== null && rank >= 1 && rank <= k ? 1 : 0;
}

/**
 * `Avg@k` for one case: the mean of `AC@1 .. AC@k`.
 *
 * Written as the mean of the indicator rather than as `max(0, k + 1 - rank) / k` on purpose — the two are equal,
 * and only the first is the definition. A closed form that a reader must verify against the definition before
 * trusting it is a second implementation of the metric, and this repository has already had one instrument whose
 * hand-derived shortcut and whose definition disagreed.
 */
export function avgAt(rank: number | null, k: number): number {
  requireCutoff(k);
  let total = 0;
  for (let j = 1; j <= k; j += 1) total += acAt(rank, j);
  return total / k;
}

/**
 * The expected `Avg@k` of a uniformly random order over a pool of `n`.
 *
 * `(1/(n·k)) Σ_{j=1..k} min(j, n)`: the sum counts, for each cutoff `j`, how many of the `n` equi-probable ranks
 * fall inside it. For `n >= k` it collapses to `(k + 1) / (2n)`, which is the form the docstring above quotes.
 */
export function uniformFloor(k: number, pool: number): number {
  requireCutoff(k);
  if (!Number.isInteger(pool) || pool < 1) {
    throw new Error(`a pool must be a positive integer, got ${String(pool)}`);
  }
  let inside = 0;
  for (let j = 1; j <= k; j += 1) inside += Math.min(j, pool);
  return inside / (pool * k);
}

/** Read one population at one cutoff. */
export function readCutoffs(cases: readonly CutoffCase[], k: number): CutoffReading {
  requireCutoff(k);
  const ac = Array.from({ length: k }, () => 0);
  let avg = 0;
  let floor = 0;
  let absent = 0;
  for (const one of cases) {
    for (let j = 1; j <= k; j += 1) ac[j - 1] = ac[j - 1]! + acAt(one.hitRank, j);
    avg += avgAt(one.hitRank, k);
    floor += uniformFloor(k, one.pool);
    if (one.hitRank === null) absent += 1;
  }
  const n = cases.length;
  return {
    k,
    cases: n,
    ac: ac.map((value) => (n === 0 ? 0 : value / n)),
    avg: n === 0 ? 0 : avg / n,
    floor: n === 0 ? 0 : floor / n,
    absent,
  };
}

/**
 * Read every cell of a corpus, then the pool of them.
 *
 * The pooled reading is computed over the CASES, not as a mean of the cell means: a corpus of one 30-case cell and
 * one 125-case cell must not let the thirty weigh a sixth of the answer. Cells are ordered by name so two runs of
 * the same corpus print the same table.
 */
export function cutoffTable(cases: readonly CutoffCase[], k: number): CutoffTable {
  requireCutoff(k);
  const byCell = new Map<string, CutoffCase[]>();
  for (const one of cases) {
    const bucket = byCell.get(one.cell);
    if (bucket === undefined) byCell.set(one.cell, [one]);
    else bucket.push(one);
  }
  const cells = [...byCell.keys()]
    .sort()
    .map((cell) => ({ cell, ...readCutoffs(byCell.get(cell)!, k) }));
  return { k, cells, pooled: readCutoffs(cases, k) };
}

/**
 * One row of the loss census, which is the file every RCAEval cell is read from.
 *
 * The census carries both the ORDER's first hit (`truthRank`) and the published ANSWER's correctness (`correct`).
 * On the last full census they agree to the case on every one of the nine cells, and that agreement is itself the
 * measurement rather than a redundancy: `truthRank` is a position in the PUBLISHED order, so this artifact cannot
 * see the reordering the engine applies after it scores. The pair is printed anyway, because a divergence — a
 * published answer chosen by any rule other than "first in the order" — would be a finding, and a reader that had
 * only one of the two columns could not tell it had happened.
 */
export interface CensusRow extends CutoffCase {
  /** Whether the published answer was accepted. `AC@1` of the ANSWER, where `hitRank === 1` is `AC@1` of the ORDER. */
  readonly correct: boolean;
  /**
   * Whether the row carries `truthRank` at all.
   *
   * This is not a detail of the file format. Nine of the 735 census rows of the last full RCAEval run have no
   * `truthRank` column, so a reader that treated the absence as "rank zero" would silently score nine cases as
   * misses and report a cutoff average over a population it never measured. The flag keeps those rows in the
   * ANSWER's population and out of the ORDER's, which is the only assignment the artifact supports.
   */
  readonly rankMeasured: boolean;
}

/** The fields any census line must carry for either number to be computable. */
function censusField(record: Record<string, unknown>, key: string, line: number): unknown {
  if (!(key in record)) throw new Error(`census line ${String(line)} has no \`${key}\``);
  return record[key];
}

/**
 * Parse one census line, refusing every shape the metric would have to guess at.
 *
 * Three refusals are load-bearing rather than defensive: a missing `truthRank` is not a rank of zero, a `pool` of
 * zero would make the floor a division by zero, and `correct` on a case whose answer is absent from the order is a
 * contradiction between two columns of the same file — the shape of defect that a reader must surface instead of
 * averaging away.
 */
export function parseCensusLine(raw: string, line: number): CensusRow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`census line ${String(line)} is not JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`census line ${String(line)} is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  const caseId = censusField(record, 'caseId', line);
  const cell = censusField(record, 'cell', line);
  if (typeof caseId !== 'string' || caseId.length === 0) {
    throw new Error(`census line ${String(line)} has no caseId`);
  }
  if (typeof cell !== 'string' || cell.length === 0) {
    throw new Error(`census line ${String(line)} has no cell`);
  }
  const rank = 'truthRank' in record ? record['truthRank'] : undefined;
  let hitRankOfRow: number | null;
  let rankMeasured: boolean;
  if (rank === undefined) {
    // The column is absent, which is a population the ORDER metric cannot reach — not a rank of zero.
    hitRankOfRow = null;
    rankMeasured = false;
  } else {
    rankMeasured = true;
    if (rank === null) hitRankOfRow = null;
    else if (Number.isInteger(rank) && (rank as number) >= 1) hitRankOfRow = rank as number;
    else
      throw new Error(
        `census line ${String(line)} (${caseId}) has an unusable truthRank ${String(rank)}`,
      );
  }
  const pool = censusField(record, 'pool', line);
  if (!Number.isInteger(pool) || (pool as number) < 1) {
    throw new Error(`census line ${String(line)} (${caseId}) has no usable pool`);
  }
  const correct = censusField(record, 'correct', line);
  if (typeof correct !== 'boolean') {
    throw new Error(`census line ${String(line)} (${caseId}) has no boolean \`correct\``);
  }
  if (correct && rankMeasured && hitRankOfRow === null) {
    throw new Error(
      `census line ${String(line)} (${caseId}) is correct on an answer the order does not contain`,
    );
  }
  return { caseId, cell, hitRank: hitRankOfRow, pool: pool as number, correct, rankMeasured };
}

/**
 * Split a census into the population the cutoff metric can reach and the rows whose order was never written.
 *
 * The two populations are not interchangeable: the answer's `AC@1` is defined on every row, and every cutoff is
 * defined only on the measured ones. Returning both, rather than filtering at the call site, is what stops a reader
 * from reporting two percentages over two populations as if they shared a denominator.
 */
export function censusPopulations(rows: readonly CensusRow[]): {
  readonly measured: readonly CutoffCase[];
  readonly unmeasured: number;
} {
  return {
    measured: rows.filter((one) => one.rankMeasured),
    unmeasured: rows.filter((one) => !one.rankMeasured).length,
  };
}

/**
 * The rate at which the published ANSWER is accepted — `AC@1` of the answer, not of the order.
 *
 * It reads the same as the order's `AC@1` on the last full census, and that identity is a property of the ARTIFACT
 * (its `truthRank` is a position in the published order) rather than a theorem about the engine: the 1 422-case
 * surface, whose term dump carries the sum's own order beside the published one, shows the two differ by 83 cases
 * there. Both are computed here so that a reading can never quote one while meaning the other.
 */
export function publishedRate(rows: readonly CensusRow[]): {
  readonly cases: number;
  readonly correct: number;
  readonly rate: number;
} {
  const correct = rows.filter((one) => one.correct).length;
  return { cases: rows.length, correct, rate: rows.length === 0 ? 0 : correct / rows.length };
}

/** A percentage with one decimal, which is the resolution every cell in the register is quoted at. */
function pct(value: number): string {
  return `${(100 * value).toFixed(1)} %`;
} /** Render one reading as the row of a table, so a cell and the pool of cells print the same columns. */
function row(label: string, reading: CutoffReading): string {
  const ac = reading.ac.map((value) => pct(value).padStart(7)).join('  ');
  return (
    `${label.padEnd(22)} ${String(reading.cases).padStart(4)}  ${ac}  ` +
    `${pct(reading.avg).padStart(7)}  ${pct(reading.floor).padStart(7)}  ${String(reading.absent).padStart(3)}`
  );
}

/** Render a table with its header. The floor travels with every row because that is the whole point of it. */
export function formatCutoffs(table: CutoffTable): string {
  const k = table.k;
  const heads = Array.from({ length: k }, (_, index) => `AC@${String(index + 1)}`.padStart(7)).join(
    '  ',
  );
  const lines = [
    `cutoff ${String(k)} — accuracy at each cut, the mean of them, and the floor a random order of the same pool pays`,
    `${'cell'.padEnd(22)} ${'n'.padStart(4)}  ${heads}  ${'Avg'.padStart(7)}  ${'floor'.padStart(7)}  ${'abs'.padStart(3)}`,
  ];
  for (const one of table.cells) lines.push(row(one.cell, one));
  lines.push(row('pooled', table.pooled));
  return lines.join('\n');
}
