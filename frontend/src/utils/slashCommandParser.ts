/**
 * # ============================================================
 * SlashCommandParser - 命令解析工具
 * # ============================================================
 * 核心作用：解析用户输入的 `/command [args]` 格式
 * 借鉴 Codex v0.150+ 的命令解析逻辑
 *
 * 用法：
 *   const parsed = parseSlashCommand('/plan 实现 OAuth 2.1');
 *   // { name: 'plan', args: ['实现 OAuth 2.1'], raw: '/plan 实现 OAuth 2.1' }
 *
 *   const isCmd = isSlashCommand('/plan');  // true
 *   const cmd = extractCommandName('/plan 实现 OAuth');  // 'plan'
 *
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-12
 * ============================================================
 */

/**
 * 解析后的 Slash Command 结构
 */
export interface ParsedSlashCommand {
  /** 命令名（不含 /），如 'plan' */
  name: string;
  /** 完整参数列表（已按空格分割） */
  args: string[];
  /** 原始输入字符串 */
  raw: string;
  /** 是否在输入框中处于"正在输入命令"状态（首字符是 /） */
  isActive: boolean;
  /** 解析是否成功 */
  valid: boolean;
  /** 解析错误消息（仅在 valid=false 时存在） */
  error?: string;
}

/**
 * 解析选项
 */
export interface ParseOptions {
  /** 是否允许空参数（默认 true） */
  allowEmptyArgs?: boolean;
  /** 参数最大数量（默认 20） */
  maxArgs?: number;
  /** 命令名最大长度（默认 32） */
  maxNameLength?: number;
}

/**
 * 默认选项
 */
const DEFAULT_OPTIONS: Required<ParseOptions> = {
  allowEmptyArgs: true,
  maxArgs: 20,
  maxNameLength: 32,
};

/**
 * 检查输入是否为 Slash Command（以 / 开头且 / 后不是空格）
 *
 * @param input 用户输入
 * @returns 是否为 Slash Command
 */
export function isSlashCommand(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  // 必须以 / 开头
  if (!input.startsWith('/')) return false;
  // 后面不能紧跟空格（否则 / hello 这种不是命令）
  if (input.length > 1 && input[1] === ' ') return false;
  return true;
}

/**
 * 检查输入是否处于"正在输入命令"状态（首字符是 /，但命令可能未完整）
 * 用于决定是否显示命令选择器
 *
 * @param input 用户输入
 * @returns 是否处于命令输入状态
 */
export function isCommandInput(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  return input.startsWith('/');
}

/**
 * 提取命令名（从 /command 中提取 command）
 *
 * @param input 用户输入，例如 '/plan 实现 OAuth'
 * @returns 命令名，例如 'plan'；如果不是命令则返回 null
 */
export function extractCommandName(input: string): string | null {
  if (!isSlashCommand(input)) return null;

  // 提取 / 后到第一个空格前的部分
  const match = input.match(/^\/([^\s]+)/);
  if (!match) return null;

  return match[1];
}

/**
 * 解析 Slash Command 字符串
 *
 * 支持的格式：
 *   - `/command` - 仅命令名
 *   - `/command arg1 arg2` - 命令 + 多个参数
 *   - `/command "arg with spaces"` - 命令 + 带空格的参数
 *   - `/command 'arg with spaces'` - 命令 + 带空格的参数（单引号）
 *
 * @param input 用户输入字符串
 * @param options 解析选项
 * @returns ParsedSlashCommand
 */
export function parseSlashCommand(
  input: string,
  options: ParseOptions = {}
): ParsedSlashCommand {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // 空输入
  if (!input || typeof input !== 'string') {
    return {
      name: '',
      args: [],
      raw: input || '',
      isActive: false,
      valid: false,
      error: '空输入',
    };
  }

  // 非命令
  if (!input.startsWith('/')) {
    return {
      name: '',
      args: [],
      raw: input,
      isActive: false,
      valid: false,
      error: '不是 Slash Command（不以 / 开头）',
    };
  }

  // 仅 / 一个字符，命令未输入完成
  if (input === '/') {
    return {
      name: '',
      args: [],
      raw: input,
      isActive: true,
      valid: true,
    };
  }

  // / 开头但后面是空格（视为普通文本）
  if (input[1] === ' ') {
    return {
      name: '',
      args: [],
      raw: input,
      isActive: false,
      valid: false,
      error: '不是 Slash Command（/ 后跟空格）',
    };
  }

  // 解析命令和参数
  const parts = input.slice(1).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (parts.length === 0) {
    return {
      name: '',
      args: [],
      raw: input,
      isActive: true,
      valid: false,
      error: '无法解析命令',
    };
  }

  const name = parts[0] ?? '';
  const rawArgs = parts.slice(1);

  // 验证命令名
  if (name.length > opts.maxNameLength) {
    return {
      name: name.substring(0, opts.maxNameLength),
      args: [],
      raw: input,
      isActive: true,
      valid: false,
      error: `命令名过长（最大 ${opts.maxNameLength} 字符）`,
    };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return {
      name,
      args: [],
      raw: input,
      isActive: true,
      valid: false,
      error: '命令名只能包含字母、数字、下划线和短横线',
    };
  }

  // 处理引号包裹的参数
  const args = rawArgs.map((arg) => {
    if (
      (arg.startsWith('"') && arg.endsWith('"')) ||
      (arg.startsWith("'") && arg.endsWith("'"))
    ) {
      return arg.slice(1, -1);
    }
    return arg;
  });

  // 验证参数数量
  if (args.length > opts.maxArgs) {
    return {
      name,
      args: args.slice(0, opts.maxArgs),
      raw: input,
      isActive: true,
      valid: false,
      error: `参数过多（最大 ${opts.maxArgs} 个）`,
    };
  }

  if (!opts.allowEmptyArgs && args.length === 0 && rawArgs.length === 0) {
    // 当命令有必填参数时，这里只做警告，不阻断
  }

  return {
    name,
    args,
    raw: input,
    isActive: true,
    valid: true,
  };
}

/**
 * 仅从输入中提取"正在输入的命令前缀"
 * 用于实时过滤命令选择器
 *
 * @param input 用户输入
 * @returns 命令前缀（不含 /）
 */
export function extractCommandPrefix(input: string): string {
  if (!isCommandInput(input)) return '';
  // 提取 / 后到第一个空格前的部分
  const match = input.match(/^\/([^\s]*)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * 构造 Slash Command 字符串
 *
 * @param name 命令名
 * @param args 参数列表
 * @returns 构造的命令字符串
 */
export function buildSlashCommand(name: string, args: string[] = []): string {
  if (!name) return '';
  const argsStr = args
    .map((arg) => {
      if (/\s/.test(arg)) {
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    })
    .join(' ');
  return argsStr ? `/${name} ${argsStr}` : `/${name}`;
}

/**
 * 验证命令名是否合法
 *
 * @param name 命令名
 * @returns 是否合法
 */
export function isValidCommandName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 32) return false;
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
