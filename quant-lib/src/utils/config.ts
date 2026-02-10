/**
 * Configuration Management
 * 
 * Unified configuration loading for accounts, proxies, and settings
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ExchangeConfig, ExchangeName } from '../types/index';

export interface AccountEntry {
  id: string;
  name: string;
  exchange: ExchangeName;
  key: string;
  secret: string;
  passphrase?: string;
  proxy?: string;
  testnet?: boolean;
  region?: string;
  notes?: string;
}

export interface ConfigManagerOptions {
  envFile?: string;           // Path to env.jsonl
  accountsFile?: string;      // Path to accounts.json
  configDir?: string;         // Base config directory
}

/**
 * Unified configuration manager
 */
export class ConfigManager {
  private options: Required<ConfigManagerOptions>;
  private accountsCache: Map<string, AccountEntry> = new Map();
  private proxyCache: string | undefined;

  constructor(options: ConfigManagerOptions = {}) {
    this.options = {
      envFile: options.envFile || join(homedir(), 'env.jsonl'),
      accountsFile: options.accountsFile || join(homedir(), '.config', 'quant', 'accounts.json'),
      configDir: options.configDir || join(homedir(), '.config', 'quant'),
    };
  }

  /**
   * Load all accounts from env.jsonl and accounts.json
   */
  loadAccounts(): AccountEntry[] {
    const accounts: AccountEntry[] = [];

    // 1. Load from env.jsonl (legacy format)
    if (existsSync(this.options.envFile)) {
      try {
        const content = readFileSync(this.options.envFile, 'utf-8');
        for (const line of content.split('\n').filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            const [id, config] = Object.entries(obj)[0] as [string, any];
            
            if (config.type === 'bybit' || config.type === 'binance') {
              accounts.push({
                id,
                name: config.name || id,
                exchange: config.type,
                key: config.key,
                secret: config.secret,
                proxy: config.proxy,
                testnet: config.testnet,
                region: config.region,
                notes: config.notes,
              });
            }
          } catch {}
        }
      } catch (error: any) {
        console.warn(`[ConfigManager] Failed to load ${this.options.envFile}:`, error.message);
      }
    }

    // 2. Load from accounts.json (new format)
    if (existsSync(this.options.accountsFile)) {
      try {
        const content = readFileSync(this.options.accountsFile, 'utf-8');
        const parsed = JSON.parse(content);
        const newFormatAccounts = Array.isArray(parsed) ? parsed : parsed.accounts;
        
        for (const acc of newFormatAccounts || []) {
          // Merge with existing or add new
          const existing = accounts.find(a => a.id === acc.id);
          if (existing) {
            Object.assign(existing, acc);
          } else {
            accounts.push(acc);
          }
        }
      } catch (error: any) {
        console.warn(`[ConfigManager] Failed to load ${this.options.accountsFile}:`, error.message);
      }
    }

    // Cache accounts
    this.accountsCache.clear();
    for (const acc of accounts) {
      this.accountsCache.set(acc.id, acc);
    }

    return accounts;
  }

  /**
   * Get single account by ID
   */
  getAccount(id: string): AccountEntry | undefined {
    if (this.accountsCache.size === 0) {
      this.loadAccounts();
    }
    return this.accountsCache.get(id);
  }

  /**
   * Get all accounts for an exchange
   */
  getAccountsByExchange(exchange: ExchangeName): AccountEntry[] {
    return this.loadAccounts().filter(a => a.exchange === exchange);
  }

  /**
   * Convert account entry to exchange config
   */
  toExchangeConfig(account: AccountEntry): ExchangeConfig {
    return {
      name: account.exchange,
      credentials: {
        key: account.key,
        secret: account.secret,
        passphrase: account.passphrase,
      },
      proxy: account.proxy || this.getProxy(),
      testnet: account.testnet,
    };
  }

  /**
   * Get global proxy setting
   */
  getProxy(): string | undefined {
    if (this.proxyCache !== undefined) return this.proxyCache;

    // Priority: env var > config file
    const envProxy = process.env.PROXY || process.env.HTTP_PROXY;
    if (envProxy) {
      this.proxyCache = envProxy;
      return envProxy;
    }

    // Try to load from config
    const proxyFile = join(this.options.configDir, 'proxy');
    if (existsSync(proxyFile)) {
      try {
        this.proxyCache = readFileSync(proxyFile, 'utf-8').trim();
        return this.proxyCache;
      } catch {}
    }

    this.proxyCache = undefined;
    return undefined;
  }

  /**
   * Set global proxy
   */
  setProxy(proxy: string): void {
    this.proxyCache = proxy;
  }

  /**
   * Get database directory
   */
  getDatabaseDir(): string {
    const envPath = process.env.DB_PATH;
    if (envPath) return envPath;

    return join(this.options.configDir, 'data', 'ndtsdb');
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.accountsCache.clear();
    this.proxyCache = undefined;
  }
}

/**
 * Global config manager instance
 */
export const configManager = new ConfigManager();

/**
 * Load accounts helper
 */
export function loadAccounts(): AccountEntry[] {
  return configManager.loadAccounts();
}

/**
 * Get account helper
 */
export function getAccount(id: string): AccountEntry | undefined {
  return configManager.getAccount(id);
}
