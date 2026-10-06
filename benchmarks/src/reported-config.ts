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
  metricRiseCeiling: 'a topology-config option; neither construction site passes it',
  metricFleetBaseline: 'a topology-config option; neither construction site passes it',
  failedEdgeWeight:
    'ships at 0 and is never forwarded, so the direction term is off for every engine run',
  failedEdgeMode: 'meaningless without a weight to aggregate; ships at `sum`, never forwarded',
  failedEdgeMinRecords: 'meaningless without a weight to threshold; ships at 1, never forwarded',
};
