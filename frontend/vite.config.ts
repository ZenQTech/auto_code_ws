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
    // 2026-07-24 | v1.0.0 | Module A 前端 UI 优化 - Task A3
    // 启用 Rollup manualChunks 切分：
    //   - vendor-react: React / ReactDOM 等核心库（高频更新 / 全局共享）
    //   - vendor-monaco: Monaco Editor（按需懒加载，仅编程模式打开文件时引入）
    // 收益：
    //   1. 减小主包体积，加快首屏加载
    //   2. 充分利用浏览器缓存（vendor chunk 长期不变，business chunk 频繁更新）
    //   3. Monaco 单独切分，可走动态 import 实现按需加载
    // ============================================================
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-monaco': ['monaco-editor', '@monaco-editor/react'],
        },
      },
    },
  },
})
