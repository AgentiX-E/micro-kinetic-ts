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
  type DualFamilyGateMode,
  type LabelPriorJurisdiction,
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
  let topology: TopologyArm = 'registry';
  let dualFamilyWeight: number | undefined;
  let dualFamilyGate: number | undefined;
  let dualFamilyGateMode: DualFamilyGateMode | undefined;
  let labelPriorWeight: number | undefined;
  let labelPriorMarginGate: number | undefined;
  let labelPriorJurisdiction: LabelPriorJurisdiction | undefined;

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
  return {
    dataDir,
    output,
    maxCases,
    useInjectTime,
    topology,
    dualFamilyWeight,
    dualFamilyGate,
    dualFamilyGateMode,
    labelPriorWeight,
    labelPriorMarginGate,
    labelPriorJurisdiction,
  };
}
