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
    // Input validation
    if (!strategy || typeof strategy !== 'string') {
      console.error('[WarningSystem] Invalid strategy string');
      return {
        overfitting_warnings: [],
        regime_warnings: [],
        critical_lessons: [],
        total_warnings: 0,
      };
    }
    if (!workspaceId || typeof workspaceId !== 'string') {
      console.error('[WarningSystem] Invalid workspaceId');
      return {
        overfitting_warnings: [],
        regime_warnings: [],
        critical_lessons: [],
        total_warnings: 0,
      };
    }

    try {
      const [overfittingWarnings, regimeWarnings, criticalLessons] = await Promise.all([
        this.overfittingDetector.checkSimilarFailures(strategy, workspaceId),
        this.getRegimeWarnings(regimeId, workspaceId),
        this.getCriticalLessons(workspaceId),
      ]);

      return {
        overfitting_warnings: Array.isArray(overfittingWarnings) ? overfittingWarnings : [],
        regime_warnings: Array.isArray(regimeWarnings) ? regimeWarnings : [],
        critical_lessons: Array.isArray(criticalLessons) ? criticalLessons : [],
        total_warnings:
          (Array.isArray(overfittingWarnings) ? overfittingWarnings.length : 0) +
          (Array.isArray(regimeWarnings) ? regimeWarnings.length : 0) +
          (Array.isArray(criticalLessons) ? criticalLessons.length : 0),
      };
    } catch (error) {
      console.error('[WarningSystem] Error getting relevant warnings:', error);
      return {
        overfitting_warnings: [],
        regime_warnings: [],
        critical_lessons: [],
        total_warnings: 0,
      };
    }
  }

  /**
   * Get warnings specific to a regime
   */
  private async getRegimeWarnings(regimeId: number | null, workspaceId: string): Promise<RegimeWarning[]> {
    if (!regimeId || typeof regimeId !== 'number') return [];

    if (!workspaceId || typeof workspaceId !== 'string') {
      console.error('[WarningSystem] Invalid workspaceId in getRegimeWarnings');
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from('memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('memory_type', 'warning')
        .filter('regime_context->primary_regime', 'eq', regimeId)
        .gte('importance_score', 0.7)
        .order('importance_score', { ascending: false })
        .limit(5);

      if (error) {
        console.error('[WarningSystem] Error querying regime warnings:', error);
        return [];
      }

      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[WarningSystem] Error in getRegimeWarnings:', error);
      return [];
    }
  }

  /**
   * Get all CRITICAL (protection level 0-1) lessons
   */
  private async getCriticalLessons(workspaceId: string): Promise<CriticalLesson[]> {
    if (!workspaceId || typeof workspaceId !== 'string') {
      console.error('[WarningSystem] Invalid workspaceId in getCriticalLessons');
      return [];
    }

    try {
      const { data, error } = await this.supabase
        .from('memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .lte('protection_level', 1)
        .order('protection_level', { ascending: true })
        .order('financial_impact', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[WarningSystem] Error querying critical lessons:', error);
        return [];
      }

      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[WarningSystem] Error in getCriticalLessons:', error);
      return [];
    }
  }

  /**
   * Format warnings for display
   */
  formatWarnings(warnings: RelevantWarnings): string {
    // Input validation
    if (!warnings || typeof warnings !== 'object') {
      return '⚠️ Invalid warnings object';
    }

    const totalWarnings = warnings.total_warnings ?? 0;
    if (totalWarnings === 0) {
      return '✅ No warnings found. Proceed with caution.';
    }

    try {
      let formatted = `## ⚠️ PRE-BACKTEST WARNINGS (${totalWarnings} total)\n\n`;

      // Safe array iteration with validation
      if (Array.isArray(warnings.overfitting_warnings) && warnings.overfitting_warnings.length > 0) {
        formatted += '### 🔴 OVERFITTING WARNINGS (Similar Approaches Failed)\n\n';
        warnings.overfitting_warnings.forEach((w, i) => {
          if (!w || typeof w !== 'object') return;
          formatted += `${i + 1}. **${w.warning_message || 'Unknown warning'}**\n`;
          const similarity = w.similarity ?? 0;
          formatted += `   - Similarity: ${(similarity * 100).toFixed(0)}%\n`;
          formatted += `   - Evidence: ${w.evidence_detail || 'No evidence'}\n\n`;
        });
      }

      if (Array.isArray(warnings.regime_warnings) && warnings.regime_warnings.length > 0) {
        formatted += '### ⚠️ REGIME-SPECIFIC WARNINGS\n\n';
        warnings.regime_warnings.forEach((w, i) => {
          if (!w || typeof w !== 'object') return;
          const summaryText = w.summary || (w.content ? w.content.slice(0, 100) : 'Unknown warning');
          formatted += `${i + 1}. ${summaryText}\n\n`;
        });
      }

      if (Array.isArray(warnings.critical_lessons) && warnings.critical_lessons.length > 0) {
        formatted += '### 🚨 CRITICAL LESSONS (Must Review)\n\n';
        warnings.critical_lessons.forEach((l, i) => {
          if (!l || typeof l !== 'object') return;
          const cost = l.financial_impact ? ` ($${l.financial_impact.toLocaleString()} cost)` : '';
          formatted += `${i + 1}. [Level ${l.protection_level ?? 0}]${cost} ${l.summary || 'Unknown lesson'}\n\n`;
        });
      }

      formatted += '\n**⚠️ Review all warnings before proceeding. These represent expensive lessons learned.**\n';

      return formatted;
    } catch (error) {
      console.error('[WarningSystem] Error formatting warnings:', error);
      return '⚠️ Error formatting warnings. Please review manually.';
    }
  }
}
