/**
 * ContextManager - Intelligent Context Window Management
 *
 * Implements tiered context protection and smart compression.
 * Inspired by Anthropic's context engineering principles:
 * "Find the smallest set of high-signal tokens that maximize desired outcome"
 *
 * Architecture:
 * - Tier 0: Protected Canon (LESSONS_LEARNED, critical rules) - NEVER dropped
 * - Tier 1: Working Memory (current task, decisions) - Summarized if needed
 * - Tier 2: Retrieved Context (memories, triggers) - Just-in-time, rotates
 * - Tier 3: Conversation History - Oldest summarized first, then dropped
 */

import OpenAI from 'openai';
import { MODELS } from '../../config/models';

// Context budget allocation (as percentage of max tokens)
const CONTEXT_BUDGET = {
  TIER_0_CANON: 0.10,      // 10% reserved for protected canon
  TIER_1_WORKING: 0.10,    // 10% for working memory/scratchpad
  TIER_2_RETRIEVED: 0.15,  // 15% for just-in-time retrieved memories
  TIER_3_HISTORY: 0.65,    // 65% for conversation history
};

// Thresholds
const COMPRESSION_THRESHOLD = 0.80;  // Start compressing at 80% capacity
const SUMMARIZATION_THRESHOLD = 0.90; // Start summarizing at 90%
const HARD_LIMIT = 0.95;              // Hard drop at 95%

// Approximate tokens per character (conservative estimate)
const CHARS_PER_TOKEN = 4;

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
  extracted?: boolean;  // Has this been extracted to memory?
}

export interface ContextTier {
  tier: 0 | 1 | 2 | 3;
  content: string;
  tokenEstimate: number;
  protected: boolean;
}

export interface ContextBudgetStatus {
  totalTokens: number;
  maxTokens: number;
  usagePercent: number;
  tierBreakdown: {
    tier0: number;
    tier1: number;
    tier2: number;
    tier3: number;
  };
  needsCompression: boolean;
  needsSummarization: boolean;
  atHardLimit: boolean;
}

export interface CompressedContext {
  systemPrompt: string;      // Tier 0 + Tier 1
  retrievedMemories: string; // Tier 2
  conversationHistory: Message[]; // Tier 3 (possibly summarized)
  summary?: string;          // Summary of dropped content
  status: ContextBudgetStatus;
}

export class ContextManager {
  private openaiClient: OpenAI | null = null;
  private maxTokens: number;

  constructor(maxTokens: number = 128000) { // Gemini 1.5 Pro default
    this.maxTokens = maxTokens;

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    }
  }

  /**
   * Estimate token count from text
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Calculate current context budget status
   */
  calculateBudgetStatus(
    tier0Content: string,
    tier1Content: string,
    tier2Content: string,
    messages: Message[]
  ): ContextBudgetStatus {
    const tier0Tokens = this.estimateTokens(tier0Content);
    const tier1Tokens = this.estimateTokens(tier1Content);
    const tier2Tokens = this.estimateTokens(tier2Content);
    const tier3Tokens = messages.reduce(
      (sum, m) => sum + this.estimateTokens(m.content),
      0
    );

    const totalTokens = tier0Tokens + tier1Tokens + tier2Tokens + tier3Tokens;
    const usagePercent = totalTokens / this.maxTokens;

    return {
      totalTokens,
      maxTokens: this.maxTokens,
      usagePercent,
      tierBreakdown: {
        tier0: tier0Tokens,
        tier1: tier1Tokens,
        tier2: tier2Tokens,
        tier3: tier3Tokens,
      },
      needsCompression: usagePercent >= COMPRESSION_THRESHOLD,
      needsSummarization: usagePercent >= SUMMARIZATION_THRESHOLD,
      atHardLimit: usagePercent >= HARD_LIMIT,
    };
  }

  /**
   * Summarize a batch of messages into a compressed form
   */
  async summarizeMessages(messages: Message[]): Promise<string> {
    if (!this.openaiClient || messages.length === 0) {
      // Fallback: simple truncation
      return messages
        .map(m => `[${m.role}]: ${m.content.slice(0, 100)}...`)
        .join('\n');
    }

    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: MODELS.HELPER.model,
        messages: [
          {
            role: 'system',
            content: `You are a conversation summarizer. Create a concise summary that preserves:
1. Key decisions made
2. Important facts discovered
3. Current task state and progress
4. Any unresolved questions or next steps

Be extremely concise. Use bullet points. Aim for 10-20% of original length.`
          },
          {
            role: 'user',
            content: `Summarize this conversation:\n\n${conversationText}`
          }
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content || 'Summary unavailable';
    } catch (error) {
      console.error('[ContextManager] Summarization failed:', error);
      // Fallback
      return messages
        .slice(-3)
        .map(m => `[${m.role}]: ${m.content.slice(0, 200)}...`)
        .join('\n');
    }
  }

  /**
   * Compress context to fit within budget
   *
   * Strategy:
   * 1. Never touch Tier 0 (protected canon)
   * 2. If needed, compress Tier 1 (working memory)
   * 3. Rotate Tier 2 (retrieved memories) - keep most relevant
   * 4. Summarize oldest Tier 3 messages, keep recent ones full
   */
  async compressContext(
    tier0Canon: string,
    tier1Working: string,
    tier2Retrieved: string,
    messages: Message[],
    recentMessageCount: number = 10
  ): Promise<CompressedContext> {

    const status = this.calculateBudgetStatus(
      tier0Canon,
      tier1Working,
      tier2Retrieved,
      messages
    );

    // If we're under threshold, return as-is
    if (!status.needsCompression) {
      return {
        systemPrompt: `${tier0Canon}\n\n${tier1Working}`,
        retrievedMemories: tier2Retrieved,
        conversationHistory: messages,
        status,
      };
    }

    console.log(`[ContextManager] Compression needed: ${(status.usagePercent * 100).toFixed(1)}% usage`);

    // Split messages: recent (keep full) vs older (candidates for summarization)
    const recentMessages = messages.slice(-recentMessageCount);
    const olderMessages = messages.slice(0, -recentMessageCount);

    let summary: string | undefined;
    let finalMessages = messages;

    // If we need summarization, summarize older messages
    if (status.needsSummarization && olderMessages.length > 0) {
      console.log(`[ContextManager] Summarizing ${olderMessages.length} older messages`);

      summary = await this.summarizeMessages(olderMessages);

      // Create a summary message to preserve context
      const summaryMessage: Message = {
        role: 'system',
        content: `[CONTEXT SUMMARY - Previous conversation compressed]\n${summary}`,
        timestamp: Date.now(),
        extracted: true, // Mark as already processed
      };

      finalMessages = [summaryMessage, ...recentMessages];
    }

    // If still at hard limit, drop oldest non-protected content
    if (status.atHardLimit) {
      console.log('[ContextManager] At hard limit - dropping oldest messages');

      // Keep only very recent messages
      const emergencyRecentCount = Math.min(5, recentMessages.length);
      finalMessages = finalMessages.slice(-emergencyRecentCount);

      // Also trim retrieved memories
      const tier2Budget = Math.floor(this.maxTokens * CONTEXT_BUDGET.TIER_2_RETRIEVED);
      const tier2Tokens = this.estimateTokens(tier2Retrieved);

      if (tier2Tokens > tier2Budget) {
        // Truncate retrieved memories to budget
        const targetChars = tier2Budget * CHARS_PER_TOKEN;
        tier2Retrieved = tier2Retrieved.slice(0, targetChars) + '\n[...memories truncated]';
      }
    }

    // Recalculate final status
    const finalStatus = this.calculateBudgetStatus(
      tier0Canon,
      tier1Working,
      tier2Retrieved,
      finalMessages
    );

    return {
      systemPrompt: `${tier0Canon}\n\n${tier1Working}`,
      retrievedMemories: tier2Retrieved,
      conversationHistory: finalMessages,
      summary,
      status: finalStatus,
    };
  }

  /**
   * Build the final LLM messages array with proper context management
   */
  async buildLLMMessages(
    baseSystemPrompt: string,
    protectedCanon: string,
    workingMemory: string,
    retrievedMemories: string,
    conversationHistory: Message[],
    newUserMessage: string
  ): Promise<{ messages: Array<{ role: string; content: string }>; status: ContextBudgetStatus }> {

    // Tier 0: Protected canon (LESSONS_LEARNED, critical rules)
    const tier0 = protectedCanon
      ? `\n\n---\n## CRITICAL LESSONS (Protected - Never Ignore)\n${protectedCanon}\n---\n`
      : '';

    // Tier 1: Working memory (current task state)
    const tier1 = workingMemory
      ? `\n\n## Current Working Context\n${workingMemory}\n`
      : '';

    // Tier 2: Retrieved memories
    const tier2 = retrievedMemories
      ? `\n\n## Recalled Memories\n${retrievedMemories}\n`
      : '';

    // Compress if needed
    const compressed = await this.compressContext(
      `${baseSystemPrompt}${tier0}`,
      tier1,
      tier2,
      conversationHistory
    );

    // Build final messages array
    const llmMessages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: `${compressed.systemPrompt}\n${compressed.retrievedMemories}`
      },
      ...compressed.conversationHistory.map(m => ({
        role: m.role,
        content: m.content,
      })),
      { role: 'user', content: newUserMessage },
    ];

    // Log status for monitoring
    console.log(`[ContextManager] Final context: ${compressed.status.totalTokens} tokens (${(compressed.status.usagePercent * 100).toFixed(1)}%)`);
    if (compressed.summary) {
      console.log('[ContextManager] Conversation was summarized to fit context');
    }

    return {
      messages: llmMessages,
      status: compressed.status,
    };
  }
}

// Singleton instance
let contextManagerInstance: ContextManager | null = null;

export function getContextManager(maxTokens?: number): ContextManager {
  if (!contextManagerInstance) {
    contextManagerInstance = new ContextManager(maxTokens);
  }
  return contextManagerInstance;
}
