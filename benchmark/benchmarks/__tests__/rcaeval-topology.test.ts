/**
 * Unit tests for RCAEval topology builder (identifyBenchmarkSystem).
 *
 * Verifies correct system identification for all 9 suite-system combinations
 * (RE1×{ob,ss,tt}, RE2×{ob,ss,tt}, RE3×{ob,ss,tt}).
 *
 * NOTE: This test file lives in benchmarks/__tests__/ because the topology
 * builder is part of the benchmarks package, not the kinetic package.
 *
 * @module benchmarks/__tests__/rcaeval-topology.test
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildRCAEvalCallGraph,
  formatTopologyDiagnostic,
  identifyBenchmarkSystem,
  initRCAEvalTopology,
  TOPOLOGY_DIAG_KEYS,
} from '../src/rcaeval-topology.js';
import { stripComments } from './helpers/source-text.js';

// ── Initialize YAML topology registry once before all tests ──

beforeAll(async () => {
  await initRCAEvalTopology();
});

// ── System Identification (full 3×3 matrix) ──────────────

describe('buildRCAEvalCallGraph — System Identification', () => {
  // RE1 cases
  it('re1ob_* → OnlineBoutique', () => {
    const g = buildRCAEvalCallGraph('re1ob_adservice_cpu_1', [
      'adservice',
      'frontend',
      'cartservice',
    ]);
    expect(g.nodes.get('adservice')?.labels._diag_system).toBe('OnlineBoutique');
    expect(g.edges.length).toBeGreaterThan(0);
  });

  it('re1ss_* → SockShop', () => {
    const g = buildRCAEvalCallGraph('re1ss_carts_cpu_1', ['front-end', 'carts']);
    expect(g.nodes.get('carts')?.labels._diag_system).toBe('SockShop');
  });

  it('re1tt_* → TrainTicket', () => {
    const g = buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);
    expect(g.nodes.get('ts-ui')?.labels._diag_system).toBe('TrainTicket');
  });

  // RE2 cases (was bug: forced to SockShop)
  it('re2ob_* → OnlineBoutique (was forced to SockShop before fix)', () => {
    const g = buildRCAEvalCallGraph('re2ob_cartservice_cpu_1', [
      'frontend',
      'cartservice',
      'checkoutservice',
    ]);
    expect(g.nodes.get('cartservice')?.labels._diag_system).toBe('OnlineBoutique');
    // Verify OB-specific edges exist
    const hasCheckoutCart = g.edges.some(
      (e) => e.from === 'checkoutservice' && e.to === 'cartservice',
    );
    expect(hasCheckoutCart).toBe(true);
  });

  it('re2ss_* → SockShop', () => {
    const g = buildRCAEvalCallGraph('re2ss_orders_delay_1', ['orders', 'payment', 'shipping']);
    expect(g.nodes.get('orders')?.labels._diag_system).toBe('SockShop');
  });

  it('re2tt_* → TrainTicket', () => {
    const g = buildRCAEvalCallGraph('re2tt_ts-order-service_mem_1', [
      'ts-order-service',
      'ts-payment-service',
    ]);
    expect(g.nodes.get('ts-order-service')?.labels._diag_system).toBe('TrainTicket');
  });

  // RE3 cases (was bug: forced to TrainTicket)
  it('re3ob_* → OnlineBoutique (was forced to TrainTicket before fix)', () => {
    const g = buildRCAEvalCallGraph('re3ob_paymentservice_mem_1', [
      'checkoutservice',
      'paymentservice',
    ]);
    expect(g.nodes.get('checkoutservice')?.labels._diag_system).toBe('OnlineBoutique');
  });

  it('re3ss_* → SockShop', () => {
    const g = buildRCAEvalCallGraph('re3ss_catalogue_mem_1', ['catalogue', 'catalogue-db']);
    expect(g.nodes.get('catalogue')?.labels._diag_system).toBe('SockShop');
  });

  it('re3tt_* → TrainTicket', () => {
    const g = buildRCAEvalCallGraph('re3tt_ts-preserve-service_disk_1', [
      'ts-preserve-service',
      'ts-seat-service',
    ]);
    expect(g.nodes.get('ts-seat-service')?.labels._diag_system).toBe('TrainTicket');
  });
});

// ── Fallback heuristic for non-standard naming ────────────

describe('identifyBenchmarkSystem — non-standard case ids', () => {
  // The primary pattern is `re{N}{sys}…`. Case ids that do not follow it fall
  // back to searching for the system code as an underscore-delimited infix,
  // which is how the vendor-supplied dumps are named.
  it('recognises an _ob_ infix as OnlineBoutique', () => {
    expect(identifyBenchmarkSystem('case_ob_adservice_cpu_1')).toBe('OnlineBoutique');
  });

  it('recognises an _ss_ infix as SockShop', () => {
    expect(identifyBenchmarkSystem('case_ss_orders_delay_1')).toBe('SockShop');
  });

  it('recognises a _tt_ infix as TrainTicket', () => {
    expect(identifyBenchmarkSystem('case_tt_ts-ui_cpu_1')).toBe('TrainTicket');
  });

  it('returns null when no system code is present at all', () => {
    expect(identifyBenchmarkSystem('mystery_case_1')).toBeNull();
  });
});

// ── Edge cases ────────────────────────────────────────────

describe('buildRCAEvalCallGraph — Edge Cases', () => {
  it('should ring-connect unknown systems', () => {
    const g = buildRCAEvalCallGraph('unknown_case_1', ['svc_a', 'svc_b', 'svc_c']);
    expect(g.edges.length).toBe(3);
  });

  it('should handle no-match benchmark with single service', () => {
    const g = buildRCAEvalCallGraph('mystery_system', ['lone_svc']);
    expect(g.nodes.size).toBe(1);
    expect(g.edges.length).toBe(1);
  });

  it('should handle empty service list', () => {
    const g = buildRCAEvalCallGraph('re1ob_empty', []);
    expect(g.nodes.size).toBe(0);
    expect(g.edges.length).toBe(0);
  });

  it('should set correct diagnostic labels', () => {
    const g = buildRCAEvalCallGraph('re2ob_diag_test', ['frontend', 'cartservice']);
    for (const node of g.nodes.values()) {
      expect(node.labels._diag_system).toBe('OnlineBoutique');
      expect(node.labels._diag_matched).toBeDefined();
    }
  });
});

// ── The `[topo]` diagnostic: one declaration, one renderer ──────────────

describe('formatTopologyDiagnostic — a complete line, or no line', () => {
  const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

  it('renders every field it claims, and never the string "undefined"', () => {
    // A graph built through the PUBLIC entry, so the labels are the ones a real run carries.
    const g = buildRCAEvalCallGraph('re2ob_diag_render', ['frontend', 'cartservice']);
    const labels = g.nodes.values().next().value?.labels;
    const line = formatTopologyDiagnostic(labels);
    expect(line).toBeDefined();
    expect(line).not.toContain('undefined');
    // The four readings, in the order the line prints them, and `svcs` is the one that was unset for the whole
    // life of this diagnostic because the renderer named a key no writer wrote.
    expect(line).toMatch(/^ {2}\[topo\] system=\S+, edges=\S+, svcs=\d+, unconnected=\S+$/);
    expect(line).toContain('svcs=2');
  });

  it('refuses to render a partial bag, including the one that shipped', () => {
    // The three shapes a reader actually meets, and the fourth is the defect itself: a bag that carries
    // `_diag_svc_matched` — a name NO writer has ever set — must render nothing rather than `svcs=undefined`,
    // because `undefined` in that position reads as a fact about the corpus.
    expect(formatTopologyDiagnostic(undefined)).toBeUndefined();
    expect(formatTopologyDiagnostic({})).toBeUndefined();
    const complete = {
      [TOPOLOGY_DIAG_KEYS.system]: 'OnlineBoutique',
      [TOPOLOGY_DIAG_KEYS.matched]: '13 exact',
      [TOPOLOGY_DIAG_KEYS.services]: '11',
      [TOPOLOGY_DIAG_KEYS.unconnected]: '3',
    };
    expect(formatTopologyDiagnostic(complete)).toContain('svcs=11');
    // Every field the LINE prints, removed one at a time. The first four keys of the declaration are NOT that
    // set — `case` is annotated but never printed — so the loop names the rendered four explicitly rather than
    // slicing a list whose order happens to start with them. The bag is rebuilt without the key rather than
    // `delete`d, because a `Record<string, string>` has no optional properties to delete.
    const without = (omit: string, from: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(from).filter(([key]) => key !== omit));
    for (const missing of [
      TOPOLOGY_DIAG_KEYS.system,
      TOPOLOGY_DIAG_KEYS.matched,
      TOPOLOGY_DIAG_KEYS.services,
      TOPOLOGY_DIAG_KEYS.unconnected,
    ]) {
      expect(
        formatTopologyDiagnostic(without(missing, complete)),
        `${missing} removed`,
      ).toBeUndefined();
    }
    // The historical misspelling, spelled out: present, and still not enough.
    const historical = {
      ...without(TOPOLOGY_DIAG_KEYS.services, complete),
      _diag_svc_matched: '11',
    };
    expect(formatTopologyDiagnostic(historical)).toBeUndefined();
  });

  it('declares every `_diag_` literal that appears anywhere under `benchmarks/src`', () => {
    // The class-closing census. `labels` is a `Record<string, string>`, so a reader may name a key no writer
    // sets and `tsc` will not object — which is exactly how the `svcs` reading was unset for a release. This
    // walks the source instead: the set of literals in the tree must EQUAL the set the one declaration holds, in
    // both directions, so an invented name fails here and an orphaned entry fails here too.
    //
    // ⚠️ COMMENTS ARE STRIPPED FIRST, and that is not tidiness. The docstring on `TOPOLOGY_DIAG_KEYS` explains
    // the defect by NAMING the misspelled key, so a census over raw text is satisfied-or-broken by the prose
    // explaining it — which is what the first run of this very test did. It is the repository's fourth medium
    // for one law: a rule that reads the repository's text must be written around the fact that explaining it
    // reproduces its subject.
    const walk = (dir: string): string[] => {
      const found: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...walk(full));
        else if (entry.name.endsWith('.ts')) found.push(full);
      }
      return found;
    };
    const literals = new Set<string>();
    for (const file of walk(SRC_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const match of code.matchAll(/_diag_[a-z_]+/g)) {
        literals.add(match[0]);
      }
    }
    expect([...literals].sort()).toEqual(Object.values(TOPOLOGY_DIAG_KEYS).sort());
    // And the census is not vacuous: an empty walk would make two empty sets equal.
    expect(literals.size).toBeGreaterThan(5);
  });
});
