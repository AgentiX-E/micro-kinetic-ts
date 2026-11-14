/**
 * The stratified 500: a subsample that is smaller than the corpus without being a smaller scope.
 *
 * The published 90.0 % on RCABench rests on a **500-case random sample** of 1 430 (`arXiv:2608.21310`), so any
 * comparison against it has to be made at a comparable n. Taking the first 500 datapacks would be cheaper still
 * and would be wrong: the archive is ordered by fault family, so the first 500 are a handful of families, and
 * every "which families did this move" question the per-case verdicts answer would become unanswerable.
 *
 * Three design decisions, each of which is a test:
 *
 * 1. **Strata are the axes the conclusions are drawn on** — fault family, engine correctness, causal-chain depth.
 *    A subsample that preserves each cell's share within a case is a subsample whose aggregate estimates the corpus
 *    aggregate rather than a different population's.
 * 2. **Every non-empty stratum is kept when the budget allows it** (floor of three), because a family that vanishes
 *    from the arm is a family the arm cannot report on, and a report that silently omits a fault type is worse than
 *    a report over fewer cases.
 * 3. **Within a stratum the selection is by hash of the case id, not by index.** Deterministic, so two runs of the
 *    same corpus select the same cases; scattered, so the selection is not a function of the archive's file order,
 *    which correlates with `datapack` naming and therefore with family.
 *
 * A shortfall is reported rather than absorbed: if the target exceeds what the strata can supply, the plan says so
 * with `shortfall`, because a target that quietly became a smaller target is how a benchmark arm ends up reporting
 * on 480 cases while calling itself the 500-case arm.
 *
 * Zero IO: the caller hands in one record per case.
 */

/** One case, reduced to the axes the sample has to preserve. */
export interface SamplingRecord {
  /** Stable identity of the case (`datapack` for FSE'26, `datasetId` for RCAEval). */
  readonly caseId: string;
  /** Fault family exactly as the corpus labels it (`cpu`, `mem`, `PodKill`, ...). */
  readonly faultType: string;
  /** Length of the fault-propagation chain, 1-based. Absent when the corpus does not publish one. */
  readonly depth?: number;
  /** Whether the engine under measurement already ranks the truth first. */
  readonly engineCorrect: boolean;
}

/** One cell of the plan, with both the population it came from and what the plan took. */
export interface StratumCoverage {
  readonly faultType: string;
  /** Absent when the corpus publishes no depth; kept absent rather than coerced to a sentinel. */
  readonly depth?: number;
  readonly engineCorrect: boolean;
  /** Cases in this cell in the full corpus. */
  readonly population: number;
  /** Cases the plan takes from this cell. */
  readonly selected: number;
}

/** What the plan decided, and everything a reader needs to check it. */
export interface SamplingPlan {
  /** Selected case ids, in the order they will be run (stratum order, then hash order within a stratum). */
  readonly selected: readonly string[];
  /** Every non-empty stratum, including those the plan could not afford (with `selected: 0`). */
  readonly strata: readonly StratumCoverage[];
  /** The target that was asked for, clamped to the corpus size. */
  readonly target: number;
  /** The per-stratum floor the budget supported. Zero means the target was smaller than the stratum count. */
  readonly floor: number;
  /** `target - selected.length`. Non-zero means the request was not satisfiable. */
  readonly shortfall: number;
}

/** What the plan may assume. */
export interface SamplingOptions {
  /** Smallest number of cases a non-empty stratum gets, when the budget allows. Default 3. */
  readonly minPerStratum?: number;
  /**
   * Hash used to scatter the selection within a stratum. Defaults to {@link hashId}.
   *
   * An injection point rather than a constant, for the reason every ordering rule in this repository has one: a
   * rule whose only implementation is a well-distributed hash cannot be tested at its ties, and a tie is exactly
   * where an ordering rule is wrong. Handing in a constant hash exercises the tie-break arm.
   */
  readonly hash?: (caseId: string) => number;
}

/**
 * FNV-1a over UTF-16 code units, as an unsigned 32-bit integer.
 *
 * A hash rather than a random source because the plan has to be reproducible from the corpus alone — the same 500
 * cases on every machine, with no seed to store. A hash rather than the case id itself because the id carries the
 * archive's naming order, and ordering by it would concentrate the sample in whichever families sort first.
 *
 * @param text - The string to hash.
 * @returns An unsigned 32-bit integer.
 */
export function hashId(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The values that identify a stratum, before they are flattened into a map key. */
function stratumOf(record: SamplingRecord): {
  faultType: string;
  depth: number | undefined;
  engineCorrect: boolean;
} {
  return { faultType: record.faultType, depth: record.depth, engineCorrect: record.engineCorrect };
}

/**
 * The map key for a stratum, and the order strata are emitted in.
 *
 * One string rather than a three-key comparison, because a three-key comparison ends in a `return 0` arm that no
 * input can reach — the map has already merged equal strata — and an unreachable arm is dead code that the
 * coverage gate would either flag forever or be taught to ignore. A key comparison has two outcomes and both are
 * reachable; the equality it gives up cannot occur, and {@link stratifiedSample} relies on that rather than
 * claiming it in a comment.
 *
 * Depth is zero-padded so that a corpus numbered to two digits sorts numerically: `01 < 02 < 10`, which the plain
 * decimal form would order as `1 < 10 < 2`.
 */
function stratumKeyOf(stratum: {
  faultType: string;
  depth: number | undefined;
  engineCorrect: boolean;
}): string {
  const depth = stratum.depth === undefined ? '*' : String(stratum.depth).padStart(2, '0');
  return `${stratum.faultType}\u0000${depth}\u0000${stratum.engineCorrect ? '1' : '0'}`;
}

/** One stratum while the plan is being built. */
interface WorkingStratum {
  readonly faultType: string;
  readonly depth: number | undefined;
  readonly engineCorrect: boolean;
  readonly members: SamplingRecord[];
  take: number;
}

/**
 * Builds a stratified subsample of the given size.
 *
 * The allocation has three steps, and the order matters:
 *
 * 1. **Ideal share** `q_i = target × n_i / N`, in real arithmetic.
 * 2. **Floor first**: `take_i = max(floor, ⌊q_i⌋)`, capped at `n_i`. A floor applied *after* rounding is a floor
 *    that can be missed exactly where it matters — a family of four in a corpus of 1 422 gets a share of 1.4 and
 *    would otherwise round down to 1 or up to 2 depending on the remainder.
 * 3. **Largest remainder** over `q_i − take_i`, descending, skipping strata at capacity. A stratum the floor
 *    already over-served has a negative remainder and therefore goes last.
 *
 * @param records - One record per case in the corpus.
 * @param target - How many cases the arm may run. Clamped to the corpus size.
 * @param options - See {@link SamplingOptions}.
 * @returns The plan, its per-stratum coverage, and any shortfall.
 */
export function stratifiedSample(
  records: readonly SamplingRecord[],
  target: number,
  options: SamplingOptions = {},
): SamplingPlan {
  const minPerStratum = options.minPerStratum ?? 3;
  const hash = options.hash ?? hashId;
  const population = records.length;
  const wanted = Math.max(0, Math.min(Math.floor(target), population));

  // A case may appear once. A duplicate id would be sampled twice, counted twice in the arm's accuracy, and
  // invisible in the coverage table — a corpus defect that reads as a method result. Refused here rather than
  // tolerated, and the refusal is why the tie-break inside a stratum needs no equality arm.
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.caseId)) {
      throw new RangeError(`duplicate case id in sampling corpus: ${record.caseId}`);
    }
    seen.add(record.caseId);
  }

  const groups = new Map<string, WorkingStratum>();
  for (const record of records) {
    const key = stratumKeyOf(stratumOf(record));
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, { ...stratumOf(record), members: [record], take: 0 });
    } else {
      existing.members.push(record);
    }
  }
  // Sorted by key, and a strict comparison with no equality arm: the map guarantees distinct keys, so the left
  // side being smaller and the right side being smaller are the only two cases that can occur.
  const strata = [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, stratum]) => stratum);

  // The floor is only affordable when the target covers one case per stratum. Below that the plan cannot keep
  // every family, and it says so with a floor of zero rather than by silently dropping families.
  const floor =
    wanted >= strata.length * minPerStratum ? minPerStratum : wanted >= strata.length ? 1 : 0;

  let allocated = 0;
  const shares: { stratum: WorkingStratum; exact: number }[] = [];
  for (const stratum of strata) {
    // `strata` is non-empty only when `records` is, so the population here is never zero.
    const exact = (wanted * stratum.members.length) / population;
    const share = Math.max(floor, Math.floor(exact));
    stratum.take = Math.min(stratum.members.length, share);
    allocated += stratum.take;
    shares.push({ stratum, exact });
  }

  // The floor can overspend: a stratum smaller than the floor takes only what it has, while every other stratum
  // still takes the full floor, and the sum then exceeds the target. Overspending is the one failure this plan
  // cannot tolerate — the arm would run more cases than it announced — so the excess is clawed back from the
  // strata that are ABOVE their floor, largest surplus first. Clawing back from the smallest strata instead would
  // defeat the floor: a family of two would be cut to one to pay for a family of two hundred, which is precisely
  // the vanishing this plan exists to prevent.
  if (allocated > wanted) {
    const surplus = (stratum: WorkingStratum): number => stratum.take - floor;
    // `shares` is built in stratum-key order and `Array.prototype.sort` is stable (ES2019), so equal surplus keeps
    // the key order without a second comparison. A tie-break here would be a branch no input can take a second
    // side of, because the input to the sort is already ordered by the very key it would compare.
    const donors = [...shares].sort((a, b) => surplus(b.stratum) - surplus(a.stratum));
    for (const donor of donors) {
      while (allocated > wanted && surplus(donor.stratum) > 0) {
        donor.stratum.take -= 1;
        allocated -= 1;
      }
    }
  }

  // Three facts hold here, and the loop below relies on all of them rather than guarding against their negation:
  //
  //   - `budget > 0` implies `allocated < wanted`, which implies no stratum was raised by the floor (a raising
  //     would have pushed the sum to or past the target), which implies every `take` is `⌊exact⌋ < members`;
  //   - so no stratum is at capacity while the loop runs, and the `continue` a defensive version would carry
  //     cannot be reached;
  //   - and `strata` is non-empty whenever `wanted > 0`, so each pass assigns at least once and the loop
  //     terminates without a progress flag.
  //
  // Guards for unreachable states are dead code that the coverage gate either flags forever or is taught to
  // ignore, and this repository has spent two iterations removing the second kind.
  shares.sort((a, b) => b.exact - b.stratum.take - (a.exact - a.stratum.take));
  let budget = wanted - allocated;
  while (budget > 0) {
    for (const entry of shares) {
      if (budget === 0) break;
      entry.stratum.take += 1;
      budget -= 1;
    }
  }

  const selected: string[] = [];
  const coverage: StratumCoverage[] = [];
  for (const stratum of strata) {
    const ordered = [...stratum.members].sort((a, b) => {
      const hashA = hash(a.caseId);
      const hashB = hash(b.caseId);
      // Case ids are unique (asserted above), so the tie-break is a strict order with no equality arm.
      return hashA !== hashB ? hashA - hashB : a.caseId < b.caseId ? -1 : 1;
    });
    for (const record of ordered.slice(0, stratum.take)) selected.push(record.caseId);
    coverage.push({
      faultType: stratum.faultType,
      depth: stratum.depth,
      engineCorrect: stratum.engineCorrect,
      population: stratum.members.length,
      selected: stratum.take,
    });
  }

  return {
    selected,
    strata: coverage,
    target: wanted,
    floor,
    shortfall: wanted - selected.length,
  };
}
