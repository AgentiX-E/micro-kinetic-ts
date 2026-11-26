/**
 * The closure-label format, held to the corpus it was read off.
 *
 * Every constant here is a property of `arXiv:2603.00468`'s published labels observed over all 754 of them on
 * 2026-11-26: three `fault_object` prefixes (`app/`, `node/`, `namespace/`), 2–5 milestones a case, twelve tool
 * names, and 473 of 2 478 milestones whose requirement is a call and not an argument. The fixtures below are
 * small and shaped like the real files rather than copied from them, so a format change upstream shows up as a
 * failing assertion here instead of a quietly mis-scored corpus.
 */

import { describe, expect, it } from 'vitest';

import {
  labelScope,
  matchesUse,
  nameLevelClosure,
  nameLevelScorable,
  parseClosureLabel,
  summariseCorpus,
  type ClosureLabel,
  type ClosureMilestone,
} from '../src/closure-labels.js';

/** A milestone that needs a call and nothing else. */
const callOnly = (id: string, tool: string): ClosureMilestone => ({
  id,
  role: `${id}_role`,
  uses: [{ tool, argumentKeys: [], arguments: {}, evidencePatterns: [] }],
});

/** A milestone that needs an argument, so a name-only artifact cannot decide it. */
const withArgument = (id: string, tool: string): ClosureMilestone => ({
  id,
  role: `${id}_role`,
  uses: [
    {
      tool,
      argumentKeys: ['namespace'],
      arguments: { namespace: ['boutique'] },
      evidencePatterns: [],
    },
  ],
});

/** A label builder, so a test names only what it is about. */
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

describe('the scope a label states its root cause at', () => {
  it('reads the three prefixes the corpus uses, and keeps the service name', () => {
    expect(labelScope('app/adservice')).toEqual({ kind: 'service', service: 'adservice' });
    expect(labelScope('node/k8s-node-07')).toEqual({ kind: 'node' });
    expect(labelScope('namespace/trainticket')).toEqual({ kind: 'namespace' });
  });

  it('reports a prefix it has never seen rather than bucketing it', () => {
    // The census counts this bucket, so an unseen scope arrives as a number instead of joining the 659 services
    // and inflating the subset this engine can answer at all.
    expect(labelScope('cluster/eu-west')).toEqual({ kind: 'other', raw: 'cluster/eu-west' });
    expect(labelScope('adservice')).toEqual({ kind: 'other', raw: 'adservice' });
    expect(labelScope('app/')).toEqual({ kind: 'other', raw: 'app/' });
  });
});

describe('what a name-only artifact can decide', () => {
  it('decides a milestone whose admissible use is a call with no arguments and no pattern', () => {
    expect(nameLevelScorable(callOnly('M1', 'GetAlerts'))).toBe(true);
  });

  it('cannot decide one that needs an argument, or one that matches text', () => {
    expect(nameLevelScorable(withArgument('M1', 'GetResources'))).toBe(false);
    expect(
      nameLevelScorable({
        id: 'M1',
        role: 'r',
        uses: [
          {
            tool: 'GetErrorLogs',
            argumentKeys: [],
            arguments: {},
            evidencePatterns: ['OOMKilled'],
          },
        ],
      }),
    ).toBe(false);
  });

  it('decides a mixed milestone, because one satisfiable branch is enough', () => {
    const mixed: ClosureMilestone = {
      id: 'M2',
      role: 'r',
      uses: [
        {
          tool: 'DescribeResource',
          argumentKeys: ['name'],
          arguments: { name: ['viewer'] },
          evidencePatterns: [],
        },
        { tool: 'GetAlerts', argumentKeys: [], arguments: {}, evidencePatterns: [] },
      ],
    };
    expect(nameLevelScorable(mixed)).toBe(true);
  });
});

describe('the closure score an artifact can carry today', () => {
  const subject = label('boutique/performance/1', 'app/adservice', [
    callOnly('M1', 'GetAlerts'),
    withArgument('M2', 'GetResources'),
    callOnly('M3', 'CheckServiceConnectivity'),
  ]);

  it('counts only the scorable milestones, and reports that denominator beside the score', () => {
    const score = nameLevelClosure(subject, new Set(['metric-series']), (ours) =>
      ours === 'metric-series' ? ['GetAlerts'] : [],
    );
    // 1 of 2 scorable, 3 milestones: the middle number is the one a report must quote, because `1/3` and `1/2`
    // are the same answer to two different questions and only one of them is about this artifact.
    expect(score).toEqual({ satisfied: 1, scorable: 2, total: 3 });
  });

  it('maps one of our calls onto several of theirs, because the surfaces are not one to one', () => {
    const score = nameLevelClosure(subject, new Set(['service-detail']), () => [
      'GetAlerts',
      'CheckServiceConnectivity',
    ]);
    expect(score).toEqual({ satisfied: 2, scorable: 2, total: 3 });
  });

  it('scores nothing for a call that maps to nothing', () => {
    // A default mapping would let an unrelated tool satisfy a milestone, which is the failure mode this
    // parameter exists to prevent.
    const score = nameLevelClosure(subject, new Set(['answer']), () => []);
    expect(score).toEqual({ satisfied: 0, scorable: 2, total: 3 });
  });
});

describe('reading one milestone.json', () => {
  const good = JSON.stringify({
    case_id: 'boutique/performance/1',
    namespace: 'boutique',
    result: {
      fault_taxonomy: 'Performance_Fault',
      fault_object: 'app/adservice',
      root_cause: 'pod_cpu_overload',
    },
    milestones: [
      {
        id: 'M1',
        role: 'primary_metric_anomaly_and_root_cause_signal',
        admissible_tool_uses: [
          { tool_name: 'GetAlerts', arguments: {}, evidence_patterns: [] },
          {
            tool_name: 'GetResources',
            arguments: { namespace: 'boutique' },
            evidence_patterns: [],
          },
        ],
      },
    ],
  });

  it('reads the file the corpus actually ships', () => {
    const parsed = parseClosureLabel(good, 'fallback');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.label.caseId).toBe('boutique/performance/1');
    expect(parsed.label.faultObject).toBe('app/adservice');
    expect(parsed.label.milestones).toHaveLength(1);
    expect(parsed.label.milestones[0]!.uses.map((use) => use.tool)).toEqual([
      'GetAlerts',
      'GetResources',
    ]);
    expect(parsed.label.milestones[0]!.uses.map((use) => use.argumentKeys)).toEqual([
      [],
      ['namespace'],
    ]);
  });

  it('falls back to the path-derived id, the positional milestone id and an empty role', () => {
    const parsed = parseClosureLabel(
      JSON.stringify({
        result: { fault_taxonomy: 'T', fault_object: 'node/n1', root_cause: 'c' },
        milestones: [{ admissible_tool_uses: [{ tool_name: 'GetAlerts' }] }],
      }),
      'boutique/runtime/7',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.label.caseId).toBe('boutique/runtime/7');
    expect(parsed.label.namespace).toBe('');
    expect(parsed.label.milestones[0]!.id).toBe('M1');
    expect(parsed.label.milestones[0]!.role).toBe('');
    // `arguments` absent and `evidence_patterns` absent are both shapes the reader must survive: a label that
    // omitted the empty array is still a call with no argument.
    expect(parsed.label.milestones[0]!.uses[0]).toEqual({
      tool: 'GetAlerts',
      argumentKeys: [],
      arguments: {},
      evidencePatterns: [],
    });
  });

  it('carries evidence patterns and a nameless use through the reader', () => {
    // 1 098 of the corpus's 6 654 admissible uses carry `evidence_patterns`, so this branch is not decoration —
    // and a use with no `tool_name` must survive as an empty name rather than throw, because a label whose
    // schema changed is a fact to report and not a crash in the middle of a census.
    const parsed = parseClosureLabel(
      JSON.stringify({
        result: { fault_taxonomy: 'T', fault_object: 'app/a', root_cause: 'c' },
        milestones: [
          {
            id: 'M1',
            role: 'r',
            admissible_tool_uses: [{ evidence_patterns: ['OOMKilled', 7] }],
          },
        ],
      }),
      'case-1',
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.label.milestones[0]!.uses[0]).toEqual({
      tool: '',
      argumentKeys: [],
      arguments: {},
      evidencePatterns: ['OOMKilled', '7'],
    });
    expect(nameLevelScorable(parsed.label.milestones[0]!)).toBe(false);
  });

  it('refuses rather than coercing, and names the field', () => {
    const refusals: readonly (readonly [string, string])[] = [
      ['{', 'not JSON'],
      ['null', 'not an object'],
      ['[]', 'no result'],
      [JSON.stringify({ result: {} }), 'no result.fault_object'],
      [JSON.stringify({ result: { fault_object: 'app/a' } }), 'no result.fault_taxonomy'],
      [
        JSON.stringify({ result: { fault_object: 'app/a', fault_taxonomy: 'T' } }),
        'no result.root_cause',
      ],
      [
        JSON.stringify({ result: { fault_object: 'app/a', fault_taxonomy: 'T', root_cause: 'c' } }),
        'no milestones',
      ],
      [
        JSON.stringify({
          result: { fault_object: 'app/a', fault_taxonomy: 'T', root_cause: 'c' },
          milestones: [{ id: 'M1', role: 'r', admissible_tool_uses: [] }],
        }),
        'milestone 0 has no admissible_tool_uses',
      ],
    ];
    for (const [text, reason] of refusals) {
      const parsed = parseClosureLabel(text, 'case-1');
      expect(parsed.ok, `${reason} is refused`).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.reason).toContain(reason);
      expect(parsed.reason).toContain('case-1');
    }
  });
});

describe('the census over a corpus', () => {
  it('counts scopes, milestones, the three case classes and the tool histogram', () => {
    const census = summariseCorpus([
      label('a', 'app/svc', [callOnly('M1', 'GetAlerts'), callOnly('M2', 'GetAlerts')]),
      label('b', 'node/n1', [callOnly('M1', 'GetResources'), withArgument('M2', 'GetResources')]),
      label('c', 'namespace/ns', [withArgument('M1', 'DescribeResource')]),
      label('d', 'cluster/x', [callOnly('M1', 'GetAlerts')]),
    ]);
    expect(census.cases).toBe(4);
    expect(census.byScope).toEqual({ service: 1, node: 1, namespace: 1, other: 1 });
    expect(census.milestones).toBe(6);
    expect(census.nameLevelMilestones).toBe(4);
    // The three classes, which a mean would collapse: two cases are wholly name-level (a, d), one is partly (b)
    // and one is not at all (c).
    expect(census.casesAllNameLevel).toBe(2);
    expect(census.casesSomeNameLevel).toBe(1);
    expect(census.casesNoneNameLevel).toBe(1);
    expect(census.uses).toEqual({ total: 6, argumentFree: 4, withArguments: 2, withPatterns: 0 });
    // Most frequent first, ties by name — deterministic, because a histogram printed in insertion order is a
    // different table on every run.
    expect(census.tools).toEqual([
      ['GetAlerts', 3],
      ['GetResources', 2],
      ['DescribeResource', 1],
    ]);
  });

  it('counts a pattern-carrying use as an argument-shaped requirement', () => {
    const census = summariseCorpus([
      label('a', 'app/svc', [
        {
          id: 'M1',
          role: 'r',
          uses: [
            {
              tool: 'GetErrorLogs',
              argumentKeys: [],
              arguments: {},
              evidencePatterns: ['OOMKilled'],
            },
          ],
        },
      ]),
    ]);
    expect(census.uses).toEqual({ total: 1, argumentFree: 1, withArguments: 0, withPatterns: 1 });
    // Non-vacuity for the scorable count: a pattern-carrying use is argument-free but NOT name-level scorable.
    expect(census.nameLevelMilestones).toBe(0);
    expect(census.casesNoneNameLevel).toBe(1);
  });

  it('breaks a tie in the histogram by NAME, so two runs print one table', () => {
    // The corpus's own tail is full of ties (`GetAlerts` 208, `GetServiceDependencies` 28, …), and insertion
    // order is an implementation detail of the parse: a report whose rows swap between runs cannot be diffed.
    const census = summariseCorpus([
      label('a', 'app/svc', [callOnly('M1', 'GetRecentLogs'), callOnly('M2', 'GetAlerts')]),
    ]);
    expect(census.tools).toEqual([
      ['GetAlerts', 1],
      ['GetRecentLogs', 1],
    ]);
  });

  it('is empty rather than undefined on an empty corpus', () => {
    const census = summariseCorpus([]);
    expect(census.cases).toBe(0);
    expect(census.tools).toEqual([]);
    expect(census.byScope).toEqual({ service: 0, node: 0, namespace: 0, other: 0 });
  });
});

describe('whether one call satisfies one admissible use', () => {
  /** A use with a synonym list, which is how the corpus writes `resource_type`. */
  const pods = {
    tool: 'GetResources',
    argumentKeys: ['namespace', 'resource_type'],
    arguments: { namespace: ['boutique'], resource_type: ['pods', 'pod'] },
    evidencePatterns: [],
  };

  it('requires the tool, and every argument the use names', () => {
    expect(
      matchesUse(
        { tool: 'GetResources', arguments: { namespace: 'boutique', resource_type: 'pods' } },
        pods,
      ),
    ).toBe(true);
    expect(
      matchesUse(
        { tool: 'DescribeResource', arguments: { namespace: 'boutique', resource_type: 'pods' } },
        pods,
      ),
    ).toBe(false);
    expect(matchesUse({ tool: 'GetResources', arguments: { resource_type: 'pods' } }, pods)).toBe(
      false,
    );
    expect(matchesUse({ tool: 'GetResources', arguments: { namespace: 'boutique' } }, pods)).toBe(
      false,
    );
  });

  it('accepts a synonym and refuses a different value, case-insensitively', () => {
    expect(
      matchesUse(
        { tool: 'GetResources', arguments: { namespace: 'Boutique', resource_type: 'pod' } },
        pods,
      ),
    ).toBe(true);
    expect(
      matchesUse(
        {
          tool: 'GetResources',
          arguments: { namespace: 'boutique', resource_type: 'deployments' },
        },
        pods,
      ),
    ).toBe(false);
  });

  it('is a SUBSET test, so a formatting flag does not decide whether a read happened', () => {
    // `output_wide` and `show_labels` are renderings of the same read; requiring equality would make a flag decide
    // whether a pod listing counts as evidence about pods, and the corpus itself treats all three as one call.
    expect(
      matchesUse(
        {
          tool: 'GetResources',
          arguments: { namespace: 'boutique', resource_type: 'pods', output_wide: true },
        },
        pods,
      ),
    ).toBe(true);
  });

  it('matches a list argument element-wise, because the cache writes both shapes', () => {
    expect(
      matchesUse(
        { tool: 'GetResources', arguments: { namespace: 'boutique', resource_type: ['pod'] } },
        pods,
      ),
    ).toBe(true);
    expect(
      matchesUse(
        { tool: 'GetResources', arguments: { namespace: 'boutique', resource_type: ['deploy'] } },
        pods,
      ),
    ).toBe(false);
  });

  it('accepts any call of the tool when the use names no argument', () => {
    const alerts = { tool: 'GetAlerts', argumentKeys: [], arguments: {}, evidencePatterns: [] };
    expect(matchesUse({ tool: 'GetAlerts', arguments: {} }, alerts)).toBe(true);
    expect(matchesUse({ tool: 'GetAlerts', arguments: { since: '1h' } }, alerts)).toBe(true);
  });

  it('keeps the values it parsed, so a scorer is not reading keys it cannot compare', () => {
    const parsed = parseClosureLabel(
      JSON.stringify({
        result: { fault_taxonomy: 'T', fault_object: 'app/a', root_cause: 'c' },
        milestones: [
          {
            id: 'M0',
            role: 'r',
            admissible_tool_uses: [
              {
                tool_name: 'GetResources',
                arguments: { resource_type: ['Pods', 'pod'], namespace: 'boutique', port: 9555 },
                evidence_patterns: [],
              },
            ],
          },
        ],
      }),
      'case-1',
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.label.milestones[0]!.uses[0]!.arguments).toEqual({
      namespace: ['boutique'],
      port: ['9555'],
      resource_type: ['pods', 'pod'],
    });
    // A number in the label is compared as its text, because a JSON scalar and an MCP argument are both untyped.
    expect(
      matchesUse(
        {
          tool: 'GetResources',
          arguments: { namespace: 'boutique', resource_type: 'pod', port: 9555 },
        },
        parsed.label.milestones[0]!.uses[0]!,
      ),
    ).toBe(true);
  });
});
