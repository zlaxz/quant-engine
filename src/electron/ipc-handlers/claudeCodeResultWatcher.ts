/**
 * Claude Code Result Watcher
 *
 * Watches for result files from Claude Code executions and inserts them
 * as chat messages into Supabase. This enables async delegation where
 * Gemini can delegate work and continue without blocking.
 *
 * Flow:
 * 1. Gemini delegates task to Claude Code (returns immediately)
 * 2. Claude Code executes in Terminal (user can interact)
 * 3. Claude Code writes result to /tmp/claude-code-results/{session_id}.json
 * 4. This watcher picks up the file
 * 5. Inserts result as chat_message to Supabase
 * 6. UI updates via real-time subscription
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Result directory that Claude Code writes to
const RESULTS_DIR = '/tmp/claude-code-results';

// Supabase client for inserting messages
let supabase: ReturnType<typeof createClient> | null = null;

interface ClaudeCodeResult {
  session_id: string;
  content: string;
  display_directives?: any[];
  files_created?: string[];
  files_modified?: string[];
  execution_time_ms?: number;
  exit_code?: number;
  task_summary?: string;
}

/**
 * Initialize the result watcher
 */
export function initClaudeCodeResultWatcher(): void {
  // Ensure results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    console.log('[ClaudeCodeWatcher] Created results directory:', RESULTS_DIR);
  }

  // Initialize Supabase client - try multiple env var names
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[ClaudeCodeWatcher] Missing Supabase credentials, watcher disabled');
    console.error('[ClaudeCodeWatcher] Checked: VITE_SUPABASE_URL, SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY');
    return;
  }

  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('[ClaudeCodeWatcher] Supabase client initialized');

  // Start watching for result files
  startWatching();

  console.log('[ClaudeCodeWatcher] Watching for results in:', RESULTS_DIR);
}

/**
 * Start the file watcher
 */
function startWatching(): void {
  // Process any existing files first (in case app restarted mid-execution)
  processExistingFiles();

  // Watch for new files
  fs.watch(RESULTS_DIR, { persistent: true }, async (eventType, filename) => {
    if (eventType === 'rename' && filename && filename.endsWith('.json')) {
      const filePath = path.join(RESULTS_DIR, filename);

      // Small delay to ensure file is fully written
      await new Promise(resolve => setTimeout(resolve, 500));

      if (fs.existsSync(filePath)) {
        await processResultFile(filePath);
      }
    }
  });
}

/**
 * Process any existing result files (recovery after restart)
 */
async function processExistingFiles(): Promise<void> {
  try {
    const files = fs.readdirSync(RESULTS_DIR);
    for (const file of files) {
      if (file.endsWith('.json')) {
        await processResultFile(path.join(RESULTS_DIR, file));
      }
    }
  } catch (error) {
    console.error('[ClaudeCodeWatcher] Error processing existing files:', error);
  }
}

/**
 * Process a single result file
 */
async function processResultFile(filePath: string): Promise<void> {
  console.log('[ClaudeCodeWatcher] Processing result file:', filePath);

  try {
    // Read and parse the result
    const content = fs.readFileSync(filePath, 'utf-8');
    const result: ClaudeCodeResult = JSON.parse(content);

    if (!result.session_id) {
      console.error('[ClaudeCodeWatcher] Result missing session_id:', filePath);
      fs.unlinkSync(filePath);
      return;
    }

    // Build the message content
    let messageContent = '';

    // Add task summary if present
    if (result.task_summary) {
      messageContent += `**Task Completed:** ${result.task_summary}\n\n`;
    }

    // Add main content
    messageContent += result.content;

    // Add file info if present
    if (result.files_created && result.files_created.length > 0) {
      messageContent += '\n\n**Files Created:**\n';
      result.files_created.forEach(f => {
        messageContent += `- ${f}\n`;
      });
    }

    if (result.files_modified && result.files_modified.length > 0) {
      messageContent += '\n\n**Files Modified:**\n';
      result.files_modified.forEach(f => {
        messageContent += `- ${f}\n`;
      });
    }

    // Add display directives inline if present
    if (result.display_directives && result.display_directives.length > 0) {
      messageContent += '\n\n';
      result.display_directives.forEach(directive => {
        messageContent += `:::directive:${directive.type}\n`;
        messageContent += JSON.stringify(directive.data, null, 2);
        messageContent += '\n:::\n\n';
      });
    }

    // Insert into Supabase
    if (supabase) {
      const messageData = {
        session_id: result.session_id,
        role: 'assistant',
        content: messageContent,
        model: 'claude-code',
        provider: 'anthropic',
        token_usage: {
          source: 'claude-code-cli',
          execution_time_ms: result.execution_time_ms,
          exit_code: result.exit_code
        }
      };
      const { error } = await supabase.from('messages').insert(messageData as any);

      if (error) {
        console.error('[ClaudeCodeWatcher] Error inserting message:', error);
        // Don't delete file on error - might want to retry
        return;
      }

      console.log('[ClaudeCodeWatcher] Inserted message for session:', result.session_id);
    }

    // Delete the processed file
    fs.unlinkSync(filePath);
    console.log('[ClaudeCodeWatcher] Deleted processed file:', filePath);

  } catch (error) {
    console.error('[ClaudeCodeWatcher] Error processing result:', error);
    // Move to error directory instead of deleting
    try {
      const errorDir = path.join(RESULTS_DIR, 'errors');
      if (!fs.existsSync(errorDir)) {
        fs.mkdirSync(errorDir, { recursive: true });
      }
      const errorPath = path.join(errorDir, path.basename(filePath));
      fs.renameSync(filePath, errorPath);
      console.log('[ClaudeCodeWatcher] Moved to errors:', errorPath);
    } catch (moveError) {
      console.error('[ClaudeCodeWatcher] Could not move error file:', moveError);
    }
  }
}

/**
 * Get the results directory path (for Claude Code prompt)
 */
export function getResultsDirectory(): string {
  return RESULTS_DIR;
}

/**
 * Cleanup on shutdown
 */
export function stopClaudeCodeResultWatcher(): void {
  console.log('[ClaudeCodeWatcher] Stopping watcher');
  // fs.watch doesn't have a clean close method, but process exit handles it
}
