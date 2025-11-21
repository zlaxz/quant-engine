/**
 * Data Inspection Operations - Market data and trade log inspection
 * Phase 6: Data Access & Inspection
 */

interface MarketDataRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  [key: string]: any;
}

interface Trade {
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  hold_days: number;
  exit_reason?: string;
  size?: number;
  [key: string]: any;
}

interface BacktestResults {
  metrics: Record<string, any>;
  equity_curve: Array<{ date: string; value: number }>;
  trades: Trade[];
  run_id: string;
  strategy_key: string;
  params: Record<string, any>;
}

/**
 * Inspect raw market data from local Polygon CSV.gz files
 */
export async function inspectMarketData(
  symbol: string,
  startDate: string,
  endDate: string,
  engineRoot: string
): Promise<{ success: boolean; data?: MarketDataRow[]; error?: string; summary?: string }> {
  try {
    // Validation
    if (!symbol || symbol.trim() === '') {
      return { success: false, error: 'Symbol is required' };
    }
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, error: 'Invalid date format. Use YYYY-MM-DD' };
    }
    
    if (start >= end) {
      return { success: false, error: 'Start date must be before end date' };
    }
    
    // FIXED: Make data path configurable via environment variable
    // Supports both local testing and production Polygon data volumes
    const marketDataRoot = Deno.env.get('MARKET_DATA_ROOT') || `${engineRoot}/data/market_data`;
    const dataPath = `${marketDataRoot}/${symbol.toUpperCase()}.csv`;
    
    try {
      const content = await Deno.readTextFile(dataPath);
      const lines = content.trim().split('\n');
      
      if (lines.length === 0) {
        return { success: false, error: 'Empty data file' };
      }
      
      const header = lines[0].split(',').map(h => h.trim());
      const data: MarketDataRow[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: any = {};
        
        header.forEach((h, idx) => {
          const value = values[idx];
          // Try to parse as number, fallback to string
          row[h] = isNaN(Number(value)) ? value : Number(value);
        });
        
        // Filter by date range
        const rowDate = new Date(row.date);
        if (rowDate >= start && rowDate <= end) {
          data.push(row);
        }
      }
      
      const summary = `Found ${data.length} rows for ${symbol} from ${startDate} to ${endDate}`;
      
      return { success: true, data, summary };
      
    } catch (fileError: any) {
      if (fileError.name === 'NotFound') {
        return {
          success: false,
          error: `Market data file not found: ${dataPath}. 

SETUP REQUIRED:
1. Set MARKET_DATA_ROOT environment variable to your Polygon data directory
   Example: export MARKET_DATA_ROOT=/Volumes/VelocityData/polygon_downloads
2. Ensure data files are accessible at: \${MARKET_DATA_ROOT}/${symbol.toUpperCase()}.csv
3. Current search path: ${dataPath}

For local testing, create ${engineRoot}/data/market_data/ and place CSV files there.`
        };
      }
      throw fileError;
    }
    
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to inspect market data: ${error.message}`
    };
  }
}

/**
 * Validate data quality - check for missing bars, outliers, price consistency
 */
export async function checkDataQuality(
  symbol: string,
  startDate: string,
  endDate: string,
  engineRoot: string
): Promise<{ success: boolean; issues?: string[]; summary?: string; error?: string }> {
  try {
    // First, get the market data
    const result = await inspectMarketData(symbol, startDate, endDate, engineRoot);
    
    if (!result.success || !result.data) {
      return { success: false, error: result.error };
    }
    
    const data = result.data;
    const issues: string[] = [];
    
    // Check 1: Missing bars (gaps in dates)
    if (data.length > 1) {
      for (let i = 1; i < data.length; i++) {
        const prev = new Date(data[i - 1].date);
        const curr = new Date(data[i].date);
        const daysDiff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        
        // If more than 7 days gap (accounting for weekends), flag it
        if (daysDiff > 7) {
          issues.push(`Gap detected: ${data[i - 1].date} to ${data[i].date} (${Math.floor(daysDiff)} days)`);
        }
      }
    }
    
    // Check 2: Price outliers (prices that jump more than 20% in a day)
    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1];
      const curr = data[i];
      
      if (prev.close && curr.open) {
        const change = Math.abs((curr.open - prev.close) / prev.close);
        if (change > 0.20) {
          issues.push(`Large price jump on ${curr.date}: ${(change * 100).toFixed(1)}% from previous close`);
        }
      }
      
      // Check for negative prices
      if (curr.open < 0 || curr.high < 0 || curr.low < 0 || curr.close < 0) {
        issues.push(`Negative price detected on ${curr.date}`);
      }
      
      // Check OHLC consistency (high >= open/close, low <= open/close)
      if (curr.high && curr.low && curr.open && curr.close) {
        if (curr.high < curr.open || curr.high < curr.close) {
          issues.push(`Invalid OHLC on ${curr.date}: high < open/close`);
        }
        if (curr.low > curr.open || curr.low > curr.close) {
          issues.push(`Invalid OHLC on ${curr.date}: low > open/close`);
        }
      }
    }
    
    // Check 3: Missing required fields
    const requiredFields = ['date', 'open', 'high', 'low', 'close'];
    for (const row of data) {
      const missing = requiredFields.filter(f => row[f] === undefined || row[f] === null);
      if (missing.length > 0) {
        issues.push(`Missing fields on ${row.date || 'unknown date'}: ${missing.join(', ')}`);
        break; // Only report once
      }
    }
    
    const summary = issues.length === 0
      ? `Data quality check passed: ${data.length} bars, no issues detected`
      : `Data quality check found ${issues.length} issue(s) in ${data.length} bars`;
    
    return { success: true, issues, summary };
    
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to check data quality: ${error.message}`
    };
  }
}

/**
 * Get trade log from backtest results
 */
export async function getTradeLog(
  runId: string,
  engineRoot: string
): Promise<{ success: boolean; trades?: Trade[]; summary?: string; error?: string; metadata?: Record<string, any> }> {
  try {
    // Read backtest results from local file
    const resultsPath = `${engineRoot}/data/backtest_results/runs/${runId}.json`;
    
    try {
      const content = await Deno.readTextFile(resultsPath);
      const results: BacktestResults = JSON.parse(content);
      
      if (!results.trades || !Array.isArray(results.trades)) {
        return {
          success: false,
          error: 'No trades found in backtest results. Ensure backtest-run saves full results with trade logs.'
        };
      }
      
      const summary = `Found ${results.trades.length} trades for run ${runId} (${results.strategy_key})`;
      
      return {
        success: true,
        trades: results.trades,
        summary,
        metadata: {
          strategy_key: results.strategy_key,
          params: results.params,
          metrics: results.metrics
        }
      };
      
    } catch (fileError: any) {
      if (fileError.name === 'NotFound') {
        return {
          success: false,
          error: `Backtest results not found: ${resultsPath}. Ensure backtest-run saves full results locally.`
        };
      }
      throw fileError;
    }
    
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get trade log: ${error.message}`
    };
  }
}

/**
 * Get detailed analysis of a specific trade
 */
export async function getTradeDetail(
  runId: string,
  tradeIdx: number,
  engineRoot: string
): Promise<{ success: boolean; trade?: Trade; context?: string; error?: string }> {
  try {
    // First get the trade log
    const logResult = await getTradeLog(runId, engineRoot);
    
    if (!logResult.success || !logResult.trades) {
      return { success: false, error: logResult.error };
    }
    
    const trades = logResult.trades;
    
    if (tradeIdx < 0 || tradeIdx >= trades.length) {
      return {
        success: false,
        error: `Invalid trade index ${tradeIdx}. Run has ${trades.length} trades (0-${trades.length - 1})`
      };
    }
    
    const trade = trades[tradeIdx];
    
    // Build context string with trade details
    const context = `
Trade #${tradeIdx + 1} of ${trades.length}

Entry: ${trade.entry_date} @ $${trade.entry_price.toFixed(2)}
Exit:  ${trade.exit_date} @ $${trade.exit_price.toFixed(2)}

P&L: $${trade.pnl.toFixed(2)} (${(trade.pnl_pct * 100).toFixed(2)}%)
Hold Duration: ${trade.hold_days} days
${trade.exit_reason ? `Exit Reason: ${trade.exit_reason}` : ''}
${trade.size ? `Position Size: ${trade.size}` : ''}

Additional Data:
${JSON.stringify(trade, null, 2)}
    `.trim();
    
    return {
      success: true,
      trade,
      context
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to get trade detail: ${error.message}`
    };
  }
}
