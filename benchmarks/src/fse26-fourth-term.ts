/**
 * The fourth term: does the failed-edge DIRECTION beat the blend the engine computes?
 *
 * Three families are closed (chooser it.108–109, scale it.110, composition it.111) and the baseline has been
 * corrected (it.112: the reconstruction reproduces the run exactly at `poolWeight` 0, **750** cases). What is left is
 * the only degree of freedom the blend has: **the set of terms.** 121 cases are unreachable by choosing, re-reading or
 * re-combining the three signals that exist.
 *
 * The candidate is the failed-edge direction — the one signal the record has already measured as an ENGINE SWITCH
 * (**+5.8pp on its own run**, rejected on two narrow regressions). Two things make this a different question rather
 * than a repeat:
 *
 * 1. **The baseline is the run that reproduces**, not a reconstruction 103 cases away from it. The switch's +82 was
 *    measured against a control that got 673; the engine now gets **750**, so most of that +82 may already have been
 *    collected by other repairs.
 * 2. **It is measured as a TERM**, over the whole corpus, with the split printed beside the net — the same form the
 *    other three families were held to, so the results are comparable rather than merely adjacent.
 *
 * ## Why the weights are data with a reason, not a grid
 *
 * `failedEdgeScore` is max-normalised, so a weight of 0 means "off" and 1 makes the term as strong as the log term
 * whose absence costs 241 cases. **The five weights are chosen to span that question**, not to search: off, a nudge,
 * half the log term's strength, equal to it, and double. A finer grid would be a fit on 1422 cases dressed as a
 * measurement — and the register's rule for a fitted quantity is that it needs a held-out protocol, which is the next
 * iteration's job if any of these is worth it.
 *
 * ## Law 41 applies here too
 *
 * The baseline arm is the engine's own blend, so the report prints the **agreement** for it first: a screen whose
 * zero-weight arm does not reproduce the run is measuring a baseline that is not the engine's, and every net below it
 * is measured against the wrong thing.
 *
 * @module benchmarks/fse26-fourth-term
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import { foldOf } from './fse26-discriminator.js';
import {
  agreementVerdict,
  engineAgreement,
  type AgreementReport,
} from './fse26-engine-agreement.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { latencySlopes, rankCase } from './fse26-term-oracle.js';

/** One weight of the direction term, with the claim it makes. */
export interface DirectionArm {
  readonly weight: number;
  readonly claim: string;
}

/**
 * The five arms, each a STATEMENT rather than a grid point.
 *
 * `0` is the engine's own blend and the baseline. `1` makes the direction as strong as the log term, whose removal
 * costs 241 cases — so `1` asks "is the direction as informative as the log evidence". `2` asks the stronger question
 * and is the last point at which the answer could still be "the term should dominate"; beyond it the term stops being
 * a correction to the blend and becomes the blend.
 */
export const DIRECTION_ARMS: readonly DirectionArm[] = [
  { weight: 0, claim: 'the engine’s own blend (the baseline)' },
  { weight: 0.25, claim: 'a nudge: the direction breaks near-ties only' },
  { weight: 0.5, claim: 'half the log term’s strength' },
  { weight: 1, claim: 'as strong as the log term' },
  { weight: 2, claim: 'strong enough to dominate a moderate anomaly gap' },
  // `3` and `4` are here because the measured curve TURNS: 750, 763, 790, 810, 848, **855**, 852, 835 … 827. An arm
  // past the turning point is what distinguishes a term doing work from a gate that any direction would pass, and a
  // menu that stopped at 2 would have reported a monotone rise and left the reader unable to tell the two apart.
  { weight: 3, claim: 'past the turning point: the measured maximum' },
  { weight: 4, claim: 'and declining: 3 is a maximum, not a plateau' },
];

/** What one weight does against the baseline. */
export interface DirectionScreen {
  readonly arm: DirectionArm;
  readonly cases: number;
  /** Cases the BASELINE (weight 0) gets right. */
  readonly baselineCorrect: number;
  /** Cases this weight gets right. */
  readonly correct: number;
  readonly fixed: readonly string[];
  readonly broken: readonly string[];
}

/** The screen, with the baseline's agreement so law 41 is discharged before any net is read. */
export interface DirectionReport {
  readonly agreement: AgreementReport;
  readonly screens: readonly DirectionScreen[];
}

/**
 * Score every weight against the baseline.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration; its `failedEdgeWeight` is overridden per arm.
 * @param arms - The weights to score; defaults to {@link DIRECTION_ARMS}.
 * @returns The baseline's agreement and one screen per arm.
 */
export function directionReport(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  arms: readonly DirectionArm[] = DIRECTION_ARMS,
): DirectionReport {
  const at = (weight: number): TermOracleOptions => ({ ...opts, failedEdgeWeight: weight });
  const agreement = engineAgreement(cases, opts);
  const scored = arms.map((arm) => {
    const options = at(arm.weight);
    let counted = 0;
    let correct = 0;
    const fixed: string[] = [];
    const broken: string[] = [];
    for (const kase of cases) {
      const root = new Set(kase.groundTruth.filter((name) => name !== ''));
      if (root.size === 0) continue;
      counted++;
      // The latency term does not depend on the arm, so it is computed once: two calls would be a second
      // calculation of the same quantity, which is the defect class this record keeps finding.
      const lat = latencySlopes(kase.services, opts.latFloor);
      const hit = root.has(rankCase(kase, options, 'recorded', lat).order[0] ?? '');
      const baseHit = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '');
      if (hit) correct++;
      if (!baseHit && hit) fixed.push(kase.datapack);
      if (baseHit && !hit) broken.push(kase.datapack);
    }
    return { arm, cases: counted, correct, baselineCorrect: 0, fixed, broken };
  });
  // `baselineCorrect` is the weight-0 arm's own total, read back rather than recounted: the zero arm IS the engine's
  // blend, so a second traversal could disagree with it and the whole table would be off by that disagreement.
  const baseline = scored.find((screen) => screen.arm.weight === 0);
  const baselineCorrect = baseline === undefined ? 0 : baseline.correct;
  return {
    agreement,
    screens: scored.map((screen) => ({ ...screen, baselineCorrect })),
  };
}

/**
 * Render the screen.
 *
 * @param report - The report to render.
 * @returns The block, agreement first.
 */
export function formatDirectionReport(report: DirectionReport): string {
  const { agreement, screens } = report;
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const lines = [
    'Fourth-term screen — the failed-edge DIRECTION, against the blend the engine computes:',
    // Law 41: the baseline's provenance comes before any number measured against it.
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
    '  weight   claim                                              right   net   fixed / broken   verdict',
  ];
  for (const screen of screens) {
    const net = screen.correct - screen.baselineCorrect;
    const verdict =
      screen.arm.weight === 0
        ? 'the baseline'
        : net > 0 && screen.broken.length === 0
          ? 'DOMINATES'
          : net > 0
            ? 'trades, cannot pass'
            : 'does not help';
    lines.push(
      `  ${String(screen.arm.weight).padEnd(9)}${screen.arm.claim.padEnd(50)}` +
        `${String(screen.correct).padStart(6)}${String(net >= 0 ? `+${net}` : net).padStart(6)}` +
        `   ${String(screen.fixed.length).padStart(6)} / ${String(screen.broken.length).padEnd(6)}` +
        `${verdict}`,
    );
  }
  lines.push(
    '  the arms are statements, not a grid: off, a nudge, half the log term, equal to it, double, and two past the ' +
      'turning point so a maximum can be told from a plateau. A weight chosen on this corpus is a FIT, so the bar is ' +
      'the same one the chooser failed: beat the baseline with ZERO losses — and a fit needs a held-out protocol ' +
      'before it may be called a candidate',
  );
  return lines.join('\n');
}

/** The bar the held-out weight must clear, stated before the measurement. */
export const HOLDOUT_BAR =
  'the SAME weight must be chosen on every fold, AND the held-out total must be net-positive with the per-fold split ' +
  'printed — a weight that moves between folds is evidence that the maximum is noise, not that the term is one';

/** What one fold's training folds chose, and what that choice did on the fold it never saw. */
export interface FoldChoice {
  readonly fold: number;
  /** The weight chosen on the OTHER folds. */
  readonly chosenWeight: number;
  readonly heldOutCases: number;
  readonly heldOutCorrect: number;
  /** The zero arm on the SAME held-out cases, so the net is a difference from the engine's own blend. */
  readonly baselineCorrect: number;
  readonly fixed: readonly string[];
  readonly broken: readonly string[];
}

/** The cross-validated verdict on the direction term's weight. */
export interface HoldoutReport {
  readonly agreement: AgreementReport;
  readonly folds: readonly FoldChoice[];
  /** One weight per fold, in fold order — the STABILITY the bar is about. */
  readonly chosen: readonly number[];
  readonly heldOutCorrect: number;
  readonly heldOutBaseline: number;
  readonly heldOutCases: number;
}

/**
 * Choose the direction weight on four folds and measure it on the fifth.
 *
 * **Why this exists**: `3` was read off the same 1422 cases its gain was computed on. That is a fit, and the only thing
 * that distinguishes a fitted weight from a real one is whether it survives cases it was not chosen on. The
 * discriminator already answers this question for a MENU of rules via {@link foldOf}, and this reuses the same fold
 * assignment rather than inventing a second one — two splits of one corpus is the defect class this record keeps
 * finding.
 *
 * **The tie-break is toward the SMALLER weight**, and it is not arbitrary: a larger weight trades more cases (the
 * measured split widens monotonically with it), so when two weights fit the training folds equally well, the one that
 * trades less is the safer choice on the fold nobody has seen.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration; its `failedEdgeWeight` is overridden per arm.
 * @param arms - The weights to choose among; defaults to {@link DIRECTION_ARMS}.
 * @param folds - How many folds; 5 by default, matching the discriminator.
 * @returns The agreement, the per-fold verdicts, and the totals.
 */
export function holdoutDirectionReport(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  arms: readonly DirectionArm[] = DIRECTION_ARMS,
  folds = 5,
  /**
   * Which cases the term may act on. Defaults to every case; the class gate passes {@link directionApplies}, so the
   * gated arm is held out by the SAME protocol rather than announced as out-of-sample because its weight was.
   */
  applies: (faultType: string) => boolean = () => true,
): HoldoutReport {
  const agreement = engineAgreement(cases, opts);
  const ordered = [...arms].sort((a, b) => a.weight - b.weight);
  // One traversal per arm, over every case, recorded per (case, arm). The fold split is then a grouping rather than
  // five re-scorings, so the arms cannot drift between the fold they were chosen on and the fold they are read on.
  const rows: { datapack: string; fold: number; hits: boolean[] }[] = [];
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const admits = applies(kase.faultType);
    const hits = ordered.map((arm) => {
      const options: TermOracleOptions = { ...opts, failedEdgeWeight: admits ? arm.weight : 0 };
      return root.has(rankCase(kase, options, 'recorded', lat).order[0] ?? '');
    });
    rows.push({ datapack: kase.datapack, fold: foldOf(kase.datapack, folds), hits });
  }
  const baselineIndex = ordered.findIndex((arm) => arm.weight === 0);
  const choices: FoldChoice[] = [];
  for (let fold = 0; fold < folds; fold++) {
    const training = rows.filter((row) => row.fold !== fold);
    const testing = rows.filter((row) => row.fold === fold);
    let best = 0;
    let bestScore = -1;
    ordered.forEach((_, index) => {
      const score = training.reduce((sum, row) => sum + (row.hits[index] ? 1 : 0), 0);
      // Strictly greater, walking the arms in ASCENDING weight order: a tie keeps the smaller weight.
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    const heldOutCorrect = testing.reduce((sum, row) => sum + (row.hits[best] ? 1 : 0), 0);
    const baseCorrect =
      baselineIndex < 0
        ? 0
        : testing.reduce((sum, row) => sum + (row.hits[baselineIndex] ? 1 : 0), 0);
    const fixed: string[] = [];
    const broken: string[] = [];
    for (const row of testing) {
      const hit = row.hits[best]!;
      const base = baselineIndex < 0 ? false : row.hits[baselineIndex]!;
      if (!base && hit) fixed.push(row.datapack);
      if (base && !hit) broken.push(row.datapack);
    }
    choices.push({
      fold,
      chosenWeight: ordered[best]!.weight,
      heldOutCases: testing.length,
      heldOutCorrect,
      baselineCorrect: baseCorrect,
      fixed,
      broken,
    });
  }
  return {
    agreement,
    folds: choices,
    chosen: choices.map((choice) => choice.chosenWeight),
    heldOutCorrect: choices.reduce((sum, choice) => sum + choice.heldOutCorrect, 0),
    heldOutBaseline: choices.reduce((sum, choice) => sum + choice.baselineCorrect, 0),
    heldOutCases: choices.reduce((sum, choice) => sum + choice.heldOutCases, 0),
  };
}

/**
 * Render the held-out report.
 *
 * @param report - The report to render.
 * @returns The block, agreement first and the bar last.
 */
export function formatHoldoutReport(report: HoldoutReport): string {
  const percent =
    report.agreement.cases === 0 ? 0 : (100 * report.agreement.agreed) / report.agreement.cases;
  const distinct = new Set(report.chosen);
  const net = report.heldOutCorrect - report.heldOutBaseline;
  const stable = distinct.size === 1;
  const lines = [
    'Fourth-term held-out: the direction weight, chosen on four folds and read on the fifth:',
    `  baseline agreement with the recorded run: ${report.agreement.agreed}/${report.agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(report.agreement)}`,
    '  fold  chosen   held-out   baseline   net   fixed / broken',
  ];
  for (const choice of report.folds) {
    const foldNet = choice.heldOutCorrect - choice.baselineCorrect;
    lines.push(
      `  ${String(choice.fold).padEnd(6)}${String(choice.chosenWeight).padEnd(9)}` +
        `${String(`${choice.heldOutCorrect}/${choice.heldOutCases}`).padEnd(11)}` +
        `${String(choice.baselineCorrect).padEnd(11)}` +
        `${String(foldNet >= 0 ? `+${foldNet}` : foldNet).padEnd(6)}` +
        `${choice.fixed.length} / ${choice.broken.length}`,
    );
  }
  lines.push(
    `  held-out total ${report.heldOutCorrect} against a baseline of ${report.heldOutBaseline} ` +
      `(${net >= 0 ? `+${net}` : net} over ${report.heldOutCases} cases); weights chosen ${report.chosen.join(', ')}`,
    `  verdict: ${stable ? 'STABLE' : 'UNSTABLE'} weight across folds — ${HOLDOUT_BAR}`,
  );
  return lines.join('\n');
}

/** One fault type's movement, which is the unit the engine's own acceptance criterion is stated in. */
export interface TypeMovement {
  readonly faultType: string;
  readonly cases: number;
  readonly baselineCorrect: number;
  readonly correct: number;
}

/** The per-fault-type split, and the types that got WORSE — the kill criterion's actual unit. */
export interface TypeSplit {
  readonly movements: readonly TypeMovement[];
  /** Types the arm makes strictly worse. The pruner's acceptance is ZERO of these, not zero cases. */
  readonly regressed: readonly string[];
}

/**
 * Split one weight's movement by FAULT TYPE.
 *
 * **This is the unit the acceptance criterion is stated in, and the split by case is not it.** The pruner's own
 * docblock requires "net-positive with zero regression on the kill criterion (RCAEval golden 9-cell byte-identical AND
 * FSE'26 **zero regressed fault types**)" — so fifty broken CASES is not a rejection if every type they belong to also
 * gains. Measuring cases alone cannot answer the question the gate asks, which is why this exists beside the case
 * split rather than instead of it.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration.
 * @param weight - The direction weight to split.
 * @returns The per-type rows and the types that regressed.
 */
export function faultTypeSplit(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  weight: number,
): TypeSplit {
  const options: TermOracleOptions = { ...opts, failedEdgeWeight: weight };
  const byType = new Map<string, { cases: number; baselineCorrect: number; correct: number }>();
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const base = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '');
    const hit = root.has(rankCase(kase, options, 'recorded', lat).order[0] ?? '');
    const row = byType.get(kase.faultType) ?? { cases: 0, baselineCorrect: 0, correct: 0 };
    row.cases += 1;
    if (base) row.baselineCorrect += 1;
    if (hit) row.correct += 1;
    byType.set(kase.faultType, row);
  }
  const movements = [...byType.entries()]
    .map(([faultType, row]) => ({ faultType, ...row }))
    // The tie-break calls the repository's comparator rather than spelling the string order a second time. The census
    // fence names `compareCasePaths` as its only owner, and a `localeCompare` here is exactly the defect iteration 110
    // committed in another module — this time the fence caught it before the commit, not after.
    .sort(
      (a, b) =>
        b.correct - b.baselineCorrect - (a.correct - a.baselineCorrect) ||
        compareCasePaths(a.faultType, b.faultType),
    );
  return {
    movements,
    regressed: movements
      .filter((row) => row.correct < row.baselineCorrect)
      .map((row) => row.faultType),
  };
}

/**
 * The fault CLASSES, derived from the type names rather than fitted per type.
 *
 * Law 2's rule — read the name, derive the mapping from the vocabulary — and the reason a class is not a per-type
 * switch: the question "can a failed call name the fault site" has one answer per class.
 */
export type FaultClass = 'value' | 'network' | 'latency' | 'resource' | 'abort' | 'other';

/**
 * Which class a fault type belongs to.
 *
 * **Derived from the name, and the order matters** — `HTTPResponseDelay` is a latency fault that also matches nothing
 * else, while `NetworkDelay` is BOTH a network and a latency fault and is classed as network here because the injected
 * fault is on the link. The mapping is a claim about the vocabulary, testable against the union of type names, not a
 * table of measured outcomes.
 *
 * @param faultType - The type name from the dump.
 * @returns Its class.
 */
export function classifyFaultType(faultType: string): FaultClass {
  // Network first: a network delay is a link fault whose SYMPTOM is latency, and the direction term is about the link.
  if (faultType.startsWith('Network')) return 'network';
  if (/Replace|Patch/.test(faultType)) return 'value';
  if (/Delay|Latency|TimeSkew/.test(faultType)) return 'latency';
  if (/Stress/.test(faultType)) return 'resource';
  if (/Abort|Kill|PodFailure/.test(faultType)) return 'abort';
  return 'other';
}

/**
 * The classes on which the direction term has a stated mechanism: **the fault IS the link**.
 *
 * A failed call points at the fault site exactly when what failed is the connection itself — partition, loss, corruption,
 * bandwidth. Everywhere else the failed edge points at something the fault happened TO, which is why the term's gross
 * gain is entirely inside this class (+62 at weight 3) and its losses are entirely outside it (latency −6, resource −9,
 * abort −7).
 *
 * **One set of derived classes, no per-type switches and no threshold.** The alternative — twenty-five switches chosen
 * by which types gained — is a twenty-five-parameter fit; this is a claim about what a failed edge MEANS.
 */
export const DIRECTION_CLASSES: ReadonlySet<FaultClass> = new Set<FaultClass>(['network']);

/**
 * Does the direction term apply to this case?
 *
 * @param faultType - The type name from the dump.
 * @returns True when the case's fault class is one the term can reason about.
 */
export function directionApplies(faultType: string): boolean {
  return DIRECTION_CLASSES.has(classifyFaultType(faultType));
}

/** What the class gate does, with the zero-regression claim measured rather than asserted. */
export interface ClassGateReport {
  readonly weight: number;
  readonly cases: number;
  readonly applied: number;
  readonly baselineCorrect: number;
  readonly correct: number;
  readonly split: TypeSplit;
}

/**
 * Score the direction term with the class gate applied.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration.
 * @param weight - The direction weight on the cases the gate admits.
 * @returns The totals, how many cases the gate admitted, and the per-type split.
 */
export function classGatedReport(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  weight: number,
): ClassGateReport {
  let counted = 0;
  let applied = 0;
  let baselineCorrect = 0;
  let correct = 0;
  const perType = new Map<string, TypeMovement>();
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    counted++;
    const admits = directionApplies(kase.faultType);
    if (admits) applied++;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const baseHit = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '');
    const armHit = root.has(
      rankCase(kase, { ...opts, failedEdgeWeight: admits ? weight : 0 }, 'recorded', lat)
        .order[0] ?? '',
    );
    if (baseHit) baselineCorrect++;
    if (armHit) correct++;
    const row = perType.get(kase.faultType) ?? {
      faultType: kase.faultType,
      cases: 0,
      baselineCorrect: 0,
      correct: 0,
    };
    perType.set(kase.faultType, {
      faultType: kase.faultType,
      cases: row.cases + 1,
      baselineCorrect: row.baselineCorrect + (baseHit ? 1 : 0),
      correct: row.correct + (armHit ? 1 : 0),
    });
  }
  const movements = [...perType.values()].sort(
    (a, b) =>
      b.correct - b.baselineCorrect - (a.correct - a.baselineCorrect) ||
      compareCasePaths(a.faultType, b.faultType),
  );
  return {
    weight,
    cases: counted,
    applied,
    baselineCorrect,
    correct,
    split: {
      movements,
      regressed: movements
        .filter((row) => row.correct < row.baselineCorrect)
        .map((row) => row.faultType),
    },
  };
}

/**
 * Render the class-gated screen.
 *
 * @param report - The report to render.
 * @param agreement - The baseline's agreement with the recorded run (law 41).
 * @returns The block.
 */
export function formatClassGateReport(report: ClassGateReport, agreement: AgreementReport): string {
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const net = report.correct - report.baselineCorrect;
  const lines = [
    'Fourth-term class gate — the direction ONLY where the fault IS the link (network):',
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
    `  weight ${report.weight}: the gate admits ${report.applied}/${report.cases} cases`,
    `  right ${report.correct} against a baseline of ${report.baselineCorrect} (${net >= 0 ? `+${net}` : net})`,
    `  regressed types: ${report.split.regressed.length === 0 ? 'NONE' : report.split.regressed.join(', ')}`,
  ];
  return lines.join('\n');
}

/** Canonical order, so two equal sets compare equal and the report is stable. */
const CLASS_ORDER: readonly FaultClass[] = [
  'value',
  'network',
  'latency',
  'resource',
  'abort',
  'other',
];

/** All 64 subsets, in a deterministic order: by size, then canonically. */
function candidateClassSets(): readonly (readonly FaultClass[])[] {
  const out: FaultClass[][] = [];
  for (let mask = 0; mask < 1 << CLASS_ORDER.length; mask++) {
    out.push(CLASS_ORDER.filter((_, index) => (mask & (1 << index)) !== 0));
  }
  return out.sort((a, b) => a.length - b.length || a.join(',').localeCompare(b.join(',')));
}

/** One candidate class set, scored over the whole corpus with its regressed types. */
export interface ClassSetCandidate {
  readonly set: readonly FaultClass[];
  readonly total: number;
  readonly regressed: readonly string[];
}

/**
 * Enumerate all 64 class sets and score each over the corpus, with the regressed types that make it infeasible.
 *
 * **The engine's acceptance condition is a GLOBAL property** — the FSE'26 check runs over the whole corpus — so it is a
 * feasibility test here rather than something to check after a choice has been made. Measured on this dump, that
 * distinction decides the answer: the unconstrained maximum is `value+network+other` at **877 (+127)** with **three
 * regressed types**, which cannot ship, while the best feasible set is `network+other` at **819 (+69)** with none.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration.
 * @param weight - The direction weight applied on the admitted classes.
 * @returns Every candidate, best first.
 */
export function classSetCandidates(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  weight: number,
): readonly ClassSetCandidate[] {
  const rows: { faultType: string; klass: FaultClass; base: number; admitted: number }[] = [];
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const base = root.has(rankCase(kase, opts, 'recorded', lat).order[0] ?? '') ? 1 : 0;
    const admitted = root.has(
      rankCase(kase, { ...opts, failedEdgeWeight: weight }, 'recorded', lat).order[0] ?? '',
    )
      ? 1
      : 0;
    rows.push({
      faultType: kase.faultType,
      klass: classifyFaultType(kase.faultType),
      base,
      admitted,
    });
  }
  const out: ClassSetCandidate[] = [];
  for (const set of candidateClassSets()) {
    const member = new Set(set);
    const perType = new Map<string, { base: number; arm: number }>();
    let total = 0;
    for (const row of rows) {
      const arm = member.has(row.klass) ? row.admitted : row.base;
      total += arm;
      const row2 = perType.get(row.faultType) ?? { base: 0, arm: 0 };
      row2.base += row.base;
      row2.arm += arm;
      perType.set(row.faultType, row2);
    }
    out.push({
      set,
      total,
      regressed: [...perType.entries()]
        .filter(([, counts]) => counts.arm < counts.base)
        .map(([type]) => type),
    });
  }
  return out.sort(
    (a, b) =>
      b.total - a.total ||
      a.set.length - b.set.length ||
      a.set.join('+').localeCompare(b.set.join('+')),
  );
}

/** The feasible maximum: the highest-scoring set that regresses NO fault type. */
export interface FeasibleSet {
  readonly best: ClassSetCandidate | undefined;
  /** How many of the 64 sets regress nothing — the population the maximum is taken from. */
  readonly feasible: number;
  /** The unconstrained maximum, kept so the report can say what was refused and by how much. */
  readonly unconstrained: ClassSetCandidate | undefined;
}

/**
 * Choose the best FEASIBLE class set, and keep the infeasible maximum beside it.
 *
 * @param candidates - The enumeration from {@link classSetCandidates}.
 * @returns The feasible maximum, how many sets are feasible, and the unconstrained maximum.
 */
export function feasibleClassSet(candidates: readonly ClassSetCandidate[]): FeasibleSet {
  const admissible = candidates.filter((candidate) => candidate.regressed.length === 0);
  return {
    best: admissible[0],
    feasible: admissible.length,
    unconstrained: candidates[0],
  };
}

/**
 * Render the class-set verdict: the feasible maximum, what the constraint refused, and the feasibility population.
 *
 * @param result - The feasible-set result.
 * @param agreement - The baseline's agreement with the recorded run (law 41).
 * @returns The block.
 */
export function formatFeasibleClassSet(result: FeasibleSet, agreement: AgreementReport): string {
  const percent = agreement.cases === 0 ? 0 : (100 * agreement.agreed) / agreement.cases;
  const lines = [
    'Class-set screen — every one of the 64 sets, with the engine\u2019s criterion as a FEASIBILITY test:',
    `  baseline agreement with the recorded run: ${agreement.agreed}/${agreement.cases} ` +
      `(${percent.toFixed(2)}%) — ${agreementVerdict(agreement)}`,
  ];
  if (result.unconstrained !== undefined) {
    lines.push(
      `  unconstrained maximum: ${result.unconstrained.total} (${result.unconstrained.set.join('+')}) — ` +
        `REFUSED, it regresses ${result.unconstrained.regressed.length} type(s): ${result.unconstrained.regressed.join(', ')}`,
    );
  }
  if (result.best === undefined) {
    lines.push('  no feasible set: every candidate regresses a type, so the term does not ship');
  } else {
    const net = result.best.total - agreement.recordedRight;
    lines.push(
      `  feasible maximum: ${result.best.total} (${result.best.set.join('+')}) — ` +
        `+${net} over the ${result.feasible} of 64 sets that regress nothing`,
    );
  }
  return lines.join('\n');
}
