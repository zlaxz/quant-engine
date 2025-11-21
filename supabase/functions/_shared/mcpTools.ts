/**
 * MCP Tool Definitions and Implementations
 * Implements file operations, git operations, and code search tools for Chief Quant
 */

import { readFile, listDirectory, searchCode } from './fileOperations.ts';
import { executeGitCommand } from './gitOperations.ts';
import {
  runTests,
  validateStrategy,
  dryRunBacktest,
  lintCode,
  formatCode,
  typeCheck,
  checkDependencies,
  checkOutdatedPackages,
  checkPythonVersion
} from './validationOperations.ts';
import {
  findFunction,
  findClass,
  findUsages,
  generateCallGraph,
  generateImportTree,
  findDeadCode,
  calculateComplexity,
  generateCodeStats
} from './analysisOperations.ts';
import {
  runBatchBacktest,
  runParameterSweep,
  runRegressionTest,
  runCrossValidation
} from './automationOperations.ts';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface McpToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// Tool catalog
export const MCP_TOOLS: McpTool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file from the rotation-engine codebase',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to rotation-engine root (e.g., "strategies/skew_convexity.py")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_directory',
    description: 'List files and directories in a path',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path relative to rotation-engine root (e.g., "strategies" or ".")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search_code',
    description: 'Search for code patterns using regex across the rotation-engine codebase',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for'
        },
        path: {
          type: 'string',
          description: 'Optional path to limit search scope'
        },
        file_pattern: {
          type: 'string',
          description: 'Optional glob pattern to filter files (e.g., "*.py")'
        }
      },
      required: ['pattern']
    }
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file in the rotation-engine codebase',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to rotation-engine root'
        },
        content: {
          type: 'string',
          description: 'File contents to write'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'append_file',
    description: 'Append content to an existing file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to rotation-engine root'
        },
        content: {
          type: 'string',
          description: 'Content to append'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the rotation-engine codebase',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to rotation-engine root'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'rename_file',
    description: 'Rename or move a file',
    inputSchema: {
      type: 'object',
      properties: {
        oldPath: {
          type: 'string',
          description: 'Current file path'
        },
        newPath: {
          type: 'string',
          description: 'New file path'
        }
      },
      required: ['oldPath', 'newPath']
    }
  },
  {
    name: 'copy_file',
    description: 'Copy a file to a new location',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Source file path'
        },
        destPath: {
          type: 'string',
          description: 'Destination file path'
        }
      },
      required: ['sourcePath', 'destPath']
    }
  },
  {
    name: 'create_directory',
    description: 'Create a new directory',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'git_status',
    description: 'Get git status showing modified, staged, and untracked files',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'git_diff',
    description: 'Show git diff for changes',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional file path to diff specific file'
        },
        staged: {
          type: 'boolean',
          description: 'Show staged changes (--cached)'
        }
      }
    }
  },
  {
    name: 'git_log',
    description: 'Show recent git commit history',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of commits to show (default: 10)'
        },
        path: {
          type: 'string',
          description: 'Optional file path to show history for specific file'
        }
      }
    }
  },
  {
    name: 'git_commit',
    description: 'Create a git commit with staged changes',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Commit message'
        }
      },
      required: ['message']
    }
  },
  {
    name: 'git_add',
    description: 'Stage files for commit',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to stage (or "." for all)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'git_branch',
    description: 'List, create, or delete branches',
    inputSchema: {
      type: 'object',
      properties: {
        list: {
          type: 'boolean',
          description: 'List all branches'
        },
        create: {
          type: 'boolean',
          description: 'Create new branch'
        },
        delete: {
          type: 'boolean',
          description: 'Delete branch'
        },
        name: {
          type: 'string',
          description: 'Branch name'
        }
      }
    }
  },
  {
    name: 'git_checkout',
    description: 'Switch branches or create and switch to new branch',
    inputSchema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'Branch name'
        },
        create: {
          type: 'boolean',
          description: 'Create new branch'
        }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_merge',
    description: 'Merge branch into current branch',
    inputSchema: {
      type: 'object',
      properties: {
        branch: {
          type: 'string',
          description: 'Branch to merge'
        },
        noFf: {
          type: 'boolean',
          description: 'Create merge commit even if fast-forward possible'
        }
      },
      required: ['branch']
    }
  },
  {
    name: 'git_pull',
    description: 'Fetch and merge changes from remote',
    inputSchema: {
      type: 'object',
      properties: {
        remote: {
          type: 'string',
          description: 'Remote name (default: origin)'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        }
      }
    }
  },
  {
    name: 'git_push',
    description: 'Push commits to remote repository',
    inputSchema: {
      type: 'object',
      properties: {
        remote: {
          type: 'string',
          description: 'Remote name (default: origin)'
        },
        branch: {
          type: 'string',
          description: 'Branch name'
        },
        setUpstream: {
          type: 'boolean',
          description: 'Set upstream tracking'
        }
      }
    }
  },
  {
    name: 'git_revert',
    description: 'Revert a commit by creating a new commit',
    inputSchema: {
      type: 'object',
      properties: {
        commit: {
          type: 'string',
          description: 'Commit hash to revert'
        },
        noCommit: {
          type: 'boolean',
          description: 'Revert without committing'
        }
      },
      required: ['commit']
    }
  },
  {
    name: 'git_stash',
    description: 'Stash changes in working directory',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'list', 'pop', 'apply', 'drop', 'clear'],
          description: 'Stash action (default: save)'
        }
      }
    }
  },
  {
    name: 'run_tests',
    description: 'Execute pytest test suite for rotation-engine',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional path to specific test file or directory'
        },
        verbose: {
          type: 'boolean',
          description: 'Enable verbose output'
        }
      }
    }
  },
  {
    name: 'validate_strategy',
    description: 'Validate strategy file syntax and logic',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to strategy file (e.g., "strategies/skew_convexity.py")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'dry_run_backtest',
    description: 'Quick validation of backtest parameters without full execution',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_key: {
          type: 'string',
          description: 'Strategy key (e.g., "skew_convexity_v1")'
        },
        start_date: {
          type: 'string',
          description: 'Start date (YYYY-MM-DD)'
        },
        end_date: {
          type: 'string',
          description: 'End date (YYYY-MM-DD)'
        }
      },
      required: ['strategy_key', 'start_date', 'end_date']
    }
  },
  {
    name: 'lint_code',
    description: 'Run code linter (flake8 or pylint) on Python files',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to file or directory to lint'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'format_code',
    description: 'Check code formatting with black (non-destructive)',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to file to check formatting'
        },
        check: {
          type: 'boolean',
          description: 'Only check, do not modify (default: true)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'type_check',
    description: 'Run mypy type checking on Python files',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to file to type check'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'check_deps',
    description: 'Verify all required dependencies are installed',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'outdated_packages',
    description: 'Check for outdated Python packages',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'python_version',
    description: 'Check Python version compatibility',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'find_function',
    description: 'Find function definition in codebase using AST analysis',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Function name to search for'
        },
        path: {
          type: 'string',
          description: 'Optional path to limit search scope'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'find_class',
    description: 'Find class definition in codebase using AST analysis',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Class name to search for'
        },
        path: {
          type: 'string',
          description: 'Optional path to limit search scope'
        }
      },
      required: ['name']
    }
  },
  {
    name: 'find_usages',
    description: 'Find all usages/references to a symbol (function/class/variable)',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Symbol name to find usages of'
        },
        path: {
          type: 'string',
          description: 'Optional path to limit search scope'
        }
      },
      required: ['symbol']
    }
  },
  {
    name: 'call_graph',
    description: 'Generate call graph showing what functions a function calls',
    inputSchema: {
      type: 'object',
      properties: {
        function_name: {
          type: 'string',
          description: 'Function name to analyze'
        },
        path: {
          type: 'string',
          description: 'Optional path to limit analysis scope'
        }
      },
      required: ['function_name']
    }
  },
  {
    name: 'import_tree',
    description: 'Show import dependency tree for a module',
    inputSchema: {
      type: 'object',
      properties: {
        module_name: {
          type: 'string',
          description: 'Module name to analyze imports for'
        }
      },
      required: ['module_name']
    }
  },
  {
    name: 'dead_code',
    description: 'Find potentially unused functions and classes',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional path to analyze (default: entire codebase)'
        }
      }
    }
  },
  {
    name: 'complexity',
    description: 'Calculate cyclomatic complexity for functions in a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to analyze'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'code_stats',
    description: 'Generate codebase statistics (lines, functions, classes, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional path to analyze (default: entire codebase)'
        }
      }
    }
  },
  
  // Phase 5: Workflow Automation
  {
    name: 'batch_backtest',
    description: 'Run multiple backtests in parallel with a parameter grid. Returns ranked results by Sharpe ratio.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_key: {
          type: 'string',
          description: 'Strategy key to backtest'
        },
        param_grid: {
          type: 'object',
          description: 'Parameter grid as JSON object with param names as keys and arrays of values. Max 100 combinations.',
          additionalProperties: { type: 'array' }
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: 'number',
          description: 'Initial capital for backtest (default: 100000)'
        },
        session_id: {
          type: 'string',
          description: 'Optional session ID to link results'
        }
      },
      required: ['strategy_key', 'param_grid', 'start_date', 'end_date']
    }
  },
  {
    name: 'sweep_params',
    description: 'Sweep a single parameter across a range. Returns metrics curve vs parameter value.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_key: {
          type: 'string',
          description: 'Strategy key to backtest'
        },
        param_name: {
          type: 'string',
          description: 'Name of the parameter to sweep'
        },
        start: {
          type: 'number',
          description: 'Starting value for parameter'
        },
        end: {
          type: 'number',
          description: 'Ending value for parameter'
        },
        step: {
          type: 'number',
          description: 'Step size for parameter sweep'
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: 'number',
          description: 'Initial capital for backtest (default: 100000)'
        },
        session_id: {
          type: 'string',
          description: 'Optional session ID to link results'
        }
      },
      required: ['strategy_key', 'param_name', 'start', 'end', 'step', 'start_date', 'end_date']
    }
  },
  {
    name: 'regression_test',
    description: 'Run regression test comparing current strategy to a historical benchmark run. Detects performance degradation.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_key: {
          type: 'string',
          description: 'Strategy key to test'
        },
        benchmark_run_id: {
          type: 'string',
          description: 'UUID of benchmark backtest run'
        },
        current_params: {
          type: 'object',
          description: 'Current strategy parameters to test',
          additionalProperties: true
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: 'number',
          description: 'Initial capital for backtest (default: 100000)'
        },
        session_id: {
          type: 'string',
          description: 'Optional session ID to link results'
        }
      },
      required: ['strategy_key', 'benchmark_run_id', 'current_params', 'start_date', 'end_date']
    }
  },
  {
    name: 'cross_validate',
    description: 'Run walk-forward cross-validation to detect overfitting. Splits data into in-sample/out-of-sample folds.',
    inputSchema: {
      type: 'object',
      properties: {
        strategy_key: {
          type: 'string',
          description: 'Strategy key to validate'
        },
        params: {
          type: 'object',
          description: 'Strategy parameters',
          additionalProperties: true
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format'
        },
        capital: {
          type: 'number',
          description: 'Initial capital for backtest (default: 100000)'
        },
        in_sample_ratio: {
          type: 'number',
          description: 'Ratio of in-sample to total (default: 0.7)'
        },
        num_folds: {
          type: 'number',
          description: 'Number of folds (default: 5)'
        },
        session_id: {
          type: 'string',
          description: 'Optional session ID to link results'
        }
      },
      required: ['strategy_key', 'params', 'start_date', 'end_date']
    }
  }
];

// Tool execution dispatcher
export async function executeMcpTool(
  toolCall: McpToolCall,
  engineRoot: string
): Promise<McpToolResult> {
  try {
    const { name, arguments: args } = toolCall;

    switch (name) {
      case 'read_file':
        return await executeReadFile(args.path, engineRoot);
      
      case 'list_directory':
        return await executeListDirectory(args.path, engineRoot);
      
      case 'search_code':
        return await executeSearchCode(args.pattern, args.path, args.file_pattern, engineRoot);
      
      case 'write_file':
        return await executeWriteFile(args.path, args.content, engineRoot);
      
      case 'append_file':
        return await executeAppendFile(args.path, args.content, engineRoot);
      
      case 'delete_file':
        return await executeDeleteFile(args.path, engineRoot);
      
      case 'rename_file':
        return await executeRenameFile(args.oldPath, args.newPath, engineRoot);
      
      case 'copy_file':
        return await executeCopyFile(args.sourcePath, args.destPath, engineRoot);
      
      case 'create_directory':
        return await executeCreateDirectory(args.path, engineRoot);
      
      case 'git_status':
        return await executeGitStatus(engineRoot);
      
      case 'git_diff':
        return await executeGitDiff(args.path, args.staged, engineRoot);
      
      case 'git_log':
        return await executeGitLog(args.limit, args.path, engineRoot);
      
      case 'git_commit':
        return await executeGitCommit(args.message, engineRoot);
      
      case 'git_add':
        return await executeGitAdd(args.path, engineRoot);
      
      case 'git_branch':
        return await executeGitBranch(args, engineRoot);
      
      case 'git_checkout':
        return await executeGitCheckout(args, engineRoot);
      
      case 'git_merge':
        return await executeGitMerge(args, engineRoot);
      
      case 'git_pull':
        return await executeGitPull(args, engineRoot);
      
      case 'git_push':
        return await executeGitPush(args, engineRoot);
      
      case 'git_revert':
        return await executeGitRevert(args, engineRoot);
      
      case 'git_stash':
        return await executeGitStash(args, engineRoot);
      
      case 'run_tests':
        return await executeRunTests(args.path, args.verbose, engineRoot);
      
      case 'validate_strategy':
        return await executeValidateStrategy(args.path, engineRoot);
      
      case 'dry_run_backtest':
        return await executeDryRunBacktest(args.strategy_key, args.start_date, args.end_date, engineRoot);
      
      case 'lint_code':
        return await executeLintCode(args.path, engineRoot);
      
      case 'format_code':
        return await executeFormatCode(args.path, args.check !== false, engineRoot);
      
      case 'type_check':
        return await executeTypeCheck(args.path, engineRoot);
      
      case 'check_deps':
        return await executeCheckDeps(engineRoot);
      
      case 'outdated_packages':
        return await executeOutdatedPackages(engineRoot);
      
      case 'python_version':
        return await executePythonVersion(engineRoot);
      
      case 'find_function':
        return await executeFindFunction(args.name, args.path, engineRoot);
      
      case 'find_class':
        return await executeFindClass(args.name, args.path, engineRoot);
      
      case 'find_usages':
        return await executeFindUsages(args.symbol, args.path, engineRoot);
      
      case 'call_graph':
        return await executeCallGraph(args.function_name, args.path, engineRoot);
      
      case 'import_tree':
        return await executeImportTree(args.module_name, engineRoot);
      
      case 'dead_code':
        return await executeDeadCode(args.path, engineRoot);
      
      case 'complexity':
        return await executeComplexity(args.path, engineRoot);
      
      case 'code_stats':
        return await executeCodeStats(args.path, engineRoot);
      
      case 'batch_backtest':
        return await executeBatchBacktest(args, engineRoot);
      
      case 'sweep_params':
        return await executeSweepParams(args, engineRoot);
      
      case 'regression_test':
        return await executeRegressionTest(args, engineRoot);
      
      case 'cross_validate':
        return await executeCrossValidate(args, engineRoot);
      
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{ 
        type: 'text', 
        text: `Tool execution error: ${error instanceof Error ? error.message : String(error)}` 
      }],
      isError: true
    };
  }
}

// Tool implementations
async function executeReadFile(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await readFile(path, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.content || '' }] };
}

async function executeListDirectory(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await listDirectory(path, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result.items, null, 2) }] };
}

async function executeSearchCode(
  pattern: string, 
  path: string | undefined, 
  filePattern: string | undefined,
  engineRoot: string
): Promise<McpToolResult> {
  const result = await searchCode(pattern, path, filePattern, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result.matches, null, 2) }] };
}

async function executeWriteFile(path: string, content: string, engineRoot: string): Promise<McpToolResult> {
  // Delegate to write-file edge function
  const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/write-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'write', path, content })
  });
  
  const data = await result.json();
  if (!data.success) {
    return { content: [{ type: 'text', text: data.error || 'Write failed' }], isError: true };
  }
  return { content: [{ type: 'text', text: `File written: ${path}${data.backup_path ? `\nBackup: ${data.backup_path}` : ''}` }] };
}

async function executeAppendFile(path: string, content: string, engineRoot: string): Promise<McpToolResult> {
  const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/write-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'append', path, content })
  });
  
  const data = await result.json();
  if (!data.success) {
    return { content: [{ type: 'text', text: data.error || 'Append failed' }], isError: true };
  }
  return { content: [{ type: 'text', text: `Content appended to: ${path}` }] };
}

async function executeDeleteFile(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/write-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'delete', path })
  });
  
  const data = await result.json();
  if (!data.success) {
    return { content: [{ type: 'text', text: data.error || 'Delete failed' }], isError: true };
  }
  return { content: [{ type: 'text', text: `File deleted: ${path}${data.backup_path ? `\nBackup: ${data.backup_path}` : ''}` }] };
}

async function executeRenameFile(oldPath: string, newPath: string, engineRoot: string): Promise<McpToolResult> {
  const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/write-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'rename', path: oldPath, newPath })
  });
  
  const data = await result.json();
  if (!data.success) {
    return { content: [{ type: 'text', text: data.error || 'Rename failed' }], isError: true };
  }
  return { content: [{ type: 'text', text: `File renamed: ${oldPath} → ${newPath}` }] };
}

async function executeCopyFile(sourcePath: string, destPath: string, engineRoot: string): Promise<McpToolResult> {
  const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/write-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'copy', path: sourcePath, newPath: destPath })
  });
  
  const data = await result.json();
  if (!data.success) {
    return { content: [{ type: 'text', text: data.error || 'Copy failed' }], isError: true };
  }
  return { content: [{ type: 'text', text: `File copied: ${sourcePath} → ${destPath}` }] };
}

async function executeCreateDirectory(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/write-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'create_dir', path })
  });
  
  const data = await result.json();
  if (!data.success) {
    return { content: [{ type: 'text', text: data.error || 'Directory creation failed' }], isError: true };
  }
  return { content: [{ type: 'text', text: `Directory created: ${path}` }] };
}

async function executeGitStatus(engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('status', {}, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || '' }] };
}

async function executeGitDiff(path: string | undefined, staged: boolean | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('diff', { path, staged }, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'No changes' }] };
}

async function executeGitLog(limit: number | undefined, path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('log', { limit: limit || 10, path }, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || '' }] };
}

async function executeGitCommit(message: string, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('commit', { message }, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Commit created' }] };
}

async function executeGitAdd(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('add', { path }, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || `Staged ${path}` }] };
}

async function executeGitBranch(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('branch', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Branch operation completed' }] };
}

async function executeGitCheckout(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('checkout', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || `Switched to branch ${args.branch}` }] };
}

async function executeGitMerge(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('merge', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || `Merged ${args.branch}` }] };
}

async function executeGitPull(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('pull', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Pull completed' }] };
}

async function executeGitPush(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('push', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Push completed' }] };
}

async function executeGitRevert(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('revert', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || `Reverted commit ${args.commit}` }] };
}

async function executeGitStash(args: any, engineRoot: string): Promise<McpToolResult> {
  const result = await executeGitCommand('stash', args, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Stash operation completed' }] };
}

async function executeRunTests(path: string | undefined, verbose: boolean | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await runTests(path, engineRoot, verbose);
  if (result.error) {
    return { content: [{ type: 'text', text: `Test execution failed:\n${result.error}` }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Tests completed' }] };
}

async function executeValidateStrategy(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await validateStrategy(path, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Strategy validation passed' }] };
}

async function executeDryRunBacktest(strategyKey: string, startDate: string, endDate: string, engineRoot: string): Promise<McpToolResult> {
  const result = await dryRunBacktest(strategyKey, startDate, endDate, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Dry run completed' }] };
}

async function executeLintCode(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await lintCode(path, engineRoot);
  if (result.error && !result.output) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'No linting issues found' }] };
}

async function executeFormatCode(path: string, check: boolean, engineRoot: string): Promise<McpToolResult> {
  const result = await formatCode(path, engineRoot, check);
  if (result.error && !result.output) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Code formatting check passed' }] };
}

async function executeTypeCheck(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await typeCheck(path, engineRoot);
  if (result.error && !result.output) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Type checking passed' }] };
}

async function executeCheckDeps(engineRoot: string): Promise<McpToolResult> {
  const result = await checkDependencies(engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'All dependencies installed' }] };
}

async function executeOutdatedPackages(engineRoot: string): Promise<McpToolResult> {
  const result = await checkOutdatedPackages(engineRoot);
  if (result.error && !result.output) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'All packages up to date' }] };
}

async function executePythonVersion(engineRoot: string): Promise<McpToolResult> {
  const result = await checkPythonVersion(engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output || 'Python version check completed' }] };
}

async function executeFindFunction(name: string, path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await findFunction(name, engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeFindClass(name: string, path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await findClass(name, engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeFindUsages(symbol: string, path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await findUsages(symbol, engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeCallGraph(functionName: string, path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await generateCallGraph(functionName, engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeImportTree(moduleName: string, engineRoot: string): Promise<McpToolResult> {
  const result = await generateImportTree(moduleName, engineRoot);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeDeadCode(path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await findDeadCode(engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeComplexity(path: string, engineRoot: string): Promise<McpToolResult> {
  const result = await calculateComplexity(engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

async function executeCodeStats(path: string | undefined, engineRoot: string): Promise<McpToolResult> {
  const result = await generateCodeStats(engineRoot, path);
  if (result.error) {
    return { content: [{ type: 'text', text: result.error }], isError: true };
  }
  return { content: [{ type: 'text', text: result.output }] };
}

// Phase 5: Workflow Automation Executors

async function executeBatchBacktest(args: any, engineRoot: string): Promise<McpToolResult> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        content: [{ type: 'text', text: 'Supabase credentials not configured' }],
        isError: true
      };
    }
    
    // Create Supabase client
    const supabaseClient = {
      functions: {
        invoke: async (name: string, options: any) => {
          const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify(options.body)
          });
          const data = await response.json();
          return { data, error: response.ok ? null : data };
        }
      }
    };

    const result = await runBatchBacktest(
      supabaseClient,
      args.strategy_key,
      args.param_grid,
      {
        startDate: args.start_date,
        endDate: args.end_date,
        capital: args.capital || 100000,
        sessionId: args.session_id
      }
    );

    if (!result.success) {
      return { content: [{ type: 'text', text: result.summary }], isError: true };
    }

    return { content: [{ type: 'text', text: result.summary }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Batch backtest error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

async function executeSweepParams(args: any, engineRoot: string): Promise<McpToolResult> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        content: [{ type: 'text', text: 'Supabase credentials not configured' }],
        isError: true
      };
    }
    
    const supabaseClient = {
      functions: {
        invoke: async (name: string, options: any) => {
          const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify(options.body)
          });
          const data = await response.json();
          return { data, error: response.ok ? null : data };
        }
      }
    };

    const result = await runParameterSweep(
      supabaseClient,
      args.strategy_key,
      args.param_name,
      args.start,
      args.end,
      args.step,
      {
        startDate: args.start_date,
        endDate: args.end_date,
        capital: args.capital || 100000,
        sessionId: args.session_id
      }
    );

    if (!result.success) {
      return { content: [{ type: 'text', text: result.summary }], isError: true };
    }

    return { content: [{ type: 'text', text: result.summary }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Parameter sweep error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

async function executeRegressionTest(args: any, engineRoot: string): Promise<McpToolResult> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        content: [{ type: 'text', text: 'Supabase credentials not configured' }],
        isError: true
      };
    }
    
    // Create proper Supabase client mock
    const supabaseClient = {
      functions: {
        invoke: async (name: string, options: any) => {
          const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify(options.body)
          });
          const data = await response.json();
          return { data, error: response.ok ? null : data };
        }
      },
      from: (table: string) => ({
        select: (columns: string) => ({
          eq: (column: string, value: any) => ({
            maybeSingle: async () => {
              const response = await fetch(
                `${supabaseUrl}/rest/v1/${table}?${column}=eq.${value}&select=${columns}`,
                {
                  headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation'
                  }
                }
              );
              
              if (!response.ok) {
                const error = await response.json();
                return { data: null, error };
              }
              
              const data = await response.json();
              return { data: data.length > 0 ? data[0] : null, error: null };
            }
          })
        })
      })
    };

    const result = await runRegressionTest(
      supabaseClient,
      args.strategy_key,
      args.benchmark_run_id,
      args.current_params,
      {
        startDate: args.start_date,
        endDate: args.end_date,
        capital: args.capital || 100000,
        sessionId: args.session_id
      }
    );

    if (!result.success) {
      return { content: [{ type: 'text', text: result.summary }], isError: true };
    }

    return { content: [{ type: 'text', text: result.summary }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Regression test error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}

async function executeCrossValidate(args: any, engineRoot: string): Promise<McpToolResult> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      return {
        content: [{ type: 'text', text: 'Supabase credentials not configured' }],
        isError: true
      };
    }
    
    const supabaseClient = {
      functions: {
        invoke: async (name: string, options: any) => {
          const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify(options.body)
          });
          const data = await response.json();
          return { data, error: response.ok ? null : data };
        }
      }
    };

    const result = await runCrossValidation(
      supabaseClient,
      args.strategy_key,
      args.params,
      {
        startDate: args.start_date,
        endDate: args.end_date,
        capital: args.capital || 100000,
        inSampleRatio: args.in_sample_ratio || 0.7,
        numFolds: args.num_folds || 5,
        sessionId: args.session_id
      }
    );

    if (!result.success) {
      return { content: [{ type: 'text', text: result.summary }], isError: true };
    }

    return { content: [{ type: 'text', text: result.summary }] };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Cross-validation error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}
