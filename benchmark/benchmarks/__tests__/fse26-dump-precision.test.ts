/**
 * The FSE'26 dump's render PRECISION, from the dispatch input to the artifact's own declaration.
 *
 * ## The defect
 *
 * `fse26-cv-screen.md` states that the dump precision "is now an input to all seven dump steps
 * (`--diagnose-decimals`), so the same dispatch that renders FSE'26 at four decimals also settles
 * whether the window is admitted", and the register repeats it while recording the ONE remaining
 * `needs 1` window — FSE'26's stability `flip` on `35107871516` — as **a prediction one dispatch
 * away**. The seven dump steps are the RCAEval suites. On the FSE'26 side the flag was reachable
 * nowhere, in three places at once:
 *
 *   the parser   `fse26-cli.ts` had no `--diagnose-decimals` arm
 *   the runner   `run-fse26.ts` called the shared builder WITHOUT `fieldDecimals`, so the dump
 *                always took the producer's fallback
 *   the workflow `fse26-benchmark.yml` declared no `diagnose_decimals` input
 *
 * So the prediction was not one dispatch away — it was UNREACHABLE, and the sentence that said
 * otherwise is the same shape as the one this repository already paid for: *a repaired pin whose
 * replacement is unreachable is still a pin*.
 *
 * ## What this file pins
 *
 * 1. The parser accepts the flag, defaults to the producer's precision, keeps an explicit `0`,
 *    refuses a value the renderer cannot express, and refuses a MISSING value rather than
 *    swallowing the next flag.
 * 2. The parsed value reaches the written artifact — the round trip is asserted on the block's own
 *    `decimals=` declaration, because that declaration is what the reader's error bar is drawn
 *    from. A value that parses and is then dropped is the defect, not a near miss of it.
 * 3. The FSE'26 runner threads the OPTION rather than a copy of the constant. This one is asserted
 *    in the SOURCE and cannot be behavioural: a literal agrees with the owner until the owner
 *    moves, which is the same reason the census asserts the shipped weights in the source.
 * 4. The workflow both declares the input and forwards it, at the flag's own spelling.
 *
 * @module benchmarks/__tests__/fse26-dump-precision
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FaultPropagationGraph } from '../../packages/core/src/index.js';
import {
  MAX_FIELD_DECIMALS,
  SERVICE_FIELD_DECIMALS,
  SyntheticBenchmarkGenerator,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import { parseFSE26Args } from '../src/fse26-cli.js';
import { parseDiagnosticDump } from '../src/fse26-diagnose-analyze.js';
import { renderDiagnosedCase } from '../src/fse26-diagnose-sink.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(HERE, '../..');
const RUNNER = readFileSync(resolve(HERE, '../src/run-fse26.ts'), 'utf8');
const WORKFLOW = readFileSync(resolve(repoRoot, '.github/workflows/fse26-benchmark.yml'), 'utf8');

const generator = new SyntheticBenchmarkGenerator(11);

/** A record in the shape the runner hands the sink; see `fse26-diagnose-sink.test.ts`. */
function recordOf(): DiagnosedCaseRecord {
  const benchCase = generator.generateRCAEvalCase('cpu', 3);
  const callGraph = benchCase.callGraph;
  const ids = [...callGraph.nodes.keys()];
  const graph: FaultPropagationGraph = {
    callGraph,
    propagationWeights: new Float64Array(callGraph.edges.length),
    anomalyScores: new Map(ids.map((id, index) => [id, 0.9 - index * 0.1])),
    anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
    detectedCycles: [],
    totalCycleContribution: 0,
    pruneThreshold: 0.001,
  };
  return {
    case: benchCase,
    graph,
    ranking: ids.map((serviceId) => ({ serviceId })) as never,
    callGraph,
  };
}

describe("parseFSE26Args — the dump's render precision", () => {
  it("defaults to the producer's precision, so a bare dispatch writes the artifact it always did", () => {
    expect(parseFSE26Args([]).diagnoseDecimals).toBe(SERVICE_FIELD_DECIMALS);
  });

  it('honours an explicit precision', () => {
    expect(parseFSE26Args(['--diagnose-decimals', '4']).diagnoseDecimals).toBe(4);
  });

  it('keeps an explicit 0, because integer rendering is a legal artifact', () => {
    // Coarsening a dump is a real request — it is the box a reader is handed — so 0 must not be
    // confused with "unset". This is the same distinction the RCAEval parser already makes.
    expect(parseFSE26Args(['--diagnose-decimals', '0']).diagnoseDecimals).toBe(0);
  });

  it('refuses a value the renderer cannot express, and does not invent one', () => {
    // `toFixed` raises outside `[0, MAX_FIELD_DECIMALS]`, and `4.5` digits is not a request the
    // renderer can satisfy — rounding it would publish one of two legal artifacts, neither named.
    expect(parseFSE26Args(['--diagnose-decimals', '4.5']).diagnoseDecimals).toBe(
      SERVICE_FIELD_DECIMALS,
    );
    expect(
      parseFSE26Args(['--diagnose-decimals', String(MAX_FIELD_DECIMALS + 1)]).diagnoseDecimals,
    ).toBe(SERVICE_FIELD_DECIMALS);
  });

  it('refuses a MISSING value instead of swallowing the next flag', () => {
    // The wider half of the argument defect: an arm that consumes the next token replaces the whole
    // request with defaults and says nothing. `hasValue` makes the arm not match, so the token is
    // reported as unrecognised — and `--log-mode count` survives as its own argument rather than
    // becoming this flag's value.
    expect(() => parseFSE26Args(['--diagnose-decimals', '--log-mode', 'count'])).toThrow(
      /--diagnose-decimals/,
    );
    expect(() => parseFSE26Args(['--log-mode', 'count', '--diagnose-decimals'])).toThrow(
      /--diagnose-decimals/,
    );
  });
});

describe("the parsed precision reaches the artifact's own declaration", () => {
  it('declares the requested decimals in the block the reader draws its box from', () => {
    // The round trip, and the point of the whole file: `decimals=N` is a property of the ARTIFACT,
    // and a reader's `resolutionBoxFor` takes the box from it. A precision that parses and is then
    // dropped is not a near miss — it is a four-decimal request silently answered by a
    // three-decimal file, whose box is three orders of magnitude too wide.
    const opts = parseFSE26Args(['--diagnose-decimals', '4']);
    const parsed = parseDiagnosticDump(
      renderDiagnosedCase(recordOf(), {
        logSignalMode: 'logicHttp',
        useInjectTime: true,
        fieldDecimals: opts.diagnoseDecimals,
      }),
    )[0]!;
    expect(parsed.fieldDecimals).toBe(4);
  });
});

describe("the FSE'26 runner threads the OPTION, not a copy of the constant", () => {
  it('names `fieldDecimals` at the shared builder call', () => {
    // The call that was missing it. Asserted in the SOURCE because the shared input now REQUIRES
    // the field: a caller can no longer omit it, but it can still supply a COPY — and a copy agrees
    // with the owner until the owner moves. `SERVICE_FIELD_DECIMALS` is the producer's default, not
    // this runner's answer, so a literal here would silently pin a four-decimal dispatch to three.
    const call = /buildFSE26Diagnostic\(\{[\s\S]*?\n {2}\}\)/g.exec(RUNNER)?.[0];
    expect(call, 'run-fse26.ts must call the shared builder').toBeDefined();
    expect(call).toContain('fieldDecimals');
    expect(call).not.toMatch(/fieldDecimals:\s*(SERVICE_FIELD_DECIMALS|\d)/);
  });

  it('hands the parsed option to the adapter, so the value travels from the command line', () => {
    // The destination as well as the source: the adapter receives `opts.diagnoseDecimals` at its
    // own call site. Replacing that argument with the constant is a mutation that passes every
    // behavioural test while the flag stops doing anything — which is the defect in miniature.
    expect(RUNNER).toMatch(
      /buildDiagnostic\(\s*raw,\s*benchCase,\s*faultGraph,\s*ranking,\s*opts\.logMode,\s*opts\.diagnoseDecimals,?\s*\)/,
    );
  });
});

describe('the workflow can ASK for a precision', () => {
  it('declares the input', () => {
    expect(WORKFLOW).toMatch(/^ {6}diagnose_decimals:/m);
  });

  it('forwards it at the flag’s own spelling', () => {
    // Declared and unforwarded is the failure this repository has already measured: an input the
    // dispatcher can fill and no argument ever reads.
    //
    // The input's own `default: ''` is deliberately NOT re-asserted here. It has an owner already —
    // `fse26-reported-config.test.ts` classifies every input and requires every RUNNER-owned one to
    // leave its default empty — and a second assertion would be a second owner of the same rule,
    // which is the shape this repository keeps finding rather than the shape it wants.
    expect(WORKFLOW).toContain('--diagnose-decimals "${{ inputs.diagnose_decimals }}"');
  });

  it('passes the flag only when the input is non-empty', () => {
    const guard = /if \[ -n "\$\{\{ inputs\.diagnose_decimals \}\}" \]; then/g;
    expect(WORKFLOW.match(guard)?.length).toBe(1);
  });

  it('APPENDS every argument array it builds, so no override is assembled and then dropped', () => {
    // The wider form of the same defect, and the reason the narrow assertion above is not enough on
    // its own: `DIAGNOSE_DECIMALS_ARG=(--diagnose-decimals …)` is a complete, correct-looking
    // declaration of the flag, and deleting the one line that expands it leaves the flag spelled
    // exactly as before while the runner never sees it. So the population is DERIVED — every array
    // the run step builds — and each must be expanded into the command.
    const built = [...WORKFLOW.matchAll(/^\s*([A-Z][A-Z0-9_]*)=\(\)/gm)].map((m) => m[1]!);
    expect(built.length, 'the run step must build its arguments somehow').toBeGreaterThan(10);
    expect([...new Set(built)]).toContain('DIAGNOSE_DECIMALS_ARG');
    for (const name of new Set(built)) {
      expect(WORKFLOW, `${name} is built but never expanded`).toContain(`"\${${name}[@]}"`);
    }
  });
});
