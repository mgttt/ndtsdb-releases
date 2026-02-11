// ============================================================
// Daemon Server Entry
//
// This file is meant to be spawned by the CLI / Daemon manager.
// ============================================================

import { Daemon } from './Daemon';

async function main() {
  const baseDir = process.env.WP_BASE_DIR;
  const daemon = new Daemon({ baseDir: baseDir || undefined });
  await daemon.run();
}

main().catch(err => {
  console.error('[wp-daemon] fatal:', err);
  process.exit(1);
});
