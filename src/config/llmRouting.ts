/**
 * LLM Tier Routing Configuration
 * 
 * Defines model selection for different reasoning tiers:
 * - PRIMARY: High-stakes reasoning (code writing, architecture, complex strategy analysis)
 * - SWARM: Agent/specialist workflows (audit, pattern mining, curation, risk review)
 */

export type LlmTier = 'primary' | 'secondary' | 'swarm';
export type ProviderName = 'openai' | 'google' | 'anthropic' | 'deepseek' | 'custom';

/**
 * Model configuration for PRIMARY tier
 * Used for: Main chat, final synthesizers, high-stakes reasoning
 * Provider: Google Gemini (thinking mode)
 */
export const PRIMARY_MODEL = import.meta.env.VITE_PRIMARY_MODEL || 'gemini-2.0-flash-thinking-exp-1219';
export const PRIMARY_PROVIDER = (import.meta.env.VITE_PRIMARY_PROVIDER || 'google') as ProviderName;

/**
 * Model configuration for SECONDARY tier
 * Used for: Alternative high-quality reasoning when PRIMARY is unavailable
 * Provider: OpenAI GPT-5.1
 */
export const SECONDARY_MODEL = import.meta.env.VITE_SECONDARY_MODEL || 'gpt-4o';
export const SECONDARY_PROVIDER = (import.meta.env.VITE_SECONDARY_PROVIDER || 'openai') as ProviderName;

/**
 * Model configuration for SWARM tier
 * Used for: Agent modes, specialist analysis, repetitive workflows
 * Provider: DeepSeek-Reasoner
 */
export const SWARM_MODEL = import.meta.env.VITE_SWARM_MODEL || 'deepseek-reasoner';
export const SWARM_PROVIDER = (import.meta.env.VITE_SWARM_PROVIDER || 'deepseek') as ProviderName;

/**
 * Get model name for a specific tier
 */
export function getModelForTier(tier: LlmTier): string {
  if (tier === 'primary') return PRIMARY_MODEL;
  if (tier === 'secondary') return SECONDARY_MODEL;
  return SWARM_MODEL;
}

/**
 * Get provider name for a specific tier
 */
export function getProviderForTier(tier: LlmTier): ProviderName {
  if (tier === 'primary') return PRIMARY_PROVIDER;
  if (tier === 'secondary') return SECONDARY_PROVIDER;
  return SWARM_PROVIDER;
}

/**
 * Map of edge function names to their tiers
 */
export const FUNCTION_TIER_MAP: Record<string, LlmTier> = {
  'chat-primary': 'primary',
  'chat-swarm': 'swarm',
};
