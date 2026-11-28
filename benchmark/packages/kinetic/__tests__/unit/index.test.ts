import { beforeAll, describe, expect, it } from 'vitest';

/**
 * The kinetic barrel's exports, asserted once the graph behind it has been loaded.
 *
 * **The import is done ONCE, in `beforeAll`, and that is a repair rather than a tidiness.** It was
 * `await import('../../src/index.js')` inside every `it` — ten times — on the theory that a cached module makes
 * the repeats free. They are not free under a full-suite run: this package's barrel reaches every sibling
 * package plus the benchmark loaders, and on a two-core box with 186 other files in flight the cold import
 * exceeded the 5 s default for the first several tests, which then reported timeouts on assertions that had
 * nothing to do with time. A suite that goes red for the machine rather than for the code trains its reader to
 * ignore red, which is a worse defect than the one it reports.
 *
 * The population of assertions is UNCHANGED — same ten checks, same names, same order — and every one of them
 * is a real export the barrel does or does not carry. What moved is when the module graph is evaluated.
 */
let mod: typeof import('../../src/index.js');

// The timeout is on the HOOK, not on an assertion, and it is 30 s for a measured reason: this barrel reaches every
// sibling package plus the benchmark loaders, the cold evaluation is ~0.7 s alone and exceeds 5 s while 186 other
// files are being transformed on two cores. Nothing here is a timing claim about the code — the assertions below
// are all `toBeDefined()` — so a machine-speed timeout on the one step that is machine-speed belongs on the hook.
beforeAll(async () => {
  mod = await import('../../src/index.js');
}, 30_000);

describe('Barrel exports (index.ts)', () => {
  it('should export createDefaultContainer', () => {
    expect(mod.createDefaultContainer).toBeDefined();
    expect(typeof mod.createDefaultContainer).toBe('function');
  });

  it('should export DEFAULTS', () => {
    expect(mod.DEFAULTS).toBeDefined();
  });

  it('should export RCAPipeline', () => {
    expect(mod.RCAPipeline).toBeDefined();
  });

  it('should export registerRCAPipeline', () => {
    expect(mod.registerRCAPipeline).toBeDefined();
  });

  it('should export DEFAULT_PIPELINE_CONFIG', () => {
    expect(mod.DEFAULT_PIPELINE_CONFIG).toBeDefined();
  });

  it('should export createPipeline', () => {
    expect(mod.createPipeline).toBeDefined();
  });

  it('should export scenario pipeline creators', () => {
    expect(mod.createAcutePipeline).toBeDefined();
    expect(mod.createChronicPipeline).toBeDefined();
    expect(mod.createAlertStormPipeline).toBeDefined();
    expect(mod.createFullPipeline).toBeDefined();
  });

  it('should export formatters', () => {
    expect(mod.formatRCATable).toBeDefined();
    expect(mod.formatDenoiseTable).toBeDefined();
    expect(mod.formatBenchmarkTable).toBeDefined();
    expect(mod.formatJson).toBeDefined();
  });

  it('should export CLI controllers', () => {
    expect(mod.createProgram).toBeDefined();
    expect(mod.runCli).toBeDefined();
  });

  it('should re-export sub-package content', () => {
    // Should re-export CouplingSparsityAnalyzer from noise
    expect(mod.CouplingSparsityAnalyzer).toBeDefined();
    // Should re-export HierarchyBuilder from scaling
    expect(mod.HierarchyBuilder).toBeDefined();
    // Should re-export WaveCascadeModel from wave
    expect(mod.WaveCascadeModel).toBeDefined();
  });
});
