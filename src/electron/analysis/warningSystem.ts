/**
 * Warning System
 *
 * Pre-backtest checks to surface relevant warnings before running tests.
 * Prevents repeating expensive mistakes.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { OverfittingDetector } from './overfittingDetector';
import OpenAI from 'openai';

interface OverfittingWarning {
  id: string;
  warning_message: string;
  evidence_detail: string;
  similarity?: number;
  in_sample_sharpe?: number;
  out_of_sample_sharpe?: number;
}

interface RegimeWarning {
  id: string;
  summary?: string;
  content: string;
  importance_score: number;
}

interface CriticalLesson {
  id: string;
  summary: string;
  content: string;
  protection_level: number;
  financial_impact?: number;
}

interface RelevantWarnings {
  overfitting_warnings: OverfittingWarning[];
  regime_warnings: RegimeWarning[];
  critical_lessons: CriticalLesson[];
  total_warnings: number;
}

export class WarningSystem {
  private overfittingDetector: OverfittingDetector;

  constructor(private supabase: SupabaseClient, openaiClient: OpenAI | null) {
    this.overfittingDetector = new OverfittingDetector(supabase, openaiClient);
  }

  /**
   * Get all relevant warnings before starting a backtest
   */
  async getRelevantWarnings(
    strategy: string,
    regimeId: number | null,
    workspaceId: string
  ): Promise<RelevantWarnings> {
    const [overfittingWarnings, regimeWarnings, criticalLessons] = await Promise.all([
      this.overfittingDetector.checkSimilarFailures(strategy, workspaceId),
      this.getRegimeWarnings(regimeId, workspaceId),
      this.getCriticalLessons(workspaceId),
    ]);

    return {
      overfitting_warnings: overfittingWarnings,
      regime_warnings: regimeWarnings,
      critical_lessons: criticalLessons,
      total_warnings: overfittingWarnings.length + regimeWarnings.length + criticalLessons.length,
    };
  }

  /**
   * Get warnings specific to a regime
   */
  private async getRegimeWarnings(regimeId: number | null, workspaceId: string): Promise<RegimeWarning[]> {
    if (!regimeId) return [];

    const { data } = await this.supabase
      .from('memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('memory_type', 'warning')
      .filter('regime_context->primary_regime', 'eq', regimeId)
      .gte('importance_score', 0.7)
      .order('importance_score', { ascending: false })
      .limit(5);

    return data || [];
  }

  /**
   * Get all CRITICAL (protection level 0-1) lessons
   */
  private async getCriticalLessons(workspaceId: string): Promise<CriticalLesson[]> {
    const { data } = await this.supabase
      .from('memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .lte('protection_level', 1)
      .order('protection_level', { ascending: true })
      .order('financial_impact', { ascending: false })
      .limit(10);

    return data || [];
  }

  /**
   * Format warnings for display
   */
  formatWarnings(warnings: RelevantWarnings): string {
    if (warnings.total_warnings === 0) {
      return '✅ No warnings found. Proceed with caution.';
    }

    let formatted = `## ⚠️ PRE-BACKTEST WARNINGS (${warnings.total_warnings} total)\n\n`;

    if (warnings.overfitting_warnings.length > 0) {
      formatted += '### 🔴 OVERFITTING WARNINGS (Similar Approaches Failed)\n\n';
      warnings.overfitting_warnings.forEach((w, i) => {
        formatted += `${i + 1}. **${w.warning_message}**\n`;
        const similarity = w.similarity ?? 0;
        formatted += `   - Similarity: ${(similarity * 100).toFixed(0)}%\n`;
        formatted += `   - Evidence: ${w.evidence_detail}\n\n`;
      });
    }

    if (warnings.regime_warnings.length > 0) {
      formatted += '### ⚠️ REGIME-SPECIFIC WARNINGS\n\n';
      warnings.regime_warnings.forEach((w, i) => {
        formatted += `${i + 1}. ${w.summary || w.content.slice(0, 100)}\n\n`;
      });
    }

    if (warnings.critical_lessons.length > 0) {
      formatted += '### 🚨 CRITICAL LESSONS (Must Review)\n\n';
      warnings.critical_lessons.forEach((l, i) => {
        const cost = l.financial_impact ? ` ($${l.financial_impact.toLocaleString()} cost)` : '';
        formatted += `${i + 1}. [Level ${l.protection_level}]${cost} ${l.summary}\n\n`;
      });
    }

    formatted += '\n**⚠️ Review all warnings before proceeding. These represent expensive lessons learned.**\n';

    return formatted;
  }
}
