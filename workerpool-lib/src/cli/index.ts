// ============================================================
// CLI - 命令解析与路由
//
// 零外部依赖，手动解析 process.argv
// ============================================================

import { Daemon } from '../daemon/Daemon';
import { startCommand } from './commands/start';
import { stopCommand } from './commands/stop';
import { restartCommand } from './commands/restart';
import { listCommand } from './commands/list';
import { logsCommand } from './commands/logs';
import { statusCommand } from './commands/status';
import { killCommand } from './commands/kill';
import { signalCommand } from './commands/signal';
import { saveCommand } from './commands/save';
import { loadCommand } from './commands/load';
import { sessionCommand } from './commands/session';
import { shCommand } from './commands/sh';
import { attachCommand } from './commands/attach';
import { scaleCommand } from './commands/scale';
import { monitCommand } from './commands/monit';

export * from './table';

export interface ParsedArgs {
  command: string;
  args: string[];
  options: Record<string, string | boolean>;
}

export class CLI {
  private daemon = new Daemon();

  async run(argv: string[]): Promise<void> {
    const parsed = this.parseArgs(argv);
    
    switch (parsed.command) {
      case 'start':
        await startCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'stop':
        await stopCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'restart':
        await restartCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'list':
      case 'ls':
        await listCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'logs':
        await logsCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'status':
        await statusCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'kill':
        await killCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'signal':
        await signalCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'save':
        await saveCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'load':
        await loadCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'session':
        await sessionCommand(parsed.args, parsed.options);
        break;
      case 'sh':
        await shCommand(parsed.args, parsed.options);
        break;
      case 'attach':
        await attachCommand(parsed.args, parsed.options);
        break;
      case 'scale':
        await scaleCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'monit':
        await monitCommand(parsed.args, parsed.options, this.daemon);
        break;
      case 'help':
      default:
        this.showHelp();
    }
  }

  private parseArgs(argv: string[]): ParsedArgs {
    const result: ParsedArgs = {
      command: '',
      args: [],
      options: {},
    };

    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];

      if (arg.startsWith('--')) {
        // 长选项 --name=value 或 --name value
        const eqIdx = arg.indexOf('=');
        if (eqIdx > 0) {
          const key = arg.slice(2, eqIdx);
          const value = arg.slice(eqIdx + 1);
          result.options[key] = value;
        } else {
          const key = arg.slice(2);
          const nextArg = argv[i + 1];
          if (nextArg && !nextArg.startsWith('-')) {
            result.options[key] = nextArg;
            i++;
          } else {
            result.options[key] = true;
          }
        }
      } else if (arg.startsWith('-')) {
        // 短选项 -f 或 -f value
        const key = arg.slice(1);
        const nextArg = argv[i + 1];
        if (nextArg && !nextArg.startsWith('-')) {
          result.options[key] = nextArg;
          i++;
        } else {
          result.options[key] = true;
        }
      } else if (!result.command) {
        // 第一个非选项参数是命令
        result.command = arg;
      } else {
        // 后续非选项参数是 args
        result.args.push(arg);
      }
    }

    return result;
  }

  private showHelp(): void {
    console.log(`
wp - 进程管理工具 (pm2 替代方案)

用法:
  wp <command> [options]

命令:
  start <script>       启动进程
  stop <name|all>      停止进程
  restart <name|all>   重启进程
  list, ls             列出所有进程
  logs <name>          查看日志
  status [name]        查看状态
  kill                 停止所有进程并关闭 daemon
  signal <name> <sig>  发送信号
  save                 导出配置到 wp.config.ts
  load [file]          从配置批量启动
  help                 显示帮助

示例:
  wp start app.ts --name api --interpreter bun
  wp list
  wp logs api --lines 50 --follow
  wp stop api
  wp kill
`);
  }
}

export default CLI;
