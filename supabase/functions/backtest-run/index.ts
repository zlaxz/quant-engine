import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Type definitions matching frontend src/types/backtest.ts
 * These ensure consistency across the entire backtest pipeline
 */

interface BacktestParams {
  startDate: string;        // 'YYYY-MM-DD' format
  endDate: string;          // 'YYYY-MM-DD' format
  capital: number;          // Starting capital in USD
  profileConfig?: Record<string, any>;  // Optional rotation-engine profile config
}

interface BacktestMetrics {
  cagr: number;                      // Compound Annual Growth Rate (decimal, e.g., 0.18 = 18%)
  sharpe: number;                    // Sharpe Ratio
  max_drawdown: number;              // Maximum Drawdown (decimal, e.g., -0.095 = -9.5%)
  win_rate: number;                  // Win Rate (decimal, e.g., 0.62 = 62%)
  total_trades: number;              // Total number of trades executed
  avg_trade_duration_days?: number;  // Average trade duration in days (optional)
  [key: string]: any;                // Allow future metric extensions
}

interface EquityPoint {
  date: string;   // 'YYYY-MM-DD' format
  value: number;  // Portfolio value in USD
}

interface BacktestRequest {
  sessionId: string;
  strategyKey: string;
  params: BacktestParams;
}

interface ExternalEngineResponse {
  metrics: BacktestMetrics;
  equity_curve: EquityPoint[];
}

/**
 * Generate deterministic fake backtest results
 * This is the fallback stub when external engine is unavailable
 * Returns data matching BacktestMetrics and EquityPoint[] types
 */
function generateFakeResults(strategyKey: string, params: BacktestParams): { metrics: BacktestMetrics; equityCurve: EquityPoint[] } {
  const seed = strategyKey.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  // Deterministic "random" values based on strategy key
  const cagr = 0.08 + (seed % 20) / 100;
  const sharpe = 1.0 + (seed % 15) / 10;
  const maxDrawdown = -0.05 - (seed % 15) / 100;
  const winRate = 0.30 + (seed % 25) / 100;
  
  const metrics: BacktestMetrics = {
    cagr,
    sharpe,
    max_drawdown: maxDrawdown,
    win_rate: winRate,
    total_trades: 120 + (seed % 80),
    avg_trade_duration_days: 3 + (seed % 10),
  };
  
  // Generate equity curve (100 points)
  const startDate = new Date(params.startDate);
  const endDate = new Date(params.endDate);
  const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const step = Math.max(1, Math.floor(daysDiff / 100));
  
  const equityCurve: EquityPoint[] = [];
  let currentValue = params.capital;
  
  for (let i = 0; i <= 100; i++) {
    const date = new Date(startDate.getTime() + (i * step * 24 * 60 * 60 * 1000));
    // Simulate growth with some volatility
    const drift = cagr / 100;
    const noise = (Math.sin(i + seed) * 0.02);
    currentValue = currentValue * (1 + drift + noise);
    
    equityCurve.push({
      date: date.toISOString().split('T')[0],
      value: Math.round(currentValue * 100) / 100,
    });
  }
  
  return { metrics, equityCurve };
}

/**
 * Try local bridge server first, then fall back to configured external engine
 * The bridge server runs on localhost:8080 and executes rotation-engine Python code
 * Returns null if no engines are available or all calls fail
 * Validates response structure to match BacktestMetrics and EquityPoint[] types
 */
async function callExternalEngine(
  strategyKey: string,
  params: BacktestParams
): Promise<{ metrics: BacktestMetrics; equityCurve: EquityPoint[]; engineSource: string; trades?: any[] } | null> {
  
  // 1. Try local bridge server first
  const bridgeUrl = Deno.env.get('BRIDGE_SERVER_URL');
  if (!bridgeUrl) {
    console.log('[Bridge] BRIDGE_SERVER_URL not configured, skipping bridge server attempt');
    return null;
  }
  console.log(`[Bridge] Attempting to connect to bridge server at ${bridgeUrl}...`);
  
  try {
    const bridgeResponse = await fetch(`${bridgeUrl}/backtest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy_key: strategyKey,
        params: params
      }),
      signal: AbortSignal.timeout(300000), // 5 minute timeout for Python execution
    });
    
    if (bridgeResponse.ok) {
      const bridgeData = await bridgeResponse.json();
      
      if (bridgeData.success) {
        console.log('[Bridge] ✅ Bridge execution successful');
        
        // Validate bridge response
        if (!bridgeData.metrics || !bridgeData.equity_curve) {
          console.error('[Bridge] Invalid response - missing metrics or equity_curve');
        } else {
          return {
            metrics: bridgeData.metrics,
            equityCurve: bridgeData.equity_curve,
            engineSource: 'rotation-engine-bridge',
            trades: bridgeData.trades || []
          };
        }
      } else {
        console.error('[Bridge] Bridge execution failed:', bridgeData.error);
      }
    } else {
      console.log('[Bridge] Bridge server returned non-200:', bridgeResponse.status);
    }
  } catch (bridgeError: any) {
    console.log('[Bridge] Bridge connection failed:', bridgeError.message);
  }
  
  // 2. Fall back to BACKTEST_ENGINE_URL if configured
  const engineUrl = Deno.env.get('BACKTEST_ENGINE_URL');
  
  if (!engineUrl || engineUrl.trim() === '') {
    console.log('[External Engine] No external engine configured, using stub');
    return null;
  }

  console.log('[External Engine] Attempting to call configured engine:', engineUrl);

  try {
    const response = await fetch(`${engineUrl}/run-backtest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        strategyKey,
        params,
      }),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    if (!response.ok) {
      console.error('[External Engine] Non-2xx response:', response.status, response.statusText);
      return null;
    }

    const data: ExternalEngineResponse = await response.json();

    // Validate response structure
    if (!data.metrics || !data.equity_curve) {
      console.error('[External Engine] Invalid response structure - missing metrics or equity_curve');
      return null;
    }

    // Validate metrics fields (required fields)
    const requiredMetrics = ['cagr', 'sharpe', 'max_drawdown', 'win_rate', 'total_trades'];
    const missingMetrics = requiredMetrics.filter(key => !(key in data.metrics));
    
    if (missingMetrics.length > 0) {
      console.error('[External Engine] Missing required metrics:', missingMetrics);
      return null;
    }

    // Validate equity_curve structure
    if (!Array.isArray(data.equity_curve) || data.equity_curve.length === 0) {
      console.error('[External Engine] equity_curve must be a non-empty array');
      return null;
    }

    // Validate first equity point structure
    const firstPoint = data.equity_curve[0];
    if (!firstPoint.date || typeof firstPoint.value !== 'number') {
      console.error('[External Engine] Invalid equity_curve point structure');
      return null;
    }

    console.log('[External Engine] Successfully received valid results');
    
    return {
      metrics: data.metrics,
      equityCurve: data.equity_curve,
      engineSource: 'external',
    };
  } catch (error: any) {
    console.error('[External Engine] Call failed:', error.message);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sessionId, strategyKey, params }: BacktestRequest = await req.json();
    
    console.log('[Backtest Run] Request received:', { sessionId, strategyKey, params });

    // Validation
    if (!sessionId || !strategyKey || !params) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: sessionId, strategyKey, or params' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Create backtest_run record with "running" status
    console.log('[Backtest Run] Creating backtest_runs record...');
    const { data: backtestRun, error: insertError } = await supabase
      .from('backtest_runs')
      .insert({
        session_id: sessionId,
        strategy_key: strategyKey,
        params,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Backtest Run] Insert error:', insertError);
      throw new Error(`Failed to create backtest run: ${insertError.message}`);
    }

    console.log('[Backtest Run] Created run:', backtestRun.id);

    // 2. Try bridge → external engine → stub fallback
    let metrics, equityCurve, engineSource, trades;

    const externalResult = await callExternalEngine(strategyKey, params);
    
    if (externalResult) {
      // Bridge or external engine succeeded
      metrics = externalResult.metrics;
      equityCurve = externalResult.equityCurve;
      engineSource = externalResult.engineSource;
      trades = externalResult.trades || [];
      console.log('[Backtest Run] Using results from:', engineSource);
    } else {
      // Fall back to stub
      console.log('[Backtest Run] All engines unavailable, using stub');
      engineSource = 'stub_fallback';
      
      const stubResults = generateFakeResults(strategyKey, params);
      metrics = stubResults.metrics;
      equityCurve = stubResults.equityCurve;
      trades = [];
    }

    // 3. Update record with results
    console.log('[Backtest Run] Updating with results, engine source:', engineSource);
    const { data: completedRun, error: updateError } = await supabase
      .from('backtest_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        metrics,
        equity_curve: equityCurve,
        engine_source: engineSource,
      })
      .eq('id', backtestRun.id)
      .select()
      .single();

    if (updateError) {
      console.error('[Backtest Run] Update error:', updateError);
      throw new Error(`Failed to update backtest run: ${updateError.message}`);
    }

    // 4. Save full results locally for Phase 6 data inspection
    const rotationEngineRoot = Deno.env.get('ROTATION_ENGINE_ROOT');
    if (rotationEngineRoot && rotationEngineRoot.trim() !== '') {
      try {
        const resultsDir = `${rotationEngineRoot}/data/backtest_results/runs`;
        
        // Ensure directory exists
        try {
          await Deno.mkdir(resultsDir, { recursive: true });
        } catch (mkdirError: any) {
          // Ignore if directory already exists
          if (mkdirError.name !== 'AlreadyExists') {
            throw mkdirError;
          }
        }
        
        // Save full results including trades
        const fullResults = {
          run_id: backtestRun.id,
          strategy_key: strategyKey,
          params,
          metrics,
          equity_curve: equityCurve,
          trades: trades || [],
          engine_source: engineSource,
          created_at: completedRun.completed_at
        };
        
        const resultsPath = `${resultsDir}/${backtestRun.id}.json`;
        await Deno.writeTextFile(resultsPath, JSON.stringify(fullResults, null, 2));
        console.log('[Backtest Run] Saved full results to:', resultsPath);
        
      } catch (saveError: any) {
        console.error('[Backtest Run] Failed to save full results locally:', saveError.message);
        // Non-critical - don't fail the backtest if local save fails
      }
    }

    console.log('[Backtest Run] Backtest completed successfully');

    return new Response(
      JSON.stringify(completedRun),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Backtest Run] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
