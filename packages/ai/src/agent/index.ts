export {
  CLAIM_REJECTIONS,
  CLAIM_STATISTICS,
  DEFAULT_CONSULTATION_OPTIONS,
  SKIP_REASONS,
  applyClaims,
  decideConsultation,
  verifyClaim,
} from './hypothesis-space.js';

export type {
  CandidateFingerprint,
  ChannelFingerprint,
  ClaimBasis,
  ClaimRejection,
  ClaimStatistic,
  ClaimVerdict,
  ConsultationDecision,
  EliminationClaim,
  SkipReason,
} from './hypothesis-space.js';

export {
  AgentBudget,
  DEEPSEEK_PRICE,
  DEFAULT_ELIMINATOR_BUDGET,
  DEFAULT_INVESTIGATOR_BUDGET,
  GATE_TRIPS,
  formatMicroUsd,
  parseBudget,
  roundCost,
  tokenCost,
} from './budget.js';

export type { BudgetLimits, BudgetSpend, GateTrip, ModelPrice, RoundCost } from './budget.js';

export {
  DEFAULT_ELIMINATOR_OPTIONS,
  ELIMINATOR_PROTOCOL,
  PROMPTABLE_STATISTICS,
  buildEliminatorPrompt,
  digestOf,
  parseEliminatorReply,
} from './eliminator.js';

export { channelsByEvidence, compareChannelEvidence, departureOf, evidenceOf } from './evidence.js';

export type { ChannelEvidence } from './evidence.js';

export type { EliminatorOptions, EliminatorPrompt, ParsedReply } from './eliminator.js';

export {
  DEFAULT_FUSION_OPTIONS,
  FUSION_STRATEGIES,
  RANK_STRATEGIES,
  fuseClaims,
  fuseRanks,
  impliedOrder,
} from './fusion.js';

export type { FusionOptions, FusionStrategy, RankFusionOptions, RankStrategy } from './fusion.js';
