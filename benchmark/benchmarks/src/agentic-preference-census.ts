/**
 * Whether the model's preference depends on the case at all.
 *
 * The elimination study reports accuracy, and accuracy cannot tell two arms apart that are failing for opposite
 * reasons: a reader that reads the table and misjudges it, and a reader that never reads it and answers from the
 * service names. Both produce a low score, and only the first is a reasoning problem worth paying to fix.
 *
 * The test here is a contingency inside the cases where a given service was **presented** — the model was shown it,
 * so it could have named it. Split those cases by whether that service is the source, and count how often the model
 * named it in each half. A reader that uses the table names a service more often when the row is the source; a
 * model answering from a name prior names it about as often either way; and a model whose prior points the wrong
 * way names it MORE often when it is not the source.
 *
 * On the 1 422-case corpus the third of those is what happened, and by a wide margin: `ts-travel-plan-service` is
 * presented on 738 cases and kept on 251 of them, of which 4 are cases where it is the source — a rate of 38.1 %
 * when it is innocent against 5.0 % when it is guilty. The service is the twelfth most common answer in the corpus
 * and the first most common answer from the model, and the arm's 33.1 % follows from that inversion rather than
 * from arithmetic the protocol could make easier.
 *
 * The unit is the CASE, not the claim: a case that emits four claims keeping the same service has stated one
 * preference, and counting it four times would let a talkative model dominate its own census.
 *
 * @module benchmarks/agentic-preference-census
 */

import type { EliminationClaim } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from './agentic-headroom.js';

/** How many services the census reports. A long tail of three-case services states nothing. */
export const DEFAULT_PREFERENCE_ROWS = 5;

/** One service's contingency: the two halves of the cases it was presented in, and how often it was named. */
export interface PreferenceRow {
  readonly service: string;
  /** Cases where the service was presented AND is a source. */
  readonly whenTruth: number;
  /** Of those, cases where the model named it. */
  readonly keptWhenTruth: number;
  /** Cases where the service was presented and is not a source. */
  readonly whenInnocent: number;
  /** Of those, cases where the model named it. */
  readonly keptWhenInnocent: number;
}

/** What the model prefers, over the whole population. */
export interface PreferenceCensus {
  /** Cases with at least one claim; the population every row is drawn from. */
  readonly cases: number;
  /** Services it named at least once, whether or not they were presented. */
  readonly namedServices: number;
  /** The most-presented services, most presented first, ties broken by name. */
  readonly rows: readonly PreferenceRow[];
  /**
   * Whether the model names a service MORE often when it is innocent, over the reported rows.
   *
   * The single summarising verdict, and it is deliberately binary: a lift below one on one service is a prior, a
   * lift above one is a reader, and a table of forty lifts invites a reader to pick the flattering row.
   */
  readonly inverted: boolean;
}

/**
 * `kept / presented` for one half of a row, or `NaN` when that half is empty.
 *
 * `NaN` rather than zero, because a service that was never presented innocent has no innocent rate and a zero there
 * would read as "the model never confuses it", which is the strongest claim the statistic can make.
 *
 * @param kept - Cases where the model named the service.
 * @param presented - Cases where it could have.
 * @returns The rate, or `NaN`.
 */
export function keepRateOf(kept: number, presented: number): number {
  return presented === 0 ? Number.NaN : kept / presented;
}

/**
 * Census what the model preferred, against the labels, over the cases it was asked about.
 *
 * @param population - The cases the study scored.
 * @param claims - Claims keyed by datapack, as `replayOf` returns them.
 * @param rows - How many services to report. Default {@link DEFAULT_PREFERENCE_ROWS}.
 * @returns The census. Rows are chosen by how many cases presented the service, so a service with a dramatic
 *   lift on three cases cannot outrank the one the arm was actually answering about.
 */
export function preferenceCensusOf(
  population: readonly HeadroomCase[],
  claims: ReadonlyMap<string, readonly EliminationClaim[]>,
  rows: number = DEFAULT_PREFERENCE_ROWS,
): PreferenceCensus {
  interface Tally {
    whenTruth: number;
    keptWhenTruth: number;
    whenInnocent: number;
    keptWhenInnocent: number;
    presented: number;
  }
  const tallies = new Map<string, Tally>();
  const named = new Set<string>();
  let cases = 0;
  for (const one of population) {
    const forCase = claims.get(one.datapack);
    if (forCase === undefined) continue;
    cases += 1;
    const accepted = new Set(one.accepted);
    const kept = new Set(forCase.map((claim) => claim.keep));
    for (const service of kept) named.add(service);
    for (const candidate of one.candidates) {
      const service = candidate.service;
      const tally = tallies.get(service) ?? {
        whenTruth: 0,
        keptWhenTruth: 0,
        whenInnocent: 0,
        keptWhenInnocent: 0,
        presented: 0,
      };
      const keeps = kept.has(service);
      tally.presented += 1;
      if (accepted.has(service)) {
        tally.whenTruth += 1;
        if (keeps) tally.keptWhenTruth += 1;
      } else {
        tally.whenInnocent += 1;
        if (keeps) tally.keptWhenInnocent += 1;
      }
      tallies.set(service, tally);
    }
  }
  const reported = [...tallies.entries()]
    .map(([service, tally]) => ({
      service,
      whenTruth: tally.whenTruth,
      keptWhenTruth: tally.keptWhenTruth,
      whenInnocent: tally.whenInnocent,
      keptWhenInnocent: tally.keptWhenInnocent,
      presented: tally.presented,
    }))
    .sort((a, b) => {
      if (a.presented !== b.presented) return b.presented - a.presented;
      return a.service < b.service ? -1 : a.service > b.service ? 1 : 0;
    })
    .slice(0, Math.max(0, rows))
    .map(({ presented: _presented, ...row }) => row);
  // The verdict is read from the rows a reader is shown, not from a hidden aggregate: a summary computed over
  // services the table does not carry is a number nobody can check against the table.
  const inverted = reported.some((row) => {
    const innocent = keepRateOf(row.keptWhenInnocent, row.whenInnocent);
    const guilty = keepRateOf(row.keptWhenTruth, row.whenTruth);
    return Number.isFinite(innocent) && Number.isFinite(guilty) && innocent > guilty;
  });
  return { cases, namedServices: named.size, rows: reported, inverted };
}

/**
 * The census as the study prints it: one line per reported service, then the verdict.
 *
 * A rate is printed as `-` when its half is empty rather than as `0.0 %`, for the reason {@link keepRateOf} returns
 * `NaN`: an absent denominator is not a rate, and zero is the strongest rate there is.
 *
 * @param census - The census to render.
 * @returns The lines, without a trailing newline.
 */
export function formatPreferenceCensus(census: PreferenceCensus): readonly string[] {
  if (census.cases === 0) return [];
  const rate = (kept: number, of: number): string =>
    Number.isFinite(keepRateOf(kept, of)) ? `${((100 * kept) / of).toFixed(1)} %` : '-';
  const lines = [
    `preference: ${String(census.cases)} answered cases · ${String(census.namedServices)} services named · ` +
      'the most-presented ones, and how often the model named each when it was the source against when it was not:',
  ];
  for (const row of census.rows) {
    lines.push(
      `  ${row.service.padEnd(30)} source ${String(row.keptWhenTruth).padStart(3)}/${String(row.whenTruth).padEnd(3)} ` +
        `(${rate(row.keptWhenTruth, row.whenTruth).padStart(6)}) · innocent ` +
        `${String(row.keptWhenInnocent).padStart(3)}/${String(row.whenInnocent).padEnd(3)} ` +
        `(${rate(row.keptWhenInnocent, row.whenInnocent).padStart(6)})`,
    );
  }
  if (census.inverted) {
    lines.push(
      '  INVERTED: the model names these more often when they are innocent, so its preference is a prior about the',
    );
    lines.push(
      '  service rather than a reading of the row. A protocol change cannot fix that; a different task can.',
    );
  }
  return lines;
}
