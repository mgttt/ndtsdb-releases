// ============================================================
// session command - 会话管理
// ============================================================

import { SessionManager } from '../../session/SessionManager';
import { Table } from '../table';

export async function sessionCommand(
  args: string[],
  options: Record<string, string | boolean>,
  subCommand?: string
): Promise<void> {
  const sm = new SessionManager();
  const cmd = subCommand || args[0];

  switch (cmd) {
    case 'new':
    case 'create': {
      const name = args[1];
      const shellCmd = args[2];
      if (!name) {
        console.error('错误: 请指定会话名');
        console.error('用法: wp session new <name> [cmd]');
        process.exit(1);
      }
      await sm.create(name, shellCmd);
      console.log(`[wp] 会话已创建: ${name}`);
      break;
    }

    case 'ls':
    case 'list': {
      const list = await sm.list();
      if (list.length === 0) {
        console.log('[wp] 没有会话');
        return;
      }
      const table = new Table([
        { key: 'name', header: 'name', width: 20 },
        { key: 'attached', header: 'attached', width: 10 },
        { key: 'windows', header: 'windows', width: 10 },
        { key: 'size', header: 'size', width: 12 },
      ]);
      for (const s of list) {
        table.addRow({
          name: s.name,
          attached: s.attached ? 'yes' : 'no',
          windows: String(s.windows),
          size: s.size,
        });
      }
      console.log(table.render());
      break;
    }

    case 'attach': {
      const name = args[1];
      if (!name) {
        console.error('错误: 请指定会话名');
        process.exit(1);
      }
      console.log(`[wp] 正在接入会话: ${name}`);
      sm.attach(name);
      break;
    }

    case 'kill':
    case 'delete': {
      const name = args[1];
      if (!name) {
        console.error('错误: 请指定会话名或 all');
        process.exit(1);
      }
      if (name === 'all') {
        const list = await sm.list();
        for (const s of list) {
          await sm.kill(s.name);
          console.log(`[wp] 已销毁: ${s.name}`);
        }
      } else {
        await sm.kill(name);
        console.log(`[wp] 已销毁: ${name}`);
      }
      break;
    }

    case 'send': {
      const name = args[1];
      const keys = args[2];
      if (!name || !keys) {
        console.error('错误: 请指定会话名和按键');
        console.error('用法: wp session send <name> <keys>');
        process.exit(1);
      }
      await sm.sendKeys(name, keys);
      console.log(`[wp] 已发送: ${keys}`);
      break;
    }

    case 'capture': {
      const name = args[1];
      if (!name) {
        console.error('错误: 请指定会话名');
        process.exit(1);
      }
      const lines = options.lines ? parseInt(options.lines as string, 10) : 50;
      const output = await sm.capture(name, lines);
      console.log(output);
      break;
    }

    default:
      console.log(`
用法: wp session <subcommand>

子命令:
  new <name> [cmd]     创建会话
  ls                   列出会话
  attach <name>        接入会话
  kill <name|all>      销毁会话
  send <name> <keys>   发送按键
  capture <name>       抓取输出

快捷方式:
  wp sh <name> [cmd]   = session new
  wp attach <name>     = session attach
`);
  }
}
