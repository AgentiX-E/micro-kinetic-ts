import { describe, expect, it } from 'vitest';

import {
  TOPOLOGY_BRIEF_HEADING,
  TopologyUnion,
  buildNominationPrompt,
  type CandidateFingerprint,
} from '../../packages/ai/src/agent/index.js';

/**
 * The arm's guard, tested as a property of a POPULATION rather than of one prompt.
 *
 * `preregistration-306.md` states the requirement: one string per corpus, asserted over the whole population,
 * because a per-case text is a per-case input and a per-case input can carry the answer. This file builds a small
 * corpus whose cases differ in every field that could leak — fault type, candidate set, accepted set — and checks
 * the property that makes the brief a channel: the SECTION is byte-identical for all of them.
 */

/** One case, shaped the way `HeadroomCase` is: an id, a fault type, the engine's candidates, and the labels. */
interface SyntheticCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly accepted: readonly string[];
  readonly candidates: readonly CandidateFingerprint[];
}

function candidate(service: string, rank: number, score: number): CandidateFingerprint {
  return {
    service,
    rank,
    score,
    channels: [
      { label: 'latency_p99', pre: 4, post: 40 + rank, band: [3, 6], rate: 0.02, onset: 900 },
    ],
  };
}

const CORPUS: readonly SyntheticCase[] = [
  {
    datapack: 'c0',
    faultType: 'PodKill',
    accepted: ['ts-order-service'],
    candidates: ['ts-order-service', 'ts-seat-service', 'ts-train-service'],
  },
  {
    datapack: 'c1',
    faultType: 'HTTPRequestDelay',
    accepted: ['ts-seat-service'],
    candidates: ['ts-train-service', 'ts-seat-service', 'ts-order-service'],
  },
  {
    datapack: 'c2',
    faultType: 'ContainerKill',
    accepted: ['mysql', 'rabbitmq'],
    candidates: ['rabbitmq', 'mysql', 'ts-basic-service'],
  },
  {
    datapack: 'c3',
    faultType: 'NetworkPartition',
    accepted: ['ts-basic-service', 'ts-station-service'],
    candidates: ['ts-station-service', 'ts-basic-service', 'mysql'],
  },
].map((row) => ({
  ...row,
  candidates: row.candidates.map((service, index) => candidate(service, index, 1 - index * 0.2)),
}));

/** The union, taken over the same corpus, from edges that name no fault type and no label. */
function union(): TopologyUnion {
  const built = new TopologyUnion();
  built.addCase([
    { from: 'ts-order-service', to: 'ts-seat-service' },
    { from: 'ts-seat-service', to: 'ts-train-service' },
    { from: 'ts-seat-service', to: 'ts-basic-service' },
    { from: 'ts-basic-service', to: 'ts-station-service' },
    { from: 'mysql', to: 'ts-basic-service' },
    { from: 'rabbitmq', to: 'ts-order-service' },
  ]);
  return built;
}

/** The section, as it appears in a prompt, from the heading to the next blank line after the last edge. */
function sectionOf(user: string): string {
  const start = user.indexOf(TOPOLOGY_BRIEF_HEADING);
  expect(start, 'the prompt must carry the section').toBeGreaterThanOrEqual(0);
  const before = user.slice(0, start);
  expect(before.endsWith('\n\n') || before === '').toBe(true);
  return user.slice(start, user.indexOf('\nCANDIDATES:')).trimEnd();
}

describe('the topology brief is a channel over a population, not an input per case', () => {
  const brief = union().render(CORPUS.length);

  it('sends the SAME bytes to every case in the corpus, which is what makes a leak structurally impossible', () => {
    const sections = CORPUS.map((one) =>
      sectionOf(
        buildNominationPrompt(one.faultType, one.candidates, {
          maxCandidates: 5,
          maxChannels: 8,
          maxRanked: 5,
          topologyBrief: brief.text,
        }).user,
      ),
    );
    for (const section of sections) expect(section).toBe(sections[0]);
    // And the section is the rendered brief, not a truncation of it: a prompt that carried the first N lines would
    // be a rendering whose omission depends on the table's length, i.e. on the case.
    expect(sections[0]).toBe(brief.text);
  });

  it('cannot carry a label, because the derivation is given the union and the population size and nothing else', () => {
    // Two corpora with the SAME edges and DIFFERENT labels, fault types and orders render one brief. If the
    // rendering could see a label this is the assertion that would fail, and it is asserted on the digests as well
    // as the text so a reader can see the identity is the whole artifact.
    const relabelled = CORPUS.map((one) => ({
      ...one,
      accepted: one.candidates.map((entry) => entry.service).reverse(),
      faultType: 'SomethingElse',
      candidates: [...one.candidates].reverse(),
    }));
    expect(relabelled[0]!.accepted).not.toEqual(CORPUS[0]!.accepted);
    expect(union().render(relabelled.length).digest).toBe(brief.digest);
    expect(union().render(relabelled.length).text).toBe(brief.text);
  });

  it('changes every case\u2019s digest, so no claim recorded without the brief can be scored under it', () => {
    for (const one of CORPUS) {
      const options = { maxCandidates: 5, maxChannels: 8, maxRanked: 5, topologyBrief: '' };
      const control = buildNominationPrompt(one.faultType, one.candidates, options);
      const arm = buildNominationPrompt(one.faultType, one.candidates, {
        ...options,
        topologyBrief: brief.text,
      });
      expect(arm.digest).not.toBe(control.digest);
      // The presentation is untouched: the arm differs in what it was told and not in what it was shown.
      expect(arm.presented).toBe(control.presented);
      expect(arm.user).toContain(control.user.slice(control.user.indexOf('CANDIDATES:')));
    }
  });

  it('grows the prompt by the brief plus two separators, and the log can price that exactly', () => {
    const one = CORPUS[0]!;
    const options = { maxCandidates: 5, maxChannels: 8, maxRanked: 5, topologyBrief: '' };
    const control = buildNominationPrompt(one.faultType, one.candidates, options);
    const arm = buildNominationPrompt(one.faultType, one.candidates, {
      ...options,
      topologyBrief: brief.text,
    });
    // The header array gains two elements — an empty line and the brief — so `join('\n')` adds one separator for
    // each: `FAULT TYPE\n\n<brief>\nCANDIDATES` against `FAULT TYPE\nCANDIDATES`. The exact number is asserted
    // rather than a bound, because this is the quantity the dispatch's cost is computed from.
    expect(arm.user.length - control.user.length).toBe(brief.text.length + 2);
    expect(arm.system).toBe(control.system);
  });
});
