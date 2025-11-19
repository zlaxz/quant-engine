/**
 * Slash command parser and executor for Quant Chat Workbench
 * Provides /backtest, /runs, /note, and /compare commands
 */

import { supabase } from '@/integrations/supabase/client';
import type { BacktestRun, BacktestParams, BacktestMetrics } from '@/types/backtest';
import { buildAuditPrompt } from '@/prompts/auditorPrompt';
import { buildRunSummary, buildMemorySummary, type MemoryNote } from '@/lib/auditSummaries';
import { buildPatternMinerPrompt } from '@/prompts/patternMinerPrompt';
import { buildRunsAggregate, buildRelevantMemory } from '@/lib/patternSummaries';

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
      `💡 /note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]\n` +
      `   Create a memory note\n` +
      `   Example: /note This fails in bear markets type:warning importance:high\n\n` +
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
  note: {
    name: 'note',
    description: 'Create a memory note',
    usage: '/note <content> [type:TYPE] [importance:LEVEL] [tags:tag1,tag2]',
    handler: handleNote,
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
