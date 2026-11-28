/**
 * The evidence table, rendered once so that two protocols cannot ask about two different tables.
 *
 * An ablation that compares two ways of *asking* is only an ablation of the asking if both questions carry the
 * same evidence. Two prompt builders that each render their own table would let a month of protocol work be
 * confounded by a formatting change — the failure mode is silent, because both prompts look plausible and only the
 * digest differs. So the table lives here and both builders call it.
 *
 * The rendering is deliberately mechanical: one Markdown table per candidate, a header naming the six fields a
 * claim may quote, and every number printed so that it round-trips to the same double. A model that copies a value
 * from this table into its answer produces a value the verifier accepts; a model that recomputes one produces a
 * number that disagrees in the last digit, and the verifier refuses it. That asymmetry is the point — the protocol
 * asks for transcription, not arithmetic.
 *
 * @module packages/ai/src/agent/table
 */

import type { CandidateFingerprint, ChannelFingerprint } from './hypothesis-space.js';

/** `String(v)` for a finite number, `nan` otherwise, so a printed value round-trips to the same double. */
export function num(value: number): string {
  return Number.isFinite(value) ? String(value) : 'nan';
}

/** The column header both protocols print, as one line, so a test can assert on it without a Markdown parser. */
export const CHANNEL_TABLE_HEADER = '| channel | pre | post | band | rate | onset |';

/** The separator row that follows {@link CHANNEL_TABLE_HEADER}. */
export const CHANNEL_TABLE_RULE = '| --- | ---: | ---: | --- | ---: | ---: |';

/**
 * Render one candidate's row of the evidence table.
 *
 * @param candidate - The candidate, carrying its rank and score.
 * @param channels - The channels to print, already ordered by evidence (`channelsByEvidence`).
 * @returns A Markdown block: the candidate's heading followed by its channel table.
 */
export function renderCandidateTable(
  candidate: CandidateFingerprint,
  channels: readonly ChannelFingerprint[],
): string {
  const lines = [
    `### rank ${candidate.rank} — ${candidate.service} — score ${num(candidate.score)}`,
    CHANNEL_TABLE_HEADER,
    CHANNEL_TABLE_RULE,
  ];
  for (const channel of channels) {
    lines.push(
      `| ${channel.label} | ${num(channel.pre)} | ${num(channel.post)} | ` +
        `[${num(channel.band[0])}, ${num(channel.band[1])}] | ${num(channel.rate)} | ` +
        `${channel.onset === undefined ? '-' : num(channel.onset)} |`,
    );
  }
  return lines.join('\n');
}
