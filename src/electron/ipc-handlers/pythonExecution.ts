import { ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

const ROTATION_ENGINE_ROOT = process.env.ROTATION_ENGINE_ROOT || '/Users/zstoc/rotation-engine';

export function registerPythonExecutionHandlers() {
  ipcMain.handle('run-backtest', async (_event, params: {
    strategyKey: string;
    startDate: string;
    endDate: string;
    capital: number;
    profileConfig?: Record<string, any>;
  }) => {
    try {
      console.log('Running backtest:', params);

      // Build Python command using cli_wrapper.py
      const cmd = [
        'python3',
        'rotation-engine-bridge/cli_wrapper.py',
        '--strategy', params.strategyKey,
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
        console.error('Backtest failed:', stderr);
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
        console.error('Failed to parse Python output as JSON:', parseError);
        console.error('Raw stdout:', stdout);
        console.error('Raw stderr:', stderr);
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

      return {
        success: true,
        metrics: results.metrics,
        equityCurve: results.equity_curve,
        trades: results.trades,
        rawResultsPath: resultsPath,
      };
    } catch (error) {
      console.error('Error running backtest:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
