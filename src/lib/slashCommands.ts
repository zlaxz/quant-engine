/**
 * Slash command parser and executor for Quant Chat Workbench
 * Provides /backtest, /runs, /note, and /compare commands
 */

import { supabase } from '@/integrations/supabase/client';
import type { BacktestRun, BacktestParams, BacktestMetrics } from '@/types/backtest';
import type { LlmTier } from '@/config/llmRouting';
import { buildAuditPrompt } from '@/prompts/auditorPrompt';
import { buildRunSummary, buildMemorySummary, type MemoryNote } from '@/lib/auditSummaries';
import { buildPatternMinerPrompt } from '@/prompts/patternMinerPrompt';
import { buildRunsAggregate, buildRelevantMemory } from '@/lib/patternSummaries';
import { buildMemoryCuratorPrompt } from '@/prompts/memoryCuratorPrompt';
import { buildCurationSummary } from '@/lib/memoryCuration';
import { buildExperimentDirectorPrompt } from '@/prompts/experimentDirectorPrompt';
import { buildExperimentRunSummary, buildExperimentMemorySummary } from '@/lib/experimentPlanning';
import { buildRiskOfficerPrompt } from '@/prompts/riskOfficerPrompt';
import { buildRiskRunSummary, buildRiskMemorySummary } from '@/lib/riskSummaries';
import { selectKeyRuns, buildRunPortfolioSummary, assembleAgentInputs } from '@/lib/autoAnalyze';
import { buildAutoAnalyzePrompt } from '@/prompts/autoAnalyzePrompt';
import { buildDefaultReportTitle, extractSummaryFromReport, buildTagsFromReport } from '@/lib/researchReports';
import { runRedTeamAuditForFile } from '@/lib/redTeamAudit';
import { runSwarm, dispatchMassiveSwarm, type SwarmPrompt } from '@/lib/swarmClient';
import {
  getMutationAssignments,
  buildMutationPrompt,
  parseEvolveCommand,
  MUTATION_AGENT_SYSTEM,
  EVOLVE_STRATEGY_CONFIG,
} from '@/prompts/evolutionPrompts';
import {
  buildPatternMinerAgentPrompt,
  buildCuratorAgentPrompt,
  buildRiskAgentPrompt,
  buildExperimentAgentPrompt,
} from '@/prompts/researchAgentPrompts';
import { writeFile, appendFile, deleteFile, renameFile, copyFile, createDirectory, type WriteConfirmationCallback } from '@/lib/codeWriter';
import { chatPrimary, chatSwarm } from '@/lib/electronClient';

// Global confirmation callback - set by ChatArea
let globalWriteConfirmationCallback: WriteConfirmationCallback | undefined;

export function setWriteConfirmationCallback(callback: WriteConfirmationCallback | undefined) {
  globalWriteConfirmationCallback = callback;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
}

export interface Command {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, context: CommandContext) => Promise<CommandResult>;
  tier?: LlmTier; // Which LLM tier to use for this command
}

export interface CommandContext {
  sessionId: string;
  workspaceId: string;
  setActiveExperiment?: (experiment: any) => void;
}

/**
 * Parse slash command from user input
 */
export function parseCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  return { command, args };
}

/**
 * /backtest command - run a backtest
 * Usage: /backtest <strategy_key> [start_date] [end_date] [capital]
 * Examples:
 *   /backtest skew_convexity_v1
 *   /backtest momentum_breakout_v1 2020-01-01 2023-12-31
 *   /backtest vol_spike_reversal_v1 2021-01-01 2024-12-31 50000
 */
async function handleBacktest(args: string, context: CommandContext): Promise<CommandResult> {
  const parts = args.trim().split(/\s+/);
  
  if (parts.length === 0 || !parts[0]) {
    return {
      success: false,
      message: 'Usage: /backtest <strategy_key> [start_date] [end_date] [capital]\nExample: /backtest skew_convexity_v1 2020-01-01 2024-12-31 100000',
    };
  }

  const strategyKey = parts[0];
  const startDate = parts[1] || '2020-01-01';
  const endDate = parts[2] || '2024-12-31';
  const capital = parseInt(parts[3] || '100000', 10);

  if (isNaN(capital) || capital <= 0) {
    return {
      success: false,
      message: 'Invalid capital amount. Must be a positive number.',
    };
  }

  try {
    // Invoke backtest-run edge function
    const { data, error } = await supabase.functions.invoke('backtest-run', {
      body: {
        sessionId: context.sessionId,
        strategyKey,
        params: {
          startDate,
          endDate,
          capital,
        },
      },
    });

    if (error) throw error;

    if (!data || !data.id) {
      throw new Error('No run ID returned from backtest');
    }

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      const { data: runData, error: fetchError } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('id', data.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (!runData) {
        return {
          success: false,
          message: '❌ Backtest run not found.',
        };
      }

      if (runData.status === 'completed') {
        const metrics = runData.metrics;
        if (!metrics) {
          return {
            success: false,
            message: '❌ Backtest completed but metrics are missing.',
          };
        }

        // Set active experiment if callback provided
        if (context.setActiveExperiment) {
          context.setActiveExperiment({
            id: runData.id,
            name: `Testing ${strategyKey.replace(/_/g, ' ')}`,
            strategy: strategyKey,
            lastRunId: runData.id,
            lastRunTime: new Date().toLocaleTimeString(),
            status: 'completed' as const,
          });
        }

        // Determine status based on metrics
        const sharpe = metrics.sharpe;
        let status: 'success' | 'warning' | 'error' = 'success';
        if (sharpe > 3) {
          status = 'warning'; // Potential overfitting
        } else if (sharpe < 0.5) {
          status = 'warning'; // Poor performance
        }

        // Return inline card format
        const cardData = {
          type: 'backtest_result',
          runId: runData.id,
          strategyName: strategyKey.replace(/_/g, ' '),
          dateRange: `${startDate} to ${endDate}`,
          metrics: {
            sharpe: metrics.sharpe,
            cagr: metrics.cagr,
            maxDrawdown: metrics.max_drawdown,
            winRate: metrics.win_rate,
            totalTrades: metrics.total_trades,
            profitFactor: metrics.profit_factor,
          },
          status,
        };

        return {
          success: true,
          message: JSON.stringify(cardData),
          data: runData,
        };
      } else if (runData.status === 'failed') {
        return {
          success: false,
          message: `❌ Backtest failed: ${runData.error || 'Unknown error'}`,
        };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    return {
      success: false,
      message: '⏱️ Backtest timed out. Check the Quant tab for status.',
    };
  } catch (error: any) {
    console.error('Backtest command error:', error);
    return {
      success: false,
      message: `❌ Failed to run backtest: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /runs command - list recent backtest runs
 * Usage: /runs [limit]
 * Examples:
 *   /runs
 *   /runs 10
 */
async function handleRuns(args: string, context: CommandContext): Promise<CommandResult> {
  const limit = parseInt(args.trim(), 10) || 5;

  if (limit < 1 || limit > 20) {
    return {
      success: false,
      message: 'Limit must be between 1 and 20.',
    };
  }

  try {
  const { data, error } = await supabase
    .from('backtest_runs')
    .select('*')
    .eq('session_id', context.sessionId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[Slash Command /runs] Error:', error);
    throw error;
  }

    if (!data || data.length === 0) {
      return {
        success: true,
        message: '📋 No backtest runs found for this session yet.\n\nUse /backtest to run your first test!',
      };
    }

    const runsList = data.map((run, idx) => {
      const date = new Date(run.started_at || Date.now()).toLocaleDateString();
      const status = run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '⏳';
      const metrics = run.metrics || {};
      
      let summary = `${idx + 1}. ${status} ${run.strategy_key} (${date})`;
      
      if (run.status === 'completed' && metrics.cagr !== undefined) {
        summary += `\n   CAGR: ${(metrics.cagr * 100).toFixed(2)}% | Sharpe: ${metrics.sharpe?.toFixed(2) || 'N/A'} | DD: ${metrics.max_drawdown !== undefined ? (metrics.max_drawdown * 100).toFixed(2) : 'N/A'}%`;
      } else if (run.status === 'failed') {
        summary += `\n   Error: ${run.error || 'Unknown'}`;
      }
      
      if (run.notes) {
        summary += `\n   📝 ${run.notes}`;
      }
      
      return summary;
    }).join('\n\n');

    return {
      success: true,
      message: `📋 Recent Backtest Runs (${data.length}):\n\n${runsList}\n\nView detailed results in the Quant tab.`,
      data,
    };
  } catch (error: any) {
    console.error('Runs command error:', error);
    return {
      success: false,
      message: `❌ Failed to fetch runs: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /note command - create a memory note
 * Usage: /note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]
 * Examples:
 *   /note This strategy works well in low volatility regimes
 *   /note Never use this in bear markets type:warning importance:critical
 *   /note Momentum breakout shows alpha tags:momentum,breakout importance:high
 */
async function handleNote(args: string, context: CommandContext): Promise<CommandResult> {
  if (!args.trim()) {
    return {
      success: false,
      message: 'Usage: /note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]\n\n' +
        'Types: insight, rule, warning, todo, bug, profile_change\n' +
        'Importance: low, normal, high, critical\n\n' +
        'Example: /note This strategy fails in bear markets type:warning importance:high tags:bear-market,risk',
    };
  }

  // Parse options from args (type:, importance:, tags:)
  const typeMatch = args.match(/type:(\w+)/i);
  const importanceMatch = args.match(/importance:(\w+)/i);
  const tagsMatch = args.match(/tags:([\w,\-]+)/i);

  // Remove options from content
  let content = args
    .replace(/type:\w+/gi, '')
    .replace(/importance:\w+/gi, '')
    .replace(/tags:[\w,\-]+/gi, '')
    .trim();

  const memoryType = typeMatch ? typeMatch[1].toLowerCase() : 'insight';
  const importance = importanceMatch ? importanceMatch[1].toLowerCase() : 'normal';
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];

  if (!content) {
    return {
      success: false,
      message: 'Note content cannot be empty.',
    };
  }

  // Validate type and importance
  const validTypes = ['insight', 'rule', 'warning', 'todo', 'bug', 'profile_change'];
  const validImportance = ['low', 'normal', 'high', 'critical'];

  if (!validTypes.includes(memoryType)) {
    return {
      success: false,
      message: `Invalid type "${memoryType}". Valid types: ${validTypes.join(', ')}`,
    };
  }

  if (!validImportance.includes(importance)) {
    return {
      success: false,
      message: `Invalid importance "${importance}". Valid levels: ${validImportance.join(', ')}`,
    };
  }

  try {
    const { error } = await supabase.functions.invoke('memory-create', {
      body: {
        workspaceId: context.workspaceId,
        content,
        source: 'manual',
        tags,
        memoryType,
        importance,
      },
    });

    if (error) throw error;

    const typeEmoji = memoryType === 'rule' ? '📏' : memoryType === 'warning' ? '⚠️' : '💡';
    const importanceLabel = importance === 'critical' ? '🔴 CRITICAL' : 
                           importance === 'high' ? '🟠 HIGH' :
                           importance === 'normal' ? '🟢 NORMAL' : '⚪ LOW';

    return {
      success: true,
      message: `✅ Memory note saved!\n\n${typeEmoji} Type: ${memoryType}\n${importanceLabel}\n\n"${content}"\n\n${tags.length > 0 ? `Tags: ${tags.join(', ')}\n\n` : ''}View in the Memory tab.`,
    };
  } catch (error: any) {
    console.error('Note command error:', error);
    return {
      success: false,
      message: `❌ Failed to save note: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /compare command - compare recent backtest runs
 * Usage: /compare [N]
 * Examples:
 *   /compare
 *   /compare 3
 */
async function handleCompare(args: string, context: CommandContext): Promise<CommandResult> {
  const limit = parseInt(args.trim(), 10) || 2;

  if (limit < 2 || limit > 5) {
    return {
      success: false,
      message: 'Limit must be between 2 and 5.',
    };
  }

  try {
    // Fetch most recent completed runs for this session
    const { data, error } = await supabase
      .from('backtest_runs')
      .select('*, strategies(name)')
      .eq('session_id', context.sessionId)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    if (!data || data.length < 2) {
      return {
        success: true,
        message: '❌ Not enough completed runs to compare.\n\nYou need at least 2 completed backtests in this session.\n\nUse /backtest to run more tests, or use /runs to see your current runs.',
      };
    }

    // Build comparison summary
    const runSummaries = data.map((run, idx) => {
      const metrics = run.metrics;
      const period = `${run.params.startDate} to ${run.params.endDate}`;
      const engineLabel = run.engine_source === 'external' ? 'Live' :
                         run.engine_source === 'rotation-engine-bridge' ? 'Bridge' :
                         run.engine_source === 'stub_fallback' ? 'Fallback' : 'Stub';
      
      return `${idx + 1}. ${run.strategy_key}\n` +
             `   Period: ${period}\n` +
             `   Engine: ${engineLabel}\n` +
             `   • CAGR: ${metrics.cagr != null ? (metrics.cagr * 100).toFixed(2) : 'N/A'}%\n` +
             `   • Sharpe: ${metrics.sharpe != null ? metrics.sharpe.toFixed(2) : 'N/A'}\n` +
             `   • Max DD: ${metrics.max_drawdown != null ? (metrics.max_drawdown * 100).toFixed(2) : 'N/A'}%\n` +
             `   • Win Rate: ${metrics.win_rate != null ? (metrics.win_rate * 100).toFixed(1) : 'N/A'}%\n` +
             `   • Trades: ${metrics.total_trades != null ? metrics.total_trades : 'N/A'}`;
    }).join('\n\n');

    // Find best performers (with null safety)
    const bestCAGR = data.reduce((best, run, idx) => 
      (run.metrics.cagr != null && data[best].metrics.cagr != null && run.metrics.cagr > data[best].metrics.cagr) ? idx : best, 0
    );
    const bestSharpe = data.reduce((best, run, idx) => 
      (run.metrics.sharpe != null && data[best].metrics.sharpe != null && run.metrics.sharpe > data[best].metrics.sharpe) ? idx : best, 0
    );
    const bestDrawdown = data.reduce((best, run, idx) => 
      (run.metrics.max_drawdown != null && data[best].metrics.max_drawdown != null && Math.abs(run.metrics.max_drawdown) < Math.abs(data[best].metrics.max_drawdown)) ? idx : best, 0
    );

    const summary = `📊 Run Comparison (${data.length} runs)\n\n${runSummaries}\n\n` +
                   `🏆 Best Performers:\n` +
                   `• Highest CAGR: Run #${bestCAGR + 1} (${data[bestCAGR].metrics.cagr != null ? (data[bestCAGR].metrics.cagr * 100).toFixed(2) : 'N/A'}%)\n` +
                   `• Best Sharpe: Run #${bestSharpe + 1} (${data[bestSharpe].metrics.sharpe != null ? data[bestSharpe].metrics.sharpe.toFixed(2) : 'N/A'})\n` +
                   `• Lowest Max DD: Run #${bestDrawdown + 1} (${data[bestDrawdown].metrics.max_drawdown != null ? (data[bestDrawdown].metrics.max_drawdown * 100).toFixed(2) : 'N/A'}%)\n\n` +
                   `💡 For visual comparison, select runs in the Quant tab using the checkboxes.`;

    return {
      success: true,
      message: summary,
      data,
    };
  } catch (error: any) {
    console.error('Compare command error:', error);
    return {
      success: false,
      message: `❌ Failed to compare runs: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /audit_run command - perform deep analysis of a completed run
 * Usage: /audit_run N or /audit_run id:<runId>
 * Examples:
 *   /audit_run 1  (audit most recent completed run)
 *   /audit_run id:abc-123-def
 */
async function handleAuditRun(args: string, context: CommandContext): Promise<CommandResult> {
  const trimmed = args.trim();
  
  if (!trimmed) {
    return {
      success: false,
      message: 'Usage: /audit_run N or /audit_run id:<runId>\nExample: /audit_run 1',
    };
  }

  try {
    let run: BacktestRun | null = null;
    
    // Parse argument: either "id:<uuid>" or a 1-based index
    if (trimmed.startsWith('id:')) {
      const runId = trimmed.slice(3).trim();
      const { data, error } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('id', runId)
        .eq('session_id', context.sessionId)
        .eq('status', 'completed')
        .maybeSingle();
      
      if (error) {
        return {
          success: false,
          message: `❌ Error fetching run: ${error.message}`,
        };
      }
      
      if (!data) {
        return {
          success: false,
          message: `❌ No completed run found with ID: ${runId}`,
        };
      }
      
      run = data as BacktestRun;
    } else {
      // Parse as 1-based index
      const index = parseInt(trimmed, 10);
      if (isNaN(index) || index < 1) {
        return {
          success: false,
          message: 'Invalid index. Use a positive number (1, 2, 3...) or id:<runId>',
        };
      }
      
      // Fetch recent completed runs
      const { data, error } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('session_id', context.sessionId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(20);
      
      if (error || !data || data.length === 0) {
        return {
          success: false,
          message: '❌ No completed runs found for this session',
        };
      }
      
      if (index > data.length) {
        return {
          success: false,
          message: `❌ Index ${index} out of range. Only ${data.length} completed run(s) available.`,
        };
      }
      
      run = data[index - 1] as BacktestRun;
    }
    
    if (!run) {
      return {
        success: false,
        message: '❌ Could not find the specified run',
      };
    }
    
    // Fetch relevant memory notes
    // Priority: run-linked notes, then strategy-tagged notes, then general high-importance
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_notes')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('archived', false)
      .or(`run_id.eq.${run.id},tags.cs.{${run.strategy_key}}`)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20);
    
    if (memoryError) {
      console.error('Failed to fetch memory notes:', memoryError);
    }
    
    const memoryNotes: MemoryNote[] = memoryData || [];
    
    // Build summaries
    const runSummary = buildRunSummary(run);
    const memorySummary = buildMemorySummary(memoryNotes);
    
    // Build audit prompt
    const auditPrompt = buildAuditPrompt(runSummary, memorySummary);
    
    // Call SWARM chat function for agent analysis via electronClient
    const { content } = await chatSwarm([{ role: 'user', content: auditPrompt }]);
    
    // Return the audit analysis
    return {
      success: true,
      message: `🔍 **Strategy Audit: ${run.strategy_key}**\n\n${content}`,
      data: {
        runId: run.id,
        strategyKey: run.strategy_key,
        auditResponse: content,
      },
    };
  } catch (error: any) {
    console.error('Audit run command error:', error);
    return {
      success: false,
      message: `❌ Failed to audit run: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /mine_patterns command - detect recurring patterns across runs and memory
 * Usage: /mine_patterns [limit]
 * Examples:
 *   /mine_patterns
 *   /mine_patterns 50
 */
async function handleMinePatterns(args: string, context: CommandContext): Promise<CommandResult> {
  const limit = parseInt(args.trim(), 10) || 100;

  if (limit < 10 || limit > 200) {
    return {
      success: false,
      message: 'Limit must be between 10 and 200.',
    };
  }

  try {
    // Fetch recent completed runs
    const { data: runs, error: runsError } = await supabase
      .from('backtest_runs')
      .select('*')
      .eq('session_id', context.sessionId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (runsError) throw runsError;

    if (!runs || runs.length < 5) {
      return {
        success: false,
        message: `❌ Not enough runs to mine patterns. Found ${runs?.length || 0} runs, need at least 5.\n\nUse /backtest to run more tests.`,
      };
    }

    // Extract unique strategy keys
    const strategyKeys = [...new Set(runs.map(r => r.strategy_key))];

    // Fetch relevant memory notes
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_notes')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('archived', false)
      .or(`tags.cs.{${strategyKeys.join(',')}},importance.in.(high,critical)`)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30);

    if (memoryError) throw memoryError;

    const memoryNotes = (memoryData || []).map(note => ({
      id: note.id,
      content: note.content,
      memory_type: note.memory_type || 'insight',
      importance: note.importance || 'normal',
      tags: note.tags || [],
      run_id: note.run_id,
      created_at: note.created_at,
      source: note.source,
      archived: note.archived || false,
    }));

    // Build summaries
    const runSummary = buildRunsAggregate(runs as BacktestRun[]);
    const memorySummary = buildRelevantMemory(memoryNotes, strategyKeys);

    // Build pattern mining prompt
    const patternPrompt = buildPatternMinerPrompt(runSummary, memorySummary);

    // Call SWARM chat function for agent analysis via electronClient
    const { content } = await chatSwarm([{ role: 'user', content: patternPrompt }]);

    // Return pattern mining analysis
    return {
      success: true,
      message: `🔍 **Pattern Mining Analysis** (${runs.length} runs, ${strategyKeys.length} strategies)\n\n${content}`,
      data: {
        runsAnalyzed: runs.length,
        strategiesCount: strategyKeys.length,
        memoryNotesCount: memoryNotes.length,
        analysis: content,
      },
    };
  } catch (error: any) {
    console.error('Mine patterns command error:', error);
    return {
      success: false,
      message: `❌ Failed to mine patterns: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /curate_memory command - Review and propose improvements to the rule set
 */
async function handleCurateMemory(
  _args: string,
  context: CommandContext
): Promise<CommandResult> {
  try {
    // Fetch all non-archived memory for this workspace
    const { data: notes, error: notesError } = await supabase
      .from('memory_notes')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(200);

    if (notesError) throw notesError;

    if (!notes || notes.length === 0) {
      return {
        success: true,
        message: `📋 No memory notes to curate yet. Start by creating insights with /note or saving run insights from the Results panel.`,
      };
    }

    // Map to expected MemoryNote structure
    const memoryNotes = notes.map(note => ({
      id: note.id,
      workspace_id: note.workspace_id,
      content: note.content,
      source: note.source,
      tags: note.tags || [],
      created_at: note.created_at,
      run_id: note.run_id,
      metadata: note.metadata || {},
      memory_type: note.memory_type || 'insight',
      importance: note.importance || 'normal',
      archived: note.archived || false,
      embedding: note.embedding,
    }));

    // Build curation summary using helpers
    const summary = buildCurationSummary(memoryNotes);

    // Build curator prompt
    const curatorPrompt = buildMemoryCuratorPrompt(summary);

    // Call SWARM chat function for agent analysis via electronClient
    const { content } = await chatSwarm([{ role: 'user', content: curatorPrompt }]);

    // Return curator recommendations
    return {
      success: true,
      message: `🔧 **Memory Curation Recommendations** (${notes.length} notes reviewed)\n\n${content}\n\n---\n💡 **Note**: These are recommendations only. Use the Memory panel to edit notes manually.`,
      data: {
        notesReviewed: notes.length,
        recommendations: content,
      },
    };
  } catch (error: any) {
    console.error('Memory curation command error:', error);
    return {
      success: false,
      message: `❌ Failed to curate memory: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /suggest_experiments command - Propose next experiments based on runs and memory
 */
async function handleSuggestExperiments(
  args: string,
  context: CommandContext
): Promise<CommandResult> {
  try {
    const focus = args.trim() || undefined;

    // Fetch recent completed runs
    const { data: runs, error: runsError } = await supabase
      .from('backtest_runs')
      .select('*')
      .eq('session_id', context.sessionId)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(100);

    if (runsError) throw runsError;

    if (!runs || runs.length < 5) {
      return {
        success: true,
        message: `📋 Not enough completed runs to suggest experiments yet (found ${runs?.length || 0}, need at least 5).\n\nRun more backtests first using /backtest or the Quant panel.`,
      };
    }

    // Fetch relevant memory notes
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_notes')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('archived', false)
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);

    if (memoryError) throw memoryError;

    const memoryNotes = (memoryData || []).map(note => ({
      id: note.id,
      workspace_id: note.workspace_id,
      content: note.content,
      source: note.source,
      tags: note.tags || [],
      created_at: note.created_at,
      run_id: note.run_id,
      metadata: note.metadata || {},
      memory_type: note.memory_type || 'insight',
      importance: note.importance || 'normal',
      archived: note.archived || false,
    }));

    // Build summaries
    const runSummary = buildExperimentRunSummary(runs as BacktestRun[]);
    const memorySummary = buildExperimentMemorySummary(memoryNotes);
    const patternSummary = ''; // Can be enhanced later to include recent Pattern Miner output

    // Build Experiment Director prompt
    const experimentPrompt = buildExperimentDirectorPrompt(
      runSummary,
      patternSummary,
      memorySummary,
      focus
    );

    // Call SWARM chat function for agent analysis via electronClient
    const { content } = await chatSwarm([{ role: 'user', content: experimentPrompt }]);

    // Return experiment suggestions
    const focusNote = focus ? ` (focus: ${focus})` : '';
    return {
      success: true,
      message: `🎯 **Experiment Plan**${focusNote}\n\nBased on ${runs.length} completed runs and ${memoryNotes.length} memory notes:\n\n${content}`,
      data: {
        runsAnalyzed: runs.length,
        memoryNotesCount: memoryNotes.length,
        focus: focus || null,
        plan: content,
      },
    };
  } catch (error: any) {
    console.error('Suggest experiments command error:', error);
    return {
      success: false,
      message: `❌ Failed to suggest experiments: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /risk_review command - review structural risk across runs
 * Usage: /risk_review [focus]
 * Examples:
 *   /risk_review
 *   /risk_review skew
 *   /risk_review strategy:momentum_breakout_v1
 */
async function handleRiskReview(args: string, context: CommandContext): Promise<CommandResult> {
  const focus = args.trim() || null;

  try {
    // Fetch completed runs
    let query = supabase
      .from('backtest_runs')
      .select('*')
      .eq('session_id', context.sessionId)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(100);

    const { data: runsData, error: runsError } = await query;

    if (runsError) throw runsError;

    const runs = (runsData || []) as BacktestRun[];

    // Require minimum runs for meaningful risk analysis
    if (runs.length < 5) {
      return {
        success: false,
        message: `⚠️ Insufficient data for risk review.\n\nRisk Officer requires at least 5 completed runs. You currently have ${runs.length}.\n\nRun more backtests first using /backtest command.`,
      };
    }

    // Filter by focus if provided
    let filteredRuns = runs;
    if (focus) {
      filteredRuns = runs.filter(r => 
        r.strategy_key.toLowerCase().includes(focus.toLowerCase()) ||
        (r.params?.profileConfig && JSON.stringify(r.params.profileConfig).toLowerCase().includes(focus.toLowerCase()))
      );

      if (filteredRuns.length === 0) {
        return {
          success: false,
          message: `❌ No runs found matching focus: "${focus}"`,
        };
      }
    }

    // Fetch relevant memory notes
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_notes')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(200);

    if (memoryError) throw memoryError;

    const memoryNotes = (memoryData || []).map(note => ({
      id: note.id,
      content: note.content,
      memory_type: note.memory_type || 'insight',
      importance: note.importance || 'normal',
      tags: note.tags || [],
      source: note.source,
      run_id: note.run_id,
      created_at: note.created_at,
      archived: note.archived || false,
    }));

    // Filter memory by focus if provided
    let filteredMemory = memoryNotes;
    if (focus) {
      filteredMemory = memoryNotes.filter(n =>
        n.tags.some((tag: string) => tag.toLowerCase().includes(focus.toLowerCase())) ||
        n.content.toLowerCase().includes(focus.toLowerCase())
      );
    }

    // Build risk summaries
    const runSummary = buildRiskRunSummary(filteredRuns as BacktestRun[]);
    const memorySummary = buildRiskMemorySummary(filteredMemory);
    const patternSummary = ''; // Can be enhanced later to include recent Pattern Miner output

    // Build Risk Officer prompt
    const riskPrompt = buildRiskOfficerPrompt(
      runSummary,
      memorySummary,
      patternSummary
    );

    // Call SWARM chat function for agent analysis via electronClient
    const { content } = await chatSwarm([{ role: 'user', content: riskPrompt }]);

    // Return risk review
    const focusNote = focus ? ` (focus: ${focus})` : '';
    return {
      success: true,
      message: `🛡️ **Risk Review Report**${focusNote}\n\nAnalyzed ${filteredRuns.length} completed runs and ${filteredMemory.length} memory notes:\n\n${content}`,
      data: {
        runsAnalyzed: filteredRuns.length,
        memoryNotesCount: filteredMemory.length,
        focus: focus || null,
        report: content,
      },
    };
  } catch (error: any) {
    console.error('Risk review command error:', error);
    return {
      success: false,
      message: `❌ Failed to perform risk review: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /open_file command - read rotation-engine file contents
 * Usage: /open_file path:profiles/skew.py
 */
async function handleOpenFile(args: string, context: CommandContext): Promise<CommandResult> {
  const pathMatch = args.match(/path:(\S+)/);
  
  if (!pathMatch) {
    return {
      success: false,
      message: 'Usage: /open_file path:<path>\nExample: /open_file path:profiles/skew.py',
    };
  }

  const path = pathMatch[1];

  try {
    const { data, error } = await supabase.functions.invoke('read-file', {
      body: { path },
    });

    if (error) throw error;

    if (!data || !data.content) {
      throw new Error('No content returned from read-file');
    }

    return {
      success: true,
      message: `📄 **File: ${path}**\n\n\`\`\`\n${data.content}\n\`\`\``,
      data: {
        path,
        content: data.content,
      },
    };
  } catch (error: any) {
    console.error('Open file command error:', error);
    return {
      success: false,
      message: `❌ Failed to read file: ${error.message || 'Unknown error'}\n\n💡 Tip: Use /list_dir to explore available files.`,
    };
  }
}

/**
 * /list_dir command - list rotation-engine directory contents
 * Usage: /list_dir path:profiles OR /list_dir path:.
 */
async function handleListDir(args: string, context: CommandContext): Promise<CommandResult> {
  const pathMatch = args.match(/path:(\S+)/);
  const path = pathMatch ? pathMatch[1] : '.';

  try {
    const { data, error } = await supabase.functions.invoke('list-dir', {
      body: { path },
    });

    if (error) throw error;

    if (!data || !data.entries) {
      throw new Error('No entries returned from list-dir');
    }

    const entries = data.entries as Array<{ name: string; type: string }>;

    if (entries.length === 0) {
      return {
        success: true,
        message: `📁 **Directory: ${path}**\n\n(empty)`,
        data: { path, entries: [] },
      };
    }

    const formatted = entries
      .map(e => `  ${e.type === 'directory' ? '📁' : '📄'} ${e.name}`)
      .join('\n');

    return {
      success: true,
      message: `📁 **Directory: ${path}**\n\n${formatted}`,
      data: {
        path,
        entries,
      },
    };
  } catch (error: any) {
    console.error('List dir command error:', error);
    return {
      success: false,
      message: `❌ Failed to list directory: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /search_code command - search rotation-engine code for terms
 * Usage: /search_code peakless OR /search_code path:profiles peakless
 */
async function handleSearchCode(args: string, context: CommandContext): Promise<CommandResult> {
  const pathMatch = args.match(/path:(\S+)/);
  let query = args;
  let path = '.';

  if (pathMatch) {
    path = pathMatch[1];
    query = args.replace(/path:\S+\s*/, '').trim();
  }

  if (!query) {
    return {
      success: false,
      message: 'Usage: /search_code <query> OR /search_code path:<path> <query>\nExample: /search_code peakless',
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('search-code', {
      body: { query, path },
    });

    if (error) throw error;

    if (!data || !data.results) {
      throw new Error('No results returned from search-code');
    }

    const results = data.results as Array<{ file: string; line: number; context: string }>;

    if (results.length === 0) {
      return {
        success: true,
        message: `🔍 **Search: "${query}"** (in ${path})\n\nNo matches found.`,
        data: { query, path, results: [] },
      };
    }

    const formatted = results
      .slice(0, 50) // Limit display to 50 results
      .map((r, i) => `${i + 1}. **${r.file}:${r.line}**\n   \`${r.context}\``)
      .join('\n\n');

    const suffix = results.length > 50 ? `\n\n... and ${results.length - 50} more results` : '';

    return {
      success: true,
      message: `🔍 **Search: "${query}"** (in ${path})\n\nFound ${results.length} match(es):\n\n${formatted}${suffix}`,
      data: {
        query,
        path,
        results,
      },
    };
  } catch (error: any) {
    console.error('Search code command error:', error);
    return {
      success: false,
      message: `❌ Failed to search code: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /auto_analyze command - autonomous research loop (v2 with parallel swarm)
 * Runs multiple research agents in parallel, then synthesizes via PRIMARY_MODEL
 * Usage: /auto_analyze [scope]
 */
async function handleAutoAnalyze(args: string, context: CommandContext): Promise<CommandResult> {
  const scope = args.trim();

  try {
    // Fetch completed runs for this session
    const { data: runsData, error: runsError } = await supabase
      .from('backtest_runs')
      .select('*')
      .eq('session_id', context.sessionId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(100);

    if (runsError) throw runsError;

    const runs = (runsData || []) as BacktestRun[];

    if (runs.length === 0) {
      return {
        success: false,
        message: '❌ No completed runs found for this session. Run some backtests first before using /auto_analyze.',
      };
    }

    if (runs.length < 5) {
      return {
        success: false,
        message: `⚠️ Auto-analyze works best with at least 5 completed runs. You currently have ${runs.length}. Consider running more backtests.`,
      };
    }

    // Filter by scope if provided
    let filteredRuns = runs;
    if (scope) {
      filteredRuns = runs.filter(r =>
        r.strategy_key.toLowerCase().includes(scope.toLowerCase()) ||
        (r.notes && r.notes.toLowerCase().includes(scope.toLowerCase()))
      );

      if (filteredRuns.length === 0) {
        return {
          success: false,
          message: `❌ No runs match scope "${scope}". Try a different scope or run /auto_analyze without scope.`,
        };
      }
    }

    // Build portfolio summary
    const portfolioSummary = buildRunPortfolioSummary(filteredRuns);

    // Fetch memory notes
    const { data: memoryData, error: memoryError } = await supabase
      .from('memory_notes')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(200);

    if (memoryError) throw memoryError;

    const memoryNotes = (memoryData || []) as MemoryNote[];

    // Build summary inputs for agents
    const runsAggregate = buildRunsAggregate(filteredRuns.slice(0, 100));
    const strategyKeys = [...new Set(filteredRuns.map(r => r.strategy_key))];
    const relevantMemory = buildRelevantMemory(memoryNotes as unknown as any, strategyKeys);
    const riskRunSummary = buildRiskRunSummary(filteredRuns);
    const riskMemorySummary = buildRiskMemorySummary(memoryNotes as unknown as any);
    const experimentRunSummary = buildExperimentRunSummary(filteredRuns);
    const experimentMemorySummary = buildExperimentMemorySummary(memoryNotes as unknown as any);
    const curationSummary = buildCurationSummary(memoryNotes as unknown as any);

    // Build swarm prompts for parallel execution
    const swarmPrompts: SwarmPrompt[] = [
      {
        label: 'pattern-miner',
        content: buildPatternMinerAgentPrompt(runsAggregate, relevantMemory, scope),
      },
      {
        label: 'memory-curator',
        content: buildCuratorAgentPrompt(curationSummary, scope),
      },
      {
        label: 'risk-officer',
        content: buildRiskAgentPrompt(riskRunSummary, riskMemorySummary, scope),
      },
      {
        label: 'experiment-director',
        content: buildExperimentAgentPrompt(experimentRunSummary, '', scope),
      },
    ];

    // Execute all agents in parallel via SWARM_MODEL
    const swarmResults = await runSwarm({
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      prompts: swarmPrompts,
    });

    // Check if all agents failed
    const allFailed = swarmResults.every(r => r.error);
    if (allFailed) {
      return {
        success: false,
        message: '❌ All research agents failed. Check logs for details.',
      };
    }

    // Build synthesis input from agent outputs
    let synthesisInput = `# Autonomous Research Analysis Input\n\n`;
    synthesisInput += `**Scope**: ${scope || 'global'}\n\n`;
    synthesisInput += `## Run Portfolio\n\n${portfolioSummary}\n\n`;
    
    // Add agent outputs
    for (const result of swarmResults) {
      synthesisInput += `## Agent: ${result.label}\n\n`;
      if (result.error) {
        synthesisInput += `*Agent failed: ${result.error}*\n\n`;
      } else {
        synthesisInput += `${result.content}\n\n`;
      }
    }

    // Build final synthesis prompt
    const finalPrompt = buildAutoAnalyzePrompt(scope, synthesisInput);

    // Call PRIMARY chat for final synthesis (high-stakes reasoning) via electronClient
    const { content: finalContent } = await chatPrimary([
      { role: 'user', content: finalPrompt }
    ]);

    // Return comprehensive report with save tip
    const scopeNote = scope ? ` (scope: ${scope})` : '';
    const successfulAgents = swarmResults.filter(r => !r.error).length;
    return {
      success: true,
      message: `🤖 **Autonomous Research Report**${scopeNote}\n\nAnalyzed ${filteredRuns.length} runs using ${successfulAgents} parallel research agents:\n\n${finalContent}\n\n---\n\n💡 **Tip**: Use \`/save_report\` to store this Research Report for later.`,
      data: {
        runsAnalyzed: filteredRuns.length,
        agentsUsed: successfulAgents,
        memoryNotesReviewed: memoryNotes.length,
        scope: scope || null,
        report: finalContent,
      },
    };
  } catch (error: any) {
    console.error('Auto-analyze command error:', error);
    return {
      success: false,
      message: `❌ Failed to complete autonomous analysis: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /save_report command - save the last /auto_analyze report
 * Usage: /save_report [scope:<value>] [title:"Custom Title"]
 */
async function handleSaveReport(args: string, context: CommandContext): Promise<CommandResult> {
  try {
    // Parse optional arguments
    const scopeMatch = args.match(/scope:(\S+)/);
    const titleMatch = args.match(/title:"([^"]+)"/);
    
    const scope = scopeMatch ? scopeMatch[1] : null;
    const customTitle = titleMatch ? titleMatch[1] : null;

    // Find the most recent auto_analyze report in this session
    const { data: messagesData, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('session_id', context.sessionId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (messagesError) throw messagesError;

    // Look for assistant/system message containing Research Report
    const reportMessage = messagesData?.find(msg =>
      msg.content && (
        msg.content.includes('Autonomous Research Report') ||
        msg.content.includes('Research Report:')
      )
    );

    if (!reportMessage) {
      return {
        success: false,
        message: '❌ No recent Research Report found to save. Run `/auto_analyze` first.',
      };
    }

    // Extract report content (remove the tip line)
    let reportContent = reportMessage.content;
    reportContent = reportContent.replace(/\n\n---\n\n💡 \*\*Tip\*\*:.*$/, '');

    // Build summary and tags
    const summary = extractSummaryFromReport(reportContent);
    const tags = buildTagsFromReport(scope, reportContent);

    // Call report-save edge function
    const { data: saveData, error: saveError } = await supabase.functions.invoke('report-save', {
      body: {
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        scope: scope,
        title: customTitle || undefined,
        summary: summary,
        content: reportContent,
        tags: tags,
      },
    });

    if (saveError) throw saveError;

    if (!saveData || !saveData.id) {
      throw new Error('No report ID returned from save operation');
    }

    const shortId = saveData.id.substring(0, 8);
    return {
      success: true,
      message: `✅ Report saved as **${saveData.title}** (id: ${shortId})`,
      data: saveData,
    };

  } catch (error: any) {
    console.error('Save report command error:', error);
    return {
      success: false,
      message: `❌ Failed to save report: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /list_reports command - list saved research reports
 * Usage: /list_reports [scope:<value>] [tag:<value>]
 */
async function handleListReports(args: string, context: CommandContext): Promise<CommandResult> {
  try {
    // Parse optional filters
    const scopeMatch = args.match(/scope:(\S+)/);
    const tagMatch = args.match(/tag:(\S+)/);
    
    const scopeFilter = scopeMatch ? scopeMatch[1] : null;
    const tagFilter = tagMatch ? tagMatch[1] : null;

    // Build query
    let query = supabase
      .from('research_reports')
      .select('*')
      .eq('workspace_id', context.workspaceId);

    // Apply filters
    if (scopeFilter) {
      query = query.ilike('scope', `%${scopeFilter}%`);
    }

    if (tagFilter) {
      query = query.contains('tags', [tagFilter]);
    }

    // Order and limit
    query = query.order('created_at', { ascending: false }).limit(20);

    const { data, error } = await query;

    if (error) throw error;

    if (!data || data.length === 0) {
      const filterNote = scopeFilter || tagFilter 
        ? ` matching filters (scope: ${scopeFilter || 'none'}, tag: ${tagFilter || 'none'})`
        : '';
      return {
        success: true,
        message: `📋 No reports found${filterNote}.`,
        data: [],
      };
    }

    // Format report list
    const reportList = data.map((report, index) => {
      const date = new Date(report.created_at).toISOString().split('T')[0];
      const shortId = report.id.substring(0, 8);
      const scopeTag = report.scope ? ` [${report.scope}]` : '';
      return `${index + 1}) **[${date}]** ${report.title}${scopeTag} (id: ${shortId})`;
    }).join('\n');

    const filterNote = scopeFilter || tagFilter
      ? `\n\n**Filters**: ${scopeFilter ? `scope=${scopeFilter}` : ''}${scopeFilter && tagFilter ? ', ' : ''}${tagFilter ? `tag=${tagFilter}` : ''}`
      : '';

    return {
      success: true,
      message: `📋 **Research Reports** (${data.length} found):\n\n${reportList}${filterNote}`,
      data: data,
    };

  } catch (error: any) {
    console.error('List reports command error:', error);
    return {
      success: false,
      message: `❌ Failed to list reports: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /open_report command - open a saved research report
 * Usage: /open_report id:<uuid>
 */
async function handleOpenReport(args: string, context: CommandContext): Promise<CommandResult> {
  try {
    // Parse id argument
    const idMatch = args.match(/id:(\S+)/);
    
    if (!idMatch) {
      return {
        success: false,
        message: 'Usage: /open_report id:<uuid>\nExample: /open_report id:abc12345',
      };
    }

    const reportId = idMatch[1];

    // Fetch report
    const { data, error } = await supabase
      .from('research_reports')
      .select('*')
      .eq('id', reportId)
      .eq('workspace_id', context.workspaceId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return {
        success: false,
        message: `❌ Report not found for id: ${reportId}`,
      };
    }

    // Format report display
    const date = new Date(data.created_at).toISOString().split('T')[0];
    const scopeTag = data.scope ? ` [${data.scope}]` : '';
    const tags = data.tags && data.tags.length > 0 ? `\n**Tags**: ${data.tags.join(', ')}` : '';

    return {
      success: true,
      message: `📄 **Report: ${data.title}**${scopeTag}\n\n**Date**: ${date}${tags}\n\n---\n\n${data.content}`,
      data: data,
    };

  } catch (error: any) {
    console.error('Open report command error:', error);
    return {
      success: false,
      message: `❌ Failed to open report: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /red_team_file command - run multi-agent red team audit on rotation-engine code
 * Usage: /red_team_file path:<path>
 * Example: /red_team_file path:profiles/skew.py
 */
async function handleRedTeamFile(args: string, context: CommandContext): Promise<CommandResult> {
  // Parse path argument
  const pathMatch = args.match(/path:(\S+)/);
  
  if (!pathMatch) {
    return {
      success: false,
      message: 'Usage: /red_team_file path:<path>\nExample: /red_team_file path:profiles/skew.py',
    };
  }

  const filePath = pathMatch[1];

  try {
    // Fetch file contents via read-file edge function
    const { data: fileData, error: fileError } = await supabase.functions.invoke('read-file', {
      body: { path: filePath },
    });

    if (fileError) {
      console.error('read-file error:', fileError);
      return {
        success: false,
        message: `❌ Failed to read file: ${fileError.message}`,
      };
    }

    if (!fileData || !fileData.content) {
      return {
        success: false,
        message: `❌ File not found at path: ${filePath}\n\nTip: Use /list_dir to explore available files.`,
      };
    }

    const code = fileData.content;

    // Run multi-agent red team audit
    const result = await runRedTeamAuditForFile({
      sessionId: context.sessionId,
      workspaceId: context.workspaceId,
      path: filePath,
      code,
      context: '', // Could be enhanced later to accept context from user
    });

    return {
      success: true,
      message: result.report,
      data: result,
    };

  } catch (error: any) {
    console.error('Red team audit error:', error);
    return {
      success: false,
      message: `❌ Red team audit failed: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /write_file command - create or overwrite file
 */
async function handleWriteFile(args: string, context: CommandContext): Promise<CommandResult> {
  // Parse: /write_file <path> <content>
  const match = args.match(/^(\S+)\s+(.+)$/s);
  if (!match) {
    return { 
      success: false, 
      message: '❌ Usage: /write_file <path> <content>\n\nExample:\n/write_file strategies/test.py def my_function():\n    return True' 
    };
  }
  
  const [, path, content] = match;
  
  const result = await writeFile(path, content, globalWriteConfirmationCallback);
  
  if (!result.success) {
    return {
      success: false,
      message: `❌ Write failed: ${result.error}`
    };
  }
  
  let message = `✅ File written successfully: \`${path}\``;
  if (result.backup_path) {
    message += `\n📦 Backup created: \`${result.backup_path}\``;
  }
  
  return {
    success: true,
    message,
    data: result
  };
}

/**
 * /append_file command - append content to file
 */
async function handleAppendFile(args: string, context: CommandContext): Promise<CommandResult> {
  const match = args.match(/^(\S+)\s+(.+)$/s);
  if (!match) {
    return { 
      success: false, 
      message: '❌ Usage: /append_file <path> <content>\n\nExample:\n/append_file strategies/test.py # New function\ndef new_func():\n    pass' 
    };
  }
  
  const [, path, content] = match;
  
  const result = await appendFile(path, content, globalWriteConfirmationCallback);
  
  if (!result.success) {
    return {
      success: false,
      message: `❌ Append failed: ${result.error}`
    };
  }
  
  let message = `✅ Content appended successfully: \`${path}\``;
  if (result.backup_path) {
    message += `\n📦 Backup created: \`${result.backup_path}\``;
  }
  if (result.preview) {
    message += `\n\n**Preview (last 20 lines):**\n\`\`\`\n${result.preview}\n\`\`\``;
  }
  
  return {
    success: true,
    message,
    data: result
  };
}

/**
 * /delete_file command - delete file with backup
 */
async function handleDeleteFile(args: string, context: CommandContext): Promise<CommandResult> {
  const path = args.trim();
  if (!path) {
    return { 
      success: false, 
      message: '❌ Usage: /delete_file <path>\n\nExample:\n/delete_file strategies/old_strategy.py' 
    };
  }
  
  const result = await deleteFile(path, globalWriteConfirmationCallback);
  
  if (!result.success) {
    return {
      success: false,
      message: `❌ Delete failed: ${result.error}`
    };
  }
  
  let message = `✅ File deleted: \`${path}\``;
  if (result.backup_path) {
    message += `\n📦 Backup created: \`${result.backup_path}\``;
  }
  
  return {
    success: true,
    message,
    data: result
  };
}

/**
 * /rename_file command - rename or move file
 */
async function handleRenameFile(args: string, context: CommandContext): Promise<CommandResult> {
  const match = args.match(/^(\S+)\s+(\S+)$/);
  if (!match) {
    return { 
      success: false, 
      message: '❌ Usage: /rename_file <old_path> <new_path>\n\nExample:\n/rename_file strategies/old.py strategies/new.py' 
    };
  }
  
  const [, oldPath, newPath] = match;
  
  const result = await renameFile(oldPath, newPath, globalWriteConfirmationCallback);
  
  if (!result.success) {
    return {
      success: false,
      message: `❌ Rename failed: ${result.error}`
    };
  }
  
  let message = `✅ File renamed: \`${oldPath}\` → \`${newPath}\``;
  if (result.backup_path) {
    message += `\n📦 Backup created: \`${result.backup_path}\``;
  }
  
  return {
    success: true,
    message,
    data: result
  };
}

/**
 * /copy_file command - copy file
 */
async function handleCopyFile(args: string, context: CommandContext): Promise<CommandResult> {
  const match = args.match(/^(\S+)\s+(\S+)$/);
  if (!match) {
    return { 
      success: false, 
      message: '❌ Usage: /copy_file <source_path> <dest_path>\n\nExample:\n/copy_file strategies/base.py strategies/variant.py' 
    };
  }
  
  const [, sourcePath, destPath] = match;
  
  const result = await copyFile(sourcePath, destPath, globalWriteConfirmationCallback);
  
  if (!result.success) {
    return {
      success: false,
      message: `❌ Copy failed: ${result.error}`
    };
  }
  
  return {
    success: true,
    message: `✅ File copied: \`${sourcePath}\` → \`${destPath}\``,
    data: result
  };
}

/**
 * /create_dir command - create directory
 */
async function handleCreateDir(args: string, context: CommandContext): Promise<CommandResult> {
  const path = args.trim();
  if (!path) {
    return { 
      success: false, 
      message: '❌ Usage: /create_dir <path>\n\nExample:\n/create_dir strategies/experimental' 
    };
  }
  
  const result = await createDirectory(path);
  
  if (!result.success) {
    return {
      success: false,
      message: `❌ Directory creation failed: ${result.error}`
    };
  }
  
  return {
    success: true,
    message: `✅ Directory created: \`${path}\``,
    data: result
  };
}

/**
 * /inspect_data command - inspect raw market data
 * Usage: /inspect_data symbol:<symbol> start:<YYYY-MM-DD> end:<YYYY-MM-DD>
 */
async function handleInspectData(args: string, _context: CommandContext): Promise<CommandResult> {
  const symbolMatch = args.match(/symbol:(\S+)/);
  const startMatch = args.match(/start:(\d{4}-\d{2}-\d{2})/);
  const endMatch = args.match(/end:(\d{4}-\d{2}-\d{2})/);
  
  if (!symbolMatch || !startMatch || !endMatch) {
    return {
      success: false,
      message: 'Usage: /inspect_data symbol:<symbol> start:<YYYY-MM-DD> end:<YYYY-MM-DD>\nExample: /inspect_data symbol:SPX start:2024-01-01 end:2024-03-31',
    };
  }
  
  const symbol = symbolMatch[1];
  const startDate = startMatch[1];
  const endDate = endMatch[1];
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'inspect_market_data',
        args: { symbol, start_date: startDate, end_date: endDate }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Market data inspection completed',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to inspect market data: ${error.message}`,
    };
  }
}

/**
 * /data_quality command - check data quality
 * Usage: /data_quality symbol:<symbol> start:<YYYY-MM-DD> end:<YYYY-MM-DD>
 */
async function handleDataQuality(args: string, _context: CommandContext): Promise<CommandResult> {
  const symbolMatch = args.match(/symbol:(\S+)/);
  const startMatch = args.match(/start:(\d{4}-\d{2}-\d{2})/);
  const endMatch = args.match(/end:(\d{4}-\d{2}-\d{2})/);
  
  if (!symbolMatch || !startMatch || !endMatch) {
    return {
      success: false,
      message: 'Usage: /data_quality symbol:<symbol> start:<YYYY-MM-DD> end:<YYYY-MM-DD>\nExample: /data_quality symbol:SPX start:2024-01-01 end:2024-03-31',
    };
  }
  
  const symbol = symbolMatch[1];
  const startDate = startMatch[1];
  const endDate = endMatch[1];
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'data_quality_check',
        args: { symbol, start_date: startDate, end_date: endDate }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Data quality check completed',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to check data quality: ${error.message}`,
    };
  }
}

/**
 * /trade_log command - get trade log for a backtest run
 * Usage: /trade_log id:<runId> or /trade_log N (Nth most recent)
 */
async function handleTradeLog(args: string, context: CommandContext): Promise<CommandResult> {
  let runId: string | undefined;
  
  const idMatch = args.match(/id:([0-9a-f-]{36})/i);
  if (idMatch) {
    runId = idMatch[1];
  } else {
    const nMatch = args.match(/^\d+$/);
    if (nMatch) {
      const n = parseInt(args, 10);
      const { data: runs, error: runsError } = await supabase
        .from('backtest_runs')
        .select('id')
        .eq('session_id', context.sessionId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(n);
      
      if (runsError || !runs || runs.length < n) {
        return {
          success: false,
          message: `❌ Only ${runs?.length || 0} completed runs available`,
        };
      }
      
      runId = runs[n - 1].id;
    }
  }
  
  if (!runId) {
    return {
      success: false,
      message: 'Usage: /trade_log id:<runId> or /trade_log N\nExample: /trade_log 1 (most recent) or /trade_log id:abc-123-...',
    };
  }
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'get_trade_log',
        args: { run_id: runId }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Trade log retrieved',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to get trade log: ${error.message}`,
    };
  }
}

/**
 * /trade_detail command - get detailed analysis of specific trade
 * Usage: /trade_detail id:<runId> idx:<tradeIdx>
 */
async function handleTradeDetail(args: string, _context: CommandContext): Promise<CommandResult> {
  const idMatch = args.match(/id:([0-9a-f-]{36})/i);
  const idxMatch = args.match(/idx:(\d+)/);
  
  if (!idMatch || !idxMatch) {
    return {
      success: false,
      message: 'Usage: /trade_detail id:<runId> idx:<tradeIdx>\nExample: /trade_detail id:abc-123-... idx:5',
    };
  }
  
  const runId = idMatch[1];
  const tradeIdx = parseInt(idxMatch[1], 10);
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'get_trade_detail',
        args: { run_id: runId, trade_idx: tradeIdx }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Trade detail retrieved',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to get trade detail: ${error.message}`,
    };
  }
}

/**
 * /generate_docstrings command - auto-generate docstrings for Python file
 * Usage: /generate_docstrings path:<path>
 */
async function handleGenerateDocstrings(args: string, _context: CommandContext): Promise<CommandResult> {
  const pathMatch = args.match(/path:(\S+)/);
  
  if (!pathMatch) {
    return {
      success: false,
      message: 'Usage: /generate_docstrings path:<path>\nExample: /generate_docstrings path:strategies/skew.py',
    };
  }
  
  const path = pathMatch[1];
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'generate_docstrings',
        args: { path }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Docstrings generated',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to generate docstrings: ${error.message}`,
    };
  }
}

/**
 * /generate_readme command - generate README for module
 * Usage: /generate_readme path:<path>
 */
async function handleGenerateReadme(args: string, _context: CommandContext): Promise<CommandResult> {
  const pathMatch = args.match(/path:(\S+)/);
  
  if (!pathMatch) {
    return {
      success: false,
      message: 'Usage: /generate_readme path:<path>\nExample: /generate_readme path:strategies or /generate_readme path:profiles/skew.py',
    };
  }
  
  const path = pathMatch[1];
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'generate_readme',
        args: { path }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'README generated',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to generate README: ${error.message}`,
    };
  }
}

/**
 * /create_strategy command - generate strategy template
 * Usage: /create_strategy name:<name>
 */
async function handleCreateStrategy(args: string, _context: CommandContext): Promise<CommandResult> {
  const nameMatch = args.match(/name:(\S+)/);
  
  if (!nameMatch) {
    return {
      success: false,
      message: 'Usage: /create_strategy name:<name>\nExample: /create_strategy name:my_strategy_v1',
    };
  }
  
  const name = nameMatch[1];
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'create_strategy',
        args: { name }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Strategy template created',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to create strategy: ${error.message}`,
    };
  }
}

/**
 * /create_profile command - generate profile template
 * Usage: /create_profile strategy:<key> name:<name>
 */
async function handleCreateProfile(args: string, _context: CommandContext): Promise<CommandResult> {
  const strategyMatch = args.match(/strategy:(\S+)/);
  const nameMatch = args.match(/name:(\S+)/);
  
  if (!strategyMatch || !nameMatch) {
    return {
      success: false,
      message: 'Usage: /create_profile strategy:<key> name:<name>\nExample: /create_profile strategy:skew name:aggressive_v1',
    };
  }
  
  const strategyKey = strategyMatch[1];
  const name = nameMatch[1];
  
  try {
    const { data, error } = await supabase.functions.invoke('workspace-init-prompt', {
      body: {
        tool: 'create_profile',
        args: { strategy_key: strategyKey, name }
      }
    });
    
    if (error) throw error;
    
    return {
      success: true,
      message: data.result || 'Profile template created',
      data
    };
  } catch (error: any) {
    return {
      success: false,
      message: `❌ Failed to create profile: ${error.message}`,
    };
  }
}

/**
 * /experiment command - start a named experiment
 * Usage: /experiment <name> [description]
 * Examples:
 *   /experiment momentum-testing Testing different lookback periods
 *   /experiment vol-spike-v2
 */
async function handleExperiment(args: string, context: CommandContext): Promise<CommandResult> {
  const parts = args.trim().split(/\s+/);

  if (parts.length === 0 || !parts[0]) {
    return {
      success: false,
      message: 'Usage: /experiment <name> [description]\n\nExample: /experiment momentum-testing Testing different lookback periods',
    };
  }

  const name = parts[0];
  const description = parts.slice(1).join(' ') || null;

  try {
    // Check if experiment with this name already exists
    const { data: existingExp } = await supabase
      .from('experiments')
      .select('id, status')
      .eq('workspace_id', context.workspaceId)
      .eq('name', name)
      .maybeSingle();

    if (existingExp) {
      if (existingExp.status === 'active') {
        return {
          success: false,
          message: `❌ Experiment "${name}" already exists and is active.\n\nUse /resume ${name} to continue it, or choose a different name.`,
        };
      }
      // Reactivate archived experiment
      const { error: updateError } = await supabase
        .from('experiments')
        .update({ status: 'active', session_id: context.sessionId })
        .eq('id', existingExp.id);

      if (updateError) throw updateError;

      return {
        success: true,
        message: `🔄 Reactivated experiment: **${name}**\n\nAll subsequent /backtest runs will be tagged with this experiment.`,
        data: { experimentId: existingExp.id, name },
      };
    }

    // Create new experiment
    const { data: newExp, error } = await supabase
      .from('experiments')
      .insert({
        name,
        description,
        session_id: context.sessionId,
        workspace_id: context.workspaceId,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message: `🧪 Started experiment: **${name}**\n\n${description || 'No description provided.'}\n\nAll subsequent /backtest runs will be tagged with this experiment.\n\nUse /checkpoint to save progress notes, or /experiment <new-name> to start a different experiment.`,
      data: { experimentId: newExp.id, name },
    };
  } catch (error: any) {
    console.error('Experiment command error:', error);
    return {
      success: false,
      message: `❌ Failed to create experiment: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /iterate command - re-run last backtest with modified parameters
 * Usage: /iterate [param=value ...]
 * Examples:
 *   /iterate
 *   /iterate capital=50000
 *   /iterate lookback=30 threshold=0.02
 */
async function handleIterate(args: string, context: CommandContext): Promise<CommandResult> {
  try {
    // Get last run from session
    const { data: lastRun, error: fetchError } = await supabase
      .from('backtest_runs')
      .select('*')
      .eq('session_id', context.sessionId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!lastRun) {
      return {
        success: false,
        message: '❌ No previous backtest found in this session.\n\nRun /backtest first to establish a baseline.',
      };
    }

    // Parse parameter overrides from args
    const parts = args.trim().split(/\s+/).filter(p => p);
    const overrides: Record<string, any> = {};

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key && value) {
        // Try to parse as number, otherwise keep as string
        overrides[key] = isNaN(Number(value)) ? value : Number(value);
      }
    }

    // Build new params by merging with last run
    const baseParams = lastRun.params || {};
    const newParams = { ...baseParams, ...overrides };

    // Extract key params for backtest
    const strategyKey = lastRun.strategy_key;
    const startDate = newParams.startDate || lastRun.start_date || '2020-01-01';
    const endDate = newParams.endDate || lastRun.end_date || '2024-12-31';
    const capital = newParams.capital || lastRun.capital || 100000;

    // Show what's changing
    const changesList = Object.entries(overrides).length > 0
      ? Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(', ')
      : 'None (re-running with same parameters)';

    // Execute the backtest (reuse handleBacktest logic)
    const backtestArgs = `${strategyKey} ${startDate} ${endDate} ${capital}`;
    const result = await handleBacktest(backtestArgs, context);

    // Prepend iteration context to result message
    if (result.success) {
      result.message = `🔄 **Iteration of ${strategyKey}**\n\n**Changes:** ${changesList}\n\n${result.message}`;
    }

    return result;
  } catch (error: any) {
    console.error('Iterate command error:', error);
    return {
      success: false,
      message: `❌ Failed to iterate: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /checkpoint command - save experiment progress with notes
 * Usage: /checkpoint <notes>
 * Examples:
 *   /checkpoint Found lookback=25 works best, trying different thresholds next
 *   /checkpoint Skew profile works in high VIX regimes, need to test low VIX
 */
async function handleCheckpoint(args: string, context: CommandContext): Promise<CommandResult> {
  const notes = args.trim();

  if (!notes) {
    return {
      success: false,
      message: 'Usage: /checkpoint <notes about current progress>\n\nExample: /checkpoint Found lookback=25 works best, trying different thresholds next',
    };
  }

  try {
    // Get current active experiment if any
    const { data: experiment } = await supabase
      .from('experiments')
      .select('id, name')
      .eq('workspace_id', context.workspaceId)
      .eq('session_id', context.sessionId)
      .eq('status', 'active')
      .maybeSingle();

    // Count runs in this session
    const { count: runCount } = await supabase
      .from('backtest_runs')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', context.sessionId);

    // Get best run metrics for snapshot
    const { data: bestRun } = await supabase
      .from('backtest_runs')
      .select('id, strategy_key, metrics, params')
      .eq('session_id', context.sessionId)
      .eq('status', 'completed')
      .order('metrics->sharpe', { ascending: false })
      .limit(1)
      .maybeSingle();

    const snapshotData = bestRun
      ? {
          best_sharpe: bestRun.metrics?.sharpe,
          best_run_id: bestRun.id,
          best_strategy: bestRun.strategy_key,
          params_used: bestRun.params,
        }
      : {};

    // Save checkpoint
    const { data: checkpoint, error } = await supabase
      .from('experiment_checkpoints')
      .insert({
        experiment_id: experiment?.id || null,
        session_id: context.sessionId,
        notes,
        run_count: runCount || 0,
        snapshot_data: snapshotData,
      })
      .select()
      .single();

    if (error) throw error;

    const experimentContext = experiment
      ? `Experiment: **${experiment.name}**\n`
      : '';

    return {
      success: true,
      message: `✅ Checkpoint saved\n\n${experimentContext}**Notes:** ${notes}\n**Runs completed:** ${runCount || 0}\n\nUse /resume to return to this state later.`,
      data: checkpoint,
    };
  } catch (error: any) {
    console.error('Checkpoint command error:', error);
    return {
      success: false,
      message: `❌ Failed to save checkpoint: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /resume command - resume a previous experiment
 * Usage: /resume [experiment-name]
 * Examples:
 *   /resume momentum-testing
 *   /resume (to list available experiments)
 */
async function handleResume(args: string, context: CommandContext): Promise<CommandResult> {
  const name = args.trim();

  try {
    if (!name) {
      // List available experiments
      const { data: experiments, error } = await supabase
        .from('experiments')
        .select('name, description, status, created_at, updated_at')
        .eq('workspace_id', context.workspaceId)
        .order('updated_at', { ascending: false })
        .limit(10);

      if (error) throw error;

      if (!experiments || experiments.length === 0) {
        return {
          success: true,
          message: '📋 No experiments found.\n\nStart one with /experiment <name>',
        };
      }

      const experimentsList = experiments
        .map((e) => {
          const status = e.status === 'active' ? '🟢' : e.status === 'completed' ? '✅' : '📦';
          const date = new Date(e.updated_at || e.created_at).toLocaleDateString();
          return `${status} **${e.name}** (${e.status}) - ${date}\n   ${e.description || 'No description'}`;
        })
        .join('\n\n');

      return {
        success: true,
        message: `📋 Available experiments:\n\n${experimentsList}\n\nUse /resume <name> to continue an experiment.`,
      };
    }

    // Find experiment by name (case-insensitive partial match)
    const { data: experiment, error: fetchError } = await supabase
      .from('experiments')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .ilike('name', `%${name}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!experiment) {
      return {
        success: false,
        message: `❌ Experiment "${name}" not found.\n\nUse /resume (without name) to list available experiments.`,
      };
    }

    // Get last checkpoint
    const { data: lastCheckpoint } = await supabase
      .from('experiment_checkpoints')
      .select('notes, run_count, created_at')
      .eq('experiment_id', experiment.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Reactivate experiment if not active
    if (experiment.status !== 'active') {
      const { error: updateError } = await supabase
        .from('experiments')
        .update({ status: 'active', session_id: context.sessionId })
        .eq('id', experiment.id);

      if (updateError) throw updateError;
    }

    const checkpointInfo = lastCheckpoint
      ? `**Last checkpoint (${new Date(lastCheckpoint.created_at).toLocaleDateString()}):**\n${lastCheckpoint.notes}\n**Runs at checkpoint:** ${lastCheckpoint.run_count}`
      : 'No checkpoints yet.';

    return {
      success: true,
      message: `🔄 Resumed experiment: **${experiment.name}**\n\n${experiment.description || ''}\n\n${checkpointInfo}\n\nAll subsequent /backtest runs will be tagged with this experiment.`,
      data: { experimentId: experiment.id, name: experiment.name },
    };
  } catch (error: any) {
    console.error('Resume command error:', error);
    return {
      success: false,
      message: `❌ Failed to resume experiment: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * /evolve_strategy command - run genetic algorithm evolution on a strategy
 * Usage: /evolve_strategy <strategy_ref> [--agents=N] [--generations=N]
 * Examples:
 *   /evolve_strategy path:strategies/skew_convexity.py
 *   /evolve_strategy path:src/strategies/momentum.py --agents=30
 *   /evolve_strategy skew_convexity_v1 (looks up in database)
 */
async function handleEvolveStrategy(args: string, context: CommandContext): Promise<CommandResult> {
  const { strategyRef, agentCount } = parseEvolveCommand(args);

  if (!strategyRef) {
    return {
      success: false,
      message: `Usage: ${EVOLVE_STRATEGY_CONFIG.usage}\n\nExamples:\n  /evolve_strategy path:strategies/skew_convexity.py\n  /evolve_strategy path:src/strategies/momentum.py --agents=30\n  /evolve_strategy skew_convexity_v1 (database lookup)`,
    };
  }

  try {
    let strategyCode = '';
    let strategyDescription = strategyRef;
    let strategyPath = '';

    // Check if this is a file path reference (path:...)
    if (strategyRef.startsWith('path:')) {
      strategyPath = strategyRef.slice(5); // Remove 'path:' prefix

      // Fetch strategy code via read-file edge function
      const { data: fileData, error: fileError } = await supabase.functions.invoke('read-file', {
        body: { path: strategyPath },
      });

      if (fileError || !fileData?.success) {
        return {
          success: false,
          message: `❌ Failed to read strategy file: ${fileError?.message || fileData?.error || 'File not found'}\n\nMake sure the path exists in the rotation-engine codebase.`,
        };
      }

      strategyCode = fileData.content;
      strategyDescription = `Strategy file: ${strategyPath}`;
      console.log(`[EvolveStrategy] Loaded ${strategyCode.length} chars from ${strategyPath}`);
    } else {
      // Try to fetch strategy from database
      const { data: strategyData } = await supabase
        .from('strategies')
        .select('code, description')
        .eq('key', strategyRef)
        .maybeSingle();

      if (strategyData?.code) {
        strategyCode = strategyData.code;
        strategyDescription = strategyData.description || strategyRef;
      } else {
        return {
          success: false,
          message: `❌ Strategy "${strategyRef}" not found.\n\nUse path: prefix for file-based strategies:\n  /evolve_strategy path:strategies/my_strategy.py`,
        };
      }
    }

    // Get mutation assignments for each agent
    const mutations = getMutationAssignments(agentCount);

    // Build input contexts for each agent
    const inputContexts = mutations.map((mutation, idx) =>
      buildMutationPrompt(strategyCode, strategyDescription, mutation, idx, agentCount)
    );

    // Dispatch the massive swarm with shared_context for code caching
    const { jobId, taskCount, estimatedDuration } = await dispatchMassiveSwarm({
      workspaceId: context.workspaceId,
      objective: `Evolve strategy: ${strategyRef}\n\nMutate this code to increase convexity. Vary lookback periods, standard deviations, and exit logic.\n\nConstraint: Output VALID Python code only.`,
      agentCount,
      mode: 'evolution',
      config: {
        systemPrompt: MUTATION_AGENT_SYSTEM,
        agentRoles: mutations,
        inputContexts,
      },
    });

    // Return success with job ID for SwarmMonitor
    // SECURITY: Code mutations are presented as TEXT SUGGESTIONS only
    // User must explicitly click "Apply" to write to disk
    return {
      success: true,
      message: JSON.stringify({
        type: 'swarm_job',
        jobId,
        objective: `Evolving ${strategyPath || strategyRef}`,
        agentCount: taskCount,
        estimatedDuration,
        mode: 'evolution',
        strategyPath: strategyPath || undefined,
      }),
      data: { jobId, taskCount, mode: 'evolution', strategyPath },
    };
  } catch (error: any) {
    console.error('Evolve strategy command error:', error);
    return {
      success: false,
      message: `❌ Failed to start evolution: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Simple hash function for code content (for cache invalidation)
 */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `hash_${Math.abs(hash).toString(16)}`;
}

/**
 * /help command - show available commands
 */
async function handleHelp(): Promise<CommandResult> {
  return {
    success: true,
    message: `📚 Available Slash Commands:\n\n` +
      `🔬 /backtest <strategy> [start] [end] [capital]\n` +
      `   Run a backtest for the current session\n` +
      `   Example: /backtest skew_convexity_v1 2020-01-01 2024-12-31 100000\n\n` +
      `🧪 /experiment <name> [description]\n` +
      `   Start a named experiment to group related backtest runs\n` +
      `   Example: /experiment momentum-testing Testing different lookback periods\n\n` +
      `🔄 /iterate [param=value ...]\n` +
      `   Re-run the last backtest with modified parameters\n` +
      `   Example: /iterate capital=50000 lookback=30\n\n` +
      `📍 /checkpoint <notes>\n` +
      `   Save experiment progress with notes\n` +
      `   Example: /checkpoint Found lookback=25 works best\n\n` +
      `⏮️ /resume [experiment-name]\n` +
      `   Resume a previous experiment or list available experiments\n` +
      `   Example: /resume momentum-testing\n\n` +
      `📋 /runs [limit]\n` +
      `   List recent backtest runs (default: 5)\n` +
      `   Example: /runs 10\n\n` +
      `📊 /compare [N]\n` +
      `   Compare N most recent completed runs (2-5, default: 2)\n` +
      `   Example: /compare 3\n\n` +
      `🔍 /audit_run N or /audit_run id:<runId>\n` +
      `   Perform deep Strategy Auditor analysis of a completed run\n` +
      `   Example: /audit_run 1 or /audit_run id:abc-123-def\n\n` +
      `🧠 /mine_patterns [limit]\n` +
      `   Detect recurring patterns across runs and memory (10-200, default: 100)\n` +
      `   Example: /mine_patterns 50\n\n` +
      `🔧 /curate_memory\n` +
      `   Review stored rules/insights and propose promotions, demotions, and cleanups\n` +
      `   Example: /curate_memory\n\n` +
      `🎯 /suggest_experiments [focus]\n` +
      `   Propose next experiments based on existing runs and memory\n` +
      `   Example: /suggest_experiments or /suggest_experiments skew\n\n` +
      `🛡️ /risk_review [focus]\n` +
      `   Review structural risk across runs and detect rule violations\n` +
      `   Example: /risk_review or /risk_review skew\n\n` +
      `🤖 /auto_analyze [scope]\n` +
      `   Run autonomous research loop combining all agent modes into comprehensive report\n` +
      `   Example: /auto_analyze or /auto_analyze skew\n\n` +
      `💾 /save_report [scope:<value>] [title:"Custom"]\n` +
      `   Save the last /auto_analyze report for later retrieval\n` +
      `   Example: /save_report or /save_report scope:skew title:"Q1 2025 Skew Analysis"\n\n` +
      `📋 /list_reports [scope:<value>] [tag:<value>]\n` +
      `   List saved research reports with optional filters\n` +
      `   Example: /list_reports or /list_reports scope:skew or /list_reports tag:momentum\n\n` +
      `📖 /open_report id:<uuid>\n` +
      `   Open and display a saved research report\n` +
      `   Example: /open_report id:abc12345\n\n` +
      `💡 /note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]\n` +
      `   Create a memory note\n` +
      `   Example: /note This fails in bear markets type:warning importance:high\n\n` +
      `📂 /list_dir path:<path>\n` +
      `   List files and directories in rotation-engine\n` +
      `   Example: /list_dir path:profiles or /list_dir path:.\n\n` +
      `📄 /open_file path:<path>\n` +
      `   Show contents of a rotation-engine file\n` +
      `   Example: /open_file path:profiles/skew.py\n\n` +
      `🔎 /search_code <query>\n` +
      `   Search rotation-engine code for a term\n` +
      `   Example: /search_code peakless or /search_code path:profiles convexity\n\n` +
      `🔴 /red_team_file path:<path>\n` +
      `   Run multi-agent red team audit (strategy-logic, overfit, lookahead-bias, robustness, consistency)\n` +
      `   Example: /red_team_file path:profiles/skew.py\n\n` +
      `✏️ /write_file <path> <content>\n` +
      `   Create or overwrite a file with new content (creates backup if exists)\n` +
      `   Example: /write_file strategies/new.py def my_strategy():\\n    pass\n\n` +
      `➕ /append_file <path> <content>\n` +
      `   Append content to end of file\n` +
      `   Example: /append_file strategies/test.py # New function\\ndef new():\\n    pass\n\n` +
      `🗑️ /delete_file <path>\n` +
      `   Delete a file (creates backup before deletion)\n` +
      `   Example: /delete_file strategies/old.py\n\n` +
      `📝 /rename_file <old_path> <new_path>\n` +
      `   Rename or move a file\n` +
      `   Example: /rename_file strategies/old.py strategies/new.py\n\n` +
      `📋 /copy_file <source> <dest>\n` +
      `   Copy a file to new location\n` +
      `   Example: /copy_file strategies/base.py strategies/variant.py\n\n` +
      `📁 /create_dir <path>\n` +
      `   Create a new directory\n` +
      `   Example: /create_dir strategies/experimental\n\n` +
      `📊 /inspect_data symbol:<symbol> start:<date> end:<date>\n` +
      `   Inspect raw market data (OHLCV bars)\n` +
      `   Example: /inspect_data symbol:SPX start:2024-01-01 end:2024-03-31\n\n` +
      `🔍 /data_quality symbol:<symbol> start:<date> end:<date>\n` +
      `   Check data quality for missing bars and outliers\n` +
      `   Example: /data_quality symbol:SPX start:2024-01-01 end:2024-03-31\n\n` +
      `📈 /trade_log id:<runId>\n` +
      `   Get trade log from backtest run\n` +
      `   Example: /trade_log id:abc-123-... or /trade_log 1\n\n` +
      `🔬 /trade_detail id:<runId> idx:<tradeIdx>\n` +
      `   Deep dive on specific trade with market context\n` +
      `   Example: /trade_detail id:abc-123-... idx:5\n\n` +
      `📝 /generate_docstrings path:<path>\n` +
      `   Auto-generate numpy-style docstrings for Python file using AI\n` +
      `   Example: /generate_docstrings path:strategies/skew.py\n\n` +
      `📘 /generate_readme path:<path>\n` +
      `   Generate README.md for module or package using AI analysis\n` +
      `   Example: /generate_readme path:strategies or /generate_readme path:profiles/skew.py\n\n` +
      `🏗️ /create_strategy name:<name>\n` +
      `   Generate strategy template with methods, docstrings, and type hints\n` +
      `   Example: /create_strategy name:my_strategy_v1\n\n` +
      `📋 /create_profile strategy:<key> name:<name>\n` +
      `   Generate profile template JSON with parameters and defaults\n` +
      `   Example: /create_profile strategy:skew name:aggressive_v1\n\n` +
      `❓ /help\n` +
      `   Show this help message`,
  };
}

/**
 * Command registry
 */
export const commands: Record<string, Command> = {
  backtest: {
    name: 'backtest',
    description: 'Run a backtest for a strategy',
    usage: '/backtest <strategy_key> [start_date] [end_date] [capital]',
    handler: handleBacktest,
    tier: undefined, // No chat call, uses backtest-run endpoint
  },
  experiment: {
    name: 'experiment',
    description: 'Start a named experiment to group related backtest runs',
    usage: '/experiment <name> [description]',
    handler: handleExperiment,
    tier: undefined, // No chat call, pure database operation
  },
  iterate: {
    name: 'iterate',
    description: 'Re-run the last backtest with modified parameters',
    usage: '/iterate [param=value ...]',
    handler: handleIterate,
    tier: undefined, // Delegates to handleBacktest
  },
  checkpoint: {
    name: 'checkpoint',
    description: 'Save experiment progress with notes',
    usage: '/checkpoint <notes>',
    handler: handleCheckpoint,
    tier: undefined, // No chat call, pure database operation
  },
  resume: {
    name: 'resume',
    description: 'Resume a previous experiment or list available experiments',
    usage: '/resume [experiment-name]',
    handler: handleResume,
    tier: undefined, // No chat call, pure database operation
  },
  runs: {
    name: 'runs',
    description: 'List recent backtest runs',
    usage: '/runs [limit]',
    handler: handleRuns,
    tier: undefined, // No chat call, pure data fetch
  },
  compare: {
    name: 'compare',
    description: 'Compare recent completed runs',
    usage: '/compare [N]',
    handler: handleCompare,
    tier: undefined, // No chat call, pure data fetch
  },
  audit_run: {
    name: 'audit_run',
    description: 'Audit a completed backtest run',
    usage: '/audit_run N or /audit_run id:<runId>',
    handler: handleAuditRun,
    tier: 'swarm', // Agent mode
  },
  mine_patterns: {
    name: 'mine_patterns',
    description: 'Detect recurring patterns across runs and memory',
    usage: '/mine_patterns [limit]',
    handler: handleMinePatterns,
    tier: 'swarm', // Agent mode
  },
  curate_memory: {
    name: 'curate_memory',
    description: 'Review and propose improvements to the current rule set and memory notes',
    usage: '/curate_memory',
    handler: handleCurateMemory,
    tier: 'swarm', // Agent mode
  },
  suggest_experiments: {
    name: 'suggest_experiments',
    description: 'Propose next experiments based on existing runs and memory',
    usage: '/suggest_experiments [focus]',
    handler: handleSuggestExperiments,
    tier: 'swarm', // Agent mode
  },
  risk_review: {
    name: 'risk_review',
    description: 'Review structural risk across runs',
    usage: '/risk_review [focus]',
    handler: handleRiskReview,
    tier: 'swarm', // Agent mode
  },
  auto_analyze: {
    name: 'auto_analyze',
    description: 'Run autonomous research loop combining all agent modes',
    usage: '/auto_analyze [scope]',
    handler: handleAutoAnalyze,
    tier: 'primary', // Final synthesis uses primary tier
  },
  save_report: {
    name: 'save_report',
    description: 'Save the last /auto_analyze report',
    usage: '/save_report [scope:<value>] [title:"Custom"]',
    handler: handleSaveReport,
    tier: undefined, // No chat call, uses report-save endpoint
  },
  list_reports: {
    name: 'list_reports',
    description: 'List saved research reports',
    usage: '/list_reports [scope:<value>] [tag:<value>]',
    handler: handleListReports,
    tier: undefined, // No chat call, pure data fetch
  },
  open_report: {
    name: 'open_report',
    description: 'Open a saved research report',
    usage: '/open_report id:<uuid>',
    handler: handleOpenReport,
    tier: undefined, // No chat call, pure data fetch
  },
  note: {
    name: 'note',
    description: 'Create a memory note',
    usage: '/note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]',
    handler: handleNote,
    tier: undefined, // No chat call, uses memory-create endpoint
  },
  list_dir: {
    name: 'list_dir',
    description: 'List files and directories in rotation-engine',
    usage: '/list_dir path:<path>',
    handler: handleListDir,
    tier: undefined, // No chat call, uses list-dir endpoint
  },
  open_file: {
    name: 'open_file',
    description: 'Show contents of a rotation-engine file',
    usage: '/open_file path:<path>',
    handler: handleOpenFile,
    tier: undefined, // No chat call, uses read-file endpoint
  },
  search_code: {
    name: 'search_code',
    description: 'Search rotation-engine code for a term',
    usage: '/search_code <query>',
    handler: handleSearchCode,
    tier: undefined, // No chat call, uses search-code endpoint
  },
  red_team_file: {
    name: 'red_team_file',
    description: 'Run multi-agent red team audit on rotation-engine code',
    usage: '/red_team_file path:<path>',
    handler: handleRedTeamFile,
    tier: 'swarm', // Agent mode, runs multiple swarm calls
  },
  write_file: {
    name: 'write_file',
    description: 'Create or overwrite a file with new content',
    usage: '/write_file <path> <content>',
    handler: handleWriteFile,
    tier: undefined,
  },
  append_file: {
    name: 'append_file',
    description: 'Append content to end of file',
    usage: '/append_file <path> <content>',
    handler: handleAppendFile,
    tier: undefined,
  },
  delete_file: {
    name: 'delete_file',
    description: 'Delete a file (creates backup)',
    usage: '/delete_file <path>',
    handler: handleDeleteFile,
    tier: undefined,
  },
  rename_file: {
    name: 'rename_file',
    description: 'Rename or move a file',
    usage: '/rename_file <old_path> <new_path>',
    handler: handleRenameFile,
    tier: undefined,
  },
  copy_file: {
    name: 'copy_file',
    description: 'Copy a file to new location',
    usage: '/copy_file <source_path> <dest_path>',
    handler: handleCopyFile,
    tier: undefined,
  },
  create_dir: {
    name: 'create_dir',
    description: 'Create a new directory',
    usage: '/create_dir <path>',
    handler: handleCreateDir,
    tier: undefined,
  },
  inspect_data: {
    name: 'inspect_data',
    description: 'Inspect raw market data (OHLCV bars)',
    usage: '/inspect_data symbol:<symbol> start:<YYYY-MM-DD> end:<YYYY-MM-DD>',
    handler: handleInspectData,
    tier: undefined,
  },
  data_quality: {
    name: 'data_quality',
    description: 'Check data quality for missing bars, outliers, and consistency',
    usage: '/data_quality symbol:<symbol> start:<YYYY-MM-DD> end:<YYYY-MM-DD>',
    handler: handleDataQuality,
    tier: undefined,
  },
  trade_log: {
    name: 'trade_log',
    description: 'Get trade log from backtest run',
    usage: '/trade_log id:<runId> or /trade_log N',
    handler: handleTradeLog,
    tier: undefined,
  },
  trade_detail: {
    name: 'trade_detail',
    description: 'Deep dive on specific trade with market context',
    usage: '/trade_detail id:<runId> idx:<tradeIdx>',
    handler: handleTradeDetail,
    tier: undefined,
  },
  generate_docstrings: {
    name: 'generate_docstrings',
    description: 'Auto-generate numpy-style docstrings for Python file',
    usage: '/generate_docstrings path:<path>',
    handler: handleGenerateDocstrings,
    tier: undefined,
  },
  generate_readme: {
    name: 'generate_readme',
    description: 'Generate README for module or package',
    usage: '/generate_readme path:<path>',
    handler: handleGenerateReadme,
    tier: undefined,
  },
  create_strategy: {
    name: 'create_strategy',
    description: 'Generate strategy template',
    usage: '/create_strategy name:<name>',
    handler: handleCreateStrategy,
    tier: undefined,
  },
  create_profile: {
    name: 'create_profile',
    description: 'Generate profile template',
    usage: '/create_profile strategy:<key> name:<name>',
    handler: handleCreateProfile,
    tier: undefined,
  },
  evolve_strategy: {
    name: 'evolve_strategy',
    description: 'Run genetic algorithm evolution on a strategy using 20+ mutation agents',
    usage: '/evolve_strategy <strategy_key> [--agents=N]',
    handler: handleEvolveStrategy,
    tier: 'swarm', // Massive swarm mode
  },
  help: {
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: handleHelp,
    tier: undefined, // No chat call, pure help text
  },
};

/**
 * Execute a slash command
 */
export async function executeCommand(
  input: string,
  context: CommandContext
): Promise<CommandResult> {
  const parsed = parseCommand(input);

  if (!parsed) {
    return {
      success: false,
      message: 'Not a valid command. Commands start with /. Type /help for available commands.',
    };
  }

  const command = commands[parsed.command];

  if (!command) {
    return {
      success: false,
      message: `Unknown command: /${parsed.command}\n\nType /help to see available commands.`,
    };
  }

  try {
    return await command.handler(parsed.args, context);
  } catch (error: any) {
    console.error(`Command execution error (/${parsed.command}):`, error);
    return {
      success: false,
      message: `❌ Command failed: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Get command suggestions for autocomplete
 */
export function getCommandSuggestions(input: string): string[] {
  if (!input.startsWith('/')) {
    return [];
  }

  const query = input.slice(1).toLowerCase();
  
  if (!query) {
    return Object.keys(commands).map(cmd => `/${cmd}`);
  }

  return Object.keys(commands)
    .filter(cmd => cmd.startsWith(query))
    .map(cmd => `/${cmd}`);
}
