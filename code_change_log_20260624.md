# 代码修改日志（追加）

## Task 10 — 构建与回归验证（追加，2026-06-24）

### 修改文件

- `frontend/src/index.css` v1.7.0 → v1.7.1
  - 修复 PostCSS 警告 `@import must precede all other statements`
  - 将 `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap')` 移至文件首部（紧跟头部注释之后），先于 `@media (prefers-reduced-motion)` 与 `@tailwind` 指令
  - 同步更新文件头注释（v1.7.1 修订说明）

### 验证结果

| Checkpoint | 命令 | 结果 |
| ---------- | ---- | ---- |
| 10.1 后端启动 | `python3 -c "from backend.app.main import app; print('OK')"` | exit 0，输出 `OK` |
| 10.2 前端构建 | `tsc -b && vite build` | exit 0，38 modules / 798ms / 0 错 0 警，dist 292K |
| 10.3 GUI 端到端 | 真实浏览器 | **SKIPPED**（sub-agent 无浏览器） |
| 10.4 grep 验证 | `grep -rn from-hermes-50` / `bg-red-50` / `hermes-gradient` | 通过（`hermes-gradient` 未添加，spec 允许跳过） |

### 构建统计

```
vite v6.4.3 building for production...
✓ 38 modules transformed.
dist/index.html                   0.60 kB │ gzip:  0.44 kB
dist/assets/index-Dbt47Jra.css   55.82 kB │ gzip:  9.61 kB
dist/assets/index-CyDdDoHN.js   227.49 kB │ gzip: 67.26 kB
✓ built in 798ms
```

### 遗留问题

1. **Node 版本兼容**：本机默认 `node v12.22.9` 与 `typescript@5.6.2` 不兼容（tsc 源码使用 `??` 空值合并运算符，需要 Node 14+）。本轮验证使用 `~/.nvm/versions/node/v24.15.0/bin/node` 显式执行。后续若需正常 `npm run build`，建议：
   - 升级默认 `node` 至 v18+ LTS；或
   - 在 `package.json` 增加 `"engines": { "node": ">=18" }` 约束。

2. **GUI 端到端**：未在真实浏览器中验证启动页 / 气泡 hover 工具栏 / 输入区贴底 / 错误卡片四个交互维度，需要人工在浏览器中复核。

3. **`hermes-gradient`**：未在 `tailwind.config.js` 中以 `backgroundImage` 形式添加为渐变背景工具类。当前项目使用 inline 渐变（`bg-gradient-to-br from-hermes-X to-hermes-Y`）达到同样效果，spec 允许跳过。
