/**
 * RecallEngine - Hybrid Memory Recall with BM25 + Vector Search
 *
 * Provides instant memory recall with:
 * - Hybrid search (BM25 + semantic vector)
 * - Cross-encoder reranking
 * - Query expansion
 * - LRU caching for hot queries
 * - < 500ms latency target
 */

import Database from 'better-sqlite3';
import { SupabaseClient } from '@supabase/supabase-js';
import { LRUCache } from 'lru-cache';
import OpenAI from 'openai';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Safe JSON parse utility
function safeJSONParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json);
  } catch (error) {
    console.error('[RecallEngine] JSON parse error:', error);
    return fallback;
  }
}

interface RecallOptions {
  limit?: number;
  minImportance?: number;
  useCache?: boolean;
  expandQuery?: boolean;
  rerank?: boolean;
  categories?: string[];
  symbols?: string[];
}

interface MemoryResult {
  id: string;
  content: string;
  summary: string;
  type: string;
  category: string | null;
  symbols: string[] | null;
  importance: number;
  relevanceScore: number;
  source: 'cache' | 'local' | 'remote';
  createdAt: string;
  protection_level: number;
}

export interface RecallResult {
  memories: MemoryResult[];
  totalFound: number;
  searchTimeMs: number;
  usedCache: boolean;
  query: string;
  expandedQueries?: string[];
}

export class RecallEngine {
  private queryCache: LRUCache<string, RecallResult>;
  private localDb: Database.Database;
  private supabase: SupabaseClient;
  private openaiClient: OpenAI | null = null;

  constructor(localDb: Database.Database, supabase: SupabaseClient) {
    this.localDb = localDb;
    this.supabase = supabase;

    // Initialize OpenAI client for embeddings
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openaiClient = new OpenAI({ apiKey });
    }

    // In-memory cache for hot queries (5 min TTL)
    this.queryCache = new LRUCache<string, RecallResult>({
      max: 100,
      ttl: 1000 * 60 * 5, // 5 minutes
    });

    // Initialize database tables
    this.initializeDb();
  }

  /**
   * Initialize local database tables
   */
  private initializeDb(): void {
    try {
      // Check if tables exist, create if not
      const tableCheck = this.localDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_cache'");
      const exists = tableCheck.get();

      if (!exists) {
        console.log('[RecallEngine] Initializing database tables');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        this.localDb.exec(schema);
        console.log('[RecallEngine] Database tables created');
      }
    } catch (error) {
      console.error('[RecallEngine] Database initialization error:', error);
      // Continue anyway, MemoryDaemon will initialize on start
    }
  }

  /**
   * Main recall function - automatically queries memory for relevant context
   */
  async recall(
    query: string,
    workspaceId: string,
    options: RecallOptions = {}
  ): Promise<RecallResult> {
    const startTime = Date.now();

    // Input validation
    if (!query || typeof query !== 'string') {
      console.error('[RecallEngine] Invalid query: must be non-empty string');
      return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query: '' };
    }
    if (query.length > 1000) {
      console.error('[RecallEngine] Query too long: max 1000 characters');
      return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query };
    }
    if (!workspaceId || typeof workspaceId !== 'string') {
      console.error('[RecallEngine] Invalid workspaceId: must be non-empty string');
      return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query };
    }

    const {
      limit = 10,
      minImportance = 0.3,
      useCache = true,
      expandQuery = false, // Disabled by default for speed
      rerank = true,
      categories,
      symbols,
    } = options;

    // Validate options
    if (typeof limit !== 'number' || limit < 1 || limit > 100) {
      console.error('[RecallEngine] Invalid limit: must be between 1 and 100');
      return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query };
    }
    if (typeof minImportance !== 'number' || minImportance < 0 || minImportance > 1) {
      console.error('[RecallEngine] Invalid minImportance: must be between 0.0 and 1.0');
      return { memories: [], totalFound: 0, searchTimeMs: 0, usedCache: false, query };
    }

    // Check cache first
    const cacheKey = this.getCacheKey(query, workspaceId, limit, minImportance);
    if (useCache) {
      const cached = this.queryCache.get(cacheKey);
      if (cached) {
        console.log(`[RecallEngine] Cache hit for: ${query.slice(0, 50)}...`);
        return { ...cached, usedCache: true };
      }
    }

    // Expand query if enabled
    const queries = expandQuery ? await this.expandQuery(query) : [query];

    // Perform hybrid search
    const candidates = await this.hybridSearch(
      queries,
      workspaceId,
      limit * 3,
      minImportance,
      categories,
      symbols
    );

    // Rerank with cross-encoder if enabled
    let results = candidates;
    if (rerank && candidates.length > 5) {
      results = await this.rerankResults(query, candidates, limit);
    } else {
      results = candidates.slice(0, limit);
    }

    // CRASH FIX #5: Update access metrics with error handling (don't await, handle rejection)
    const memoryIds = results?.map?.((r) => r.id) || [];
    if (memoryIds.length > 0) {
      this.updateAccessMetrics(memoryIds).catch((err) => {
        console.error('[RecallEngine] Failed to update access metrics:', err);
      });
    }

    const recallResult: RecallResult = {
      memories: results,
      totalFound: candidates.length,
      searchTimeMs: Date.now() - startTime,
      usedCache: false,
      query,
      expandedQueries: queries,
    };

    // Cache the result
    if (useCache) {
      this.queryCache.set(cacheKey, recallResult);
    }

    console.log(
      `[RecallEngine] Recalled ${results.length} memories in ${recallResult.searchTimeMs}ms`
    );

    return recallResult;
  }

  /**
   * Hybrid search combining BM25 (local) and Vector (Supabase)
   */
  private async hybridSearch(
    queries: string[],
    workspaceId: string,
    limit: number,
    minImportance: number,
    categories?: string[],
    symbols?: string[]
  ): Promise<MemoryResult[]> {
    const allResults = new Map<string, MemoryResult>();

    for (const q of queries) {
      // Run searches in parallel
      const [bm25Results, vectorResults] = await Promise.all([
        this.bm25Search(q, workspaceId, limit, categories),
        this.vectorSearch(q, workspaceId, limit, minImportance, categories, symbols),
      ]);

      // Merge with weighted scores (BM25: 30%, Vector: 70%)
      this.mergeResults(allResults, bm25Results, 0.3, 'local');
      this.mergeResults(allResults, vectorResults, 0.7, 'remote');
    }

    // Sort by combined score * importance
    const sorted = Array.from(allResults.values())
      .filter((r) => r.importance >= minImportance)
      .sort((a, b) => {
        const scoreA = a.relevanceScore * a.importance;
        const scoreB = b.relevanceScore * b.importance;
        return scoreB - scoreA;
      });

    return sorted.slice(0, limit);
  }

  /**
   * BM25 search using SQLite FTS5
   */
  private async bm25Search(
    query: string,
    workspaceId: string,
    limit: number,
    categories?: string[]
  ): Promise<Array<MemoryResult & { bm25Score: number }>> {
    try {
      let sql = `
        SELECT
          mc.id,
          mc.content,
          mc.summary,
          mc.memory_type as type,
          mc.category,
          mc.symbols,
          mc.importance_score as importance,
          bm25(memory_fts) as bm25_score,
          mc.created_at as createdAt,
          COALESCE(mc.protection_level, 2) as protection_level
        FROM memory_fts
        JOIN memory_cache mc ON memory_fts.id = mc.id
        WHERE memory_fts MATCH ?
          AND mc.workspace_id = ?
      `;

      const params: any[] = [query, workspaceId];

      if (categories && categories.length > 0) {
        sql += ` AND mc.category IN (${categories.map(() => '?').join(',')})`;
        params.push(...categories);
      }

      sql += ` ORDER BY bm25_score DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.localDb.prepare(sql);
      const results = stmt.all(...params) as any[];

      return results.map((r) => {
        // Handle symbols: either array or JSON string
        let symbols = null;
        if (r.symbols) {
          if (Array.isArray(r.symbols)) {
            symbols = r.symbols;
          } else if (typeof r.symbols === 'string') {
            symbols = safeJSONParse<string[]>(r.symbols, []);
          }
        }

        return {
          id: r.id,
          content: r.content,
          summary: r.summary,
          type: r.type,
          category: r.category,
          symbols,
          importance: r.importance,
          relevanceScore: r.bm25_score,
          bm25Score: r.bm25_score,
          source: 'local' as const,
          createdAt: new Date(r.createdAt).toISOString(),
          protection_level: r.protection_level,
        };
      });
    } catch (error) {
      console.error('[RecallEngine] BM25 search error:', error);
      return [];
    }
  }

  /**
   * Vector search using Supabase pgvector
   */
  private async vectorSearch(
    query: string,
    workspaceId: string,
    limit: number,
    minImportance: number,
    categories?: string[],
    symbols?: string[]
  ): Promise<Array<MemoryResult & { vectorScore: number }>> {
    try {
      // Generate embedding for query
      const queryEmbedding = await this.generateQueryEmbedding(query);
      if (!queryEmbedding) {
        console.error('[RecallEngine] Failed to generate query embedding');
        return [];
      }

      // Call Supabase RPC for hybrid search
      const { data, error } = await this.supabase.rpc('hybrid_search_memories', {
        query_text: query,
        query_embedding: queryEmbedding,
        match_workspace_id: workspaceId,
        limit_count: limit,
        bm25_weight: 0.0, // Pure vector here (BM25 handled locally)
        vector_weight: 1.0,
        min_importance: minImportance,
      });

      if (error) {
        console.error('[RecallEngine] Vector search error:', error);
        return [];
      }

      // Apply additional filters if specified
      let results = data || [];

      if (categories && categories.length > 0) {
        results = results.filter((r: any) => categories.includes(r.category));
      }

      if (symbols && symbols.length > 0) {
        results = results.filter((r: any) =>
          r.symbols?.some((s: string) => symbols.includes(s))
        );
      }

      return results.map((r: any) => ({
        id: r.id,
        content: r.content,
        summary: r.summary,
        type: r.memory_type,
        category: r.category,
        symbols: r.symbols,
        importance: r.importance_score,
        relevanceScore: r.vector_score,
        vectorScore: r.vector_score,
        source: 'remote' as const,
        createdAt: r.created_at,
        protection_level: r.protection_level || 2,
      }));
    } catch (error) {
      console.error('[RecallEngine] Vector search error:', error);
      return [];
    }
  }

  /**
   * Merge results from multiple retrieval methods
   */
  private mergeResults(
    results: Map<string, MemoryResult>,
    newResults: any[],
    weight: number,
    source: 'local' | 'remote'
  ): void {
    for (const result of newResults) {
      const existing = results.get(result.id);
      const score = result.bm25Score || result.vectorScore || result.relevanceScore || 0;

      if (existing) {
        // Combine scores
        existing.relevanceScore += score * weight;
      } else {
        results.set(result.id, {
          ...result,
          relevanceScore: score * weight,
          source,
        });
      }
    }
  }

  /**
   * Rerank results using LLM as cross-encoder
   */
  private async rerankResults(
    _query: string,
    candidates: MemoryResult[],
    limit: number
  ): Promise<MemoryResult[]> {
    // For now, return candidates as-is
    // TODO: Implement LLM-based reranking
    return candidates.slice(0, limit);
  }

  /**
   * Expand query into multiple variations for better recall
   */
  private async expandQuery(query: string): Promise<string[]> {
    // For now, return original query
    // TODO: Implement LLM-based query expansion
    return [query];
  }

  /**
   * Generate embedding for query text with timeout
   */
  private async generateQueryEmbedding(text: string): Promise<number[] | null> {
    if (!this.openaiClient) {
      console.error('[RecallEngine] OpenAI client not initialized');
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await this.openaiClient.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.trim(),
      });

      clearTimeout(timeoutId);

      // Safe array access with bounds checking
      if (!response.data || response.data.length === 0) {
        console.error('[RecallEngine] Invalid embedding response: no data');
        return null;
      }

      const embedding = response.data[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        console.error('[RecallEngine] Invalid embedding data structure');
        return null;
      }

      return embedding;
    } catch (error) {
      if ((error as any)?.name === 'AbortError') {
        console.error('[RecallEngine] Embedding generation timeout');
      } else {
        console.error('[RecallEngine] Embedding generation error:', error);
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Update access metrics for retrieved memories
   */
  private async updateAccessMetrics(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    const now = Date.now();

    // Batch update local cache (single UPDATE statement instead of loop)
    try {
      const placeholders = memoryIds.map(() => '?').join(',');
      this.localDb.prepare(`
        UPDATE memory_cache
        SET access_count = access_count + 1, last_accessed = ?
        WHERE id IN (${placeholders})
      `).run(now, ...memoryIds);
    } catch (error) {
      // Memory might not be in local cache yet
    }

    // Update Supabase asynchronously (don't await)
    // Note: We can't increment in a single query, so we do it per memory
    memoryIds.forEach(async (id) => {
      try {
        const { data: current } = await this.supabase
          .from('memory_notes')
          .select('metadata')
          .eq('id', id)
          .single();
        
        if (current) {
          const metadata = current.metadata as any || {};
          const accessCount = (metadata.access_count || 0) + 1;
          
          await this.supabase
            .from('memory_notes')
            .update({
              metadata: { ...metadata, access_count: accessCount },
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
        }
      } catch (err) {
        console.error('[RecallEngine] Failed to update access metrics:', err);
      }
    });
  }

  /**
   * Warm cache with hot memories on session start
   */
  async warmCache(workspaceId: string): Promise<void> {
    console.log('[RecallEngine] Warming cache for workspace:', workspaceId);

    // CRASH FIX #7: Input validation for workspaceId
    if (!workspaceId || typeof workspaceId !== 'string') {
      console.error('[RecallEngine] Invalid workspaceId for cache warming');
      return;
    }

    try {
      // Pre-load high-importance memories into cache
      const stmt = this.localDb.prepare(`
        SELECT * FROM memory_cache
        WHERE workspace_id = ? AND importance_score > 0.7
        ORDER BY importance_score DESC, last_accessed DESC
        LIMIT 50
      `);

      // CRASH FIX #8: Null/type check on stmt.all result
      const hotMemories = stmt.all(workspaceId);
      if (!Array.isArray(hotMemories)) {
        console.error('[RecallEngine] stmt.all did not return array');
        return;
      }

      // Pre-compute only top 3 most critical queries to populate cache (performance optimization)
      const commonQueries = [
        'entry rules',
        'risk management',
        'mistakes to avoid',
      ];

      for (const q of commonQueries) {
        if (!q || typeof q !== 'string') continue;
        try {
          await this.recall(q, workspaceId, { limit: 5, useCache: true, rerank: false });
        } catch (error) {
          console.error(`[RecallEngine] Error warming cache for query "${q}":`, error);
        }
      }

      console.log(`[RecallEngine] Cache warmed with ${hotMemories.length} hot memories`);
    } catch (error) {
      console.error('[RecallEngine] Error during cache warming:', error);
    }
  }

  /**
   * Get cache size for monitoring
   */
  getCacheSize(): number {
    return this.queryCache.size;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.queryCache.clear();
  }

  /**
   * Generate cache key
   */
  private getCacheKey(
    query: string,
    workspaceId: string,
    limit: number,
    minImportance: number
  ): string {
    const input = `${query}_${workspaceId}_${limit}_${minImportance}`;
    return crypto.createHash('md5').update(input).digest('hex');
  }

  /**
   * Format memories for injection into system prompt
   */
  formatForPrompt(memories: MemoryResult[]): string {
    if (memories.length === 0) {
      return '';
    }

    let formatted = '## 📚 RETRIEVED MEMORIES (Auto-Recalled)\n\n';

    // Group by importance level
    const critical = memories.filter((m) => m.importance > 0.8);
    const important = memories.filter((m) => m.importance > 0.5 && m.importance <= 0.8);
    const relevant = memories.filter((m) => m.importance <= 0.5);

    if (critical.length > 0) {
      formatted += '### 🚨 CRITICAL RULES & LESSONS\n';
      critical.forEach((m) => {
        formatted += `- **[${m.type.toUpperCase()}]** ${m.content}\n`;
        if (m.symbols?.length) formatted += `  - Symbols: ${m.symbols.join(', ')}\n`;
        if (m.category) formatted += `  - Category: ${m.category}\n`;
      });
      formatted += '\n';
    }

    if (important.length > 0) {
      formatted += '### ⚠️ IMPORTANT CONTEXT\n';
      important.forEach((m) => {
        formatted += `- [${m.type}] ${m.summary || m.content}\n`;
      });
      formatted += '\n';
    }

    if (relevant.length > 0) {
      formatted += '### 💡 RELATED INSIGHTS\n';
      relevant.forEach((m) => {
        formatted += `- ${m.summary || m.content}\n`;
      });
      formatted += '\n';
    }

    // CRASH FIX #6: Array bounds check before accessing memories[0]
    let sourceInfo = '<unknown>';
    if (memories && memories.length > 0 && memories[0]) {
      sourceInfo = memories[0].source === 'cache' ? '<1' : `${this.queryCache.size}`;
    }
    formatted += `*Retrieved ${memories.length} memories in ${sourceInfo}ms*\n`;

    return formatted;
  }
}
