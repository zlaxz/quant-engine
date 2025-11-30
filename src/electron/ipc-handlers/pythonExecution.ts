import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createClient } from '@supabase/supabase-js';
import { validateIPC, BacktestParamsSchema } from '../validation/schemas';

// SECURITY: Use environment variables instead of hardcoded credentials
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Get rotation engine root dynamically at runtime
function getRotationEngineRoot(): string {
  const root = process.env.ROTATION_ENGINE_ROOT;
  if (!root) {
    throw new Error('No project directory configured. Go to Settings to set one.');
  }
  return root;
}

export function registerPythonExecutionHandlers() {
  ipcMain.handle('run-backtest', async (_event, paramsRaw: unknown) => {
    try {
      // Validate at IPC boundary
      const params = validateIPC(BacktestParamsSchema, paramsRaw, 'backtest parameters');

      const ROTATION_ENGINE_ROOT = getRotationEngineRoot();
      
      // Build Python command using cli_wrapper.py
      const cmd = [
        'python3',
        'server.py',  // Python Flask API server
        '--profile', params.strategyKey,
        '--start', params.startDate,
        '--end', params.endDate,
        '--capital', params.capital.toString(),
      ];

      if (params.profileConfig) {
        cmd.push('--config', JSON.stringify(params.profileConfig));
      }

      // Execute Python process
      const pythonProcess = spawn(cmd[0], cmd.slice(1), {
        cwd: ROTATION_ENGINE_ROOT,
        timeout: 300000, // 5 minute timeout
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for process to complete
      const exitCode = await new Promise<number>((resolve, reject) => {
        pythonProcess.on('close', resolve);
        pythonProcess.on('error', reject);
      });

      if (exitCode !== 0) {
        return {
          success: false,
          error: stderr || 'Backtest process failed',
        };
      }

      // Parse results from stdout with error handling
      let results;
      try {
        results = JSON.parse(stdout);
      } catch (parseError) {
        return {
          success: false,
          error: `Failed to parse backtest results: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`,
        };
      }

      // Save raw results to local file
      const runId = results.runId || `run_${Date.now()}`;
      const resultsPath = path.join(
        ROTATION_ENGINE_ROOT,
        'data',
        'backtest_results',
        'runs',
        `${runId}.json`
      );

      await fs.mkdir(path.dirname(resultsPath), { recursive: true });
      await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), 'utf-8');

      // Save to Supabase database for UI display and analysis
      try {
        const { error: dbError } = await supabase
          .from('backtest_runs')
          .insert({
            id: runId,
            strategy_key: params.strategyKey,
            params: {
              start_date: params.startDate,
              end_date: params.endDate,
              capital: params.capital,
              profile_config: params.profileConfig
            },
            metrics: results.metrics,
            equity_curve: results.equity_curve,
            status: 'completed',
            engine_source: 'rotation-engine',
            raw_results_url: resultsPath,
            started_at: new Date().toISOString(),
            completed_at: new Date().toISOString()
          });

        if (dbError) {
          console.error('[Backtest] Failed to save to database:', dbError);
          // Continue anyway - local file is saved
        } else {
          console.log('[Backtest] ✅ Saved to database:', runId);
        }
      } catch (dbSaveError) {
        console.error('[Backtest] Database save exception:', dbSaveError);
        // Continue anyway - local file is saved
      }

      return {
        success: true,
        runId,
        metrics: results.metrics,
        equityCurve: results.equity_curve,
        trades: results.trades,
        rawResultsPath: resultsPath,
      };
    } catch (error) {
      const errorDetails = error instanceof Error 
        ? `${error.message}\n\nStack:\n${error.stack}`
        : String(error);
      
      console.error('[Backtest] Error:', errorDetails);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorDetails: errorDetails
      };
    }
  });
}
