# CYCLE58 - 主题 c 调研：思考过程实时可视化

> **调研日期**: 2026-08-03
> **来源**: codex reasoning stream + TRAE 思考面板 + Hermes ThinkingBlock

---

## 1. Codex 的思考过程展示

### 1.1 思考流（Reasoning Stream）
**技术架构**：
- LLM 返回 `reasoning_content` 字段（与 `text` 分离）
- TUI 监听 reasoning chunk 流式输出
- 主题感知状态栏显示当前阶段
- 折叠/展开切换

**关键特性**：
- **Token-by-token 增量渲染**（不是等到完整 thinking 完成）
- **思考状态条**：标题、token 数、运行时长
- **阶段标签**：Planning / Analyzing / Coding / Testing
- **可折叠**：默认折叠以节省屏幕空间

**来源**: 
- https://github.com/openai/codex (TUI 实现)
- https://developers.openai.com/codex/changelog/

### 1.2 GPT-5.6 Terra / GPT-5.6 Luna 推理模型
- 推理强度可调（low/medium/high/xhigh）
- 推理 token 单独计费
- 推理过程对用户透明可见

---

## 2. TRAE 的思考过程展示

### 2.1 文档工具实时生成
**来源**: https://docs.trae.ai/ide/tool-panels

- 文档工具显示 PRD/技术架构文档的**生成过程**
- 用户可以看到 AI 一字一句地写文档
- 文档生成后**自动接受**为初稿
- 用户可手动修改或将选中文本发回 AI 继续

### 2.2 编辑器工具
- 展示**编码过程**和最终代码
- 代码生成完毕后**自动接受**
- 可点击"查看变更"在代码变更工具中查看

### 2.3 实时跟随模式
- 工具面板左上角"实时跟随"按钮
- AI 工作时工具处于**只读状态**
- 双击或滚动内容退出实时跟随

---

## 3. Hermes 现状

### 3.1 ThinkingBlock 组件（v4.0.0）
**文件**: [frontend/src/components/ThinkingBlock.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThinkingBlock.tsx)

**已实现**：
- ✅ 4 阶段推理展示（分析/规划/编码/测试）
- ✅ 阶段徽章 + 切换动画
- ✅ 时长统计
- ✅ 折叠/展开

**检测器**: [frontend/src/utils/thinkingStageDetector.ts](file:///home/qizheng/auto_code_ws/frontend/src/utils/thinkingStageDetector.ts)

### 3.2 后端 SSE 事件
**文件**: [backend/app/services/hermes_service.py](file:///home/qizheng/auto_code_ws/backend/app/services/hermes_service.py)

- `thinking` 事件流式推送
- `text` 事件（最终答案）
- `done` 事件

---

## 4. 三方对比

| 维度 | Codex | TRAE | Hermes |
|------|-------|------|--------|
| 阶段标签 | 4 阶段 | 实时生成 | 4 阶段 ✅ |
| Token 流 | ✅ | ✅ 文档 | ✅ |
| 折叠 | ✅ | ❌ 自动 | ✅ |
| 主题感知 | ✅ 状态栏 | N/A | ❌ |
| 推理强度 | ✅ 可调 | N/A | ✅ ModelSelector |

---

## 5. 实施建议

### P0 - 思考可视化增强
- **Token 计数器**：实时显示推理 token 数
- **阶段进度条**：当前阶段在 4 阶段中的位置
- **历史折叠**：所有已完成阶段自动折叠

### P1 - 主题感知状态栏
- **LoopStatusBar 集成** ThinkingBlock 数据
- **颜色编码**：规划/编码/测试不同主题色

### P2 - 推理模型深度集成
- 推理 token 单独显示
- 推理强度滑块
- 推理过程可下载为 transcript
