/**
 * The runner must ASK whether a cell is a measurement, and must not answer it with the loader's queue length.
 *
 * The defect this file fences is one line, and the fence is text because the line lives in a file that calls
 * `main()` at import time and therefore cannot be imported by a test. The line was
 *
 *     if (stats.considered === 0) { … continue; }
 *
 * where `considered` counts the cases the loader was ASKED for. On run 43901259774 all thirty RE3 cases failed
 * to load on an embedding-quota error, `considered` was thirty, the guard passed, and the cell printed
 * `AC@1 0.0 %` over an empty denominator. A test that could call the function would assert its BEHAVIOUR (see
 * `cell-population.test.ts`, which does); what this file can still do is make sure the runner keeps calling it
 * instead of re-deriving the answer inline, which is how the inline version got there in the first place.
 *
 * @module benchmarks/__tests__/cell-measurement-wiring.test
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RUNNER = readFileSync(join(import.meta.dirname, '..', 'src', 'run-rcaeval.ts'), 'utf8');

describe('the RCAEval runner measures a cell or refuses to', () => {
  it('delegates the verdict to the module that owns it', () => {
    expect(RUNNER).toContain("from './cell-population.js'");
    expect(RUNNER).toContain('classifyCell({');
    // The two populations, both forwarded: a call that passed only one of them could not distinguish a
    // cell that selected nothing from a cell whose corpus failed to load.
    expect(RUNNER).toMatch(/classifyCell\(\{[\s\S]{0,300}requested:[\s\S]{0,300}evaluated:/);
  });

  it('no longer skips a cell on the number of cases the loader was ASKED for', () => {
    // The exact expression that let the defect through. It is not merely unused — it is the question, and a
    // re-introduction would read as a harmless early exit while restoring the silent zero.
    expect(RUNNER).not.toContain('stats.considered === 0');
  });

  it('prints no table for an unmeasured cell, and states it instead', () => {
    // The ordering is the contract: the verdict is taken BEFORE `printResultsTable`, and the unmeasured arm
    // leaves the loop. A branch that printed the block and then fell through to the table would satisfy the
    // text of the block and publish the rate anyway.
    const verdictAt = RUNNER.indexOf('classifyCell({');
    const blockAt = RUNNER.indexOf('formatUnmeasuredBlock(systemName, suiteName, measurement)');
    const tableAt = RUNNER.indexOf('printResultsTable(systemName, suiteName, results');
    expect(verdictAt).toBeGreaterThan(0);
    expect(blockAt).toBeGreaterThan(verdictAt);
    expect(tableAt).toBeGreaterThan(blockAt);
    const between = RUNNER.slice(blockAt, tableAt);
    expect(between).toMatch(/continue;/);
  });

  it('fails the run when any requested cell produced no rate', () => {
    // Exit 3 rather than 1, because 1 is what an exception returns and "the measurement could not be taken"
    // is a different event from "the runner threw". What matters is that the workflow can see it at all.
    expect(RUNNER).toContain('process.exitCode = 3');
    expect(RUNNER).toMatch(/unmeasuredCells\.length > 0/);
  });

  it('probes the embedding provider before the corpus walk, and names it on the configuration line', () => {
    // Both halves of the run-43901259774 repair, in the order they have to happen: the probe is what converts a
    // fourteen-minute silent corruption into a refusal, and the topology field is what keeps a substituted run
    // from presenting itself as an API-embedded one.
    expect(RUNNER).toContain("from './semantic-preflight.js'");
    const probeAt = RUNNER.indexOf('preflightSemanticConfig(configuredSemantic');
    const discoveryAt = RUNNER.indexOf('discoverAllCases(opts.dataDir)');
    expect(probeAt).toBeGreaterThan(0);
    expect(probeAt).toBeLessThan(discoveryAt);
    // The backend is ON the configuration string, which is the string the diagnose dump's header carries, and it
    // is rendered once and interpolated — so the degradation banner and the artifact cannot state different ones.
    expect(RUNNER).toMatch(
      /const configuration = `\$\{formatSignalLine\(opts\)\}\\n\$\{formatCorpusLine\(opts\.latencyView\)\}\\n\$\{topologyLine\}`/,
    );
    expect(RUNNER.match(/formatTopologyLine\(/g) ?? []).toHaveLength(1);
  });

  it('re-resolves no second provider after the probe, so the run and the artifact name the same one', () => {
    // The site below the probe used to call `createSemanticConfig()` again. Two calls is two providers, and
    // the one the artifact names would then not be the one the run measured with.
    expect(RUNNER.match(/createSemanticConfig\(\)/g)?.length).toBe(1);
  });
});
