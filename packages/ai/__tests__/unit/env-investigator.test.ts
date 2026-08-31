/**
 * Unit tests for the environment-based investigator factory.
 *
 * Verifies the provider-agnostic factory: null when the API key is absent, a
 * ready agent when it is present, and honouring a custom env var / model. No
 * network — the agent is constructed with an OpenAI-compatible provider stub.
 *
 * @module ai/__tests__/unit/env-investigator
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInvestigatorFromEnv } from '../../src/agent/env-investigator.js';

describe('createInvestigatorFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns null when the API key is not set', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    expect(createInvestigatorFromEnv()).toBeNull();
  });

  it('returns an agent when the API key is set', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
    const agent = createInvestigatorFromEnv();
    expect(agent).not.toBeNull();
    expect(agent!.modelId).toBe('deepseek-chat');
  });

  it('honours a custom env var name and model', () => {
    vi.stubEnv('CUSTOM_KEY', 'test-key');
    const agent = createInvestigatorFromEnv({ apiKeyEnv: 'CUSTOM_KEY', model: 'custom-model' });
    expect(agent).not.toBeNull();
    expect(agent!.modelId).toBe('custom-model');
  });
});
