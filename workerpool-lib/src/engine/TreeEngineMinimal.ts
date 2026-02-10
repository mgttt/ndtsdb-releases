/**
 * Minimal TreeEngine test
 */

import { Engine } from './Engine';

export interface TreeWorkRequirements {
  capabilities: string[];
  path?: string;
}

export class TreeEngine extends Engine {
  constructor(config: any) {
    super(config);
  }
}
