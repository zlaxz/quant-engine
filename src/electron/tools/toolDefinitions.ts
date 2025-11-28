/**
 * Tool Definitions for Gemini Function Calling
 * Defines all tools available to Chief Quant and Swarm agents
 */

import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

// Core file operation tools
export const FILE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from the rotation-engine codebase',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'File path relative to rotation-engine root (e.g., "strategies/skew_convexity.py")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'Directory path relative to rotation-engine root (e.g., "strategies" or ".")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search_code',
    description: 'Search for code patterns using regex across the rotation-engine codebase',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        pattern: {
          type: SchemaType.STRING,
          description: 'Regex pattern to search for'
        },
        path: {
          type: SchemaType.STRING,
          description: 'Optional path to limit search scope'
        },
        file_pattern: {
          type: SchemaType.STRING,
          description: 'Optional glob pattern to filter files (e.g., "*.py")'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the rotation-engine codebase',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'File path relative to rotation-engine root'
        },
        content: {
          type: SchemaType.STRING,
          description: 'File contents to write'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'append_file',
    description: 'Append content to an existing file',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'File path relative to rotation-engine root'
        },
        content: {
          type: SchemaType.STRING,
          description: 'Content to append'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the rotation-engine codebase',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'File path relative to rotation-engine root'
        }
      },
      required: ['path']
    }
  }
];

// Python execution tools
export const PYTHON_TOOLS: FunctionDeclaration[] = [
  {
    name: 'run_python_script',
    description: 'Execute a Python script in the rotation-engine environment and return its output. Use this to run backtests, data analysis, or any Python code. The script must already exist in the codebase.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        script_path: {
          type: SchemaType.STRING,
          description: 'Path to Python script relative to rotation-engine root (e.g., "rotation-engine-bridge/cli_wrapper.py" or "analysis/regime_classifier.py")'
        },
        args: {
          type: SchemaType.ARRAY,
          description: 'Command line arguments to pass to the script (e.g., ["--symbol", "SPY", "--start", "2023-01-01"])',
          items: {
            type: SchemaType.STRING
          }
        },
        timeout: {
          type: SchemaType.NUMBER,
          description: 'Maximum execution time in seconds (default: 300)'
        }
      },
      required: ['script_path']
    }
  }
];

// Git operation tools
export const GIT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'git_status',
    description: 'Get git status showing modified, staged, and untracked files',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {}
    }
  },
  {
    name: 'git_diff',
    description: 'Show git diff for changes',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'Optional file path to diff specific file'
        },
        staged: {
          type: SchemaType.BOOLEAN,
          description: 'Show staged changes (--cached)'
        }
      }
    }
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: 'Number of commits to show (default: 10)'
        },
        path: {
          type: SchemaType.STRING,
          description: 'Optional file path to show history for specific file'
        }
      }
    }
  },
  {
    name: 'git_add',
    description: 'Stage files for commit',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        message: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        list: {
          type: SchemaType.BOOLEAN,
          description: 'List all branches'
        },
        create: {
          type: SchemaType.BOOLEAN,
          description: 'Create new branch'
        },
        delete_branch: {
          type: SchemaType.BOOLEAN,
          description: 'Delete branch'
        },
        name: {
          type: SchemaType.STRING,
          description: 'Branch name'
        }
      }
    }
  },
  {
    name: 'git_checkout',
    description: 'Switch branches or create and switch to new branch',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        branch: {
          type: SchemaType.STRING,
          description: 'Branch name'
        },
        create: {
          type: SchemaType.BOOLEAN,
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
      type: SchemaType.OBJECT,
      properties: {
        remote: {
          type: SchemaType.STRING,
          description: 'Remote name (default: origin)'
        },
        branch: {
          type: SchemaType.STRING,
          description: 'Branch to push (default: current branch)'
        },
        force: {
          type: SchemaType.BOOLEAN,
          description: 'Force push (use with caution)'
        }
      }
    }
  },
  {
    name: 'git_pull',
    description: 'Pull changes from remote repository. Updates local branch with remote changes.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        remote: {
          type: SchemaType.STRING,
          description: 'Remote name (default: origin)'
        },
        branch: {
          type: SchemaType.STRING,
          description: 'Branch to pull (default: current branch)'
        },
        rebase: {
          type: SchemaType.BOOLEAN,
          description: 'Use rebase instead of merge'
        }
      }
    }
  },
  {
    name: 'git_fetch',
    description: 'Fetch changes from remote without merging. Use to see what changed upstream.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        remote: {
          type: SchemaType.STRING,
          description: 'Remote name (default: all remotes)'
        },
        prune: {
          type: SchemaType.BOOLEAN,
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
    description: 'Execute pytest test suite for rotation-engine',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'Optional path to specific test file or directory'
        },
        verbose: {
          type: SchemaType.BOOLEAN,
          description: 'Enable verbose output'
        }
      }
    }
  },
  {
    name: 'validate_strategy',
    description: 'Validate strategy file syntax and logic',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        strategy_key: {
          type: SchemaType.STRING,
          description: 'Strategy key (e.g., "skew_convexity_v1")'
        },
        start_date: {
          type: SchemaType.STRING,
          description: 'Start date (YYYY-MM-DD)'
        },
        end_date: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
          description: 'Path to file to type check'
        }
      },
      required: ['path']
    }
  }
];

// Code analysis tools
export const ANALYSIS_TOOLS: FunctionDeclaration[] = [
  {
    name: 'find_function',
    description: 'Find function definition in codebase using AST analysis',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: 'Function name to search for'
        },
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: 'Class name to search for'
        },
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        symbol: {
          type: SchemaType.STRING,
          description: 'Symbol name to find usages of'
        },
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        path: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        strategy_key: {
          type: SchemaType.STRING,
          description: 'Strategy key to backtest'
        },
        param_grid: {
          type: SchemaType.STRING,
          description: 'Parameter grid as JSON string with param names as keys and arrays of values'
        },
        start_date: {
          type: SchemaType.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: SchemaType.STRING,
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: SchemaType.NUMBER,
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
      type: SchemaType.OBJECT,
      properties: {
        strategy_key: {
          type: SchemaType.STRING,
          description: 'Strategy key to backtest'
        },
        param_name: {
          type: SchemaType.STRING,
          description: 'Name of the parameter to sweep'
        },
        start: {
          type: SchemaType.NUMBER,
          description: 'Starting value for parameter'
        },
        end: {
          type: SchemaType.NUMBER,
          description: 'Ending value for parameter'
        },
        step: {
          type: SchemaType.NUMBER,
          description: 'Step size for parameter sweep'
        },
        start_date: {
          type: SchemaType.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: SchemaType.STRING,
          description: 'End date in YYYY-MM-DD format'
        }
      },
      required: ['strategy_key', 'param_name', 'start', 'end', 'step', 'start_date', 'end_date']
    }
  },
  {
    name: 'cross_validate',
    description: 'Run walk-forward cross-validation to detect overfitting',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        strategy_key: {
          type: SchemaType.STRING,
          description: 'Strategy key to validate'
        },
        params: {
          type: SchemaType.STRING,
          description: 'Strategy parameters as JSON string'
        },
        start_date: {
          type: SchemaType.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: SchemaType.STRING,
          description: 'End date in YYYY-MM-DD format'
        },
        num_folds: {
          type: SchemaType.NUMBER,
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
      type: SchemaType.OBJECT,
      properties: {
        symbol: {
          type: SchemaType.STRING,
          description: 'Symbol to inspect (e.g., "SPX", "AAPL")'
        },
        start_date: {
          type: SchemaType.STRING,
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        symbol: {
          type: SchemaType.STRING,
          description: 'Symbol to check (e.g., "SPX", "AAPL")'
        },
        start_date: {
          type: SchemaType.STRING,
          description: 'Optional start date in YYYY-MM-DD format (default: all available data)'
        },
        end_date: {
          type: SchemaType.STRING,
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
      type: SchemaType.OBJECT,
      properties: {
        run_id: {
          type: SchemaType.STRING,
          description: 'Backtest run UUID'
        }
      },
      required: ['run_id']
    }
  }
];

// Agent spawning tools - AUTOMATIC DELEGATION TO DEEPSEEK
// These tools are handled by TypeScript handlers that automatically call DeepSeek
// Gemini just needs to call the tool - everything else happens automatically
export const AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'spawn_agent',
    description: 'AUTOMATIC DELEGATION: Calling this tool automatically spawns a DeepSeek agent that has its own tools (read_file, write_file, list_directory, search_code, run_command). You do NOT need to build anything - just call this tool with a task description and the system handles everything. Use sparingly - only for complex multi-file analysis. For simple reads, use read_file directly.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        task: {
          type: SchemaType.STRING,
          description: 'Clear description of what the agent should accomplish. The DeepSeek agent will autonomously use its tools to complete this.'
        },
        context: {
          type: SchemaType.STRING,
          description: 'Any relevant context, file contents, or background information the agent needs'
        },
        agent_type: {
          type: SchemaType.STRING,
          description: 'Type of agent to spawn: analyst (data analysis), reviewer (code review), researcher (information gathering), coder (implementation)'
        }
      },
      required: ['task', 'agent_type']
    }
  },
  {
    name: 'spawn_agents_parallel',
    description: 'AUTOMATIC PARALLEL DELEGATION: Calling this tool automatically spawns multiple DeepSeek agents that run in parallel. Each agent has its own tools and works independently. You do NOT build agents - just describe the tasks. Use only when reviewing 3+ independent files/components.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agents: {
          type: SchemaType.ARRAY,
          description: 'Array of agent configurations - each will spawn a DeepSeek agent automatically',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              id: {
                type: SchemaType.STRING,
                description: 'Unique identifier for this agent (used to match results)'
              },
              task: {
                type: SchemaType.STRING,
                description: 'What this DeepSeek agent should accomplish'
              },
              agent_type: {
                type: SchemaType.STRING,
                description: 'Type of agent: analyst, reviewer, researcher, coder'
              },
              context: {
                type: SchemaType.STRING,
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

// Maintenance tools
export const MAINTENANCE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'cleanup_backups',
    description: 'Delete backup files older than specified days. Backups are created when files are modified or deleted.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        dryRun: {
          type: SchemaType.BOOLEAN,
          description: 'If true, only report what would be deleted without actually deleting'
        },
        olderThanDays: {
          type: SchemaType.NUMBER,
          description: 'Delete backups older than this many days (default: 7)'
        }
      }
    }
  }
];

// Response tool - allows model to respond directly without using other tools
export const RESPONSE_TOOLS: FunctionDeclaration[] = [
  {
    name: 'respond_directly',
    description: 'USE THIS for most interactions: conversations, explanations, questions, greetings, advice, opinions, follow-ups. This is the DEFAULT choice. Only use other tools when you specifically need to read/write files or run commands.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        response: {
          type: SchemaType.STRING,
          description: 'Your response to the user'
        }
      },
      required: ['response']
    }
  }
];

// All tools combined - respond_directly FIRST so it's preferred
export const ALL_TOOLS: FunctionDeclaration[] = [
  ...RESPONSE_TOOLS,
  ...FILE_TOOLS,
  ...PYTHON_TOOLS,
  ...GIT_TOOLS,
  ...VALIDATION_TOOLS,
  ...ANALYSIS_TOOLS,
  ...BACKTEST_TOOLS,
  ...DATA_TOOLS,
  ...AGENT_TOOLS,
  ...MAINTENANCE_TOOLS
];

// Tool names by category for filtering
export const TOOL_CATEGORIES = {
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
