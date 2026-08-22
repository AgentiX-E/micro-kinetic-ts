import { describe, it, expect } from 'vitest';

describe('Barrel exports (index.ts)', () => {
  it('should export createDefaultContainer', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.createDefaultContainer).toBeDefined();
    expect(typeof mod.createDefaultContainer).toBe('function');
  });

  it('should export DEFAULTS', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.DEFAULTS).toBeDefined();
  });

  it('should export RCAPipeline', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.RCAPipeline).toBeDefined();
  });

  it('should export registerRCAPipeline', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.registerRCAPipeline).toBeDefined();
  });

  it('should export DEFAULT_PIPELINE_CONFIG', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.DEFAULT_PIPELINE_CONFIG).toBeDefined();
  });

  it('should export createPipeline', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.createPipeline).toBeDefined();
  });

  it('should export scenario pipeline creators', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.createAcutePipeline).toBeDefined();
    expect(mod.createChronicPipeline).toBeDefined();
    expect(mod.createAlertStormPipeline).toBeDefined();
    expect(mod.createFullPipeline).toBeDefined();
  });

  it('should export formatters', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.formatRCATable).toBeDefined();
    expect(mod.formatDenoiseTable).toBeDefined();
    expect(mod.formatBenchmarkTable).toBeDefined();
    expect(mod.formatJson).toBeDefined();
  });

  it('should export CLI controllers', async () => {
    const mod = await import('../../src/index.js');
    expect(mod.createProgram).toBeDefined();
    expect(mod.runCli).toBeDefined();
  });

  it('should re-export sub-package content', async () => {
    const mod = await import('../../src/index.js');
    // Should re-export CouplingSparsityAnalyzer from noise
    expect(mod.CouplingSparsityAnalyzer).toBeDefined();
    // Should re-export HierarchyBuilder from scaling
    expect(mod.HierarchyBuilder).toBeDefined();
    // Should re-export WaveCascadeModel from wave
    expect(mod.WaveCascadeModel).toBeDefined();
  });
});
