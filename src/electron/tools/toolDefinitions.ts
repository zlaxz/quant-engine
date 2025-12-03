/**
 * Tool Definitions for Gemini Function Calling
 * Defines all tools available to Chief Quant and Swarm agents
 */

import { FunctionDeclaration, Type } from '@google/genai';

// Core file operation tools
// File write operations removed - Gemini is CIO (read-only)
// All modifications delegated to Claude Code (CTO) via execute_via_claude_code
export const FILE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from the Python engine codebase',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'File path relative to Python engine root (e.g., "strategies/skew_convexity.py")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Directory path relative to Python engine root (e.g., "strategies" or ".")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search_code',
    description: 'Search for code patterns using regex across the Python engine codebase',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pattern: {
          type: Type.STRING,
          description: 'Regex pattern to search for'
        },
        path: {
          type: Type.STRING,
          description: 'Optional path to limit search scope'
        },
        file_pattern: {
          type: Type.STRING,
          description: 'Optional glob pattern to filter files (e.g., "*.py")'
        }
      },
      required: ['pattern']
    }
  }
  // write_file, append_file, delete_file removed - CIO is read-only
  // Use execute_via_claude_code to delegate modifications to CTO (Claude Code)
];

// Python execution tools
export const PYTHON_TOOLS: FunctionDeclaration[] = [
  {
    name: 'run_python_script',
    description: 'Execute a Python script in the Python engine environment and return its output. Use this to run backtests, data analysis, or any Python code. The script must already exist in the codebase.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        script_path: {
          type: Type.STRING,
          description: 'Path to Python script relative to Python engine root (e.g., "Python engine-bridge/cli_wrapper.py" or "analysis/regime_classifier.py")'
        },
        args: {
          type: Type.ARRAY,
          description: 'Command line arguments to pass to the script (e.g., ["--symbol", "SPY", "--start", "2023-01-01"])',
          items: {
            type: Type.STRING
          }
        },
        timeout_seconds: {
          type: Type.NUMBER,
          description: 'Maximum execution time in seconds (default: 300)'
        }
      },
      required: ['script_path']
    }
  },
  {
    name: 'manage_environment',
    description: 'Manage Python packages for the quant engine. Install, uninstall, or check packages from PyPI. Only standard PyPI package names allowed (no URLs, git repos, or local paths). Updates requirements.txt automatically on install.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: 'Action to perform: "install", "uninstall", "check", "list", or "sync" (install all from requirements.txt)'
        },
        package: {
          type: Type.STRING,
          description: 'Package name with optional version specifier (e.g., "scipy", "pandas>=2.0.0", "scikit-learn[dev]"). Required for install/uninstall/check.'
        },
        upgrade: {
          type: Type.BOOLEAN,
          description: 'If true, upgrade existing package to latest version (only for install action)'
        }
      },
      required: ['action']
    }
  }
];

// Git operation tools
export const GIT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'git_status',
    description: 'Get git status showing modified, staged, and untracked files',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'git_diff',
    description: 'Show git diff for changes',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Optional file path to diff specific file'
        },
        staged: {
          type: Type.BOOLEAN,
          description: 'Show staged changes (--cached)'
        }
      }
    }
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'Number of commits to show (default: 10)'
        },
        path: {
          type: Type.STRING,
          description: 'Optional file path to show history for specific file'
        }
      }
    }
  },
  {
    name: 'git_add',
    description: 'Stage files for commit',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'File path to stage (or "." for all)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'git_commit',
    description: 'Create a git commit with staged changes',
    parameters: {
      type: Type.OBJECT,
      properties: {
        message: {
          type: Type.STRING,
          description: 'Commit message'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'git_branch',
    description: 'List, create, or delete branches',
    parameters: {
      type: Type.OBJECT,
      properties: {
        list: {
          type: Type.BOOLEAN,
          description: 'List all branches'
        },
        create: {
          type: Type.BOOLEAN,
          description: 'Create new branch'
        },
        delete_branch: {
          type: Type.BOOLEAN,
          description: 'Delete branch'
        },
        name: {
          type: Type.STRING,
          description: 'Branch name'
        }
      }
    }
  },
  {
    name: 'git_checkout',
    description: 'Switch branches or create and switch to new branch',
    parameters: {
      type: Type.OBJECT,
      properties: {
        branch: {
          type: Type.STRING,
          description: 'Branch name'
        },
        create: {
          type: Type.BOOLEAN,
          description: 'Create new branch'
        }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_push',
    description: 'Push local commits to remote repository. Use after committing to share changes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        remote: {
          type: Type.STRING,
          description: 'Remote name (default: origin)'
        },
        branch: {
          type: Type.STRING,
          description: 'Branch to push (default: current branch)'
        },
        force: {
          type: Type.BOOLEAN,
          description: 'Force push (use with caution)'
        }
      }
    }
  },
  {
    name: 'git_pull',
    description: 'Pull changes from remote repository. Updates local branch with remote changes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        remote: {
          type: Type.STRING,
          description: 'Remote name (default: origin)'
        },
        branch: {
          type: Type.STRING,
          description: 'Branch to pull (default: current branch)'
        },
        rebase: {
          type: Type.BOOLEAN,
          description: 'Use rebase instead of merge'
        }
      }
    }
  },
  {
    name: 'git_fetch',
    description: 'Fetch changes from remote without merging. Use to see what changed upstream.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        remote: {
          type: Type.STRING,
          description: 'Remote name (default: all remotes)'
        },
        prune: {
          type: Type.BOOLEAN,
          description: 'Remove deleted remote branches'
        }
      }
    }
  }
];

// Validation and testing tools
export const VALIDATION_TOOLS: FunctionDeclaration[] = [
  {
    name: 'run_tests',
    description: 'Execute pytest test suite for Python engine',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Optional path to specific test file or directory'
        },
        verbose: {
          type: Type.BOOLEAN,
          description: 'Enable verbose output'
        }
      }
    }
  },
  {
    name: 'validate_strategy',
    description: 'Validate strategy file syntax and logic',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to strategy file (e.g., "strategies/skew_convexity.py")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'dry_run_backtest',
    description: 'Quick validation of backtest parameters without full execution',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_key: {
          type: Type.STRING,
          description: 'Strategy key (e.g., "skew_convexity_v1")'
        },
        start_date: {
          type: Type.STRING,
          description: 'Start date (YYYY-MM-DD)'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date (YYYY-MM-DD)'
        }
      },
      required: ['strategy_key', 'start_date', 'end_date']
    }
  },
  {
    name: 'lint_code',
    description: 'Run code linter (flake8 or pylint) on Python files',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to file or directory to lint'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'type_check',
    description: 'Run mypy type checking on Python files',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to file to type check'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'audit_strategy_robustness',
    description: 'THE RED TEAM PROTOCOL. Runs a "Red Team" attack on a strategy to detect overfitting and fragility. Tests against random noise, parameter shifts, and regime flips. MUST BE RUN before risking real capital. If this audit fails, the CIO VETOES the trade.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_key: {
          type: Type.STRING,
          description: 'The strategy ID to attack (e.g., "profile_1", "skew_convexity_v1")'
        },
        aggressiveness: {
          type: Type.STRING,
          description: 'Attack level: "standard" (default) or "nuclear" (for production readiness)'
        }
      },
      required: ['strategy_key']
    }
  },
  // ============================================================
  // LIFELINE: Mobile Alerts via Pushover
  // ============================================================
  {
    name: 'send_mobile_alert',
    description: 'THE LIFELINE. Sends a push notification to Zach\'s phone via Pushover. Use for CRITICAL alerts: drawdown warnings, stop-loss triggers, strategy failures, or anything requiring immediate human attention. This is the "WAKE UP ZACH" button.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: 'Alert title (e.g., "DRAWDOWN WARNING", "STRATEGY FAILURE")'
        },
        message: {
          type: Type.STRING,
          description: 'Alert message with key details'
        },
        priority: {
          type: Type.STRING,
          description: '"emergency" (loud alarm, requires ack), "high" (bypass quiet hours), "normal" (default), "low" (no sound)'
        },
        sound: {
          type: Type.STRING,
          description: 'Sound name: "siren", "cashregister", "spacealarm", "tugboat", etc. Default: "pushover"'
        }
      },
      required: ['title', 'message']
    }
  },
  // ============================================================
  // GRADUATION GATEKEEPER: Paper → Shadow → Live
  // ============================================================
  {
    name: 'live_trading_gateway',
    description: 'THE GRADUATION GATEKEEPER. Controls access to live trading. Strategies MUST graduate through stages: PAPER (backtest), SHADOW (paper trading with real data), LIVE (real money). This tool checks the strategy\'s graduation status before allowing any live trades. If the strategy hasn\'t passed Shadow stage, the CIO BLOCKS the trade.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_key: {
          type: Type.STRING,
          description: 'The strategy ID to check graduation status'
        },
        action: {
          type: Type.STRING,
          description: '"check_status" (see current stage), "promote" (request graduation to next stage), "demote" (force back to paper after failure)'
        },
        reason: {
          type: Type.STRING,
          description: 'Required for promote/demote - justification for the action'
        }
      },
      required: ['strategy_key', 'action']
    }
  }
];

// Code analysis tools
export const ANALYSIS_TOOLS: FunctionDeclaration[] = [
  {
    name: 'find_function',
    description: 'Find function definition in codebase using AST analysis',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Function name to search for'
        },
        path: {
          type: Type.STRING,
          description: 'Optional path to limit search scope'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'find_class',
    description: 'Find class definition in codebase using AST analysis',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Class name to search for'
        },
        path: {
          type: Type.STRING,
          description: 'Optional path to limit search scope'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'find_usages',
    description: 'Find all usages/references to a symbol (function/class/variable)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symbol: {
          type: Type.STRING,
          description: 'Symbol name to find usages of'
        },
        path: {
          type: Type.STRING,
          description: 'Optional path to limit search scope'
        }
      },
      required: ['symbol']
    }
  },
  {
    name: 'code_stats',
    description: 'Generate codebase statistics (lines, functions, classes, etc.)',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Optional path to analyze (default: entire codebase)'
        }
      }
    }
  }
];

// Backtesting automation tools
export const BACKTEST_TOOLS: FunctionDeclaration[] = [
  {
    name: 'batch_backtest',
    description: 'Run multiple backtests in parallel with a parameter grid. Returns ranked results by Sharpe ratio.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_key: {
          type: Type.STRING,
          description: 'Strategy key to backtest'
        },
        param_grid: {
          type: Type.STRING,
          description: 'Parameter grid as JSON string with param names as keys and arrays of values'
        },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: Type.NUMBER,
          description: 'Initial capital for backtest (default: 100000)'
        }
      },
      required: ['strategy_key', 'param_grid', 'start_date', 'end_date']
    }
  },
  {
    name: 'sweep_params',
    description: 'Sweep a single parameter across a range. Returns metrics curve vs parameter value.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_key: {
          type: Type.STRING,
          description: 'Strategy key to backtest'
        },
        param_name: {
          type: Type.STRING,
          description: 'Name of the parameter to sweep'
        },
        start: {
          type: Type.NUMBER,
          description: 'Starting value for parameter'
        },
        end: {
          type: Type.NUMBER,
          description: 'Ending value for parameter'
        },
        step: {
          type: Type.NUMBER,
          description: 'Step size for parameter sweep'
        },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: Type.NUMBER,
          description: 'Initial capital for backtest (default: 100000)'
        }
      },
      required: ['strategy_key', 'param_name', 'start', 'end', 'step', 'start_date', 'end_date']
    }
  },
  {
    name: 'cross_validate',
    description: 'Run walk-forward cross-validation to detect overfitting',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_key: {
          type: Type.STRING,
          description: 'Strategy key to validate'
        },
        params: {
          type: Type.STRING,
          description: 'Strategy parameters as JSON string'
        },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format'
        },
        num_folds: {
          type: Type.NUMBER,
          description: 'Number of folds (default: 5)'
        }
      },
      required: ['strategy_key', 'params', 'start_date', 'end_date']
    }
  }
];

// Data inspection tools
export const DATA_TOOLS: FunctionDeclaration[] = [
  {
    name: 'inspect_market_data',
    description: 'Inspect raw market data (OHLCV bars) for a given symbol and date range',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symbol: {
          type: Type.STRING,
          description: 'Symbol to inspect (e.g., "SPX", "AAPL")'
        },
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format'
        }
      },
      required: ['symbol', 'start_date', 'end_date']
    }
  },
  {
    name: 'data_quality_check',
    description: 'Validate data integrity - check for missing bars, outliers, and price consistency issues. Comprehensive checks include: gap detection, OHLC validity, price outliers, zero/negative values, duplicates, NaN values, and volume analysis.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        symbol: {
          type: Type.STRING,
          description: 'Symbol to check (e.g., "SPX", "AAPL")'
        },
        start_date: {
          type: Type.STRING,
          description: 'Optional start date in YYYY-MM-DD format (default: all available data)'
        },
        end_date: {
          type: Type.STRING,
          description: 'Optional end date in YYYY-MM-DD format (default: all available data)'
        }
      },
      required: ['symbol']
    }
  },
  {
    name: 'get_trade_log',
    description: 'Get all trades from a backtest run with entry/exit details, P&L, and hold duration',
    parameters: {
      type: Type.OBJECT,
      properties: {
        run_id: {
          type: Type.STRING,
          description: 'Backtest run UUID'
        }
      },
      required: ['run_id']
    }
  }
];

// Claude Code CLI execution - MULTI-MODEL ARCHITECTURE
// Gemini (reasoning) -> Claude Code CLI (execution)
// Claude Code handles agents: native Claude agents for minor tasks, DeepSeek for MASSIVE parallel
// Uses Claude Max subscription for cost-effective execution
export const CLAUDE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'execute_via_claude_code',
    description: `Hand off execution task to Claude Code CLI. Uses Claude Max subscription (fixed cost). Claude Code has full tool access: bash, python, file operations, git, and can spawn agents.

WHEN TO USE: Code writing, file modifications, git operations, running tests/backtests, any task requiring tool execution.

AGENT STRATEGY (Claude Code decides based on scale):
• Minor/normal tasks: Claude handles directly or spawns native Claude agents (free with Max subscription)
• MASSIVE parallel compute: Claude spawns DeepSeek agents via curl (cost-efficient at scale)
  Examples of massive: analyze all 6 regimes simultaneously, 50+ parameter sweeps, bulk data processing`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: 'Clear description of what to execute. Be specific about expected output.'
        },
        context: {
          type: Type.STRING,
          description: 'Your reasoning and analysis that led to this task. Helps Claude Code understand the WHY.'
        },
        parallel_hint: {
          type: Type.STRING,
          description: 'Hint about parallelization needs. Use "none" for single task, "minor" for few parallel tasks (Claude agents), "massive" for many parallel tasks (DeepSeek for cost efficiency)'
        },
        session_id: {
          type: Type.STRING,
          description: 'Current chat session UUID. ALWAYS pass this so Claude Code results appear in the chat. Get from conversation context.'
        }
      },
      required: ['task', 'session_id']
    }
  }
];

// Agent spawning tools - AUTOMATIC DELEGATION TO DEEPSEEK
// These tools are handled by TypeScript handlers that automatically call DeepSeek
// Gemini just needs to call the tool - everything else happens automatically
export const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'spawn_agent',
    description: 'Spawn a DeepSeek agent via Python script (scripts/deepseek_agent.py). Agent has tools: read_file, list_directory, search_code, query_data. No write access - analysis only. Requires DEEPSEEK_API_KEY environment variable. Timeout: 10 minutes. Use for complex multi-file analysis. For simple reads, use read_file directly. Returns analysis results from DeepSeek.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        task: {
          type: Type.STRING,
          description: 'Clear description of what the agent should accomplish. The DeepSeek agent will autonomously use its tools to complete this.'
        },
        context: {
          type: Type.STRING,
          description: 'Any relevant context, file contents, or background information the agent needs'
        },
        agent_type: {
          type: Type.STRING,
          description: 'Type of agent to spawn: analyst (data analysis), reviewer (code review), researcher (information gathering), coder (implementation)'
        }
      },
      required: ['task', 'agent_type']
    }
  },
  {
    name: 'spawn_agents_parallel',
    description: 'Spawn multiple DeepSeek agents in parallel via Python script (same as spawn_agent but multiple at once). Each agent runs independently with read-only tool access (read_file, search_code, query_data). All agents complete before results return. Requires DEEPSEEK_API_KEY. 10-minute timeout per agent. Use when analyzing 3+ independent components. Returns array of results with execution time.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        agents: {
          type: Type.ARRAY,
          description: 'Array of agent configurations - each will spawn a DeepSeek agent automatically',
          items: {
            type: Type.OBJECT,
            properties: {
              id: {
                type: Type.STRING,
                description: 'Unique identifier for this agent (used to match results)'
              },
              task: {
                type: Type.STRING,
                description: 'What this DeepSeek agent should accomplish'
              },
              agent_type: {
                type: Type.STRING,
                description: 'Type of agent: analyst, reviewer, researcher, coder'
              },
              context: {
                type: Type.STRING,
                description: 'Optional context specific to this agent'
              }
            },
            required: ['id', 'task', 'agent_type']
          }
        }
      },
      required: ['agents']
    }
  }
];

// Quantitative Engine tools - High-level Python engine API
export const QUANT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_regime_heatmap',
    description: 'Get market regime classification for a date range. Returns a timeline showing the dominant regime (BULL_QUIET, BEAR_VOL, SIDEWAYS, VOL_EXPANSION) for each trading day, along with VIX levels, trend scores, and volume flow indicators. Use this to understand market conditions before recommending strategies.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        start_date: {
          type: Type.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: Type.STRING,
          description: 'End date in YYYY-MM-DD format'
        }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'list_strategies',
    description: 'List all available trading strategies (profiles) with descriptions and target regimes',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'get_strategy_details',
    description: 'Get performance details for a specific convexity profile strategy. Returns Sharpe ratio, win rate, max drawdown, annual return, trade duration, and a mini equity curve. Profiles 1-6 correspond to: Long Dated Gamma, Short Dated Gamma, Charm Harvester, Vanna Play, Skew Trader, Vol-of-Vol.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_id: {
          type: Type.STRING,
          description: 'Strategy identifier (profile_1 through profile_6)'
        }
      },
      required: ['strategy_id']
    }
  },
  {
    name: 'get_portfolio_greeks',
    description: 'Get LIVE portfolio Greeks exposure from the active engine. Returns actual net delta, gamma, theta, and vega across all active positions. Returns error if engine is offline. DO NOT HALLUCINATE VALUES - if data returns zeros or empty, that is the truth.',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  },
  {
    name: 'run_simulation',
    description: 'Run scenario simulation (VIX shock, price drop, vol crush) on current portfolio. Returns projected P&L, surviving/failing strategies, and margin call risk.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        scenario: {
          type: Type.STRING,
          description: 'Scenario type: vix_shock, price_drop, vol_crush'
        },
        params: {
          type: Type.OBJECT,
          description: 'Scenario parameters (optional)',
          properties: {}
        },
        portfolio: {
          type: Type.OBJECT,
          description: 'Portfolio positions (optional)',
          properties: {}
        }
      },
      required: ['scenario']
    }
  },
  {
    name: 'quant_engine_health',
    description: 'Check Python quant engine health status and connectivity',
    parameters: {
      type: Type.OBJECT,
      properties: {}
    }
  }
];

// Maintenance tools
export const MAINTENANCE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'cleanup_backups',
    description: 'Delete backup files older than specified days. Backups are created when files are modified or deleted.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dryRun: {
          type: Type.BOOLEAN,
          description: 'If true, only report what would be deleted without actually deleting'
        },
        olderThanDays: {
          type: Type.NUMBER,
          description: 'Delete backups older than this many days (default: 7)'
        }
      }
    }
  }
];

// Response tool - allows model to respond directly without using other tools
// IMPORTANT: Description discourages using this to avoid real work
export const RESPONSE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'respond_directly',
    description: 'Use ONLY for final text answers or pure conversation. If you need to perform ANY action (read files, search obsidian, query data, check regime), USE THE SPECIFIC TOOL INSTEAD. Do NOT use this to describe what you will do - just use the tool and show the result.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        response: {
          type: Type.STRING,
          description: 'Your response to the user'
        }
      },
      required: ['response']
    }
  }
];

// MCP/Obsidian Knowledge Base tools
// Access the quant-engine Obsidian knowledge base for strategies, backtests, and learnings
export const OBSIDIAN_TOOLS: FunctionDeclaration[] = [
  {
    name: 'obsidian_read_note',
    description: 'Read a note from the quant-engine Obsidian knowledge base. Use this to check strategy specs, backtest results, learnings, and decisions. Path is relative to /Projects/quant-engine/ in the vault.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to the note relative to /Projects/quant-engine/ (e.g., "06-Strategies/momentum-v1/SPEC.md", "DECISIONS.md", "08-Learnings/what-failed/example.md")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'obsidian_write_note',
    description: 'Write or update a note in the quant-engine Obsidian knowledge base. Use this to document strategies, backtest results, learnings, and decisions. Path is relative to /Projects/quant-engine/.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Path to the note relative to /Projects/quant-engine/ (e.g., "06-Strategies/new-strategy/SPEC.md")'
        },
        content: {
          type: Type.STRING,
          description: 'Markdown content of the note'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'obsidian_search_notes',
    description: 'Search for notes in the quant-engine Obsidian knowledge base. Returns matching notes with snippets. Use this to find relevant strategies, learnings, or decisions before starting work.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query (searches note content and frontmatter)'
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of results (default: 10)'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'obsidian_list_directory',
    description: 'List files and folders in a directory of the quant-engine Obsidian knowledge base. Path is relative to /Projects/quant-engine/.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Directory path relative to /Projects/quant-engine/ (e.g., "06-Strategies", "08-Learnings/what-failed"). Use "/" for root.'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'obsidian_document_learning',
    description: 'Document a learning (what worked, what failed, or overfitting warning) in the Obsidian knowledge base. Automatically creates properly structured note in the correct location.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        category: {
          type: Type.STRING,
          description: 'Category: "what-worked", "what-failed", or "overfitting-warning"'
        },
        title: {
          type: Type.STRING,
          description: 'Short title for the learning (will be used as filename)'
        },
        context: {
          type: Type.STRING,
          description: 'What were we trying to do?'
        },
        details: {
          type: Type.STRING,
          description: 'What happened / what we learned'
        },
        why: {
          type: Type.STRING,
          description: 'Root cause analysis - WHY did this work/fail?'
        },
        next_steps: {
          type: Type.STRING,
          description: 'What to do differently / recommendations'
        }
      },
      required: ['category', 'title', 'context', 'details', 'why']
    }
  },
  {
    name: 'obsidian_document_backtest',
    description: 'Document a backtest result in the Obsidian knowledge base. Automatically creates properly structured note with performance metrics and validation status.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        strategy_name: {
          type: Type.STRING,
          description: 'Name of the strategy being backtested'
        },
        start_date: {
          type: Type.STRING,
          description: 'Backtest start date (YYYY-MM-DD)'
        },
        end_date: {
          type: Type.STRING,
          description: 'Backtest end date (YYYY-MM-DD)'
        },
        sharpe_ratio: {
          type: Type.NUMBER,
          description: 'Sharpe ratio'
        },
        sortino_ratio: {
          type: Type.NUMBER,
          description: 'Sortino ratio'
        },
        max_drawdown: {
          type: Type.NUMBER,
          description: 'Maximum drawdown percentage'
        },
        win_rate: {
          type: Type.NUMBER,
          description: 'Win rate percentage'
        },
        total_trades: {
          type: Type.NUMBER,
          description: 'Total number of trades'
        },
        validated: {
          type: Type.BOOLEAN,
          description: 'Whether overfitting validation was performed'
        },
        notes: {
          type: Type.STRING,
          description: 'Additional notes or observations'
        }
      },
      required: ['strategy_name', 'start_date', 'end_date', 'sharpe_ratio', 'max_drawdown']
    }
  }
];

// MCP Knowledge Graph tools
// Entity relationship tracking for quant-engine architecture and research
export const KNOWLEDGE_GRAPH_TOOLS: FunctionDeclaration[] = [
  {
    name: 'kg_search',
    description: 'Search the knowledge graph for entities related to a query. Use this to understand relationships between strategies, regimes, and architectural components.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query (e.g., "momentum strategy", "CIO architecture", "regime detection")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'kg_create_entity',
    description: 'Create an entity in the knowledge graph to track a new concept, strategy, or architectural component.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: {
          type: Type.STRING,
          description: 'Entity name (e.g., "Momentum_Strategy_V1")'
        },
        entity_type: {
          type: Type.STRING,
          description: 'Type: strategy, regime, architecture_component, learning, decision'
        },
        observations: {
          type: Type.ARRAY,
          description: 'Key observations/facts about this entity',
          items: { type: Type.STRING }
        }
      },
      required: ['name', 'entity_type', 'observations']
    }
  },
  {
    name: 'kg_create_relation',
    description: 'Create a relationship between two entities in the knowledge graph.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        from_entity: {
          type: Type.STRING,
          description: 'Source entity name'
        },
        to_entity: {
          type: Type.STRING,
          description: 'Target entity name'
        },
        relation_type: {
          type: Type.STRING,
          description: 'Relationship type (e.g., "works_well_in", "depends_on", "replaces", "validates")'
        }
      },
      required: ['from_entity', 'to_entity', 'relation_type']
    }
  }
];

// Supabase Memory tools
// Direct memory save/recall for Gemini to persist learnings
export const MEMORY_TOOLS: FunctionDeclaration[] = [
  {
    name: 'save_memory',
    description: 'Save a memory/learning to Supabase for cross-session recall. Use this to persist important discoveries, decisions, failed approaches, or insights that should survive across sessions. This is SEPARATE from Obsidian - use for quick searchable notes, not canonical documentation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: 'The full memory content to save (detailed description)'
        },
        summary: {
          type: Type.STRING,
          description: 'Brief 1-2 sentence summary of the memory'
        },
        memory_type: {
          type: Type.STRING,
          description: 'Type: observation, lesson, rule, strategy, mistake, success, decision'
        },
        importance: {
          type: Type.NUMBER,
          description: 'Importance score 1-5 (5=critical, must remember)'
        },
        tags: {
          type: Type.ARRAY,
          description: 'Tags for searchability (e.g., ["momentum", "regime", "failure"])',
          items: { type: Type.STRING }
        }
      },
      required: ['content', 'summary', 'memory_type', 'importance']
    }
  },
  {
    name: 'recall_memory',
    description: 'Search memories in Supabase using semantic and keyword search. Use this to check what we already know before starting new work.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Search query (semantic search + keyword matching)'
        },
        memory_type: {
          type: Type.STRING,
          description: 'Optional: filter by type (observation, lesson, rule, strategy, mistake, success, decision)'
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum results to return (default: 10)'
        }
      },
      required: ['query']
    }
  }
];

// All tools combined (fallback when context is ambiguous)
// NOTE: RESPONSE_TOOLS removed - with AUTO mode, model can respond naturally
// CLAUDE_TOOLS high priority - enables multi-model architecture
// ALL_TOOLS - REORDERED for "Action First" priority
// LLMs are biased by tool order - research tools FIRST, talk tools LAST
export const ALL_TOOLS: FunctionDeclaration[] = [
  // 1. Research & Memory (Prioritized - check knowledge FIRST)
  ...OBSIDIAN_TOOLS,  // Knowledge base access
  ...MEMORY_TOOLS,  // Supabase memory save/recall
  ...KNOWLEDGE_GRAPH_TOOLS,  // Entity relationships

  // 2. Data & Quant (The Core Job)
  ...QUANT_TOOLS,   // High-level quant tools for regime/strategy analysis
  ...DATA_TOOLS,
  ...PYTHON_TOOLS,
  ...BACKTEST_TOOLS,

  // 3. Execution & Agents
  ...CLAUDE_TOOLS,  // Multi-model execution via Claude Code CLI
  ...AGENT_TOOLS,

  // 4. Utility (Lower priority)
  ...FILE_TOOLS,
  ...GIT_TOOLS,
  ...VALIDATION_TOOLS,
  ...ANALYSIS_TOOLS,
  ...MAINTENANCE_TOOLS

  // NOTE: RESPONSE_TOOLS removed - with AUTO mode, model responds naturally
];

// Tool names by category for filtering
export const TOOL_CATEGORIES = {
  claude: CLAUDE_TOOLS.map(t => t.name),
  obsidian: OBSIDIAN_TOOLS.map(t => t.name),
  knowledge_graph: KNOWLEDGE_GRAPH_TOOLS.map(t => t.name),
  memory: MEMORY_TOOLS.map(t => t.name),
  quant: QUANT_TOOLS.map(t => t.name),
  file: FILE_TOOLS.map(t => t.name),
  python: PYTHON_TOOLS.map(t => t.name),
  git: GIT_TOOLS.map(t => t.name),
  validation: VALIDATION_TOOLS.map(t => t.name),
  analysis: ANALYSIS_TOOLS.map(t => t.name),
  backtest: BACKTEST_TOOLS.map(t => t.name),
  data: DATA_TOOLS.map(t => t.name),
  agent: AGENT_TOOLS.map(t => t.name),
  maintenance: MAINTENANCE_TOOLS.map(t => t.name)
};
