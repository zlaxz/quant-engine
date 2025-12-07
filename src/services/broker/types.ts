/**
 * Broker Service Types
 * Common interfaces for broker integrations
 */

// Account
export interface Account {
  id: string;
  name: string;
  type: 'margin' | 'cash' | 'ira';
  buyingPower: number;
  cashBalance: number;
  portfolioValue: number;
  dayTradingBuyingPower?: number;
}

// Positions
export interface Position {
  symbol: string;
  quantity: number;
  averageCost: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  assetType: 'equity' | 'option' | 'future' | 'crypto';
  // Options-specific
  optionType?: 'call' | 'put';
  strikePrice?: number;
  expirationDate?: string;
  // Greeks (from ThetaData)
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

// Orders
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop-limit';
export type OrderStatus = 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok';

export interface OrderRequest {
  symbol: string;
  quantity: number;
  side: OrderSide;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: TimeInForce;
  // Options-specific
  optionSymbol?: string;
  positionEffect?: 'open' | 'close';
}

export interface Order {
  id: string;
  symbol: string;
  quantity: number;
  filledQuantity: number;
  side: OrderSide;
  orderType: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  status: OrderStatus;
  timeInForce: TimeInForce;
  createdAt: Date;
  filledAt?: Date;
  averageFillPrice?: number;
}

// Quotes
export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

// Option Chain
export interface OptionContract {
  symbol: string; // OCC format
  underlying: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number;
  expirations: string[];
  strikes: number[];
  calls: OptionContract[];
  puts: OptionContract[];
}

// Broker Interface
export interface BrokerInterface {
  // Connection
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Account
  getAccount(): Promise<Account>;
  getPositions(): Promise<Position[]>;
  getBuyingPower(): Promise<number>;

  // Orders
  placeOrder(order: OrderRequest): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getOrders(status?: OrderStatus): Promise<Order[]>;
  getOrder(orderId: string): Promise<Order>;

  // Market Data
  getQuote(symbol: string): Promise<Quote>;
  getOptionChain(underlying: string, expiration?: string): Promise<OptionChain>;

  // Streaming
  subscribeQuotes(symbols: string[], callback: (quote: Quote) => void): () => void;
  subscribeOrders(callback: (order: Order) => void): () => void;
  subscribePositions(callback: (positions: Position[]) => void): () => void;
}

// Broker Status
export interface BrokerStatus {
  connected: boolean;
  broker: 'schwab' | 'thetadata' | 'none';
  accountId?: string;
  lastUpdate?: Date;
  error?: string;
}
