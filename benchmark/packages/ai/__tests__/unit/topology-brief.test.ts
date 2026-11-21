import { describe, expect, it } from 'vitest';

import {
  TOPOLOGY_BRIEF_HEADING,
  TopologyUnion,
  renderTopologyBrief,
  type TopologyEdge,
} from '../../src/agent/topology-brief.js';

/**
 * A four-service, four-edge system. Small enough to read, big enough to have a leaf, an entry point and a
 * service that is both.
 */
const EDGES: readonly TopologyEdge[] = [
  { from: 'ts-travel-service', to: 'ts-basic-service' },
  { from: 'ts-travel-service', to: 'ts-seat-service' },
  { from: 'ts-basic-service', to: 'ts-train-service' },
  { from: 'ts-basic-service', to: 'ts-station-service' },
  { from: 'ts-order-service', to: 'ts-seat-service' },
];

function render(edges: readonly TopologyEdge[] = EDGES): ReturnType<typeof renderTopologyBrief> {
  return renderTopologyBrief({ cases: 7, edges });
}

describe('renderTopologyBrief', () => {
  it('heads the section with the sentence the prompt labels it by', () => {
    expect(render().text.split('\n')[0]).toBe(TOPOLOGY_BRIEF_HEADING);
    expect(TOPOLOGY_BRIEF_HEADING).toContain('SYSTEM');
    expect(TOPOLOGY_BRIEF_HEADING).toContain('who calls whom');
  });

  it('defines the arrow before it uses one, so the direction is not a guess', () => {
    // The only semantics the section is allowed to carry: what an edge IS. It deliberately says nothing about
    // which end of a bad edge is usually the source — that would be a hypothesis, and the arm is about a channel.
    expect(render().text).toContain('`A -> B` reads "A calls B"');
    expect(render().text.toLowerCase()).not.toContain('usually');
    expect(render().text.toLowerCase()).not.toContain('source is');
  });

  it('states the population the union was taken over, so a small corpus cannot read as a small system', () => {
    expect(render().text).toContain('6 services');
    expect(render().text).toContain('5 call edges');
    expect(render().text).toContain('observed over 7 cases');
  });

  it('prints one line per caller, with its callees sorted', () => {
    expect(render().text).toContain('  ts-travel-service -> ts-basic-service, ts-seat-service\n');
    expect(render().text).toContain('  ts-basic-service -> ts-station-service, ts-train-service\n');
    // The callee order is lexical and not insertion order: two runs that observed the same edges in different
    // case order have to write the same file, or the digest is a property of the corpus's enumeration.
    const reversed = render([...EDGES].reverse());
    expect(reversed.text).toBe(render().text);
    expect(reversed.digest).toBe(render().digest);
  });

  it('names the services nothing calls and the services that call nothing, because absence has two meanings', () => {
    // An entry point and a leaf are the two things a table of edges cannot show: `ts-travel-service` is called by
    // nobody and `ts-train-service` calls nobody, and a reader that had only the arrows would have to infer both.
    expect(render().text).toContain(
      'Nothing in this corpus calls: ts-order-service, ts-travel-service',
    );
    expect(render().text).toContain(
      'These services call nothing: ts-seat-service, ts-station-service, ts-train-service',
    );
  });

  it('deduplicates an edge observed in many cases, and counts it once', () => {
    const doubled = render([...EDGES, ...EDGES, ...EDGES]);
    expect(doubled.text).toBe(render().text);
    expect(doubled.edges).toBe(5);
  });

  it('reports the size of what it wrote, because the brief is priced per case', () => {
    const one = render();
    expect(one.chars).toBe(one.text.length);
    expect(one.estimatedTokens).toBe(Math.ceil(one.chars / 4));
    expect(one.estimatedTokens).toBeGreaterThan(0);
    expect(one.services).toBe(6);
    expect(one.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes its digest when one edge changes, so a replay cannot reuse a claim made about another topology', () => {
    const fewer = render(EDGES.slice(0, 4));
    expect(fewer.digest).not.toBe(render().digest);
    expect(fewer.text).not.toBe(render().text);
  });

  it('renders nothing at all when the corpus observed no edge, so a run without a graph keeps its prompt', () => {
    const none = renderTopologyBrief({ cases: 3, edges: [] });
    expect(none.text).toBe('');
    expect(none.services).toBe(0);
    expect(none.edges).toBe(0);
    expect(none.chars).toBe(0);
  });

  it('says "1 service", "1 call edge" and "1 case" in the singular, because a small corpus is a real corpus', () => {
    const one = renderTopologyBrief({ cases: 1, edges: [{ from: 'a', to: 'b' }] });
    expect(one.text).toContain('2 services, 1 call edge, observed over 1 case.');
  });

  it('omits an absence line when there is nothing absent, so a cycle is not described as having an entry point', () => {
    // A cycle is the one shape in which every service is called AND every service calls something: both absence
    // lines would be empty, and printing them would be printing two headings with no content.
    const cycle = renderTopologyBrief({
      cases: 2,
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(cycle.text).not.toContain('Nothing in this corpus calls');
    expect(cycle.text).not.toContain('These services call nothing');
    expect(cycle.text).toContain('  a -> b');
    expect(cycle.text).toContain('  b -> a');
  });

  it('is a pure function of the edge list: the same edges give the same bytes', () => {
    const once = render();
    const twice = render();
    expect(twice.text).toBe(once.text);
    expect(twice.digest).toBe(once.digest);
  });
});

describe('TopologyUnion', () => {
  it('counts an edge observed in ten cases once, which is what makes it a topology rather than a frequency', () => {
    const union = new TopologyUnion();
    for (let index = 0; index < 10; index += 1) union.addCase(EDGES);
    expect(union.size).toBe(EDGES.length);
    expect(union.render(10).edges).toBe(EDGES.length);
  });

  it('unions across cases without depending on the order they arrive in', () => {
    const forwards = new TopologyUnion();
    forwards.addCase(EDGES.slice(0, 2));
    forwards.addCase(EDGES.slice(2));
    const backwards = new TopologyUnion();
    backwards.addCase(EDGES.slice(2));
    backwards.addCase(EDGES.slice(0, 2));
    expect(forwards.render(2).digest).toBe(backwards.render(2).digest);
    expect(forwards.render(2).text).toBe(renderTopologyBrief({ cases: 2, edges: EDGES }).text);
  });

  it('reports the population it is TOLD, so a case with no graph still counts as read', () => {
    const union = new TopologyUnion();
    union.addCase(EDGES);
    union.addCase([]);
    expect(union.render(2).text).toContain('observed over 2 cases');
  });
});
