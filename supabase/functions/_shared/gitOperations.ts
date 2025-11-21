/**
 * Git operations for rotation-engine codebase
 */

export interface GitResult {
  output?: string;
  error?: string;
}

export async function executeGitCommand(
  command: string,
  options: Record<string, any>,
  engineRoot: string
): Promise<GitResult> {
  try {
    let args: string[] = [];

    switch (command) {
      case 'status':
        args = ['status', '--short'];
        break;
      
      case 'diff':
        args = ['diff'];
        if (options.staged) args.push('--cached');
        if (options.path) args.push(options.path);
        break;
      
      case 'log':
        args = ['log', `--max-count=${options.limit || 10}`, '--oneline', '--decorate'];
        if (options.path) args.push(options.path);
        break;
      
      case 'commit':
        args = ['commit', '-m', options.message];
        break;
      
      case 'add':
        args = ['add'];
        if (options.path) {
          args.push(options.path);
        } else {
          args.push('.');
        }
        break;
      
      case 'branch':
        args = ['branch'];
        if (options.list) args.push('-a');
        if (options.create) {
          args.push(options.name);
        }
        if (options.delete) {
          args.push('-d', options.name);
        }
        break;
      
      case 'checkout':
        args = ['checkout'];
        if (options.create) args.push('-b');
        args.push(options.branch);
        break;
      
      case 'merge':
        args = ['merge', options.branch];
        if (options.noFf) args.push('--no-ff');
        break;
      
      case 'pull':
        args = ['pull'];
        if (options.remote) args.push(options.remote);
        if (options.branch) args.push(options.branch);
        break;
      
      case 'push':
        args = ['push'];
        if (options.remote) args.push(options.remote);
        if (options.branch) args.push(options.branch);
        if (options.setUpstream) args.push('--set-upstream', options.remote, options.branch);
        break;
      
      case 'revert':
        args = ['revert', options.commit];
        if (options.noCommit) args.push('--no-commit');
        break;
      
      case 'stash':
        args = ['stash'];
        if (options.action === 'list') args.push('list');
        else if (options.action === 'pop') args.push('pop');
        else if (options.action === 'apply') args.push('apply');
        else if (options.action === 'drop') args.push('drop');
        else if (options.action === 'clear') args.push('clear');
        break;
      
      default:
        return { error: `Unknown git command: ${command}` };
    }

    const process = new Deno.Command('git', {
      args,
      cwd: engineRoot,
      stdout: 'piped',
      stderr: 'piped'
    });

    const { code, stdout, stderr } = await process.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    if (code !== 0) {
      return { error: `Git command failed: ${errorOutput || 'Unknown error'}` };
    }

    return { output: output || errorOutput };
  } catch (error) {
    return { error: `Git operation failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
