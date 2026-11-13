/**
 * The term decomposition: which term paid for the lead a symptom holds over the source.
 *
 * `docs/depth-reranking-preregistration.md` fixes the hypothesis, the population, the statistic, the bar and
 * the kill criterion BEFORE any measurement of them. This file is that document as arithmetic, and every
 * constant below is quoted from it rather than chosen here:
 *
 * - the population is the misses the ORDER could still fix — depth `1..20`, against 1 073 correct at rank one
 *   and 112 whose answer the order never holds (`docs/agentic-headroom.md` §10.6);
 * - the statistic is, per term, the fraction of a family's misses on which `Δt > 0`, i.e. on which the term
 *   already pays the truth more than the winner;
 * - the bar is `65 %` with `n ≥ 20`, tested at `α = 0.05/18` by an exact two-sided binomial;
 * - the split is `hashId(case) % 2`, fitted on `in` and read on `out`.
 *
 * ## Why `Δt` is a contribution difference and not a slope difference
 *
 * A score is a sum of `weight × slope` terms, and the two factors answer different questions: a term with a
 * large slope and a zero weight is a mechanism the run did not use, and its slope difference would be read as
 * a lead it never took. `Δt = w·slope` on each side is the number the sum actually contains, so a case whose
 * lead is concentrated in one term has that term at the top by construction rather than by inference.
 *
 * ## Why a name can appear twice in one candidate, and why the map sums
 *
 * Some families build one term per contributing edge, so a candidate can carry the same name more than once.
 * The score adds them; a reader that kept the last would disagree with the score on exactly the candidates
 * whose score was built from the most evidence.
 *
 * ## Why the residual is part of the output
 *
 * `Σ (w × slope)` over a candidate's triples must equal the `finalScore` the sort used, because the producer
 * builds both from the same sum. The residual is that difference. A case whose residual is non-zero is a case
 * whose decomposition describes a different number than the one it was ranked by — which is a defect in the
 * DUMP or in the formula's own accounting, and the two are indistinguishable from a table of shares. So the
 * report counts the cases it can decompose EXACTLY and refuses the population it cannot.
 *
 * @module benchmarks/term-decomposition
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import { hashId } from './agentic-sampling.js';
import { separationPValue } from './fse26-separator.js';

import type { ParsedTermCandidate, ParsedTermCase } from './terms-dump.js';

/**
 * The terms the ranking formula builds, in the order it states them.
 *
 * A literal, and it is the Bonferroni denominator: `α = 0.05 / 18`. It is also a fence — a dump carrying a name
 * not in this list means the formula grew a term after the pre-registration was written, and the correction a
 * reader applies would then be understated for every cell. {@link assertDeclaredTerms} refuses that rather than
 * reporting a table whose `p` values are described by a denominator that no longer holds.
 */
export const DECLARED_TERMS = [
  'selfAnomalyLog1p',
  'source',
  'temporal',
  'collision',
  'topo',
  'log',
  'rise',
  'trace',
  'prism',
  'failedEdge',
  'lat',
  'pool',
  'stability',
  'faultFree',
  'selfTime',
  'emission',
  'dualFamily',
  'podState',
] as const;

/** The family-wise level the pre-registration fixes. */
export const TERM_ALPHA = 0.05;

/** The per-term level: Bonferroni over {@link DECLARED_TERMS}. */
export const BONFERRONI_ALPHA = TERM_ALPHA / DECLARED_TERMS.length;

/** The share of a family's misses a term must win to be acted on. */
export const MIN_TERM_SHARE = 0.65;

/** The smallest family the bar is applied to, so a family of four cannot sentence a term. */
export const MIN_FAMILY_CASES = 20;

/** The deepest rung a bounded presentation can carry — `DEPTH_TOP_LIMIT` of the depth ladder. */
export const MAX_RERANKABLE_DEPTH = 20;

/** The largest residual a case may carry and still be called exactly decomposed. */
export const RESIDUAL_TOLERANCE = 1e-9;

/** One name's total contribution to one candidate. */
export interface TermContribution {
  readonly name: string;
  /** `Σ (weight × slope)` over the triples carrying this name. */
  readonly value: number;
}

/** One candidate's breakdown, reconstructed from its triples. */
export interface CandidateBreakdown {
  readonly id: string;
  readonly score: number | null;
  /** Per-name totals, in first-appearance order. */
  readonly contributions: readonly TermContribution[];
  /** `Σ value` over {@link contributions}. */
  readonly total: number;
  /** `|total − score|`, or `undefined` when the producer recorded no score. */
  readonly residual: number | undefined;
}

/** One miss, decomposed into the terms that separate the truth from the winner. */
export interface MissDecomposition {
  readonly datapack: string;
  readonly faultType: string;
  /** Zero-based position of the first accepted candidate. Always `1..`{@link MAX_RERANKABLE_DEPTH}. */
  readonly depth: number;
  /** The candidate the engine ranked first. */
  readonly leader: string;
  /** The first accepted candidate. */
  readonly truth: string;
  /** `score(truth) − score(leader)`, or `undefined` when a side carried no score. */
  readonly deltaScore: number | undefined;
  /** `contribution(truth) − contribution(leader)` per name, over the union of both sides. */
  readonly deltas: readonly TermContribution[];
  /** The larger of the two sides' `|Σ (w × slope) − score|`; `0` when neither side recorded a score. */
  readonly residual: number;
  /** Whether both sides' triples reproduce their recorded scores within {@link RESIDUAL_TOLERANCE}. */
  readonly exact: boolean;
}

/**
 * What one case is, for the purpose of this measurement.
 *
 * A discriminated result rather than `undefined` for the three non-miss cases: the population a report states has
 * to be the population it counted, and three `undefined`s collapsing four findings into one is how a table comes
 * to be read over a denominator nobody wrote down.
 */
export type CaseDecomposition =
  | { readonly kind: 'correct' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'tooDeep' }
  | { readonly kind: 'miss'; readonly miss: MissDecomposition };

/** What one half of a family says about one term. */
export interface TermSplit {
  /** Cases on which `Δt ≠ 0`: the denominator of {@link share}. Ties are counted and excluded. */
  readonly measurable: number;
  /** Cases on which the term pays the truth more than the winner. */
  readonly wins: number;
  /** Cases on which it pays the winner more. */
  readonly losses: number;
  /** Cases on which the two sides were paid the same, so the term decided nothing. */
  readonly ties: number;
  /** `wins / measurable`, or `undefined` on a population that carries no decision. */
  readonly share: number | undefined;
  /** Exact two-sided binomial against `0.5`, or `undefined` when nothing was measurable. */
  readonly p: number | undefined;
}

/** One term's reading in one family. */
export interface TermFamilyTerm {
  readonly name: string;
  /** The in-sample half, which is where the bar is applied. */
  readonly inHalf: TermSplit;
  /** The held-out half, which is read and never fitted. */
  readonly outHalf: TermSplit;
  /** The bar cleared on the in-sample half: share ≥ 65 % and `p ≤ α/18`. */
  readonly cleared: boolean;
  /** Cleared, and the held-out half still pays the truth more often than the winner. */
  readonly confirmed: boolean;
}

/** One fault family's decomposition. */
export interface TermFamily {
  readonly faultType: string;
  /** Misses the decomposition could place, which is the family's `n` for the bar. */
  readonly cases: number;
  readonly inCases: number;
  readonly outCases: number;
  /** True when {@link cases} is below {@link MIN_FAMILY_CASES}: the bar is not applied. */
  readonly belowFloor: boolean;
  /** Terms, the in-sample share descending then name. */
  readonly terms: readonly TermFamilyTerm[];
}

/** The whole reading: the population it was taken over, and the families. */
export interface TermDecompositionReport {
  /** Cases in the dump. */
  readonly cases: number;
  /** Cases already answered at rank one: not misses, so not in the population. */
  readonly correctAt1: number;
  /** Cases whose answer the order never carries: no re-ranking can reach them. */
  readonly absent: number;
  /** Misses deeper than {@link MAX_RERANKABLE_DEPTH}: outside the presentation any arm could carry. */
  readonly tooDeep: number;
  /** Misses in the population. */
  readonly misses: number;
  /** Misses whose two sides both reproduce their scores exactly. */
  readonly exactMisses: number;
  /** The largest residual seen anywhere, so a reader can see how far from exact the dump is. */
  readonly worstResidual: number;
  /** Cases refused because the formula grew a term the pre-registration did not count. */
  readonly undeclared: readonly string[];
  readonly families: readonly TermFamily[];
}

/** What the decomposition concludes about the hypothesis. */
export interface TermVerdict {
  /** `term @ family` cells that cleared the bar in-sample and kept the sign held out. */
  readonly confirmed: readonly string[];
  /** Cells that cleared in-sample and inverted (or tied) held out: a fitted artifact, not an effect. */
  readonly inverted: readonly string[];
  /** Whether any cell confirmed, i.e. whether H1 survives. */
  readonly survives: boolean;
}

/**
 * Refuse a dump whose formula carries a term the Bonferroni denominator does not count.
 *
 * @param cases - The dump's cases.
 * @returns The undeclared names, in name order, so a caller can report them rather than throw.
 */
export function undeclaredTerms(cases: readonly ParsedTermCase[]): string[] {
  const declared = new Set<string>(DECLARED_TERMS);
  const seen = new Set<string>();
  for (const kase of cases) {
    for (const candidate of kase.candidates) {
      for (const [name] of candidate.terms) {
        if (!declared.has(name)) seen.add(name);
      }
    }
  }
  return [...seen].sort(compareCasePaths);
}

/**
 * Aggregate one candidate's triples by name.
 *
 * A triple with no weight or no slope contributes nothing, which is what the formula computed: the producer
 * emits the pair only where it read a measurement, and a term it did not read is a zero in the sum rather than
 * an unknown.
 *
 * @param candidate - One candidate, as the dump read it.
 * @returns Its per-name totals, in first-appearance order.
 */
export function contributionsOf(candidate: ParsedTermCandidate): TermContribution[] {
  const totals = new Map<string, number>();
  for (const [name, weight, slope] of candidate.terms) {
    const paid = weight === null || slope === null ? 0 : weight * slope;
    totals.set(name, (totals.get(name) ?? 0) + paid);
  }
  return [...totals.entries()].map(([name, value]) => ({ name, value }));
}

/**
 * Reconstruct one candidate's score from its triples.
 *
 * @param candidate - One candidate, as the dump read it.
 * @returns The breakdown, with the residual that decides whether it is exact.
 */
export function breakdownOf(candidate: ParsedTermCandidate): CandidateBreakdown {
  const contributions = contributionsOf(candidate);
  let total = 0;
  for (const contribution of contributions) total += contribution.value;
  return {
    id: candidate.id,
    score: candidate.score,
    contributions,
    total,
    residual: candidate.score === null ? undefined : Math.abs(total - candidate.score),
  };
}

/**
 * Decompose one case, or classify it as one of the three cases this measurement excludes.
 *
 * The population rule is applied here rather than by the caller: a case answered at rank one is not a miss, a
 * case with no accepted candidate anywhere in the order is one no re-ranking reaches, and a case deeper than
 * {@link MAX_RERANKABLE_DEPTH} is one no bounded presentation can carry. Each is RETURNED rather than dropped,
 * because a population a report cannot state is a population nobody declared.
 *
 * @param kase - One case, as the dump read it.
 * @returns The decomposition, or the reason the case is outside the population.
 */
export function decomposeCase(kase: ParsedTermCase): CaseDecomposition {
  const accepted = new Set(kase.accepted);
  const depth = kase.candidates.findIndex((candidate) => accepted.has(candidate.id));
  if (depth === -1) return { kind: 'absent' };
  if (depth === 0) return { kind: 'correct' };
  if (depth > MAX_RERANKABLE_DEPTH) return { kind: 'tooDeep' };
  const leader = kase.candidates[0]!;
  const truth = kase.candidates[depth]!;
  const leaderBreakdown = breakdownOf(leader);
  const truthBreakdown = breakdownOf(truth);
  const leaderPaid = new Map(
    leaderBreakdown.contributions.map((entry) => [entry.name, entry.value]),
  );
  const deltas = truthBreakdown.contributions.map((entry) => ({
    name: entry.name,
    value: entry.value - (leaderPaid.get(entry.name) ?? 0),
  }));
  const truthNames = new Set(truthBreakdown.contributions.map((entry) => entry.name));
  // The union, so a term paid to the WINNER only is still read — as minus its whole contribution. A term absent
  // from the truth's list is a term the formula did not build for it, which is a zero in the sum and the largest
  // gap a case can have.
  for (const entry of leaderBreakdown.contributions) {
    if (!truthNames.has(entry.name)) deltas.push({ name: entry.name, value: -entry.value });
  }
  const residual = Math.max(leaderBreakdown.residual ?? 0, truthBreakdown.residual ?? 0);
  return {
    kind: 'miss',
    miss: {
      datapack: kase.datapack,
      faultType: kase.faultType,
      depth,
      leader: leader.id,
      truth: truth.id,
      deltaScore:
        leaderBreakdown.score === null || truthBreakdown.score === null
          ? undefined
          : truthBreakdown.score - leaderBreakdown.score,
      deltas,
      residual,
      exact: residual <= RESIDUAL_TOLERANCE,
    },
  };
}

/**
 * Count one side of one term over a set of decompositions.
 *
 * @param decompositions - The cases in the split.
 * @param term - The term's name.
 * @returns The split, with the exact binomial `p` over wins against losses.
 */
export function splitTerm(decompositions: readonly MissDecomposition[], term: string): TermSplit {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const decomposition of decompositions) {
    // `?? 0` rather than a skip: a term missing from a case's delta list is a term paid `0` on both sides —
    // the dump omitted it because the formula built none for either candidate — and dropping the case would
    // shrink the denominator to the cases where the term was live, which is the reading that flatters it.
    const delta = decomposition.deltas.find((entry) => entry.name === term)?.value ?? 0;
    if (delta > 0) wins += 1;
    else if (delta < 0) losses += 1;
    else ties += 1;
  }
  const measurable = wins + losses;
  return {
    measurable,
    wins,
    losses,
    ties,
    share: measurable === 0 ? undefined : wins / measurable,
    p: separationPValue(wins, losses),
  };
}

/**
 * Whether one half's reading clears the pre-registered bar.
 *
 * `share ?? 0` and `p ?? 1` rather than a `share !== undefined` guard: a term that decided nothing is a term that
 * cleared nothing, and stating that as the numbers the bar compares is a statement a reader can check. A guard
 * would be the same rule written as control flow, and it would leave the fallbacks below unreachable — dead code
 * that the coverage gate would either flag forever or be taught to ignore.
 *
 * @param split - The half's reading.
 * @param cases - The family's size, which the bar is applied to.
 * @returns Whether the term clears both the effect and the corrected level.
 */
function clearsBar(split: TermSplit, cases: number): boolean {
  const share = split.share ?? 0;
  const p = split.p ?? 1;
  return cases >= MIN_FAMILY_CASES && share >= MIN_TERM_SHARE && p <= BONFERRONI_ALPHA;
}

/**
 * Build the report from a dump.
 *
 * The split is {@link hashId}`(datapack) % 2`, the pre-registered one, so the two halves are a property of the
 * corpus rather than of an iteration order — and the same case lands in the same half on every machine.
 *
 * @param cases - The dump's cases.
 * @param options - `inHalf` selects which residue is fitted; `exactOnly` drops cases whose residual is non-zero.
 * @returns The report, with the population counted beside every rate.
 */
export function summariseTerms(
  cases: readonly ParsedTermCase[],
  options: { readonly inHalf?: number; readonly exactOnly?: boolean } = {},
): TermDecompositionReport {
  const inHalf = options.inHalf ?? 0;
  const exactOnly = options.exactOnly ?? false;
  let correctAt1 = 0;
  let absent = 0;
  let tooDeep = 0;
  let worstResidual = 0;
  const population: MissDecomposition[] = [];
  for (const kase of cases) {
    const decomposed = decomposeCase(kase);
    if (decomposed.kind === 'correct') {
      correctAt1 += 1;
      continue;
    }
    if (decomposed.kind === 'absent') {
      absent += 1;
      continue;
    }
    if (decomposed.kind === 'tooDeep') {
      tooDeep += 1;
      continue;
    }
    const miss = decomposed.miss;
    if (miss.residual > worstResidual) worstResidual = miss.residual;
    // `exactOnly` is the DEFAULT behaviour of the report (`options.exactOnly ?? false` reads as "keep
    // everything"): a case whose decomposition does not reproduce its own score is COUNTED as inexact and kept,
    // because dropping it would let the population be defined by the dump's own defect. The CLI turns the filter
    // on when the caller asks for the exact subset, and the report states both counts either way.
    if (exactOnly && !miss.exact) continue;
    population.push(miss);
  }

  const byFamily = new Map<string, MissDecomposition[]>();
  const inByFamily = new Map<string, MissDecomposition[]>();
  const outByFamily = new Map<string, MissDecomposition[]>();
  for (const decomposition of population) {
    const bucket = byFamily.get(decomposition.faultType) ?? [];
    bucket.push(decomposition);
    byFamily.set(decomposition.faultType, bucket);
    const target = hashOf(decomposition.datapack) % 2 === inHalf ? inByFamily : outByFamily;
    const split = target.get(decomposition.faultType) ?? [];
    split.push(decomposition);
    target.set(decomposition.faultType, split);
  }

  const families: TermFamily[] = [...byFamily.entries()]
    .map(([faultType, group]) => {
      const inGroup = inByFamily.get(faultType) ?? [];
      const outGroup = outByFamily.get(faultType) ?? [];
      const terms = DECLARED_TERMS.map((name): TermFamilyTerm => {
        const inSplit = splitTerm(inGroup, name);
        const outSplit = splitTerm(outGroup, name);
        const cleared = clearsBar(inSplit, group.length);
        return {
          name,
          inHalf: inSplit,
          outHalf: outSplit,
          cleared,
          confirmed: cleared && outSplit.share !== undefined && (outSplit.share as number) > 0.5,
        };
      }).sort(
        (left, right) =>
          (right.inHalf.share ?? -1) - (left.inHalf.share ?? -1) ||
          compareCasePaths(left.name, right.name),
      );
      return {
        faultType,
        cases: group.length,
        inCases: inGroup.length,
        outCases: outGroup.length,
        belowFloor: group.length < MIN_FAMILY_CASES,
        terms,
      };
    })
    .sort(
      (left, right) =>
        right.cases - left.cases || compareCasePaths(left.faultType, right.faultType),
    );

  return {
    cases: cases.length,
    correctAt1,
    absent,
    tooDeep,
    misses: population.length,
    exactMisses: population.filter((decomposition) => decomposition.exact).length,
    worstResidual,
    undeclared: undeclaredTerms(cases),
    families,
  };
}

/**
 * The FNV-1a hash the split is taken from.
 *
 * The corpus's own `hashId` rather than a local copy: a second implementation of the pre-registered split would
 * partition the same corpus differently on the two sides of the comparison it exists to make.
 *
 * @param text - The case id.
 * @returns An unsigned 32-bit integer.
 */
function hashOf(text: string): number {
  return hashId(text);
}

/**
 * Read the report's verdict off its families.
 *
 * @param report - The report.
 * @returns The confirmed and inverted cells, and whether H1 survives.
 */
export function termVerdict(report: TermDecompositionReport): TermVerdict {
  const confirmed: string[] = [];
  const inverted: string[] = [];
  for (const family of report.families) {
    if (family.belowFloor) continue;
    for (const term of family.terms) {
      const cell = `${term.name} @ ${family.faultType}`;
      if (term.confirmed) confirmed.push(cell);
      else if (term.cleared) inverted.push(cell);
    }
  }
  return { confirmed, inverted, survives: confirmed.length > 0 };
}

/**
 * Compare a depth derived from the dump against a depth artifact of the same run.
 *
 * Two artifacts of one corpus that disagree about a depth disagree about what the run said, and a report built on
 * the join would then describe a population neither of them recorded. So the comparison is exact and its
 * disagreements are named rather than counted.
 *
 * @param derived - `datapack → depth` from the term dump, `null` for a case the order does not carry.
 * @param recorded - The same map from the depth artifact.
 * @returns The cases the two disagree on, in id order, and the ids one artifact has and the other does not.
 */
export function depthDisagreements(
  derived: ReadonlyMap<string, number | null>,
  recorded: ReadonlyMap<string, number | null>,
): {
  mismatched: Array<{ datapack: string; derived: number | null; recorded: number | null }>;
  missing: string[];
} {
  const mismatched: Array<{ datapack: string; derived: number | null; recorded: number | null }> =
    [];
  const missing: string[] = [];
  for (const [datapack, depth] of derived) {
    const other = recorded.get(datapack);
    if (other === undefined) {
      missing.push(datapack);
      continue;
    }
    if (other !== depth) mismatched.push({ datapack, derived: depth, recorded: other });
  }
  for (const datapack of recorded.keys()) {
    if (!derived.has(datapack)) missing.push(datapack);
  }
  mismatched.sort((left, right) => compareCasePaths(left.datapack, right.datapack));
  missing.sort(compareCasePaths);
  return { mismatched, missing };
}

/** How many terms a family's table prints. */
export const TERM_TABLE_DEPTH = 5;

/**
 * One fixed-width cell, so two runs' tables diff line by line.
 *
 * Eight wide rather than six: a six-wide column of `100.0%` beside a six-wide count renders `12` and `100.0%` as
 * `12100.0%`, which is a table a reader cannot split into fields — the defect this repository's family table had
 * to be fixed for once already.
 */
function share(part: number, whole: number): string {
  return whole === 0 ? '       -' : `${((part / whole) * 100).toFixed(1)}%`.padStart(8);
}

/** A `p` value rendered at the precision that separates the bar from the rest. */
function pText(p: number | undefined): string {
  if (p === undefined) return '      -';
  return p < 1e-4 ? '<1e-4 ' : p.toFixed(4);
}

/**
 * Render the report.
 *
 * The population block comes first and states what was excluded, because a table of shares over an undeclared
 * population is the failure mode the pre-registration exists to prevent. Families below the floor are printed
 * with their counts and no verdict, so a reader can see the reading that was withheld rather than a blank.
 *
 * @param report - The report.
 * @param verdict - Its verdict, from {@link termVerdict}.
 * @returns The table, newline-separated, no trailing newline.
 */
export function formatTermReport(report: TermDecompositionReport, verdict: TermVerdict): string {
  const lines: string[] = [];
  lines.push('Term decomposition of the re-rankable misses');
  lines.push('='.repeat(78));
  lines.push(
    `  population: ${report.misses} misses at depth 1..${MAX_RERANKABLE_DEPTH} of ${report.cases} cases` +
      ` (${report.correctAt1} correct at 1, ${report.absent} absent, ${report.tooDeep} deeper than ${MAX_RERANKABLE_DEPTH})`,
  );
  lines.push(
    `  exact:      ${report.exactMisses}/${report.misses} misses reconstruct their scores` +
      ` (worst residual ${report.worstResidual.toExponential(1)})`,
  );
  lines.push(
    `  bar:        ${(MIN_TERM_SHARE * 100).toFixed(0)}% of a family's in-half, alpha = ${BONFERRONI_ALPHA.toFixed(6)}` +
      ` over ${DECLARED_TERMS.length} terms, n >= ${MIN_FAMILY_CASES}`,
  );
  if (report.undeclared.length > 0) {
    lines.push(`  UNDECLARED: ${report.undeclared.join(', ')}`);
  }
  for (const family of report.families) {
    const head =
      `  ${family.faultType} (n=${family.cases}, in=${family.inCases}, out=${family.outCases})` +
      (family.belowFloor ? '  [below floor: no verdict]' : '');
    lines.push('');
    lines.push(head);
    lines.push(
      `    ${'term'.padEnd(18)}${'in n'.padStart(6)}${'in %'.padStart(8)}${'in p'.padStart(8)}` +
        `${'out n'.padStart(7)}${'out %'.padStart(8)}${'out p'.padStart(8)}  verdict`,
    );
    for (const term of family.terms.slice(0, TERM_TABLE_DEPTH)) {
      const mark = term.confirmed ? 'confirmed' : term.cleared ? 'INVERTED' : '';
      lines.push(
        `    ${term.name.padEnd(18)}${String(term.inHalf.measurable).padStart(6)}` +
          `${share(term.inHalf.wins, term.inHalf.measurable)}${pText(term.inHalf.p).padStart(8)}` +
          `${String(term.outHalf.measurable).padStart(7)}` +
          `${share(term.outHalf.wins, term.outHalf.measurable)}${pText(term.outHalf.p).padStart(8)}  ${mark}`,
      );
    }
  }
  lines.push('');
  lines.push(
    verdict.survives
      ? `H1 SURVIVES: ${verdict.confirmed.length} cell(s) cleared and held out — ${verdict.confirmed.join('; ')}`
      : 'H1 REFUSED: no term clears the bar in-sample and keeps its sign held out; the term axis closes',
  );
  if (verdict.inverted.length > 0) {
    lines.push(`  cleared in-sample but inverted held out: ${verdict.inverted.join('; ')}`);
  }
  return lines.join('\n');
}

/**
 * Parse the report's arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The terms path and the optional depth path.
 * @throws Error on an unknown flag or a missing value, so a typo cannot print a table over the wrong artifact.
 */
export function parseTermReportArgs(argv: readonly string[]): { terms: string; depth: string } {
  let terms = '';
  let depth = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg !== '--terms' && arg !== '--depth') throw new Error(`unrecognised argument ${arg}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--terms') terms = value;
    else depth = value;
    index += 1;
  }
  if (terms === '') throw new Error('--terms is required');
  return { terms, depth };
}
