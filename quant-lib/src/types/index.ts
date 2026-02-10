/**
 * Types Module
 * 
 * Unified type definitions for Quant-Lib
 */

// Common types
export * from './common';

// Kline types
export * from './kline';

// Additional types from core
export type ExchangeName = 'bybit' | 'binance' | 'okx';
export type AccountType = 'UNIFIED' | 'CONTRACT' | 'SPOT';

export interface ExchangeCredentials {
  key: string;
  secret: string;
  passphrase?: string;
}

export interface ExchangeConfig {
  name: string;
  credentials: ExchangeCredentials;
  proxy?: string;
  testnet?: boolean;
  timeout?: number;
}

export type OrderSide = 'Buy' | 'Sell';
export type OrderType = 'Market' | 'Limit';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export interface Order {
  orderId?: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  qty: string;
  price?: string;
  timeInForce?: TimeInForce;
  reduceOnly?: boolean;
}

export interface Position {
  symbol: string;
  side: OrderSide;
  size: number;
  entryPrice: number;
  leverage?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
}

export interface Balance {
  asset: string;
  walletBalance: number;
  availableBalance: number;
  unrealizedPnl?: number;
  totalEquity?: number;
}

export interface DataProvider {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getKlines(query: any): Promise<any[]>;
  isConnected(): boolean;
}

export interface ExchangeProvider extends DataProvider {
  placeOrder(order: Order): Promise<any>;
  cancelOrder(symbol: string, orderId: string): Promise<any>;
  getOrders(symbol?: string): Promise<Order[]>;
  getPositions(symbol?: string): Promise<Position[]>;
  getBalance(accountType?: AccountType): Promise<Balance[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
