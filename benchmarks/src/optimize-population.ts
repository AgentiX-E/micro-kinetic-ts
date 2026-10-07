/**
 * What the L2 weight search's corpus actually contained, as data a test can check.
 *
 * ## Why this exists
 *
 * `optimize-rcaeval-results` reported `loaded 199 cases`, `split: train=140 val=27 test=32` and three
 * accuracies — and nothing about WHICH cases those were. Three questions a reader of that artifact cannot
 * answer, all of which decide whether its numbers mean what they appear to mean:
 *
 * 1. **Did the search see all three systems?** The down-sample preserves each `system:suite` stratum's share
 *    (`strata` are `ob:re1`, `ss:re2`, …), so it SHOULD — but an artifact that says "RCAEval" and reports one
 *    number cannot show it, and the thing being tuned is a set of weights applied to all three.
 * 2. **Is every fault type represented in the held-out splits?** The train/val/test split strata are
 *    `system:suite:fault` — 54 possible — and `val=27` / `test=32` cannot hold one case of each. Which fault
 *    types are MISSING from the set the "Generalization (held-out)" line is measured on is not a detail: a
 *    fault type absent from test contributes nothing to that number and nothing says so.
 * 3. **Was `rankNormalization` even acting on this corpus?** The engine's topology guard is
 *    `nodes >= ANOMALY_NORMALIZE_NODE_THRESHOLD`, so on a corpus of small graphs the rescale this repository
 *    keeps ON is INERT — and the previous iteration's prediction that the alignment would move this
 *    artifact's numbers could not be checked because the artifact never said how many cases were large
 *    enough for it to act.
 *
 * The third is the one that was actually load-bearing, and it is the reason this module takes the node count
 * rather than a summary of it: whether a run's flag acted is a property of the POPULATION, and a population
 * that is not stated cannot be reasoned about after the fact.
 *
 * @module benchmarks/optimize-population
 */

// The SPECIFIC module, never the package barrel. The barrel re-exports `persistence.js`, which imports
// `@agentix-e/micro-kinetic-storage-fs` — a workspace package the benchmarks test environment does not
// resolve, so reaching the barrel from here fails at COLLECT time with "Failed to resolve entry for package".
// Every other benchmarks module follows this convention (`config-space.js`, `integration.js`,
// `optimizer.js`); `run-optimize.ts` uses the barrel only for a TYPE, which is erased at runtime. The first
// version of this file imported the barrel, passed locally — where resolution differs — and failed in CI.
import {
  minimumStratumSizeForHeldOutCoverage,
  requiredCasesForHeldOutCoverage,
  type SplitRatios,
} from '../../packages/optimize/src/split.js';
import { ANOMALY_NORMALIZE_NODE_THRESHOLD } from '../../packages/tree/src/index.js';

/** The parts of a loaded case this report needs. Structural, so a test needs no loader. */
export interface PopulationCase {
  /** `system:suite:fault` — the split's stratum key, as `run-optimize.ts` builds it. */
  readonly stratum: string;
  /** The case's service-graph node count; the guard compares it to the threshold. */
  readonly nodes: number;
}

/** A stratified summary, with every partition summing to the total it came from. */
export interface PopulationSummary {
  readonly total: number;
  readonly bySystem: Readonly<Record<string, number>>;
  readonly bySuite: Readonly<Record<string, number>>;
  readonly byFault: Readonly<Record<string, number>>;
  /**
   * The cases at or above {@link ANOMALY_NORMALIZE_NODE_THRESHOLD} nodes — the only ones on which the
   * rank-normalization flag can act. A run with `acting.count === 0` reports numbers that are entirely
   * independent of that axis, whatever the flag says.
   */
  readonly acting: {
    readonly count: number;
    readonly bySystem: Readonly<Record<string, number>>;
  };
}

/**
 * The three parts of a stratum key, tolerant of a key that does not have three.
 *
 * `unknown` rather than a throw: this describes artifacts that already exist, and refusing to summarise one
 * because a stratum is malformed would hide the corpus instead of naming the gap.
 *
 * @param stratum - A `system:suite:fault` key.
 * @returns Its parts, with `unknown` where a part is absent.
 */
export function parseStratum(stratum: string): {
  system: string;
  suite: string;
  fault: string;
} {
  const [system, suite, ...rest] = stratum.split(':');
  return {
    system: system !== undefined && system !== '' ? system : 'unknown',
    suite: suite !== undefined && suite !== '' ? suite : 'unknown',
    // A fault name may itself contain a colon; everything after the suite is the fault.
    fault: rest.length > 0 ? rest.join(':') : 'unknown',
  };
}

/**
 * Count a corpus by system, suite and fault, and by whether the normalization guard would act on it.
 *
 * @param cases - The cases, with their node counts.
 * @returns The summary. Every partition sums to `total`.
 */
export function summarizePopulation(cases: readonly PopulationCase[]): PopulationSummary {
  const bump = (into: Record<string, number>, key: string): void => {
    into[key] = (into[key] ?? 0) + 1;
  };
  const bySystem: Record<string, number> = {};
  const bySuite: Record<string, number> = {};
  const byFault: Record<string, number> = {};
  const actingBySystem: Record<string, number> = {};
  let acting = 0;

  for (const c of cases) {
    const { system, suite, fault } = parseStratum(c.stratum);
    bump(bySystem, system);
    bump(bySuite, suite);
    bump(byFault, fault);
    // `>=`, matching the engine's own guard: a graph exactly at the threshold IS normalized, and an
    // off-by-one here would misreport the one case a reader is most likely to check.
    if (c.nodes >= ANOMALY_NORMALIZE_NODE_THRESHOLD) {
      acting += 1;
      bump(actingBySystem, system);
    }
  }
  return {
    total: cases.length,
    bySystem,
    bySuite,
    byFault,
    acting: { count: acting, bySystem: actingBySystem },
  };
}

/**
 * The number of strata a split covers, against the number the whole corpus has.
 *
 * The held-out splits are small by construction, so "which fault types are absent from test" is a question
 * with an answer rather than a caveat — this is that answer.
 *
 * @param cases - The cases in the split.
 * @returns How many distinct strata the split holds.
 */
export function strataCovered(cases: readonly PopulationCase[]): number {
  return new Set(cases.map((c) => c.stratum)).size;
}

/**
 * How many of a corpus's strata are too small to appear in BOTH held-out splits.
 *
 * A stratified split promises each stratum a share of each split, and `Math.round` is what decides a small
 * one: at 70/15/15 a 1-case stratum goes entirely to training and a 5-case stratum reaches validation and
 * leaves test at zero. So "val covers 26 of 44 strata" — the count the previous iteration printed — is a
 * SYMPTOM, and the number a reader needs is how many strata are below the size at which the promise holds at
 * all.
 *
 * @param cases - The cases, grouped by their stratum key.
 * @param ratios - The split ratios to judge the corpus against.
 * @returns The boundary, the stratum count, and the strata below it in ascending size order.
 */
export function summarizeSplitCapability(
  cases: readonly PopulationCase[],
  ratios: SplitRatios,
): {
  readonly minimum: number;
  readonly strata: number;
  readonly belowMinimum: ReadonlyArray<{ readonly stratum: string; readonly size: number }>;
} {
  const sizes = new Map<string, number>();
  for (const c of cases) sizes.set(c.stratum, (sizes.get(c.stratum) ?? 0) + 1);
  const minimum = minimumStratumSizeForHeldOutCoverage(ratios);
  const below = [...sizes.entries()]
    .filter(([, size]) => minimum === -1 || size < minimum)
    .map(([stratum, size]) => ({ stratum, size }))
    // Ascending size, then by name: a reader sees the scarcest strata first and two runs render identically.
    .sort((a, b) => a.size - b.size || a.stratum.localeCompare(b.stratum));
  return { minimum, strata: sizes.size, belowMinimum: below };
}

/**
 * The stratum key a case directory implies, in the SAME format the loader builds (`<stem>:<RE n>:<fault>`).
 *
 * ## Why a path is enough, and why the format must match
 *
 * The question this answers — does the DATASET contain a stratum with fewer cases than a held-out split needs
 * — is about 735 case directories, and loading them to count is what the corpus cap exists to avoid. The
 * directory name carries all three parts (`re1ob_cartservice_cpu_1`), so the walk is a `readdir` and no file
 * is opened.
 *
 * Matching the loader's format is not tidiness: the loader builds `` `${benchmark}:${RE n}:${fault}` `` from
 * the case's own JSON, and a path-derived key in a SECOND format would make the dataset's numbers and the
 * corpus's numbers incomparable while looking like they belong to the same table. Because the two derivations
 * can disagree, the runner cross-checks them on the cases it does load — a hypothesis about a naming scheme
 * that the run tests against the population it can see.
 *
 * The fault is the token BEFORE the trailing index, not a fixed position: a service name containing
 * underscores (`re1ob_frontend_service_cpu_1`) would otherwise contribute to the fault and invent a stratum
 * the dataset does not have.
 *
 * @param dirPath - A case directory path.
 * @returns `<stem>:<RE n>:<fault>`, or `unknown:unknown:unknown` when no segment matches the scheme.
 */
export function deriveStratumFromCaseDir(dirPath: string): string {
  const segments = dirPath.replace(/\\/g, '/').split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!.toLowerCase();
    const m = /^(re([123])(?:ob|ss|tt))_(.+)$/.exec(segment);
    if (!m) continue;
    const stem = m[1]!;
    const suite = `RE${m[2]}`;
    const parts = m[3]!.split('_');
    const index = parts[parts.length - 1]!;
    // A trailing numeric index is part of the scheme; without one the fault cannot be located, and a guessed
    // fault would be a stratum that does not exist.
    const fault = /^\d+$/.test(index) && parts.length >= 2 ? parts[parts.length - 2]! : 'unknown';
    return `${stem}:${suite}:${fault}`;
  }
  return 'unknown:unknown:unknown';
}

/**
 * The DATASET's strata, counted from its case directories.
 *
 * The corpus's own count (see {@link summarizeSplitCapability}) says how many of the SAMPLED strata are too
 * small; this says how many the dataset has, which is the number that decides whether a bigger cap could
 * help. A stratum holding fewer than the boundary's cases in the whole dataset can never reach both held-out
 * splits at any cap — so a reader who only had the corpus's count could spend an iteration raising a cap that
 * cannot fix anything.
 *
 * @param dirs - The dataset's case directories.
 * @param ratios - The split ratios the boundary is computed for.
 * @returns The total, the stratum count, the boundary, and the strata below it in ascending size order.
 */
export function summarizeDatasetStrata(
  dirs: readonly string[],
  ratios: SplitRatios,
): {
  readonly total: number;
  readonly strata: number;
  readonly minimum: number;
  readonly belowMinimum: ReadonlyArray<{ readonly stratum: string; readonly size: number }>;
} {
  const sizes = new Map<string, number>();
  for (const dir of dirs) {
    const key = deriveStratumFromCaseDir(dir);
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  const minimum = minimumStratumSizeForHeldOutCoverage(ratios);
  const belowMinimum = [...sizes.entries()]
    .filter(([, size]) => minimum === -1 || size < minimum)
    .map(([stratum, size]) => ({ stratum, size }))
    .sort((a, b) => a.size - b.size || a.stratum.localeCompare(b.stratum));
  return { total: dirs.length, strata: sizes.size, minimum, belowMinimum };
}

/**
 * Render the dataset summary as the line an artifact carries.
 *
 * @param summary - The summary from {@link summarizeDatasetStrata}.
 * @param ratios - The ratios it was computed for.
 * @param exampleLimit - How many of the smallest strata to name.
 * @returns One line, without a trailing newline.
 */
export function formatDatasetStrata(
  summary: ReturnType<typeof summarizeDatasetStrata>,
  ratios: SplitRatios,
  exampleLimit = 6,
): string {
  const head =
    `dataset: ${summary.total} cases in ${summary.strata} ` +
    `${summary.strata === 1 ? 'stratum' : 'strata'} | ${summary.belowMinimum.length} below the size both ` +
    `held-out splits need (${summary.minimum}) | full coverage would cost ` +
    `${requiredCasesForHeldOutCoverage(summary.strata, ratios)} cases`;
  if (summary.belowMinimum.length === 0) return head;
  const named = summary.belowMinimum
    .slice(0, exampleLimit)
    .map((s) => `${s.stratum}(${s.size})`)
    .join(' ');
  return `${head} | smallest: ${named}` + (summary.belowMinimum.length > exampleLimit ? ' …' : '');
}

/**
 * The corpus size the search uses when the caller does not say, measured rather than preferred.
 *
 * **276 is `strata x boundary` over the DATASET's own strata**: 46 strata, each needing 6 cases for both
 * held-out splits at 70/15/15. It is the smallest cap at which the split's promise is even reachable, and it
 * replaces two values that disagreed — the CLI's default of `0` ("load everything", which the full 735-case
 * dataset cannot fit) and the workflow's literal `200` (64 cases short of the dataset's requirement, and 76
 * short of what the corpus would need). A cap with two owners is a cap with two answers.
 *
 * It is deliberately NOT the whole dataset: the cap exists because 735 cases do not fit in the runner's heap,
 * and 276 is 37.5% of it.
 */
export const OPTIMIZE_MAX_CASES = 276;

/**
 * How the corpus is drawn when the dataset is larger than the cap, named so the artifact can state it.
 *
 * Today's objective preserves the dataset's `system:suite` shares, which is why RE3 is 12.1% of the corpus.
 * The alternative — an equal quota per `system:suite:fault` stratum — is NOT implemented, and the capacity
 * line below says why implementing it would not be enough on its own: at 44 strata and a 6-case floor the
 * corpus would need 264 cases, and 200 cannot be rearranged into that.
 */
export const CORPUS_SAMPLING_OBJECTIVE =
  'proportional (each system:suite stratum keeps its share of the dataset)';

/**
 * The cap, the stratum count and the boundary as one verdict.
 *
 * {@link formatSplitCapability} says how many strata are too small; this says whether ANY sampling objective
 * could fix it under the case cap the run was given. Those are different questions and the second one decides:
 * a corpus that cannot fund full coverage cannot be rebalanced into it, so a reader who only saw the "N of 44
 * are smaller" line might reasonably conclude the sampler was poorly chosen.
 *
 * @param capability - The summary from {@link summarizeSplitCapability}.
 * @param ratios - The ratios the boundary was computed for.
 * @param cap - The case cap the corpus was drawn under; `0` means uncapped.
 * @returns One line, without a trailing newline.
 */
export function formatSplitCapacity(
  capability: ReturnType<typeof summarizeSplitCapability>,
  ratios: SplitRatios,
  cap: number,
): string {
  const required = requiredCasesForHeldOutCoverage(capability.strata, ratios);
  const head =
    `split capacity: ${capability.strata} strata x ${capability.minimum} = ${required} cases would give ` +
    `every stratum both held-out splits`;
  if (required === 0) {
    return `${head} — vacuous, since this ratio set asks for no held-out split`;
  }
  if (cap <= 0) {
    return `${head}; the corpus is UNCAPPED, so nothing about the cap stands in the way`;
  }
  if (cap >= required) {
    return `${head}; the cap of ${cap} funds it, so coverage is limited only by which strata exist`;
  }
  return (
    `${head}; the cap of ${cap} is ${required - cap} short, so ${capability.belowMinimum.length} of ` +
    `${capability.strata} strata cannot reach both splits and NO sampling objective changes that — only a ` +
    `larger cap, or fewer strata`
  );
}

/**
 * Render the split-capability summary as the line an artifact carries.
 *
 * Names the smallest strata rather than only counting them: "30 of 44 are too small" invites the reader to
 * assume they are all uninteresting, and the names are what let that be checked.
 *
 * @param capability - The summary from {@link summarizeSplitCapability}.
 * @param ratios - The ratios it was computed for, quoted in the line.
 * @param exampleLimit - How many of the smallest strata to name.
 * @returns One line, without a trailing newline.
 */
export function formatSplitCapability(
  capability: ReturnType<typeof summarizeSplitCapability>,
  ratios: SplitRatios,
  exampleLimit = 6,
): string {
  const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;
  const split = `${pct(ratios.train)}/${pct(ratios.val)}/${pct(ratios.test)}`;
  if (capability.minimum === -1) {
    return (
      `split capability: a ${split} split has no held-out threshold to meet — ` +
      `every one of the ${capability.strata} strata is below it by definition`
    );
  }
  const named = capability.belowMinimum
    .slice(0, exampleLimit)
    .map((s) => `${s.stratum}(${s.size})`)
    .join(' ');
  return (
    `split capability: a stratum needs ${capability.minimum}+ cases for BOTH held-out splits at ${split}; ` +
    `${capability.belowMinimum.length} of ${capability.strata} strata are smaller` +
    (capability.belowMinimum.length > 0
      ? ` — smallest: ${named}${capability.belowMinimum.length > exampleLimit ? ' …' : ''}`
      : '')
  );
}

/**
 * Render a summary as the lines an artifact carries.
 *
 * Every count is printed ascending by key so two runs of the same corpus render identically — a summary that
 * reorders itself between runs is a summary a diff cannot read.
 *
 * @param summary - The summary to render.
 * @param label - What this population is (e.g. `corpus`, `train`, `test`).
 * @returns One line per partition, plus the acting population.
 */
export function formatPopulation(summary: PopulationSummary, label: string): string[] {
  const render = (counts: Readonly<Record<string, number>>, total: number): string =>
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v} (${((v / total) * 100).toFixed(1)}%)`)
      .join(' ');
  return [
    `population[${label}]: total=${summary.total} | system: ${render(summary.bySystem, summary.total)}`,
    `population[${label}]: suite: ${render(summary.bySuite, summary.total)} | fault: ${render(
      summary.byFault,
      summary.total,
    )}`,
    // The decisive line: on how much of this corpus the shipped rank-normalization value can act at all.
    `population[${label}]: rankNormalization acts on ${summary.acting.count}/${summary.total} cases ` +
      `(nodes >= ${ANOMALY_NORMALIZE_NODE_THRESHOLD})` +
      (summary.acting.count === 0
        ? ' — this corpus cannot distinguish the flag from its opposite'
        : ` | acting system: ${render(summary.acting.bySystem, summary.acting.count)}`),
  ];
}
