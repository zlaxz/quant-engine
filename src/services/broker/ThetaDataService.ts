/**
 * ThetaData Service
 * Real-time options Greeks and market data
 *
 * ThetaData provides high-quality options data including:
 * - Real-time Greeks (delta, gamma, theta, vega, rho)
 * - Second-order Greeks (charm, vanna, vomma)
 * - IV surfaces and term structure
 * - Historical options data
 *
 * Prerequisites:
 * - ThetaData subscription
 * - API key from thetadata.net
 *
 * Environment Variables:
 * - THETADATA_API_KEY
 */

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  // Second-order
  charm?: number;
  vanna?: number;
  vomma?: number;
  // Additional
  iv: number;
  theoreticalPrice: number;
  timestamp: Date;
}

export interface OptionQuote {
  symbol: string;
  underlying: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks: Greeks;
}

export interface IVPoint {
  strike: number;
  expiration: string;
  iv: number;
  delta: number;
}

export interface IVSurface {
  underlying: string;
  underlyingPrice: number;
  points: IVPoint[];
  timestamp: Date;
}

interface ThetaDataConfig {
  apiKey: string;
}

export class ThetaDataService {
  private config: ThetaDataConfig | null = null;
  private connected = false;

  constructor(config?: ThetaDataConfig) {
    if (config) {
      this.config = config;
    }
  }

  async connect(): Promise<void> {
    if (!this.config) {
      this.config = {
        apiKey: process.env.THETADATA_API_KEY || '',
      };
    }

    if (!this.config.apiKey) {
      console.warn('[ThetaData] No API key configured. Using stub data.');
    }

    this.connected = true;
    console.log('[ThetaData] Connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('[ThetaData] Disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ============================================================================
  // Real-time Greeks
  // ============================================================================

  async getGreeks(
    underlying: string,
    expiry: string,
    strike: number,
    right: 'C' | 'P'
  ): Promise<Greeks> {
    // TODO: Implement actual API call to ThetaData
    // For now, return realistic stub data

    const baseIV = 0.20 + Math.random() * 0.15; // 20-35% IV
    const dte = this.calculateDTE(expiry);
    const atm = underlying === 'SPY' ? 598 : 100;
    const moneyness = (strike - atm) / atm;

    // Approximate Greeks based on Black-Scholes relationships
    const delta = right === 'C'
      ? 0.5 + moneyness * -2 + Math.random() * 0.1
      : -0.5 + moneyness * -2 + Math.random() * 0.1;

    return {
      delta: Math.max(-1, Math.min(1, delta)),
      gamma: 0.02 * Math.exp(-moneyness * moneyness * 10),
      theta: -0.05 * (30 / Math.max(dte, 1)),
      vega: 0.15 * Math.sqrt(dte / 30),
      rho: 0.01 * (right === 'C' ? 1 : -1),
      charm: -0.002,
      vanna: 0.01,
      vomma: 0.005,
      iv: baseIV,
      theoreticalPrice: 2.50 + Math.random() * 2,
      timestamp: new Date(),
    };
  }

  async getOptionQuote(
    underlying: string,
    expiry: string,
    strike: number,
    right: 'C' | 'P'
  ): Promise<OptionQuote> {
    const greeks = await this.getGreeks(underlying, expiry, strike, right);

    return {
      symbol: `${underlying}${expiry.replace(/-/g, '')}${right}${strike.toString().padStart(8, '0')}`,
      underlying,
      type: right === 'C' ? 'call' : 'put',
      strike,
      expiration: expiry,
      bid: greeks.theoreticalPrice - 0.05,
      ask: greeks.theoreticalPrice + 0.05,
      last: greeks.theoreticalPrice,
      volume: Math.floor(Math.random() * 5000),
      openInterest: Math.floor(Math.random() * 50000),
      greeks,
    };
  }

  // ============================================================================
  // IV Surface
  // ============================================================================

  async getIVSurface(underlying: string): Promise<IVSurface> {
    // TODO: Implement actual API call
    // For now, generate a realistic IV surface

    const atm = underlying === 'SPY' ? 598 : 100;
    const expirations = ['2024-01-19', '2024-02-16', '2024-03-15', '2024-06-21'];
    const strikes = [-0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.1].map(m => atm * (1 + m));

    const points: IVPoint[] = [];

    for (const expiry of expirations) {
      const dte = this.calculateDTE(expiry);
      for (const strike of strikes) {
        const moneyness = (strike - atm) / atm;
        // Volatility smile: higher IV for OTM options
        const baseIV = 0.18 + dte / 365 * 0.05;
        const smile = Math.abs(moneyness) * 0.3;
        const skew = moneyness < 0 ? Math.abs(moneyness) * 0.15 : 0;

        points.push({
          strike,
          expiration: expiry,
          iv: baseIV + smile + skew,
          delta: 0.5 - moneyness * 2,
        });
      }
    }

    return {
      underlying,
      underlyingPrice: atm,
      points,
      timestamp: new Date(),
    };
  }

  // ============================================================================
  // Streaming
  // ============================================================================

  subscribeGreeks(
    contracts: string[],
    callback: (quote: OptionQuote) => void
  ): () => void {
    console.log('[ThetaData] Subscribing to Greeks:', contracts);

    // TODO: Implement WebSocket streaming
    // For now, simulate with interval updates
    const interval = setInterval(async () => {
      for (const contract of contracts) {
        // Parse contract symbol and get quote
        // This is a stub - real implementation would parse OCC symbol
        const quote = await this.getOptionQuote('SPY', '2024-01-19', 600, 'C');
        callback(quote);
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      console.log('[ThetaData] Unsubscribed from Greeks');
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private calculateDTE(expiry: string): number {
    const expiryDate = new Date(expiry);
    const today = new Date();
    const diff = expiryDate.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }
}

export default ThetaDataService;
