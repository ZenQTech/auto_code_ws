/**
 * Vitest E2E Configuration (v1.0.0)
 * Cycle 59 G59-01 ~ G59-05
 *
 * 用于运行 tests/e2e/ 下的端到端测试
 * 配置与主 vitest.config.ts 分离，避免被主配置排除
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['tests/e2e/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
