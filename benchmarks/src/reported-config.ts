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
};
