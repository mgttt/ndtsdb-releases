// ============================================================
// SessionManager - tmux bridge 会话管理
//
// 调用系统 tmux 命令，零外部依赖
// ============================================================

import { execSync, spawn } from 'child_process';

export interface SessionInfo {
  name: string;
  created: string;
  attached: boolean;
  windows: number;
  size: string; // "200x50"
}

export class SessionManager {
  /**
   * 创建会话
   */
  async create(name: string, cmd?: string): Promise<void> {
    const args = ['new-session', '-d', '-s', name];
    if (cmd) {
      args.push(cmd);
    }
    execSync(`tmux ${args.join(' ')}`, { stdio: 'ignore' });
  }

  /**
   * 销毁会话
   */
  async kill(name: string): Promise<void> {
    try {
      execSync(`tmux kill-session -t ${name}`, { stdio: 'ignore' });
    } catch {
      throw new Error(`session not found: ${name}`);
    }
  }

  /**
   * 列出所有会话
   */
  async list(): Promise<SessionInfo[]> {
    try {
      const output = execSync('tmux list-sessions -F "#{session_name}|#{session_created}|#{session_attached}|#{session_windows}|#{session_width}x#{session_height}"', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      return output
        .trim()
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => {
          const [name, created, attached, windows, size] = line.split('|');
          return {
            name,
            created: new Date(parseInt(created) * 1000).toISOString(),
            attached: attached === '1',
            windows: parseInt(windows, 10),
            size: size || '80x24',
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * 发送按键
   */
  async sendKeys(name: string, keys: string): Promise<void> {
    execSync(`tmux send-keys -t ${name} ${keys} Enter`, { stdio: 'ignore' });
  }

  /**
   * 抓取输出
   */
  async capture(name: string, lines: number = 50): Promise<string> {
    try {
      const output = execSync(`tmux capture-pane -t ${name} -p -S -${lines}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return output;
    } catch {
      throw new Error(`session not found: ${name}`);
    }
  }

  /**
   * 接入会话（接管当前终端）
   */
  attach(name: string): void {
    spawn('tmux', ['attach-session', '-t', name], {
      stdio: 'inherit',
      detached: false,
    });
  }

  /**
   * 水平分割
   */
  async splitH(name: string): Promise<string> {
    execSync(`tmux split-window -h -t ${name}`, { stdio: 'ignore' });
    return `${name}.1`;
  }

  /**
   * 垂直分割
   */
  async splitV(name: string): Promise<string> {
    execSync(`tmux split-window -v -t ${name}`, { stdio: 'ignore' });
    return `${name}.1`;
  }
}

export default SessionManager;
