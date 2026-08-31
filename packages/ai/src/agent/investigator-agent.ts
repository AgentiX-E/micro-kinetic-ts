/**
 * The provider-agnostic ReAct investigator (GALA+ phase-III).
 *
 * Wraps an {@link IChatProvider} with the bounded Thought/Action/Observation
 * loop over an {@link InvestigatorToolkit}. The agent depends on the chat
 * interface only — it is NOT coupled to DeepSeek; any OpenAI-compatible
 * provider (or a test mock) satisfies the contract. On any failure (provider
 * error, unparseable response, hop-budget exhaustion) the agent returns a
 * result with `rootCause: null`, which the caller falls back to the
 * deterministic ranking — the agent can never regress correctness.
 *
 * @module ai/agent
 */

import type { ChatMessage, IChatProvider } from '../providers/api-llm.js';
import { buildSystemPrompt, executeAction, parseAgentResponse } from './agent-core.js';
import type { InvestigatorToolkit } from './investigator-toolkit.js';

/** Why the investigation loop terminated. */
export type InvestigationTermination = 'answer' | 'invalid' | 'budget' | 'error';

/** The result of one investigation pass. */
export interface InvestigationResult {
  /** The service the agent concluded is the root cause, or null when undecided. */
  readonly rootCause: string | null;
  /** The agent's confidence in [0, 1] (0 when undecided). */
  readonly confidence: number;
  /** The agent's free-text reasoning chain. */
  readonly reasoning: string;
  /** How many tool calls were made before the result was produced. */
  readonly hopsUsed: number;
  /** Why the loop stopped (answer, unparseable response, budget, provider error). */
  readonly termination: InvestigationTermination;
}

/**
 * The root-cause investigator contract.
 *
 * Implementations are stateless across cases (each `investigate` call is a
 * fresh walk over a fresh toolkit) and must return a fallback result rather
 * than throw.
 */
export interface InvestigatorAgent {
  /** Provider/model identifier for logging. */
  readonly modelId: string;
  /** Walk the graph, starting from the toolkit's candidates, and conclude. */
  investigate(toolkit: InvestigatorToolkit): Promise<InvestigationResult>;
}

/**
 * The default ReAct implementation: iterates Thought → Action → Observation,
 * bounded by the toolkit's hop budget, until the model emits an Answer.
 */
export class ReActInvestigatorAgent implements InvestigatorAgent {
  public readonly modelId: string;

  constructor(private readonly provider: IChatProvider) {
    this.modelId = provider.modelId;
  }

  async investigate(toolkit: InvestigatorToolkit): Promise<InvestigationResult> {
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: `Candidates: ${JSON.stringify(toolkit.getCandidates())}`,
      },
    ];

    let hopsUsed = 0;
    try {
      while (toolkit.remainingHops() > 0) {
        // On the final hop, nudge the model to conclude instead of acting again
        // (the first agentic run showed the model exhausted the budget by
        // exploring without ever emitting an answer).
        if (toolkit.remainingHops() === 1) {
          messages.push({
            role: 'user',
            content: 'You have one tool call left. Conclude with the answer now.',
          });
        }

        const response = await this.provider.complete(messages);
        const step = parseAgentResponse(response);

        if (step.kind === 'answer') {
          return {
            rootCause: step.answer.rootCause,
            confidence: step.answer.confidence,
            reasoning: step.answer.reasoning,
            hopsUsed,
            termination: 'answer',
          };
        }
        if (step.kind === 'invalid') {
          return {
            rootCause: null,
            confidence: 0,
            reasoning: response,
            hopsUsed,
            termination: 'invalid',
          };
        }

        const observation = executeAction(step.action, toolkit);
        toolkit.consumeHop();
        hopsUsed++;
        messages.push({ role: 'assistant', content: response });
        messages.push({ role: 'user', content: `Observation: ${observation}` });
      }
    } catch {
      // Provider failure (network, timeout) → deterministic fallback.
      return { rootCause: null, confidence: 0, reasoning: '', hopsUsed, termination: 'error' };
    }

    return { rootCause: null, confidence: 0, reasoning: '', hopsUsed, termination: 'budget' };
  }
}
