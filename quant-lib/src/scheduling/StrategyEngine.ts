/**
 * Strategy Engine
 * 
 * Extends workpool-lib Engine with strategy-specific features
 */

import { TreeEngine, FileStore } from '@moltbaby/workpool-lib';
import type { PathResource, Work, TreeWorkRequirements } from '@moltbaby/workpool-lib';
import { createLogger } from '../utils/logger';

const logger = createLogger('StrategyEngine');

export interface ScheduledStrategy {
  id: string;
  strategyFile: string;
  cron: string;           // Cron expression
  workerPath: string;     // e.g., "/system/tasks/*" or "/asia/japan/*"
  oneShot: boolean;       // Run once and exit
  params?: Record<string, any>;
}

export interface StrategyEngineConfig {
  workDir: string;
  heartbeatMs?: number;
  maxRetries?: number;
}

/**
 * Strategy Engine extends workpool-lib TreeEngine
 * 
 * Features:
 * - Tree-based resource management (region/zone/worker)
 * - Path-based work scheduling
 * - Strategy-specific cron scheduling
 */
export class StrategyEngine extends TreeEngine {
  private scheduledStrategies: Map<string, ScheduledStrategy> = new Map();
  private config: Required<StrategyEngineConfig>;

  constructor(config: StrategyEngineConfig) {
    const store = new FileStore(`${config.workDir}/.ipc/strategy-pool`);
    
    super({
      store,
      scheduler: {
        intervalMs: config.heartbeatMs || 30000,
        maxRetries: config.maxRetries || 3,
        defaultTimeoutMinutes: 30,
        heartbeatTimeoutMs: 120000,
      },
    });

    this.config = {
      heartbeatMs: 30000,
      maxRetries: 3,
      ...config,
    };
  }

  /**
   * Register a scheduled strategy
   */
  registerScheduledStrategy(strategy: ScheduledStrategy): void {
    this.scheduledStrategies.set(strategy.id, strategy);
    logger.info(`Registered scheduled strategy: ${strategy.id}`);
  }

  /**
   * Unregister a scheduled strategy
   */
  unregisterScheduledStrategy(id: string): void {
    this.scheduledStrategies.delete(id);
    logger.info(`Unregistered scheduled strategy: ${id}`);
  }

  /**
   * Get all scheduled strategies
   */
  getScheduledStrategies(): ScheduledStrategy[] {
    return Array.from(this.scheduledStrategies.values());
  }

  /**
   * Check and run due strategies
   * Called by the scheduling loop
   */
  async checkScheduledStrategies(): Promise<void> {
    for (const [id, strategy] of this.scheduledStrategies) {
      if (this.shouldRun(strategy.cron)) {
        logger.info(`Running scheduled strategy: ${id}`);
        
        try {
          await this.submitStrategyWork(strategy);
        } catch (error: any) {
          logger.error(`Failed to run strategy ${id}:`, error.message);
        }
      }
    }
  }

  /**
   * Submit strategy as work to the pool
   * Uses tree-based path scheduling
   */
  private async submitStrategyWork(strategy: ScheduledStrategy): Promise<void> {
    const requirements: TreeWorkRequirements = {
      capabilities: ['strategy-runner'],
      path: strategy.workerPath,  // e.g., "/asia/japan/*"
    };

    const success = await this.scheduleWorkWithPath(
      `strategy-${strategy.id}-${Date.now()}`,
      {
        strategyFile: strategy.strategyFile,
        params: strategy.params,
        oneShot: strategy.oneShot,
      },
      requirements,
      100  // High priority for system tasks
    );

    if (!success) {
      logger.warn(`No available worker for path: ${strategy.workerPath}`);
    }
  }

  /**
   * Check if a cron expression is due
   * Simple implementation - checks if current minute matches
   */
  private shouldRun(cron: string): boolean {
    // TODO: Implement full cron parsing
    // For now, just run every time (for testing)
    return false;
  }

  /**
   * Override tick to add scheduled strategy checking
   */
  async tick(): Promise<void> {
    // Check scheduled strategies
    await this.checkScheduledStrategies();
    
    // Run parent tick (work scheduling)
    await super.tick();
  }
}
