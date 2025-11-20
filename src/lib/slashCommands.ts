/**
 * Slash command parser and executor for Quant Chat Workbench
 * Provides /backtest, /runs, /note, and /compare commands
 */

import { supabase } from '@/integrations/supabase/client';

// Export commands registry for UI components
export { commands };
import type { BacktestRun, BacktestParams, BacktestMetrics } from '@/types/backtest';
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
}

export interface CommandContext {
  sessionId: string;
  workspaceId: string;
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

    if (!data || !data.runId) {
      throw new Error('No run ID returned from backtest');
    }

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      const { data: runData, error: fetchError } = await supabase
        .from('backtest_runs')
        .select('*')
        .eq('id', data.runId)
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
        return {
          success: true,
          message: `✅ Backtest completed!\n\n` +
            `Strategy: ${strategyKey}\n` +
            `Period: ${startDate} to ${endDate}\n` +
            `Capital: $${capital.toLocaleString()}\n\n` +
            `📊 Results:\n` +
            `• CAGR: ${(metrics.cagr * 100).toFixed(2)}%\n` +
            `• Sharpe: ${metrics.sharpe.toFixed(2)}\n` +
            `• Max Drawdown: ${(metrics.max_drawdown * 100).toFixed(2)}%\n` +
            `• Win Rate: ${(metrics.win_rate * 100).toFixed(1)}%\n` +
            `• Total Trades: ${metrics.total_trades}\n\n` +
            `View full results in the Quant tab.`,
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
      const metrics = run.metrics as any || {};
      
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
                         run.engine_source === 'stub_fallback' ? 'Fallback' : 'Stub';
      
      return `${idx + 1}. ${run.strategy_key}\n` +
             `   Period: ${period}\n` +
             `   Engine: ${engineLabel}\n` +
             `   • CAGR: ${(metrics.cagr * 100).toFixed(2)}%\n` +
             `   • Sharpe: ${metrics.sharpe.toFixed(2)}\n` +
             `   • Max DD: ${(metrics.max_drawdown * 100).toFixed(2)}%\n` +
             `   • Win Rate: ${(metrics.win_rate * 100).toFixed(1)}%\n` +
             `   • Trades: ${metrics.total_trades}`;
    }).join('\n\n');

    // Find best performers
    const bestCAGR = data.reduce((best, run, idx) => 
      run.metrics.cagr > data[best].metrics.cagr ? idx : best, 0
    );
    const bestSharpe = data.reduce((best, run, idx) => 
      run.metrics.sharpe > data[best].metrics.sharpe ? idx : best, 0
    );
    const bestDrawdown = data.reduce((best, run, idx) => 
      Math.abs(run.metrics.max_drawdown) < Math.abs(data[best].metrics.max_drawdown) ? idx : best, 0
    );

    const summary = `📊 Run Comparison (${data.length} runs)\n\n${runSummaries}\n\n` +
                   `🏆 Best Performers:\n` +
                   `• Highest CAGR: Run #${bestCAGR + 1} (${(data[bestCAGR].metrics.cagr * 100).toFixed(2)}%)\n` +
                   `• Best Sharpe: Run #${bestSharpe + 1} (${data[bestSharpe].metrics.sharpe.toFixed(2)})\n` +
                   `• Lowest Max DD: Run #${bestDrawdown + 1} (${(data[bestDrawdown].metrics.max_drawdown * 100).toFixed(2)}%)\n\n` +
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
        .single();
      
      if (error || !data) {
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
    
    const memoryNotes: MemoryNote[] = memoryData || [];
    
    // Build summaries
    const runSummary = buildRunSummary(run);
    const memorySummary = buildMemorySummary(memoryNotes);
    
    // Build audit prompt
    const auditPrompt = buildAuditPrompt(runSummary, memorySummary);
    
    // Call chat function with audit prompt
    const { data: chatData, error: chatError } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: auditPrompt,
      },
    });
    
    if (chatError) {
      throw chatError;
    }
    
    if (!chatData || !chatData.message) {
      throw new Error('No response from chat function');
    }
    
    // Return the audit analysis
    return {
      success: true,
      message: `🔍 **Strategy Audit: ${run.strategy_key}**\n\n${chatData.message}`,
      data: {
        runId: run.id,
        strategyKey: run.strategy_key,
        auditResponse: chatData.message,
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

    // Call chat function
    const { data: chatData, error: chatError } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: patternPrompt,
      },
    });

    if (chatError) throw chatError;

    if (!chatData || !chatData.message) {
      throw new Error('No response from chat function');
    }

    // Return pattern mining analysis
    return {
      success: true,
      message: `🔍 **Pattern Mining Analysis** (${runs.length} runs, ${strategyKeys.length} strategies)\n\n${chatData.message}`,
      data: {
        runsAnalyzed: runs.length,
        strategiesCount: strategyKeys.length,
        memoryNotesCount: memoryNotes.length,
        analysis: chatData.message,
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

    // Call chat function with curator prompt
    const { data: chatData, error: chatError } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: curatorPrompt,
      },
    });

    if (chatError) throw chatError;

    if (!chatData || !chatData.message) {
      throw new Error('No response from chat function');
    }

    // Return curator recommendations
    return {
      success: true,
      message: `🔧 **Memory Curation Recommendations** (${notes.length} notes reviewed)\n\n${chatData.message}\n\n---\n💡 **Note**: These are recommendations only. Use the Memory panel to edit notes manually.`,
      data: {
        notesReviewed: notes.length,
        recommendations: chatData.message,
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

    // Call chat function
    const { data: chatData, error: chatError } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: experimentPrompt,
      },
    });

    if (chatError) throw chatError;

    if (!chatData || !chatData.message) {
      throw new Error('No response from chat function');
    }

    // Return experiment suggestions
    const focusNote = focus ? ` (focus: ${focus})` : '';
    return {
      success: true,
      message: `🎯 **Experiment Plan**${focusNote}\n\nBased on ${runs.length} completed runs and ${memoryNotes.length} memory notes:\n\n${chatData.message}`,
      data: {
        runsAnalyzed: runs.length,
        memoryNotesCount: memoryNotes.length,
        focus: focus || null,
        plan: chatData.message,
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
        n.tags.some(tag => tag.toLowerCase().includes(focus.toLowerCase())) ||
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

    // Call chat function
    const { data: chatData, error: chatError } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: riskPrompt,
      },
    });

    if (chatError) throw chatError;

    if (!chatData || !chatData.message) {
      throw new Error('No response from chat function');
    }

    // Return risk review
    const focusNote = focus ? ` (focus: ${focus})` : '';
    return {
      success: true,
      message: `🛡️ **Risk Review Report**${focusNote}\n\nAnalyzed ${filteredRuns.length} completed runs and ${filteredMemory.length} memory notes:\n\n${chatData.message}`,
      data: {
        runsAnalyzed: filteredRuns.length,
        memoryNotesCount: filteredMemory.length,
        focus: focus || null,
        report: chatData.message,
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
 * /auto_analyze command - autonomous research loop
 * Runs all agent modes and produces comprehensive research report
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

    // Select key runs for detailed analysis
    const keyRuns = selectKeyRuns(filteredRuns);

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

    // Run agent modes internally
    const auditResults: string[] = [];

    // Audit key runs
    for (const run of keyRuns.slice(0, 3)) {
      // Limit to top 3 to avoid overwhelming context
      const runMemory = memoryNotes.filter(note =>
        note.run_id === run.id ||
        (note.tags && note.tags.some(tag => run.strategy_key.includes(tag)))
      );

      const runSummaryText = buildRunSummary(run);
      const memorySummaryText = buildMemorySummary(runMemory);
      const auditPrompt = buildAuditPrompt(runSummaryText, memorySummaryText);

      // Call chat to get audit
      const { data: auditData, error: auditError } = await supabase.functions.invoke('chat', {
        body: {
          sessionId: context.sessionId,
          workspaceId: context.workspaceId,
          content: auditPrompt,
        },
      });

      if (!auditError && auditData?.message) {
        auditResults.push(`**Run: ${run.strategy_key} (${run.id.slice(0, 8)})**\n\n${auditData.message}`);
      }
    }

    // Pattern Mining
    const runsAggregate = buildRunsAggregate(filteredRuns.slice(0, 100));
    const strategyKeys = [...new Set(filteredRuns.map(r => r.strategy_key))];
    const relevantMemory = buildRelevantMemory(memoryNotes as any, strategyKeys);
    const patternPrompt = buildPatternMinerPrompt(runsAggregate, relevantMemory);

    const { data: patternData } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: patternPrompt,
      },
    });

    const patternSummary = patternData?.message || '';

    // Memory Curation
    const curationSummary = buildCurationSummary(memoryNotes as any);
    const curationPrompt = buildMemoryCuratorPrompt(curationSummary);

    const { data: curationData } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: curationPrompt,
      },
    });

    const memorySummary = curationData?.message || '';

    // Risk Review
    const riskRunSummary = buildRiskRunSummary(filteredRuns);
    const riskMemorySummary = buildRiskMemorySummary(memoryNotes as any);
    const riskPrompt = buildRiskOfficerPrompt(riskRunSummary, riskMemorySummary, '');

    const { data: riskData } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: riskPrompt,
      },
    });

    const riskSummary = riskData?.message || '';

    // Experiment Director
    const experimentRunSummary = buildExperimentRunSummary(filteredRuns);
    const experimentMemorySummary = buildExperimentMemorySummary(memoryNotes as any);
    const experimentPrompt = buildExperimentDirectorPrompt(experimentRunSummary, '', experimentMemorySummary, scope);

    const { data: experimentData } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: experimentPrompt,
      },
    });

    const experimentSummary = experimentData?.message || '';

    // Assemble all inputs
    const analysisInput = assembleAgentInputs(
      portfolioSummary,
      auditResults,
      patternSummary,
      memorySummary,
      riskSummary,
      experimentSummary
    );

    // Build final auto-analyze prompt
    const finalPrompt = buildAutoAnalyzePrompt(scope, analysisInput);

    // Call chat for final synthesis
    const { data: finalData, error: finalError } = await supabase.functions.invoke('chat', {
      body: {
        sessionId: context.sessionId,
        workspaceId: context.workspaceId,
        content: finalPrompt,
      },
    });

    if (finalError) throw finalError;

    if (!finalData || !finalData.message) {
      throw new Error('No response from chat function');
    }

    // Return comprehensive report with save tip
    const scopeNote = scope ? ` (scope: ${scope})` : '';
    return {
      success: true,
      message: `🤖 **Autonomous Research Report**${scopeNote}\n\nAnalyzed ${filteredRuns.length} runs with ${keyRuns.length} key audits, pattern mining, memory curation, risk review, and experiment planning:\n\n${finalData.message}\n\n---\n\n💡 **Tip**: Use \`/save_report\` to store this Research Report for later.`,
      data: {
        runsAnalyzed: filteredRuns.length,
        keyRunsAudited: keyRuns.length,
        memoryNotesReviewed: memoryNotes.length,
        scope: scope || null,
        report: finalData.message,
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
 * /help command - show available commands
 */
async function handleHelp(): Promise<CommandResult> {
  return {
    success: true,
    message: `📚 Available Slash Commands:\n\n` +
      `🔬 /backtest <strategy> [start] [end] [capital]\n` +
      `   Run a backtest for the current session\n` +
      `   Example: /backtest skew_convexity_v1 2020-01-01 2024-12-31 100000\n\n` +
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
      `❓ /help\n` +
      `   Show this help message`,
  };
}

/**
 * Command registry
 */
const commands: Record<string, Command> = {
  backtest: {
    name: 'backtest',
    description: 'Run a backtest for a strategy',
    usage: '/backtest <strategy_key> [start_date] [end_date] [capital]',
    handler: handleBacktest,
  },
  runs: {
    name: 'runs',
    description: 'List recent backtest runs',
    usage: '/runs [limit]',
    handler: handleRuns,
  },
  compare: {
    name: 'compare',
    description: 'Compare recent completed runs',
    usage: '/compare [N]',
    handler: handleCompare,
  },
  audit_run: {
    name: 'audit_run',
    description: 'Audit a completed backtest run',
    usage: '/audit_run N or /audit_run id:<runId>',
    handler: handleAuditRun,
  },
  mine_patterns: {
    name: 'mine_patterns',
    description: 'Detect recurring patterns across runs and memory',
    usage: '/mine_patterns [limit]',
    handler: handleMinePatterns,
  },
  curate_memory: {
    name: 'curate_memory',
    description: 'Review and propose improvements to the current rule set and memory notes',
    usage: '/curate_memory',
    handler: handleCurateMemory,
  },
  suggest_experiments: {
    name: 'suggest_experiments',
    description: 'Propose next experiments based on existing runs and memory',
    usage: '/suggest_experiments [focus]',
    handler: handleSuggestExperiments,
  },
  risk_review: {
    name: 'risk_review',
    description: 'Review structural risk across runs',
    usage: '/risk_review [focus]',
    handler: handleRiskReview,
  },
  auto_analyze: {
    name: 'auto_analyze',
    description: 'Run autonomous research loop combining all agent modes',
    usage: '/auto_analyze [scope]',
    handler: handleAutoAnalyze,
  },
  save_report: {
    name: 'save_report',
    description: 'Save the last /auto_analyze report',
    usage: '/save_report [scope:<value>] [title:"Custom"]',
    handler: handleSaveReport,
  },
  list_reports: {
    name: 'list_reports',
    description: 'List saved research reports',
    usage: '/list_reports [scope:<value>] [tag:<value>]',
    handler: handleListReports,
  },
  open_report: {
    name: 'open_report',
    description: 'Open a saved research report',
    usage: '/open_report id:<uuid>',
    handler: handleOpenReport,
  },
  note: {
    name: 'note',
    description: 'Create a memory note',
    usage: '/note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]',
    handler: handleNote,
  },
  list_dir: {
    name: 'list_dir',
    description: 'List files and directories in rotation-engine',
    usage: '/list_dir path:<path>',
    handler: handleListDir,
  },
  open_file: {
    name: 'open_file',
    description: 'Show contents of a rotation-engine file',
    usage: '/open_file path:<path>',
    handler: handleOpenFile,
  },
  search_code: {
    name: 'search_code',
    description: 'Search rotation-engine code for a term',
    usage: '/search_code <query>',
    handler: handleSearchCode,
  },
  help: {
    name: 'help',
    description: 'Show available commands',
    usage: '/help',
    handler: handleHelp,
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
