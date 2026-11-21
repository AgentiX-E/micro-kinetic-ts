import { describe, expect, it } from 'vitest';

import {
  FAILURE_CODES,
  accumulateFailureCodeCensus,
  classifyMiss,
  createFailureCodeCensus,
  renderFailureCodeCensus,
  type MissGraph,
  type MissRecord,
} from '../src/agentic-failure-codes.js';

const graph = (over: Partial<MissGraph> = {}): MissGraph => ({
  callers: new Set(['frontend']),
  callees: new Set(['payment', 'db']),
  ...over,
});

const record = (over: Partial<MissRecord> = {}): MissRecord => ({
  truth: ['payment'],
  answer: 'frontend',
  rawAnswer: 'frontend',
  engineWinner: 'frontend',
  calls: [],
  ...over,
});

describe('classifyMiss', () => {
  it('reports nothing for a hit, because a census of causes is a census of causes', () => {
    expect(classifyMiss(record({ answer: 'payment' }), graph())).toBeUndefined();
  });

  it('reports nothing for a row whose truth is empty, which is a corpus defect and not a miss', () => {
    expect(classifyMiss(record({ truth: [] }), graph())).toBeUndefined();
  });

  it('codes an arm that never named a service', () => {
    expect(classifyMiss(record({ answer: null, rawAnswer: null }), graph())).toBe('never-answered');
  });

  it('codes a refusal by its fallback, and that code outranks the direction it also has', () => {
    // `frontend` is a caller of the truth AND it is the prior: without the refusal code first, this row would be
    // counted as a direction error and the harness's own decision would disappear from the census.
    expect(
      classifyMiss(
        record({ answer: 'frontend', rawAnswer: 'product', engineWinner: 'frontend' }),
        graph(),
      ),
    ).toBe('refused-fallback');
  });

  it('codes an answer above the truth as upstream, which is the direction the domain calls reversed', () => {
    expect(classifyMiss(record({}), graph())).toBe('answered-upstream');
  });

  it('codes an answer below the truth as downstream, which is an overshoot and not a reversal', () => {
    expect(classifyMiss(record({ answer: 'db', rawAnswer: 'db' }), graph())).toBe(
      'answered-downstream',
    );
  });

  it('codes a wrong branch as other-branch when the truth was never queried', () => {
    const other = graph({ callers: new Set(['nothing']), callees: new Set(['nothing']) });
    expect(classifyMiss(record({ answer: 'search', rawAnswer: 'search' }), other)).toBe(
      'answered-other-branch',
    );
  });

  it('separates a wrong branch the model LOOKED at from one it did not', () => {
    // The same wrong answer twice; the only difference is that the second investigation queried the truth. That
    // distinction is the whole content of the code: the model had the evidence and preferred elsewhere.
    const other = graph({ callers: new Set(['nothing']), callees: new Set(['nothing']) });
    expect(classifyMiss(record({ answer: 'search', rawAnswer: 'search' }), other)).toBe(
      'answered-other-branch',
    );
    expect(
      classifyMiss(record({ answer: 'search', rawAnswer: 'search', calls: ['payment'] }), other),
    ).toBe('answered-elsewhere-truth-queried');
  });

  it('reads the model’s name when the arm has no prior and no answer', () => {
    // A free arm has no fallback, so `answer` is null on a refusal and the model's own name is all there is.
    expect(
      classifyMiss(record({ answer: null, rawAnswer: 'frontend', engineWinner: null }), graph()),
    ).toBe('answered-upstream');
  });
});

describe('the census', () => {
  it('starts at zero for every code, so a code that never occurred is a zero and not a hole', () => {
    const census = createFailureCodeCensus();
    expect(Object.keys(census.byCode).sort()).toEqual([...FAILURE_CODES].sort());
    expect(Object.values(census.byCode).every((count) => count === 0)).toBe(true);
  });

  it('counts cases and misses apart, because a hit is in the denominator of nothing', () => {
    let census = createFailureCodeCensus();
    census = accumulateFailureCodeCensus(census, record({ answer: 'payment' }), graph());
    census = accumulateFailureCodeCensus(census, record({}), graph());
    expect(census.cases).toBe(2);
    expect(census.misses).toBe(1);
    expect(census.byCode['answered-upstream']).toBe(1);
  });

  it('does not mutate the census it is given, so a caller can keep every prefix', () => {
    const first = accumulateFailureCodeCensus(createFailureCodeCensus(), record({}), graph());
    const second = accumulateFailureCodeCensus(first, record({}), graph());
    expect(first.misses).toBe(1);
    expect(second.misses).toBe(2);
    expect(first.byCode['answered-upstream']).toBe(1);
  });

  it('renders the ladder in its own order and skips the codes that did not occur', () => {
    let census = createFailureCodeCensus();
    census = accumulateFailureCodeCensus(census, record({}), graph());
    census = accumulateFailureCodeCensus(
      census,
      record({ answer: null, rawAnswer: null }),
      graph(),
    );
    const lines = renderFailureCodeCensus(census);
    expect(lines[0]).toBe('misses 2 of 2 cases (100.0%)');
    expect(lines[1]).toContain('never-answered');
    expect(lines[2]).toContain('answered-upstream');
    expect(lines.join('\n')).not.toContain('answered-downstream');
  });

  it('renders a rate over the misses it counted, and refuses to divide by zero', () => {
    const empty = renderFailureCodeCensus(createFailureCodeCensus());
    expect(empty).toEqual(['misses 0 of 0 cases (0.0%)']);
  });
});
