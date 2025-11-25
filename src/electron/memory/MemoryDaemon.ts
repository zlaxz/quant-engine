/**
 * MemoryDaemon - Background Memory Extraction
 * SECURITY FIXES: Input validation, reused client, safe JSON parsing
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MODELS } from '../../config/models';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExtractedMemory {
  content: string;
  summary: string;
  type: 'observation' | 'lesson' | 'rule' | 'strategy' | 'mistake' | 'success';
  category?: string;
  symbols?: string[];
  strategies?: string[];
  importance: number;
  entities?: Array<{ type: string; name: string; value?: any }>;
  confidence?: number;
}

interface ExtractionConfig {
  intervalMs: number;
  minImportance: number;
  batchSize: number;
}

export class MemoryDaemon extends EventEmitter {
  private localDb: Database.Database;
  private supabase: SupabaseClient;
  private config: ExtractionConfig;
  private extractionTimer?: NodeJS.Timeout;
  private isExtracting: boolean = false;
  private openaiClient: OpenAI | null = null;

  constructor(
    localDb: Database.Database,
    supabase: SupabaseClient,
    config?: Partial<ExtractionConfig>
  ) {
    super();
    this.localDb = localDb;
    this.supabase = supabase;

    // FIX #4: Input validation for config parameters
    const defaultConfig: ExtractionConfig = {
      intervalMs: 30000, // 30 seconds
      minImportance: 0.3,
      batchSize: 10,
    };

    const validatedConfig = { ...defaultConfig, ...config };
    
    // Validate intervalMs (>= 5000ms)
    if (typeof validatedConfig.intervalMs !== 'number' || validatedConfig.intervalMs < 5000) {
      console.error('[MemoryDaemon] Invalid intervalMs: must be >= 5000ms');
      validatedConfig.intervalMs = defaultConfig.intervalMs;
    }
    
    // Validate batchSize (1-100)
    if (
      typeof validatedConfig.batchSize !== 'number' ||
      validatedConfig.batchSize < 1 ||
      validatedConfig.batchSize > 100
    ) {
      console.error('[MemoryDaemon] Invalid batchSize: must be between 1 and 100');
      validatedConfig.batchSize = defaultConfig.batchSize;
    }
    
    // Validate minImportance (0.0-1.0)
    if (
      typeof validatedConfig.minImportance !== 'number' ||
      validatedConfig.minImportance < 0 ||
      validatedConfig.minImportance > 1
    ) {
      console.error('[MemoryDaemon] Invalid minImportance: must be between 0.0 and 1.0');
      validatedConfig.minImportance = defaultConfig.minImportance;
    }

    this.config = validatedConfig;

    // FIX #2: Initialize OpenAI client once in constructor, reuse everywhere
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    }
  }

  async start(): Promise<void> {
    console.log('[MemoryDaemon] Starting extraction daemon...');

    this.initializeLocalDb();
    await this.extractionCycle();

    this.extractionTimer = setInterval(() => {
      this.extractionCycle().catch((err) => {
        console.error('[MemoryDaemon] Extraction cycle error:', err);
        this.emit('error', err);
      });
    }, this.config.intervalMs);

    this.emit('started');
    console.log(`[MemoryDaemon] Daemon started (interval: ${this.config.intervalMs}ms)`);
  }

  async stop(): Promise<void> {
    console.log('[MemoryDaemon] Stopping daemon...');

    if (this.extractionTimer) {
      clearInterval(this.extractionTimer);
      this.extractionTimer = undefined;
    }

    while (this.isExtracting) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.emit('stopped');
    console.log('[MemoryDaemon] Daemon stopped');
  }

  private async extractionCycle(): Promise<void> {
    if (this.isExtracting) {
      console.log('[MemoryDaemon] Extraction in progress, skipping cycle');
      return;
    }

    this.isExtracting = true;

    try {
      const { data: sessions } = await this.supabase
        .from('chat_sessions')
        .select('id, workspace_id')
        .order('updated_at', { ascending: false })
        .limit(10);

      if (!sessions || sessions.length === 0) {
        return;
      }

      // Process sessions in parallel (limit to 3 concurrent)
      const limit = pLimit(3);
      await Promise.all(
        sessions.map((session) =>
          limit(() => this.processSession(session.id, session.workspace_id))
        )
      );
    } catch (error) {
      console.error('[MemoryDaemon] Extraction cycle error:', error);
      this.emit('error', error);
    } finally {
      this.isExtracting = false;
    }
  }

  private async processSession(sessionId: string, workspaceId: string): Promise<void> {
    const state = this.localDb
      .prepare('SELECT last_message_id FROM extraction_state WHERE session_id = ?')
      .get(sessionId) as any;

    const lastMessageId = state?.last_message_id;

    let query = this.supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(this.config.batchSize);

    if (lastMessageId) {
      query = query.gt('id', lastMessageId);
    }

    const { data: messages, error } = await query;

    if (error || !messages || messages.length === 0) {
      return;
    }

    console.log(`[MemoryDaemon] Processing ${messages.length} messages from session ${sessionId.slice(0, 8)}`);

    const memories = await this.extractMemoriesFromMessages(messages);

    if (memories.length > 0) {
      const significant = memories.filter((m) => m.importance >= this.config.minImportance);

      if (significant.length > 0) {
        await this.saveMemories(significant, sessionId, workspaceId);

        console.log(`[MemoryDaemon] Saved ${significant.length} memories from ${messages.length} messages`);
        this.emit('memories-extracted', { count: significant.length, sessionId });
      }
    }

    // CRASH FIX #4: Array bounds check before accessing last element
    if (messages.length === 0) {
      console.warn('[MemoryDaemon] No messages to extract state from');
      return;
    }
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || !lastMessage.id) {
      console.error('[MemoryDaemon] Invalid last message structure');
      return;
    }
    this.updateExtractionState(sessionId, workspaceId, lastMessage.id, messages.length);
  }

  private async extractMemoriesFromMessages(messages: any[]): Promise<ExtractedMemory[]> {
    const context = messages.map((m) => `[${m.role}]: ${m.content}`).join('\n\n');
    const prompt = this.buildExtractionPrompt(context);

    try {
      // FIX #2: Use reused OpenAI client instead of creating new instance
      if (!this.openaiClient) {
        console.error('[MemoryDaemon] OPENAI_API_KEY not configured');
        return [];
      }

      const completion = await this.openaiClient.chat.completions.create({
        model: MODELS.MEMORY.model,
        messages: [
          {
            role: 'system',
            content: 'You are a trading memory extraction specialist. Extract ALL relevant memories as JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      // Safe array access with bounds checking
      if (!completion.choices || completion.choices.length === 0) {
        console.error('[MemoryDaemon] Invalid completion response - no choices');
        return [];
      }

      const response = completion.choices[0]?.message?.content;
      if (!response) return [];

      // FIX #3: Safe JSON parsing with try-catch
      try {
        const parsed = JSON.parse(response);
        return parsed.memories || [];
      } catch (parseError) {
        console.error('[MemoryDaemon] Failed to parse LLM response as JSON:', parseError);
        console.error('[MemoryDaemon] Response was:', response.slice(0, 200));
        return [];
      }
    } catch (error) {
      console.error('[MemoryDaemon] Extraction LLM error:', error);
      return [];
    }
  }

  private async saveMemories(
    memories: ExtractedMemory[],
    sessionId: string,
    workspaceId: string
  ): Promise<void> {
    const memoriesWithEmbeddings = await Promise.all(
      memories.map(async (m) => ({
        ...m,
        embedding: await this.generateEmbedding(m.content),
      }))
    );

    const supabaseRecords = memoriesWithEmbeddings
      .filter((m) => m.embedding !== null)
      .map((m) => ({
        workspace_id: workspaceId,
        session_id: sessionId,
        content: m.content,
        summary: m.summary,
        memory_type: m.type,
        category: m.category || null,
        symbols: m.symbols || null,
        strategies: m.strategies || null,
        importance_score: m.importance,
        entities: m.entities || null,
        embedding: m.embedding,
        confidence: m.confidence || 1.0,
        source: 'daemon',
      }));

    if (supabaseRecords.length > 0) {
      const { data, error } = await this.supabase
        .from('memory_notes')
        .insert(supabaseRecords)
        .select('id');

      if (error) {
        console.error('[MemoryDaemon] Supabase insert error:', error);
        return;
      }

      const insertStmt = this.localDb.prepare(`
        INSERT OR REPLACE INTO memory_cache
        (id, workspace_id, content, summary, importance_score, memory_type, category, symbols, created_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertFtsStmt = this.localDb.prepare(`
        INSERT OR REPLACE INTO memory_fts (id, content, summary, category)
        VALUES (?, ?, ?, ?)
      `);

      const now = Date.now();

      // Wrap batch inserts in transaction for atomicity and performance
      const insertTransaction = this.localDb.transaction(
        (items: Array<{ memory: ExtractedMemory; id: string }>) => {
          for (const { memory, id } of items) {
            insertStmt.run(
              id,
              workspaceId,
              memory.content,
              memory.summary,
              memory.importance,
              memory.type,
              memory.category || null,
              memory.symbols ? memory.symbols : null,
              now,
              now
            );

            insertFtsStmt.run(id, memory.content, memory.summary, memory.category || '');
          }
        }
      );

      // CRASH FIX #2: Array bounds check - validate data array exists and has length
      if (!data || data.length === 0) {
        console.warn('[MemoryDaemon] No data returned from insert, skipping transaction');
        return;
      }

      const transactionData = data.map((item: any, i: number) => {
        // CRASH FIX #3: Bounds check when accessing memoriesWithEmbeddings
        if (i >= memoriesWithEmbeddings.length) {
          console.error(`[MemoryDaemon] Index ${i} out of bounds for memoriesWithEmbeddings (length: ${memoriesWithEmbeddings.length})`);
          return null;
        }
        return {
          memory: memoriesWithEmbeddings[i],
          id: item.id,
        };
      }).filter((item): item is any => item !== null);

      if (transactionData.length === 0) {
        console.warn('[MemoryDaemon] No valid transaction data after filtering');
        return;
      }

      try {
        insertTransaction(transactionData);
      } catch (error) {
        console.error('[MemoryDaemon] Transaction error saving memories:', error);
      }
    }
  }

  // FIX #3: Error handling in embedding generation with array bounds checking
  private async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.openaiClient) return null;

    try {
      const response = await this.openaiClient.embeddings.create({
        model: MODELS.EMBEDDING.model,
        input: text.trim(),
      });

      // CRASH FIX #1: Array bounds check before accessing [0]
      if (!response.data || response.data.length === 0) {
        console.error('[MemoryDaemon] Invalid embedding response - no data');
        return null;
      }

      const embedding = response.data[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        console.error('[MemoryDaemon] Invalid embedding structure');
        return null;
      }

      return embedding;
    } catch (error) {
      console.error('[MemoryDaemon] Embedding generation error:', error);
      return null;
    }
  }

  private initializeLocalDb(): void {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    this.localDb.exec(schema);
    console.log('[MemoryDaemon] Local database initialized');
  }

  private updateExtractionState(
    sessionId: string,
    workspaceId: string,
    lastMessageId: string,
    messagesProcessed: number
  ): void {
    this.localDb
      .prepare(
        `
        INSERT OR REPLACE INTO extraction_state
        (session_id, workspace_id, last_message_id, last_extraction, messages_processed)
        VALUES (?, ?, ?, ?, COALESCE((SELECT messages_processed FROM extraction_state WHERE session_id = ?), 0) + ?)
      `
      )
      .run(sessionId, workspaceId, lastMessageId, Date.now(), sessionId, messagesProcessed);
  }

  private buildExtractionPrompt(context: string): string {
    return `You are a quantitative strategy research memory extraction specialist. Extract BACKTEST INSIGHTS and STATISTICAL PATTERNS, not individual trades.

CONVERSATION CONTEXT:
${context.slice(0, 4000)}

Extract memories in these categories:
- BACKTEST_RESULT: Strategy performance in specific regime (include Sharpe, regime, profile)
- OVERFITTING_WARNING: Statistical red flags (PBO, WFE, parameter sensitivity)
- REGIME_INSIGHT: Regime-dependent behaviors
- PARAMETER_SENSITIVITY: Fragility vs robustness
- STATISTICAL_PATTERN: Cross-strategy learnings
- EXECUTION_GOTCHA: Real-world constraints

For each memory:
{
  "content": "Full insight with numbers",
  "summary": "One-line takeaway",
  "type": "observation|lesson|rule|strategy|mistake|success",
  "category": "backtest_result|overfitting_warning|regime_insight|parameter_sensitivity|statistical_pattern|execution_gotcha",
  "importance": 0.0-1.0,
  "regime_context": {
    "primary_regime": 1-6 or null,
    "convexity_profile": 1-6 or null
  },
  "confidence": 0.0-1.0
}

BE AGGRESSIVE - extract ALL statistical insights and regime dependencies.

Return as JSON: {"memories": [...]}`;
  }

  /**
   * Get total memory count from local cache
   */
  getMemoryCount(): number {
    try {
      const stmt = this.localDb.prepare('SELECT COUNT(*) as count FROM memory_cache');
      const result = stmt.get() as any;
      return result?.count || 0;
    } catch (error) {
      console.error('[MemoryDaemon] Error getting memory count:', error);
      return 0;
    }
  }
}
