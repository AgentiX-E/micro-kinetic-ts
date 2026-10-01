/**
 * Can a CONTEXT feature decide which configuration to rank a case with?
 *
 * The register's ceiling analysis located the remaining obstacle: 598 of 672 misses are
 * individually reachable by a reweighting, yet no single weight serves them, because the
 * cases demand OPPOSITE weightings. The only lever that can resolve a conflict is a
 * per-case decision — and the right configuration per case is known (the oracle's 871, or
 * 61.25%, against the shipped 756). So the question this module answers is narrower and
 * answerable: is that choice PREDICTABLE, out of sample, from features available at
 * inference time?
 *
 * Three disciplines make the answer a measurement rather than a fit:
 *
 * 1. **The features cannot see the label.** {@link CaseSubject} is
 *    `Pick<DiagnosedCase, 'datapack' | 'faultType' | 'services' | 'prediction'>` — a type
 *    with no `groundTruth` — so a feature that would require knowing the root cannot be
 *    written by accident, and a rule that needs the answer cannot pass a typecheck;
 * 2. **Every rule is fitted on 4 folds and evaluated on the 5th**, split deterministically
 *    by a hash of the datapack, so the reported net is held out rather than in-sample;
 * 3. **The in-sample fit is reported beside it**, labelled as optimistic. The gap between
 *    the two is the overfitting this module exists to expose: a rule whose only evidence is
 *    its own training score is not a candidate.
 *
 * @module benchmarks/fse26-discriminator
 */

import { DEFAULT_LOG_WEIGHT, POOL_METRIC_PREFIX } from '../../packages/tree/src/index.js';

import type { DiagnosedCase } from './fse26-diagnose-analyze.js';
import type { TermOracleOptions } from './fse26-term-oracle.js';
import { byAnomalyDescending, latencySlopes, rankCase } from './fse26-term-oracle.js';

/**
 * What a feature may look at: the dump's own description of the case, and the model's OWN
 * ranking. Deliberately NOT the ground truth.
 *
 * `prediction` is included because the engine produced it without the label, and a
 * discriminator is allowed to reason about its own output ("the top anomaly is also my
 * rank-1"), which is exactly the kind of context a deployment has.
 */
export type CaseSubject = Pick<DiagnosedCase, 'datapack' | 'faultType' | 'services' | 'prediction'>;

/** One configuration a discriminator may choose for a case. */
export interface DiscriminatorConfig {
  readonly name: string;
  readonly logWeight: number;
  readonly latWeight: number;
}

/** A configuration point of the shipped formula, named and fully stated. */
export function discriminatorConfigs(opts: TermOracleOptions): readonly DiscriminatorConfig[] {
  return [
    { name: 'log only', logWeight: DEFAULT_LOG_WEIGHT, latWeight: 0 },
    { name: 'metric only', logWeight: 0, latWeight: 0 },
    { name: 'lat only', logWeight: 0, latWeight: opts.latWeight },
    { name: 'shipped', logWeight: opts.logWeight, latWeight: opts.latWeight },
  ];
}

/**
 * A feature a rule may threshold, with the reason it is available at inference time.
 */
export interface DiscriminatorFeature {
  readonly name: string;
  /**
   * The feature's value for one case, or `undefined` when the case cannot answer.
   *
   * `undefined` rather than a `NaN`, which is the whole point: `NaN` IS a `number`, so every "is it measured?"
   * test downstream answered YES, and both comparisons a threshold is made of (`>=` and `<=`) are false for it
   * in either direction — a rule fitted to a `NaN` threshold fires on nothing while reading like a rule.
   */
  readonly of: (subject: CaseSubject) => number | undefined;
}

/** The country of the case, as much as the dump states it without the label. */
function poolCount(services: readonly { readonly dominantMetric: string }[]): number {
  return services.filter((service) => service.dominantMetric.startsWith(POOL_METRIC_PREFIX)).length;
}

/**
 * The declared feature set — every one computable from the dump's own description plus the
 * model's ranking. Stated as data so a rule's report can name the feature it chose.
 *
 * The sort order is the ORACLE's {@link byAnomalyDescending}, not a comparator written here: "which of two
 * services has the larger anomaly" has one owner, and a second spelling of it had stopped being a total order
 * (`(a, b) => b.selfAnomaly - a.selfAnomaly` answers `NaN` for a `NaN` operand, which is falsy, i.e. "equal",
 * so a stable sort leaves the entries where the INPUT put them). Measured on the producer's own all-non-finite
 * block before the fix: reversing the rows moved `predictedIsTop` from `1` to `0`.
 *
 * TWO kinds of feature need TWO kinds of rule about `undefined`, and the difference is what the feature READS:
 *
 * - an **aggregate over a population** (`metricSpread`, `logCoverage`) needs every member, so one undetermined
 *   member makes the aggregate undetermined. Reporting it over the measured subset would be a LOWER BOUND
 *   wearing the aggregate's name — the reading this register already had to correct once for `bestDev`.
 * - an **order statistic** (`metricTopGap`, `predictedAnomaly`) needs the members it reads, and no others.
 *   `metricTopGap` reads the two highest, which `byAnomalyDescending` puts at the front whatever the rest
 *   hold, so the gap IS measured when those two are.
 */
export const DISCRIMINATOR_FEATURES: readonly DiscriminatorFeature[] = [
  {
    name: 'n',
    // How many candidates the case has. Available: the service list is the dump's.
    of: (subject) => subject.services.length,
  },
  {
    name: 'metricTopGap',
    // The lead the top anomaly has over the second. Available: both are printed.
    of: (subject) => {
      const sorted = [...subject.services].sort(byAnomalyDescending);
      const [top, second] = sorted;
      // TWO absences, and they are not the same one. A case with fewer than two candidates HAS no lead to
      // measure — there is nothing for the top to lead — so the answer is 0, which is what this feature has
      // always said. A case whose second candidate EXISTS and whose value the block flagged has a lead the
      // artifact declines to state, so the answer is `undefined`. Collapsing them was the first version of
      // this line and it turned a deliberate 0 into an undetermined value for every one-candidate case.
      if (second === undefined) return 0;
      if (top?.selfAnomaly === undefined || second.selfAnomaly === undefined) return undefined;
      return top.selfAnomaly - second.selfAnomaly;
    },
  },
  {
    name: 'metricSpread',
    of: (subject) => {
      const values = subject.services.map((service) => service.selfAnomaly);
      // Every member, or nothing: `Math.max` over a set containing an undetermined member is the maximum of
      // the others, which is a lower bound of the spread rather than the spread.
      if (values.some((value) => value === undefined)) return undefined;
      const measured = values as readonly number[];
      return measured.length === 0 ? 0 : Math.max(...measured) - Math.min(...measured);
    },
  },
  {
    name: 'logCoverage',
    // The share of candidates the log term credits at all: the term's own reach.
    of: (subject) => {
      // An aggregate needs EVERY member, so one unmeasured log score makes the reach an interval rather than a
      // share — reported as `undefined` rather than over the rest.
      if (subject.services.some((service) => service.logScore === undefined)) return undefined;
      // The guard above is the proof that every log score is a value, so this is the house's `!` rather than a
      // `?? 0`: a fallback here would be a branch no input can take, and `0` would say "the term credited it
      // nothing" where the guard's whole subject is that the two readings must not be merged.
      return subject.services.length === 0
        ? 0
        : subject.services.filter((service) => service.logScore! > 0).length /
            subject.services.length;
    },
  },
  {
    name: 'latCoverage',
    of: (subject) =>
      subject.services.length === 0
        ? 0
        : subject.services.filter((service) => service.latRise !== undefined).length /
          subject.services.length,
  },
  {
    name: 'poolCoverage',
    of: (subject) =>
      subject.services.length === 0 ? 0 : poolCount(subject.services) / subject.services.length,
  },
  {
    name: 'predictedIsTop',
    // Whether the model's own rank-1 is also the anomaly maximum: a conflict between the
    // two private rankings is visible without the label.
    of: (subject) => {
      const winner = subject.prediction[0];
      if (winner === undefined) return 0;
      const top = [...subject.services].sort(byAnomalyDescending)[0];
      return top !== undefined && top.serviceId === winner ? 1 : 0;
    },
  },
  {
    name: 'predictedAnomaly',
    of: (subject) => {
      const winner = subject.prediction[0];
      const row = subject.services.find((service) => service.serviceId === winner);
      // Two provenances, one reading, and both are facts about the CASE rather than measurements: the model
      // predicted a service its own dump does not describe, or the block flagged that service's anomaly as
      // non-finite. Reading as `0` is the operator's job here, and `??` — which fires on `undefined` and NOT on
      // a `NaN` — is what makes that comment true rather than merely intended.
      return row?.selfAnomaly ?? 0;
    },
  },
];

/** One case, reduced to what a rule may use and what the rule is trying to predict. */
export interface CaseOutcome {
  readonly datapack: string;
  readonly faultType: string;
  /** Which configurations rank an acceptable root first. */
  readonly covered: readonly string[];
  /**
   * The feature vector. A feature is `undefined` where the case cannot answer it, and the rule-fitting below
   * is required to READ that rather than to default it: `?? 0` would say "this case's spread is zero" where
   * the truth is "this case's spread is not measurable", which is a fabricated measurement of the same kind
   * the `0` sentinel produced for `bestDev`.
   */
  readonly features: Readonly<Record<string, number | undefined>>;
}

/**
 * Reduce every case to its coverage and its feature vector.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration to reconstruct at.
 * @param configs - The menu; defaults to {@link discriminatorConfigs}.
 * @param features - The feature set; defaults to {@link DISCRIMINATOR_FEATURES}.
 * @returns One outcome per case that names at least one acceptable root.
 */
export function caseOutcomes(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
  configs: readonly DiscriminatorConfig[] = discriminatorConfigs(opts),
  features: readonly DiscriminatorFeature[] = DISCRIMINATOR_FEATURES,
): readonly CaseOutcome[] {
  const outcomes: CaseOutcome[] = [];
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const covered: string[] = [];
    for (const configuration of configs) {
      const ranked = rankCase(
        kase,
        { ...opts, logWeight: configuration.logWeight, latWeight: configuration.latWeight },
        'recorded',
        lat,
      );
      if (root.has(ranked.order[0] ?? '')) covered.push(configuration.name);
    }
    const subject = kase;
    outcomes.push({
      datapack: kase.datapack,
      faultType: kase.faultType,
      covered,
      features: Object.fromEntries(features.map((f) => [f.name, f.of(subject)])),
    });
  }
  return outcomes;
}

/** What one configuration would change, against the baseline. */
export interface ConfigDelta {
  readonly config: string;
  /** Cases the baseline gets wrong and this configuration gets right. */
  readonly fixed: readonly string[];
  /** Cases the baseline gets right and this configuration gets wrong. */
  readonly broken: readonly string[];
  /** Cases both get right, or both get wrong: where the choice does not matter. */
  readonly neutral: number;
}

/**
 * The two populations a rule has to separate.
 *
 * This is the measurement the register asks for before any fitting: a configuration whose
 * `fixed` and `broken` sets are both populated is in conflict with itself, and no threshold
 * on any feature can serve both unless the feature separates them.
 */
export function configDeltas(
  outcomes: readonly CaseOutcome[],
  baseline = 'shipped',
): readonly ConfigDelta[] {
  const names = [...new Set(outcomes.flatMap((one) => one.covered))];
  return names
    .filter((name) => name !== baseline)
    .map((config) => {
      const fixed: string[] = [];
      const broken: string[] = [];
      let neutral = 0;
      for (const one of outcomes) {
        const baseOk = one.covered.includes(baseline);
        const hereOk = one.covered.includes(config);
        if (hereOk && !baseOk) fixed.push(one.datapack);
        else if (!hereOk && baseOk) broken.push(one.datapack);
        else neutral++;
      }
      return { config, fixed: fixed.sort(), broken: broken.sort(), neutral };
    });
}

/** A deterministic fold assignment, so two runs of a report agree. */
export function foldOf(datapack: string, folds: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < datapack.length; index++) {
    hash ^= datapack.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % folds;
}

/** One single-threshold rule: apply `config` when the feature is on the chosen side. */
export interface StumpChoice {
  readonly config: string;
  readonly feature: string;
  readonly threshold: number;
  /** `1` applies the config when the feature is at or above the threshold. */
  readonly direction: 1 | -1;
}

/** What a rule does on a case set. */
export interface RuleEffect {
  readonly fixed: number;
  readonly broken: number;
  /** `fixed − broken`: what the headline moves by, which is what a run would measure. */
  readonly net: number;
  /**
   * Cases the rule could not CLASSIFY, because the feature it thresholds is undetermined on them.
   *
   * Reported rather than folded into the two counters. A rule that cannot classify a case has not left it with
   * the baseline — it has not decided — and the difference matters most exactly where it is silent: a feature
   * that is undetermined on the cases a rule would have BROKEN reads as a clean rule.
   */
  readonly unmeasured: number;
}

/**
 * Whether a rule fires on one case, or could not be evaluated at all.
 *
 * Three answers, not two. An undetermined feature is not "below the threshold" and not "above" it: both
 * comparisons are false for `NaN` in either direction, which is how a fitted threshold of `NaN` — a rule that
 * fires on nothing — used to be reachable and to read as a rule that fires on nothing by chance.
 */
function fires(choice: StumpChoice, one: CaseOutcome): boolean | undefined {
  const value = one.features[choice.feature];
  if (value === undefined) return undefined;
  return choice.direction === 1 ? value >= choice.threshold : value <= choice.threshold;
}

/**
 * Evaluate a rule on a case set.
 *
 * A case the rule does not fire on stays with the baseline, so `broken` can only come from
 * cases where the rule fired on a case the baseline got right. A case the rule cannot
 * evaluate is counted in `unmeasured` and in neither of the other two.
 */
export function evaluateRule(
  outcomes: readonly CaseOutcome[],
  choice: StumpChoice,
  baseline = 'shipped',
): RuleEffect {
  let fixed = 0;
  let broken = 0;
  let unmeasured = 0;
  for (const one of outcomes) {
    const fired = fires(choice, one);
    if (fired === undefined) {
      unmeasured++;
      continue;
    }
    if (!fired) continue;
    const baseOk = one.covered.includes(baseline);
    const hereOk = one.covered.includes(choice.config);
    if (hereOk && !baseOk) fixed++;
    else if (!hereOk && baseOk) broken++;
  }
  return { fixed, broken, net: fixed - broken, unmeasured };
}

/**
 * Fit the best single-threshold rule for one configuration on a case set.
 *
 * The objective is the NET, not accuracy: a case the baseline already gets right is worth
 * keeping, so a rule that fixes two and breaks one is better than one that fixes three and
 * breaks three. Thresholds are the observed feature values, and the tie-break is the
 * declared feature order, so the choice is reproducible.
 *
 * @param outcomes - The training cases.
 * @param config - The configuration the rule would switch to.
 * @param features - The feature names to search, in order.
 * @param baseline - The configuration a non-firing case keeps.
 * @returns The best rule, or `undefined` when no rule has a positive training net.
 */
export function fitStump(
  outcomes: readonly CaseOutcome[],
  config: string,
  features: readonly string[] = DISCRIMINATOR_FEATURES.map((f) => f.name),
  baseline = 'shipped',
): StumpChoice | undefined {
  let best: StumpChoice | undefined;
  let bestNet = 0;
  for (const feature of features) {
    // The observed values the rule may choose from — the MEASURED ones, which is what keeps a threshold of
    // `NaN` out of the answer. Sorted numerically, so the comparator is a total order on numbers.
    const values = [
      ...new Set(
        outcomes
          .map((one) => one.features[feature])
          .filter((value): value is number => value !== undefined),
      ),
    ].sort((a, b) => a - b);
    if (values.length === 0) continue;
    for (const direction of [1, -1] as const) {
      for (const threshold of values) {
        const choice: StumpChoice = { config, feature, threshold, direction };
        const effect = evaluateRule(outcomes, choice, baseline);
        if (effect.net > bestNet) {
          bestNet = effect.net;
          best = choice;
        }
      }
    }
  }
  return best;
}

/** One fold's held-out result, with the rule its training folds chose. */
export interface FoldResult {
  readonly fold: number;
  readonly train: number;
  readonly test: number;
  readonly choice?: StumpChoice;
  readonly fixed: number;
  readonly broken: number;
  readonly net: number;
}

/** What one configuration's cross-validated rule achieved. */
export interface ConfigRule {
  readonly config: string;
  readonly delta: ConfigDelta;
  readonly folds: readonly FoldResult[];
  /** The held-out net over all folds: the number a run would have to reproduce. */
  readonly heldOutNet: number;
  /**
   * The held-out split, which the NET alone hides.
   *
   * The kill criterion demands zero regressed fault types, so a rule that fixes 119 cases
   * while breaking 106 has a positive net and still cannot ship: `broken` is the number the
   * criterion asks about, and a report that printed only the net would recommend it.
   *
   * This is also the number that makes {@link formatDiscriminatorReport}'s TRADES clause reachable, and the
   * shipped measurement IS an instance of it: `docs/fse26-discriminator-verdict.md` §4 records `lat only` at
   * held-out net `+13` with **25 fixed / 11 broken**, and that document's own verdict is the clause's text.
   * A fixture has to be built for it — every configuration on the real corpus breaks 88 to 590 cases in
   * sample, and the fixtures' rules broke nothing out of sample — which is why the arm stood unexercised.
   */
  readonly heldOutFixed: number;
  readonly heldOutBroken: number;
  /** The rule fitted on EVERY case, for the record, with its in-sample net. */
  readonly inSample?: StumpChoice;
  readonly inSampleNet: number;
}

export interface DiscriminatorScreen {
  readonly cases: number;
  /** Cases the shipped configuration already gets right. */
  readonly baselineCorrect: number;
  /** Cases SOME configuration gets right: the ceiling a perfect rule could reach. */
  readonly oracleCeiling: number;
  readonly folds: number;
  readonly rules: readonly ConfigRule[];
}

/**
 * Fit and cross-validate a rule for every configuration.
 *
 * @param outcomes - Case outcomes from {@link caseOutcomes}.
 * @param folds - Fold count; 5 by default.
 * @param features - The feature names to search.
 * @param baseline - The configuration a non-firing case keeps.
 * @returns The screen, with each rule's held-out and in-sample numbers.
 */
export function discriminatorScreen(
  outcomes: readonly CaseOutcome[],
  folds = 5,
  features: readonly string[] = DISCRIMINATOR_FEATURES.map((f) => f.name),
  baseline = 'shipped',
): DiscriminatorScreen {
  const deltas = configDeltas(outcomes, baseline);
  const baselineCorrect = outcomes.filter((one) => one.covered.includes(baseline)).length;
  const oracleCeiling = outcomes.filter((one) => one.covered.length > 0).length;
  const rules: ConfigRule[] = [];
  for (const delta of deltas) {
    const foldResults: FoldResult[] = [];
    for (let fold = 0; fold < folds; fold++) {
      const train = outcomes.filter((one) => foldOf(one.datapack, folds) !== fold);
      const test = outcomes.filter((one) => foldOf(one.datapack, folds) === fold);
      if (test.length === 0) continue;
      const choice = fitStump(train, delta.config, features, baseline);
      // A training set that chose no rule leaves the fold with the baseline, which is the
      // honest outcome: the rule's absence is scored as zero rather than skipped.
      const effect =
        choice === undefined
          ? { fixed: 0, broken: 0, net: 0 }
          : evaluateRule(test, choice, baseline);
      foldResults.push({
        fold,
        train: train.length,
        test: test.length,
        ...(choice === undefined ? {} : { choice }),
        ...effect,
      });
    }
    const inSample = fitStump(outcomes, delta.config, features, baseline);
    rules.push({
      config: delta.config,
      delta,
      folds: foldResults,
      heldOutNet: foldResults.reduce((sum, one) => sum + one.net, 0),
      heldOutFixed: foldResults.reduce((sum, one) => sum + one.fixed, 0),
      heldOutBroken: foldResults.reduce((sum, one) => sum + one.broken, 0),
      ...(inSample === undefined ? {} : { inSample }),
      inSampleNet: inSample === undefined ? 0 : evaluateRule(outcomes, inSample, baseline).net,
    });
  }
  // Best held-out first, then by name, so two reports diff cleanly.
  return {
    cases: outcomes.length,
    baselineCorrect,
    oracleCeiling,
    folds,
    rules: rules.sort((a, b) => b.heldOutNet - a.heldOutNet || (a.config < b.config ? -1 : 1)),
  };
}

/** Render the discriminator screen. */
export function formatDiscriminatorReport(screen: DiscriminatorScreen): string {
  const lines: string[] = [];
  lines.push('Discriminator screen (can a feature pick the configuration per case?):');
  lines.push(
    `  cases ${screen.cases}; shipped gets ${screen.baselineCorrect}; ` +
      `ANY configuration gets ${screen.oracleCeiling} (the oracle)`,
  );
  lines.push(`  ${screen.folds}-fold cross-validation, folds by datapack hash`);
  lines.push('  config          fixed  broken  held-out        in-sample   rule');
  lines.push('                                  net    +/-');
  for (const rule of screen.rules) {
    const ruleText =
      rule.inSample === undefined
        ? 'none'
        : `${rule.inSample.feature} ${rule.inSample.direction === 1 ? '>=' : '<='} ` +
          `${rule.inSample.threshold.toFixed(4)}`;
    lines.push(
      `  ${rule.config.padEnd(15)}${String(rule.delta.fixed.length).padStart(5)}  ` +
        `${String(rule.delta.broken.length).padStart(6)}  ` +
        `${String(rule.heldOutNet).padStart(5)}  ` +
        `${`${rule.heldOutFixed}/${rule.heldOutBroken}`.padStart(9)}  ` +
        `${String(rule.inSampleNet).padStart(10)}   ${ruleText}`,
    );
  }
  const best = screen.rules[0];
  if (best === undefined || best.heldOutNet <= 0) {
    lines.push(
      `  no rule beats the baseline out of sample: the conflict between cases is not ` +
        'resolved by any declared feature',
    );
    return lines.join('\n');
  }
  // The sign is not a branch. The guard above RETURNS unless `best.heldOutNet > 0`, so a conditional sign
  // here would carry an arm no input can take — and it did: the coverage report counted
  // `heldOutNet >= 0 ? '+' : ''` as an uncovered branch for as long as it stood, which is the same defect
  // iteration 31 removed from the separator's rate: a fallback written for a state the guard has already
  // excluded. What the guard PROVES, the headline states.
  lines.push(
    `  best held-out: ${best.config} net +${best.heldOutNet} ` +
      `(fixed ${best.heldOutFixed}, broken ${best.heldOutBroken}) → ` +
      `${screen.baselineCorrect + best.heldOutNet}/${screen.cases}`,
  );
  if (best.heldOutBroken > 0) {
    // Named explicitly, because a net-positive rule is not a shippable one: the criterion's
    // second half is ZERO regressed fault types, and a trade cannot satisfy it.
    lines.push(
      '  this rule TRADES cases: it is net-positive and cannot pass the kill criterion ' +
        '(zero regressed fault types), so it is a measurement of the conflict and not a candidate',
    );
  }
  for (const rule of screen.rules) {
    if (rule.delta.broken.length === 0) continue;
    // The two populations, named, because a rule that serves one and not the other is the
    // conflict itself and a reader has to see it.
    lines.push(
      `  ${rule.config}: fixes ${rule.delta.fixed.length} and breaks ` +
        `${rule.delta.broken.length} if applied to every case`,
    );
  }
  return lines.join('\n');
}
