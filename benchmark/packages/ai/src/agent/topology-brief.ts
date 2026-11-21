/**
 * The topology brief: who calls whom, as ONE string per corpus.
 *
 * ## What the prompt was missing, and why this is the only way to add it
 *
 * `buildNominationPrompt` sends the fault type and one table row per candidate. A row carries the channels that
 * moved, their fault-free bands, the crossing rate and the onset — everything about a *service* and nothing about
 * the *graph*. A model reading twenty rows can see that a callee's latency moved; it cannot see that the other row
 * is its caller, and the corpus's own labels say the source is usually the end of that edge that a symptom does
 * not point at.
 *
 * The obvious repair — render the edges among the candidates — is refused, and the refusal is the design. A text
 * that differs by case is a per-case input, and a per-case input can carry the answer without ever printing it. So
 * the brief is a property of the **corpus**: one union graph, one string, the same bytes for every case. That makes
 * the leak structurally impossible rather than merely unobserved, and it is checkable — a consumer can assert
 * identity across the population instead of auditing a derivation.
 *
 * The price of that choice is that the brief cannot be trimmed to the candidates on the table. It states the whole
 * union, which on the 1 422-case FSE'26 corpus is tens of edges and a few hundred tokens per case. That price is
 * measured at dispatch (`chars`, `estimatedTokens`) rather than estimated here.
 *
 * ## What it says, and what it refuses to say
 *
 * It says what an edge is (`A -> B` reads "A calls B"), how many services and edges the union holds, which cases
 * it was taken over, whose calls nobody observed, and which services call nobody. Those last two are printed
 * because absence has two meanings that arrows cannot show: a service nothing calls is an entry point, and a
 * service that calls nothing is a leaf.
 *
 * It does **not** say which end of a bad edge is usually the source. That would be a hypothesis about causation
 * folded into an instrument that is supposed to be a channel, and an arm whose channel already contains the answer
 * measures nothing.
 *
 * @module packages/ai/src/agent/topology-brief
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

import { digestOf } from './eliminator.js';

/** One observed call, direction included. Duplicates are expected: an edge observed in many cases is one edge. */
export interface TopologyEdge {
  readonly from: ServiceId;
  readonly to: ServiceId;
}

/** The union a brief is rendered from, and the population it was taken over. */
export interface TopologyBriefInput {
  /** Cases whose call graphs were unioned. Printed, because a 7-case union is not a 1 422-case union. */
  readonly cases: number;
  /** Every edge any case observed. Order and repetition do not matter; the rendering is over the SET. */
  readonly edges: readonly TopologyEdge[];
}

/** What the section says, and what it cost. */
export interface RenderedTopologyBrief {
  /** The section, or `''` when the union held no edge — in which case a prompt must add nothing at all. */
  readonly text: string;
  /** 16 hex characters over {@link text}. The identity of the topology a run was asked about. */
  readonly digest: string;
  /** Distinct endpoints. */
  readonly services: number;
  /** Distinct edges. */
  readonly edges: number;
  readonly chars: number;
  /**
   * `chars / 4`, rounded up — the divisor every provider's tokeniser lands near for English prose and service
   * names. It is an estimate and it is named as one: the run reports the provider's own count beside it.
   */
  readonly estimatedTokens: number;
}

/**
 * The heading. Exported because two consumers check it: the prompt builder places the section by it, and the
 * runner's log names the same string, so neither can drift into describing a section the other does not send.
 */
export const TOPOLOGY_BRIEF_HEADING = "SYSTEM (who calls whom, from this corpus's own telemetry)";

/**
 * The union graph, accumulated one case at a time.
 *
 * It exists as a class rather than as a loop inside the runner for one reason: the runner calls `main()` on import
 * and cannot be tested, so the arithmetic that decides what an edge IS — deduplication across cases — would
 * otherwise be untested code that every arm depends on. The accumulator takes a case's edges and nothing else, so
 * there is no argument by which a label could reach the brief.
 */
export class TopologyUnion {
  readonly #edges: TopologyEdge[] = [];
  readonly #seen = new Set<string>();

  /**
   * Add one case's call edges.
   *
   * @param edges - The case's graph. Repetition across cases is expected and is what the union is for.
   */
  addCase(edges: readonly TopologyEdge[]): void {
    for (const edge of edges) {
      const key = `${edge.from}\u0000${edge.to}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      this.#edges.push({ from: edge.from, to: edge.to });
    }
  }

  /** Distinct edges seen so far. */
  get size(): number {
    return this.#edges.length;
  }

  /**
   * Render the union.
   *
   * @param cases - How many cases were added. Passed rather than counted, because a case with an empty graph is
   *   still a case the union was taken over, and dropping it would report a smaller population than the run read.
   * @returns The section, its digest and its size.
   */
  render(cases: number): RenderedTopologyBrief {
    return renderTopologyBrief({ cases, edges: this.#edges });
  }
}

/** `1 service`, `2 services`. Spelling is the only thing this module does twice. */
function counted(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Render the union graph as the section the nomination prompt carries.
 *
 * @param input - The union's edges and the number of cases it was taken over.
 * @returns The text, its digest and its size. An empty union returns `text: ''` rather than a heading with no
 *   content, because a prompt that added a heading over nothing would change the digest of every run that has no
 *   graph — and a digest is the identity of a question.
 */
export function renderTopologyBrief(input: TopologyBriefInput): RenderedTopologyBrief {
  const callees = new Map<ServiceId, Set<ServiceId>>();
  const services = new Set<ServiceId>();
  const called = new Set<ServiceId>();
  for (const edge of input.edges) {
    services.add(edge.from);
    services.add(edge.to);
    let out = callees.get(edge.from);
    if (out === undefined) {
      out = new Set<ServiceId>();
      callees.set(edge.from, out);
    }
    out.add(edge.to);
    called.add(edge.to);
  }
  let edgeCount = 0;
  for (const out of callees.values()) edgeCount += out.size;
  if (edgeCount === 0) {
    return { text: '', digest: digestOf(''), services: 0, edges: 0, chars: 0, estimatedTokens: 0 };
  }

  // The default sort, which is lexicographic on code units and therefore locale-independent and total. A
  // comparator with an equality arm would carry a branch that no input can reach: the keys of a Set are distinct.
  const sortedServices = [...services].sort();
  const lines = [
    TOPOLOGY_BRIEF_HEADING,
    `${counted(sortedServices.length, 'service')}, ${counted(edgeCount, 'call edge')}, observed over ` +
      `${counted(input.cases, 'case')}. \`A -> B\` reads "A calls B".`,
    '',
  ];
  for (const service of sortedServices) {
    const out = callees.get(service);
    if (out === undefined) continue;
    lines.push(`  ${service} -> ${[...out].sort().join(', ')}`);
  }
  // Absence, in both directions. A reader with only the arrows would have to infer that a service missing from
  // the left column is a leaf AND that a service missing from the right one is an entry point; both are cheap to
  // print and both are things a table of candidates cannot tell.
  const entryPoints = sortedServices.filter((service) => !called.has(service));
  const leaves = sortedServices.filter((service) => callees.get(service) === undefined);
  if (entryPoints.length > 0) {
    lines.push('', `Nothing in this corpus calls: ${entryPoints.join(', ')}`);
  }
  if (leaves.length > 0) {
    lines.push(`These services call nothing: ${leaves.join(', ')}`);
  }

  const text = lines.join('\n');
  return {
    text,
    digest: digestOf(text),
    services: sortedServices.length,
    edges: edgeCount,
    chars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
  };
}
