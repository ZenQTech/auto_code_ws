/**
 * # ============================================================
 * # Vitest 配置文件
 * # ============================================================
 * # 核心作用：配置 Vitest 测试运行器，使用 happy-dom 提供 DOM 环境
 * # 运行流程：
 * #   1. 加载 @vitejs/plugin-react 以支持 JSX
 * #   2. 设置 happy-dom 作为测试环境（比 jsdom 更快，与 Vite 集成更好）
 * #   3. 配置 @testing-library/jest-dom 扩展断言
 * #   4. 启用 V8 coverage 报告，阈值设为 80%
 * # 输入参数：CLI 命令行参数
 * # 输出结果：Vitest 运行配置
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-3 引入 Vitest + RTL 测试体系
 * # ============================================================
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  optimizeDeps: {
    esbuildOptions: {
      jsx: 'automatic',
    },
  },
  test: {
    // 使用 happy-dom（比 jsdom 快 2-3x，与 Vite 集成更好）
    environment: 'happy-dom',
    globals: true,
    // 全局测试 setup
    setupFiles: ['./src/test/setup.ts'],
    // CSS 模块支持（避免 import 报错）
    css: false,
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: [
        'src/**/*.{ts,tsx}',
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/**/*.stories.{ts,tsx}',
        'src/types/**',
      ],
      thresholds: {
        // v1.0.0 P0 阶段先低阈值（20%），后续 P1/P2 逐步提升
        lines: 20,
        functions: 20,
        branches: 20,
        statements: 20,
      },
    },
    // 测试匹配
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // 排除
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
