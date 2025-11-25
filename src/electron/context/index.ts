/**
 * Context Management Module
 *
 * Provides intelligent context window management with:
 * - Tiered protection (canon never dropped)
 * - Smart compression (summarize before truncating)
 * - Budget monitoring (track usage across tiers)
 */

export { ContextManager, getContextManager } from './ContextManager';
export type { Message, ContextTier, ContextBudgetStatus, CompressedContext } from './ContextManager';

export { ProtectedCanonLoader, getProtectedCanonLoader } from './ProtectedCanonLoader';
export type { ProtectedMemory, ProtectedCanon } from './ProtectedCanonLoader';
