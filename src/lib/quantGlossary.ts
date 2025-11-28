/**
 * Quantitative Trading Glossary
 * Simple definitions for complex concepts
 */

export interface GlossaryEntry {
  term: string
  definition: string
  analogy?: string
  example?: string
}

export const QUANT_GLOSSARY: Record<string, GlossaryEntry> = {
  // Market Structure
  regime: {
    term: "Market Regime",
    definition: "A distinct market environment characterized by specific volatility and trend patterns.",
    analogy: "Like weather patterns - some days are calm, some stormy, some catastrophic.",
    example: "Low volatility regime: VIX < 15, stable markets, good for selling options."
  },
  
  volatility: {
    term: "Volatility",
    definition: "How much prices move up and down. High volatility = big swings, low volatility = stable.",
    analogy: "Like driving on a bumpy road vs smooth highway.",
    example: "VIX at 40 = high volatility (scary times), VIX at 12 = low volatility (calm markets)."
  },

  // Performance Metrics
  sharpe: {
    term: "Sharpe Ratio",
    definition: "Risk-adjusted return. Measures how much return you get per unit of risk taken.",
    analogy: "Like miles per gallon for investments - higher is better efficiency.",
    example: "Sharpe 2.0 = excellent (2% return for every 1% of risk), Sharpe 0.5 = poor."
  },

  drawdown: {
    term: "Drawdown",
    definition: "The decline from a peak to a trough. How much money you lose before recovering.",
    analogy: "How deep underwater you go before swimming back to the surface.",
    example: "Peak $100k → bottom $70k = 30% drawdown. Recovery back to $100k ends the drawdown."
  },

  cagr: {
    term: "CAGR (Compound Annual Growth Rate)",
    definition: "Average yearly return, assuming gains are reinvested. The 'true' annual return.",
    analogy: "Like compound interest at a bank - money grows on money.",
    example: "15% CAGR means $100k grows to ~$115k per year on average over time."
  },

  // Greeks
  delta: {
    term: "Delta",
    definition: "How much the option price changes when the stock moves $1. Speed of price movement.",
    analogy: "Like your car's speedometer - shows how fast you're moving.",
    example: "Delta 0.50 = option moves $0.50 when stock moves $1. Delta 1.0 = moves dollar-for-dollar."
  },

  gamma: {
    term: "Gamma",
    definition: "How much delta changes when the stock moves. Acceleration of price movement.",
    analogy: "Like your car's acceleration - how quickly you speed up or slow down.",
    example: "High gamma = delta changes rapidly with price moves. Dangerous in fast markets."
  },

  vega: {
    term: "Vega",
    definition: "How much the option price changes when volatility changes 1%.",
    analogy: "Like fuel efficiency - some cars perform better in different conditions.",
    example: "Vega 0.20 = option gains $0.20 if implied volatility rises 1%. Long vega = want vol to rise."
  },

  theta: {
    term: "Theta",
    definition: "How much the option loses in value each day due to time decay.",
    analogy: "Like ice melting - options lose value as expiration approaches.",
    example: "Theta -0.10 = option loses $0.10 per day. Short options = collect theta daily."
  },

  // Strategy Concepts
  convexity: {
    term: "Convexity",
    definition: "Non-linear payoff profile. Small losses in normal times, huge gains in extreme moves.",
    analogy: "Like insurance - small premium payments, big payoff when disaster strikes.",
    example: "Long OTM puts: lose a little daily (theta), gain massively in crashes."
  },

  skew: {
    term: "Volatility Skew",
    definition: "Puts trade at higher implied volatility than calls. The market pays more for downside protection.",
    analogy: "Like earthquake insurance costing more than flood insurance in California.",
    example: "SPY 95% put IV = 22%, SPY 105% call IV = 18%. Skew = 22% - 18% = 4%."
  },

  overfitting: {
    term: "Overfitting",
    definition: "Strategy that works perfectly on historical data but fails in real trading. Too specific to the past.",
    analogy: "Like memorizing test answers instead of learning concepts. Fails on new questions.",
    example: "Strategy only works if entered at exactly 0.05 delta on Tuesdays = overfit."
  },

  lookahead: {
    term: "Look-Ahead Bias",
    definition: "Using future information in backtest that wouldn't be available in real trading. Cheating.",
    analogy: "Like knowing tomorrow's lottery numbers - impossible in real life.",
    example: "Using tomorrow's closing price to decide today's entry = look-ahead bias."
  },

  // Risk Concepts
  var: {
    term: "Value at Risk (VaR)",
    definition: "Maximum expected loss over a time period at a given confidence level.",
    analogy: "Like weather forecast: '95% chance rain won't exceed 2 inches.'",
    example: "VaR 95% = $10k means: 95% of days you won't lose more than $10k."
  },

  kelly: {
    term: "Kelly Criterion",
    definition: "Optimal bet sizing formula. Balances growth with risk of ruin.",
    analogy: "Don't bet the farm - bet the right amount to grow steadily without blowing up.",
    example: "50% win rate, 2:1 payoff → Kelly = 25% of capital per bet."
  },

  // Data & Testing
  backtest: {
    term: "Backtest",
    definition: "Testing a strategy on historical data to see if it would have worked in the past.",
    analogy: "Like a practice exam using old test questions.",
    example: "Run strategy on 2018-2023 data to see returns, drawdowns, and win rate."
  },

  walk_forward: {
    term: "Walk-Forward Analysis",
    definition: "Testing strategy on one period, then testing on next period without re-optimization. Prevents overfitting.",
    analogy: "Learn on semester 1 material, test on semester 2 without peeking ahead.",
    example: "Optimize on 2020 data, test on 2021, then optimize 2021, test 2022..."
  },

  sample_size: {
    term: "Sample Size",
    definition: "Number of trades or data points. More = more confidence in results.",
    analogy: "Like polling - asking 10 people vs 1000 people for election prediction.",
    example: "50 trades = weak evidence, 500 trades = strong evidence, 5000 trades = very confident."
  },
}

export function getGlossaryEntry(term: string): GlossaryEntry | undefined {
  return QUANT_GLOSSARY[term.toLowerCase()]
}

export function searchGlossary(query: string): GlossaryEntry[] {
  const lowerQuery = query.toLowerCase()
  return Object.values(QUANT_GLOSSARY).filter(
    entry =>
      entry.term.toLowerCase().includes(lowerQuery) ||
      entry.definition.toLowerCase().includes(lowerQuery)
  )
}
