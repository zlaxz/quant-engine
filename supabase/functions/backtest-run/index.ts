import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BacktestRequest {
  sessionId: string;
  strategyKey: string;
  params: {
    startDate: string;
    endDate: string;
    capital: number;
  };
}

/**
 * Generate deterministic fake backtest results
 * This is Phase 3 stub logic - real Python engine comes in Phase 4
 */
function generateFakeResults(strategyKey: string, params: any) {
  const seed = strategyKey.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  // Deterministic "random" values based on strategy key
  const cagr = 0.08 + (seed % 20) / 100;
  const sharpe = 1.0 + (seed % 15) / 10;
  const maxDrawdown = -0.05 - (seed % 15) / 100;
  const winRate = 0.30 + (seed % 25) / 100;
  
  const metrics = {
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
  
  const equityCurve = [];
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

    // 2. Generate fake results (stub logic)
    console.log('[Backtest Run] Generating fake results...');
    const { metrics, equityCurve } = generateFakeResults(strategyKey, params);

    // 3. Update record with results
    console.log('[Backtest Run] Updating with results...');
    const { data: completedRun, error: updateError } = await supabase
      .from('backtest_runs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        metrics,
        equity_curve: equityCurve,
      })
      .eq('id', backtestRun.id)
      .select()
      .single();

    if (updateError) {
      console.error('[Backtest Run] Update error:', updateError);
      throw new Error(`Failed to update backtest run: ${updateError.message}`);
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
