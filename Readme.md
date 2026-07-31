<!--
  Readme.md - Hermes 智能体调度平台 项目门户
  创建日期: 2026-07-31
  整合任务: consolidate-md-docs
  版本: v1.0.0
  来源: 全项目 613 份 .md 文档整合
-->

# Hermes 智能体调度平台

> **企业级 AI 智能体开发与调度平台** | Hermes Agent Scheduling Platform
> **版本**: v6.114.0+（Cycle 41 完成态）
> **最后更新**: 2026-07-31

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18+-61DAFB.svg)](https://reactjs.org/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg)](https://fastapi.tiangolo.com/)
[![Tests](https://img.shields.io/badge/Tests-5715%2B%20passing-brightgreen.svg)]()
[![MCP](https://img.shields.io/badge/MCP-2024--11--05%20100%25-orange.svg)]()

---

## 一、项目概述（Project Overview）

### 1.1 定位
**Hermes 智能体调度平台** 是一套面向生产级 AI 智能体应用的企业级开发与运营平台，覆盖从 LLM 对话、流式响应、多模态处理、RAG 知识库、Tool Use、Agent Loop 编排、多 Agent 协作、长期记忆、反思与自我修正、人机协作审批，到 MCP（Model Context Protocol）生态深度集成的完整能力链。

### 1.2 目标用户
- **AI 应用开发者**：快速构建生产级 LLM 应用
- **企业研发团队**：标准化 AI 智能体开发流程
- **运维工程师**：统一管理 LLM 成本、审计、监控
- **研究人员**：探索 RAG / Agent / Multi-Agent 模式

### 1.3 核心价值
- **统一 LLM Provider 抽象**：4+ Provider（Anthropic / OpenAI / Ollama / Mock）+ 真实 API（DeepSeek / 火山方舟）
- **完整 MCP 协议支持**：MCP 2024-11-05 全部 12 大能力完整实现（100% 覆盖）
- **企业级质量保证**：5715+ 单元测试 + E2E + TypeScript 严格模式 0 错误
- **多模态协作**：图像 / 音频 / 文件 / RAG 全链路
- **智能体自治**：Manager-Worker 协作 + 长期记忆 + 反思 + 审批闭环

### 1.4 项目规模
- **测试总数**: 5715+ 单元测试 + 数百 E2E 断言（100% 通过）
- **核心引擎**: 20+ 个 TypeScript 引擎模块
- **UI 面板**: 25+ 个 React 组件
- **代码量**: 约 50,000+ 行 TypeScript + 15,000+ 行 Python
- **开发周期**: 41+ Cycle（持续循环迭代）
- **文档规模**: 613 份 .md 文档

---

## 二、核心能力（Core Capabilities）

### 2.1 LLM 与多模态（Cycle 36-37）

| 能力 | 引擎 | UI 面板 | 说明 |
|------|------|---------|------|
| LLM Provider Adapter | `llmProviderAdapter.ts` | `LLMProviderPanel.tsx` | 4 Provider 统一抽象（Anthropic/OpenAI/Ollama/Mock） |
| Streaming Response | `streamingResponseEngine.ts` | `StreamingChatPanel.tsx` | 流式会话 + TTFT/ITPS 统计 + 暂停/恢复/取消 |
| Multi-Modal Processor | `multiModalProcessor.ts` | `MultiModalPanel.tsx` | 图像压缩 / 音频录制 / 文件解析 / 多模态融合 |
| Real LLM Provider | `realLLMProvider.ts` | `RealLLMProviderPanel.tsx` | DeepSeek + 火山方舟 Coding Plan |

### 2.2 RAG / Tool Use / Agent Loop（Cycle 37）

| 能力 | 引擎 | UI 面板 | 说明 |
|------|------|---------|------|
| RAG Engine | `ragEngine.ts` | `RAGPanel.tsx` | Vector + BM25 双路召回 + RRF 融合 |
| Tool Use Engine | `toolUseEngine.ts` | `ToolMarketplacePanel.tsx` | OpenAI/Anthropic 协议 + JSONSchema 验证 + 3 执行器 |
| Agent Loop Engine | `agentLoopEngine.ts` | `AgentLoopPanel.tsx` | Agent 循环 + 工具调用 + 状态管理 |

### 2.3 高级智能体（Cycle 38）

| 能力 | 引擎 | UI 面板 | 说明 |
|------|------|---------|------|
| Multi-Agent Engine | `multiAgentEngine.ts` | `MultiAgentCrewPanel.tsx` | Manager-Worker 任务分解 + MessageBus + TaskScheduler |
| Long-Term Memory | `longTermMemory.ts` | `LongTermMemoryPanel.tsx` | MemGPT 风格分层（核心/回忆/归档）+ LRU + 语义检索 |
| Reflection Engine | `reflectionEngine.ts` | `ReflectionPanel.tsx` | Reflexion 反思 + 策略调整 + 预算控制 |
| Human Approval | `humanApprovalEngine.ts` | `HumanApprovalPanel.tsx` | 风险分类 + 审批队列 + 审计日志 |

### 2.4 MCP 协议深度集成（Cycle 39-41）

| 能力 | 引擎 | UI 面板 | 说明 |
|------|------|---------|------|
| MCP Client | `mcpClient.ts` | `McpRegistryPanel.tsx` | JSON-RPC 2.0 + Stdio + SSE + 5 状态机 |
| MCP Registry | `mcpRegistry.ts` | - | 5 内置服务器 + 自定义 |
| MCP Marketplace | `mcpMarketplace.ts` | - | 12 精选服务器 + Bridge |
| MCP Mock Subprocess | `mcpMockSubprocess.ts` | - | 端到端测试框架 |
| MCP Resource | `mcpPromptIntegration.ts` | `McpResourcePanel.tsx` | 资源管理 + 多类型预览 |
| MCP Advanced | `mcpResourceSubscription.ts` + `mcpCompletion.ts` + `mcpSampling.ts` + `mcpRoots.ts` | `McpAdvancedPanel.tsx` | 订阅/补全/采样/根目录（4-Tab 统一面板） |

**MCP 协议能力完整度**: **12/12 = 100%**

### 2.5 其他重要能力（Cycle 15-24）

- **Composer 多文件编辑引擎**（Cycle 16-18）：Plan Mode / 上下文管理 / 全局错误处理
- **跨会话记忆**（Cycle 24）：6 类 type + 3 级 scope + 自动压缩 + 持久化
- **多任务并行编排**（Cycle 24）：8 类任务 + 依赖编排 + 冲突检测 + worktree 隔离
- **语音输入 / Figma 集成**（Cycle 24）：Web Speech API + Figma URL 转代码
- **设计模式 / 背景任务 / 最佳 N**（Cycle 19-21）
- **Plugin 系统 / Goal 长时域模式**（Cycle 12）
- **Worktree 隔离 / LLM-as-Judge 验证层**（Cycle 13）
- **Loop Engineering 端到端工作流**（Phase 6）
- **企业级能力**（Cycle 25-35）：Code Review / Cost / Audit / Edge / Workflow

---

## 三、技术栈（Tech Stack）

### 3.1 前端
- **核心**: TypeScript 5.4+ / React 18 / Vite 5
- **状态管理**: React Hooks + useReducer + useSyncExternalStore
- **UI 库**: 自研组件库 + TailwindCSS + Lucide Icons
- **代码编辑**: Monaco Editor
- **Markdown**: react-markdown + remark-gfm
- **测试**: Vitest + React Testing Library + jsdom
- **类型安全**: TypeScript Strict Mode（0 错误）

### 3.2 后端
- **核心**: Python 3.10+ / FastAPI / SQLAlchemy 异步
- **数据库**: SQLite (开发) / PostgreSQL (生产)
- **认证**: OAuth 2.1 + PKCE + JWT
- **API 风格**: REST + WebSocket + SSE
- **LLM 接入**: Anthropic SDK / OpenAI SDK / 自研 Adapter
- **测试**: pytest + httpx + pytest-asyncio

### 3.3 ROS2 / AGV 仿真（agv_fleet_ws 子模块）
- **核心**: ROS2 Humble / C++17 / Python 3.10
- **构建**: ament_cmake / colcon
- **仿真**: Gazebo Ignition Fortress / Garden
- **平台**: NVIDIA Jetson Orin（目标硬件）
- **传感器**: SICK LiDAR / Xsens IMU

### 3.4 部署 & DevOps
- **容器化**: Docker + docker-compose
- **Web 服务器**: Nginx（前端静态资源）
- **CI/CD**: Git（4 个原子 commit 模式）
- **MCP 生态**: 1000+ 服务器接入能力

---

## 四、目录结构（Directory Structure）

```
auto_code_ws/
├── Readme.md                       # 本文件（项目门户）
├── AGENTS.md                       # 项目开发规范（资深深栈工程师角色）
├── 代码修改日志.md                  # 完整代码修改日志（v6.17.1 ~ v6.114+）
├── document_inventory.md            # 文档清单（整合任务中间产物）
│
├── backend/                         # 后端服务（Python + FastAPI）
│   ├── app/                         # 应用核心
│   │   ├── api/                     # REST 端点
│   │   ├── core/                    # 业务核心（goal/agent/memory/...）
│   │   ├── cli/                     # CLI 命令
│   │   ├── database.py              # 数据库配置
│   │   ├── main.py                  # 应用入口
│   │   └── models.py                # 数据模型
│   ├── tests/                       # 后端测试
│   └── requirements.txt             # Python 依赖
│
├── frontend/                        # 前端应用（TypeScript + React + Vite）
│   ├── src/
│   │   ├── App.tsx                  # 主应用（v2.4.0）
│   │   ├── main.tsx                 # 入口
│   │   ├── components/              # UI 组件（25+ 面板）
│   │   ├── pages/                   # 独立页面
│   │   ├── hooks/                   # React Hooks
│   │   ├── utils/                   # 工具/引擎模块（20+ 引擎）
│   │   │   ├── llmProviderAdapter.ts
│   │   │   ├── streamingResponseEngine.ts
│   │   │   ├── multiModalProcessor.ts
│   │   │   ├── ragEngine.ts
│   │   │   ├── toolUseEngine.ts
│   │   │   ├── agentLoopEngine.ts
│   │   │   ├── realLLMProvider.ts
│   │   │   ├── multiAgentEngine.ts
│   │   │   ├── longTermMemory.ts
│   │   │   ├── reflectionEngine.ts
│   │   │   ├── humanApprovalEngine.ts
│   │   │   ├── mcpClient.ts
│   │   │   ├── mcpRegistry.ts
│   │   │   ├── mcpMarketplace.ts
│   │   │   ├── mcpResourceSubscription.ts
│   │   │   ├── mcpCompletion.ts
│   │   │   ├── mcpSampling.ts
│   │   │   ├── mcpRoots.ts
│   │   │   └── ...                  # 20+ 引擎
│   │   └── router/                  # SPA 路由
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json                # TypeScript 严格模式
│   └── vitest.config.ts
│
├── agv_fleet_ws/                    # AGV 调度子模块（ROS2）
│   ├── README.md                    # 子模块说明
│   ├── src/                         # C++17 / Python 3.10
│   ├── launch/                      # ROS2 launch 文件
│   ├── maps/                        # 地图数据
│   ├── config/                      # 配置
│   ├── docker/                      # Docker 镜像
│   └── docs/                        # 子模块文档
│
├── docs/                            # 架构与需求文档
│   ├── agv_architecture_design.md
│   ├── architecture_design.md
│   ├── architecture_design_v1.0.md
│   ├── architecture_final_v3.0.md
│   ├── architecture_overview.md
│   ├── unified_agv_architecture_v2.0.md
│   ├── ros2_architecture_design.md
│   ├── requirements_v1.0.md
│   ├── requirements_v2.0.md
│   ├── 验收标准.md
│   ├── arch/                        # 顶层架构
│   ├── architecture/                # 架构变体
│   └── requirements/                # 需求变体
│
├── sdks/                            # 多语言 SDK
│   ├── README.md
│   ├── python/                      # Python SDK
│   ├── typescript/                  # TypeScript SDK
│   └── examples/
│
├── cli_integration/                 # CLI 集成
├── hermes_integration/              # Hermes 集成
├── scripts/                         # 脚本工具
├── tests/                           # 集成测试
├── workspace/                       # 历史归档 workspace
│
├── CYCLE2_* ~ CYCLE42_*.md          # 各周期报告（共 254 份）
│   ├── CYCLE{N}_ACCEPTANCE_REPORT.md
│   ├── CYCLE{N}_CODE_MODIFICATION_LOG.md
│   ├── CYCLE{N}_CODEX_TRAE_RESEARCH.md
│   ├── CYCLE{N}_GAP_ANALYSIS.md
│   ├── CYCLE{N}_P{0,1,2}_{N}_SUMMARY.md
│   ├── CYCLE{N}_RESEARCH_REPORT.md
│   ├── CYCLE{N}_SPEC_*.md
│   ├── CYCLE{N}_STARTUP.md
│   └── CYCLE{N}_SUMMARY.md
│
├── CODEX_TRAE_RESEARCH.md           # Codex + TRAE 调研
├── FINAL_VERIFICATION.md            # 终验报告
├── GAP_ANALYSIS_REPORT.md           # 差距分析
├── ITERATION_LOG.md                 # 迭代日志
├── PHASE_3_5_6_7_SUMMARY.md         # 阶段总结
├── IMPLEMENTATION_TASKS.md          # 实施任务
├── P2_1_SUBAGENT_WORKSPACE_REPORT.md
├── tasks.md                         # 任务清单
│
├── .trae/                           # Trae IDE 配置
│   ├── commands/                    # 自定义命令
│   └── specs/                       # Spec 历史（80+ change-id）
│       ├── cycle2/ ~ cycle14/       # 周期归档
│       ├── current/                 # 当前活跃
│       └── consolidate-md-docs/     # 本次整合任务
│
├── docker-compose.yml               # Docker 编排
├── Dockerfile                       # Docker 镜像
├── nginx.conf                       # Nginx 配置
├── package.json
└── run.py                           # 启动脚本
```

---

## 五、Quick Start

### 5.1 环境要求

- **Node.js**: 18.0+
- **Python**: 3.10+
- **操作系统**: Linux (Ubuntu 22.04 推荐) / macOS / WSL2
- **ROS2** (仅 AGV 子模块): Humble Hawksbill
- **Docker** (可选): 24.0+

### 5.2 后端启动

```bash
# 进入后端目录
cd backend

# 创建虚拟环境
python3 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动后端服务
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

后端 API 文档: <http://localhost:8000/docs>

### 5.3 前端启动

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

前端访问: <http://localhost:5173>

### 5.4 启动测试

```bash
# 前端测试
cd frontend
npm run test         # Vitest 运行
npm run test:ui      # 交互式 UI
npm run test:coverage # 覆盖率报告

# 后端测试
cd backend
pytest tests/ -v
```

### 5.5 AGV 仿真启动（可选）

```bash
# 启动 ROS2 工作空间
cd agv_fleet_ws

# Source ROS2
source /opt/ros/humble/setup.bash

# 编译
colcon build --symlink-install

# Source 工作空间
source install/setup.bash

# 启动全系统仿真
ros2 launch agv_bringup full_system.launch.py
```

### 5.6 Docker 一键启动

```bash
# 在项目根目录
docker-compose up -d
```

---

## 六、核心模块索引（Module Index）

> 每个模块详细设计参见 `CYCLE{N}_SPEC_*.md` 或 `.trae/specs/{change-id}/spec.md`

### 6.1 LLM 集成层
- [LLM Provider Adapter](file:///home/qizheng/auto_code_ws/frontend/src/utils/llmProviderAdapter.ts) - 统一 LLM 抽象
- [Real LLM Provider](file:///home/qizheng/auto_code_ws/frontend/src/utils/realLLMProvider.ts) - DeepSeek/火山方舟
- [Streaming Response Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/streamingResponseEngine.ts) - 流式响应

### 6.2 智能体引擎
- [Agent Loop Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/agentLoopEngine.ts) - 智能体循环
- [Multi-Agent Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/multiAgentEngine.ts) - 多智能体协作
- [Long-Term Memory](file:///home/qizheng/auto_code_ws/frontend/src/utils/longTermMemory.ts) - 长期记忆
- [Reflection Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/reflectionEngine.ts) - 反思引擎
- [Human Approval Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/humanApprovalEngine.ts) - 人机审批

### 6.3 RAG / Tool / Multi-Modal
- [RAG Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/ragEngine.ts) - RAG 知识库
- [Tool Use Engine](file:///home/qizheng/auto_code_ws/frontend/src/utils/toolUseEngine.ts) - 工具调用
- [Multi-Modal Processor](file:///home/qizheng/auto_code_ws/frontend/src/utils/multiModalProcessor.ts) - 多模态处理

### 6.4 MCP 协议层
- [MCP Client](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpClient.ts) - MCP 客户端
- [MCP Registry](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpRegistry.ts) - 服务器注册表
- [MCP Marketplace](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpMarketplace.ts) - MCP 市场
- [MCP Resource Subscription](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpResourceSubscription.ts) - 资源订阅
- [MCP Completion](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpCompletion.ts) - 参数补全
- [MCP Sampling](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpSampling.ts) - 服务器采样
- [MCP Roots](file:///home/qizheng/auto_code_ws/frontend/src/utils/mcpRoots.ts) - 根目录管理

### 6.5 主应用组件
- [App.tsx](file:///home/qizheng/auto_code_ws/frontend/src/App.tsx) (v2.4.0) - 主应用
- [AppLayout.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/AppLayout.tsx) (v6.114.0) - 布局
- [BrandHeader.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/BrandHeader.tsx) (v2.21.0) - 品牌头

---

## 七、版本演进（Version Evolution）

### 7.1 关键里程碑

| 阶段 | Cycle | 核心里程碑 | 累计测试 |
|------|-------|------------|----------|
| 平台基础 | C1-C15 | CLI / Web UI / LLM 集成 / Loop Engineering | ~3300 |
| Composer 引擎 | C16-C18 | Plan Mode / 上下文管理 / 全局错误处理 | ~3500 |
| 高级能力 | C19-C22 | 背景任务 / 最佳 N / 设计模式 | ~3700 |
| 跨会话能力 | C23-C24 | 记忆 / 多任务 / 语音 / Figma | ~2403（v6.x 累计） |
| 企业级 | C25-C35 | Code Review / Cost / Audit / Edge / Workflow | ~3500 |
| **LLM 统一** | **C36** | LLM Provider + 流式 + 多模态 | **4822** |
| **RAG + Agent** | **C37** | RAG + Tool Use + Agent Loop + 真实 LLM | ~5100 |
| **高级 Agent** | **C38** | 多 Agent + 长期记忆 + 反思 + 审批 | **5209** |
| **MCP 核心** | **C39** | MCP Client + Registry + Marketplace | ~5400 |
| **MCP 高级** | **C40-C41** | 资源/提示词 + 订阅/补全/采样/根目录 | **5715** |

### 7.2 当前状态（Cycle 41 完成态）
- **应用版本**: v6.114.0
- **测试总数**: 5715+ passing
- **TypeScript 严格模式**: 0 错误
- **测试文件**: 199 个
- **MCP 协议覆盖**: 12/12 = 100%
- **核心引擎**: 20+ 个
- **UI 面板**: 25+ 个

### 7.3 下一阶段（Cycle 42+ 建议方向）
- **A. MCP × Hermes 深度融合**（推荐）：MCP 工具/资源/提示词完整集成到 Hermes
- **B. MCP 性能优化**：缓存、连接池、并发优化
- **C. MCP 协议可视化调试器**：UI 调试 MCP 消息流
- **D. 真实 MCP 服务器连接测试**：对接 1000+ 生态服务器

---

## 八、文档导航（Documentation Navigation）

### 8.1 项目级文档
- 📘 [Readme.md](file:///home/qizheng/auto_code_ws/Readme.md) - **本文件（项目门户）**
- 📋 [AGENTS.md](file:///home/qizheng/auto_code_ws/AGENTS.md) - 项目开发规范
- 📜 [代码修改日志.md](file:///home/qizheng/auto_code_ws/代码修改日志.md) - 完整代码修改日志（v6.17.1 ~ v6.114+）
- 📊 [document_inventory.md](file:///home/qizheng/auto_code_ws/document_inventory.md) - 文档清单
- 🔍 [CODEX_TRAE_RESEARCH.md](file:///home/qizheng/auto_code_ws/CODEX_TRAE_RESEARCH.md) - Codex + TRAE 调研

### 8.2 周期报告（CYCLE 2 ~ 42）
- 共 254 份报告，按 `CYCLE{N}_*.md` 命名
- 涵盖：Acceptance / Code Modification Log / Gap Analysis / Research / SPEC / Summary / Startup
- 索引：见 [代码修改日志.md 附录 A ~ H](file:///home/qizheng/auto_code_ws/代码修改日志.md)

### 8.3 Spec 历史档案
- [`.trae/specs/`](file:///home/qizheng/auto_code_ws/.trae/specs/) - 80+ change-id 目录
- 每个目录含 `spec.md` + `tasks.md` + `checklist.md`

### 8.4 架构与需求文档
- [docs/](file:///home/qizheng/auto_code_ws/docs/) - 23 份架构/需求/验收文档
- [agv_architecture_design.md](file:///home/qizheng/auto_code_ws/docs/agv_architecture_design.md)
- [architecture_design.md](file:///home/qizheng/auto_code_ws/docs/architecture_design.md)
- [architecture_final_v3.0.md](file:///home/qizheng/auto_code_ws/docs/architecture_final_v3.0.md)
- [requirements_v1.0.md](file:///home/qizheng/auto_code_ws/docs/requirements_v1.0.md)
- [requirements_v2.0.md](file:///home/qizheng/auto_code_ws/docs/requirements_v2.0.md)
- [验收标准.md](file:///home/qizheng/auto_code_ws/docs/验收标准.md)

### 8.5 AGV 子模块
- [agv_fleet_ws/README.md](file:///home/qizheng/auto_code_ws/agv_fleet_ws/README.md) - AGV ROS2 调度平台说明

### 8.6 SDK
- [sdks/README.md](file:///home/qizheng/auto_code_ws/sdks/README.md) - Python / TypeScript SDK

---

## 九、测试与质量（Testing & Quality）

### 9.1 测试规模
- **总测试数**: 5715+ 单元测试（100% 通过）
- **E2E 断言**: 数百个跨模块断言
- **测试文件**: 199 个
- **覆盖维度**: 单元 + 集成 + E2E + 性能基准

### 9.2 质量门禁
- ✅ TypeScript 严格模式 0 错误
- ✅ 所有测试 100% 通过
- ✅ 4 原子 Git commit 模式
- ✅ 主应用版本号严格管理（App/AppLayout/BrandHeader/useModals）

### 9.3 关键质量指标

| 指标 | 当前值 | 目标 |
|------|--------|------|
| TypeScript 错误 | 0 | 0 |
| 测试通过率 | 100% | 100% |
| 核心引擎版本 | v1.0.x | 稳定 API |
| MCP 协议覆盖 | 100% | 100% |
| 文档覆盖率 | 100% | 100% |

### 9.4 CI/CD 流程
- 每个 Cycle 4 个原子 commit：
  1. 核心引擎（Core Engines）
  2. UI 面板 + 集成（UI Panels + Integration）
  3. 验收报告（Acceptance Report）
  4. 下一周期启动（Next Cycle Startup）
- 详见 [`代码修改日志.md`](file:///home/qizheng/auto_code_ws/代码修改日志.md)

---

## 十、贡献指南（Contributing）

### 10.1 开发流程（Loop Engineering）

本项目采用"系统性循环工程"开发模式，每个 Cycle 包含 7 个阶段：

1. **Phase 1: 调研** - 产出 `_CODEX_TRAE_RESEARCH.md` / `_RESEARCH_REPORT.md`
2. **Phase 2: 差距分析** - 产出 `_GAP_ANALYSIS.md`
3. **Phase 3: SPEC 编写** - 产出 `_SPEC_*.md`
4. **Phase 4: 核心引擎开发** - 产出引擎模块 + 单元测试
5. **Phase 5: UI + 集成** - 产出 UI 面板 + 主应用集成
6. **Phase 6: 测试验证** - TypeScript + Vitest + E2E
7. **Phase 7: 验收 + 提交** - 产出 `_ACCEPTANCE_REPORT.md` + Git commit

### 10.2 命名规范

- **根目录报告**: `CYCLE{N}_*.md`（如 `CYCLE42_STARTUP.md`）
- **Spec 目录**: `.trae/specs/{change-id}/`
- **核心引擎**: `{moduleName}Engine.ts` / `{moduleName}Engine.test.ts`
- **UI 面板**: `{ModuleName}Panel.tsx` / `{ModuleName}Panel.test.tsx`
- **版本号**: 遵循 Semantic Versioning（MAJOR.MINOR.PATCH）

### 10.3 分支策略

- `main`: 稳定主分支
- `cycle/{N}-{feature}`: 周期开发分支
- `fix/{issue}`: 修复分支
- `docs/{update}`: 文档更新分支

### 10.4 提交规范

每个 Cycle 4 个原子 commit：
1. `feat(core): G{N}-{M} {module} core engine`
2. `feat(ui): G{N}-{M} {module} UI panel + integration`
3. `docs(cycle): G{N} acceptance report + code modification log`
4. `chore(cycle): CYCLE{N+1} startup document`

---

## 十一、许可证与致谢（License & Credits）

### 11.1 许可证
本项目采用 **MIT License** 开放源代码（具体参见 LICENSE 文件）。

### 11.2 致谢

- **Anthropic Claude** - LLM 与 Claude Code 范式
- **OpenAI** - GPT 系列与 API 规范
- **MCP (Model Context Protocol)** - 1000+ 服务器生态
- **Codex + TRAE SOLO** - Vibe Coding 范式参考
- **开源社区** - React / TypeScript / FastAPI / ROS2 等

### 11.3 主要贡献者
- **平台架构师**: 设计 Hermes 整体架构
- **前端工程师**: 25+ UI 面板 + 主应用集成
- **后端工程师**: FastAPI + SQLAlchemy + Plugin 系统
- **AGV 工程师**: ROS2 多 AGV 调度（agv_fleet_ws 子模块）
- **测试工程师**: 5715+ 单元测试 + E2E 体系建设
- **文档工程师**: 613 份 .md 文档维护

---

## 十二、相关链接（Links）

### 12.1 项目内部
- [项目门户（本文件）](file:///home/qizheng/auto_code_ws/Readme.md)
- [代码修改日志](file:///home/qizheng/auto_code_ws/代码修改日志.md)
- [AGENTS.md](file:///home/qizheng/auto_code_ws/AGENTS.md)
- [AGV 子模块](file:///home/qizheng/auto_code_ws/agv_fleet_ws/README.md)
- [SDK 文档](file:///home/qizheng/auto_code_ws/sdks/README.md)

### 12.2 外部参考
- [Anthropic Claude](https://www.anthropic.com/) - LLM 提供商
- [OpenAI](https://openai.com/) - LLM 提供商
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP 协议
- [ROS2 Humble](https://docs.ros.org/en/humble/) - ROS2 文档
- [FastAPI](https://fastapi.tiangolo.com/) - Python Web 框架
- [React](https://react.dev/) - 前端框架

---

## 十三、版本信息

| 属性 | 值 |
|------|-----|
| 文档版本 | v1.0.0 |
| 创建日期 | 2026-07-31 |
| 最后更新 | 2026-07-31 |
| 整合任务 | consolidate-md-docs |
| 关联项目版本 | v6.114.0+（Cycle 41 完成态） |
| 文档规模 | 约 600 行 |

---

> **📌 新成员提示**: 建议按以下顺序阅读本文档：
> 1. 第一章（项目概述）- 5 分钟了解平台定位
> 2. 第二章（核心能力）- 10 分钟了解能力矩阵
> 3. 第五章（Quick Start）- 15 分钟启动开发环境
> 4. 第六章（核心模块索引）- 深入了解感兴趣的模块
> 5. 第八章（文档导航）- 定位详细设计文档
>
> 总计约 30 分钟可建立完整项目认知。

---

**文档结束** | End of Document
