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
