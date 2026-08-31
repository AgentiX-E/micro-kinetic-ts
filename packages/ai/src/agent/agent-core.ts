/**
 * Pure helpers for the ReAct root-cause investigator (GALA+ phase-III).
 *
 * Everything here is deterministic and side-effect-free so it can be unit
 * tested exhaustively without a network: the system prompt, the JSON response
 * parser (Action vs Answer), and the action executor over the closed
 * {@link InvestigatorToolkit}.
 *
 * @module ai/agent
 */

import type { InvestigatorToolkit } from './investigator-toolkit.js';

/** The closed set of tool calls the investigator can make. */
export type AgentTool = 'get_evidence' | 'get_upstream' | 'get_downstream';

/** A single tool call the model requests. */
export interface AgentAction {
  readonly tool: AgentTool;
  readonly serviceId: string;
}

/** The model's final root-cause determination. */
export interface AgentAnswer {
  readonly rootCause: string;
  readonly confidence: number;
  readonly reasoning: string;
}

/** The result of parsing one model response. */
export type ParsedStep =
  | { readonly kind: 'action'; readonly action: AgentAction }
  | { readonly kind: 'answer'; readonly answer: AgentAnswer }
  | { readonly kind: 'invalid' };

/**
 * Build the system prompt: the tool list, the fault model (a SILENT source vs
 * a SYMPTOM that throws on bad upstream input), and the one-JSON-object-per-
 * step response contract.
 */
export function buildSystemPrompt(): string {
  return [
    'You are a root-cause analysis agent for microservice systems. You investigate a fault',
    'by walking the service dependency graph, ONE tool call per step. You have a SMALL tool',
    'budget, so conclude as soon as you have identified the likely source.',
    '',
    'Tools (call exactly one per step):',
    '- get_evidence(serviceId): the service anomaly, dominant metric head/tail shift,',
    '  feature breakdown, deepest exception class, and adjacency.',
    '- get_upstream(serviceId): the services that CALL INTO this service.',
    '- get_downstream(serviceId): the services this service calls.',
    '',
    'Fault model:',
    '- A fault SOURCE may be SILENT: a "wrong value" fault produces no exception at the',
    '  source, only a modest metric rise as it does more work.',
    '- A SYMPTOM throws an exception from PROCESSING the bad output (e.g. a',
    '  MalformedJwtException means it received a bad token) and may COLLAPSE as it',
    '  stops receiving traffic.',
    '- If a service exception implies bad INPUT, walk UPSTREAM to find the producer.',
    '',
    'Investigation strategy:',
    '1. Inspect the top symptom evidence.',
    '2. Walk UPSTREAM to its producers and inspect the most likely one.',
    '3. CONCLUDE immediately once you have found the source. Do NOT keep exploring —',
    '   if you are uncertain, still emit your best guess as the answer.',
    '',
    'Respond with ONE JSON object. To act:',
    '  {"action": "get_evidence", "serviceId": "<id>"}',
    '  {"action": "get_upstream", "serviceId": "<id>"}',
    '  {"action": "get_downstream", "serviceId": "<id>"}',
    'To conclude:',
    '  {"answer": {"rootCause": "<id>", "confidence": 0.0, "reasoning": "..."}}',
  ].join('\n');
}

/**
 * Normalise a tool name the model wrote to a canonical {@link AgentTool},
 * accepting snake_case, camelCase, or spaced variants. Returns undefined for
 * an unrecognised name.
 */
function normalizeTool(name: string): AgentTool | undefined {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (n === 'getevidence') return 'get_evidence';
  if (n === 'getupstream') return 'get_upstream';
  if (n === 'getdownstream') return 'get_downstream';
  return undefined;
}

/**
 * Extract the first balanced JSON object from a free-text response, tolerant of
 * a code fence, a prose preamble, or trailing text. Returns undefined when no
 * parseable object is found.
 */
function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the balanced-object scan
  }
  const start = trimmed.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Parse one model response into an Action, an Answer, or `invalid`.
 *
 * Accepts `{"action": "...", "serviceId": "..."}` or
 * `{"answer": {"rootCause": "...", "confidence": 0..1, "reasoning": "..."}}`.
 * The confidence is clamped to [0, 1] and defaulted to 0 when absent. Anything
 * else — including a valid tool name with a bad argument — is `invalid`, which
 * triggers the deterministic fallback in the agent loop.
 */
export function parseAgentResponse(response: string): ParsedStep {
  const obj = extractJsonObject(response);
  if (obj === undefined || obj === null || typeof obj !== 'object') return { kind: 'invalid' };
  const o = obj as Record<string, unknown>;

  if (typeof o.action === 'string') {
    const tool = normalizeTool(o.action);
    if (tool !== undefined && typeof o.serviceId === 'string' && o.serviceId.length > 0) {
      return { kind: 'action', action: { tool, serviceId: o.serviceId } };
    }
    return { kind: 'invalid' };
  }

  if (typeof o.answer === 'object' && o.answer !== null) {
    const a = o.answer as Record<string, unknown>;
    if (
      typeof a.rootCause === 'string' &&
      a.rootCause.length > 0 &&
      typeof a.reasoning === 'string'
    ) {
      const raw = typeof a.confidence === 'number' ? a.confidence : 0;
      const confidence = Math.max(0, Math.min(1, raw));
      return {
        kind: 'answer',
        answer: { rootCause: a.rootCause, confidence, reasoning: a.reasoning },
      };
    }
    return { kind: 'invalid' };
  }

  return { kind: 'invalid' };
}

/**
 * Execute a tool call against the toolkit and return the observation as JSON
 * text. Pure — it only reads the toolkit, never mutates the graph.
 */
export function executeAction(action: AgentAction, toolkit: InvestigatorToolkit): string {
  switch (action.tool) {
    case 'get_evidence':
      return JSON.stringify(toolkit.getEvidence(action.serviceId));
    case 'get_upstream':
      return JSON.stringify(toolkit.getUpstream(action.serviceId));
    case 'get_downstream':
      return JSON.stringify(toolkit.getDownstream(action.serviceId));
  }
}
