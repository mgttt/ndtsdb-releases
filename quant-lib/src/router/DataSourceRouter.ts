/**
 * 数据源智能路由器
 * 
 * 功能：
 * 1. 根据资产类型自动选择最优数据源
 * 2. 节省 FUTU API 额度（加密货币用 Binance，美股大盘用 TradingView）
 * 3. 统一查询接口
 * 
 * 使用：
 * ```typescript
 * const router = new DataSourceRouter({
 *   binance: binanceProvider,
 *   tradingview: tvProvider,
 *   futu: futuProvider,
 * });
 * 
 * // 自动路由到合适的数据源
 * const klines = await router.getKlines({
 *   symbol: 'BTC/USDT',  // → Binance
 *   interval: '1d',
 *   limit: 100,
 * });
 * ```
 */

import type { RestDataProvider } from '../providers/base.js';
import type { KlineQuery, Kline } from '../types/kline.js';

export interface RouterProviders {
  /** Binance Provider（加密货币） */
  binance?: RestDataProvider;
  
  /** TradingView Provider（全市场） */
  tradingview?: RestDataProvider;
  
  /** FUTU Provider（港美股） */
  futu?: RestDataProvider;
}

export enum AssetCategory {
  /** 加密货币 */
  CRYPTO = 'CRYPTO',
  
  /** 美股主要股票（优先用 TradingView） */
  US_MAJOR = 'US_MAJOR',
  
  /** 港股 */
  HK_STOCK = 'HK_STOCK',
  
  /** 美股（其他） */
  US_STOCK = 'US_STOCK',
  
  /** A股 */
  CN_STOCK = 'CN_STOCK',
  
  /** 未知 */
  UNKNOWN = 'UNKNOWN',
}

export interface RouteStats {
  /** 各数据源使用次数 */
  usage: Record<string, number>;
  
  /** 各资产类型查询次数 */
  categories: Record<AssetCategory, number>;
  
  /** 节省的 FUTU 额度 */
  futuQuotaSaved: number;
}

export class DataSourceRouter {
  private providers: RouterProviders;
  private stats: RouteStats = {
    usage: {},
    categories: {} as Record<AssetCategory, number>,
    futuQuotaSaved: 0,
  };
  
  // 美股主要股票列表（优先用 TradingView，节省 FUTU 额度）
  private static readonly US_MAJOR_STOCKS = new Set([
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'BRK.B',
    'JPM', 'V', 'WMT', 'PG', 'MA', 'HD', 'DIS', 'BAC', 'NFLX', 'ADBE',
    'CRM', 'CSCO', 'PEP', 'KO', 'INTC', 'AMD', 'PYPL', 'CMCSA', 'TMO',
  ]);
  
  constructor(providers: RouterProviders) {
    this.providers = providers;
    
    // 初始化统计
    for (const category of Object.values(AssetCategory)) {
      this.stats.categories[category] = 0;
    }
  }
  
  /**
   * 智能获取 K线（自动路由）
   */
  async getKlines(query: KlineQuery): Promise<Kline[]> {
    const { symbol } = query;
    
    // 1. 检测资产类型
    const category = this.detectAssetCategory(symbol);
    
    // 2. 选择数据源
    const provider = this.selectProvider(category);
    
    if (!provider) {
      throw new Error(`No provider available for ${category}: ${symbol}`);
    }
    
    // 3. 更新统计
    this.updateStats(provider.name, category);
    
    // 4. 调用数据源
    console.log(`  🔀 路由: ${symbol} → ${provider.name} (${category})`);
    return provider.getKlines(query);
  }
  
  /**
   * 检测资产类别
   */
  private detectAssetCategory(symbol: string): AssetCategory {
    const [base, quote] = symbol.split('/');
    
    // 加密货币
    if (quote === 'USDT' || quote === 'BUSD' || quote === 'USDC') {
      return AssetCategory.CRYPTO;
    }
    
    // 港股（数字代码 + HKD）
    if (quote === 'HKD' && /^\d+$/.test(base)) {
      return AssetCategory.HK_STOCK;
    }
    
    // A股（数字代码 + CNY/CNH）
    if ((quote === 'CNY' || quote === 'CNH') && /^\d+$/.test(base)) {
      return AssetCategory.CN_STOCK;
    }
    
    // 美股
    if (quote === 'USD') {
      // 检查是否为主要股票
      const ticker = base.replace(/\d+/g, ''); // 去除数字（如 BRK.B）
      if (DataSourceRouter.US_MAJOR_STOCKS.has(ticker)) {
        return AssetCategory.US_MAJOR;
      }
      return AssetCategory.US_STOCK;
    }
    
    return AssetCategory.UNKNOWN;
  }
  
  /**
   * 选择数据源
   */
  private selectProvider(category: AssetCategory): RestDataProvider | null {
    switch (category) {
      case AssetCategory.CRYPTO:
        // 加密货币 → Binance（优先）
        return this.providers.binance || this.providers.tradingview || null;
      
      case AssetCategory.US_MAJOR:
        // 美股主要股票 → TradingView（节省 FUTU 额度）
        return this.providers.tradingview || this.providers.futu || null;
      
      case AssetCategory.HK_STOCK:
      case AssetCategory.US_STOCK:
      case AssetCategory.CN_STOCK:
        // 港美股 / A股 → FUTU
        return this.providers.futu || null;
      
      default:
        // 未知类型 → TradingView（全市场覆盖）
        return this.providers.tradingview || null;
    }
  }
  
  /**
   * 更新统计
   */
  private updateStats(providerName: string, category: AssetCategory): void {
    // 数据源使用统计
    this.stats.usage[providerName] = (this.stats.usage[providerName] || 0) + 1;
    
    // 资产类别统计
    this.stats.categories[category]++;
    
    // 统计节省的 FUTU 额度
    if (providerName !== 'FUTU' && (
      category === AssetCategory.CRYPTO ||
      category === AssetCategory.US_MAJOR
    )) {
      this.stats.futuQuotaSaved++;
    }
  }
  
  /**
   * 获取路由统计
   */
  getStats(): RouteStats {
    return { ...this.stats };
  }
  
  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      usage: {},
      categories: {} as Record<AssetCategory, number>,
      futuQuotaSaved: 0,
    };
  }
  
  /**
   * 打印统计信息
   */
  printStats(): void {
    console.log('\n🔀 DataSourceRouter 统计:');
    console.log('━'.repeat(60));
    
    // 数据源使用分布
    console.log('  数据源使用:');
    for (const [provider, count] of Object.entries(this.stats.usage)) {
      console.log(`    ${provider}: ${count} 次`);
    }
    
    // 资产类别分布
    console.log('\n  资产类别:');
    for (const [category, count] of Object.entries(this.stats.categories)) {
      if (count > 0) {
        console.log(`    ${category}: ${count} 次`);
      }
    }
    
    // 节省的 FUTU 额度
    console.log(`\n  💰 节省 FUTU 额度: ${this.stats.futuQuotaSaved} 次`);
    console.log('━'.repeat(60));
  }
}
