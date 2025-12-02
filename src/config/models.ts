/**
 * Centralized Model Configuration
 *
 * Single source of truth for all LLM model names and providers.
 * All model configurations should reference this file.
 *
 * Environment variables (from .env):
 * - VITE_PRIMARY_MODEL: Primary tier model name
 * - VITE_PRIMARY_PROVIDER: Primary tier provider
 * - VITE_SWARM_MODEL: Swarm tier model name
 * - VITE_SWARM_PROVIDER: Swarm tier provider
 */

export type ProviderName = 'openai' | 'google' | 'anthropic' | 'deepseek' | 'custom' | 'gemini';

export interface ModelConfig {
  provider: ProviderName;
  model: string;
  description: string;
}

/**
 * Model tier configurations
 */
export const MODELS = {
  // Primary tier - high quality, main conversations, tool use
  // Using Gemini 2.5 Flash as default - fast and capable
  PRIMARY: {
    provider: (import.meta.env?.VITE_PRIMARY_PROVIDER || 'google') as ProviderName,
    model: import.meta.env?.VITE_PRIMARY_MODEL || 'gemini-2.5-flash',
    description: 'Primary model for complex reasoning, code writing, and tool use'
  },

  // Secondary tier - alternative high-quality reasoning
  SECONDARY: {
    provider: (import.meta.env?.VITE_SECONDARY_PROVIDER || 'openai') as ProviderName,
    model: import.meta.env?.VITE_SECONDARY_MODEL || 'gpt-4o',
    description: 'Secondary model for high-quality reasoning when PRIMARY unavailable'
  },

  // Swarm tier - fast, cheap, parallel agents
  SWARM: {
    provider: (import.meta.env?.VITE_SWARM_PROVIDER || 'deepseek') as ProviderName,
    model: import.meta.env?.VITE_SWARM_MODEL || 'deepseek-reasoner',
    description: 'Swarm model for parallel agent tasks and specialist workflows'
  },

  // Architect tier - complex code mutation and evolutionary strategy design
  ARCHITECT: {
    provider: (import.meta.env?.VITE_ARCHITECT_PROVIDER || 'google') as ProviderName,
    model: import.meta.env?.VITE_ARCHITECT_MODEL || 'gemini-2.5-flash',
    description: 'The Architect - for complex code mutation and evolutionary strategy design'
  },

  // Helper tier - quick responses, no tools needed
  HELPER: {
    provider: 'openai' as ProviderName,
    model: 'gpt-4o-mini',
    description: 'Helper model for fast, simple responses'
  },

  // Memory extraction - used by daemon for background extraction
  MEMORY: {
    provider: 'openai' as ProviderName,
    model: 'gpt-4o-mini',
    description: 'Model for memory extraction (cost-optimized)'
  },

  // Embedding model - for vector embeddings
  EMBEDDING: {
    provider: 'openai' as ProviderName,
    model: 'text-embedding-3-small',
    description: 'Model for generating vector embeddings'
  }
} as const;

export type ModelTier = keyof typeof MODELS;

/**
 * Get model configuration for a specific tier
 */
export function getModelConfig(tier: ModelTier): ModelConfig {
  return MODELS[tier];
}

/**
 * Get model name for a specific tier
 */
export function getModelName(tier: ModelTier): string {
  return MODELS[tier].model;
}

/**
 * Get provider for a specific tier
 */
export function getProvider(tier: ModelTier): ProviderName {
  return MODELS[tier].provider;
}
