/**
 * Stale Memory Injector
 *
 * Forces injection of CRITICAL memories that haven't been recalled recently.
 * Prevents catastrophic forgetting through active reinforcement.
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface StaleMemory {
  id: string;
  content: string;
  summary: string;
  protection_level: number;
  financial_impact: number | null;
  last_recalled_at: string | null;
  days_since_recall: number;
}

export class StaleMemoryInjector {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get CRITICAL memories that haven't been recalled in their expected interval
   */
  async getStaleMemories(workspaceId: string, maxResults: number = 20): Promise<StaleMemory[]> {
    // Protection level recall intervals (days)
    const RECALL_INTERVALS = {
      0: 3, // IMMUTABLE - every 3 days
      1: 7, // PROTECTED - weekly
      2: 30, // STANDARD - monthly
      3: 90, // EPHEMERAL - quarterly
    };

    const now = new Date();
    const staleMemories: StaleMemory[] = [];

    // Query for each protection level
    for (const [level, interval] of Object.entries(RECALL_INTERVALS)) {
      const threshold = new Date(now.getTime() - interval * 24 * 60 * 60 * 1000);

      const { data, error } = await this.supabase
        .from('memories')
        .select('id, content, summary, protection_level, financial_impact, last_recalled_at')
        .eq('workspace_id', workspaceId)
        .eq('protection_level', parseInt(level))
        .or(`last_recalled_at.is.null,last_recalled_at.lt.${threshold.toISOString()}`)
        .order('protection_level', { ascending: true })
        .order('financial_impact', { ascending: false })
        .limit(10);

      if (error) {
        console.error(`[StaleMemoryInjector] Error querying level ${level}:`, error);
        continue;
      }

      if (data && data.length > 0) {
        staleMemories.push(
          ...data.map((m) => ({
            ...m,
            days_since_recall: m.last_recalled_at
              ? Math.floor((now.getTime() - new Date(m.last_recalled_at).getTime()) / (24 * 60 * 60 * 1000))
              : 9999,
          }))
        );
      }
    }

    const sorted = staleMemories.sort((a, b) => {
      // Priority: protection_level asc, financial_impact desc, days_since_recall desc
      if (a.protection_level !== b.protection_level) {
        return a.protection_level - b.protection_level;
      }
      if ((a.financial_impact || 0) !== (b.financial_impact || 0)) {
        return (b.financial_impact || 0) - (a.financial_impact || 0);
      }
      return b.days_since_recall - a.days_since_recall;
    });

    return sorted.slice(0, maxResults);
  }

  /**
   * Format stale memories for forced injection into prompt
   */
  formatForInjection(memories: StaleMemory[]): string {
    if (memories.length === 0) return '';

    let formatted = '## 🔴 CRITICAL LESSONS REQUIRING REINFORCEMENT\n\n';
    formatted += '*These expensive lessons haven\'t been recalled recently. Review before proceeding:*\n\n';

    for (const memory of memories) {
      const daysSince = memory.days_since_recall === 9999 ? 'NEVER' : `${memory.days_since_recall} days ago`;
      const cost = memory.financial_impact ? ` (Cost: $${memory.financial_impact.toLocaleString()})` : '';

      formatted += `### [${daysSince}] ${memory.summary}${cost}\n`;
      formatted += `${memory.content.slice(0, 500)}\n\n`;
      formatted += `---\n\n`;
    }

    const minLevel = Math.min(...memories.map(m => m.protection_level));
    formatted += `*These are PROTECTED memories (Level ${minLevel}). Confirm understanding before proceeding.*\n`;

    return formatted;
  }

  /**
   * Update last_recalled_at for memories
   */
  async markAsRecalled(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    const { error } = await this.supabase
      .from('memories')
      .update({ last_recalled_at: new Date().toISOString() })
      .in('id', memoryIds);

    if (error) {
      console.error('[StaleMemoryInjector] Failed to update last_recalled_at:', error);
    } else {
      console.log(`[StaleMemoryInjector] Marked ${memoryIds.length} memories as recalled`);
    }
  }
}
