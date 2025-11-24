/**
 * Pattern Detector
 *
 * Detects regime-profile correlations and promotes repeated lessons to rules.
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface Memory {
  id: string;
  content: string;
  summary: string;
  workspace_id: string;
  memory_type: string;
  importance_score?: number;
}

interface Pattern {
  type: 'regime_profile_correlation' | 'repeated_lesson' | 'failure_mode';
  description: string;
  evidence_count: number;
  confidence: number;
  supporting_ids: string[];
}

export class PatternDetector {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Detect if lesson has been learned multiple times (promote to rule)
   */
  async detectRepeatedLessons(workspaceId: string): Promise<Pattern[]> {
    const { data: memories } = await this.supabase
      .from('memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('memory_type', 'lesson')
      .gte('importance_score', 0.6);

    if (!memories || memories.length < 3) return [];

    const patterns: Pattern[] = [];
    const processed = new Set<string>();

    for (const memory of memories) {
      if (processed.has(memory.id)) continue;

      // Find similar lessons
      const similar = memories.filter(
        (m) =>
          m.id !== memory.id &&
          !processed.has(m.id) &&
          this.textSimilarity(memory.content, m.content) > 0.7
      );

      if (similar.length >= 2) {
        // Found repeated pattern (3+ occurrences)
        const ids = [memory.id, ...similar.map((s) => s.id)];
        ids.forEach((id) => processed.add(id));

        patterns.push({
          type: 'repeated_lesson',
          description: `"${memory.summary}" repeated ${ids.length} times`,
          evidence_count: ids.length,
          confidence: ids.length < 5 ? 0.6 : ids.length < 10 ? 0.85 : 0.95,
          supporting_ids: ids,
        });

        // Auto-promote to rule
        await this.promoteToRule(memory, ids, workspaceId);
      }
    }

    return patterns;
  }

  /**
   * Promote repeated lesson to trading rule
   */
  private async promoteToRule(
    sourceMemory: Memory,
    supportingIds: string[],
    workspaceId: string
  ): Promise<void> {
    // Check if rule already exists
    const { data: existing } = await this.supabase
      .from('trading_rules')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('rule_content', `%${sourceMemory.summary}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      // Update existing rule
      await this.supabase
        .from('trading_rules')
        .update({
          supporting_memory_ids: [...supportingIds],
          success_count: supportingIds.length,
          last_validated: new Date().toISOString(),
        })
        .eq('id', existing[0].id);

      console.log(`[PatternDetector] Updated existing rule for: ${sourceMemory.summary}`);
    } else {
      // Create new rule
      const { error } = await this.supabase.from('trading_rules').insert({
        workspace_id: workspaceId,
        rule_content: sourceMemory.content,
        rule_type: this.categorizeRule(sourceMemory.content),
        confidence: Math.min(supportingIds.length / 5, 1.0),
        supporting_memory_ids: supportingIds,
        success_count: supportingIds.length,
        active: true,
      });

      if (!error) {
        console.log(`[PatternDetector] Created new rule: ${sourceMemory.summary} (${supportingIds.length} instances)`);
      }
    }
  }

  private categorizeRule(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes('enter') || lower.includes('entry')) return 'entry';
    if (lower.includes('exit') || lower.includes('close')) return 'exit';
    if (lower.includes('risk') || lower.includes('size') || lower.includes('loss')) return 'risk';
    if (lower.includes('position') || lower.includes('capital')) return 'position_sizing';
    return 'general';
  }

  private textSimilarity(text1: string, text2: string): number {
    // CRASH FIX #9: Input validation and division by zero protection
    if (!text1 || !text2 || typeof text1 !== 'string' || typeof text2 !== 'string') {
      return 0;
    }

    try {
      const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 0));
      const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 0));
      const intersection = new Set([...words1].filter((x) => words2.has(x)));
      const union = new Set([...words1, ...words2]);

      // CRASH FIX #10: Prevent division by zero
      if (union.size === 0) {
        return 0;
      }

      return intersection.size / union.size;
    } catch (error) {
      console.error('[PatternDetector] Text similarity calculation error:', error);
      return 0;
    }
  }

  /**
   * Detect regime-profile performance correlations
   */
  async detectRegimeProfilePatterns(workspaceId: string): Promise<Pattern[]> {
    try {
      // CRASH FIX #11: Input validation
      if (!workspaceId || typeof workspaceId !== 'string') {
        console.error('[PatternDetector] Invalid workspaceId for regime pattern detection');
        return [];
      }

      const { data, error } = await this.supabase.rpc('get_regime_performance', {
        match_workspace_id: workspaceId,
        min_confidence: 0.5,
      });

      // CRASH FIX #12: Handle RPC errors
      if (error) {
        console.error('[PatternDetector] RPC error in detectRegimeProfilePatterns:', error);
        return [];
      }

      // CRASH FIX #13: Type checking on data
      if (!Array.isArray(data) || data.length === 0) {
        return [];
      }

      const patterns: Pattern[] = [];

      // Group by profile, find regime dependencies
      for (let profile = 1; profile <= 6; profile++) {
        const profileData = data.filter((d: any) => d?.profile_id === profile);

        if (profileData.length === 0) continue;

        // Find best and worst regimes
        const sorted = [...profileData].sort((a: any, b: any) => (b?.avg_sharpe || 0) - (a?.avg_sharpe || 0));
        if (sorted.length === 0) continue;

        // CRASH FIX #14: Array bounds checks before accessing sorted[0] and sorted[length-1]
        const best = sorted[0];
        const worst = sorted[sorted.length - 1];

        if (!best || !worst) {
          console.warn(`[PatternDetector] Invalid best/worst data for profile ${profile}`);
          continue;
        }

        // CRASH FIX #15: Null checks and type validation before property access
        if (best.total_runs >= 5 && typeof best.avg_sharpe === 'number' && best.avg_sharpe > 0.5) {
          const bestRegimeId = best.regime_id ?? 'unknown';
          patterns.push({
            type: 'regime_profile_correlation',
            description: `Profile ${profile} performs best in Regime ${bestRegimeId} (Sharpe ${best.avg_sharpe.toFixed(2)})`,
            evidence_count: best.total_runs,
            confidence: best.confidence_score || 0.5,
            supporting_ids: Array.isArray(best.run_ids) ? best.run_ids : [],
          });
        }

        if (worst.total_runs >= 5 && typeof worst.avg_sharpe === 'number' && worst.avg_sharpe < 0) {
          const worstRegimeId = worst.regime_id ?? 'unknown';
          patterns.push({
            type: 'regime_profile_correlation',
            description: `Profile ${profile} FAILS in Regime ${worstRegimeId} (Sharpe ${worst.avg_sharpe.toFixed(2)})`,
            evidence_count: worst.total_runs,
            confidence: worst.confidence_score || 0.5,
            supporting_ids: Array.isArray(worst.run_ids) ? worst.run_ids : [],
          });
        }
      }

      return patterns;
    } catch (error) {
      console.error('[PatternDetector] Error in detectRegimeProfilePatterns:', error);
      return [];
    }
  }
}
