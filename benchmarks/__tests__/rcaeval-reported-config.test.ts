/**
 * Guards on the RCAEval runner's DEFAULT configuration, and on the artifact's record of it.
 *
 * `run-rcaeval.ts` is a CLI script that calls `main()` at import time, so it cannot
 * be imported by a test — and the values that decide what a bare dispatch measures
 * are exactly the ones no engine-level assertion can see. The DEFAULTS are therefore
 * read as TEXT, the same way `fse26-reported-config.test.ts` reads the FSE'26 runner's:
 * the defect being guarded against is a default that disagrees with the engine's,
 * which is invisible from both sides individually.
 *
 * The specific defect, and why it mattered enough to guard: this runner pinned
 * `temporalWeight` to a literal `0` — which is the term's ABLATION — while carrying
 * the engine's defaults for the latency weight and the pool penalty. The moment the
 * engine's own default became non-zero, that pin would have kept the golden 9-cell
 * byte-identical for a reason that has nothing to do with the signal being
 * harmless, i.e. the gate would have reported "no effect" while never running the
 * configuration it claims to gate.
 *
 * ## The second defect, which is why this file now reads an OBJECT as well as text
 *
 * The same inaccessibility hid something the text assertions could not see from either side:
 * **the artifact's own configuration line omitted three of the fifteen fields
 * `REPORTED_CONFIG_FIELDS` requires** — `latWeight`, `latMinRise` and
 * `poolMetricPenaltyWeight`, the three that dominate the shipped ranking. An artifact that omits
 * one "cannot be compared with another artifact — the difference is unexplained", in that list's
 * own words, and the golden 9-cell is read from exactly this artifact.
 *
 * It survived because the line lived in the runner, where nothing could call it. The repair is
 * `fse26-engine-options.ts`'s precedent: `rcaeval-engine-options.ts` now owns the option assembly
 * AND the line, so the two are held against each other instead of against a remembered list. That
 * makes part of this file's own history worth recording: **the assertions below used to pin the
 * runner's source SHAPE** (`createContainer({ … })` with a hand-written field inside it), and a
 * shape is a coordinate — the refactor that fixed the omission moved it. They are assertions about
 * the PROPERTY now: the container takes the module's type, the runner has exactly one construction
 * site, and the line names every option that site forwards.
 *
 * @module benchmarks/__tests__/rcaeval-reported-config.test
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../packages/tree/src/index.js';

import { REPORTED_CONFIG_FIELDS } from '../src/fse26-report.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import {
  NON_ENGINE_OPTION_KEYS,
  UNREPORTED_BY_RCAEVAL,
  buildRCAEvalEngineOptions,
  formatSignalLine,
} from '../src/rcaeval-engine-options.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const RUNNER_PATH = resolve(REPO_ROOT, 'benchmarks/src/run-rcaeval.ts');
/**
 * The RCAEval PARSER, which is now its own module.
 *
 * It was inline in the runner, and the runner calls `main()` at import time, so the chain
 * that decides what a bare dispatch measures could not be driven by a test — the same
 * defect the FSE'26 parser was extracted for. The ownership assertions below read BOTH
 * files rather than one: a default is declared in the parser and forwarded in the runner,
 * and a swap to either alone would stop checking half of that.
 */
const CLI_PATH = resolve(REPO_ROOT, 'benchmarks/src/rcaeval-cli.ts');
const PRUNER_PATH = resolve(REPO_ROOT, 'packages/tree/src/pruning/pruner.ts');

/**
 * Drop comments before matching.
 *
 * Required, and the reason is self-referential: an explanation of a defect quotes the
 * defect. A comment saying "an inline `parseFloat(x) || 0` reads an empty flag as
 * zero" is text this file's own pattern matches, so a guard reading the raw source
 * fails on the sentence documenting the fix. A guard that fires on prose is a guard
 * someone deletes; the code is what it is about.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The `name=` tokens a line carries, which is what the artifact actually states. */
function namedOn(line: string): string[] {
  return [...new Set([...line.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9]*)=/g)].map((m) => m[1]!))];
}

const shipped = parseRCAEvalArgs([]);
const shippedSignals = buildRCAEvalEngineOptions(shipped).signals;

describe('RCAEval runner configuration ownership', () => {
  const source = code(readFileSync(RUNNER_PATH, 'utf8')) + code(readFileSync(CLI_PATH, 'utf8'));
  const pruner = code(readFileSync(PRUNER_PATH, 'utf8'));

  it('declares the decisive-stability default as the engine constant, and forwards it', () => {
    // The term is inert at the engine's default, which is why the golden 9-cell was bit-identical
    // while it was enrolled — and why measuring it on THIS benchmark needs the flag. That makes the
    // runner's default the only thing standing between a bare push and an unmeasured signal, so it
    // is read from the engine rather than restated, exactly like the temporal pair.
    expect(source).toMatch(/stabilityWeight:\s*DEFAULT_STABILITY_WEIGHT\b/);
    expect(source).not.toMatch(/stabilityWeight:\s*[-\d]/);
    // The flag falls back to the SHIPPED value on a malformed one, so a typo reproduces a published
    // configuration instead of measuring a term nobody asked for.
    expect(source).toMatch(/parseWeight\(args\[\+\+i\]!,\s*DEFAULT_STABILITY_WEIGHT\)/);
    // Forwarded into the container by the module that also renders the line, which is the property
    // the shape assertion here used to approximate.
    expect(shippedSignals.stabilityWeight).toBe(DEFAULT_STABILITY_WEIGHT);
  });

  it('declares both temporal defaults as the engine constants, not as literals', () => {
    // A literal here is a second owner of a value the engine already ships, and the
    // two can only drift silently: this runner prints a confident Top@1 either way.
    expect(source).toMatch(/temporalWeight:\s*DEFAULT_TEMPORAL_WEIGHT\b/);
    expect(source).toMatch(/onsetShape:\s*DEFAULT_ONSET_SHAPE\b/);
    // And no numeric literal, which is how the pin read before this guard existed.
    expect(source).not.toMatch(/temporalWeight:\s*[-\d]/);
    expect(source).not.toMatch(/onsetShape:\s*'/);
    // The values the engine will receive, asserted rather than inferred from the two lines above.
    expect(shippedSignals.temporalWeight).toBe(DEFAULT_TEMPORAL_WEIGHT);
    expect(shippedSignals.onsetShape).toBe(DEFAULT_ONSET_SHAPE);
  });

  it('declares the three terms the artifact used to omit as the engine constants', () => {
    // The omission's other half: the line could not name them, and the reason it could not is that
    // the runner never HELD them — it inherited the engine's defaults in silence. Naming the
    // constant is what makes the value on the artifact the value the engine used.
    expect(source).toMatch(/latWeight:\s*DEFAULT_LAT_WEIGHT\b/);
    expect(source).toMatch(/latMinRise:\s*DEFAULT_LAT_MIN_RISE\b/);
    expect(source).toMatch(/poolMetricPenaltyWeight:\s*DEFAULT_POOL_METRIC_PENALTY_WEIGHT\b/);
    expect(source).not.toMatch(/latWeight:\s*[-\d]/);
    expect(source).not.toMatch(/poolMetricPenaltyWeight:\s*[-\d]/);
    expect(shippedSignals.latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(shippedSignals.latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(shippedSignals.poolMetricPenaltyWeight).toBe(DEFAULT_POOL_METRIC_PENALTY_WEIGHT);
    expect(shippedSignals.logWeight).toBe(DEFAULT_LOG_WEIGHT);
    // The premise that makes naming them MANDATORY rather than tidy: each is non-zero, so an
    // omitted-when-default rule would render the shipped run and its ablation byte-identically.
    for (const [name, value] of [
      ['latWeight', shippedSignals.latWeight],
      ['latMinRise', shippedSignals.latMinRise],
      ['poolMetricPenaltyWeight', shippedSignals.poolMetricPenaltyWeight],
      ['stabilityWeight', shippedSignals.stabilityWeight],
    ] as const) {
      expect(value, `${name} ships non-zero`).toBeGreaterThan(0);
    }
  });

  it('imports those constants from the engine rather than redeclaring them', () => {
    // The import is what makes them the SAME value: a local `const
    // DEFAULT_TEMPORAL_WEIGHT = 0` would satisfy the assertion above while being a
    // copy with nothing keeping it equal to the engine's.
    // EVERY import group from that module, not the first one: with the parser in its own file there
    // are two, and each names what its own module needs. Reading only the first would have asserted
    // about whichever file came first in the concatenation, which is a page order, not an owner.
    const groups = [
      ...source.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*'\.\.\/\.\.\/packages\/tree\/src\/pruning\/pruner\.js'/g,
      ),
    ];
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const names = groups.map(([, list]) => list).join(',');
    expect(names).toContain('DEFAULT_TEMPORAL_WEIGHT');
    expect(names).toContain('DEFAULT_ONSET_SHAPE');
    expect(names).toContain('DEFAULT_STABILITY_WEIGHT');
    expect(names).toContain('DEFAULT_LAT_WEIGHT');
    expect(names).toContain('DEFAULT_LAT_MIN_RISE');
    expect(names).toContain('DEFAULT_POOL_METRIC_PENALTY_WEIGHT');
    // No redeclaration anywhere in either file, and each constant really is the engine's.
    for (const constant of [
      'DEFAULT_TEMPORAL_WEIGHT',
      'DEFAULT_ONSET_SHAPE',
      'DEFAULT_STABILITY_WEIGHT',
      'DEFAULT_LAT_WEIGHT',
      'DEFAULT_LAT_MIN_RISE',
      'DEFAULT_POOL_METRIC_PENALTY_WEIGHT',
    ]) {
      expect(source, `${constant} is redeclared`).not.toMatch(
        new RegExp(`const\\s+${constant}\\b`),
      );
      expect(pruner, `${constant} is not the engine's`).toMatch(
        new RegExp(`export const ${constant}\\b`),
      );
    }
  });

  it('falls back to the SHIPPED pair on an unusable flag value', () => {
    // `parseWeight(raw, shipped)`, so a malformed value reproduces a published
    // configuration; and the shape falls back like every other mode flag.
    expect(source).toMatch(/parseWeight\(args\[\+\+i\]!, DEFAULT_TEMPORAL_WEIGHT\)/);
    expect(source).toMatch(/isOnsetShape\(shape\)\s*\?\s*shape\s*:\s*DEFAULT_ONSET_SHAPE/);
  });

  it('leaves no inline weight parse behind, which would fall back to zero', () => {
    // `parseFloat(x) || 0` reads an empty flag as the value zero. For `--log-weight`
    // the runner's own default is 1.0, so that path ran the log-OFF ablation under a
    // dispatch that supplied no value at all.
    expect(source).not.toMatch(/parseFloat\([^)]*\)\s*\|\|\s*0/);
  });

  it('builds the engine arguments in exactly one place, and it is not the runner', () => {
    // The property the old shape assertions stood for, stated as a property. A hand-written literal
    // at the construction site is a SECOND owner of the option list, and the field present in one
    // and absent from the other is exactly how the line came to omit three of its own values.
    expect(source).toMatch(/createContainer\(buildRCAEvalEngineOptions\(opts\)\.signals\)/);
    expect(source).toMatch(/function createContainer\(weights: RCAEvalSignalOptions\)/);
    expect(source).toContain("from './rcaeval-engine-options.js'");
    // And no object literal at that call site at all: the only `createContainer(` followed by a brace
    // would be the hand list coming back.
    expect(source).not.toMatch(/createContainer\(\s*\{/);
  });
});

describe('the RCAEval configuration line carries the configuration that produced the run', () => {
  it('names exactly the options it forwards, in both directions', () => {
    const named = namedOn(formatSignalLine(shipped)).sort();
    const forwarded = Object.keys(shippedSignals).sort();
    // Both directions in one equality: a forwarded option the line omits is an artifact that cannot
    // be attributed, and a name the line invents is a configuration nobody ran.
    expect(named).toEqual(forwarded);
    expect(named).toContain('latWeight');
    expect(named).toContain('latMinRise');
    expect(named).toContain('poolMetricPenaltyWeight');
    // The temporal pair used to be printed twice-once-removed — on the injection line, and not on
    // this one — which is how one of the two renderings could drift unnoticed.
    expect(named).toContain('temporalWeight');
    expect(named).toContain('onsetShape');
    // Non-vacuity: the join must have a population, or two empty sets would satisfy it.
    expect(named.length).toBeGreaterThanOrEqual(16);
  });

  it('names every reported field whose shipped value is non-zero', () => {
    // The repository's own standard, applied to the half that did not meet it. A field may be
    // omitted only while its shipped value is neutral AND the omission is named with a reason —
    // otherwise two different shipped configurations can render the same line.
    const named = new Set(namedOn(formatSignalLine(shipped)));
    const exempt = new Set(Object.keys(UNREPORTED_BY_RCAEVAL));
    // The partition, restricted to the REPORTED set: the line names options the report has never
    // heard of (it is the engine's whole option surface), so the comparison is over the fields the
    // report requires rather than over everything the line prints.
    const namedReported = REPORTED_CONFIG_FIELDS.filter((field) => named.has(field));
    expect([...namedReported, ...exempt].sort()).toEqual([...REPORTED_CONFIG_FIELDS].sort());
    // … and the two halves are disjoint, so an exemption cannot silently cover a printed field.
    for (const field of namedReported) {
      expect(exempt.has(field), `${field} is both printed and exempt`).toBe(false);
    }
    // The three that were missing, asserted individually so a regression names itself.
    for (const field of ['latWeight', 'latMinRise', 'poolMetricPenaltyWeight']) {
      expect(named.has(field), `${field} must be named on the line`).toBe(true);
      expect(exempt.has(field), `${field} cannot be exempt`).toBe(false);
    }
    // Every exemption is stated rather than implied, and the key set is exact so a NEW exemption has
    // to be added deliberately.
    for (const [field, reason] of Object.entries(UNREPORTED_BY_RCAEVAL)) {
      expect(reason.length, `${field}'s reason`).toBeGreaterThan(40);
    }
    expect(Object.keys(UNREPORTED_BY_RCAEVAL).sort()).toEqual([
      'dropMetrics',
      'failedEdgeMinRecords',
      'failedEdgeMode',
      'failedEdgeWeight',
      'metricFleetBaseline',
      'metricRiseCeiling',
    ]);
  });

  it('classifies every parsed option as forwarded or non-engine, with no residue', () => {
    // The guard that would have caught the omission at any point in the last several iterations: an
    // option that reaches `CliOptions` and is neither forwarded to the engine nor classified stops
    // the suite, so "parsed but dropped" and "parsed and deliberately not an engine option" can
    // never be the same shape again.
    const parsed = Object.keys(shipped).sort();
    const forwarded = Object.keys(shippedSignals);
    const partition = [...forwarded, ...NON_ENGINE_OPTION_KEYS].sort();
    expect(partition).toEqual(parsed);
    for (const key of forwarded) {
      expect(NON_ENGINE_OPTION_KEYS.includes(key), `${key} is classified twice`).toBe(false);
    }
    // Non-vacuity on both sides of the split: a partition of one empty set against everything else
    // would pass while classifying nothing.
    expect(forwarded.length).toBeGreaterThanOrEqual(16);
    expect(NON_ENGINE_OPTION_KEYS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(partition).size).toBe(partition.length);
  });

  it('renders the line from the options alone, so the artifact and the runner cannot diverge', () => {
    // A line that read ambient state would describe a configuration nobody ran; a line that ignored
    // its argument would describe the shipped one whatever was asked for. Both are controlled here.
    expect(formatSignalLine(shipped)).toBe(formatSignalLine(parseRCAEvalArgs([])));
    expect(formatSignalLine(parseRCAEvalArgs(['--stability-weight', '1']))).toContain(
      'stabilityWeight=1',
    );
    expect(formatSignalLine(parseRCAEvalArgs(['--onset-shape', 'order']))).toContain(
      'onsetShape=order',
    );
    expect(formatSignalLine(shipped)).toContain(`temporalWeight=${DEFAULT_TEMPORAL_WEIGHT}`);
  });
});
