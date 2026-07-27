# Codex + TRAE SOLO Vibe Coding 功能研究汇总

> **研究日期**: 2026-07-24
> **研究目的**: 为全栈 spec 实现提供权威功能参考

## 1. TRAE SOLO 核心功能（来源: docs.trae.ai）

### 1.1 三栏式 UI 布局
- **左栏**: 任务管理面板
- **中栏**: AI 对话面板
- **右栏**: 工具面板
- 来源: <https://docs.trae.ai/ide/solo-mode>

### 1.2 工具面板（Tool Panels）
工具面板包含以下工具：
- **编辑器**（Editor）: 展示编码过程和最终代码。代码生成完毕后自动接受，可点击"查看变更"在 DiffView 中查看
- **文档**（Documentation）: 展示 PRD/技术架构文档的生成过程
- **终端**（Terminal）: 展示命令执行过程和结果，可将输出添加到对话
- **浏览器**（Browser）: 展示最终 Web 应用成果，支持元素选择模式
- **代码变更**（Code Changes / DiffView）: 展示变更的文件数量、行数和文件列表
- **Figma**: 选择 Frame 或元素并发送至 AI 对话
- **Supabase**: 接入 Supabase 服务
- **集成**（Integrations）: Vercel 部署、Stripe 支付等
- 来源: <https://docs.trae.ai/ide/tool-panels>

### 1.3 实时跟随模式（Real-time Follow）
- 工具面板左上角有"实时跟随"按钮
- 开启后系统根据 AI 当前工作阶段自动切换工具
- 例: AI 生成 PRD 时自动打开"文档"工具；AI 编写代码时自动切换至"编辑器"工具
- AI 处理任务时工具处于只读状态
- 双击或滚动内容可退出实时跟随模式
- 来源: <https://docs.trae.ai/ide/tool-panels>

### 1.4 DiffView
- 完成任务后可在聊天面板点击"Open Diff"按钮打开 DiffView
- 显示: 受影响文件数量、变更行数、修改文件列表
- 点击任一文件可查看具体 diff 视图
- 来源: <https://docs.trae.ai/ide/solo-mode>

### 1.5 对话自动折叠（Automatic Folding of Chats）
- 设置路径: Settings > Conversation > To-Do List
- 启用后聊天面板中已完成任务自动折叠并摘要
- 可展开任一折叠部分查看详细内容
- 来源: <https://docs.trae.ai/ide/solo-mode>

### 1.6 内置 Agent
- AI 首先基于目标和项目上下文生成可执行的计划（Plan）
- 用户确认后 AI 逐步开发
- 处理多步骤任务: 需求拆解、方案设计、代码实现、项目重构、问题修复
- 来源: <https://docs.trae.ai/ide/solo-mode>

### 1.7 任务管理（Task Management）
- 支持单个项目内多任务并行执行
- 突破传统串行任务执行限制
- 来源: <https://docs.trae.ai/ide/task-management>

### 1.8 智能体编排
- 自定义智能体可作为子智能体（sub-agents）调用
- 通过 MCP（Model Context Protocol）访问外部资源
- 内置 preview tab 支持浏览器交互、读 console 日志
- 来源: <https://www.trae.ai/>

### 1.9 CUE 自动补全
- 理解意图并预测下一步编辑
- Tab 键跳转到下一个修改点
- 多行智能建议
- 来源: <https://www.trae.ai/>

### 1.10 智能代码审查
- 对未提交变更、单次提交或分支差异进行总结和审查
- 通过摘要、流程图和 diff 视图辅助理解
- 来源: <https://docs.trae.ai/ide/what-is-trae>

---

## 2. Codex CLI 核心功能（来源: OpenAI + 开源社区）

### 2.1 模型版本选择
- **Sol** (旗舰): 适合复杂任务
- **Terra** (均衡): 日常主力
- **Luna** (快速): 适合批量重复任务
- 来源: <https://blog.csdn.net/weixin_65793170/article/details/161883616>

### 2.2 桌面控制（Desktop Control）
- Codex 可看到屏幕并操作 Mac 鼠标和键盘
- 虚拟化后台环境，不劫持用户活动会话
- 可同时运行 3 个并行 Codex Agent
- 应用场景: 自动化 UI 测试、跨应用工作流、视觉验证
- 来源: <https://vibe-coding.academy/blog/codex-desktop-control-image-generation-vibe-coding-2026/>

### 2.3 Realtime V2 流式输出
- 后台 Agent 任务流式增量结果到终端
- 用户可在前台继续工作
- 来源: <https://vibe-coding.academy/blog/cursor-3-claude-code-codex-hybrid-stack-vibe-coding-2026/>

### 2.4 多智能体并行执行
- 一个 Agent 可生成和编排 sub-agents
- 典型模式: 一个写单元测试，一个生成前端组件，一个管理 CI/CD
- 协调 Agent 接收所有 sub-agent 输出并协调迭代
- 来源: <https://vibe-coding.academy/blog/codex-desktop-control-image-generation-vibe-coding-2026/>

### 2.5 跨会话持久记忆
- 跨会话保留上下文
- 命名约定、架构模式、特定领域规则自动应用到新会话
- 来源: <https://vibe-coding.academy/blog/codex-desktop-control-image-generation-vibe-coding-2026/>

### 2.6 TUI 增强（v0.129.0+, 2026-05-07）
- Modal Vim 编辑（`/vim`）
- 重新设计的 workflow 选择器
- `/hooks` 浏览器
- 主题感知的状态栏
- 插件工作区共享
- 语法高亮 fenced code blocks 和 diffs
- `/theme` 选择器与实时预览
- 主题感知的 diff 颜色
- 语音输入（按住空格键录音转录）
- 来源: <https://developers.openai.com/codex/changelog/>, <https://blakecrosley.com/es/guides/codex>

### 2.7 Plan 模式（Plan Mode）
- AI 生成可执行计划
- 用户确认后执行
- 支持协作式计划修订
- 来源: <https://blakecrosley.com/es/guides/codex>

### 2.8 沙箱与审批系统
- 多层沙箱隔离
- 基于工作空间的审批模式
- 自动拦截高风险操作
- 来源: <https://blakecrosley.com/es/guides/codex>

### 2.9 AGENTS.md 系统
- 项目级 AI 行为规范
- 仓库级 Agent 配置
- 来源: <https://blakecrosley.com/es/guides/codex>

---

## 3. 5 个核心功能对应表

| # | 用户问题 | TRAE SOLO 实现 | Codex CLI 实现 | 本项目 spec 对应 |
|---|---------|---------------|----------------|------------------|
| 1 | **大模型思考过程实时展示** | 对话面板 + ThinkingBlock 折叠 | TUI 流式 reasoning 输出 | **D8 分步推理展示 + E5 流式代码生成** |
| 2 | **回答生成过程实时可视化** | 工具面板实时跟随 | Realtime V2 streaming | **D4 实时跟随模式 + E5 流式代码生成** |
| 3 | **代码编写与开发过程实时展示** | 编辑器工具 + token-by-token | CLI 流式输出 | **D7 WebSocket 双向同步 + E5** |
| 4 | **代码修改详情清晰呈现** | DiffView（文件数/行数/列表/diff 视图） | TUI syntax-highlighted diffs | **D5 DiffView 增强 + D3 三栏式 UI** |
| 5 | **代码回滚功能** | 编辑器自动接受 + 手动编辑 | Git checkout + sandbox 审批 | **D5 DiffView 保留/回退按钮 + C1 workflow_engine Git 集成** |

## 4. 实现优先级

按用户问题顺序，本项目需要确保以下功能 100% 实现：

### P0（用户直接要求）
1. **大模型思考过程实时展示** - 已有 ThinkingBlock 组件，需增强为分阶段展示
2. **回答生成过程实时可视化** - 需实现工具面板实时跟随
3. **代码编写与开发过程实时展示** - 需实现 CodeViewer 接收 WebSocket 代码流
4. **代码修改详情清晰呈现** - 需实现完整 DiffView 组件
5. **代码回滚功能** - 需实现基于 Git 的回退按钮

### P1（功能完整性）
- Plan 模式、SubAgent 隔离、对话折叠、模型选择、推理强度、/review /fix

## 5. 来源

- TRAE 官方文档: <https://docs.trae.ai/ide/solo-mode>
- TRAE 工具面板文档: <https://docs.trae.ai/ide/tool-panels>
- TRAE 产品页: <https://www.trae.ai/>
- TRAE SOLO 产品页: <https://www.trae.ai/solo-web>
- OpenAI Codex Changelog: <https://developers.openai.com/codex/changelog/>
- Codex CLI 完整参考: <https://blakecrosley.com/es/guides/codex>
- Vibe Coding 工具对比: <https://vibe-coding.academy/blog/cursor-3-claude-code-codex-hybrid-stack-vibe-coding-2026/>
- Codex 2026 更新分析: <https://vibe-coding.academy/blog/codex-desktop-control-image-generation-vibe-coding-2026/>
- Claude Code 与 Codex 对比: <https://blog.csdn.net/weixin_65793170/article/details/161883616>
