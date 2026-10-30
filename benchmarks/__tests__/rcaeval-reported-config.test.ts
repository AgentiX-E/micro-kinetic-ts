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
  ANOMALY_NORMALIZE_NODE_THRESHOLD,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_PRISM_POOLING,
  DEFAULT_RANK_NORMALIZATION,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  isPrismPooling,
} from '../../packages/tree/src/index.js';

import { DEFAULT_FAILED_EDGE_WEIGHT } from '../../packages/tree/src/index.js';
import { REPORTED_CONFIG_FIELDS } from '../src/fse26-report.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import {
  buildRCAEvalEngineOptions,
  formatSignalLine,
  NON_ENGINE_OPTION_KEYS,
} from '../src/rcaeval-engine-options.js';
import { UNREPORTED_BY_ENGINE_RUNNERS } from '../src/reported-config.js';
// The engine's interfaces are read by a SHARED helper: the ablation artifact is held to the same two
// constructor arguments, and two readers of one interface would be two answers to the same question.
import {
  namedOn,
  PRUNER_OPTION_MEMBERS,
  PRUNER_PATH,
  TOPOLOGY_MEMBERS,
} from './helpers/engine-interfaces.js';

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

/**
 * The members of an interface, read from the source that declares it.
 *
 * MOVED to `./helpers/engine-interfaces.js`. The ablation artifact is held to the same two constructor
 * arguments, and a reader per file would be two answers to one question — which is the defect the shared
 * helper exists to avoid.
 */

const shipped = parseRCAEvalArgs([]);
const shippedEngine = buildRCAEvalEngineOptions(shipped);
const shippedSignals = shippedEngine.signals;
/** Every field the run forwards, across BOTH of the engine's constructor arguments. */
const shippedForwarded = [
  ...Object.keys(shippedEngine.signals),
  ...Object.keys(shippedEngine.topology),
].sort();

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

  it('parses the direction weight, and every unusable value reproduces the SHIPPED one', () => {
    // BEHAVIOUR, not a source pattern: the parser is called, so a fallback that resolved to a different number
    // than the shipped one — or a negative weight slipping through — fails here rather than in a dispatch that
    // nobody reads the banner of.
    expect(parseRCAEvalArgs(['--failed-edge-weight', '3']).failedEdgeWeight).toBe(3);
    expect(parseRCAEvalArgs(['--failed-edge-weight', '0.5']).failedEdgeWeight).toBe(0.5);
    // `0` is a MEASURED configuration (the term off is what every published cell ran), so it must survive as a
    // setting rather than be read as "no value given".
    expect(parseRCAEvalArgs(['--failed-edge-weight', '0']).failedEdgeWeight).toBe(0);
    expect(parseRCAEvalArgs(['--failed-edge-weight', 'oops']).failedEdgeWeight).toBe(
      DEFAULT_FAILED_EDGE_WEIGHT,
    );
    expect(parseRCAEvalArgs(['--failed-edge-weight', '-1']).failedEdgeWeight).toBe(
      DEFAULT_FAILED_EDGE_WEIGHT,
    );
    expect(parseRCAEvalArgs([]).failedEdgeWeight).toBe(DEFAULT_FAILED_EDGE_WEIGHT);
  });

  it('leaves no inline weight parse behind, which would fall back to zero', () => {
    // `parseFloat(x) || 0` reads an empty flag as the value zero. For `--log-weight`
    // the runner's own default is 1.0, so that path ran the log-OFF ablation under a
    // dispatch that supplied no value at all.
    expect(source).not.toMatch(/parseFloat\([^)]*\)\s*\|\|\s*0/);
  });

  it('takes rankNormalization from the engine, so the library default and the published one agree', () => {
    // The defect: this parser and the FSE'26 one each declared a literal `true` as their default while the
    // ENGINE's own topology default was `false` — three owners of one shipped value, one of which described
    // the OTHER value as "shipped behaviour". The cost was not cosmetic: a caller who passed no topology
    // argument (the DI container, the tree factory, two runners, and the L2 weight search) ran a
    // configuration the published numbers were not measured under.
    expect(shipped.rankNormalization).toBe(DEFAULT_RANK_NORMALIZATION);
    expect(DEFAULT_RANK_NORMALIZATION).toBe(true);
    const cli = code(readFileSync(CLI_PATH, 'utf8'));
    expect(cli, 'the parser reads the owner').toMatch(
      /rankNormalization:\s*DEFAULT_RANK_NORMALIZATION/,
    );
    // And states no default of its own. The `--rank-normalization` handlers assign `opts.rankNormalization`
    // and are not this pattern: an assignment has no comma after the value.
    expect(cli, 'the parser declares no default of its own').not.toMatch(
      /rankNormalization:\s*(?:true|false),/,
    );
  });

  it('declares the PRISM pooling from its owner, and makes the second one reachable', () => {
    // The defect: the engine's single PRISM call site omitted the pooling, so `conjunctive` — the
    // only pooling that resolves the code-level block in the controlled head-to-head (RE3
    // TrainTicket 76.7% against `additive`'s 33.3%) — was unreachable from every runner built on the
    // engine. Enrolling it means the runner states the vocabulary AND the value, from the union's own
    // owner rather than from a hand-written pair: `--log-signal-mode` once parsed against a
    // two-member subset of a six-member union, and a subset is exactly what this flag would have got.
    expect(source).toMatch(/prismPooling:\s*DEFAULT_PRISM_POOLING/);
    expect(source).not.toMatch(/prismPooling:\s*'/);
    // The flag accepts the WHOLE union by the union's own guard, and falls back to the SHIPPED
    // pooling on an unusable value — the same decision as every other mode flag here, and the reason
    // a typo reproduces a published configuration rather than inventing one.
    expect(source).toMatch(/isPrismPooling\(pooling\)\s*\?\s*pooling\s*:\s*DEFAULT_PRISM_POOLING/);
    expect(isPrismPooling(DEFAULT_PRISM_POOLING)).toBe(true);
    // Forwarded into the container by the module that also renders the line, which is what makes the
    // pooling the run records the pooling the engine receives.
    expect(shippedSignals.prismPooling).toBe(DEFAULT_PRISM_POOLING);
    // And a named member is taken rather than discarded, so the reach is two-way.
    expect(parseRCAEvalArgs(['--prism-pooling', 'conjunctive']).prismPooling).toBe('conjunctive');
    expect(parseRCAEvalArgs(['--prism-pooling', 'additive']).prismPooling).toBe('additive');
    // Inert at the shipped weight, which is why enrolling the axis moves no published number.
    expect(shippedSignals.prismWeight).toBe(0);
  });

  it('builds the engine arguments in exactly one place, and it is not the runner', () => {
    // The property the old shape assertions stood for, stated as a property. A hand-written literal
    // at the construction site is a SECOND owner of the option list, and the field present in one
    // and absent from the other is exactly how the line came to omit three of its own values — and
    // how the topology switches came to be restated by hand beside an argument that also carried them.
    expect(source).toMatch(/createContainer\(buildRCAEvalEngineOptions\(opts\)\)/);
    expect(source).toMatch(/function createContainer\(engine: RCAEvalEngineOptions\)/);
    expect(source).toContain("from './rcaeval-engine-options.js'");
    // And no object literal at either site: the only `createContainer(` followed by a brace would be
    // the hand list coming back, and the only `new TreePruner(` followed by a second brace would be
    // the hand-written topology config coming back.
    expect(source).not.toMatch(/createContainer\(\s*\{/);
    expect(source).not.toMatch(/new TreePruner\([\s\S]{0,120}?,\s*\{/);
  });
});

describe('the RCAEval engine arguments are the TWO objects the constructor takes', () => {
  const built = buildRCAEvalEngineOptions(shipped);

  it('sends only TreePrunerOptions members in the first argument', () => {
    // The defect: four of the sixteen fields the runner forwarded were `TopologyFaultGraphConfig`
    // fields, and `TreePrunerOptions` does not declare them — so the pruner spread them into its own
    // options and NOTHING EVER READ THEM THERE. They reached the engine only through the second
    // argument, which was a hand-written literal at the call site. The membership list is parsed from
    // the engine's own source rather than listed, so this cannot rot into a remembered set.
    const foreign = Object.keys(built.signals).filter(
      (key) => !PRUNER_OPTION_MEMBERS.includes(key),
    );
    expect(
      foreign,
      'a field the engine option type does not declare is inert in the FIRST argument',
    ).toEqual([]);
    expect(Object.keys(built.signals).length).toBeGreaterThanOrEqual(12);
  });

  it('sends only TopologyFaultGraphConfig members in the second argument', () => {
    const topology = Object.keys(built.topology);
    const foreign = topology.filter((key) => !TOPOLOGY_MEMBERS.includes(key));
    expect(foreign, 'the second argument takes topology fields only').toEqual([]);
    // Neither side may be a rename of the other: the two member lists must be largely DISJOINT, or
    // "splitting" them would have moved nothing. Measured against the engine's own declarations.
    const overlap = PRUNER_OPTION_MEMBERS.filter((key) => TOPOLOGY_MEMBERS.includes(key));
    expect(overlap, 'the two engine interfaces must not be the same list').toEqual([]);
    expect(TOPOLOGY_MEMBERS.length).toBeGreaterThan(8);
    expect(topology.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps the two arguments disjoint, and each one populated', () => {
    // The split's own invariant, distinct from the line join above (which owns "the artifact names what
    // the run forwarded"): the two arguments must not overlap, because a field in both is a field whose
    // OWNER is ambiguous — which is precisely the state this iteration repaired, where four values were
    // in the first argument and restated in the second. The line join then ties the union to the
    // artifact, so between them a field cannot hide in one object or be counted twice.
    const signals = new Set(Object.keys(built.signals));
    const topology = Object.keys(built.topology);
    for (const key of topology) {
      expect(signals.has(key), `${key} is in BOTH arguments`).toBe(false);
    }
    expect(signals.size).toBeGreaterThanOrEqual(12);
    expect(topology.length).toBeGreaterThanOrEqual(4);
    // Every topology field is one the engine declares there, so the second argument is not a dumping
    // ground: the two membership assertions above already say that, and this states the union's size so
    // a field silently MOVING between the two objects cannot shrink the run's configuration.
    expect(signals.size + topology.length).toBeGreaterThanOrEqual(16);
  });
});

describe('the RCAEval configuration line carries the configuration that produced the run', () => {
  it('names exactly the options it forwards, in both directions', () => {
    const named = namedOn(formatSignalLine(shipped)).sort();
    // Both directions in one equality: a forwarded option the line omits is an artifact that cannot
    // be attributed, and a name the line invents is a configuration nobody ran.
    expect(named).toEqual(shippedForwarded);
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
    const exempt = new Set(Object.keys(UNREPORTED_BY_ENGINE_RUNNERS));
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
    for (const [field, reason] of Object.entries(UNREPORTED_BY_ENGINE_RUNNERS)) {
      expect(reason.length, `${field}'s reason`).toBeGreaterThan(40);
    }
    // Four, not five: iteration 141 made the golden runner FORWARD `metricRiseCeiling`, so the standard no
    // longer permits its omission and the exemption is GONE rather than reworded — the same rule iteration
    // 124 applied to `failedEdgeWeight`. An exemption that outlives the reason for it is how a required
    // field stops being required, and the reason it carried ("neither construction site passes it") became
    // false the moment a construction site did.
    expect(Object.keys(UNREPORTED_BY_ENGINE_RUNNERS).sort()).toEqual([
      'dropMetrics',
      'failedEdgeMinRecords',
      'failedEdgeMode',
      'metricFleetBaseline',
    ]);
  });

  it('classifies every parsed option as forwarded or non-engine, with no residue', () => {
    // The guard that would have caught the omission at any point in the last several iterations: an
    // option that reaches `CliOptions` and is neither forwarded to the engine nor classified stops
    // the suite, so "parsed but dropped" and "parsed and deliberately not an engine option" can
    // never be the same shape again.
    const parsed = Object.keys(shipped).sort();
    const forwarded = shippedForwarded;
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

  it('renders the shipped line byte-identically to the line the golden artifact carries', () => {
    // Verbatim from `rcaeval-re1-results` of run `37402660140` (and `re2`; `re3` differs only in
    // `traceWeight=1`, which is the RE3 trace term), plus the ONE field this iteration enrolled —
    // `prismPooling`, whose shipped value is the pooling the call site already passed by OMISSION.
    // Read back from run `37736529560`, the enrolment's own golden: all three suites print this line
    // byte-for-byte and the NINE CELLS are unchanged (RE1 80 / 92.8 / 68, RE2 82.4 / 88.9 / 68.1,
    // RE3 80 / 45 / 51.1), which is the whole claim — the record moved by one field and no number moved.
    //
    // This is the control that makes the SPLIT checkable rather than argued: the two engine arguments
    // became two objects in an earlier iteration, and an artifact whose configuration line moved
    // without the record being read back would be evidence that something else changed too.
    //
    // It is also the control that fails when a SHIPPED WEIGHT moves without the artifact being
    // re-read — which is the intended behaviour, because the published numbers are read through this
    // line and a weight that changes silently changes what they mean.
    //
    // …and it moved again in iteration 124, by ONE field, when this runner began forwarding the failed-edge
    // direction weight — the knob whose absence left the golden half of that arm's kill criterion undecidable.
    // The value is the shipped 0, so no number can move; what changes is that a dispatch can now state it, and
    // that an artifact can no longer describe two different direction weights with one line. As above, the
    // acceptance is the FIELD plus the nine cells re-read on a run, never this string.
    //
    // …and it is the control that fails when the runner begins FORWARDING a field it never forwarded,
    // which is what happened here: `anomalyNormalizeNodeThreshold` is the second half of the
    // `rankNormalization` axis (the boolean picks WHICH rescale, this picks WHETHER one runs at all), so
    // an artifact that named the boolean and not the count could not say which cases the boolean reached.
    // It is printed unconditionally, on the latency weight's rule — the shipped value is 20, not 0, so an
    // omitted-when-default field would render this line byte-identically for the shipped run and for a run
    // that rescaled every graph. **The acceptance is the nine cells plus the FIELD, never this string**: the
    // line gained one field by design and the cells must be unmoved, which is checked on the run rather
    // than argued here.
    //
    // …and once more in iteration 187, when the deviation window's ANCHOR became dispatchable. It sits beside
    // `dropDeviationMode` because the two describe the same object from two sides — that one picks which
    // DIRECTION can speak, this one picks the SEGMENT the directions are measured against — and it is printed
    // unconditionally on the same rule as every field above: it ships at `whole-file`, so a line that omitted
    // defaults would render the shipped run and an arm that re-anchored every metric byte-identically.
    expect(formatSignalLine(shipped)).toBe(
      // Iteration 190 added `topoDiscountScope` here, and iteration 163 enrolled the operator it scopes: the
      // deduction now ships at 1 with the boundary gate, so this line names three fields that a release ago
      // were inert. All three are printed unconditionally, which is what lets a reader separate the enrolled
      // run from the twelve configurations that drew it — the defect every field above exists to prevent.
      'signals: stabilityWeight=0.007352 collisionWeight=0 topoWeight=0 topoDiscount=1 ' +
        'topoDiscountScope=external logWeight=1 ' +
        'logSignalMode=count latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0.0679 ' +
        'failedEdgeWeight=3 ' +
        'collapseDiscount=0 metricRiseCeiling=0 dropDeviationMode=bounded ' +
        'baselineAnchor=whole-file ' +
        'traceWeight=0 traceSkipsLeader=false prismWeight=0 prismPooling=additive ' +
        'rankNormalization=true anomalyNormalizeNodeThreshold=20 ' +
        'suppressIdleTransients=false suppressNearZeroBaselineRise=false ' +
        'suppressZeroBaselineLatency=false capTrendBonusAtDeviation=false ' +
        'suppressDemandMetrics=true ' +
        // The anomaly composition, named unconditionally: on this corpus it IS the ranking, so a line that
        // omitted it (or printed only non-defaults) could not attribute a RE1 movement to anything.
        'anomalyTrendWeight=0.15 anomalyBurstWeight=0 anomalyCvWeight=0.05 anomalyBreadthWeight=0.05 ' +
        'anomalyBreadthGate=0.8 ' +
        // The self-time term, named unconditionally for the same reason: it ships at 0, so a line that
        // printed only non-defaults would render a measured arm and the shipped run identically.
        'selfTimeWeight=0 victimWeight=0 dualFamilyWeight=0.25 dualFamilyGate=0.25 ' +
        'dualFamilyGateMode=channel ' +
        // APPENDED, not inserted: every byte before this one is what the published artifacts carry, so the
        // golden string is an extension of the shipped line rather than a replacement for it. Unconditional
        // on the rule `topoDiscountScope` follows one field above — the gate ships at 0, and a line that
        // printed only non-defaults would render a gated arm and the ungated one byte-identically.
        'temporalWeight=0 onsetShape=earliness selfAnomalyWeight=1 topoDiscountGate=1 ' +
        // Iteration 164 appended the deduction's closure behind its three siblings, and it is printed even at
        // the shipped `max`: the line is what makes a `sum` arm and the shipped run distinguishable, and a
        // field omitted at its default would render the two byte-identically.
        'topoClosure=max ' +
        // Iteration 167 appended the SET the ranking covers, and it is the one field on this line that is not a
        // property of the deduction: the filter applies at every weight, so it sits outside that family and is
        // printed even at `topoDiscount = 0`. `positive` is a value the published corpus ran under, and a line
        // that omitted it on the default would render a widened pool and the published run identically.
        'poolAdmission=positive',
    );
  });

  it('dispatches the rank-normalization axis’ POPULATION, and keeps zero a setting', () => {
    // The boolean above was already dispatchable; the count that decides which cases it can reach was not,
    // and the consequence is the reason this fence exists: on this corpus 487 of the 735 cases are below the
    // shipped count, so `rankNormalization` is not read there and the register's verdict about it has never
    // been testable on two thirds of the benchmark. A reach assertion, because a value that is printed on
    // every artifact and forwarded to the engine yet cannot be set is it.89's defect one axis over.
    // The count is declared in the parser and forwarded by the runner, so the two files are read together —
    // the same reason the ownership block reads both, one describe further up.
    const axis = code(readFileSync(RUNNER_PATH, 'utf8')) + code(readFileSync(CLI_PATH, 'utf8'));
    expect(axis).toMatch(/anomalyNormalizeNodeThreshold:\s*ANOMALY_NORMALIZE_NODE_THRESHOLD\b/);
    // No numeric literal: a literal here is a second owner of the engine's default and the line would then
    // describe a population the engine did not use.
    expect(axis).not.toMatch(/anomalyNormalizeNodeThreshold:\s*[-\d]/);
    // It reaches the engine through the SECOND constructor argument, where the graph builder reads it —
    // the argument whose membership is checked against `TopologyFaultGraphConfig` below.
    expect(shippedEngine.topology.anomalyNormalizeNodeThreshold).toBe(
      ANOMALY_NORMALIZE_NODE_THRESHOLD,
    );
    // `0` is a SETTING rather than an absent value: it is the count at which the rescale applies to every
    // graph, i.e. the widest population the axis has. `Number('')` is 0, so the two must be distinguished
    // by the whitespace rule rather than by truthiness — the same trap `--pool-penalty 0` was repaired for.
    expect(
      parseRCAEvalArgs(['--anomaly-normalize-threshold', '0']).anomalyNormalizeNodeThreshold,
    ).toBe(0);
    expect(
      parseRCAEvalArgs(['--anomaly-normalize-threshold', '1']).anomalyNormalizeNodeThreshold,
    ).toBe(1);
    // …and a malformed one reproduces the published population rather than inventing one.
    expect(
      parseRCAEvalArgs(['--anomaly-normalize-threshold', '']).anomalyNormalizeNodeThreshold,
    ).toBe(ANOMALY_NORMALIZE_NODE_THRESHOLD);
    expect(
      parseRCAEvalArgs(['--anomaly-normalize-threshold', 'many']).anomalyNormalizeNodeThreshold,
    ).toBe(ANOMALY_NORMALIZE_NODE_THRESHOLD);
    // The workflow can state it, which is what makes the axis reachable from a dispatch at all. Read from the
    // workflow rather than from a remembered flag list: an input nobody forwards is the same hole as an
    // option nobody can set, one level up.
    const workflow = readFileSync(
      resolve(REPO_ROOT, '.github/workflows/benchmark-rcaeval.yml'),
      'utf8',
    );
    expect(workflow).toMatch(/^\s+anomaly_normalize_threshold:$/m);
    expect(workflow).toMatch(/RANKING_ARG\+=\("?--anomaly-normalize-threshold/);
  });
});
