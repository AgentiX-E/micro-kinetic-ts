/**
 * What a transcript cap did, read from two artifacts rather than from an argument about them.
 *
 * ## The question, and why the obvious answer is the wrong one
 *
 * A transcript cap trades tokens for evidence: the model sees fewer results, so it may investigate differently, answer
 * differently, or both. The obvious acceptance test — "accuracy did not move" — is the weakest one available here,
 * because accuracy is a sum over 1 422 cases and a cap that repairs one and breaks one is indistinguishable from a cap
 * that changes nothing.
 *
 * `CoACT` (`arXiv:2607.02911`, ICSE 2027) names the stronger test and the argument for it: an agent's loop is
 * "read the observation, choose an action, receive the next observation", and if the environment is deterministic then
 * **preserving the next action preserves everything after it**. So the object to compare is not the text but the
 * trajectory: the directives in order, plus the answer.
 *
 * This harness already records both — `calls` has been on every row since iteration 341 and `answer` since 318 — so
 * the strongest available test for a cap costs no model call, no judge, and no second dispatch.
 *
 * ## What it deliberately does not claim
 *
 * A preserved trajectory is evidence that the cap did not change *this* investigation; it is not evidence that the
 * cap is safe in general, because the arm may react to elided content in a way that happens not to change its next
 * move on these cases. And the count is over the cases both artifacts carry, which is the sample the dispatch drew and
 * not the corpus.
 *
 * @module benchmarks/src/transcript-reading
 */

/** One row of an arm artifact, in the fields a cap reading touches. */
export interface CapRow {
  readonly datapack: string;
  readonly answer: string | null;
  /** The directives the investigation executed, in order. */
  readonly calls: readonly string[];
  readonly correct: boolean;
  readonly rounds: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheHitTokens?: number;
  readonly turnTokens?: readonly number[];
  /**
   * The cache-served share of each call, or absent on an artifact written before the column existed.
   *
   * A call column rather than a case total, because the question a cap raises is WHICH tokens it removed: `turnTokens`
   * says what each call was charged, this says how much of each call the endpoint charged at the cached rate, and the
   * difference between the two is the only place a cap's saving can appear.
   */
  readonly turnHitTokens?: readonly number[];
  readonly turnLatencyMs?: readonly number[];
}

/** The directives and the answer: the whole of what a cap can change that the record can see. */
export interface Trajectory {
  readonly calls: readonly string[];
  readonly answer: string | null;
}

/** One column of the growth curve: the prompt the N-th call carried, averaged over the cases that made it. */
export interface CallPoint {
  /** 1-based call index. */
  readonly call: number;
  /** How many paired cases made this call — the denominator of {@link mean}. */
  readonly cases: number;
  readonly mean: number;
}

/** A money-and-time pair, one per artifact. */
export interface PairOf<T> {
  readonly anchor: T;
  readonly capped: T;
}

/** The paired reading of two artifacts. */
export interface CapReading {
  /** Cases both artifacts carry. Every count below is over these. */
  readonly shared: number;
  /** Cases only the anchor carries. */
  readonly onlyAnchor: number;
  /** Cases only the capped artifact carries. */
  readonly onlyCapped: number;
  /** Cases whose directives AND answer are unchanged. */
  readonly trajectoryPreserved: number;
  /** Cases whose DIRECTIVES changed, whatever the answer did. */
  readonly trajectoryChanged: number;
  /** Cases whose ANSWER changed, whatever the directives did. */
  readonly answerChanged: number;
  /** Cases the cap got right and the anchor got wrong. */
  readonly gains: number;
  /** Cases the anchor got right and the cap got wrong. */
  readonly losses: number;
  /** Prompt tokens in total, on the shared cases. */
  readonly tokens: PairOf<number>;
  /** Completion tokens in total, on the shared cases: the part a cap does not touch, and a bill must still carry. */
  readonly completion: PairOf<number>;
  /** Prompt tokens the endpoint did NOT serve from cache: the part a cap can actually remove. */
  readonly uncached: PairOf<number>;
  /** Model time in milliseconds, or `null` when either artifact did not record it. */
  readonly latencyMs: PairOf<number> | null;
}

/** The trajectory of one row. */
export function trajectoryOf(row: CapRow): Trajectory {
  return { calls: row.calls, answer: row.answer };
}

/** Whether two trajectories are the same, field by field and position by position. */
function sameTrajectory(a: Trajectory, b: Trajectory): boolean {
  if (a.answer !== b.answer) return false;
  if (a.calls.length !== b.calls.length) return false;
  return a.calls.every((call, index) => call === b.calls[index]);
}

/** Sum a column over the rows that carry it, or `null` when no row does. */
function sumOf(
  rows: readonly CapRow[],
  read: (row: CapRow) => readonly number[] | undefined,
): number | null {
  // Read ONCE per row and narrow, rather than filtering on one read and summing with a second: two reads of the same
  // field is how a `?? []` comes to sit inside a function that already knows the value is there, and a coalesce on a
  // value that cannot be absent is a branch no artifact can reach.
  const columns = rows
    .map(read)
    .filter((column): column is readonly number[] => column !== undefined);
  if (columns.length === 0) return null;
  return columns.reduce((total, column) => total + column.reduce((sum, one) => sum + one, 0), 0);
}

/**
 * Read a capped artifact against its anchor.
 *
 * @param anchor - The rows of the run the cap is measured against.
 * @param capped - The rows of the run that used the cap.
 * @returns The paired reading, with every count over the shared cases.
 */
export function capReadingOf(anchor: readonly CapRow[], capped: readonly CapRow[]): CapReading {
  const cappedOf = new Map(capped.map((row) => [row.datapack, row]));
  const shared = anchor.filter((row) => cappedOf.has(row.datapack));

  let trajectoryPreserved = 0;
  let trajectoryChanged = 0;
  let answerChanged = 0;
  let gains = 0;
  let losses = 0;
  for (const before of shared) {
    const after = cappedOf.get(before.datapack)!;
    if (sameTrajectory(trajectoryOf(before), trajectoryOf(after))) trajectoryPreserved += 1;
    // The two counts are NOT exclusive and are not meant to be: a case whose directives moved AND whose answer moved
    // is one case that changed in two ways, and collapsing it into one number would hide which of the two the cap did.
    if (before.calls.join('\u0000') !== after.calls.join('\u0000')) trajectoryChanged += 1;
    if (before.answer !== after.answer) answerChanged += 1;
    if (after.correct && !before.correct) gains += 1;
    if (before.correct && !after.correct) losses += 1;
  }

  // `shared` is DEFINED by membership in `cappedOf`, so the lookup cannot miss and a `?? 0` here would be a branch
  // that exists only to make the compiler quiet — the kind of dead default that hides a real one later.
  const tokens = {
    anchor: shared.reduce((sum, row) => sum + row.promptTokens, 0),
    capped: shared.reduce((sum, row) => sum + cappedOf.get(row.datapack)!.promptTokens, 0),
  };
  const completion = {
    anchor: shared.reduce((sum, row) => sum + row.completionTokens, 0),
    capped: shared.reduce((sum, row) => sum + cappedOf.get(row.datapack)!.completionTokens, 0),
  };
  // A missing cache column is not zero hits: it is an artifact that cannot say, and reading it as zero would attribute
  // the whole prompt to the cap's reach. Absence therefore prices every token as uncached, which is the upper bound.
  const uncachedOf = (row: CapRow): number => row.promptTokens - (row.cacheHitTokens ?? 0);

  const anchorClock = sumOf(shared, (row) => row.turnLatencyMs);
  const cappedClock = sumOf(shared, (row) => cappedOf.get(row.datapack)?.turnLatencyMs);
  const latencyMs =
    anchorClock === null || cappedClock === null
      ? null
      : { anchor: anchorClock, capped: cappedClock };

  return {
    shared: shared.length,
    onlyAnchor: anchor.length - shared.length,
    onlyCapped: capped.length - shared.length,
    trajectoryPreserved,
    trajectoryChanged,
    answerChanged,
    gains,
    losses,
    tokens,
    completion,
    uncached: {
      anchor: shared.reduce((sum, row) => sum + uncachedOf(row), 0),
      capped: shared.reduce((sum, row) => sum + uncachedOf(cappedOf.get(row.datapack)!), 0),
    },
    latencyMs,
  };
}

/**
 * The growth curve: what the N-th call of an investigation carried, averaged over the cases that made it.
 *
 * A total cannot price a cap. The prompt is an OPENING — the incident line, the gate, the seed list — repeated on
 * every call, plus a TRANSCRIPT that grows; a `--transcript-chars` wall can only remove the second. Averaging per call
 * index separates them, because the opening is in every point of the curve and the transcript is in the growth.
 *
 * The column is a PARAMETER because there are two curves and they do not answer the same question: `turnTokens` says
 * how big each call was, `turnHitTokens` says how much of it the endpoint served from cache. A cap that removes
 * tokens from the cached region shrinks the first curve while leaving the second untouched — the pattern iteration 354
 * had to infer from two totals, and the one a curve can state.
 *
 * @param rows - The artifact's rows.
 * @param read - Which per-call column to average.
 * @returns One point per call index that at least one row reached, or `[]` when no row carries the column.
 */
export function perCallCurveOf(
  rows: readonly CapRow[],
  read: (row: CapRow) => readonly number[] | undefined,
): CallPoint[] {
  const sums = new Map<number, { total: number; cases: number }>();
  for (const row of rows) {
    // Read once and skip: a `?? []` here would put a coalesce on a column that is absent by design on every artifact
    // older than this reading, and an empty column is not a zero-token call.
    const column = read(row);
    if (column === undefined) continue;
    for (const [index, tokens] of column.entries()) {
      const call = index + 1;
      const point = sums.get(call) ?? { total: 0, cases: 0 };
      point.total += tokens;
      point.cases += 1;
      sums.set(call, point);
    }
  }
  return [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([call, point]) => ({ call, cases: point.cases, mean: point.total / point.cases }));
}

/** A percentage with a sign, at the resolution the paired counts are reported at. */
function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(2)} %`;
}

/**
 * The verdict, in the words a reader needs — and in the order the acceptance test implies.
 *
 * The trajectory comes first because it is the acceptance test, not a summary of one: an arm that looked at the same
 * evidence in the same order and named the same service is an arm a cap did not change, whatever the accuracy column
 * says afterwards.
 *
 * @param reading - The paired reading.
 * @returns One line per finding, in reading order.
 */
export function capVerdictOf(reading: CapReading): string[] {
  const signed = (value: number): string =>
    `${value >= 0 ? '-' : '+'}${Math.abs(value).toFixed(2)} %`;
  const saved = reading.uncached.anchor - reading.uncached.capped;
  const unpaired =
    reading.onlyAnchor === 0 && reading.onlyCapped === 0
      ? ''
      : ` (only anchor ${String(reading.onlyAnchor)}, only capped ${String(reading.onlyCapped)})`;
  return [
    `transcript cap — paired on ${String(reading.shared)} cases${unpaired}`,
    `trajectory preserved ${String(reading.trajectoryPreserved)} (${pct(reading.trajectoryPreserved, reading.shared)})` +
      ` · directives changed ${String(reading.trajectoryChanged)} · answer changed ${String(reading.answerChanged)}`,
    `accuracy: +${String(reading.gains)} gained / -${String(reading.losses)} lost`,
    // SIGNED, and never clamped: a cap that removes cache-served tokens can make the uncached total RISE, and a line
    // that reported `max(0, saved)` would print "0.00 % removed" for a run whose uncached tokens grew — the one reading
    // that cannot be true, on the one measurement this module exists to take.
    `uncached prompt ${reading.uncached.anchor.toLocaleString('en-US')} -> ${reading.uncached.capped.toLocaleString('en-US')} tokens` +
      ` (${signed((saved / Math.max(reading.uncached.anchor, 1)) * 100)}${saved < 0 ? ', the cap ADDED tokens' : ''})`,
    `model time ${reading.latencyMs === null ? 'not recorded' : `${String(reading.latencyMs.anchor)} -> ${String(reading.latencyMs.capped)} ms`}`,
  ];
}
