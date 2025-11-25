/**
 * ProtectedCanonLoader - Loads critical lessons that must NEVER be dropped
 *
 * These are LESSONS_LEARNED and critical rules that have high financial impact.
 * They are loaded into Tier 0 of the context budget and are never summarized or dropped.
 *
 * Criteria for protection:
 * - protection_level = 0 (highest protection)
 * - type = 'lesson' or 'rule'
 * - financial_impact > 0 (has cost implications)
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface ProtectedMemory {
  id: string;
  content: string;
  summary: string;
  type: string;
  protection_level: number;
  financial_impact: number | null;
  importance: number;
}

export interface ProtectedCanon {
  lessons: ProtectedMemory[];
  rules: ProtectedMemory[];
  formattedContent: string;
  tokenEstimate: number;
}

// Maximum tokens to allocate for protected canon
const MAX_CANON_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;

export class ProtectedCanonLoader {
  private supabase: SupabaseClient;
  private cache: Map<string, { canon: ProtectedCanon; timestamp: number }> = new Map();
  private cacheTTL = 5 * 60 * 1000; // 5 minute cache

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Load protected canon for a workspace
   */
  async loadProtectedCanon(workspaceId: string): Promise<ProtectedCanon> {
    // Check cache first
    const cached = this.cache.get(workspaceId);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.canon;
    }

    try {
      // Query for protected memories (protection_level = 0 or type = 'lesson'/'rule')
      const { data: memories, error } = await this.supabase
        .from('memories')
        .select('id, content, summary, type, protection_level, financial_impact, importance')
        .eq('workspace_id', workspaceId)
        .or('protection_level.eq.0,type.eq.lesson,type.eq.rule')
        .order('importance', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[ProtectedCanonLoader] Query failed:', error);
        return this.emptyCanon();
      }

      if (!memories || memories.length === 0) {
        console.log('[ProtectedCanonLoader] No protected memories found');
        return this.emptyCanon();
      }

      // Separate into lessons and rules
      const lessons = memories.filter(m => m.type === 'lesson' || m.type === 'mistake');
      const rules = memories.filter(m => m.type === 'rule');

      // Format for context injection
      const formattedContent = this.formatCanon(lessons, rules);
      const tokenEstimate = Math.ceil(formattedContent.length / CHARS_PER_TOKEN);

      // If too large, truncate (but log warning)
      let finalContent = formattedContent;
      if (tokenEstimate > MAX_CANON_TOKENS) {
        console.warn(`[ProtectedCanonLoader] Canon exceeds budget: ${tokenEstimate} tokens`);
        const maxChars = MAX_CANON_TOKENS * CHARS_PER_TOKEN;
        finalContent = formattedContent.slice(0, maxChars) + '\n[... additional lessons truncated]';
      }

      const canon: ProtectedCanon = {
        lessons,
        rules,
        formattedContent: finalContent,
        tokenEstimate: Math.ceil(finalContent.length / CHARS_PER_TOKEN),
      };

      // Cache result
      this.cache.set(workspaceId, { canon, timestamp: Date.now() });

      console.log(`[ProtectedCanonLoader] Loaded ${lessons.length} lessons, ${rules.length} rules`);
      return canon;

    } catch (error) {
      console.error('[ProtectedCanonLoader] Load failed:', error);
      return this.emptyCanon();
    }
  }

  /**
   * Format canon for injection into system prompt
   */
  private formatCanon(lessons: ProtectedMemory[], rules: ProtectedMemory[]): string {
    const sections: string[] = [];

    if (lessons.length > 0) {
      sections.push('### CRITICAL LESSONS (Learned from expensive mistakes)');
      lessons.forEach((lesson, i) => {
        const impact = lesson.financial_impact
          ? ` [Cost: $${lesson.financial_impact.toLocaleString()}]`
          : '';
        sections.push(`${i + 1}. ${lesson.summary || lesson.content.slice(0, 200)}${impact}`);
      });
    }

    if (rules.length > 0) {
      sections.push('\n### ABSOLUTE RULES (Never violate)');
      rules.forEach((rule, i) => {
        sections.push(`${i + 1}. ${rule.summary || rule.content.slice(0, 200)}`);
      });
    }

    if (sections.length === 0) {
      return '';
    }

    return sections.join('\n');
  }

  /**
   * Return empty canon structure
   */
  private emptyCanon(): ProtectedCanon {
    return {
      lessons: [],
      rules: [],
      formattedContent: '',
      tokenEstimate: 0,
    };
  }

  /**
   * Clear cache (call when new lessons are added)
   */
  clearCache(workspaceId?: string): void {
    if (workspaceId) {
      this.cache.delete(workspaceId);
    } else {
      this.cache.clear();
    }
  }
}

// Singleton
let loaderInstance: ProtectedCanonLoader | null = null;

export function getProtectedCanonLoader(supabase: SupabaseClient): ProtectedCanonLoader {
  if (!loaderInstance) {
    loaderInstance = new ProtectedCanonLoader(supabase);
  }
  return loaderInstance;
}
