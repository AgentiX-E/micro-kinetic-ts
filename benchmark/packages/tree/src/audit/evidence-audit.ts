/**
 * The three failure families of `arXiv:2608.21310`, as predicates over this engine's own record.
 *
 * ## Why this module exists
 *
 * That paper evaluates 3 500 RCA-agent trajectories and finds that endpoint correctness hides broken diagnoses.
 * Its actionable contribution is not the agent architecture — it is a TAXONOMY of three ways evidence handling
 * goes wrong:
 *
 * > failures arise when decisive evidence is **omitted**, retrieved evidence is **misinterpreted**, or
 * > **unsupported inference** substitutes for missing evidence.
 *
 * Operationalised as `DiagGuard`, the taxonomy lifts `Acc@1` by `+9.0` on a held-out model, benchmark and
 * topology, near-additively (`+4.5` from grounding, `+4.1` from verification) and with gains on all nine fault
 * types. Those numbers are the argument for reading the taxonomy as a MECHANISM rather than as one paper's
 * framework — and a mechanism can be expressed against any process that consumes evidence. This engine's process
 * is one deterministic pass, so what follows is that taxonomy relocated onto the artifacts it actually writes.
 *
 * ## The three predicates
 *
 * Each is a statement about what the CODE recorded, and each is checkable from `metricDiagnostics` and
 * `ScoreTerm` alone — no weight, no threshold, no ground truth:
 *
 * - **`omitted`** — a service carries at least one `kept` channel yet its id is absent from the ranked list. The
 *   engine measured an anomaly and did not hand it to the ranking, so something upstream of the formula decided.
 * - **`misinterpreted`** — a service's DOMINANT channel (the `kept` entry with the highest score, which is the one
 *   the direction term was computed from) has `dropRatio > riseRatio`, while its `rise` term contributed `> 0`.
 *   The channel's own window shape says the tail sits below its head; the direction term paid it as a rise.
 * - **`unsupported`** — the top-1 carries NO `kept` channel while its `selfAnomalyLog1p` contributed `> 0`. Rank
 *   normalisation gives every scored node a share in `[0, 1]`, so a service with nothing admitted still receives a
 *   base term; a winner in that position is ranked on a rank share or a default rather than on a measurement.
 *
 * ## Two properties that are load-bearing
 *
 * 1. **Truth-free.** None of the three reads a ground-truth label. A production run has no label, so an instrument
 *    that required one would be an evaluation artifact rather than a diagnostic. When `truth` IS supplied it is
 *    used only to ATTRIBUTE — {@link EvidenceAuditFinding.onTruth} marks which findings land on the case's own
 *    answer — and a test asserts that supplying it moves no count.
 * 2. **`ranked` must be the FULL candidate ordering.** `omitted` is defined against absence from `ranked`, so a
 *    caller that passes a top-K reports the tail of its own truncation as omissions. The auditor cannot tell a
 *    short list from a complete one, so the requirement is stated here and demonstrated by a test rather than
 *    guessed at.
 *
 * ## What this module does NOT do
 *
 * It changes no score, and its counts are not comparable to the paper's: those are rates of agent behaviour on a
 * different corpus and a different label space. This is instrumentation, and the fixes it suggests are enrolled
 * only after a pre-registered arm — the rule `docs/transient-guard-evidence.md` §13.2 records.
 */
import type { MetricDiagnostic, ScoreTerm } from '@agentix-e/micro-kinetic-core';

/** The three evidence-handling failures, in the paper's order. */
export type EvidenceFailureFamily = 'omitted' | 'misinterpreted' | 'unsupported';

/** One case-level defect, named against the evidence it is charged to. */
export interface EvidenceAuditFinding {
  /** Which of the three families the defect belongs to. */
  readonly family: EvidenceFailureFamily;
  /** The service the defect is about. For `unsupported` this is always the champion. */
  readonly serviceId: string;
  /**
   * The record the defect is charged to: a channel `label` for `omitted` and `misinterpreted`, and the term's
   * name for `unsupported`. Named so a reader can open the artifact rather than infer the evidence.
   */
  readonly evidence: string;
  /**
   * Whether this finding lands on the case's own answer. Always `false` when no `truth` was supplied — the flag
   * reports attribution, and a run with no label has nothing to attribute TO.
   */
  readonly onTruth: boolean;
}

/** The audit of one case. */
export interface EvidenceAudit {
  /** Every finding, in family order (`omitted`, `misinterpreted`, `unsupported`). */
  readonly findings: readonly EvidenceAuditFinding[];
  /** The per-family counts, kept in step with {@link findings} so a caller may aggregate either. */
  readonly counts: Readonly<Record<EvidenceFailureFamily, number>>;
}

/**
 * The part of a ranked candidate this module reads.
 *
 * Narrow on purpose: `RootCauseResult` satisfies it structurally, so the auditor is a function of the two records
 * it names and not of the pruner's whole result shape — and a test can state a candidate in one line.
 */
export interface AuditCandidate {
  readonly serviceId: string;
  /** The named contributions that sum to the score. Absent when the producer wrote no breakdown. */
  readonly terms?: readonly ScoreTerm[];
}

/** What the auditor reads: the case's channel record and its full ranked candidate list. */
export interface EvidenceAuditInput {
  /**
   * The per-service channel diagnostics — `FaultPropagationGraph.metricDiagnostics` verbatim.
   *
   * `undefined` means the run took no diagnostic pass, which is NOT the same as a run where nothing was admitted.
   * The auditor answers `undefined` for it rather than an empty audit, because an empty audit would be read as
   * "no defects" and this module's whole subject is the difference between an absence and a zero.
   */
  readonly diagnostics: ReadonlyMap<string, readonly MetricDiagnostic[]> | undefined;
  /** The FULL candidate ordering. See the module docblock on why a top-K is not this. */
  readonly ranked: readonly AuditCandidate[];
  /** The case's ground-truth service, when one is known. Used only for attribution. */
  readonly truth?: string;
}

/** The `kept` channel the node's anomaly score was maximised over — the one the signals were read from. */
function dominantKept(
  entries: readonly MetricDiagnostic[] | undefined,
): MetricDiagnostic | undefined {
  let dominant: MetricDiagnostic | undefined;
  for (const entry of entries ?? []) {
    // Strict `>`, so the first of two equal scores wins: the max is taken in array order everywhere else, and a
    // tie broken differently here would make the audit describe a different channel than the score did.
    if (entry.outcome === 'kept' && (dominant === undefined || entry.score > dominant.score)) {
      dominant = entry;
    }
  }
  return dominant;
}

/** One term's contribution, or 0 when the producer wrote no breakdown or no such term. */
function contributionOf(terms: readonly ScoreTerm[] | undefined, name: string): number {
  for (const term of terms ?? []) if (term.name === name) return term.contribution;
  return 0;
}

/**
 * Classify one case into the three families.
 *
 * @returns `undefined` when the case carries no channel diagnostics — see {@link EvidenceAuditInput.diagnostics}.
 */
export function auditEvidence(input: EvidenceAuditInput): EvidenceAudit | undefined {
  const { diagnostics, ranked, truth } = input;
  if (diagnostics === undefined) return undefined;

  const findings: EvidenceAuditFinding[] = [];
  const onTruth = (serviceId: string): boolean => truth !== undefined && serviceId === truth;
  const rankedIds = new Set(ranked.map((candidate) => candidate.serviceId));

  // `omitted` — measured and not handed over. Walked over the DIAGNOSTICS rather than the ranking, because the
  // whole family is about services the ranking does not contain.
  for (const [serviceId, entries] of diagnostics) {
    const dominant = dominantKept(entries);
    if (dominant === undefined || rankedIds.has(serviceId)) continue;
    findings.push({
      family: 'omitted',
      serviceId,
      evidence: dominant.label,
      onTruth: onTruth(serviceId),
    });
  }

  // `misinterpreted` — the paid direction against the channel's own two-sided shape. Walked over the RANKING,
  // because the family is about what the formula did with evidence it had.
  for (const candidate of ranked) {
    const dominant = dominantKept(diagnostics.get(candidate.serviceId));
    const breakdown = dominant?.breakdown;
    if (dominant === undefined || breakdown === undefined) continue;
    // A decline is `dropRatio > riseRatio`: the tail sits below the head by more than it sits above. A tie is not
    // a decline, so the comparison is strict and a flat channel is never charged.
    if (breakdown.dropRatio <= breakdown.riseRatio) continue;
    if (contributionOf(candidate.terms, 'rise') <= 0) continue;
    findings.push({
      family: 'misinterpreted',
      serviceId: candidate.serviceId,
      evidence: dominant.label,
      onTruth: onTruth(candidate.serviceId),
    });
  }

  // `unsupported` — the champion's base term with nothing admitted behind it. A statement about the CHAMPION
  // only: unbacked candidates below the winner are the ranking's depth, not the diagnosis's defect.
  const champion = ranked[0];
  if (champion !== undefined) {
    const backed = dominantKept(diagnostics.get(champion.serviceId)) !== undefined;
    if (!backed && contributionOf(champion.terms, 'selfAnomalyLog1p') > 0) {
      findings.push({
        family: 'unsupported',
        serviceId: champion.serviceId,
        evidence: 'selfAnomalyLog1p',
        onTruth: onTruth(champion.serviceId),
      });
    }
  }

  const counts: Record<EvidenceFailureFamily, number> = {
    omitted: 0,
    misinterpreted: 0,
    unsupported: 0,
  };
  for (const finding of findings) counts[finding.family] += 1;
  return { findings, counts };
}
