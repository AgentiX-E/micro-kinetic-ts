/**
 * The fields `REPORTED_CONFIG_FIELDS` permits an ENGINE RUNNER's artifact to omit, in one place.
 *
 * `fse26-report.ts` declares the standard — the fields a run artifact MUST carry to be attributable,
 * because each can move the headline on its own and "an artifact that omits one cannot be compared with
 * another artifact; the difference is unexplained". Two runners produce artifacts that are read against
 * that standard: `run-rcaeval.ts` (the golden 9-cell) and `run-ablation.ts` (the register's ablation
 * reference). Both reach the engine through `TreePruner`, so both are inapplicable to the same six fields
 * for the same reasons, and a record per runner would be two copies of one fact — the defect this
 * repository keeps finding one level up.
 *
 * The FSE'26 half does NOT use this record, and that is a difference rather than an omission: its own line
 * obeys an omission rule derived from the SHIPPED default (`print when the default is not zero, and always
 * when the shipped value is non-zero`), so its exemptions are computed rather than listed.
 *
 * @module benchmarks/reported-config
 */

/**
 * The reported fields an engine runner's artifact may omit, each with the reason it is inapplicable.
 *
 * A `Record` rather than a list, for the reason `OPERATIONAL_OPTIONS` is not a list: "not a ranking knob"
 * and "a ranking knob that was silently dropped" are the same shape in a set, and telling those two apart
 * is the whole point of the partition the guards assert.
 */
export const UNREPORTED_BY_ENGINE_RUNNERS: Readonly<Record<string, string>> = {
  dropMetrics: 'a load-time input ablation; the engine runners have no loader that can apply it',
  metricFleetBaseline: 'a topology-config option; neither construction site passes it',
  failedEdgeMode: 'meaningless without a weight to aggregate; ships at `sum`, never forwarded',
  failedEdgeMinRecords: 'meaningless without a weight to threshold; ships at 1, never forwarded',
  podStateWeight:
    'an FSE-26-only ranking weight: the RCAEval corpora carry no pod-lifecycle channel, so the ' +
    'golden runner has nothing to pass it to and a line that printed it would name a knob this half ' +
    'cannot turn',
  failedEdgeFirst:
    'an FSE-26-only partition: the RCAEval cells carry no per-call failure column, so the ledger it reads is ' +
    'never built on that half and a line that printed it would name a knob this half cannot turn',
  failedEdgeFirstScope:
    'the reading the partition above applies, and unreadable on this half for the same missing column',
  failureContainmentScope:
    'the same missing column one pass over: the failure-flow order reads the per-call failure ledger, which the ' +
    'RCAEval cells do not carry, so the traversal is unreadable on that half and a line that printed it would ' +
    'name a knob this half cannot turn',
};

/**
 * The reported fields an engine runner's line prints ONLY off their shipped value, with the reason.
 *
 * A second record rather than a sixth entry in the one above, because it answers a different question.
 * "The engine runners cannot print this at all" and "the engine runners print this exactly when it is
 * not the shipped reading" are two mechanisms, and collapsing them would let a field that IS printed
 * take cover behind a record whose entries are never printed.
 *
 * ## Why the exception exists at all, when the golden half's rule is "print the shipped value"
 *
 * That rule protects against a real failure: a field that ships at a VALUE of its axis renders an arm
 * and the published run identically when it is omitted, and `topoClosure` is the case that found it.
 * An axis that ships at its own ABSENCE is the mirror case. `topoEdgeRise = null` is not a value of the
 * threshold's range — it is the statement that no threshold exists — so a line that printed it would
 * rewrite the header of every published artifact, invalidating configuration fingerprints and every
 * document that quotes one, in exchange for saying "nothing here". Printing it when a threshold IS set
 * gives the property the rule was for: an arm's artifact names its arm.
 */
export const UNREPORTED_BY_ENGINE_RUNNERS_ON_DEFAULT: Readonly<Record<string, string>> = {
  topoEdgeRise:
    'ships at `null`, which is the absence of the edge-admission axis rather than a value of it; the ' +
    'golden runner prints it whenever a threshold is set, so an arm names itself and a shipped run ' +
    'keeps the header every published fingerprint was taken over',
};

/**
 * The reported fields the ABLATION artifact may omit BEYOND {@link UNREPORTED_BY_ENGINE_RUNNERS}.
 *
 * The shared record's own docblock argues that one record is right because "both runners reach the engine
 * through `TreePruner`, so both are inapplicable to the same six fields for the same reasons". That sentence
 * is still true and no longer sufficient: the two halves' LINES now differ, because the golden half prints
 * the topological deduction — weight, scope and gate, unconditionally, on the rule every field there follows
 * — and the ablation battery prints none of the three.
 *
 * **The difference is a fact about the study, not an oversight, so it is recorded as one.** The battery's
 * unit is a boolean flag per term; the deduction is not one of its terms, so no row VARIES any of its four
 * fields. Printing them on every row would describe a configuration that does not vary, which is the one thing
 * an untouched field must not do to a reader. A second record is the honest shape: the first says
 * "inapplicable to an engine runner", these four say "outside this study".
 *
 * **The reasons below said "ships at 0" until iteration 164, and that had been false since iteration 163.**
 * The enrolment moved the weight to 1 and the gate to 1, so every battery row now RUNS the deduction at the
 * boundary; what the battery does not do is MOVE it, which is a different sentence and the only one these
 * entries may assert. A record that described a configuration the engine no longer ships would have been the
 * one place where the enrolment left a stale claim behind, and it was found by adding the fourth field to a
 * list of three.
 */
export const UNREPORTED_BY_ABLATION_BATTERY: Readonly<Record<string, string>> = {
  topoDiscount:
    'ships at 1 and no row of the battery varies it, so the deduction is at the boundary in every configuration',
  topoDiscountScope:
    'ships at `external` and no row of the battery varies it; it is read only when the weight is non-zero',
  topoDiscountGate:
    'ships at 1 and no row of the battery varies it; it is read only when the weight is non-zero',
  topoClosure:
    'ships at `max` and no row of the battery varies it; it is read only when the weight is non-zero',
  poolAdmission:
    'ships at `positive` and no row of the battery varies it; it is the SET the ranking covers, so every row of the battery runs on the published one',
  // Iteration 265: the fault-free prior. Exempt for a reason neither record above had to state before — the
  // term's input is not an option at all but a CORPUS ARTIFACT, and the battery is a flag-by-flag study over
  // one corpus that never builds one. No row can vary the weight without also supplying a profile, and a row
  // that named the weight alone would describe an arm that scored nothing.
  faultFreeWeight:
    'needs a corpus profile artifact that no row of the battery builds, so no row can vary it',
  faultFreeSelection:
    'needs a corpus profile artifact that no row of the battery builds, so no row can vary it',
  // Iteration 304: the same absent artifact, one consumer further out. The battery cannot vary the containment
  // pass either (it has no switch for it and no profile to feed it), so a row that named the capability would be
  // describing a subset of the engine this study never selects.
  containmentExcursions:
    'the containment pass is not a battery flag and needs the same corpus profile, so no row reaches this state',
  // Iteration 308: the deduction's FIFTH field, owed by the fourth's arrival rather than by its own. The entry
  // above added the family one member at a time and this one had to be added to a list that already had three,
  // which is the shape iteration 164's defect had: a record is edited when the LARGEST member changes and every
  // smaller one is assumed to travel with it. No row of the battery varies the admission threshold, and the
  // battery cannot even build the measurement it reads — the FSE'26 rows would need `traceEdgeLatency` and the
  // probe reads one case at a time.
  topoEdgeRise:
    'no row of the battery varies the admission threshold, and its shipped `null` is the absence of the axis rather than a value of it, so no row can reach a state this field describes',
  // Iteration 312: the failed-edge partition. Exempt because the battery has no row for it and the battery is not
  // the surface it was measured on — the FSE'26 archive is, where the ledger's candidate set covers 99.3 % of
  // truths. A row that flipped the switch on the RCAEval cells would measure whether those corpora carry failed
  // calls at all, which is a statement about the corpus wearing the label of a statement about the pass.
  failedEdgeFirst:
    'the battery has no row for the partition and its cells are not the surface it was measured on, so no row can reach the state this field describes',
  failedEdgeFirstScope:
    'the reading the partition above applies, and the battery has no row for the partition at all',
  failureContainmentScope:
    'the battery varies the pass it belongs to as a single switch, so no row can reach a state this field describes',
};
