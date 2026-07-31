/// <reference types="vite/client" />

/**
 * 浏览器环境全局变量声明
 * 在 Vite + Vitest 测试环境下，process 和 global 从 Node.js 借用到浏览器
 * 声明为可选 any 类型以避免类型检查错误
 */
declare const process: {
  env: {
    [key: string]: string | undefined;
  };
  cwd?: () => string;
};

declare const global: typeof globalThis;

declare const __dirname: string;
declare const __filename: string;

// ============ Node.js 模块声明 (Cycle 43 G43-01) ============
// 在浏览器 + happy-dom 测试环境下，声明这些模块以满足类型检查
// 实际使用由 Vite/Vitest 在 Node.js 环境下提供运行时支持

declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  export function stat(path: string): Promise<{ size: number; mtime: Date; isDirectory(): boolean; isFile(): boolean }>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function basename(p: string, ext?: string): string;
  export function dirname(p: string): string;
  export const sep: string;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:child_process' {
  export interface ChildProcess {
    killed: boolean;
    on(event: 'error', listener: (err: Error) => void): void;
    kill(signal?: string): boolean;
  }
  export function spawn(command: string, args?: string[], options?: {
    stdio?: Array<'pipe' | 'inherit' | 'ignore'>;
    env?: Record<string, string | undefined>;
  }): ChildProcess;
}
