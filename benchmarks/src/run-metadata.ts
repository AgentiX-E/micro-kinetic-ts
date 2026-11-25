/**
 * What an artifact has to say about itself before any two artifacts may be compared.
 *
 * @module benchmarks/src/run-metadata
 */

/** The flags that change what a model is shown, in the order a reader should read them. */
export interface RunArms {
  readonly seed: 'none' | 'engine';
  readonly gate: string;
  /**
   * What a refused override settles on — and the field whose ABSENCE from this record cost this programme its
   * standing for a day. The 2026-11-22 artifact settled 287 of its 532 sampled cases without the model (`fallback
   * engine` plus the resolvers); the 2026-11-25 artifact ran every one of them through the model
   * (`fallback none`). Both records said `free`.
   */
  readonly fallback: 'none' | 'engine';
  /** The deterministic resolver consulted after the gate, or `none`. */
  readonly resolve: string;
  readonly schedule: 'none' | 'engine';
  readonly fleetOrder: 'none' | 'engine';
  readonly evidenceOrder: 'none' | 'onset';
}

/** The fields a run record carries. */
export interface RunInputs extends RunArms {
  readonly model: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly cases: number;
  readonly maxRounds: number;
  readonly maxToolCalls: number;
  /**
   * The harness's own revision, when the run could name one.
   *
   * The instruction the model reads is a function of the code, so two artifacts from different commits are two
   * instruments. A comparison across them is a bisect, which is a legitimate experiment and never an arm effect —
   * `comparisonRefusal` refuses it unless the caller declares `revision` as the axis.
   */
  readonly revision?: string | null;
}

/** The record written beside an artifact. */
export interface RunMetadata {
  readonly model: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationSeconds: number;
  readonly cases: number;
  readonly budget: { readonly maxRounds: number; readonly maxToolCalls: number };
  /** `free`, or a `+`-joined list of the arms that are not at their default. */
  readonly arms: string;
  /** The harness revision, or `null` when the run could not name one. */
  readonly revision: string | null;
}

/**
 * Build the sibling record for one arm's artifact.
 *
 * @param inputs - The run's clock, model, budget and flags.
 * @returns The record, with a duration that cannot be negative.
 * @throws When `endedAt` precedes `startedAt` — the only way this record can be false about itself.
 */
export function runMetadataOf(inputs: RunInputs): RunMetadata {
  const started = Date.parse(inputs.startedAt);
  const ended = Date.parse(inputs.endedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    throw new Error('run metadata: startedAt and endedAt must be ISO timestamps');
  }
  if (ended < started) {
    throw new Error(
      `run metadata: endedAt (${inputs.endedAt}) precedes startedAt (${inputs.startedAt})`,
    );
  }
  // The arms are collapsed to one string on purpose: the failure this record exists for was a reader comparing two
  // files and seeing nothing to compare. A field that reads `free` in one file and `fleet=engine` in the other is a
  // diff a person notices.
  const named: string[] = [];
  if (inputs.seed !== 'none') named.push(`seed=${inputs.seed}`);
  if (inputs.gate !== 'none') named.push(`gate=${inputs.gate}`);
  // After the gate and before the route, because that is the order the harness applies them: the gate decides whether
  // an override is admitted, the fallback decides what a refusal settles on, and the resolver reads the case for the
  // rules no model call can settle.
  if (inputs.fallback !== 'none') named.push(`fallback=${inputs.fallback}`);
  if (inputs.resolve !== 'none') named.push(`resolve=${inputs.resolve}`);
  if (inputs.schedule !== 'none') named.push(`schedule=${inputs.schedule}`);
  if (inputs.fleetOrder !== 'none') named.push(`fleet=${inputs.fleetOrder}`);
  if (inputs.evidenceOrder !== 'none') named.push(`onset=${inputs.evidenceOrder}`);
  return {
    model: inputs.model,
    startedAt: inputs.startedAt,
    endedAt: inputs.endedAt,
    durationSeconds: Math.round((ended - started) / 1_000),
    cases: inputs.cases,
    budget: { maxRounds: inputs.maxRounds, maxToolCalls: inputs.maxToolCalls },
    arms: named.length === 0 ? 'free' : named.join('+'),
    revision: inputs.revision ?? null,
  };
}
