import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 2026-07-28 | v1.0.1 | P1-7 UI 测试：兼容后端默认端口 8765
      //   默认指向 8765（实际运行环境），保留 8000 作为可覆盖的环境变量
      '/api': `http://localhost:${process.env.BACKEND_PORT || 8765}`,
      '/ws': {
        target: `ws://localhost:${process.env.BACKEND_PORT || 8765}`,
        ws: true,
      },
      // v5.3.0 (Cycle 7 P0-8) 新增：OAuth 2.1 + PKCE 端点代理
      //   - /.well-known/oauth-authorization-server (RFC 8414 metadata)
      //   - /oauth/{register,authorize,token,revoke}
      '/.well-known': `http://localhost:${process.env.BACKEND_PORT || 8765}`,
      '/oauth': `http://localhost:${process.env.BACKEND_PORT || 8765}`,
    },
  },
  build: {
    // ============================================================
    // 2026-08-01 | v1.0.2 | Cycle 44 修复 - Vite 构建兼容性
    // 标记 Node.js 内置模块为外部依赖（仅用于测试和服务端场景）
    // 这些模块在浏览器中无意义，但 Cycle 43 添加的 MCP 真实服务器
    // （mcpFilesystemServer / mcpGitServer / mcpFetchServer）会引用它们
    // ============================================================
    rollupOptions: {
      external: [
        /^node:/,
        'node:child_process',
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:os',
        'node:crypto',
        'node:util',
        'node:stream',
      ],
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-monaco': ['monaco-editor', '@monaco-editor/react'],
        },
      },
    },
  },
})
