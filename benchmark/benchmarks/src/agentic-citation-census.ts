/**
 * What a model's claims actually cited, read against the table it was shown.
 *
 * The elimination study reports how many claims the verifier refused and under which reason, and that is the right
 * ledger for a ranking: a refused claim moved nothing. It is the wrong ledger for a **reader**, because two very
 * different failures produce the same kind of row — a model that invented a channel nobody measured and a model that
 * answered a narrower question than the one asked both spend a claim on nothing.
 *
 * This module is the reading of the page rather than of the answer. For every claim it asks three questions the
 * fingerprint can answer without the label, and one it can only answer about the channel:
 *
 * - did the eliminated candidate's row carry the cited label at all (**absent** — fabrication);
 * - did the kept candidate's row carry it (**unshared** — a comparison needs two readings, and the protocol says so
 *   from version 2 onward);
 * - and, for the claims that survive those two, was the cited channel **ordinary** — out of its fault-free band in
 *   at least half of the clean windows the profile measured, and therefore a channel that swings when nothing is
 *   wrong.
 *
 * `meanRate` is the number that made the presentation defect visible. On the 1 422-case corpus it was 0.42 while the
 * two `filesystem.available` channels — cited by 48 % of all claims — carry a rate of 0.99 themselves, which is to
 * say the table was leading with the one row that could not be evidence and the model was quoting it back.
 *
 * The unit is the CLAIM, not the case, and that is deliberate: a case with four claims has four chances to cite a
 * plausible channel, so a per-case rate would fall as a model got more talkative.
 *
 * @module benchmarks/agentic-citation-census
 */

import type { ChannelFingerprint, EliminationClaim } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from './agentic-headroom.js';

/**
 * The rate at or above which a cited channel counts as ordinary.
 *
 * A half, because that is the point at which the channel leaves its fault-free band more often than not: citing it
 * is then a statement about the channel's habit rather than about the case. It is a reported bucket and not a
 * decision rule — nothing in this repository acts on it — so the boundary is chosen for legibility rather than
 * fitted to a corpus.
 */
export const ORDINARY_RATE = 0.5;

/** How many distinct labels the census carries. A long tail of one-off citations is a number, not a diagnosis. */
export const DEFAULT_CITED_LABELS = 5;

/** One cited label and how many claims named it. */
export interface CitedLabel {
  readonly label: string;
  readonly claims: number;
}

/** What the model read, over one claims file. */
export interface CitationCensus {
  /** Claims examined. */
  readonly claims: number;
  /** Claims whose eliminated candidate is not in the case's posterior at all. */
  readonly unknownCandidate: number;
  /** Claims citing a label the eliminated candidate does not carry — a channel nobody measured on that row. */
  readonly absent: number;
  /** Claims citing a label the eliminated candidate carries and the kept candidate does not. */
  readonly unshared: number;
  /** Claims the verifier could judge on its own evidence: the label is on both rows. */
  readonly comparable: number;
  /** Comparable claims whose cited channel leaves its fault-free band in at least {@link ORDINARY_RATE}. */
  readonly ordinary: number;
  /** Mean fault-free excursion rate of the cited channel over {@link comparable} claims; `NaN` when there are none. */
  readonly meanRate: number;
  /** The most-cited labels, largest first, ties broken by label. */
  readonly labels: readonly CitedLabel[];
}

/**
 * Census one case's claims.
 *
 * @param one - The case the claims belong to.
 * @param claims - The claims replayed for it.
 * @param topLabels - How many labels the running tally keeps.
 * @returns Fresh counters, to be summed by the caller.
 */
function censusOfCase(
  one: HeadroomCase,
  claims: readonly EliminationClaim[],
): {
  claims: number;
  unknownCandidate: number;
  absent: number;
  unshared: number;
  comparable: number;
  ordinary: number;
  rateSum: number;
  tally: Map<string, number>;
} {
  const byService = new Map<string, ReadonlyMap<string, ChannelFingerprint>>();
  for (const candidate of one.candidates) {
    byService.set(candidate.service, new Map(candidate.channels.map((c) => [c.label, c])));
  }
  const counts = {
    claims: 0,
    unknownCandidate: 0,
    absent: 0,
    unshared: 0,
    comparable: 0,
    ordinary: 0,
    rateSum: 0,
    tally: new Map<string, number>(),
  };
  for (const claim of claims) {
    counts.claims += 1;
    const onRemoved = byService.get(claim.remove);
    if (onRemoved === undefined) {
      counts.unknownCandidate += 1;
      continue;
    }
    const cited = onRemoved.get(claim.because.channel);
    if (cited === undefined) {
      counts.absent += 1;
      continue;
    }
    if (byService.get(claim.keep)?.has(claim.because.channel) !== true) {
      counts.unshared += 1;
      continue;
    }
    counts.comparable += 1;
    counts.rateSum += cited.rate;
    if (cited.rate >= ORDINARY_RATE) counts.ordinary += 1;
    counts.tally.set(cited.label, (counts.tally.get(cited.label) ?? 0) + 1);
  }
  return counts;
}

/**
 * Census every claim in a replay against the cases it was asked about.
 *
 * A case in the replay that is not in the population is skipped, not counted: the population is the scope that was
 * scored, and a claim about a case outside it belongs to a different run's table.
 *
 * @param population - The cases the study scored.
 * @param claims - Claims keyed by datapack, as `replayOf` returns them.
 * @param topLabels - How many labels to report. Default {@link DEFAULT_CITED_LABELS}.
 * @returns The census; `meanRate` is `NaN` when no claim was comparable.
 */
export function citationCensusOf(
  population: readonly HeadroomCase[],
  claims: ReadonlyMap<string, readonly EliminationClaim[]>,
  topLabels: number = DEFAULT_CITED_LABELS,
): CitationCensus {
  let claims_ = 0;
  let unknownCandidate = 0;
  let absent = 0;
  let unshared = 0;
  let comparable = 0;
  let ordinary = 0;
  let rateSum = 0;
  const tally = new Map<string, number>();
  for (const one of population) {
    const forCase = claims.get(one.datapack);
    if (forCase === undefined) continue;
    const counted = censusOfCase(one, forCase);
    claims_ += counted.claims;
    unknownCandidate += counted.unknownCandidate;
    absent += counted.absent;
    unshared += counted.unshared;
    comparable += counted.comparable;
    ordinary += counted.ordinary;
    rateSum += counted.rateSum;
    for (const [label, count] of counted.tally) tally.set(label, (tally.get(label) ?? 0) + count);
  }
  const labels = [...tally.entries()]
    .map(([label, count]) => ({ label, claims: count }))
    .sort((a, b) => {
      if (a.claims !== b.claims) return b.claims - a.claims;
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    })
    .slice(0, Math.max(0, topLabels));
  return {
    claims: claims_,
    unknownCandidate,
    absent,
    unshared,
    comparable,
    ordinary,
    meanRate: comparable === 0 ? Number.NaN : rateSum / comparable,
    labels,
  };
}

/**
 * The census as the study prints it: two lines, because a reader compares the two halves against different things.
 *
 * The first line is about whether the claim was answerable at all, and its three numbers are exclusive. The second
 * is about the channels — how ordinary they are, and which ones the model reaches for.
 *
 * @param census - The census to render.
 * @returns The lines, without a trailing newline.
 */
export function formatCitationCensus(census: CitationCensus): readonly string[] {
  if (census.claims === 0)
    return ['citations: none — no claim in this file names a case in this population'];
  const share = (part: number): string => `${((100 * part) / census.claims).toFixed(1)} %`;
  const labels =
    census.labels.length === 0
      ? 'none'
      : census.labels.map((one) => `${one.label} ×${one.claims}`).join(', ');
  return [
    `citations: ${String(census.claims)} claims · ${String(census.comparable)} cite a channel both rows carry ` +
      `(${share(census.comparable)}) · ${String(census.unshared)} cite one only the eliminated row carries ` +
      `(${share(census.unshared)}) · ${String(census.absent)} name a label that row never printed ` +
      `(${share(census.absent)})` +
      (census.unknownCandidate > 0
        ? ` · ${String(census.unknownCandidate)} name a service outside the posterior`
        : ''),
    `           mean fault-free rate of a cited channel ${census.meanRate.toFixed(2)} · ` +
      `${String(census.ordinary)} cite a channel that swings in at least half of clean windows ` +
      `(${share(census.ordinary)}) · most cited: ${labels}`,
  ];
}
