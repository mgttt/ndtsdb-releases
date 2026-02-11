// ============================================================
// LogRotator - 日志轮转与压缩（零外部依赖）
//
// - 按 retain 数量滚动 .N.log.gz
// - 使用 node:zlib gzip 压缩
// ============================================================

import { createReadStream, createWriteStream, existsSync, renameSync, unlinkSync, truncateSync } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';

export interface RotateConfig {
  retain: number;
}

export class LogRotator {
  /**
   * 轮转并压缩：
   *   <name>.log -> <name>.1.log.gz
   *   <name>.1.log.gz -> <name>.2.log.gz ...
   */
  static async rotateAndCompress(sourcePath: string, targetPrefix: string, cfg: RotateConfig): Promise<void> {
    const retain = Math.max(1, cfg.retain);

    // 1) shift old gz files
    for (let i = retain - 1; i >= 1; i--) {
      const oldPath = `${targetPrefix}.${i}.log.gz`;
      const newPath = `${targetPrefix}.${i + 1}.log.gz`;

      if (existsSync(oldPath)) {
        if (i === retain - 1) {
          const oldest = `${targetPrefix}.${retain}.log.gz`;
          if (existsSync(oldest)) unlinkSync(oldest);
        }
        renameSync(oldPath, newPath);
      }
    }

    // 2) gzip current log to .1
    const gzPath = `${targetPrefix}.1.log.gz`;
    await pipeline(
      createReadStream(sourcePath),
      createGzip({ level: 6 }),
      createWriteStream(gzPath)
    );

    // 3) truncate original
    truncateSync(sourcePath, 0);
  }
}

export default LogRotator;
