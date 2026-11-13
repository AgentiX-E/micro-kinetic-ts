/**
 * What a term dump says the weights WERE, as opposed to what a screen assumes they should be.
 *
 * ## The problem this module exists for
 *
 * A dump records one `[name, weight, slope]` triple per term per candidate, and the weight is the coefficient the
 * fusion actually applied. For a term whose contribution is unconditional that is the configured weight, so a dump
 * yields "the configuration" by reading the numbers out. For a term the engine GATES it does not:
 *
 * ```
 *   baseline pass with the term weighted out  →  the engine's own rank-1
 *   if the gate refuses  →  return the baseline ranking, and the term's row records 0
 *   if the gate admits   →  re-rank with the configured weight, and the row records that weight
 * ```
 *
 * So a gated term's recorded coefficient is `configured × admitted(case)`, and the recorded 0 is a DECISION about the
 * case rather than a fact about the configuration. Reading the first 0 as "the shipped weight is 0" fabricates a
 * vector that scores 1031 of 1422 where the run scored 1073 — which is what every screen in this repository did until
 * iteration 277, because `shippedWeightsOf` took the first weight it saw per name.
 *
 * ## The theorem
 *
 * For one name, let `S` be the set of coefficients the dump records for it and `w` the configured weight. Every
 * recorded coefficient is either `w` (admitted) or `0` (refused), so `S ⊆ {0, w}` and therefore
 *
 * > `w = max S`,   whenever `S` contains anything other than 0.
 *
 * Two caveats, and both are reported rather than papered over:
 *
 * - `S = {0}` is ambiguous — a term configured at 0 and a term refused on every case record the same thing — so such
 *   a name is marked {@link RecordedStates.indistinguishable};
 * - `|S| > 1` is proof that the name is CONDITIONAL. A configuration is one number; a name that records two is a
 *   decision procedure, and no single vector can reproduce a run that contains one.
 *
 * ## What it is for
 *
 * The recorded coefficients are a free ablation. A gated term's case was scored with the term and without it, so the
 * dump carries the arm that ran and the arm that did not — and the union of the two is the ceiling a per-case switch
 * over that one term could reach. {@link ablateTerm} reads all of it without re-running the engine.
 *
 * @module benchmarks/src/conditional-weight
 */

import type { StrictReading } from './gate-fit.js';
import { readScores } from './gate-fit.js';
import type { ParsedTermCase } from './terms-dump.js';

/**
 * A score is a sum of products of numbers the dump wrote at full precision; a residual above this is a disagreement
 * about what was scored, not floating-point noise.
 */
export const SCORE_TOLERANCE = 1e-9;

/** One name's recorded coefficients, and what they imply about the configuration. */
export interface RecordedStates {
  readonly name: string;
  /** Recorded coefficient → how many cases recorded it, in ascending order. */
  readonly values: ReadonlyMap<number, number>;
  /** Cases that never recorded the name, i.e. the term was not part of that case's fusion. */
  readonly absent: number;
  /** Cases recording a coefficient at all. */
  readonly recorded: number;
  /** `max S`, and `0` when the name records nothing. See the module docblock for why this is the configuration. */
  readonly configured: number;
  /** Cases recording `0` while `configured > 0`: the gate's refusals, case by case. */
  readonly switchedOff: number;
  /** More than one recorded coefficient. A configuration is one number, so this name is a decision procedure. */
  readonly conditional: boolean;
  /**
   * `S = {0}` with no other value. A term configured at 0 and a term refused on every case are indistinguishable
   * here, and no reader may claim the difference.
   */
  readonly indistinguishable: boolean;
  /**
   * Cases whose CANDIDATES recorded more than one coefficient for this name.
   *
   * One coefficient applies to a whole case, so this is a broken invariant rather than a threshold: a name that
   * changes inside one case is either a second configuration inside one run or a dump that mixed two of them.
   */
  readonly conflicts: number;
}

/** One dump's whole weight ledger. */
export interface WeightCensus {
  readonly cases: number;
  /** One row per name, in name order. */
  readonly names: readonly RecordedStates[];
  /** The names that record more than one coefficient, in name order. */
  readonly conditional: readonly string[];
  /**
   * Whether `Σ coefficient × slope` reproduces the recorded `score` on every candidate. This is the check that makes
   * "the dump records the coefficients it scored with" a measurement rather than an assumption; when it fails, no
   * ablation over the dump means anything.
   */
  readonly residual: { readonly candidates: number; readonly mismatched: number };
}

/** Which coefficient a name is given in one arm. */
export type TermArm = 'recorded' | 'off' | 'on';

/** One arm's totals. */
export interface ArmReading {
  /** Cases whose best accepted candidate beats the best rejected one outright. */
  readonly answers: number;
  /** Cases whose first maximum in the dump's order is accepted. */
  readonly optimistic: number;
}

/** One fault type's readings under every arm. */
export interface TermArmRow {
  readonly faultType: string;
  readonly cases: number;
  readonly answers: Readonly<Record<TermArm, number>>;
  /**
   * Cases at least one of `off` and `on` answers. The ceiling of a per-case switch over this term ALONE, which is an
   * oracle and not an achievable score: it decides each case knowing the answer.
   */
  readonly union: number;
}

/** What the gate did, read off the coefficients it wrote. */
export interface GateLedger {
  /** Cases the gate admitted, i.e. that were re-ranked with the term. */
  readonly admitted: number;
  /** Of those, the ones the term fixed. */
  readonly helps: number;
  /** Of those, the ones the term broke. */
  readonly hurts: number;
  /** Cases the gate refused, i.e. that kept the baseline ranking. */
  readonly refused: number;
  /** Of those, the ones the term would have fixed — the gate's cost. */
  readonly wouldHelp: number;
  /** Of those, the ones the term would have broken — the gate's saving. */
  readonly wouldHurt: number;
}

/** One term's three arms and the gate that chose between them. */
export interface TermAblation {
  readonly term: string;
  /** The configured weight, as {@link RecordedStates.configured} reads it. */
  readonly configured: number;
  readonly cases: number;
  readonly arms: Readonly<Record<TermArm, ArmReading>>;
  /** The per-case oracle over `off` and `on`; see {@link TermArmRow.union}. */
  readonly union: number;
  readonly families: readonly TermArmRow[];
  readonly gate: GateLedger;
}

/**
 * The coefficients one case recorded for one name.
 *
 * @param kase - One case.
 * @param name - The term's name.
 * @returns Every distinct coefficient its candidates recorded, in first-seen order.
 */
function coefficientsIn(kase: ParsedTermCase, name: string): number[] {
  const seen: number[] = [];
  for (const candidate of kase.candidates) {
    for (const [term, weight] of candidate.terms) {
      if (term !== name || weight === null) continue;
      if (!seen.includes(weight)) seen.push(weight);
    }
  }
  return seen;
}

/**
 * Read one name's coefficients out of a dump.
 *
 * @param cases - The dump.
 * @param name - The term's name.
 * @returns The states, with the configuration the theorem above recovers from them.
 */
function statesOf(cases: readonly ParsedTermCase[], name: string): RecordedStates {
  const values = new Map<number, number>();
  let absent = 0;
  let conflicts = 0;
  for (const kase of cases) {
    const own = coefficientsIn(kase, name);
    if (own.length === 0) {
      absent += 1;
      continue;
    }
    if (own.length > 1) conflicts += 1;
    // The case's own coefficient is the first its candidates recorded. Agreement is the invariant, and a case that
    // breaks it has already been counted above, so taking the first here does not hide anything.
    const weight = own[0]!;
    values.set(weight, (values.get(weight) ?? 0) + 1);
  }
  const sorted = new Map([...values.entries()].sort((left, right) => left[0] - right[0]));
  let configured = 0;
  for (const weight of sorted.keys()) if (weight > configured) configured = weight;
  let recorded = 0;
  for (const count of sorted.values()) recorded += count;
  return {
    name,
    values: sorted,
    absent,
    recorded,
    configured,
    switchedOff: configured > 0 ? (sorted.get(0) ?? 0) : 0,
    conditional: sorted.size > 1,
    indistinguishable: sorted.size === 1 && sorted.has(0),
    conflicts,
  };
}

/**
 * Every name's recorded coefficients, and whether the recorded numbers reproduce the recorded scores.
 *
 * @param cases - The dump.
 * @returns The census.
 */
export function weightCensusOf(cases: readonly ParsedTermCase[]): WeightCensus {
  const names = new Set<string>();
  for (const kase of cases) {
    for (const candidate of kase.candidates) for (const [name] of candidate.terms) names.add(name);
  }
  const rows = [...names].sort().map((name) => statesOf(cases, name));
  let candidates = 0;
  let mismatched = 0;
  for (const kase of cases) {
    for (const candidate of kase.candidates) {
      if (candidate.score === null) continue;
      candidates += 1;
      let total = 0;
      for (const [, weight, slope] of candidate.terms) {
        if (weight === null || slope === null) continue;
        total += weight * slope;
      }
      if (Math.abs(total - candidate.score) > SCORE_TOLERANCE) mismatched += 1;
    }
  }
  return {
    cases: cases.length,
    names: rows,
    conditional: rows.filter((row) => row.conditional).map((row) => row.name),
    residual: { candidates, mismatched },
  };
}

/**
 * Score one case under one arm.
 *
 * The arm moves ONE name. Every other name keeps the coefficient the dump recorded for it, because the dump's
 * recording is the only account of what they were weighted with — and for every name that is not conditional, that
 * number is the configuration.
 *
 * A term's slope is applied under `off` and `on` whenever it was MEASURED (`slope !== null`), even on a case that
 * recorded no coefficient for it. That is the counterfactual the arm is for: what the fusion would have said if this
 * term had been weighted here. Under `recorded` the coefficient is the one the dump wrote, so a case that did not
 * measure the term adds nothing.
 *
 * @param kase - One case.
 * @param row - The name being moved.
 * @param arm - Which coefficient the name gets.
 * @returns The reading.
 */
function readArm(kase: ParsedTermCase, row: RecordedStates, arm: TermArm): StrictReading {
  const ids = kase.candidates.map((candidate) => candidate.id);
  const scores = new Float64Array(kase.candidates.length);
  for (let index = 0; index < kase.candidates.length; index += 1) {
    const candidate = kase.candidates[index]!;
    let score = 0;
    for (const [name, weight, slope] of candidate.terms) {
      if (slope === null) continue;
      if (name !== row.name) {
        if (weight === null) continue;
        score += weight * slope;
        continue;
      }
      if (arm === 'recorded') {
        if (weight === null) continue;
        score += weight * slope;
      } else {
        score += (arm === 'on' ? row.configured : 0) * slope;
      }
    }
    scores[index] = score;
  }
  return readScores(ids, new Set(kase.accepted), scores);
}

/** Nothing answered yet. */
function emptyArm(): ArmReading {
  return { answers: 0, optimistic: 0 };
}

/**
 * Read one term as a three-arm ablation off a dump whose fusion gated it.
 *
 * `recorded` is the arm that ran; `off` and `on` are the two arms the gate chose between. `union` is what a perfect
 * per-case switch would score, so it bounds what any gate can be worth — and the difference between it and the
 * recorded arm is the whole value of making the gate's decision better.
 *
 * @param cases - The dump.
 * @param term - The name to move.
 * @returns The ablation.
 * @throws When the dump does not record the term at all, because an ablation of a name no case carries is not a
 * measurement of zero.
 */
export function ablateTerm(cases: readonly ParsedTermCase[], term: string): TermAblation {
  const row = statesOf(cases, term);
  if (row.recorded === 0) throw new Error(`no case records ${term}`);
  const arms: Record<TermArm, ArmReading> = {
    recorded: emptyArm(),
    off: emptyArm(),
    on: emptyArm(),
  };
  const families = new Map<
    string,
    { cases: number; answers: Record<TermArm, number>; union: number }
  >();
  // Mutable here and readonly in the report: the ledger is accumulated case by case and published once.
  const gate = { admitted: 0, helps: 0, hurts: 0, refused: 0, wouldHelp: 0, wouldHurt: 0 };
  let union = 0;
  for (const kase of cases) {
    const readings: Record<TermArm, StrictReading> = {
      recorded: readArm(kase, row, 'recorded'),
      off: readArm(kase, row, 'off'),
      on: readArm(kase, row, 'on'),
    };
    const tally = families.get(kase.faultType) ?? {
      cases: 0,
      answers: { recorded: 0, off: 0, on: 0 },
      union: 0,
    };
    tally.cases += 1;
    for (const arm of ['recorded', 'off', 'on'] as const) {
      const reading = readings[arm];
      if (reading.answers) {
        arms[arm] = { answers: arms[arm].answers + 1, optimistic: arms[arm].optimistic };
        tally.answers[arm] += 1;
      }
      // `optimistic` is counted separately: a tie answers optimistically without answering strictly, and folding the
      // two would make the artifact's own reading depend on which arm happened to see a level score.
      if (reading.optimistic)
        arms[arm] = { answers: arms[arm].answers, optimistic: arms[arm].optimistic + 1 };
    }
    if (readings.off.answers || readings.on.answers) {
      union += 1;
      tally.union += 1;
    }
    families.set(kase.faultType, tally);

    // The gate's decision is the coefficient it wrote: the configured value means admitted, a measured zero means
    // refused, and no recorded value at all means the term was never in this case's fusion, so the gate was never
    // consulted — which is neither an admission nor a refusal and is left out of the ledger.
    const own = coefficientsIn(kase, term);
    if (own.length === 0) continue;
    if (row.configured > 0 && own[0] === row.configured) {
      gate.admitted += 1;
      if (readings.on.answers && !readings.off.answers) gate.helps += 1;
      else if (readings.off.answers && !readings.on.answers) gate.hurts += 1;
    } else {
      gate.refused += 1;
      if (readings.on.answers && !readings.off.answers) gate.wouldHelp += 1;
      else if (readings.off.answers && !readings.on.answers) gate.wouldHurt += 1;
    }
  }
  return {
    term,
    configured: row.configured,
    cases: cases.length,
    arms,
    union,
    families: [...families.entries()]
      .map(([faultType, tally]) => ({
        faultType,
        cases: tally.cases,
        answers: tally.answers,
        union: tally.union,
      }))
      // Families with the same number of cases are ordered by name, so two runs print one table. `a`/`b` and not
      // `left`/`right`: the comparator population keys on the parameters, and a tie-break the table cannot name is
      // one nobody can check.
      .sort((a, b) => b.cases - a.cases || (a.faultType < b.faultType ? -1 : 1)),
    gate,
  };
}

/**
 * Render a census as the table a reader can check the theorem against.
 *
 * @param census - The census.
 * @returns The report.
 */
export function formatCensus(census: WeightCensus): string {
  const lines = [
    `cases ${census.cases}   candidates ${census.residual.candidates}   residual mismatches ${census.residual.mismatched}`,
    `conditional names: ${census.conditional.length === 0 ? 'none' : census.conditional.join(', ')}`,
    '',
    'name                 configured  recorded  absent   states',
  ];
  for (const row of census.names) {
    const states = [...row.values.entries()]
      .map(([weight, count]) => `${weight} x${count}`)
      .join('  ');
    const notes: string[] = [];
    if (row.conditional) notes.push('GATED');
    if (row.indistinguishable) notes.push('0-or-refused');
    if (row.conflicts > 0) notes.push(`${row.conflicts} CONFLICTING`);
    lines.push(
      `${row.name.padEnd(20)} ${String(row.configured).padStart(10)} ${String(row.recorded).padStart(9)} ${String(row.absent).padStart(7)}   ${states}${notes.length === 0 ? '' : `  (${notes.join(' ')})`}`,
    );
  }
  return lines.join('\n');
}

/**
 * Render one term's ablation, largest family first.
 *
 * @param ablation - The ablation.
 * @returns The report.
 */
export function formatAblation(ablation: TermAblation): string {
  const share = (count: number): string => `${((100 * count) / ablation.cases).toFixed(2)}%`;
  const lines = [
    `${ablation.term}: configured ${ablation.configured}, cases ${ablation.cases}`,
    '',
    'arm        answers    share   optimistic',
  ];
  for (const arm of ['off', 'recorded', 'on'] as const) {
    lines.push(
      `${arm.padEnd(9)} ${String(ablation.arms[arm].answers).padStart(7)} ${share(ablation.arms[arm].answers).padStart(8)} ${String(ablation.arms[arm].optimistic).padStart(12)}`,
    );
  }
  lines.push(
    `${'union'.padEnd(9)} ${String(ablation.union).padStart(7)} ${share(ablation.union).padStart(8)}   (per-case oracle)`,
  );
  lines.push('');
  lines.push(
    `gate: admitted ${ablation.gate.admitted} (helps ${ablation.gate.helps}, hurts ${ablation.gate.hurts}), refused ${ablation.gate.refused} (would help ${ablation.gate.wouldHelp}, would hurt ${ablation.gate.wouldHurt})`,
  );
  lines.push('');
  lines.push('faultType                        n     off  record      on   on-off');
  for (const row of ablation.families) {
    lines.push(
      `${row.faultType.padEnd(26)} ${String(row.cases).padStart(4)} ${String(row.answers.off).padStart(7)} ${String(row.answers.recorded).padStart(7)} ${String(row.answers.on).padStart(7)} ${String(row.answers.on - row.answers.off).padStart(8)}`,
    );
  }
  return lines.join('\n');
}
