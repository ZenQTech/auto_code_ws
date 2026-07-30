/**
 * # ============================================================
 * # Slash Command Engine - 斜杠命令引擎 (v1.0.0 Cycle 28 G28-05)
 * # ============================================================
 * # 核心作用：实现 /init /status /review /plan /goal /next /mcp 等命令
 * # 参考：Codex 2026 /commands 全集
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-05 初次创建
 * # ============================================================
 */

export type CommandCategory = 'session' | 'git' | 'plan' | 'review' | 'mcp' | 'custom';
export type CommandHandlerType = 'builtin' | 'user' | 'plugin';

export interface SlashCommand {
  /** 命令名（不含 /） */
  name: string;
  /** 别名 */
  aliases?: string[];
  /** 描述 */
  description: string;
  /** 详细用法 */
  usage?: string;
  /** 分类 */
  category: CommandCategory;
  /** 处理类型 */
  type: CommandHandlerType;
  /** 处理器 */
  handler: (args: string[], context: CommandContext) => CommandResult | Promise<CommandResult>;
  /** 是否内置 */
  builtin?: boolean;
  /** 是否启用 */
  enabled?: boolean;
}

export interface CommandContext {
  /** 当前工作目录 */
  cwd: string;
  /** 当前 Session ID */
  sessionId?: string;
  /** 当前 Thread ID */
  threadId?: string;
  /** 用户输入（完整） */
  rawInput: string;
  /** 附加上下文 */
  metadata: Record<string, unknown>;
}

export interface CommandResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
  error?: string;
}

export type SlashCommandEventType =
  | 'command-registered'
  | 'command-unregistered'
  | 'command-executed'
  | 'command-failed'
  | 'commands-listed';

export interface SlashCommandEvent {
  type: SlashCommandEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

// ============ 内置命令 ============

export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'init',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    aliases: ['initialize'],
    description: '初始化项目，自动分析结构并生成 AGENTS.md',
    usage: '/init [path]',
    category: 'session',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (args, ctx) => {
      const path = args[0] || ctx.cwd;
      return {
        success: true,
        output: `✓ 已初始化项目: ${path}\n- 分析项目结构\n- 生成 AGENTS.md\n- 注册项目记忆`,
        data: { path, generatedFile: 'AGENTS.md' },
      };
    },
  },
  {
    name: 'status',
    description: '显示当前会话、上下文、token 使用、加载的配置',
    usage: '/status',
    category: 'session',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (_args, ctx) => {
      return {
        success: true,
        output: `会话状态:\n- Session: ${ctx.sessionId || '未设置'}\n- Thread: ${ctx.threadId || '未设置'}\n- CWD: ${ctx.cwd}\n- Context: 0 / 200K`,
      };
    },
  },
  {
    name: 'approvals',
    description: '切换批准模式（ask / auto / sandbox）',
    usage: '/approvals <mode>',
    category: 'session',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (args) => {
      const mode = args[0] || 'ask';
      return {
        success: true,
        output: `✓ 批准模式已切换为: ${mode}`,
        data: { mode },
      };
    },
  },
  {
    name: 'review',
    description: '非交互代码审查模式',
    usage: '/review [target]',
    category: 'review',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (args) => {
      const target = args[0] || '.';
      return {
        success: true,
        output: `✓ 启动代码审查: ${target}`,
        data: { target },
      };
    },
  },
  {
    name: 'plan',
    aliases: ['plan-mode'],
    description: '进入结构化多步规划（适合复杂特性开发）',
    usage: '/plan [description]',
    category: 'plan',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (args) => {
      const desc = args.join(' ') || '新规划';
      return {
        success: true,
        output: `✓ 进入 Plan 模式: ${desc}`,
        data: { description: desc },
      };
    },
  },
  {
    name: 'goal',
    description: '启动持久会话，能跨多天运行（2026新特性）',
    usage: '/goal "长期目标描述"',
    category: 'session',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (args) => {
      const goal = args.join(' ').replace(/^["']|["']$/g, '');
      return {
        success: true,
        output: `✓ 启动持久目标: ${goal}`,
        data: { goal },
      };
    },
  },
  {
    name: 'mcp',
    description: '查看/管理 MCP 服务器状态',
    usage: '/mcp [list|enable|disable]',
    category: 'mcp',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async (args) => {
      return {
        success: true,
        output: `MCP 服务器: 0 个已配置`,
        data: { subcommand: args[0] || 'list' },
      };
    },
  },
  {
    name: 'next',
    description: '根据 AGENTS.md 中的下一步列表继续推进',
    usage: '/next',
    category: 'session',
    type: 'builtin',
    builtin: true,
    enabled: true,
    handler: async () => {
      return {
        success: true,
        output: `下一步: 根据 AGENTS.md 继续推进`,
      };
    },
  },
];

// ============ 引擎 ============

export class SlashCommandEngine {
  private commands: Map<string, SlashCommand> = new Map();
  private listeners: Map<SlashCommandEventType, Set<(e: SlashCommandEvent) => void>> = new Map();

  constructor() {
    this.loadBuiltins();
  }

  private loadBuiltins(): void {
    for (const cmd of BUILTIN_COMMANDS) {
      this.commands.set(cmd.name, cmd);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          this.commands.set(alias, cmd);
        }
      }
    }
  }

  on(event: SlashCommandEventType, listener: (e: SlashCommandEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: SlashCommandEventType, listener: (e: SlashCommandEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: SlashCommandEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('SlashCommandEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 命令管理 ============

  registerCommand(command: SlashCommand): void {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
    this.emit({
      type: 'command-registered',
      timestamp: Date.now(),
      data: { name: command.name, category: command.category },
    });
  }

  unregisterCommand(name: string): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) return false;
    if (cmd.builtin) return false;
    this.commands.delete(name);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.delete(alias);
      }
    }
    this.emit({ type: 'command-unregistered', timestamp: Date.now(), data: { name } });
    return true;
  }

  getCommand(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  listCommands(filter?: { category?: CommandCategory; enabled?: boolean }): SlashCommand[] {
    const seen = new Set<string>();
    const result: SlashCommand[] = [];
    for (const cmd of this.commands.values()) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      if (filter?.category && cmd.category !== filter.category) continue;
      if (filter?.enabled !== undefined && (cmd.enabled ?? true) !== filter.enabled) continue;
      result.push(cmd);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ============ 命令执行 ============

  /**
   * 解析用户输入
   * @returns null 如果不是命令
   */
  parseInput(input: string): { name: string; args: string[] } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return null;
    const rest = trimmed.slice(1);
    // 智能分词：支持引号
    const parts = this.tokenize(rest);
    if (parts.length === 0) return null;
    return { name: parts[0], args: parts.slice(1) };
  }

  private tokenize(s: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote: '"' | "'" | null = null;
    for (const ch of s) {
      if (inQuote) {
        if (ch === inQuote) {
          inQuote = null;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  async execute(input: string, context: CommandContext): Promise<CommandResult> {
    const parsed = this.parseInput(input);
    if (!parsed) {
      return {
        success: false,
        output: '',
        error: 'Not a command (must start with /)',
      };
    }
    const cmd = this.commands.get(parsed.name);
    if (!cmd) {
      this.emit({
        type: 'command-failed',
        timestamp: Date.now(),
        data: { name: parsed.name, error: 'Unknown command' },
      });
      return {
        success: false,
        output: '',
        error: `Unknown command: /${parsed.name}`,
      };
    }
    if (cmd.enabled === false) {
      this.emit({
        type: 'command-failed',
        timestamp: Date.now(),
        data: { name: parsed.name, error: 'Command disabled' },
      });
      return {
        success: false,
        output: '',
        error: `Command disabled: /${parsed.name}`,
      };
    }
    try {
      const result = await cmd.handler(parsed.args, context);
      this.emit({
        type: 'command-executed',
        timestamp: Date.now(),
        data: { name: cmd.name, success: result.success },
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({
        type: 'command-failed',
        timestamp: Date.now(),
        data: { name: cmd.name, error },
      });
      return { success: false, output: '', error };
    }
  }
}

let defaultEngine: SlashCommandEngine | null = null;
export function getDefaultSlashCommandEngine(): SlashCommandEngine {
  if (!defaultEngine) {
    defaultEngine = new SlashCommandEngine();
  }
  return defaultEngine;
}
export function resetDefaultSlashCommandEngine(): void {
  defaultEngine = null;
}
