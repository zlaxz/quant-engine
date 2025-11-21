/**
 * MCP Tool Definitions and Implementations
 * Implements file operations, git operations, and code search tools for Chief Quant
 */

import { readFile, listDirectory, searchCode } from './fileOperations.ts';
import { executeGitCommand } from './gitOperations.ts';

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
