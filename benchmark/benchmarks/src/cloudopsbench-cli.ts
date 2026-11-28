/**
 * The Cloud-OpsBench runner's own command line.
 *
 * Kept out of `rcaeval-cli.ts` on purpose: every option in that parser is forwarded to the engine, and the anchor
 * fingerprint is computed over the forwarded set. A runner-only flag added there would enter that set, change the
 * fingerprint, and make a difference between two corpora look like a difference between two configurations.
 *
 * @module benchmarks/src/cloudopsbench-cli
 */

import {
  isLabelPriorJurisdiction,
  isLogSignalMode,
  type DualFamilyGateMode,
  type LabelPriorJurisdiction,
  type LogSignalMode,
} from '../../packages/tree/src/index.js';

/** Parsed command line. */
export interface CloudOpsArgs {
  /** The checkout root — the directory holding `benchmark/` and `process-label/`. */
  readonly dataDir: string;
  /** Where to write the per-case JSON, when asked. */
  readonly output: string | undefined;
  /**
   * Cap on the number of case DIRECTORIES read.
   *
   * Deliberately a read cap and not a kept-case cap: a cap applied after selection would change what the
   * denominator means while leaving the printed rate looking ordinary.
   */
  readonly maxCases: number | undefined;
  /** Whether the corpus's alert window is forwarded to the engine as the injection time. */
  readonly useInjectTime: boolean;
  /**
   * Whether to read `raw_data/logs.json` and hand it to the engine's log channel.
   *
   * `false` is the metric-only reading every published Cloud-OpsBench number was measured on, and it is the default
   * so that the bridge cannot move a number by existing. `true` attaches the 754-of-754 log artefact — the only
   * evidence the 584 cases without `metrics.csv` have — and is the arm that prices it.
   */
  readonly withLogs: boolean;
  /**
   * Which of the engine's six log-signal modes the attached artefact is read with, or `undefined` for the shipped
   * `count`.
   *
   * The mode is the arm, not a detail. `count` reads SELF-CAUSED logic exceptions, which is the RCAEval RE3
   * signature; this corpus's logs are RPC/HTTP business lines (`request started`, `serving product page`), where the
   * fault shows up as a status code or a latency rather than an exception class name. Iteration 372 measured the
   * shipped mode on all 156 scorable cases and found 1 967 logic-exception lines in 4.6 million — 0.042 % — so the
   * mode is what decides whether the channel says anything at all here.
   *
   * Refused without {@link withLogs}: a mode with no artefact to read configures nothing and would still be printed
   * as a configuration.
   */
  readonly logSignalMode: LogSignalMode | undefined;
  /**
   * The price of the log channel, or `undefined` for the shipped 1.0.
   *
   * `0` is the invariance arm: with the artefact attached and the term priced at nothing, the score must be
   * byte-identical to the metric-only run — which is what distinguishes "the bridge changed nothing but the input"
   * from "the bridge changed something else".
   */
  readonly logWeight: number | undefined;
  /**
   * Which call graph every case is built on.
   *
   * `registry` is the deployment and the only arm a published number may come from; `ring` is the ablation that
   * reproduces the graph an earlier version of this runner built by accident, so the topology channel can be priced
   * case by case rather than argued about.
   */
  readonly topology: TopologyArm;
  /**
   * The dual-family presence bonus, or `undefined` for the shipped 0.25.
   *
   * `dualFamily` is a BINARY eligibility flag — `1` when a candidate has a moving channel in both families — so the
   * term is `weight × membership` and the weight is the price of one membership change. Iteration 364 measured 15 of
   * the Hard bucket's 76 misses decided by it, every one of them at δ = 0.2500 exactly, which is why the weight
   * alone was priced first and why it came back refused (+0.6 pp overall for TrainTicket −3).
   */
  readonly dualFamilyWeight: number | undefined;
  /**
   * The share of the fleet's strongest dual signal a component must reach to be a MEMBER, or `undefined` for the
   * shipped 0.25.
   *
   * This is the axis iteration 364 left open: the weight says what membership is worth, the gate says WHO has it,
   * and the census found the defect in the second (`benchmarks/src/dual-family-census.ts`). 103 of 156 cases have an
   * EMPTY family and no case has the truth in the family while the winner is out, so the membership can only be
   * repaired by widening or narrowing it — never by repricing it.
   */
  readonly dualFamilyGate: number | undefined;
  /**
   * WHICH fleet-relative comparison the gate applies, or `undefined` for the shipped `channel`.
   *
   * `channel` gives each family its own champion; `min` compares the joint minimum against the fleet's best joint
   * minimum. Both are the identity at gate 0, so an arm that moves nothing at gate 0 and something at 0.25 is a
   * reading of the comparison rather than of the membership.
   */
  readonly dualFamilyGateMode: DualFamilyGateMode | undefined;
  /**
   * The label prior's price, or `undefined` for the shipped {@link DEFAULT_LABEL_PRIOR_WEIGHT} = 0.1.
   *
   * The one term whose input is not this case's telemetry: how often each service is the deployment's answer,
   * counted over the corpus and excluding the case being scored. It was refused ungated — it lifts a cell whose
   * heads are half a unit apart and collapses one whose heads are a hundredth apart — so the price travels with
   * the gate below rather than alone, and the triple with the jurisdiction below is what the arm measured.
   */
  readonly labelPriorWeight: number | undefined;
  /**
   * The smallest top-1 margin at which the label prior may speak, or `undefined` for the shipped
   * {@link DEFAULT_LABEL_PRIOR_MARGIN_GATE} = 0.
   *
   * A gate on the ENGINE's own `top1 − top2`, read before the prior is added: the deployment does not know which
   * cell it is in, and always knows this number. It ships at 0 only because the jurisdiction ships at `tail`; the
   * pair is one configuration, and this flag exists so an arm that moves one half can name the other.
   */
  readonly labelPriorMarginGate: number | undefined;
  /**
   * Where in the ranking the label prior may act, or `undefined` for the shipped
   * {@link DEFAULT_LABEL_PRIOR_JURISDICTION} = `tail`.
   *
   * `everywhere` sums it with the rest of the ranking; `tail` clamps the head of the order the engine would report
   * without the prior and lets it reorder 2..n, which makes `Top@1` invariant at any weight. **Every arm in
   * `docs/label-prior.md` §6 was measured at `everywhere`, before the pin existed**, and the shipped word has since
   * moved to `tail` — so reproducing one of those readings needs this flag, and the flag exists rather than being
   * inferred because a default that silently reinterprets a published command line is the defect.
   */
  readonly labelPriorJurisdiction: LabelPriorJurisdiction | undefined;
  /**
   * Where the recorded reading of the arms lives, when this run is to be held to one.
   *
   * The nine RCAEval cells have `benchmarks/baselines/rcaeval-nine-cells.json` and a job that fails on any cell that
   * moved; this corpus has prose, and iteration 370 found what prose is worth. This flag is the same mechanism: the
   * run compares its own three counts against the recorded reading and leaves a non-zero exit code on a movement, so
   * an arm that changes silently becomes a red job rather than a stale table.
   */
  readonly armBaseline: string | undefined;
  /**
   * Which recorded arm this run IS, matched by name against the baseline above.
   *
   * Required with `--arm-baseline` and refused without it: a comparison that guessed the arm from the flag values
   * would silently compare the shipped configuration against an arm whenever a default moved — which is exactly the
   * defect `--label-prior-jurisdiction` was added to end.
   */
  readonly armName: string | undefined;
}

/** The two graph arms, as the command line spells them. */
export type TopologyArm = 'registry' | 'ring';

/** The two membership comparisons, as the command line spells them. */
const GATE_MODES: Readonly<Record<DualFamilyGateMode, true>> = { channel: true, min: true };

/**
 * Whether a string names a gate mode.
 *
 * `hasOwnProperty.call` rather than `in`, the rule `isPrismPooling` records: a `Record` inherits from `Object`, so
 * `in` would accept `toString` and `constructor`, and both are strings a dispatch can really send.
 *
 * @param value - The raw argument.
 * @returns Whether it names a mode.
 */
function isGateMode(value: string): value is DualFamilyGateMode {
  return Object.prototype.hasOwnProperty.call(GATE_MODES, value);
}

/**
 * Parse this runner's arguments.
 *
 * @param args - The process arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseCloudOpsArgs(args: readonly string[]): CloudOpsArgs {
  let dataDir: string | undefined;
  let output: string | undefined;
  let maxCases: number | undefined;
  let useInjectTime = true;
  let withLogs = false;
  let logSignalMode: LogSignalMode | undefined;
  let logWeight: number | undefined;
  let topology: TopologyArm = 'registry';
  let dualFamilyWeight: number | undefined;
  let dualFamilyGate: number | undefined;
  let dualFamilyGateMode: DualFamilyGateMode | undefined;
  let labelPriorWeight: number | undefined;
  let labelPriorMarginGate: number | undefined;
  let labelPriorJurisdiction: LabelPriorJurisdiction | undefined;
  let armBaseline: string | undefined;
  let armName: string | undefined;

  const valueOf = (index: number, flag: string): string => {
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const one = args[index]!;
    if (one === '--data-dir') {
      dataDir = valueOf(index, '--data-dir');
      index += 1;
    } else if (one === '--output') {
      output = valueOf(index, '--output');
      index += 1;
    } else if (one === '--max-cases') {
      const value = valueOf(index, '--max-cases');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--max-cases must be a positive integer, got "${value}"`);
      }
      maxCases = parsed;
      index += 1;
    } else if (one === '--no-inject-time') {
      useInjectTime = false;
    } else if (one === '--logs') {
      withLogs = true;
    } else if (one === '--log-signal-mode') {
      const value = valueOf(index, '--log-signal-mode');
      // A VOCABULARY, refused rather than defaulted: `isLogSignalMode` is the guard beside the union, so a new mode
      // is a compile error there until it is named here too. The RCAEval parser falls back to `count` on an unknown
      // token and that is recorded as a defect at its own call site; this one does not repeat it.
      if (!isLogSignalMode(value)) {
        throw new Error(
          `--log-signal-mode is count, novelty, logicHttp, logicHttpJoint, logicHttpDominant or all, got "${value}"`,
        );
      }
      logSignalMode = value;
      index += 1;
    } else if (one === '--log-weight') {
      const value = valueOf(index, '--log-weight');
      const parsed = Number(value);
      // A PRICE, so the domain is non-negative. A negative weight would turn the term into a penalty on the
      // services whose own logs carry the fault — the opposite of the statement, and one that still moves a ranking.
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--log-weight must be a non-negative number, got "${value}"`);
      }
      logWeight = parsed;
      index += 1;
    } else if (one === '--dual-family-weight') {
      const value = valueOf(index, '--dual-family-weight');
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--dual-family-weight must be a non-negative number, got "${value}"`);
      }
      dualFamilyWeight = parsed;
      index += 1;
    } else if (one === '--dual-family-gate') {
      const value = valueOf(index, '--dual-family-gate');
      const parsed = Number(value);
      // A SHARE, so the interval is [0, 1] and not "non-negative": a gate above 1 asks for a member stronger than
      // the fleet maximum, which no component can satisfy, and would silently empty every family rather than fail.
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error(`--dual-family-gate must be a share in [0, 1], got "${value}"`);
      }
      dualFamilyGate = parsed;
      index += 1;
    } else if (one === '--dual-family-gate-mode') {
      const value = valueOf(index, '--dual-family-gate-mode');
      if (!isGateMode(value)) {
        throw new Error(`--dual-family-gate-mode is channel or min, got "${value}"`);
      }
      dualFamilyGateMode = value;
      index += 1;
    } else if (one === '--label-prior-weight') {
      const value = valueOf(index, '--label-prior-weight');
      const parsed = Number(value);
      // NEGATIVE is refused rather than "non-negative is accepted": at `p < 1` the term is a penalty, so a negative
      // weight would REWARD the services the history has never seen — the opposite of the statement, and one that
      // would look like a working arm because it still moves the ranking.
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--label-prior-weight must be a non-negative number, got "${value}"`);
      }
      labelPriorWeight = parsed;
      index += 1;
    } else if (one === '--label-prior-margin-gate') {
      const value = valueOf(index, '--label-prior-margin-gate');
      const parsed = Number(value);
      // A MARGIN, so the domain is "non-negative" and not [0, 1]: scores are not bounded above across terms. A
      // negative gate would admit the prior precisely where the head is UNDECIDED, which is the arm this gate exists
      // to refuse.
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--label-prior-margin-gate must be a non-negative margin, got "${value}"`);
      }
      labelPriorMarginGate = parsed;
      index += 1;
    } else if (one === '--label-prior-jurisdiction') {
      const value = valueOf(index, '--label-prior-jurisdiction');
      // A VOCABULARY, refused rather than defaulted: the RCAEval parser falls back to the shipped word so that a typo
      // reproduces a published configuration, but every other flag here refuses, and the shipped word MOVED in
      // iteration 369 — a fallback would run the pinned arm under a name the operator did not ask for, which is a
      // number from a configuration nobody chose.
      if (!isLabelPriorJurisdiction(value)) {
        throw new Error(`--label-prior-jurisdiction is tail or everywhere, got "${value}"`);
      }
      labelPriorJurisdiction = value;
      index += 1;
    } else if (one === '--arm-baseline') {
      armBaseline = valueOf(index, '--arm-baseline');
      index += 1;
    } else if (one === '--arm-name') {
      armName = valueOf(index, '--arm-name');
      index += 1;
    } else if (one === '--topology') {
      const value = valueOf(index, '--topology');
      if (value !== 'registry' && value !== 'ring') {
        throw new Error(`--topology is registry or ring, got "${value}"`);
      }
      topology = value;
      index += 1;
    } else {
      throw new Error(`unknown argument "${one}"`);
    }
  }

  if (dataDir === undefined) {
    throw new Error(
      '--data-dir is required: this runner reads a Cloud-OpsBench checkout and nothing else',
    );
  }
  // The pair travels together or not at all. Half of it is two different mistakes — a baseline with no arm to look
  // up, and an arm name with nothing to compare it to — and both would otherwise run to completion and print a
  // number under a claim nobody made.
  if ((armBaseline === undefined) !== (armName === undefined)) {
    throw new Error('--arm-baseline and --arm-name travel together, or neither is given');
  }
  // The mode and the price are properties of the log channel, and the channel exists only when the artefact is
  // attached. Accepting either without `--logs` would run the metric-only arm and print the log configuration beside
  // it — the shape iteration 370 found in the runner, where a claim was restated rather than read.
  if (!withLogs && logSignalMode !== undefined) {
    throw new Error(
      '--log-signal-mode needs --logs: without the artefact there is no channel to configure',
    );
  }
  if (!withLogs && logWeight !== undefined) {
    throw new Error(
      '--log-weight needs --logs: without the artefact there is no channel to configure',
    );
  }
  return {
    dataDir,
    output,
    maxCases,
    useInjectTime,
    withLogs,
    logSignalMode,
    logWeight,
    topology,
    dualFamilyWeight,
    dualFamilyGate,
    dualFamilyGateMode,
    labelPriorWeight,
    labelPriorMarginGate,
    labelPriorJurisdiction,
    armBaseline,
    armName,
  };
}
