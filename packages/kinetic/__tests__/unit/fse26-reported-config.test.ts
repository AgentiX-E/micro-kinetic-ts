/**
 * Report-integrity guard for the published FSE'26 number.
 *
 * The number that gets published is whatever the CI workflow runs when nobody
 * overrides it. That default therefore has exactly one legitimate owner: the
 * runner, whose default is chosen from measurement. Any second copy of it is a
 * drift hazard, and the drift is silent — the run still succeeds, still prints
 * a confident Top@1, and just reports the wrong configuration.
 *
 * It already happened once: `.github/workflows/fse26-benchmark.yml` hardcoded
 * `log_mode: count` while the best measured mode was `logicHttp`. Every
 * scheduled run published `count` (Top@1 23.1% / 328 of 1422) although
 * `logicHttp` measured Top@1 47.3% / 673 of 1422 on the same commit and the
 * same provenance-verified cache (runs 34604119657 and 34604105028).
 *
 * So the invariant enforced here is structural, not cosmetic:
 *
 *   1. the workflow's `log_mode` input defaults to EMPTY — it passes
 *      `--log-mode` only when the dispatch input is non-empty, which makes the
 *      runner's own default the single source of truth;
 *   2. the runner's default is the best-measured mode.
 *
 * The assertions read the two files as text on purpose: the defect lives in
 * configuration, not in a runtime code path, so no amount of execution
 * coverage can see it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/kinetic/__tests__/unit/ → four levels up is the repository root.
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const WORKFLOW_PATH = resolve(repoRoot, '.github/workflows/fse26-benchmark.yml');
const RUNNER_PATH = resolve(repoRoot, 'benchmarks/src/run-fse26.ts');

/**
 * Read the `default:` of one `workflow_dispatch` input out of the raw YAML.
 *
 * Only the input block is parsed (the lines indented deeper than the input
 * name), so a `default:` belonging to a different input cannot be picked up.
 */
function readInputDefault(yml: string, input: string): string | undefined {
  const lines = yml.split('\n');
  const header = new RegExp(`^ {6}${input}:\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const indent = line.length - line.trimStart().length;
    // A line at or below the input's own indent ends the block.
    if (line.trim().length > 0 && indent <= 6) return undefined;
    const m = /^\s*default:\s*(.*)$/.exec(line);
    if (m) return m[1]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

/** The runner's own default log-signal mode, from its CLI option defaults. */
function readRunnerDefault(source: string): string | undefined {
  const m = /logMode:\s*'([A-Za-z]+)',/.exec(source);
  return m?.[1];
}

/**
 * Modes with a recorded full-benchmark measurement. Keeping the set here means
 * flipping the default to an unmeasured mode fails this test instead of being
 * published as fact.
 */
const MEASURED_MODES: Record<string, { topAt1: number; hits: number; cases: number; run: string }> =
  {
    count: { topAt1: 0.231, hits: 328, cases: 1422, run: '34604119657' },
    logicHttp: { topAt1: 0.473, hits: 673, cases: 1422, run: '34604105028' },
  };

describe('FSE26 reported configuration', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const runner = readFileSync(RUNNER_PATH, 'utf8');

  it('keeps the workflow free of a hardcoded log-mode default', () => {
    // An empty default is the whole point: the runner owns the choice, so the
    // published configuration cannot drift away from the measured one.
    expect(readInputDefault(workflow, 'log_mode')).toBe('');
  });

  it('ships a runner default that has a recorded full-benchmark measurement', () => {
    const mode = readRunnerDefault(runner);
    expect(mode).toBeDefined();
    expect(Object.keys(MEASURED_MODES)).toContain(mode);
  });

  it('ships the best-measured mode as the runner default', () => {
    const mode = readRunnerDefault(runner)!;
    const best = Object.entries(MEASURED_MODES).sort((a, b) => b[1].topAt1 - a[1].topAt1)[0]!;
    expect(mode).toBe(best[0]);
  });
});
