/**
 * FUTU 原生数据提供者（港美股）
 * 
 * 特点：
 * - ✅ 港美股市场覆盖
 * - ✅ Level-1 实时行情
 * - ✅ 交易功能（账户、持仓、下单）
 * - ⚠️ 需要 FutuOpenD 运行
 */

import { RestDataProvider } from './base.js';
import type { Kline, KlineQuery } from '../types/kline.js';
import type { ProviderConfig, Exchange, AssetType } from '../types/common.js';
import { FutuNativeClient, QotMarket, KLType, RehabType, TrdEnv } from '../../../futu-trader/src/native-client/FutuNativeClient.js';

export interface FutuProviderConfig extends Partial<ProviderConfig> {
  /** FutuOpenD 地址 */
  host?: string;
  
  /** FutuOpenD 端口 */
  port?: number;
  
  /** 复权类型（0=不复权，1=前复权，2=后复权） */
  rehabType?: RehabType;
}

/**
 * 符号格式转换工具
 */
export class SymbolConverter {
  /**
   * Quant-Lib 格式 → FUTU 格式
   * 例如：700/HKD → { market: 1, code: "00700" }
   */
  static toFutu(symbol: string): { market: QotMarket; code: string } {
    const [baseCurrency, quoteCurrency] = symbol.split('/');
    
    // 去除前导零，获取纯数字
    const numericCode = baseCurrency.replace(/^0+/, '');
    
    // 根据计价货币判断市场
    let market: QotMarket;
    let code: string;
    
    if (quoteCurrency === 'HKD') {
      market = QotMarket.HK_Security;
      // 港股代码补齐到5位（前导零）
      code = numericCode.padStart(5, '0');
    } else if (quoteCurrency === 'USD') {
      market = QotMarket.US_Security;
      // 美股直接使用代码（字母）
      code = baseCurrency;
    } else if (quoteCurrency === 'CNY' || quoteCurrency === 'CNH') {
      // A股：6/9开头=沪市，0/3开头=深市，688开头=科创板（沪市）
      if (numericCode.startsWith('6') || numericCode.startsWith('9') || numericCode.startsWith('688')) {
        market = QotMarket.CNSH_Security; // 21
      } else {
        market = QotMarket.CNSZ_Security; // 22
      }
      code = numericCode.padStart(6, '0');
    } else {
      throw new Error(`Unsupported quote currency: ${quoteCurrency}`);
    }
    
    return { market, code };
  }
  
  /**
   * FUTU 格式 → Quant-Lib 格式
   * 例如：{ market: 1, code: "00700" } → 700/HKD
   */
  static fromFutu(market: QotMarket, code: string): string {
    let quoteCurrency: string;
    let baseCurrency: string;
    
    switch (market) {
      case QotMarket.HK_Security:
        quoteCurrency = 'HKD';
        baseCurrency = code.replace(/^0+/, '') || '0'; // 去除前导零
        break;
      case QotMarket.US_Security:
        quoteCurrency = 'USD';
        baseCurrency = code; // 美股代码保持原样
        break;
      case QotMarket.CNSH_Security:
      case QotMarket.CNSZ_Security:
        quoteCurrency = 'CNY';
        baseCurrency = code.replace(/^0+/, '') || '0';
        break;
      default:
        throw new Error(`Unsupported market: ${market}`);
    }
    
    return `${baseCurrency}/${quoteCurrency}`;
  }
}

/**
 * 时间周期映射
 */
class IntervalMapper {
  private static readonly MAP: Record<string, KLType> = {
    '1m': KLType._1Min,
    '3m': KLType._3Min,
    '5m': KLType._5Min,
    '15m': KLType._15Min,
    '30m': KLType._30Min,
    '1h': KLType._60Min,
    '1d': KLType.Day,
    '1w': KLType.Week,
    '1M': KLType.Month,
  };
  
  static toFutu(interval: string): KLType {
    const klType = this.MAP[interval];
    if (!klType) {
      throw new Error(`Unsupported interval: ${interval}, supported: ${Object.keys(this.MAP).join(', ')}`);
    }
    return klType;
  }
}

export class FutuProvider extends RestDataProvider {
  private client: FutuNativeClient;
  private rehabType: RehabType;
  
  constructor(config: FutuProviderConfig = {}) {
    super({
      name: 'FUTU',
      ...config
    });
    
    this.client = new FutuNativeClient({
      host: config.host || '127.0.0.1',
      port: config.port || 11111,
      reconnect: true,
    });
    
    this.rehabType = config.rehabType ?? RehabType.Forward; // 默认前复权
  }
  
  get name(): string {
    return 'FUTU';
  }
  
  get supportedExchanges(): Exchange[] {
    return ['HKEX', 'NYSE', 'NASDAQ', 'SSE', 'SZSE'];
  }
  
  get supportedAssetTypes(): AssetType[] {
    return ['STOCK'];
  }
  
  /**
   * 连接到 FutuOpenD
   */
  async connect(): Promise<void> {
    await this.client.connect();
    this.isConnected = true;
    this.emit('connected');
    console.log(`  ✅ ${this.name} 已连接`);
  }
  
  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.isConnected = false;
    this.emit('disconnected');
    console.log(`  👋 ${this.name} 已断开`);
  }
  
  /**
   * 获取 K线数据
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    const { symbol, interval, limit = 100, startTime, endTime } = query;
    
    // 1. 符号转换
    const { market, code } = SymbolConverter.toFutu(symbol);
    
    // 2. 时间周期转换
    const klType = IntervalMapper.toFutu(interval);
    
    // 3. 时间范围
    const now = new Date();
    const end = endTime ? new Date(endTime * 1000) : now;
    const start = startTime 
      ? new Date(startTime * 1000)
      : new Date(end.getTime() - 365 * 24 * 60 * 60 * 1000); // 默认1年前
    
    // 4. 格式化时间（YYYY-MM-DD HH:MM:SS）
    const formatTime = (date: Date) => {
      return date.toISOString().replace('T', ' ').substring(0, 19);
    };
    
    // 5. 调用原生客户端
    const futuKlines = await this.client.getHistoryKLine({
      market,
      code,
      klType,
      rehabType: this.rehabType,
      beginTime: formatTime(start),
      endTime: formatTime(end),
      maxCount: limit,
    });
    
    // 6. 转换为标准格式
    return futuKlines.map(kl => ({
      symbol,
      exchange: this.getExchange(market),
      baseCurrency: symbol.split('/')[0],
      quoteCurrency: symbol.split('/')[1],
      interval,
      timestamp: Math.floor(new Date(kl.time).getTime() / 1000),
      open: kl.open,
      high: kl.high,
      low: kl.low,
      close: kl.close,
      volume: kl.volume,
      quoteVolume: kl.turnover,
      tradeCount: null,
    }));
  }
  
  /**
   * 获取交易所名称
   */
  private getExchange(market: QotMarket): Exchange {
    switch (market) {
      case QotMarket.HK_Security:
        return 'HKEX';
      case QotMarket.US_Security:
        return 'NYSE'; // 默认NYSE，实际可能是NASDAQ
      case QotMarket.CNSH_Security:
        return 'SSE';
      case QotMarket.CNSZ_Security:
        return 'SZSE';
      default:
        return 'UNKNOWN' as Exchange;
    }
  }
  
  // ========================================
  // 扩展功能：交易相关（超出 quant-lib 接口）
  // ========================================
  
  /**
   * 获取账户列表
   */
  async getAccounts() {
    return this.client.getAccountList();
  }
  
  /**
   * 获取账户资金
   */
  async getFunds(params: { trdEnv: TrdEnv; accID: string; trdMarket: number }) {
    return this.client.getFunds(params);
  }
  
  /**
   * 获取持仓列表
   */
  async getPositions(params: { trdEnv: TrdEnv; accID: string; trdMarket: number }) {
    return this.client.getPositions(params);
  }
  
  /**
   * 下单
   */
  async placeOrder(params: any) {
    return this.client.placeOrder(params);
  }
}
