/**
 * The shipped ranking vector, priced ONE MEMBER AT A TIME.
 *
 * ## The gap this closes
 *
 * `docs/production-leave-one-out.md` prices three members of the configuration that produced `666/735`
 * (`traceWeight`, `logWeight`, `rankNormalization`) and reports the reason it can price no more: the
 * ablation battery's production rows were four FLAGS, and the weights `RE1`'s `92.0` is made of are not
 * flags at all. The accounting therefore had two columns — one measured, one prose.
 *
 * The rows below are that second column. Each takes the SHIPPED configuration and removes exactly one
 * number, so every row differs from the published run in one field of one constructor argument.
 *
 * ## Why the arms are derived rather than written out
 *
 * Eight literal rows is eight chances for a label to name a weight the row does not carry — the defect
 * `docs/ablation-config-audit.md` records, where `BASELINE (all OFF)` ran with four dominant terms on. So the
 * arms come from ONE table of `(field, shipped, label)` and the rows are built from it, which makes the two
 * readable against each other by construction.
 *
 * ## What the fence asserts, and why each assertion is not decoration
 *
 * 1. **Exactly one field moves.** `configDiff` reads the two rendered lines, so the assertion is about what
 *    the ARTIFACT says, not about what the constructor was believed to receive.
 * 2. **The number removed is the number the shipped run uses.** A row labelled `selfAnomalyWeight=0` against
 *    a production that ran `selfAnomalyWeight=0.5` would be a row that removes nothing.
 * 3. **Every non-zero weight is priced or explained.** This is the partition that makes the table COMPLETE:
 *    ship a new weight tomorrow and this test fails until the weight has an arm or a stated reason it cannot
 *    have one. `podStateWeight` is the one member of the shipped vector that is structurally unfeedable here
 *    (the RCAEval corpora carry no pod-lifecycle channel), and the reason is recorded rather than omitted.
 *
 * @module benchmarks/__tests__/production-weight-rows
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANOMALY_BREADTH_WEIGHT,
  DEFAULT_ANOMALY_CV_WEIGHT,
  DEFAULT_ANOMALY_TREND_WEIGHT,
  DEFAULT_DUAL_FAMILY_WEIGHT,
  DEFAULT_EMISSION_WEIGHT,
  DEFAULT_FAILED_EDGE_WEIGHT,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_SELF_ANOMALY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
} from '../../packages/tree/src/index.js';

import {
  PRODUCTION_JOINT_ARMS,
  PRODUCTION_JOINT_ROWS,
  PRODUCTION_ROWS,
  PRODUCTION_UNPRICED_WEIGHTS,
  PRODUCTION_WEIGHT_CONFIGS,
  PRODUCTION_WEIGHT_FIELDS,
  PRODUCTION_WEIGHT_ROWS,
  buildAblationEngineOptions,
  configDiff,
  formatAblationConfigLine,
  productionFlags,
} from '../src/ablation-engine-options.js';
import { UNREPORTED_BY_ENGINE_RUNNERS } from '../src/reported-config.js';

/** The runner's own text — it executes `main()` at import, so a fence about it is a fence about its source. */
const RUNNER = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/run-ablation.ts'),
  'utf8',
);

/** The line the published nine cells were taken with. */
const SHIPPED_LINE = formatAblationConfigLine(productionFlags('re3'));

/** The value a configuration line states for one field. */
const stated = (line: string, field: string): string | undefined =>
  line
    .split(/\s+/)
    .find((token) => token.startsWith(`${field}=`))
    ?.slice(field.length + 1);

describe('every member of the shipped vector has ONE arm, or a stated reason it cannot', () => {
  it('prices every non-zero weight the published run passes', () => {
    const priced = new Set<string>(PRODUCTION_WEIGHT_FIELDS.map((entry) => entry.field));
    const explained = new Set(Object.keys(PRODUCTION_UNPRICED_WEIGHTS));
    // The three flag-driven members are priced by `PRODUCTION_ROWS` itself — `PRODUCTION LESS TRACE`,
    // `LESS LOG` and `LESS RANK` — so they are neither in the table nor unexplained.
    const flagPriced = new Set(['logWeight', 'traceWeight', 'prismWeight']);
    const shipped = SHIPPED_LINE.split(/\s+/)
      .map((token) => token.slice(0, token.indexOf('=')))
      .filter((field) => field.endsWith('Weight'))
      .filter((field) => Number(stated(SHIPPED_LINE, field)) !== 0);
    const unpriced = shipped.filter(
      (field) => !priced.has(field) && !explained.has(field) && !flagPriced.has(field),
    );
    expect(
      unpriced,
      'a weight the shipped run passes and no arm removes: its contribution is unmeasured',
    ).toEqual([]);
  });

  it('states a reason for each weight it does not price, and the reason is a sentence', () => {
    for (const [field, reason] of Object.entries(PRODUCTION_UNPRICED_WEIGHTS)) {
      expect(reason.length, `${field}'s reason`).toBeGreaterThan(40);
    }
  });

  it('does not contradict the artifact’s own exemption record', () => {
    // Two records answer "why is this field not a row": the artifact's (which fields its LINE may omit) and this
    // one (which weights have no ARM). They are not the same question, but a field can only be in the second if
    // the artifact already says why it is silent about it — otherwise the table would explain a field the
    // published artifact leaves a reader to guess, which is the failure `docs/reported-config.md` names.
    for (const field of Object.keys(PRODUCTION_UNPRICED_WEIGHTS)) {
      expect(
        Object.keys(UNREPORTED_BY_ENGINE_RUNNERS).includes(field),
        `${field} has no arm AND is not exempt from the artifact's line`,
      ).toBe(true);
    }
  });

  it('names the owner constant, so a label cannot outlive a default', () => {
    const owners: Record<string, number> = {
      selfAnomalyWeight: DEFAULT_SELF_ANOMALY_WEIGHT,
      dualFamilyWeight: DEFAULT_DUAL_FAMILY_WEIGHT,
      latWeight: DEFAULT_LAT_WEIGHT,
      emissionWeight: DEFAULT_EMISSION_WEIGHT,
      poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
      stabilityWeight: DEFAULT_STABILITY_WEIGHT,
      failedEdgeWeight: DEFAULT_FAILED_EDGE_WEIGHT,
      anomalyTrendWeight: DEFAULT_ANOMALY_TREND_WEIGHT,
      anomalyCvWeight: DEFAULT_ANOMALY_CV_WEIGHT,
      anomalyBreadthWeight: DEFAULT_ANOMALY_BREADTH_WEIGHT,
    };
    for (const entry of PRODUCTION_WEIGHT_FIELDS) {
      expect(owners[entry.field], `${entry.field} has no owner constant`).toBeDefined();
      expect(entry.shipped, `${entry.field}'s stated shipped value`).toBe(owners[entry.field]);
    }
  });
});

describe('each arm removes ONE number and nothing else', () => {
  it('moves exactly one field of the rendered configuration', () => {
    for (const row of PRODUCTION_WEIGHT_ROWS) {
      const line = formatAblationConfigLine(row.flags, row.overrides);
      const changed = configDiff(SHIPPED_LINE, line);
      expect(changed, `${row.label} moves ${changed.join(', ')}`).toHaveLength(1);
    }
  });

  it('removes THAT field, and states the zero on the line', () => {
    for (const [index, row] of PRODUCTION_WEIGHT_ROWS.entries()) {
      const field = PRODUCTION_WEIGHT_FIELDS[index]!.field;
      const line = formatAblationConfigLine(row.flags, row.overrides);
      expect(configDiff(SHIPPED_LINE, line)).toEqual([field]);
      expect(stated(line, field), `${row.label} states its own weight`).toBe('0');
    }
  });

  it('removes a number the shipped run actually spent', () => {
    for (const [index, row] of PRODUCTION_WEIGHT_ROWS.entries()) {
      const entry = PRODUCTION_WEIGHT_FIELDS[index]!;
      expect(Number(stated(SHIPPED_LINE, entry.field))).toBe(entry.shipped);
      expect(entry.shipped, 'an arm over a zero removes nothing').not.toBe(0);
      expect(row.label, `${row.label} names its field`).toContain(entry.field);
    }
  });

  it('rides the production flags, so the arm is the published configuration', () => {
    for (const row of PRODUCTION_WEIGHT_ROWS) {
      expect(row.flags).toEqual(productionFlags('re3'));
    }
  });

  it('claims no suite, because no suite is published with a member removed', () => {
    for (const row of PRODUCTION_WEIGHT_ROWS) {
      expect(row.suites, `${row.label} is not a published configuration`).toEqual([]);
    }
  });

  it('threads the removal into the ENGINE, not only into the line', () => {
    for (const [index, row] of PRODUCTION_WEIGHT_ROWS.entries()) {
      const { signals, topology } = buildAblationEngineOptions(row.flags, row.overrides);
      const field = PRODUCTION_WEIGHT_FIELDS[index]!.field;
      const merged: Record<string, unknown> = { ...signals, ...topology };
      expect(merged[field], `${row.label} forwarded to the engine`).toBe(0);
    }
  });
});

describe('the selection the runner takes, and the control row it must begin with', () => {
  it('starts at the SHIPPED configuration, because every Δ is measured from the first row', () => {
    const first = PRODUCTION_WEIGHT_CONFIGS[0]!;
    expect(formatAblationConfigLine(first.flags, first.overrides)).toBe(SHIPPED_LINE);
    expect(first.overrides, 'the control row removes nothing').toBeUndefined();
    expect(first.label).toBe(PRODUCTION_ROWS[0]!.label);
  });

  it('is the control plus one row per priced field, then the pre-registered joint arms, and nothing else', () => {
    expect(PRODUCTION_WEIGHT_CONFIGS).toHaveLength(
      PRODUCTION_WEIGHT_FIELDS.length + PRODUCTION_JOINT_ROWS.length + 1,
    );
    const singles = PRODUCTION_WEIGHT_CONFIGS.slice(1, PRODUCTION_WEIGHT_FIELDS.length + 1);
    for (const [index, arm] of singles.entries()) {
      expect(configDiff(SHIPPED_LINE, formatAblationConfigLine(arm.flags, arm.overrides))).toEqual([
        PRODUCTION_WEIGHT_FIELDS[index]!.field,
      ]);
    }
    const joints = PRODUCTION_WEIGHT_CONFIGS.slice(PRODUCTION_WEIGHT_FIELDS.length + 1);
    expect(joints.map((row) => row.label)).toEqual(PRODUCTION_JOINT_ROWS.map((row) => row.label));
  });

  it('is what the runner filters to, and the full battery still carries the arms', () => {
    // Read from the runner's text: `run-ablation.ts` executes at import, so the only fence available is on what
    // it says. Both halves matter — a selection the CLI cannot reach is not an instrument, and a row the full
    // battery silently drops is a row the register would cite and the artifact would not contain.
    expect(RUNNER).toContain('onlyProductionWeights ? PRODUCTION_WEIGHT_CONFIGS : CONFIGS');
    expect(RUNNER).toContain('...PRODUCTION_WEIGHT_CONFIGS.slice(1)');
    expect(RUNNER).toContain("'--only'");
  });
});

describe('a joint arm removes TWO numbers, and says which two', () => {
  it('combines exactly two distinct members, each of which has a single arm', () => {
    const singles = new Map(PRODUCTION_WEIGHT_FIELDS.map((entry) => [entry.name, entry.field]));
    expect(PRODUCTION_JOINT_ARMS.length, 'the pre-registered pair is registered').toBeGreaterThan(
      0,
    );
    for (const arm of PRODUCTION_JOINT_ARMS) {
      const [left, right] = arm.members;
      expect(left, `${left} + ${right} names one member twice`).not.toBe(right);
      for (const member of arm.members) {
        expect(
          singles.has(member),
          `${member} has no single arm, so the pair cannot be read against its parents`,
        ).toBe(true);
      }
      expect(arm.why.length, `${left} + ${right} states the question it answers`).toBeGreaterThan(
        80,
      );
    }
  });

  it('moves exactly those two fields of the rendered line, and states both zeros', () => {
    const singles = new Map(PRODUCTION_WEIGHT_FIELDS.map((entry) => [entry.name, entry.field]));
    for (const [index, row] of PRODUCTION_JOINT_ROWS.entries()) {
      const arm = PRODUCTION_JOINT_ARMS[index]!;
      const expected = [singles.get(arm.members[0]), singles.get(arm.members[1])];
      const line = formatAblationConfigLine(row.flags, row.overrides);
      expect(configDiff(SHIPPED_LINE, line), `${row.label} moves its own two fields`).toEqual(
        expected,
      );
      for (const field of expected) {
        expect(stated(line, field!), `${row.label} states ${field}=0`).toBe('0');
        expect(row.label, `${row.label} names ${field}`).toContain(field!);
      }
    }
  });

  it('threads BOTH removals into the engine, not only into the line', () => {
    for (const row of PRODUCTION_JOINT_ROWS) {
      const { signals, topology } = buildAblationEngineOptions(row.flags, row.overrides);
      const merged: Record<string, unknown> = { ...signals, ...topology };
      const zeroed = Object.keys(row.overrides ?? {});
      expect(zeroed).toHaveLength(2);
      for (const field of zeroed) {
        expect(merged[field], `${row.label} forwarded ${field}`).toBe(0);
      }
    }
  });

  it('rides the production flags and claims no suite, like the singles', () => {
    for (const row of PRODUCTION_JOINT_ROWS) {
      expect(row.flags).toEqual(productionFlags('re3'));
      expect(row.suites, `${row.label} is not a published configuration`).toEqual([]);
    }
  });
});

describe('the arms are disjoint from the flag table, which prices the other members', () => {
  it('does not restate any row of the flag table', () => {
    const flagLabels = new Set(PRODUCTION_ROWS.map((row) => row.label));
    for (const row of PRODUCTION_WEIGHT_ROWS) {
      expect(flagLabels.has(row.label), `${row.label} is already a flag row`).toBe(false);
    }
  });

  it('leaves the three flag-driven members to the flag table', () => {
    const fields = new Set<string>(PRODUCTION_WEIGHT_FIELDS.map((entry) => entry.field));
    for (const field of ['logWeight', 'traceWeight'] as const) {
      expect(fields.has(field), `${field} is priced by PRODUCTION LESS ...`).toBe(false);
    }
  });

  it('states the count, so a row cannot be lost in a refactor', () => {
    expect(PRODUCTION_WEIGHT_ROWS).toHaveLength(PRODUCTION_WEIGHT_FIELDS.length);
    expect(PRODUCTION_WEIGHT_ROWS.length).toBeGreaterThanOrEqual(10);
  });
});
