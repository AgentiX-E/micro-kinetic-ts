/**
 * The Cloud-OpsBench arms, held to a committed reading.
 *
 * ## The hole this closes
 *
 * `docs/cloud-opsbench-connection.md` §8 publishes `CA@1` `0.5128` on 156 cases, and `docs/label-prior.md` §6
 * publishes four arms over the same 156. **Nothing compares either against a recorded reading.** The nine RCAEval
 * cells have `benchmarks/baselines/rcaeval-nine-cells.json` and a gate that fails a job on any cell that moved; this
 * corpus has prose. §371 then demonstrated what prose is worth: an arm rotted, the runner went on printing a
 * configuration it was not running, and every assertion in the repository stayed green because every one of them
 * compares a document against ITSELF.
 *
 * So this module is the same mechanism, one corpus over: a recorded reading of the arms, a comparison against what a
 * run actually produced, and a refusal to compare two different populations.
 *
 * ## Why the population is a refusal rather than a movement
 *
 * Cloud-OpsBench has 754 case directories of which 156 are scorable, and the scorable set is derived — a change to
 * the alert-window rule or to the service alphabet moves it. A comparison that reported `at1: 80 → 74` for two
 * different denominators would be the conflation `docs/cloud-opsbench-connection.md` §8 exists to prevent:
 * *"0.5128 versus 0.88 is a denominator difference dressed as a capability one."* So `cases` must match, and a
 * mismatch throws. A population change is an announcement, not a regression, and it deserves its own commit.
 *
 * ## What is NOT here
 *
 * No I/O and no engine. The reading is built from ranks the runner already has (`ranksToReading`), so the decision
 * is testable and the entry point stays a rendering.
 *
 * @module benchmarks/src/cloudopsbench-arm-baseline
 */

/**
 * The log channel an arm ran with.
 *
 * Added in iteration 372, when the corpus turned out to state `raw_data/logs.json` in **754 of 754** directories
 * while `cloudopsbench-suite.ts` declared it carried no log at all. Absent on an {@link ArmReading} means the arm read
 * no artefact; `weight: 0` means it read one and priced the term at nothing — and those two are NOT the same
 * configuration, which is why this is a structure rather than a boolean.
 */
export interface ArmLogs {
  /** The log channel's price, as the engine received it. */
  readonly weight: number;
  /** The engine's log-signal mode, as the engine received it. */
  readonly mode: string;
}

/** One arm's reading over one scorable population. */
export interface ArmReading {
  /** The arm's name, which is how a baseline and a run are matched. */
  readonly arm: string;
  /** The label prior's weight this arm ran at. */
  readonly weight: number;
  /** The margin gate this arm ran at. */
  readonly gate: number;
  /** The jurisdiction word this arm ran at, `everywhere` or `tail`. */
  readonly jurisdiction: string;
  /** The log channel this arm ran with, or absent when it read no log artefact. */
  readonly logs?: ArmLogs;
  /** Scorable cases. Two readings of the same arm must share it, or they are different populations. */
  readonly cases: number;
  /** Cases whose truth ranked first. */
  readonly at1: number;
  /** Cases whose truth ranked in the top three. */
  readonly at3: number;
  /** Cases whose truth ranked in the top five. */
  readonly at5: number;
}

/** A recorded reading of a corpus's arms, with the corpus and revision it came from. */
export interface ArmBaseline {
  /** `owner/name`, so a reading cannot be attributed to the wrong corpus. */
  readonly corpus: string;
  /** The revision the readings were taken at. */
  readonly revision: string;
  /** The arms, in the order they should be read. */
  readonly arms: readonly ArmReading[];
}

/** One arm whose count differs from the baseline's. */
export interface ArmMovement {
  readonly arm: string;
  readonly metric: 'at1' | 'at3' | 'at5';
  readonly baseline: number;
  readonly actual: number;
}

/** The whole comparison, including the two directions a reading can be absent. */
export interface ArmComparison {
  readonly movements: readonly ArmMovement[];
  /** Arms the baseline names and the run does not: an arm that was not run. */
  readonly absent: readonly string[];
  /** Arms the run names and the baseline does not: a new arm, which needs its own recorded reading. */
  readonly unexpected: readonly string[];
}

/** The metrics a reading carries, in the order a reader compares them. */
export const ARM_METRICS = ['at1', 'at3', 'at5'] as const;

/**
 * Build a reading from the ranks a run produced.
 *
 * @param arm - The arm's name.
 * @param config - The three values the arm ran at, taken from the RESOLVED engine options.
 * @param ranks - Each case's `truthRank`, or `null` when the truth was not ranked at all.
 * @returns The reading.
 */
export function ranksToReading(
  arm: string,
  config: {
    readonly weight: number;
    readonly gate: number;
    readonly jurisdiction: string;
    readonly logs?: ArmLogs;
  },
  ranks: readonly (number | null)[],
): ArmReading {
  const within = (cut: number): number =>
    ranks.filter((rank) => rank !== null && rank <= cut).length;
  return {
    arm,
    weight: config.weight,
    gate: config.gate,
    jurisdiction: config.jurisdiction,
    // Absent stays absent: `logs: undefined` would serialise out of a JSON baseline and back as a missing key, and a
    // reader could not then tell "no artefact" from "a field that was dropped".
    ...(config.logs === undefined ? {} : { logs: config.logs }),
    cases: ranks.length,
    at1: within(1),
    at3: within(3),
    at5: within(5),
  };
}

/**
 * Parse the baseline file, refusing a reading that would make the comparison vacuous or impossible.
 *
 * @param text - The JSON file's contents.
 * @returns The parsed baseline.
 * @throws When a field is missing, a reading is not nested, or an arm is named twice.
 */
export function parseArmBaseline(text: string): ArmBaseline {
  const parsed = JSON.parse(text) as Partial<ArmBaseline>;
  const { corpus, revision, arms } = parsed;
  if (typeof corpus !== 'string' || !corpus.includes('/')) {
    throw new Error('arm-baseline: `corpus` must be `owner/name`');
  }
  if (typeof revision !== 'string' || revision === '') {
    throw new Error('arm-baseline: `revision` must name what was measured');
  }
  if (!Array.isArray(arms) || arms.length === 0) {
    throw new Error(
      'arm-baseline: `arms` is empty, and an empty baseline compares equal to nothing',
    );
  }
  const seen = new Set<string>();
  for (const arm of arms) {
    if (typeof arm.arm !== 'string' || arm.arm === '') {
      throw new Error('arm-baseline: every arm needs a name');
    }
    if (seen.has(arm.arm)) throw new Error(`arm-baseline: arm \`${arm.arm}\` is named twice`);
    seen.add(arm.arm);
    for (const value of [arm.weight, arm.gate]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`arm-baseline: \`${arm.arm}\` carries a non-finite weight or gate`);
      }
    }
    if (typeof arm.jurisdiction !== 'string' || arm.jurisdiction === '') {
      throw new Error(`arm-baseline: \`${arm.arm}\` names no jurisdiction`);
    }
    if (!Number.isInteger(arm.cases) || arm.cases <= 0) {
      throw new Error(`arm-baseline: \`${arm.arm}\` scored ${String(arm.cases)} cases`);
    }
    for (const metric of ARM_METRICS) {
      const count = arm[metric];
      if (!Number.isInteger(count) || count < 0 || count > arm.cases) {
        throw new Error(
          `arm-baseline: \`${arm.arm}.${metric}\` is ${String(count)}, not a count within ${String(arm.cases)}`,
        );
      }
    }
    // The thresholds are nested by definition: a case in the top one is in the top three. A reading that violates
    // it was not produced by a ranking, and every dominance claim below would be arithmetic on a fiction.
    if (!(arm.at1 <= arm.at3 && arm.at3 <= arm.at5)) {
      throw new Error(
        `arm-baseline: \`${arm.arm}\` reads ${String(arm.at1)}/${String(arm.at3)}/${String(arm.at5)}, which is not nested`,
      );
    }
    // The log channel, when the arm states one. A negative price would reward the services whose own logs are
    // silent, and an empty mode names no arm at all — the six modes read different lines.
    if (arm.logs !== undefined) {
      if (arm.logs === null || typeof arm.logs !== 'object') {
        throw new Error(`arm-baseline: \`${arm.arm}.logs\` is not an object`);
      }
      if (
        typeof arm.logs.weight !== 'number' ||
        !Number.isFinite(arm.logs.weight) ||
        arm.logs.weight < 0
      ) {
        throw new Error(
          `arm-baseline: \`${arm.arm}.logs\` states a log weight of ${String(arm.logs.weight)}, which is not a price`,
        );
      }
      if (typeof arm.logs.mode !== 'string' || arm.logs.mode === '') {
        throw new Error(`arm-baseline: \`${arm.arm}.logs\` states no log mode`);
      }
    }
  }
  return { corpus, revision, arms: arms as readonly ArmReading[] };
}

/**
 * Compare a run's arms against the recorded reading.
 *
 * @param baseline - The recorded readings.
 * @param actual - The run's readings.
 * @returns Every movement, plus the two directions of absence.
 * @throws When an arm shared by both sides scored a different number of cases — a population change, not a movement.
 */
export function compareArms(baseline: ArmBaseline, actual: readonly ArmReading[]): ArmComparison {
  const byName = new Map(actual.map((one) => [one.arm, one]));
  const recorded = new Map(baseline.arms.map((one) => [one.arm, one]));
  const movements: ArmMovement[] = [];
  for (const [arm, reading] of recorded) {
    const seen = byName.get(arm);
    if (seen === undefined) continue;
    if (seen.cases !== reading.cases) {
      throw new Error(
        `arm-baseline: \`${arm}\` recorded ${String(reading.cases)} cases and this run scored ${String(seen.cases)}; that is a different population, not a movement`,
      );
    }
    // ── The configuration before the counts ────────────────────────────────────────────────────────────────
    //
    // A recorded arm is a CONFIGURATION with a reading, not a row of three numbers. Until iteration 372 this
    // compared counts only, so an arm whose prior weight, gate, jurisdiction or log channel moved while its three
    // counts happened to land on the recorded values passed in silence — and the report kept the old
    // configuration's name. That is precisely the failure `cloudopsbench-engine-options.ts` was written to end, one
    // level up: a claim about a configuration that does not consult the configuration.
    const compared: readonly (readonly [string, unknown, unknown])[] = [
      ['weight', reading.weight, seen.weight],
      ['gate', reading.gate, seen.gate],
      ['jurisdiction', reading.jurisdiction, seen.jurisdiction],
    ];
    for (const [field, recordedValue, actualValue] of compared) {
      if (recordedValue !== actualValue) {
        throw new Error(
          `arm-baseline: \`${arm}\` recorded ${field} ${String(recordedValue)} and this run scored ${String(actualValue)}; that is a different arm under the same name`,
        );
      }
    }
    // The log channel compares as one value: `undefined` (no artefact) and `{weight: 0, …}` (read, priced at nothing)
    // differ in a way the engine acts on (`sideChannelObserved`), so they may not be folded together.
    if (JSON.stringify(reading.logs ?? null) !== JSON.stringify(seen.logs ?? null)) {
      throw new Error(
        `arm-baseline: \`${arm}\` recorded log channel ${JSON.stringify(reading.logs ?? null)} and this run scored ${JSON.stringify(seen.logs ?? null)}; that is a different arm under the same name`,
      );
    }
    for (const metric of ARM_METRICS) {
      if (seen[metric] !== reading[metric]) {
        movements.push({ arm, metric, baseline: reading[metric], actual: seen[metric] });
      }
    }
  }
  return {
    movements,
    absent: baseline.arms.filter((one) => !byName.has(one.arm)).map((one) => one.arm),
    unexpected: actual.filter((one) => !recorded.has(one.arm)).map((one) => one.arm),
  };
}

/**
 * Whether one arm is at least as good on every metric and strictly better on one.
 *
 * The relation the Cloud-OpsBench reading turns on: `tail` pins the head by construction, so the enrolled arm must
 * be *equal* on `at1` — and the question a reader asks is whether it pays for that equality anywhere. A strict
 * dominance says it does not.
 *
 * @param a - The arm claimed to dominate.
 * @param b - The arm it is compared against.
 * @returns True when `a` is never worse and somewhere better.
 */
export function strictDominance(a: ArmReading, b: ArmReading): boolean {
  const atLeast = ARM_METRICS.every((metric) => a[metric] >= b[metric]);
  const somewhere = ARM_METRICS.some((metric) => a[metric] > b[metric]);
  return atLeast && somewhere;
}

/**
 * Render the comparison as the text a job log carries.
 *
 * @param comparison - The comparison.
 * @returns Lines, or a single line saying nothing moved.
 */
export function renderArmComparison(comparison: ArmComparison): string {
  const lines: string[] = [];
  for (const one of comparison.movements) {
    const delta = one.actual - one.baseline;
    const sign = delta > 0 ? '+' : '';
    lines.push(
      `arm moved                   ${one.arm} ${one.metric}: ${String(one.baseline)} -> ${String(one.actual)} (${sign}${String(delta)})`,
    );
  }
  for (const arm of comparison.absent) lines.push(`arm absent                  ${arm}`);
  for (const arm of comparison.unexpected) lines.push(`arm unrecorded              ${arm}`);
  if (lines.length === 0) {
    return `arms compared               every recorded arm reads the same (${String(comparison.movements.length)} movements)\n`;
  }
  return `${lines.join('\n')}\n`;
}
