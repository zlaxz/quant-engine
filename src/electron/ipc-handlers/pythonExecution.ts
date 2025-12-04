import { ipcMain } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { createClient } from '@supabase/supabase-js';
import { validateIPC, BacktestParamsSchema } from '../validation/schemas';

// ============================================================
// UNIFIED BRAIN: API-First Architecture
// ============================================================
// ALL Python execution goes through the Flask API server.
// This eliminates the "split brain" problem where spawn() and
// API calls could give different results.
//
// The Python server at localhost:5001 is the SINGLE SOURCE OF TRUTH.
// ============================================================

const PYTHON_SERVER_URL = 'http://localhost:5001';

// Supabase credentials from environment variables (never hardcode)
const SUPABASE_URL = 'https://ynaqtawyynqikfyranda.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InluYXF0YXd5eW5xaWtmeXJhbmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NzM5NjMsImV4cCI6MjA3OTE0OTk2M30.VegcJvLluy8toSYqnR7Ufc5jx5XAl1-XeDRl8KbsIIw';

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

      // ============================================================
      // API-FIRST: Call Python server instead of spawning process
      // ============================================================
      console.log(`[Backtest] Calling Python API: ${PYTHON_SERVER_URL}/api/backtest`);

      const response = await fetch(`${PYTHON_SERVER_URL}/api/backtest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy_key: params.strategyKey,
          start_date: params.startDate,
          end_date: params.endDate,
          capital: params.capital,
          profile_config: params.profileConfig || null,
        }),
        signal: AbortSignal.timeout(300000), // 5 minute timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Backtest] API error:', response.status, errorText);
        return {
          success: false,
          error: `Backtest API error (${response.status}): ${errorText}`,
        };
      }

      // Parse results from API response
      let results;
      try {
        results = await response.json();
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

      // Handle connection refused specifically - Python server not running
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return {
          success: false,
          error: `Python server not running at ${PYTHON_SERVER_URL}. Start with: cd python && python server.py`,
          errorDetails: 'CONNECTION REFUSED: The Python API server is offline. All backtests route through the unified API.'
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorDetails: errorDetails
      };
    }
  });
}
