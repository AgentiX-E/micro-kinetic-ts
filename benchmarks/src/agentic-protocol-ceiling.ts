/**
 * The two numbers that bound any arm, computed by one instrument so the two protocols can be compared.
 *
 * ## What a ceiling is, and what it is not
 *
 * An accuracy says what an arm did. It does not say what an arm **could** have done, and the difference is the only
 * thing that tells a method that failed from a population that had nothing to give. Two ceilings exist here and
 * they are not the same number:
 *
 * * {@link GateCeiling.reader} — the truth is somewhere in the posterior, so *some* reader could have named it.
 *   This bounds every protocol at once. On the 1 422-case corpus with a width-5 posterior it is 87.8 %.
 * * {@link GateCeiling.union} — the engine is right, **or** the arm is right. This bounds the specific arm under
 *   the specific protocol that produced it, because it can only credit answers that protocol can express. On the
 *   elimination protocol at full damping it is 79.4 %, which is 8.4 points below the reader: the gap is what the
 *   protocol costs to say "promote rank 3 to rank 0".
 *
 * Neither is a method. Both take an ordering and a label, and neither appears in a shipped decision path.
 *
 * ## Why the instrument takes a function instead of a claim set
 *
 * The arm's ordering is the only thing either protocol has in common — an elimination set and a ranking are
 * different objects, and a scorer written against either one would force the other to be translated into it. Taking
 * `orderOf: (oneCase) => string[]` keeps the protocol out of the accounting: the same loop scores a claim arm and a
 * nomination arm, so a difference between them is a difference in the answers rather than in the arithmetic.
 *
 * @module benchmarks/agentic-protocol-ceiling
 */

import type { HeadroomCase } from './agentic-headroom.js';

/** What one arm reached, and what any arm could have reached. */
export interface GateCeiling {
  readonly cases: number;
  /** Cases the engine answered correctly. */
  readonly engine: number;
  /** Cases the arm answered correctly. */
  readonly arm: number;
  /** Cases either answered correctly: the arm's ceiling under its own protocol. */
  readonly union: number;
  /** Cases the arm got right and the engine did not — the arm's entire contribution to any ensemble. */
  readonly armOnly: number;
  /** Cases the engine got right and the arm lost — the price of trusting it. */
  readonly engineOnly: number;
  /** Cases whose posterior holds an accepted answer: the bound on every reader, whatever it is asked. */
  readonly reader: number;
  /** Cases whose posterior holds none, so no protocol could have helped. */
  readonly unreachable: number;
}

/**
 * Score an arm's ordering against the engine's, per case.
 *
 * @param cases - The paired population.
 * @param orderOf - The arm's ordering for one case. Must be a permutation of the engine's services; a shorter
 *   order is read at its first element, and an empty one reads as the engine's.
 * @returns Counts, from which every ratio a table needs is a division.
 */
export function gateCeilingOf(
  cases: readonly HeadroomCase[],
  orderOf: (oneCase: HeadroomCase) => readonly string[],
): GateCeiling {
  let engine = 0;
  let arm = 0;
  let union = 0;
  let armOnly = 0;
  let engineOnly = 0;
  let reader = 0;
  let unreachable = 0;

  for (const oneCase of cases) {
    const accepted = new Set(oneCase.accepted);
    const engineTop = oneCase.candidates[0]?.service;
    const engineRight = engineTop !== undefined && accepted.has(engineTop);
    const armOrder = orderOf(oneCase);
    const armTop = armOrder[0] ?? engineTop;
    const armRight = armTop !== undefined && accepted.has(armTop);
    const reachable = oneCase.candidates.some((candidate) => accepted.has(candidate.service));

    if (engineRight) engine += 1;
    if (armRight) arm += 1;
    if (engineRight || armRight) union += 1;
    if (armRight && !engineRight) armOnly += 1;
    if (engineRight && !armRight) engineOnly += 1;
    if (reachable) reader += 1;
    else unreachable += 1;
  }

  return {
    cases: cases.length,
    engine,
    arm,
    union,
    armOnly,
    engineOnly,
    reader,
    unreachable,
  };
}

/** One rung of a recall curve. */
export interface RecallPoint {
  /** How deep the reader was allowed to look. */
  readonly k: number;
  /** Cases whose accepted answer sits at rank `< k`. */
  readonly reached: number;
  /** `reached / cases`. */
  readonly share: number;
}

/**
 * Recall at depth, over the engine's full order.
 *
 * The point of this curve is that a posterior's width is a **choice**, and the choice bounds every reader: at width
 * five the corpus allows 87.8 %, at twenty it allows 92.1 %, and the 7.9 % where the truth is absent altogether is
 * a fault in candidate generation that no protocol can repair. A table that reports an accuracy without this curve
 * cannot say which of the two it is looking at.
 *
 * @param orders - One record per case: its accepted answers and its full order, best first.
 * @param ks - The depths to report. Values beyond an order's length repeat the previous rung.
 * @returns One point per `k`, ascending.
 */
export function recallCurveOf(
  orders: readonly {
    readonly accepted: readonly string[];
    readonly order: readonly string[];
  }[],
  ks: readonly number[],
): readonly RecallPoint[] {
  const points: RecallPoint[] = [];
  for (const k of [...ks].sort((a, b) => a - b)) {
    let reached = 0;
    for (const record of orders) {
      const accepted = new Set(record.accepted);
      const depth = Math.min(Math.max(0, Math.floor(k)), record.order.length);
      for (let index = 0; index < depth; index += 1) {
        if (accepted.has(record.order[index]!)) {
          reached += 1;
          break;
        }
      }
    }
    points.push({ k, reached, share: orders.length === 0 ? 0 : reached / orders.length });
  }
  return points;
}

/** Format a percentage the way every table in this repository prints one. */
function pct(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

/**
 * Render the ceiling table.
 *
 * @param ceilings - One row per protocol, in publication order.
 * @returns The table, as text.
 */
export function formatGateCeiling(
  ceilings: readonly {
    readonly label: string;
    readonly ceiling: GateCeiling;
  }[],
): string {
  const lines = [
    'protocol          cases   engine      arm    union   arm-only  engine-only  reader  unreachable',
  ];
  for (const { label, ceiling } of ceilings) {
    const denom = ceiling.cases === 0 ? 1 : ceiling.cases;
    lines.push(
      `${label.padEnd(16)}  ${String(ceiling.cases).padStart(5)}  ${pct(ceiling.engine / denom).padStart(6)}  ` +
        `${pct(ceiling.arm / denom).padStart(6)}  ${pct(ceiling.union / denom).padStart(6)}  ` +
        `${String(ceiling.armOnly).padStart(8)}  ${String(ceiling.engineOnly).padStart(11)}  ` +
        `${pct(ceiling.reader / denom).padStart(6)}  ${String(ceiling.unreachable).padStart(11)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Render a recall curve.
 *
 * @param points - The curve, as {@link recallCurveOf} produced it.
 * @param cases - The population size, so the share is printed beside the count.
 * @returns The curve, as text.
 */
export function formatRecallCurve(points: readonly RecallPoint[], cases: number): string {
  const lines = ['depth   reached   share'];
  for (const point of points) {
    lines.push(
      `${String(point.k).padStart(5)}   ${String(point.reached).padStart(7)}   ${pct(point.share)}`,
    );
  }
  lines.push(`population: ${cases} cases`);
  return lines.join('\n');
}
