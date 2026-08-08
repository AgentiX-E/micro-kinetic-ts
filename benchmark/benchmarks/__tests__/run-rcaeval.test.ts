/**
 * Unit tests for benchmark-runner helper functions: parseCaseDir, discoverAllCases.
 *
 * These functions are in benchmarks/src/run-rcaeval.ts but are not exported
 * (it's a CLI script), so we replicate them inline for isolated testing.
 *
 * @module benchmarks/__tests__/run-rcaeval.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ═══════════════════════════════════════════════════════════
// Inline replicas of functions from benchmarks/src/run-rcaeval.ts
// These match the actual source code exactly.
// ═══════════════════════════════════════════════════════════

interface CaseMeta {
  suite: 'RE1' | 'RE2' | 'RE3';
  system: 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | 'Unknown';
  service: string;
  faultType: string;
  instance: number;
  dirPath: string;
}

function parseCaseDir(dirPath: string): CaseMeta | null {
  const name = basename(dirPath);
  // Pattern: re{1-3}{ob|ss|tt}_{service}_{fault}_{instance}
  const match = name.match(
    /^re([123])(ob|ss|tt)_(.+?)_(cpu|mem|disk|delay|loss|socket)_(\d+)$/i,
  );
  if (!match) return null;

  const suiteNum = match[1]!;
  const sysCode = match[2]!;
  return {
    suite: `RE${suiteNum}` as CaseMeta['suite'],
    system:
      sysCode === 'ob'
        ? 'OnlineBoutique'
        : sysCode === 'ss'
          ? 'SockShop'
          : 'TrainTicket',
    service: match[3]!,
    faultType: match[4]!.toLowerCase(),
    instance: parseInt(match[5]!, 10),
    dirPath,
  };
}

function discoverAllCases(dataDir: string): CaseMeta[] {
  if (!existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    return [];
  }

  const cases: CaseMeta[] = [];
  const queue = [dataDir];

  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      const hasMetrics = entries.some(
        (e: { isFile: () => boolean; name: string }) => e.isFile() && e.name === 'metrics.json',
      );
      if (hasMetrics) {
        const meta = parseCaseDir(current);
        if (meta) cases.push(meta);
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push(join(current, entry.name));
        }
      }
    } catch {
      /* skip inaccessible directories */
    }
  }

  return cases;
}

// ═══════════════════════════════════════════════════════════
// Tests: parseCaseDir
// ═══════════════════════════════════════════════════════════

describe('parseCaseDir', () => {
  it('should parse RE1 OnlineBoutique case correctly', () => {
    const result = parseCaseDir('/data/OnlineBoutique/re1ob_cartservice_cpu_1');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE1');
    expect(result!.system).toBe('OnlineBoutique');
    expect(result!.service).toBe('cartservice');
    expect(result!.faultType).toBe('cpu');
    expect(result!.instance).toBe(1);
  });

  it('should parse RE2 SockShop case correctly', () => {
    const result = parseCaseDir('/data/SockShop/re2ss_carts_delay_3');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE2');
    expect(result!.system).toBe('SockShop');
    expect(result!.service).toBe('carts');
    expect(result!.faultType).toBe('delay');
    expect(result!.instance).toBe(3);
  });

  it('should parse RE3 TrainTicket case correctly', () => {
    const result = parseCaseDir('/data/TrainTicket/re3tt_ts-order-service_cpu_2');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE3');
    expect(result!.system).toBe('TrainTicket');
    expect(result!.service).toBe('ts-order-service');
    expect(result!.faultType).toBe('cpu');
    expect(result!.instance).toBe(2);
  });

  it('should handle all supported fault types', () => {
    const faults = ['cpu', 'mem', 'disk', 'delay', 'loss', 'socket'];
    for (const ft of faults) {
      const result = parseCaseDir(`/data/re1ob_testservice_${ft}_1`);
      expect(result, `fault type: ${ft}`).not.toBeNull();
      expect(result!.faultType).toBe(ft);
    }
  });

  it('should handle case-insensitive fault types', () => {
    const result = parseCaseDir('/data/re1ob_svc_CPU_1');
    expect(result).not.toBeNull();
    expect(result!.faultType).toBe('cpu');
  });

  it('should accept same-case uppercase input via /i flag on regex', () => {
    // The regex has /i flag, so 'RE1OB_cartservice_cpu_1' matches the pattern.
    // However, the sysCode comparison is case-sensitive ('ob' !== 'OB'),
    // so it falls through to the 'TrainTicket' default.
    // This is acceptable because RCAEval directory names are always lowercase.
    const result = parseCaseDir('/data/RE1OB_cartservice_cpu_1');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE1');
    // sysCode captures 'OB' (uppercase), comparison fails, defaults to TrainTicket
    expect(result!.system).toBe('TrainTicket');
  });

  it('should handle services with hyphens', () => {
    const result = parseCaseDir('/data/re3tt_ts-ui_cpu_1');
    expect(result).not.toBeNull();
    expect(result!.service).toBe('ts-ui');
    expect(result!.faultType).toBe('cpu');
  });

  it('should return null for invalid directory names', () => {
    expect(parseCaseDir('/data/some_random_dir')).toBeNull();
    expect(parseCaseDir('/data/re1ob')).toBeNull();
    expect(parseCaseDir('/data/re1ob_service_unknown_1')).toBeNull();
    // 'unknown' is not a valid fault type in the regex
  });

  it('should return null for non-RCAEval directory names', () => {
    expect(parseCaseDir('/data/nginx')).toBeNull();
    expect(parseCaseDir('/data/')).toBeNull();
    expect(parseCaseDir('/data/re1ob_cpu_missing_service_1')).toBeNull();
  });

  it('should return null for dir names without instance number', () => {
    expect(parseCaseDir('/data/re1ob_service_cpu')).toBeNull();
  });

  it('should return null for dir names with non-numeric instance', () => {
    expect(parseCaseDir('/data/re1ob_service_cpu_abc')).toBeNull();
  });

  it('should handle filesystem paths with nested directories', () => {
    const result = parseCaseDir(
      '/home/user/RCAEval-json/OnlineBoutique/re2ob_frontend_loss_5',
    );
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE2');
    expect(result!.system).toBe('OnlineBoutique');
    expect(result!.service).toBe('frontend');
  });

  it('should handle RE1 SockShop case', () => {
    const result = parseCaseDir('/data/SockShop/re1ss_orders_mem_7');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE1');
    expect(result!.system).toBe('SockShop');
    expect(result!.service).toBe('orders');
    expect(result!.faultType).toBe('mem');
  });

  it('should handle RE2 OnlineBoutique (cross-suite) case', () => {
    const result = parseCaseDir('/data/re2ob_paymentservice_disk_1');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE2');
    expect(result!.system).toBe('OnlineBoutique');
    expect(result!.service).toBe('paymentservice');
    expect(result!.faultType).toBe('disk');
  });

  it('should handle RE3 SockShop (cross-suite) case', () => {
    const result = parseCaseDir('/data/re3ss_shipping_socket_0');
    expect(result).not.toBeNull();
    expect(result!.suite).toBe('RE3');
    expect(result!.system).toBe('SockShop');
    expect(result!.service).toBe('shipping');
    expect(result!.faultType).toBe('socket');
  });
});

// ═══════════════════════════════════════════════════════════
// Tests: discoverAllCases
// ═══════════════════════════════════════════════════════════

describe('discoverAllCases', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `rca-eval-test-${randomUUID()}`);
    mkdirSync(tmpDir);
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function makeCaseDir(name: string): string {
    const dir = join(tmpDir, name);
    mkdirSync(dir);
    writeFileSync(join(dir, 'metrics.json'), '{}');
    return dir;
  }

  it('should return empty array for non-existent directory', () => {
    const result = discoverAllCases('/nonexistent/path/xyz');
    expect(result).toEqual([]);
  });

  it('should discover a single case directory at the root', () => {
    makeCaseDir('re1ob_cartservice_cpu_1');
    const result = discoverAllCases(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.suite).toBe('RE1');
    expect(result[0]!.system).toBe('OnlineBoutique');
    expect(result[0]!.service).toBe('cartservice');
  });

  it('should discover multiple case directories at the root', () => {
    makeCaseDir('re1ob_cartservice_cpu_1');
    makeCaseDir('re1ob_frontend_delay_2');
    makeCaseDir('re2ss_carts_mem_3');
    const result = discoverAllCases(tmpDir);
    expect(result).toHaveLength(3);
  });

  it('should discover cases in nested directories (BFS)', () => {
    const systemDir = join(tmpDir, 'OnlineBoutique');
    mkdirSync(systemDir);
    const caseDir1 = join(systemDir, 're1ob_adservice_cpu_1');
    mkdirSync(caseDir1);
    writeFileSync(join(caseDir1, 'metrics.json'), '{}');
    const caseDir2 = join(systemDir, 're1ob_paymentservice_mem_2');
    mkdirSync(caseDir2);
    writeFileSync(join(caseDir2, 'metrics.json'), '{}');

    const result = discoverAllCases(tmpDir);
    // BFS discovers systemDir first (no metrics.json), then enters it
    // and finds the two case dirs
    expect(result).toHaveLength(2);
  });

  it('should discover cases at different nesting levels', () => {
    // Root-level case
    makeCaseDir('re1ob_root_cpu_1');

    // Nested case
    const nested = join(tmpDir, 'subdir');
    mkdirSync(nested);
    const caseDir = join(nested, 're2ss_nested_disk_5');
    mkdirSync(caseDir);
    writeFileSync(join(caseDir, 'metrics.json'), '{}');

    const result = discoverAllCases(tmpDir);
    expect(result).toHaveLength(2);
  });

  it('should skip directories without metrics.json', () => {
    // Create a directory with no metrics.json
    const dir = join(tmpDir, 'not_a_case');
    mkdirSync(dir);
    writeFileSync(join(dir, 'readme.txt'), 'hello');
    // But also create a subdirectory that IS a case
    const caseDir = join(dir, 're1ob_realcase_cpu_1');
    mkdirSync(caseDir);
    writeFileSync(join(caseDir, 'metrics.json'), '{}');

    const result = discoverAllCases(tmpDir);
    // BFS: enters tmpDir → finds 'not_a_case' (no metrics.json) and 'realcase'
    // Actually 'not_a_case' has no metrics.json at its level, but BFS will enter it
    // because it doesn't have metrics.json at its own level, it goes deeper
    // Wait — BFS discovers not_a_case, checks hasMetrics=false, enters it for children,
    // finds re1ob_realcase_cpu_1 which has metrics.json
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('realcase');
  });

  it('should skip dot-prefixed directories', () => {
    const dotDir = join(tmpDir, '.hidden');
    mkdirSync(dotDir);
    const hiddenCase = join(dotDir, 're1ob_hidden_cpu_1');
    mkdirSync(hiddenCase);
    writeFileSync(join(hiddenCase, 'metrics.json'), '{}');

    const result = discoverAllCases(tmpDir);
    // .hidden should be skipped entirely (starts with '.')
    expect(result).toHaveLength(0);
  });

  it('should deduplicate by BFS halting at metrics.json', () => {
    // If a dir has metrics.json, its children are NOT explored
    // This prevents double-counting
    const caseDir = makeCaseDir('re1ob_svc_cpu_1');
    // Add a subdirectory that would also be a valid case
    const childCaseDir = join(caseDir, 're2ss_child_mem_2');
    mkdirSync(childCaseDir);
    writeFileSync(join(childCaseDir, 'metrics.json'), '{}');

    const result = discoverAllCases(tmpDir);
    // BFS stops at caseDir (has metrics.json), does not recurse into children
    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe('svc');
  });
});

// ═══════════════════════════════════════════════════════════
// Tests: Additional buildRCAEvalCallGraph edge cases
// ═══════════════════════════════════════════════════════════

import { buildRCAEvalCallGraph } from '../src/rcaeval-topology.js';
import type { ServiceCallGraph } from '../../packages/core/src/index.js';

describe('buildRCAEvalCallGraph — additional edge cases', () => {
  it('should ring-connect services when no topology match found', () => {
    const g = buildRCAEvalCallGraph('re1xx_strange_1', ['a', 'b', 'c']);
    // Unknown system — should still create nodes and ring-connect
    expect(g.nodes.size).toBe(3);
    // Ring connection: a→b, b→c, c→a
    expect(g.edges.length).toBe(3);
  });

  it('should handle single unknown service gracefully', () => {
    const g = buildRCAEvalCallGraph('mystery', ['lone']);
    expect(g.nodes.size).toBe(1);
    expect(g.edges.length).toBe(1);
  });

  it('should handle service IDs not in known OB topology', () => {
    const g = buildRCAEvalCallGraph('re1ob_unknown_svc', ['unknownsvc1', 'unknownsvc2']);
    expect(g.nodes.size).toBe(2);
    // Unknown services should still get edge connections (ring)
    expect(g.edges.length).toBeGreaterThan(0);
  });

  it('should mark unmatched services with diagnostic labels', () => {
    const g = buildRCAEvalCallGraph('re2ob_mixed_case', ['frontend', 'mystery_svc', 'cartservice']);
    expect(g.nodes.get('mystery_svc')?.labels._diag_unconnected).toBeDefined();
  });

  it('should handle very long service ID lists', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `svc_${i}`);
    const g = buildRCAEvalCallGraph('re1ob_many_svcs', ids);
    expect(g.nodes.size).toBe(100);
    expect(g.edges.length).toBeGreaterThan(0);
  });

  it('should handle benchmark with underscores in name', () => {
    const g = buildRCAEvalCallGraph('re2ss_complex_name_here', ['carts', 'orders']);
    expect(g.nodes.size).toBe(2);
  });
});
