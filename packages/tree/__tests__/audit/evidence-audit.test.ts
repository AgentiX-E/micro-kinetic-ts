import type {
  MetricDiagnostic,
  MetricScoreBreakdown,
  ScoreTerm,
} from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import { auditEvidence } from '../../src/audit/evidence-audit.js';

/**
 * The three failure families `arXiv:2608.21310` mines from 3 500 agent trajectories — *decisive evidence omitted*,
 * *retrieved evidence misinterpreted*, *unsupported inference* — relocated onto the artifacts this engine actually
 * produces. The paper's families are about an agent's ACTIONS; this engine takes none, so each test below asserts
 * the family's content on the record that stands in the same relation, not on a metaphor.
 *
 * The instrument reads `metricDiagnostics` and `ScoreTerm`s only. It has no weight and no threshold, so every
 * assertion here is about the classifier and none about the ranking.
 */

/** A `kept` channel, whose breakdown is the only place the channel's own WINDOW SHAPE survives. */
const kept = (
  label: string,
  score: number,
  shape: Partial<Pick<MetricScoreBreakdown, 'riseRatio' | 'dropRatio'>> = {},
): MetricDiagnostic => ({
  label,
  outcome: 'kept',
  score,
  breakdown: {
    deviation: 1,
    trend: 0,
    cv: 0,
    burst: 0,
    riseRatio: shape.riseRatio ?? 1,
    dropRatio: shape.dropRatio ?? 0,
    baselineMean: 1,
  },
});

/** A channel the guard dropped — it carries no score and no breakdown, by construction. */
const dropped = (label: string): MetricDiagnostic => ({
  label,
  outcome: 'sub-epsilon-deviation',
  score: 0,
});

/** A ranked candidate, which `RootCauseResult` satisfies structurally. */
const candidate = (serviceId: string, terms: ScoreTerm[]) => ({ serviceId, terms });

/** The base term, present on every candidate the pruner scores. */
const base = (value: number): ScoreTerm => ({ name: 'selfAnomalyLog1p', contribution: value });

/** The direction term, whose sign is what `misinterpreted` is charged against. */
const rise = (contribution: number): ScoreTerm => ({ name: 'rise', contribution });

describe('auditEvidence — the three families as predicates over the engine’s own record', () => {
  describe('omitted — the engine measured an anomaly and did not hand it to the ranking', () => {
    it('charges a service that carries an admitted channel but is absent from the ranked list', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9)]]]),
        ranked: [candidate('B', [base(1)])],
      })!;
      expect(audit.counts.omitted).toBe(1);
      expect(audit.findings).toContainEqual(
        expect.objectContaining({ family: 'omitted', serviceId: 'A', evidence: 'cpu' }),
      );
    });

    it('does not charge a service that was measured and DID reach the ranking', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9)]]]),
        ranked: [candidate('A', [base(1)])],
      })!;
      expect(audit.counts.omitted).toBe(0);
    });

    it('does not charge a service the guard dropped, because nothing was measured to omit', () => {
      // The distinction the census of `docs/level-blind-census.md` exists for: an unmeasured channel is an
      // ABSENCE, and reporting it as an omission would conflate "the engine looked and discarded" with
      // "the engine never looked". Only the first is a candidate-floor defect.
      const audit = auditEvidence({
        diagnostics: new Map([['A', [dropped('cpu')]]]),
        ranked: [candidate('B', [base(1)])],
      })!;
      expect(audit.counts.omitted).toBe(0);
    });

    it('judges absence from the list it is GIVEN, so a truncated list reports the truncation', () => {
      // `omitted` is defined against absence from `ranked`. A caller that passes a top-K therefore reports the
      // tail of its own truncation, and that is stated here rather than guarded against: the auditor cannot tell
      // a short list from a complete one, so the requirement is on the caller and the failure is demonstrated.
      const diagnostics = new Map([
        ['A', [kept('cpu', 0.9)]],
        ['B', [kept('cpu', 0.5)]],
      ]);
      const full = auditEvidence({
        diagnostics,
        ranked: [candidate('A', [base(1)]), candidate('B', [base(0.5)])],
      })!;
      const truncated = auditEvidence({ diagnostics, ranked: [candidate('A', [base(1)])] })!;
      expect(full.counts.omitted).toBe(0);
      expect(truncated.counts.omitted).toBe(1);
      expect(truncated.findings.find((f) => f.family === 'omitted')!.serviceId).toBe('B');
    });
  });

  describe('misinterpreted — the paid direction contradicts the channel’s own window shape', () => {
    it('charges a decline paid as a rise, which is the spike-and-return the window means cannot see', () => {
      // `computeRiseScores` reads `tailMean / (headMean + tailMean)` over the dominant channel's two windows,
      // while the same channel's breakdown records the full-range ratios. A spike that RETURNS leaves the means
      // near the baseline and the ratios far apart — the two-sidedness that hid the `hump` from `trimmed-ends`.
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9, { riseRatio: 0.2, dropRatio: 0.8 })]]]),
        ranked: [candidate('A', [base(1), rise(0.3)])],
      })!;
      expect(audit.counts.misinterpreted).toBe(1);
      expect(audit.findings).toContainEqual(
        expect.objectContaining({ family: 'misinterpreted', serviceId: 'A', evidence: 'cpu' }),
      );
    });

    it('does not charge a channel whose shape agrees with the direction that was paid', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9, { riseRatio: 0.8, dropRatio: 0.2 })]]]),
        ranked: [candidate('A', [base(1), rise(0.3)])],
      })!;
      expect(audit.counts.misinterpreted).toBe(0);
    });

    it('does not charge a decline the direction term already refused to pay', () => {
      // The negative contribution IS the correct reading of a decline, so the two agree and there is nothing
      // to charge. Only a contradiction between the shape and the paid sign is a misinterpretation.
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9, { riseRatio: 0.2, dropRatio: 0.8 })]]]),
        ranked: [candidate('A', [base(1), rise(-0.3)])],
      })!;
      expect(audit.counts.misinterpreted).toBe(0);
    });

    it('reads the DOMINANT channel, because that is the one the direction term was computed from', () => {
      // The rise score is a function of the dominant metric alone. A non-dominant channel declining says nothing
      // about what the direction term read, so charging it would attribute a misreading to evidence the term
      // never opened.
      const audit = auditEvidence({
        diagnostics: new Map([
          ['A', [kept('cpu', 0.2, { riseRatio: 0.2, dropRatio: 0.8 }), kept('mem', 0.9)]],
        ]),
        ranked: [candidate('A', [base(1), rise(0.3)])],
      })!;
      expect(audit.counts.misinterpreted).toBe(0);
    });

    it('is silent on a candidate whose breakdown carries no direction term at all', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9, { riseRatio: 0.2, dropRatio: 0.8 })]]]),
        ranked: [candidate('A', [base(1)])],
      })!;
      expect(audit.counts.misinterpreted).toBe(0);
    });
  });

  describe('unsupported — the winning answer’s self-evidence is not a measurement', () => {
    it('charges a top-1 that carries no admitted channel while its base term paid', () => {
      // Rank normalisation gives every scored node a share in [0, 1], so a service with no admitted channel still
      // receives a base term. A winner in that position is ranked on a rank share or a default rather than on a
      // measurement of its own behaviour — the engine's form of inferring without evidence.
      const audit = auditEvidence({
        diagnostics: new Map([
          ['A', [dropped('cpu')]],
          ['B', [kept('cpu', 0.1)]],
        ]),
        ranked: [candidate('A', [base(0.69)]), candidate('B', [base(0.5)])],
      })!;
      expect(audit.counts.unsupported).toBe(1);
      expect(audit.findings).toContainEqual(
        expect.objectContaining({
          family: 'unsupported',
          serviceId: 'A',
          evidence: 'selfAnomalyLog1p',
        }),
      );
    });

    it('does not charge a top-1 whose base term IS backed by an admitted channel', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9)]]]),
        ranked: [candidate('A', [base(0.69)])],
      })!;
      expect(audit.counts.unsupported).toBe(0);
    });

    it('does not charge a top-1 whose base term paid nothing', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [dropped('cpu')]]]),
        ranked: [candidate('A', [base(0)])],
      })!;
      expect(audit.counts.unsupported).toBe(0);
    });

    it('is a statement about the CHAMPION, not about the case', () => {
      // A case can be full of unbacked candidates below the winner and still have a measured answer. Charging
      // the case would report the ranking's depth as the diagnosis's defect.
      const audit = auditEvidence({
        diagnostics: new Map([
          ['A', [kept('cpu', 0.9)]],
          ['B', [dropped('cpu')]],
        ]),
        ranked: [candidate('A', [base(0.69)]), candidate('B', [base(0.6)])],
      })!;
      expect(audit.counts.unsupported).toBe(0);
    });
  });

  describe('the record the instrument refuses to invent', () => {
    it('answers NOTHING — not zero findings — when the run carries no channel diagnostics', () => {
      // A run with no channel record had no diagnostic pass, so an empty audit would be read as "no defects".
      // The absence of the map and the absence of findings are different facts, and only one of them is a
      // statement about the engine's evidence use.
      expect(auditEvidence({ diagnostics: undefined, ranked: [candidate('A', [base(1)])] })).toBe(
        undefined,
      );
    });

    it('reports zero findings for a case with no diagnostics entries and no candidates', () => {
      const audit = auditEvidence({ diagnostics: new Map(), ranked: [] })!;
      expect(audit.counts).toEqual({ omitted: 0, misinterpreted: 0, unsupported: 0 });
      expect(audit.findings).toEqual([]);
    });

    it('keeps counts and findings in step, so a caller may aggregate either', () => {
      const audit = auditEvidence({
        diagnostics: new Map([
          ['A', [kept('cpu', 0.9, { riseRatio: 0.2, dropRatio: 0.8 })]],
          ['B', [kept('cpu', 0.9)]],
        ]),
        ranked: [candidate('A', [base(1), rise(0.3)])],
      })!;
      const byFamily = { omitted: 0, misinterpreted: 0, unsupported: 0 };
      for (const f of audit.findings) byFamily[f.family] += 1;
      expect(byFamily).toEqual(audit.counts);
      expect(audit.counts.omitted).toBe(1);
      expect(audit.counts.misinterpreted).toBe(1);
    });

    it('uses the truth label to ATTRIBUTE a hit and never to decide one', () => {
      // A production run has no truth, so an instrument that needed one would be an evaluation artifact rather
      // than a diagnostic. The label only marks which findings land on the case's own answer.
      const input = {
        diagnostics: new Map([
          ['A', [kept('cpu', 0.9, { riseRatio: 0.2, dropRatio: 0.8 })]],
          ['B', [kept('cpu', 0.9)]],
        ]),
        ranked: [candidate('A', [base(1), rise(0.3)])],
      };
      const without = auditEvidence(input)!;
      const withTruth = auditEvidence({ ...input, truth: 'B' })!;
      expect(withTruth.counts).toEqual(without.counts);
      expect(withTruth.findings.map((f) => f.family)).toEqual(
        without.findings.map((f) => f.family),
      );
      // …and with no label there is nothing to attribute TO, so every flag is false rather than absent.
      expect(without.findings.every((f) => f.onTruth === false)).toBe(true);
      expect(withTruth.findings.filter((f) => f.onTruth).map((f) => f.serviceId)).toEqual(['B']);
    });

    it('marks a finding on the truth service, so the two readings are separable', () => {
      const audit = auditEvidence({
        diagnostics: new Map([['A', [kept('cpu', 0.9, { riseRatio: 0.2, dropRatio: 0.8 })]]]),
        ranked: [candidate('A', [base(1), rise(0.3)])],
        truth: 'A',
      })!;
      expect(audit.findings.every((f) => f.family === 'misinterpreted')).toBe(true);
      expect(audit.findings[0]!.onTruth).toBe(true);
    });
  });
});
