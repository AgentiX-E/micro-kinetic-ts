/**
 * The reach table and the replay audit — the two numbers that decide whether the closure axis is adoptable.
 *
 * The fixtures here are labels and cache keys shaped like the published ones; the counts asserted are properties
 * of that shape (a synonym list, a second key convention, an argument-free use), not copies of corpus numbers.
 * The corpus-wide figures this module produced on 2026-11-26 — 472/2 478 reachable, 0/754 cases in full,
 * 2 379/2 478 checkable against the competitor's own cache — are in `docs/cloud-opsbench-connection.md`.
 */

import { describe, expect, it } from 'vitest';

import type { ClosureLabel, ClosureMilestone, ClosureToolUse } from '../src/closure-labels.js';
import type { CloudOpsCase } from '../src/cloudopsbench-case.js';
import {
  cacheConsistency,
  canProduce,
  CLOUDOPS_TOOLS,
  evidenceReach,
  METRIC_LOG_EDGE_SURFACE,
  readToolCache,
  summariseCases,
} from '../src/cloudopsbench-census.js';

/** One admissible use, spelled the way a label spells it. */
function use(
  tool: string,
  args: Record<string, string | string[]> = {},
  patterns: string[] = [],
): ClosureToolUse {
  return {
    tool,
    argumentKeys: Object.keys(args).sort(),
    arguments: Object.fromEntries(
      Object.entries(args).map(([key, value]) => [
        key,
        (Array.isArray(value) ? value : [value]).map((one) => one.toLowerCase()),
      ]),
    ),
    evidencePatterns: patterns,
  };
}

/** One milestone. */
const milestone = (id: string, uses: ClosureToolUse[]): ClosureMilestone => ({
  id,
  role: `${id}_role`,
  uses,
});

/** One label. */
function label(caseId: string, faultObject: string, milestones: ClosureMilestone[]): ClosureLabel {
  return {
    caseId,
    namespace: faultObject.split('/')[0] ?? '',
    faultTaxonomy: 'Performance_Fault',
    faultObject,
    rootCause: 'pod_cpu_overload',
    milestones,
  };
}

describe('the twelve tools the corpus names', () => {
  it('is pinned, unique, and covered exactly by the reach table', () => {
    expect(CLOUDOPS_TOOLS).toHaveLength(12);
    expect(new Set(CLOUDOPS_TOOLS).size).toBe(12);
    // A thirteenth tool would otherwise be reachable by default, which is the one direction a census must not err.
    expect(METRIC_LOG_EDGE_SURFACE.map((one) => one.tool).sort()).toEqual(
      [...CLOUDOPS_TOOLS].sort(),
    );
  });

  it('declares exactly four of them producible, which is the finding in one line', () => {
    expect(
      METRIC_LOG_EDGE_SURFACE.filter((one) => one.producible)
        .map((one) => one.tool)
        .sort(),
    ).toEqual(['GetErrorLogs', 'GetRecentLogs', 'GetResources', 'GetServiceDependencies']);
  });

  it('states a reason on every row, because a bare boolean is a claim nobody can check', () => {
    for (const row of METRIC_LOG_EDGE_SURFACE) expect(row.why.length).toBeGreaterThan(20);
  });
});

describe('what the arm can produce', () => {
  it('can produce a log read and a dependency read', () => {
    expect(
      canProduce(use('GetErrorLogs', { namespace: 'boutique', service_name: 'adservice' })),
    ).toBe(true);
    expect(canProduce(use('GetRecentLogs', { service_name: 'adservice' }))).toBe(true);
    expect(canProduce(use('GetServiceDependencies', {}))).toBe(true);
  });

  it('can produce a service listing but not an object listing', () => {
    expect(
      canProduce(
        use('GetResources', { resource_type: ['services', 'svc'], namespace: 'boutique' }),
      ),
    ).toBe(true);
    // Pods, deployments, endpoints, secrets, volumes: the arm lists none of them, whatever the argument says.
    expect(canProduce(use('GetResources', { resource_type: 'pods' }))).toBe(false);
    // A NAMED service listing asks for one object where `services` prints a directory of names.
    expect(canProduce(use('GetResources', { resource_type: 'services', name: 'adservice' }))).toBe(
      false,
    );
    // A resource read that names no kind at all cannot be produced by anything.
    expect(canProduce(use('GetResources', { name: 'adservice' }))).toBe(false);
  });

  it('cannot produce the seven channels it does not read', () => {
    for (const tool of [
      'DescribeResource',
      'CheckServiceConnectivity',
      'GetAppYAML',
      'GetClusterConfiguration',
      'GetAlerts',
      'ListCodeFiles',
      'GetSourceCode',
      'CheckNodeServiceStatus',
    ]) {
      expect(canProduce(use(tool, {}))).toBe(false);
    }
  });

  it('reads an unknown tool as unreachable rather than as reachable', () => {
    expect(canProduce(use('GetEverything', {}))).toBe(false);
  });

  it('takes the surface as a parameter, so a second arm is a second table', () => {
    const everything = CLOUDOPS_TOOLS.map((tool) => ({
      tool,
      producible: true,
      why: 'hypothetical arm',
    }));
    expect(canProduce(use('GetSourceCode', { app_name: 'adservice' }), everything)).toBe(true);
    // The argument rule survives the table: a hypothetical arm that can read objects still cannot be credited for
    // a service listing it never prints.
    expect(canProduce(use('GetResources', { resource_type: 'pods' }), everything)).toBe(false);
  });
});

describe('the reach census', () => {
  const mixed = label('boutique/performance/1', 'app/adservice', [
    milestone('M0', [use('GetErrorLogs', { service_name: 'adservice' })]),
    milestone('M1', [
      use('GetResources', { resource_type: 'pods' }),
      use('GetResources', { resource_type: 'pods', name: 'adservice-1' }),
    ]),
  ]);
  const nothing = label('boutique/startup/1', 'app/adservice', [
    milestone('M0', [use('GetAppYAML', { app_name: 'adservice' })]),
  ]);
  const everything = label('boutique/performance/2', 'app/adservice', [
    milestone('M0', [use('GetServiceDependencies', { service_name: 'adservice' })]),
    milestone('M1', [use('GetRecentLogs', { service_name: 'adservice' })]),
  ]);

  it('counts reachable milestones and separates all / some / none by case', () => {
    const census = evidenceReach([mixed, nothing, everything]);
    expect(census.cases).toBe(3);
    expect(census.milestones).toBe(5);
    // M0 of `mixed`, both of `everything`: the pod listings and the manifest are outside the surface.
    expect(census.reachable).toBe(3);
    expect(census.casesAll).toBe(1);
    expect(census.casesSome).toBe(1);
    expect(census.casesNone).toBe(1);
  });

  it('reports reachable uses by tool, most frequent first', () => {
    const census = evidenceReach([
      label('a/b/1', 'app/x', [
        milestone('M0', [use('GetErrorLogs', { service_name: 'x' })]),
        milestone('M1', [use('GetErrorLogs', { service_name: 'x' }), use('GetRecentLogs', {})]),
      ]),
    ]);
    expect(census.byTool).toEqual([
      ['GetErrorLogs', 2],
      ['GetRecentLogs', 1],
    ]);
  });

  it('is a census of zero cases without claiming a rate', () => {
    expect(evidenceReach([])).toEqual({
      cases: 0,
      milestones: 0,
      reachable: 0,
      casesAll: 0,
      casesSome: 0,
      casesNone: 0,
      byTool: [],
    });
  });
});

describe('one tool_cache.json', () => {
  it('reads the three key conventions the corpus writes', () => {
    const cache = readToolCache(
      JSON.stringify({
        collection_timestamp: '2026-05-18T21:56:02',
        'GetResources:{"resource_type":"pods","name":"","namespace":"boutique"}':
          'NAME  READY  STATUS',
        GetClusterConfiguration: { nodes: [] },
        'CheckServiceConnectivity-boutique-redis-cart-6379': 'Connection Succeeded',
        'GetSourceCode:not-json': 'unreadable',
      }),
    );
    expect(cache.entries).toHaveLength(1);
    expect(cache.entries[0]).toMatchObject({ tool: 'GetResources' });
    // Two second-convention names, one unreadable argument blob — and the stamp is not a read at all.
    expect(cache.bare).toEqual(['CheckServiceConnectivity', 'GetClusterConfiguration']);
    expect(cache.unreadable).toBe(1);
  });

  it('refuses a file it cannot read without throwing', () => {
    expect(readToolCache('not json')).toEqual({ entries: [], bare: [], unreadable: 1 });
    expect(readToolCache('[]')).toEqual({ entries: [], bare: [], unreadable: 1 });
  });

  it('counts a bare key with no tool name rather than inventing one', () => {
    const cache = readToolCache(JSON.stringify({ '-leading-dash': 'x', 'GetAlerts:[]': 'y' }));
    expect(cache.bare).toEqual([]);
    expect(cache.unreadable).toBe(2);
  });
});

describe("the audit of the competitor's own replay surface", () => {
  const first = label('boutique/performance/1', 'app/adservice', [
    milestone('M0', [use('GetErrorLogs', { namespace: 'boutique', service_name: 'adservice' })]),
    milestone('M1', [use('GetResources', { resource_type: ['pods', 'pod'] })]),
    milestone('M2', [use('GetAlerts', {})]),
  ]);
  const second = label('boutique/performance/2', 'app/adservice', [
    milestone('M0', [use('GetAlerts', {})]),
  ]);

  it('credits a call it can find, including through a synonym list', () => {
    const cache = readToolCache(
      JSON.stringify({
        'GetErrorLogs:{"namespace":"boutique","service_name":"adservice"}': 'OOMKilled',
        'GetResources:{"resource_type":"pod","namespace":"boutique"}': 'NAME  READY',
      }),
    );
    const audit = cacheConsistency([first], new Map([['boutique/performance/1', cache]]));
    // M0 and M1 close; M2's argument-free GetAlerts has no entry in this cache.
    expect(audit).toMatchObject({
      cases: 1,
      uses: 3,
      satisfied: 2,
      milestones: 3,
      milestonesSatisfied: 2,
      casesAll: 0,
      casesSome: 1,
      casesNone: 0,
    });
    expect(audit.missingByTool).toEqual([['GetAlerts', 1]]);
  });

  it('credits a second-convention key only for an argument-free use', () => {
    const bare = readToolCache(
      JSON.stringify({ GetAlerts: 'two alerts', 'GetErrorLogs-boutique-adservice': 'x' }),
    );
    const audit = cacheConsistency([first], new Map([['boutique/performance/1', bare]]));
    // GetAlerts has no arguments, so the bare key is its read; GetErrorLogs demands a service name, and which
    // arguments a dash-joined key encodes is a guess this audit refuses to make.
    expect(audit.satisfied).toBe(1);
    expect(audit.missingByTool).toEqual([
      ['GetErrorLogs', 1],
      ['GetResources', 1],
    ]);
  });

  it('counts a case with no cache as a case the artefact cannot check', () => {
    const audit = cacheConsistency([first, second], new Map());
    expect(audit.casesNone).toBe(2);
    expect(audit.casesAll).toBe(0);
    expect(audit.milestonesSatisfied).toBe(0);
  });
});

describe('the case census', () => {
  const base: CloudOpsCase = {
    id: 'boutique/performance/1',
    system: 'boutique',
    category: 'performance',
    namespace: 'boutique',
    query: 'Service quality degradation.',
    difficulty: 'hard',
    faultObject: 'app/adservice',
    faultTaxonomy: 'Performance_Fault',
    rootCause: 'pod_cpu_overload',
    services: ['adservice'],
    series: [],
    alert: { startMs: 1, endMs: 2, entities: [{ type: 'Service', name: 'adservice' }] },
    hasToolCache: true,
    metricsRows: 48,
  };
  const withSeries: CloudOpsCase = {
    ...base,
    series: [{ service: 'adservice', metric: 'cpu', timestamps: [1], values: [0.1] }],
  };

  it('separates the readable population from the corpus it sits in', () => {
    const census = summariseCases([
      withSeries,
      { ...base, id: 'boutique/scheduling/1', category: 'scheduling' },
    ]);
    expect(census).toMatchObject({
      cases: 2,
      metricReadable: 1,
      withToolCache: 2,
      withAlert: 2,
      resolvable: 1,
      rows: { min: 48, max: 48 },
      services: { min: 1, max: 1 },
    });
    expect(census.categories).toEqual([
      { category: 'performance', cases: 1, metricReadable: 1 },
      { category: 'scheduling', cases: 1, metricReadable: 0 },
    ]);
  });

  it('refuses to count a case whose own truth its own series cannot name', () => {
    // The fence: metrics exist, but the labelled service is absent from them — so a comparison that averaged this
    // case in would charge the engine for a name the case never showed it.
    const elsewhere = { ...withSeries, services: ['cartservice'], faultObject: 'app/adservice' };
    expect(summariseCases([elsewhere]).resolvable).toBe(0);
    // A node-scoped truth is not a service name at all, and never enters the resolvable count.
    const nodeScoped = { ...withSeries, faultObject: 'node/worker-02' };
    expect(summariseCases([nodeScoped]).resolvable).toBe(0);
    // A metric-readable case that resolves.
    expect(summariseCases([withSeries]).resolvable).toBe(1);
  });

  it('is a census of nothing without dividing by zero', () => {
    expect(summariseCases([])).toEqual({
      cases: 0,
      metricReadable: 0,
      withToolCache: 0,
      withAlert: 0,
      resolvable: 0,
      rows: { min: 0, max: 0 },
      services: { min: 0, max: 0 },
      categories: [],
    });
  });
});

describe('the case census, counted rather than recalled', () => {
  const base: CloudOpsCase = {
    id: 'boutique/performance/1',
    system: 'boutique',
    category: 'performance',
    namespace: 'boutique',
    query: 'q',
    difficulty: 'hard',
    faultObject: 'app/adservice',
    faultTaxonomy: 'Performance_Fault',
    rootCause: 'pod_cpu_overload',
    services: ['adservice'],
    series: [{ service: 'adservice', metric: 'cpu', timestamps: [1], values: [0.1] }],
    alert: { startMs: 1, endMs: 2, entities: [] },
    hasToolCache: true,
    metricsRows: 48,
  };

  it('counts a case with no cache and no alert on the right side of both', () => {
    const census = summariseCases([{ ...base, hasToolCache: false, alert: null }]);
    expect(census.withToolCache).toBe(0);
    expect(census.withAlert).toBe(0);
    expect(census.metricReadable).toBe(1);
  });

  it('reads a truth that states no scope prefix as the name it is', () => {
    // `adservice` with no `app/` is not a shape the corpus publishes, and the census must still count it as
    // unresolvable rather than crash on the missing slash or strip a prefix that is not there.
    const unscoped = { ...base, faultObject: 'adservice' };
    expect(summariseCases([unscoped]).resolvable).toBe(0);
    expect(summariseCases([{ ...base, faultObject: 'app/cartservice' }]).resolvable).toBe(0);
  });
});

describe('a corpus whose every milestone is closed', () => {
  it('counts the case as fully checkable', () => {
    const closed = label('boutique/performance/1', 'app/adservice', [
      milestone('M0', [use('GetAlerts', {})]),
    ]);
    const audit = cacheConsistency(
      [closed],
      new Map([
        ['boutique/performance/1', readToolCache(JSON.stringify({ 'GetAlerts:{}': 'two alerts' }))],
      ]),
    );
    expect(audit.casesAll).toBe(1);
    expect(audit.casesSome).toBe(0);
    expect(audit.missingByTool).toEqual([]);
  });
});
