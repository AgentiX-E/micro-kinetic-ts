/**
 * The conjunctive score: the first competitor with a theorem, measured against the pool we already own.
 *
 * ## What the competitor claims
 *
 * CIE (arXiv:2601.21359v2) proposes ranking candidates by a **conjunction** of two axes rather than by their sum. A
 * root cause deviates on its *own* internal properties (resource usage) **and** on the external ones its neighbours
 * observe (latency, errors), while a component that merely propagates a failure deviates externally only. The
 * conjunction — a minimum, or a product — therefore ranks the root first **provably under arbitrary amplification**,
 * whereas an additive score needs the amplification to be bounded. On their corpus the conjunction reaches 68 % Top-1
 * over 735 failures, +21 % relative over the best of twelve baselines.
 *
 * ## Why it has to be measured here rather than adopted
 *
 * Our score is additive, so CIE's guarantee is the conditional one — that part is not in dispute. What is in dispute
 * is whether the conjunction **pays on this corpus**, and that is an empirical question with a cheap answer: the term
 * dump already carries every contribution per candidate, so both axes can be reconstructed exactly and the pool
 * re-ranked with no engine run and no tokens. This module is that measurement, and its three modes are the three
 * forms the paper's rule can take once the axes are finite: the minimum of the two normalised axes, their product,
 * and the product of their normalised forms.
 *
 * ## Why an unmeasured axis refuses rather than scores zero
 *
 * A candidate whose external axis was never computed is not a candidate with no external deviation: it is a candidate
 * the dump cannot speak about. Scoring it zero would rank it last for a missing measurement, and the reading would
 * then attribute to the conjunction a failure that belongs to the artifact's coverage. Such candidates are excluded
 * from the ranking and counted, and a case whose whole pool lacks an axis is `undecided` rather than lost.
 *
 * @module benchmarks/conjunctive-score
 */

import { contributionOf, type TermRow } from './term-marginal.js';

/** Re-exported because it is part of this module's input type: a caller builds one to ask a question here. */
export type { TermRow };

/** The three forms the conjunction takes once both axes are finite. */
export type ConjunctiveMode = 'normMin' | 'normProduct' | 'product';

/**
 * Which number each axis reads.
 *
 * `weighted` is the shipped score's contribution — weight times value — and it is the basis every mode was measured on
 * first. `raw` reads the dump's **values** while ignoring their weights, which is what makes a refuted axis testable:
 * the propagation terms carry weight 0 in the shipped vector, so their contribution is zero while their value is a
 * full measurement. Reading the raw basis is how this module could ask whether a pool-relative propagation share would
 * carry signal *before* anyone built it into the engine.
 */
export type AxisBasis = 'weighted' | 'raw';

/**
 * Which channels form the two axes, and which number each one reads.
 *
 * The external axis is not one object: the shipped vector's external channels are `lat` and `failedEdge` (every other
 * propagation channel carries weight `0`, §1.2 of the register), and a *different* axis is obtained by naming only the
 * channels that measure propagated failure. Those are different specifications of CIE's rule, they give different
 * answers, and the difference is the reading — so the specification is a parameter here and is printed beside every
 * number it produced, rather than being an unstated property of a script.
 */
export interface AxisSpec {
  /** Which number each axis reads; defaults to the shipped contributions. */
  readonly basis?: AxisBasis;
  /** The channels that count as external; defaults to `EXTERNAL_TERMS`. */
  readonly external?: readonly string[];
}

/** The modes in the order the reading prints them. */
export const CONJUNCTIVE_MODES: readonly ConjunctiveMode[] = ['normMin', 'normProduct', 'product'];

/**
 * The terms the engine computes from the component's **own** metric behaviour.
 *
 * `selfAnomalyLog1p` is the kinetic onset term — the component's own deviation at the injection boundary — and
 * `selfTime` is its own time share. Both are internal in CIE's sense: they describe the component, not what its
 * neighbours report of it.
 */
export const INTERNAL_TERMS: readonly string[] = ['selfAnomalyLog1p', 'selfTime'];

/**
 * The terms the engine computes from **what the component is seen to cause**.
 *
 * `rise` is the downstream failure rise, `lat` the latency channel, `failedEdge` a failing edge that terminates at
 * the candidate, `collision` and `temporal` its kinetic neighbours, and `trace`/`emission`/`victim` the call-graph and
 * log views. A propagator is loud here and quiet internally, which is the distinction the conjunction ranks on.
 */
export const EXTERNAL_TERMS: readonly string[] = [
  'lat',
  'rise',
  'temporal',
  'collision',
  'failedEdge',
  'trace',
  'emission',
  'victim',
];

/** The smallest number of cases a mode has to win before the reading will call it a candidate. */
export const MIN_CONJUNCTIVE_GAIN = 1;

/** One candidate of one pool, with the score the engine published for it. */
export interface ConjunctiveCandidate {
  readonly id: string;
  readonly score: number;
  readonly terms: readonly TermRow[];
}

/** One case: the labelled services any of which is correct, and the pool the engine ordered. */
export interface ConjunctiveCase {
  readonly datapack: string;
  readonly truth: readonly string[];
  readonly candidates: readonly ConjunctiveCandidate[];
}

/** A candidate split into the two axes and everything that belongs to neither. */
export interface AxisShares {
  /** The sum of the internal terms' contributions. */
  readonly internal: number;
  /** The sum of the external terms' contributions. */
  readonly external: number;
  /** The sum of every other measured contribution — the evidence the conjunction does not use. */
  readonly other: number;
  /** Whether at least one internal term was measured on this candidate. */
  readonly hasInternal: boolean;
  /** Whether at least one external term was measured on this candidate. */
  readonly hasExternal: boolean;
}

/** One candidate at the highest key, and whether another candidate shares that key. */
export interface AxisTop {
  readonly id: string | null;
  readonly tied: boolean;
}

/** One mode's reading. */
export interface ModeReading {
  readonly mode: ConjunctiveMode;
  /** Cases the conjunction gets right. */
  readonly correct: number;
  /** `correct` minus the additive score's own count. */
  readonly gain: number;
  /** Cases whose pool carries no candidate with both axes measured. */
  readonly undecided: number;
  /** The same three numbers on the even-indexed and odd-indexed halves of the corpus. */
  readonly folds: readonly FoldReading[];
}

/** One fold of one mode. */
export interface FoldReading {
  readonly cases: number;
  readonly additive: number;
  readonly conjunctive: number;
  readonly gain: number;
}

/** The whole reading. */
export interface ConjunctionReading {
  /** Cases with a non-empty accepted set. */
  readonly cases: number;
  /**
   * The specification the numbers were measured under.
   *
   * Carried in the reading rather than printed beside it, because two specifications of the same rule give different
   * numbers and a table that cannot name its own axis is a table that can be quoted as the other one.
   */
  readonly spec: string;
  /** Top-1 over the additive score. */
  readonly additive: number;
  /** Cases where the accepted answer has no candidate carrying both axes. */
  readonly truthUnrankable: number;
  readonly modes: readonly ModeReading[];
  /** The mode with the most correct cases, or `null` on an empty corpus. */
  readonly best: ModeReading | null;
  readonly verdict: 'candidate' | 'refused';
}

/** A specification with both fields resolved, so no function below reads a default of its own. */
interface ResolvedSpec {
  readonly basis: AxisBasis;
  readonly external: readonly string[];
}

/** Fill in the defaults of a specification. */
function specOf(spec: AxisSpec): ResolvedSpec {
  return { basis: spec.basis ?? 'weighted', external: spec.external ?? EXTERNAL_TERMS };
}

/** A specification as one line, so the reading can print the axis it measured. */
function describeSpec(spec: ResolvedSpec): string {
  return `${spec.basis} basis, external = ${spec.external.join(', ')}`;
}

/** Split one candidate's contributions by axis. */
export function axisShares(candidate: ConjunctiveCandidate, spec: AxisSpec = {}): AxisShares {
  const { basis, external: externalTerms } = specOf(spec);
  let internal = 0;
  let external = 0;
  let other = 0;
  let hasInternal = false;
  let hasExternal = false;
  for (const row of candidate.terms) {
    const contribution = contributionOf(row);
    if (contribution === null) continue;
    // The raw basis reads the value and ignores the weight; an unmeasured pair is still skipped, because `null` is
    // the dump's only way of saying "not computed" and no basis can invent a measurement.
    const share = basis === 'raw' ? row.value! : contribution;
    if (INTERNAL_TERMS.includes(row.name)) {
      internal += share;
      hasInternal = true;
    } else if (externalTerms.includes(row.name)) {
      external += share;
      hasExternal = true;
    } else {
      other += share;
    }
  }
  return { internal, external, other, hasInternal, hasExternal };
}

/** Whether a candidate carries both axes — the precondition for the conjunction to say anything about it. */
export function isRankable(candidate: ConjunctiveCandidate, spec: AxisSpec = {}): boolean {
  const shares = axisShares(candidate, spec);
  return shares.hasInternal && shares.hasExternal;
}

/** The first candidate at the highest additive score, and whether another shares it. */
export function additiveTopOne(candidates: readonly ConjunctiveCandidate[]): AxisTop {
  let best: { score: number; id: string } | null = null;
  let tied = false;
  for (const candidate of candidates) {
    if (best === null || candidate.score > best.score) {
      best = { score: candidate.score, id: candidate.id };
      tied = false;
    } else if (candidate.score === best.score) {
      tied = true;
    }
  }
  return { id: best === null ? null : best.id, tied };
}

/** An axis that improved is not a deviation, so the conjunction reads it as zero. */
function deviation(value: number): number {
  return value > 0 ? value : 0;
}

/** The pool's largest value of an axis, which is what the normalised modes divide by. */
function axisMax(
  candidates: readonly ConjunctiveCandidate[],
  axis: 'internal' | 'external',
  spec: ResolvedSpec,
): number {
  let max = 0;
  for (const candidate of candidates) {
    max = Math.max(max, deviation(axisShares(candidate, spec)[axis]));
  }
  return max;
}

/**
 * Rank the pool under one mode and return its first candidate.
 *
 * Ties are settled by the additive score and then by the pool's own order, so the reading never depends on a
 * tie-break this module invented.
 */
export function conjunctiveTopOne(
  candidates: readonly ConjunctiveCandidate[],
  mode: ConjunctiveMode,
  spec: AxisSpec = {},
): AxisTop {
  const resolved = specOf(spec);
  const rankable = candidates.filter((candidate) => isRankable(candidate, resolved));
  if (rankable.length === 0) return { id: null, tied: false };
  const maxInternal = axisMax(rankable, 'internal', resolved);
  const maxExternal = axisMax(rankable, 'external', resolved);

  const keyOf = (candidate: ConjunctiveCandidate): number => {
    const shares = axisShares(candidate, resolved);
    const internal = deviation(shares.internal);
    const external = deviation(shares.external);
    if (mode === 'product') return internal * external;
    const normalisedInternal = maxInternal === 0 ? 0 : internal / maxInternal;
    const normalisedExternal = maxExternal === 0 ? 0 : external / maxExternal;
    return mode === 'normMin'
      ? Math.min(normalisedInternal, normalisedExternal)
      : normalisedInternal * normalisedExternal;
  };

  // Seeded from the first rankable candidate rather than from `null`: the empty pool returned above, so a null
  // guard here would be an arm no input reaches.
  let best = { key: keyOf(rankable[0]!), score: rankable[0]!.score, id: rankable[0]!.id };
  let tied = false;
  for (const candidate of rankable.slice(1)) {
    const key = keyOf(candidate);
    if (key > best.key || (key === best.key && candidate.score > best.score)) {
      best = { key, score: candidate.score, id: candidate.id };
      tied = false;
    } else if (key === best.key && candidate.score === best.score) {
      tied = true;
    }
  }
  return { id: best.id, tied };
}

/** Whether an accepted answer counts: membership in the accepted set, as everywhere else in this programme. */
function isCorrect(id: string | null, truth: readonly string[]): boolean {
  return id !== null && truth.includes(id);
}

/** The reading of one mode over one population. */
function readMode(
  cases: readonly ConjunctiveCase[],
  mode: ConjunctiveMode,
  additive: number,
  spec: AxisSpec,
): ModeReading {
  let correct = 0;
  let undecided = 0;
  const folds: { cases: number; additive: number; conjunctive: number; gain: number }[] = [
    { cases: 0, additive: 0, conjunctive: 0, gain: 0 },
    { cases: 0, additive: 0, conjunctive: 0, gain: 0 },
  ];
  cases.forEach((one, index) => {
    const top = conjunctiveTopOne(one.candidates, mode, spec);
    const add = additiveTopOne(one.candidates);
    if (top.id === null) undecided += 1;
    const hit = isCorrect(top.id, one.truth);
    if (hit) correct += 1;
    const fold = folds[index % 2]!;
    const base = isCorrect(add.id, one.truth);
    fold.cases += 1;
    if (base) fold.additive += 1;
    if (hit) fold.conjunctive += 1;
  });
  for (const fold of folds) fold.gain = fold.conjunctive - fold.additive;
  return { mode, correct, gain: correct - additive, undecided, folds };
}

/** Measure all three modes on a corpus. */
export function conjunctionReading(
  corpus: readonly ConjunctiveCase[],
  spec: AxisSpec = {},
): ConjunctionReading {
  const resolved = specOf(spec);
  const cases = corpus.filter((one) => one.truth.length > 0);
  let additive = 0;
  for (const one of cases) {
    if (isCorrect(additiveTopOne(one.candidates).id, one.truth)) additive += 1;
  }
  let truthUnrankable = 0;
  for (const one of cases) {
    const accepted = one.candidates.filter((candidate) => one.truth.includes(candidate.id));
    if (!accepted.some((candidate) => isRankable(candidate, resolved))) truthUnrankable += 1;
  }
  const modes = CONJUNCTIVE_MODES.map((mode) => readMode(cases, mode, additive, resolved));
  // Sorted rather than reduced: `sort` is stable, so a tie keeps the printed mode order, and the comparison has no
  // arm that only one distribution of modes can reach.
  const best = cases.length === 0 ? null : [...modes].sort((a, b) => b.correct - a.correct)[0]!;
  return {
    cases: cases.length,
    spec: describeSpec(resolved),
    additive,
    truthUnrankable,
    modes,
    best,
    verdict: best !== null && best.gain >= MIN_CONJUNCTIVE_GAIN ? 'candidate' : 'refused',
  };
}

/** A share, so no cell implies more precision than the corpus carries. */
function share(value: number, total: number): string {
  if (total === 0) return '(0.00 %)';
  return `(${((100 * value) / total).toFixed(2)} %)`;
}

/** Render the reading as a table plus the verdict line. */
export function formatConjunction(reading: ConjunctionReading): string {
  const head = ['mode', 'conjunctive', 'additive', 'gain', 'undecided', 'fold 0', 'fold 1'];
  const body = reading.modes.map((one) => [
    one.mode,
    `${String(one.correct)} ${share(one.correct, reading.cases)}`,
    String(reading.additive),
    one.gain > 0 ? `+${String(one.gain)}` : String(one.gain),
    String(one.undecided),
    one.folds.length === 2 ? signed(one.folds[0]!.gain) : '—',
    one.folds.length === 2 ? signed(one.folds[1]!.gain) : '—',
  ]);
  const widths = head.map((cell, column) =>
    Math.max(cell.length, ...body.map((cells) => cells[column]!.length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join('  ')
      .trimEnd();
  return [
    line(head),
    line(widths.map((width) => '-'.repeat(width))),
    ...body.map(line),
    '',
    `cases ${String(reading.cases)}, accepted answer with no second axis ${String(reading.truthUnrankable)}`,
    `spec ${reading.spec}`,
    `verdict ${reading.verdict}` +
      (reading.best === null
        ? ''
        : ` — best ${reading.best.mode} at ${String(reading.best.correct)} ` +
          `${share(reading.best.correct, reading.cases)}`),
  ].join('\n');
}

/** A signed cell, so a gain and a loss cannot be read alike. */
function signed(value: number): string {
  return value > 0 ? `+${String(value)}` : String(value);
}
