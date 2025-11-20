/**
 * LLM Tier Routing Configuration
 * 
 * Defines model selection for different reasoning tiers:
 * - PRIMARY: High-stakes reasoning (code writing, architecture, complex strategy analysis)
 * - SWARM: Agent/specialist workflows (audit, pattern mining, curation, risk review)
 */

export type LlmTier = 'primary' | 'swarm';

/**
 * Model configuration for PRIMARY tier
 * Used for: Main chat, final synthesizers, high-stakes reasoning
 */
export const PRIMARY_MODEL = import.meta.env.VITE_PRIMARY_MODEL || 'gpt-5-2025-08-07';

/**
 * Model configuration for SWARM tier
 * Used for: Agent modes, specialist analysis, repetitive workflows
 */
export const SWARM_MODEL = import.meta.env.VITE_SWARM_MODEL || PRIMARY_MODEL;

/**
 * Get model name for a specific tier
 */
export function getModelForTier(tier: LlmTier): string {
  return tier === 'primary' ? PRIMARY_MODEL : SWARM_MODEL;
}

/**
 * Map of edge function names to their tiers
 */
export const FUNCTION_TIER_MAP: Record<string, LlmTier> = {
  'chat-primary': 'primary',
  'chat-swarm': 'swarm',
};
