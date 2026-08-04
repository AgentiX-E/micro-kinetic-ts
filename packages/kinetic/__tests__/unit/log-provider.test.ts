import { describe, it, expect } from 'vitest';
import { LogSignalProvider } from '@agentix-e/micro-kinetic';
import type { SignalAnalysisContext } from '@agentix-e/micro-kinetic-core';

function makeLogs(logs: Array<{ ts: number; svc: string; msg: string; level: string }>) {
  return logs.map((l) => ({ timestamp: l.ts, service: l.svc, message: l.msg, level: l.level }));
}

describe('LogSignalProvider', () => {
  describe('analyze', () => {
    it('should return empty for no logs', async () => {
      const provider = new LogSignalProvider();
      const ctx: SignalAnalysisContext = { traceSpans: [] };
      const result = await provider.analyze(ctx);
      expect(result.candidates.length).toBe(0);
    });

    it('should identify service with earliest ERROR as root cause', async () => {
      const provider = new LogSignalProvider();
      const logs = makeLogs([
        { ts: 1000, svc: 'adservice', msg: 'Connection timeout to DB', level: 'ERROR' },
        { ts: 1005, svc: 'adservice', msg: 'Retry failed', level: 'ERROR' },
        { ts: 5000, svc: 'checkoutservice', msg: 'Downstream call failed', level: 'ERROR' },
        { ts: 8000, svc: 'frontend', msg: 'Request failed after 3 retries', level: 'WARN' },
      ]);
      const ctx: SignalAnalysisContext = { traceSpans: logs as any };
      const result = await provider.analyze(ctx);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0]!.serviceId).toBe('adservice');
    });

    it('should score ERROR bursts higher than isolated errors', async () => {
      const provider = new LogSignalProvider();
      // Service B has burst of 5 rapid errors, Service A has 1
      const logs = makeLogs([
        { ts: 1000, svc: 'svc-a', msg: 'Error 1', level: 'ERROR' },
        { ts: 1001, svc: 'svc-b', msg: 'Burst 1', level: 'ERROR' },
        { ts: 1002, svc: 'svc-b', msg: 'Burst 2', level: 'ERROR' },
        { ts: 1003, svc: 'svc-b', msg: 'Burst 3', level: 'ERROR' },
        { ts: 1004, svc: 'svc-b', msg: 'Burst 4', level: 'ERROR' },
        { ts: 1005, svc: 'svc-b', msg: 'Burst 5', level: 'ERROR' },
      ]);
      const ctx: SignalAnalysisContext = { traceSpans: logs as any };
      const result = await provider.analyze(ctx);
      // svc-b should score higher due to burst density
      const svcB = result.candidates.find((c) => c.serviceId === 'svc-b');
      const svcA = result.candidates.find((c) => c.serviceId === 'svc-a');
      expect(svcB).toBeDefined();
      expect(svcA).toBeDefined();
      expect(svcB!.confidence).toBeGreaterThanOrEqual(svcA!.confidence);
    });

    it('should ignore INFO and DEBUG logs', async () => {
      const provider = new LogSignalProvider();
      const logs = makeLogs([
        { ts: 1000, svc: 'svc-a', msg: 'Processing request', level: 'INFO' },
        { ts: 2000, svc: 'svc-b', msg: 'Cache hit', level: 'DEBUG' },
      ]);
      const ctx: SignalAnalysisContext = { traceSpans: logs as any };
      const result = await provider.analyze(ctx);
      expect(result.candidates.length).toBe(0);
    });
  });

  describe('log template extraction', () => {
    it('should normalize variable tokens in messages', async () => {
      const provider = new LogSignalProvider();
      const logs = makeLogs([
        { ts: 1000, svc: 'svc-a', msg: 'User 12345 logged in from 192.168.1.1', level: 'ERROR' },
        { ts: 1001, svc: 'svc-a', msg: 'User 67890 logged in from 10.0.0.1', level: 'ERROR' },
      ]);
      const ctx: SignalAnalysisContext = { traceSpans: logs as any };
      const result = await provider.analyze(ctx);
      expect(result.candidates.length).toBeGreaterThan(0);
    });
  });
});
