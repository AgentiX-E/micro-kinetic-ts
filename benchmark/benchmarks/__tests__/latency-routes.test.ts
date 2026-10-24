/**
 * The latency channel's three routes, and the verdict their counts earn.
 *
 * ## The question this instrument answers
 *
 * The register's sharpest open item, left by iteration 73: on RE3 OnlineBoutique the census read
 * `failedEdges 15/30` and `latency 0/30` — from ONE file, in the SAME cases. Two mechanisms predict that
 * zero and they differ in everything a decision would need:
 *
 * - the cap truncates the span list before the post-injection window (`tryLoadTraces` reads a byte prefix, and
 *   `countTraceActivityByService`'s docblock says so in as many words) ⇒ no edge has an AFTER-side mean;
 * - the assembly scales a start time that is already in milliseconds by 1000 a second time ⇒ every span lands
 *   after the anchor ⇒ no edge has a BEFORE-side mean.
 *
 * `input-coverage` can only say that `latency` holds nothing. This module counts the cap's sides and each
 * route's rows, so the artifact names the mechanism instead of the symptom — and the first test below is the
 * defect as an executable assertion, because that is the only form of it that cannot rot.
 *
 * @module benchmarks/__tests__/latency-routes
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  directionGateLine,
  formatLatencyRoutes,
  latencyChannelVerdict,
  summarizeLatencyRoutes,
  type LatencyRouteCensus,
  type LatencyRouteEntry,
} from '../src/directional-evidence.js';
import { parseFSE26Args } from '../src/fse26-cli.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import {
  applyLatencyView,
  countCapSides,
  DEFAULT_LATENCY_SOURCE,
  deriveLatencyViews,
  formatCorpusLine,
  isLatencySource,
  LATENCY_SOURCES,
  selectLatencyView,
} from '../src/rcaeval-corpus.js';
import { formatSignalLine } from '../src/rcaeval-engine-options.js';

import { batteryRows } from './helpers/ablation-battery.js';

import type {
  BenchmarkCase,
  BenchmarkTraceSpan,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, '..', rel), 'utf8');

/** An anchor with the magnitude of a real Unix millisecond stamp. */
const ANCHOR_MS = 1_700_000_000_000;

/**
 * One parent and two children, one per side of the anchor — an edge with a comparable pair, and nothing else.
 *
 * The start times are MILLISECONDS, which is what `normalizeTraceStartTime` returns and what
 * `BenchmarkTraceSpan.startTime` declares. A test that built them in seconds would exercise the very
 * confusion the defect is made of.
 */
const span = (
  spanId: string,
  service: string,
  startTime: number,
  extra: { parentSpanId?: string; status?: 'OK' | 'ERROR' } = {},
): BenchmarkTraceSpan => ({
  traceId: 't1',
  spanId,
  ...(extra.parentSpanId === undefined ? {} : { parentSpanId: extra.parentSpanId }),
  service,
  operationName: 'op',
  startTime,
  duration: 10,
  status: extra.status ?? 'OK',
});

/** The caller and its two callees: `a>b` with a before-mean and an after-mean. */
const TRACES: readonly BenchmarkTraceSpan[] = [
  span('p1', 'a', ANCHOR_MS - 3000),
  span('c1', 'b', ANCHOR_MS - 1000, { parentSpanId: 'p1' }),
  span('c2', 'b', ANCHOR_MS + 1000, { parentSpanId: 'p1' }),
];

/** A census built field by field, so a test states only the numbers its arm is about. */
const census = (over: Partial<LatencyRouteCensus> = {}): LatencyRouteCensus => ({
  cases: 1,
  casesWithoutAnchor: 0,
  casesWithCapSpans: 1,
  capSpans: 3,
  capPre: 2,
  capPost: 1,
  casesCapAllAfter: 0,
  casesCapAllBefore: 0,
  casesCapComparable: 1,
  shippedCases: 0,
  shippedRows: 0,
  cappedCases: 0,
  cappedRows: 0,
  wholeFileCases: 0,
  wholeFileRows: 0,
  ...over,
});

/** A passed-through whole-file view, so the third route is a value the test controls. */
const WHOLE_FILE = [{ caller: 'a', callee: 'b', preMeanMs: 10, postMeanMs: 200 }];

/** The three views, as the owner would hand them back. */
const VIEWS = {
  shipped: [] as readonly never[],
  capped: [{ caller: 'a', callee: 'b', preMeanMs: 10, postMeanMs: 10 }],
  'whole-file': WHOLE_FILE,
} as unknown as Parameters<typeof selectLatencyView>[1];

describe('the three routes to `edgeLatency`', () => {
  it('shows the shipped view going empty while the capped view does not — the defect, executable', () => {
    // THE assertion of this iteration. One trace list, one anchor, two views only one of which can hold a
    // pair: the published composition scales an already-millisecond value by 1000, so every span is "after"
    // the anchor and `toEngineDirectionalInputs` returns `[]` — the same array on every case of every suite,
    // which is why nine cells read `latency 0` and no corpus could explain it.
    const { views, capSides } = deriveLatencyViews(TRACES, ANCHOR_MS, WHOLE_FILE);
    expect(views.shipped, 'the shipped view is empty BY CONSTRUCTION, not by starvation').toEqual(
      [],
    );
    expect(views.capped, 'the same list with the value scaled once holds the pair').toHaveLength(1);
    expect(views.capped[0]).toEqual({
      caller: 'a',
      callee: 'b',
      preMeanMs: 10,
      postMeanMs: 10,
    });
    // The cap's own split, which is the OTHER mechanism's signature: two spans before the anchor, one after,
    // so a cap that truncated before the window would read `pre: 3, post: 0` — a different number, and now a
    // visible one.
    expect(capSides).toEqual({ spans: 3, pre: 2, post: 1 });
    // The whole-file view is passed through untouched: it comes from the streaming pass this assembly already
    // pays for, and re-deriving it here would be a second implementation of it.
    expect(views['whole-file']).toEqual(WHOLE_FILE);
  });

  it('counts the cap sides, and is total over an empty list', () => {
    expect(countCapSides([], ANCHOR_MS)).toEqual({ spans: 0, pre: 0, post: 0 });
    // All-after and all-before are the two signatures the verdict block reads; both are reached here so the
    // arms below are about a shape the counter can actually produce.
    expect(countCapSides([{ startTime: ANCHOR_MS }], ANCHOR_MS)).toEqual({
      spans: 1,
      pre: 0,
      post: 1,
    });
    expect(countCapSides([{ startTime: ANCHOR_MS - 1 }], ANCHOR_MS)).toEqual({
      spans: 1,
      pre: 1,
      post: 0,
    });
  });

  it('selects a view without touching anything else about the case', () => {
    const benchCase = {
      id: 'c1',
      failedTraceEdges: [{ caller: 'a', callee: 'b', failed: 3, baseline: 1 }],
      edgeLatency: [],
      groundTruth: { serviceId: 'b', faultType: 'CPU' },
    } as unknown as BenchmarkCase;
    const selected = selectLatencyView(benchCase, VIEWS, 'whole-file');
    expect(selected.edgeLatency).toEqual(WHOLE_FILE);
    // Everything else is the same object graph, and the input is untouched — one assembly serves every row.
    expect(selected.groundTruth).toBe(benchCase.groundTruth);
    expect(benchCase.edgeLatency).toEqual([]);
    expect(selected).not.toBe(benchCase);

    // The population-level form. An id with no views is returned UNCHANGED rather than dropped: a case the
    // caller did not assemble is not a case this function may silently remove from a run.
    const known = { id: 'c1' } as unknown as BenchmarkCase;
    const orphan = { id: 'nope' } as unknown as BenchmarkCase;
    const applied = applyLatencyView([known, orphan], new Map([['c1', VIEWS]]), 'capped');
    expect(applied[0]!.edgeLatency).toEqual(VIEWS.capped);
    expect(applied[1]).toBe(orphan);
    // The published corpus's view is the one whose array is empty, so the default is not a cosmetic choice.
    expect(DEFAULT_LATENCY_SOURCE).toBe('shipped');
  });
});

describe('the latency-route census', () => {
  const entry = (over: Partial<LatencyRouteEntry> = {}): LatencyRouteEntry => ({
    anchorPresent: true,
    capSpans: 0,
    capPre: 0,
    capPost: 0,
    shippedRows: 0,
    cappedRows: 0,
    wholeFileRows: 0,
    ...over,
  });

  it('aggregates every count, and counts a case by the side its cap landed on', () => {
    const c = summarizeLatencyRoutes([
      // One case with a comparable pair and rows on two routes.
      entry({ capSpans: 10, capPre: 4, capPost: 6, cappedRows: 2, wholeFileRows: 3 }),
      // One all-after, one all-before, one with no spans at all.
      entry({ capSpans: 5, capPre: 0, capPost: 5, wholeFileRows: 1 }),
      entry({ capSpans: 5, capPre: 5, capPost: 0, shippedRows: 7 }),
      // …and one with no usable anchor, which has to be counted on its own or it impersonates ALL-AFTER.
      entry({ anchorPresent: false, capSpans: 4, capPre: 0, capPost: 4 }),
    ]);
    expect(c).toMatchObject({
      cases: 4,
      casesWithoutAnchor: 1,
      casesWithCapSpans: 4,
      capSpans: 24,
      capPre: 9,
      capPost: 15,
      casesCapAllAfter: 2,
      casesCapAllBefore: 1,
      casesCapComparable: 1,
      cappedCases: 1,
      cappedRows: 2,
      shippedCases: 1,
      shippedRows: 7,
      wholeFileCases: 2,
      wholeFileRows: 4,
    });
    // A case with no spans contributes its zeros and is counted in the population — which is what makes
    // `N/M` in the verdict a rate rather than a count of the cases that had anything to say.
    expect(summarizeLatencyRoutes([]).cases).toBe(0);
  });

  it('names the mechanism, and appends the whole-file discriminator only when it can decide', () => {
    // The published cells: the shipped view emitted nothing, every capped span is at/after the anchor, and the
    // streaming route DID produce rows. That is the shape of RE3 OnlineBoutique and it names a defect rather
    // than a starvation.
    const allAfter = census({
      casesCapAllAfter: 30,
      casesCapAllBefore: 0,
      casesCapComparable: 0,
      capPre: 0,
      capPost: 300,
      wholeFileCases: 27,
      wholeFileRows: 412,
    });
    expect(latencyChannelVerdict(allAfter)).toContain('ALL-AFTER');
    expect(latencyChannelVerdict(allAfter)).toContain('30/30');
    expect(latencyChannelVerdict(allAfter)).toContain('the channel is not starved');
    expect(latencyChannelVerdict(allAfter)).toContain('412 rows in 27/30 cases');

    // The confound, and it is asserted to OUTRANK the arm above it: a case with no usable anchor produces the
    // same all-after signature without any start time being scaled wrongly, so `inject_time.txt` being absent
    // would otherwise be reported as a unit defect the run does not have. Its rate is over the POPULATION —
    // `cases` — because a missing anchor is a property of the case, not of a case that had spans to split.
    const noAnchor = census({
      cases: 30,
      casesWithoutAnchor: 30,
      casesCapAllAfter: 30,
      casesCapComparable: 0,
      wholeFileRows: 412,
    });
    expect(latencyChannelVerdict(noAnchor)).toContain('NO ANCHOR');
    expect(latencyChannelVerdict(noAnchor)).toContain('30/30 cases carry no usable injection time');
    expect(latencyChannelVerdict(noAnchor)).not.toContain('ALL-AFTER');
    // And with ONE anchor present the whole population is not accused of missing it — the count is a count.
    expect(
      latencyChannelVerdict(census({ cases: 30, casesWithoutAnchor: 1, casesCapAllAfter: 29 })),
    ).toContain('1/30 cases carry no usable injection time');

    // The cap's signature: the other side empty. Different cause, and the string says which side.
    const allBefore = census({
      casesCapAllAfter: 0,
      casesCapAllBefore: 30,
      casesCapComparable: 0,
      capPre: 300,
      capPost: 0,
      wholeFileCases: 27,
      wholeFileRows: 412,
    });
    expect(latencyChannelVerdict(allBefore)).toContain('CAP TRUNCATES');
    expect(latencyChannelVerdict(allBefore)).toContain('BEFORE the anchor');

    // A view that produced a row is not explained away: the shipped arm outranks every starvation, because a
    // zero elsewhere cannot unmake a measurement.
    expect(latencyChannelVerdict(census({ shippedCases: 2, shippedRows: 5 }))).toContain(
      'LIVE (shipped) — 5 rows in 2 cases',
    );
    expect(latencyChannelVerdict(census({ cappedCases: 3, cappedRows: 9 }))).toContain(
      'LIVE (capped) — 9 rows in 3 cases',
    );

    // No spans at all is the one case where the corpus really is the answer.
    expect(latencyChannelVerdict(census({ capSpans: 0, casesWithCapSpans: 0 }))).toContain(
      'STARVED',
    );
    // Comparable pairs and no rows: the derivation is the only suspect left, and the fallthrough says so.
    // This arm is a RESIDUE rather than a catch-all — every arm above it has been excluded, so `capSpans > 0`
    // with no case all-after and none all-before can only mean every case holds both sides.
    expect(latencyChannelVerdict(census())).toContain('UNEXPLAINED');
    expect(latencyChannelVerdict(census())).toContain('1 cases hold both sides');
    // The discriminator is APPENDED, so a dead channel that the whole-file route can still read says both.
    expect(
      latencyChannelVerdict(
        census({ capSpans: 0, casesWithCapSpans: 0, wholeFileRows: 1, wholeFileCases: 1 }),
      ),
    ).toContain('STARVED');
    // …and it is not appended to a live reading, which is already the strongest statement available.
    expect(
      latencyChannelVerdict(census({ shippedCases: 1, shippedRows: 1, wholeFileRows: 9 })),
    ).not.toContain('its input is discarded');
  });

  it('renders the counts and the verdict as the two lines the artifact carries', () => {
    const lines = formatLatencyRoutes(
      census({ capSpans: 20, capPre: 9, capPost: 11, wholeFileCases: 27, wholeFileRows: 412 }),
      'OnlineBoutique',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('latency-routes[OnlineBoutique]: 1 cases');
    expect(lines[0]).toContain('no anchor 0');
    expect(lines[0]).toContain('capped spans 20 (pre 9 / post 11)');
    expect(lines[0]).toContain('rows: shipped 0 | capped 0 | whole-file 412');
    expect(lines[1]).toContain('VERDICT:');
  });
});

describe('the corpus owns the views, and the unit contract is fenced', () => {
  it('derives all three views in ONE assembly, and keeps the published one as a recorded value', () => {
    const owner = read('src/rcaeval-corpus.ts');
    // The shipped view IS the historical expression, kept verbatim: a repair that changed it in place would
    // move a published number without an artifact that says it moved.
    expect(owner).toMatch(/startTime: s\.startTime \* 1000/);
    // The capped view passes the loader's own normalised value through — no second scale.
    expect(owner).toMatch(/capped: toEngineDirectionalInputs\(spans, injectTimeMs\)\.edgeLatency/);
    // The whole-file view is the streaming pass's own array, not a re-derivation.
    expect(owner).toMatch(/'whole-file': wholeFile/);
    expect(owner).toMatch(/streaming\.edgeLatency/);
    // The selection is the owner's, so a runner cannot index the views itself.
    expect(owner).toContain('export function selectLatencyView(');
    expect(owner).toContain('export function applyLatencyView(');
  });

  it('states the view at every call site, and on the deciding half states it from the OPTION', () => {
    // The `prismPooling` law one level up: an option a caller can name and a call site omits is an open axis.
    for (const runner of ['src/run-rcaeval.ts', 'src/run-optimize.ts', 'src/run-ablation.ts']) {
      expect(read(runner), `${runner} must state its corpus's latency view`).toMatch(
        /latencyFrom(?:,|: )/,
      );
    }
    // …and the golden's is not a CONSTANT. A literal `'shipped'` there made the corpus an undisplaceable pin:
    // `latWeight` — the largest weight in the ranking — multiplies `edgeLatency`, the shipped view's array is
    // empty on every corpus, and the one axis that can supply it was reachable from the ablation runner only,
    // whose numbers are the all-flags-off battery rather than the nine cells the kill criterion judges. The
    // property is therefore the REACH, and it is asserted as the path rather than as the spelling: the parsed
    // option, threaded through both functions that carry it to the assembler.
    const golden = read('src/run-rcaeval.ts');
    expect(golden).not.toMatch(/latencyFrom: '/);
    expect(golden).toMatch(/latencyFrom,/);
    expect(golden).toMatch(/loadCases\([\s\S]{0,80}?opts\.latencyView,/);
    expect(golden).toMatch(/loadSingleCase\(meta, loader, latencyFrom,/);
  });

  it('prints the census and the corpus line, so no row ranks on an inferred corpus', () => {
    const battery = read('src/run-ablation.ts');
    expect(battery).toContain('formatLatencyRoutes(bundle.latencyRoutes, systemName)');
    expect(battery).toContain('console.log(`Corpus: edgeLatency from ${latencyView}`);');
    // The three corpus rows, as QUOTED literals — a bare `toContain('LAT WHOLE FILE')` would be satisfied by
    // the control row, which is a superstring of it.
    for (const label of [
      'LAT WHOLE FILE (corpus edgeLatency=whole-file)',
      'LAT CAPPED (corpus edgeLatency=capped)',
      'LAT WHOLE FILE + LAT OFF',
    ]) {
      expect(battery, `${label} must be a row, as a label literal`).toContain(`label: '${label}'`);
    }
    // The two corpus rows that are NOT the control vary no engine knob at all, so a difference between them
    // and the baseline can only be the corpus.
    expect(battery).toMatch(
      /latencyView: 'whole-file',\s*\n\s*label: 'LAT WHOLE FILE \(corpus edgeLatency=whole-file\)'/,
    );
    // The control carries BOTH the corpus change and `latWeight = 0`, which is what makes it a control.
    expect(battery).toMatch(
      /overrides: \{ latWeight: 0 \},\s*\n\s*latencyView: 'whole-file',\s*\n\s*label: 'LAT WHOLE FILE \+ LAT OFF'/,
    );
  });

  it('holds the whole 2x2 over {corpus, floor}, of which this battery was missing one cell', () => {
    // The channel's two knobs are varied by two groups that never met: the weight/floor group varies
    // `latWeight` and `latMinRise` on the PUBLISHED corpus, and the corpus group varies which derivation the
    // array comes from. Their cross product has four cells and three existed — shipped x floor on (the
    // baseline), shipped x floor off, whole-file x floor on — and the fourth is the only row that can separate
    // "the supplied channel is INERT" from "the supplied channel is being read through the floor".
    //
    // The four cells are DERIVED from the rows rather than listed, so this fence fails when a cell goes missing
    // and stays true when the group grows: a third corpus or a second floor does not have to be enumerated
    // here, and a cell cannot be hidden by re-wording a label.
    //
    // `capped` is deliberately NOT required to have a second cell, and it is a construction argument rather
    // than a measurement: §7.1's census reads `CAP TRUNCATES` on every trace-bearing cell, so the capped view
    // holds no pair on this corpus and a `capped x floor off` row would multiply an empty array and add its
    // runtime to CI to report `Δ+0.0`.
    const battery = read('src/run-ablation.ts');
    const rows = batteryRows(battery);
    // Non-vacuity: an extraction that found nothing would satisfy nothing below while reporting no failure.
    expect(rows.length).toBeGreaterThan(20);
    const cells = [
      ...new Set(
        rows.filter((r) => r.latWeight !== '0').map((r) => `${r.corpus} \u0000 ${r.floor}`),
      ),
    ];
    for (const corpus of ['shipped', 'whole-file']) {
      for (const floor of ['default', '1']) {
        expect(cells, `the ${corpus} corpus with floor=${floor} must be a row`).toContain(
          `${corpus} \u0000 ${floor}`,
        );
      }
    }
    // And the row that varies BOTH axes names both. A label that named one of them would read as a single-axis
    // row, and its movement would be attributed to whichever axis the label did mention.
    const crossed = rows.find((r) => r.corpus === 'whole-file' && r.floor === '1');
    expect(crossed?.label).toContain('WHOLE FILE');
    expect(crossed?.label).toContain('NO FLOOR');
    // The same requirement one level down, in the block that prints the verdicts: a crossed row's zero is only
    // attributable if BOTH of its axes are named there, and the corpus axis is the one that has to be appended
    // by hand — the term axis comes for free out of the configuration-line diff, so a block that dropped the
    // append would still print a row, with one axis, and read as a single-knob result.
    expect(battery).toContain(
      'const axes = variesCorpus ? [...changed, `corpus:edgeLatency(${run.latencyView})`] : changed;',
    );
    // And the workflow's own comment is held to the battery's size, DERIVED here. A comment that counts a
    // growing list is wrong more often than it is right — this repository writes that sentence elsewhere about
    // its own weight families — and THIS one had already drifted: it stated 33 configs while the array grew to
    // 34. The count is a copy of a fact the array owns, and a copy needs a guard.
    expect(read('../.github/workflows/benchmark-rcaeval.yml')).toContain(
      `is **${rows.length} configs**`,
    );
  });
});

/**
 * The corpus axis, on the half that decides.
 *
 * Iteration 88 established the interaction: the floor and the supplied corpus each move nothing alone and move
 * two published cells together, so an instrument that can vary one of the two cannot measure the effect either
 * of them has. The ablation battery could vary both, but its numbers are the all-flags-off configuration while
 * the kill criterion is judged on the nine cells of the published one — a candidate measurable on one
 * instrument and judged on another has an undecidable other half, which is the sentence the `log_weight`
 * dispatch input already carries about the REJECTED temporal candidate.
 *
 * So this block fences the two things that make the decision measurable: the view is a DISPATCHABLE option on
 * the golden half, and every artifact NAMES the corpus it ranked on.
 */
describe('the corpus axis is named and dispatchable, which is what the floor decision needs', () => {
  const golden = read('src/run-rcaeval.ts');
  const owner = read('src/rcaeval-corpus.ts');
  const cli = read('src/rcaeval-cli.ts');
  const workflow = read('../.github/workflows/benchmark-rcaeval.yml');

  it('accepts the whole union by the union’s own guard, and defaults to the published view', () => {
    expect(parseRCAEvalArgs([]).latencyView).toBe(DEFAULT_LATENCY_SOURCE);
    expect(DEFAULT_LATENCY_SOURCE).toBe('shipped');
    // Every member, from the union's own table rather than a pair this file spells: a hand-written pair is
    // exactly what `--log-signal-mode` accepted while four of its six modes ran as `count`.
    const members = Object.keys(LATENCY_SOURCES);
    expect(members.length).toBeGreaterThanOrEqual(3);
    for (const view of members) {
      expect(parseRCAEvalArgs(['--latency-view', view]).latencyView, view).toBe(view);
      expect(isLatencySource(view), view).toBe(true);
    }
    // The guard is the TABLE's and not the prototype chain's — `toString` is a token a dispatch can really
    // send, and an `in` test would accept it. An unusable value reproduces the published corpus.
    for (const token of ['toString', 'constructor', '__proto__', 'nope', 'WHOLE-FILE', '']) {
      expect(parseRCAEvalArgs(['--latency-view', token]).latencyView, token).toBe(
        DEFAULT_LATENCY_SOURCE,
      );
      expect(isLatencySource(token), token).toBe(false);
    }
    // …and the parser consults that guard rather than re-deciding, which is what keeps one answer to one
    // question.
    expect(cli).toContain('isLatencySource(view) ? view : DEFAULT_LATENCY_SOURCE');
    expect(owner).toContain('export function isLatencySource(');
  });

  it('writes the view into the artifact, from the ONE string the banner also prints', () => {
    // An artifact that ranked on another corpus without saying so is two measurements filed under one
    // configuration — the failure the signals line exists to prevent, at the level the signals line cannot see.
    // The banner and the dump take one string, so they cannot disagree about it.
    expect(owner).toContain('export function formatCorpusLine(');
    expect(formatCorpusLine('whole-file')).toBe('corpus: latencyView=whole-file');
    expect(formatCorpusLine(DEFAULT_LATENCY_SOURCE)).toBe('corpus: latencyView=shipped');
    expect(golden).toContain('formatCorpusLine(opts.latencyView)');
    expect(golden).toContain('console.log(configuration);');
    expect(golden).toContain('new DiagnoseDump(opts.diagnoseDump, configuration)');
    // …and the view is NOT smuggled onto the signals line, whose membership is held in BOTH directions to the
    // options the engine's constructor receives. A corpus knob printed there would be a name the line invents.
    expect(formatSignalLine(parseRCAEvalArgs(['--latency-view', 'whole-file']))).toBe(
      formatSignalLine(parseRCAEvalArgs([])),
    );
  });

  it('reports the census on the DECIDING half too, from the owner’s own renderer', () => {
    // Iteration 89 gave the golden half the corpus AXIS; it still could not say what the chosen view HELD.
    // `AssembledRCAEvalCase.latencyRoute` was returned by the assembler and dropped by this runner, so a run with
    // `--latency-view whole-file` printed `corpus: latencyView=whole-file` beside an unchanged ranking — which is
    // exactly what a view that was SUPPLIED and INERT looks like. Two configurations with the same cells and
    // different causes are the failure this whole document exists to separate, and here it was in the half that
    // DECIDES: the floor/corpus decision cannot be taken on a run whose corpus cannot be shown to have carried
    // anything. A diagnostic must be a function of what the producer wrote, and the producer wrote the rows.
    const golden = read('src/run-rcaeval.ts');
    const battery = read('src/run-ablation.ts');
    // The threading, in the order it travels: the assembler's own field, read at the call site, carried by both
    // functions that handle a case, and aggregated by the owner's summariser.
    expect(golden).toMatch(/const \{[^}]*\blatencyRoute\b[^}]*\}/);
    expect(golden).toMatch(/latencyRoute: assembled\.latencyRoute/);
    expect(golden).toMatch(/latencyRoutes: LatencyRouteCensus/);
    expect(golden).toMatch(
      /latencyRoutes: summarizeLatencyRoutes\(\[\.\.\.latencyRouteByCaseId\.values\(\)\]\)/,
    );
    // ONE renderer for two artifacts: the same function the battery prints with, so the two artifacts' corpus
    // lines are COMPARABLE across runs rather than merely similar — the property that makes a candidate measured
    // on one instrument readable on the other.
    expect(golden).toContain('formatLatencyRoutes(stats.latencyRoutes');
    expect(battery).toContain('formatLatencyRoutes(bundle.latencyRoutes');
    // …and the runner does not re-render them. A second spelling is a second answer, and the verdict arms
    // (`STARVED` / `CAP TRUNCATES`) are the renderer's to choose.
    expect(golden).not.toContain('latency-routes[');
    // And it is REPORTED, not merely typed: a value that is computed and never printed is precisely the state
    // this fence was written against, and the artifact is what carries the attribution.
    // …and it now RECEIVES the run's options, because the line beside the census needs the weight and the
    // view it resolved to: a report that could count rows but not name `weight 0` / `CANNOT FIRE` would leave
    // the two states this document exists to separate indistinguishable on the artifact.
    expect(golden).toMatch(/reportLatencyRoutes\(systemName, stats, opts\)/);
  });

  it('forwards all five knobs from dispatch inputs into EVERY golden invocation', () => {
    // A knob with a flag and no input is still one only a commit can turn: "a pin whose replacement is
    // unreachable is still a pin", which is this repository's own sentence about `--temporal-weight`.
    const invocations = workflow.split('run-rcaeval.ts').length - 1;
    expect(invocations).toBeGreaterThanOrEqual(7);

    /** How many invocations forward `flag` from its `input`, out of the named array. */
    const forwarded = (array: string, flag: string, input: string): number =>
      [
        ...workflow.matchAll(
          new RegExp(`${array}\\+=\\(${flag} "\\$\\{\\{ inputs\\.${input} \\}\\}"\\)`, 'g'),
        ),
      ].length;

    // The three the TWO runners share, in the array whose own comment states that they are shared. Their
    // spellings are the FSE'26 runner's, so one value means one thing in both workflows.
    // …plus the direction term, which joined them in iteration 124: the arm it enables is measured, and its
    // golden half was undecidable for exactly this reason — a flag the FSE'26 workflow could pass and this one
    // could not state at all.
    for (const [input, flag] of [
      ['lat_weight', '--lat-weight'],
      ['lat_min_rise', '--lat-min-rise'],
      ['pool_penalty', '--pool-penalty'],
      ['failed_edge_weight', '--failed-edge-weight'],
    ] as const) {
      expect(workflow, `${input} must be a dispatch input`).toContain(`      ${input}:`);
      expect(forwarded('RANKING_ARG', flag, input), `${flag} at every invocation`).toBe(
        invocations,
      );
    }
    // The corpus view is NOT part of that shared vocabulary, so it travels in its own array — and the
    // separation is asserted rather than trusted: `run-fse26.ts` reads no spans at all, so on that half the
    // flag would be a knob with no reader, which is a guard no input can reach.
    expect(workflow).toContain('      latency_view:');
    expect(forwarded('CORPUS_ARG', '--latency-view', 'latency_view')).toBe(invocations);
    expect(workflow.split('"${CORPUS_ARG[@]}"').length - 1).toBe(invocations);
    expect(() => parseFSE26Args(['--latency-view', 'whole-file'])).toThrow(/--latency-view/);
    // Non-vacuity: the counting above would also be satisfied by a flag forwarded into an array no command
    // line spreads, so the spreads are counted too — and the population is the invocations themselves.
    expect(workflow.split('"${RANKING_ARG[@]}"').length - 1).toBe(invocations);
  });
});

/**
 * The census counts SYSTEMS, and the decision the channel created is made per CASE.
 *
 * Iteration 89 gave the corpus an axis and iteration 90 measured where it decides; that measurement closed the
 * channel as an unconditional default and left a ROUTING question behind — RE3 TrainTicket gains 8 cases and
 * loses none while RE3 OnlineBoutique loses 5 and gains 2, so some cases want the view and some want the
 * published composition. Every artifact this repository produces aggregates the channel over a system, and a
 * system-level count cannot answer a per-case question: a run can say "RE3 TrainTicket supplied 2006 rows" and
 * cannot say which of its thirty cases was helped. `latencyRoute` is computed per case by the corpus owner and
 * reduced on the spot, so the supply exists and is thrown away one line later.
 *
 * **The two fences below are one contract seen twice**: the row a reader sums out of the artifact must be the
 * row the census printed, and the supply must be the owner's value rather than a second spelling of it.
 */
describe('the census aggregates by system, and the channel’s decision is made per case', () => {
  it('threads the case’s own supply into every loss-census row, from the census’s ONE population', () => {
    const golden = read('src/run-rcaeval.ts');
    // ONE population. The map is what the owner's summariser reads, so the rows the census PRINTS and the rows
    // a reader sums out of the artifact cannot be two different populations that happen to agree.
    expect(golden).toMatch(/latencyRouteByCaseId\.set\(benchCase\.id, latencyRoute\)/);
    expect(golden).toMatch(/summarizeLatencyRoutes\(\[\.\.\.latencyRouteByCaseId\.values\(\)\]\)/);
    // …and it is not ALSO kept in an array the summariser reads instead. Two collections holding one population
    // is the second owner this repository's own law forbids: they can disagree, and the disagreement is silent.
    expect(golden).not.toMatch(/latencyRouteEntries/);
    // The row takes the entry the OWNER produced rather than re-spelling its seven fields. A second spelling is
    // a second answer, and `wholeFileRows` is the field a hand-built literal would most naturally drop: it is a
    // CORPUS fact, so it must survive a run whose own view is `shipped` and whose three view row counts are
    // otherwise all zero. Without it an artifact cannot say "the corpus could supply this and the configuration
    // declines to read it" — which is the statement the routing question is made of.
    expect(golden).toMatch(/latencySupply: stats\.latencyRouteByCaseId\.get\(c\.id\)/);
    expect(golden).not.toMatch(/\bwholeFileRows:/);
    expect(golden).not.toMatch(/\bcapPre:/);
    // …and the lookup is total only because the ENTRY IS SET BEFORE THE CASE IS APPENDED, which is the
    // invariant the row relies on instead of an arm. Asserted by ORDER rather than trusted, because the failure
    // is silent in the worst way: a case appended before its entry is set would make the lookup `undefined`, and
    // `JSON.stringify` DROPS an undefined property — so the artifact would lose the field for exactly the cases
    // the instrument failed on, and every reader would see a well-formed file.
    expect(golden.indexOf('latencyRouteByCaseId.set(benchCase.id, latencyRoute)')).toBeLessThan(
      golden.indexOf('loaded.push(benchCase)'),
    );
  });

  it('declares the supply as REQUIRED, and imports the owner’s type rather than mirroring it', () => {
    // Optional would make "this case carried no spans" and "nobody recorded what it carried" the same record,
    // which is the collapse of the levels of ABSENCE this repository names in its own laws — and the collapse
    // is in the direction that reads a missing instrument as a measured zero.
    const census = read('src/loss-census.ts');
    expect(census).toMatch(/readonly latencySupply: LatencyRouteEntry;/);
    expect(census).not.toMatch(/latencySupply\?/);
    // A MIRROR is the right convention ACROSS packages — `TruthEvidence` is declared twice because `benchmarks`
    // does not depend on `packages/kinetic` — and it is the wrong one inside a package, where it would be a
    // second declaration of one shape that no fence could hold to the first.
    expect(census).toMatch(
      /import type \{[^}]*\bLatencyRouteEntry\b[^}]*\} from '\.\/directional-evidence\.js'/,
    );
  });
});

describe('directionGateLine — can the failed-edge term act on THIS corpus?', () => {
  // The line exists because two very different runs print the same nine cells: one where the arm was measured
  // and found harmless, and one where the arm could not fire at all. The three arms below are the three states,
  // and the middle one is the defect: on the SHIPPED view `edgeLatency` is empty on every RCAEval cell, so a
  // weight above zero buys a term whose second half has no value.

  it('says OFF when the weight is zero, and does not pretend the cells are evidence', () => {
    const line = directionGateLine(0, 'shipped', 0, 90);
    expect(line).toContain('weight 0');
    expect(line).toContain('OFF by configuration');
    expect(line).toContain('say nothing about it');
  });

  it('says CANNOT FIRE when the weight is set but the view supplied no rows — the vacuous case', () => {
    // This is the reading that would otherwise pass for a measurement: `weight 3`, shipped view, and the nine
    // cells byte-identical. The line names the mechanism — the gate's SECOND half has no value — so a reader
    // cannot mistake "switched off twice" for "tested and safe".
    const line = directionGateLine(3, 'shipped', 0, 90);
    expect(line).toContain('weight 3');
    expect(line).toContain('supplied 0 latency rows over 90 cases');
    expect(line).toContain('CANNOT fire');
    expect(line).toContain('NOT evidence');
  });

  it('says CAN ACT only when the view the run ranked on supplied rows', () => {
    const line = directionGateLine(3, 'whole-file', 6781, 90);
    expect(line).toContain('6781 latency rows over 90 cases');
    expect(line).toContain('CAN fire');
    expect(line).toContain('attributable');
    // And the view is NAMED, because the same weight means two different experiments on two views.
    expect(line).toContain('whole-file');
    expect(directionGateLine(3, 'shipped', 6781, 90)).toContain('shipped');
  });

  it('reads the rows of the view it was given, which is why the caller passes one number not a census', () => {
    // A census-shaped argument would let the line read `wholeFileRows` while the run ranked on `shipped` — the
    // exact pairing error the corpus axis exists to prevent. The signature takes the count, so the caller has
    // to select it from the view it resolved, and a test can hold the runner to that selection (below).
    const runner = readFileSync(resolve(HERE, '../src/run-rcaeval.ts'), 'utf8');
    expect(runner).toMatch(/opts\.latencyView === 'whole-file'[\s\S]{0,160}wholeFileRows/);
    expect(runner).toMatch(/directionGateLine\(opts\.failedEdgeWeight, opts\.latencyView,/);
  });
});
