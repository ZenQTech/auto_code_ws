# Cycle 69 互联网调研报告

**生成时间**: 2026-08-05
**调研范围**: Codex CLI + Trae IDE Solo 模式高级功能
**目标**: 在 Cycle 68（代码库索引 + 多文件原子编辑 + 真实 LLM 思考流）基础上，识别下一批 P0 能力

---

## 1. 调研背景

Cycle 68 已实现以下对标功能：
- ✅ G68-01: CodebaseIndexer（项目代码库索引 + 倒排索引 + BM25）
- ✅ G68-02: ApplyPatchService（V4A 多文件原子编辑 + 事务性 + 冲突检测）
- ✅ G68-03: LLMStreamWrapper（真实 LLM reasoning_content 提取 + ThinkingStream 推送）

本轮调研聚焦三大未实现的高级能力：**容器隔离（Container Isolation）、Session Replay、多模态输入（Voice + Screenshot + Image）**。

---

## 2. 调研维度与发现

### 2.1 容器隔离（Sandbox Executor）

#### 资料来源
- [codex-sandbox - Z7Lab GitHub](https://github.com/Z7Lab/codex-sandbox)（2026-06 更新）
- [OpenAI Codex Agent Approvals & Security](https://developers.openai.com/codex/agent-approvals-security.md)
- [Docker Sandboxes 公告 - 2026-01-30](https://www.docker.com/ja-jp/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
- [Running Codex CLI in Devcontainers and Docker Sandboxes - 2026-04-20](https://codex.danielvaughan.com/2026/04/20/codex-cli-devcontainers-docker-sandboxes-secure-containerised-agents/)
- [codex-lockbox - Egress-restricted Sandbox](https://github.com/paulux84/codex-lockbox)

#### 核心架构发现

| 维度 | Codex codex-sandbox | Docker Sandboxes | 本项目当前实现 |
|------|---------------------|------------------|---------------|
| 隔离机制 | Docker 容器 + bubblewrap | MicroVM + 独立内核 | ❌ 无（直接 subprocess） |
| 资源限制 | CPU/Memory/GPU 预设 | per-VM 分配 | ❌ 无 |
| 网络隔离 | 默认拒绝 + 域名白名单 | 默认拒绝 | ❌ 无 |
| 文件系统隔离 | 仅项目目录可访问 | 仅挂载工作区 | ❌ 无 |
| 凭据隔离 | 单独挂载 auth.json | bind-mount 凭据 | ⚠️ 进程级 |
| Init hook | 可选 sandbox-setup.sh | - | ❌ 无 |
| 镜像分发 | Dockerfile + 多 Node 版本 | sbx CLI | ❌ 无 |

#### 三种隔离层次（Defense in Depth）
1. **OS-level sandbox**: Seatbelt (macOS) / bubblewrap (Linux) - 进程级
2. **Container-level**: Docker / Podman - 内核级
3. **MicroVM-level**: Docker Sandboxes - 硬件虚拟化级

#### 关键安全模式
```python
# Codex Lockbox 的核心模式
DEFAULT_DENY_FIREWALL = True
ALLOWED_DOMAINS = [
    "api.openai.com",
    "api.anthropic.com",
    "*.github.com",
    # 项目特定域名
]
```

#### CI/CD 集成模式
- `codex exec` headless 模式用于 CI
- 容器内执行 + 容器外只读 artifacts
- Webhook 触发自动 review

#### 关键启示
- 容器隔离不是可选项，是生产可用的硬性需求
- 资源限制 + 网络默认拒绝 = 零信任架构
- Init hook 提供项目级环境配置（依赖安装、env 注入）

---

### 2.2 Session Replay（会话回放）

#### 资料来源
- [Codex CLI Rollout Files: Session Recording, Replay - 2026-04-29](https://codex.danielvaughan.com/2026/04/29/codex-cli-rollout-files-session-recording-replay-audit-trails/)
- [Codex CLI Session History Local Search - 2026-06-01](https://codex.danielvaughan.com/2026/06/01/codex-cli-session-history-local-search-rollout-format-knowledge-mining/)
- [codex-replay npm package](https://www.pkgstats.com/pkg:codex-replay)
- [Codex issue #24948 - Session log size growth](https://github.com/openai/codex/issues/24948)
- [Codex conversation on disk: JSONL logs - 2026-07-26](https://m.toutiao.com/group/7668504272212623924/)

#### 核心架构发现

**Rollout JSONL 文件结构**:
```
~/.codex/sessions/
└── 2026/04/29/
    ├── rollout-2026-04-29T08-14-22-a1b2c3d4.jsonl
    └── rollout-2026-04-29T11-45-07-e5f6g7h8.jsonl
```

**每行是一个事件对象**:
```jsonl
{"type": "session_meta", "cwd": "/Users/you/repo", "branch": "main"}
{"type": "message", "role": "user", "content": "为什么构建失败？"}
{"type": "reasoning", "summary": "...", "encrypted_blob": "gAAAA..."}
{"type": "function_call", "name": "shell", "args": {"cmd": "npm test"}}
{"type": "function_call_output", "output": "FAIL src/auth.test.ts"}
{"type": "message", "role": "assistant", "content": "认证测试失败..."}
```

**SQLite 元数据层**:
- `state_5.sqlite` - Thread 目录
- `thread_history_1.sqlite` - 分页副本
- `goals_1.sqlite` - Goal 状态
- `memories_1.sqlite` - Memory 状态

**Replay 渲染功能**:
- Turn-by-turn 播放器
- Reasoning / Tool / System 过滤器
- 时间范围过滤（from/to）
- 主题切换（oxide-blue 等）
- 书签系统（mark "1:Kickoff" "2:Fix"）
- 密钥自动 redaction

**已知问题**:
- 大型 session JSONL 文件可达 700MB-2GB
- `compacted` 记录 + raw tool outputs 占主要体积
- 需要 retention policy + 压缩 + truncation

#### 关键启示
- JSONL 是事实上的标准会话格式
- 持久化 + 索引分离（filesystem + SQLite）
- Replay UI 是核心 UX 改进点
- Retention policy 是必备

---

### 2.3 多模态输入（Voice + Screenshot + Image）

#### 资料来源
- [TRAE Changelog 2026-07](https://www.trae.cn/changelog)
- [TRAE SOLO Features](https://aisharenet.com/en/trae-solo/)
- [Trae IDE: AI-Driven Development Revolution - 2026-01-14](https://createaiagent.net/tools/trae/)
- [TRAE APP - Voice & Text Input](https://apps.apple.com/bh/app/trae-solo-ai-work-assistant/id6761401019)
- [Multimodal RAG with Sentence Embeddings](https://www.traeai.com/en/articles/996c0036-466a-4664-8cf7-30cd5fc507e1)

#### 核心架构发现

| 能力 | Trae SOLO | 本项目当前实现 |
|------|-----------|---------------|
| 语音输入 | ✅ 内置 + 蓝牙麦克风 | ❌ 无 |
| 语音讨论 | ✅ 实时语音对话 | ❌ 无 |
| 图片输入 | ✅ 上传附件/图片 | ❌ 无 |
| 截图预览 | ✅ Browser Use 卡片 | ❌ 无 |
| Multimodal Canvas | ✅ 设计稿 + 生成代码 | ❌ 无 |
| 实时建议 | ✅ 低延迟 inline | ⚠️ 部分 |

**TRAE 核心能力**:
- **Multimodal Interaction**: 自然语言 + 语音 + 图片 + 文件输入
- **Real-time following**: AI 自动切换工具面板
- **Continuous context management**: AI 维护完整上下文
- **Multi-intelligence working together**: 多智能体协作
- **Easy deploy**: Vercel 一键部署
- **Worktree 隔离**: 不同任务在不同 Git 环境执行

**TRAE 移动端**:
- 语音输入
- 拍照上传
- 多端设备互联
- 远程操控电脑端

#### Web Speech API 集成模式
```typescript
// 浏览器端语音识别
const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.onresult = (event) => {
  const transcript = event.results[event.results.length - 1][0].transcript;
  // 推送到后端
};
```

#### Multimodal 输入处理模式
1. 文本 + 图片 → 多模态 LLM (GPT-4o / Claude 3.5 Sonnet)
2. 图片 base64 编码 → 包含在 chat completion
3. 截图自动截取 + 上下文标注

#### 关键启示
- 语音输入是 Solo 模式核心交互方式
- 图片输入提升设计稿 → 代码场景体验
- Web Speech API 是浏览器原生能力
- 多模态 LLM 已支持 text+image 输入

---

## 3. 对标现状总结

### 3.1 已实现功能（Cycle 62-68）

| 能力 | 来源 Cycle | 状态 |
|------|-----------|------|
| 真实 LLM 思考流 | Cycle 62 + 67 | ✅ 100% |
| V4A 多文件原子编辑 | Cycle 68 | ✅ 100% |
| 代码库全文索引 | Cycle 68 | ✅ 100% |
| Reasoning Effort 切换 | Cycle 66 | ✅ 100% |
| Operation-Level Undo | Cycle 66 | ✅ 100% |
| 思考流可视化 | Cycle 67 | ✅ 100% |
| 渐进式 Markdown 渲染 | Cycle 67 | ✅ 100% |
| CSV 批处理 | Cycle 65 | ✅ 100% |
| 真实 CLI 集成 | Cycle 65 | ✅ 100% |
| 阶段检测器 | Cycle 63 | ✅ 100% |
| 自定义 Agent 角色 | Cycle 63 | ✅ 100% |
| PRD 生成器 | Cycle 63 | ✅ 100% |
| 多任务并行 | Cycle 62 | ✅ 100% |
| 嵌入上下文选择器 | Cycle 62 | ✅ 100% |

### 3.2 未实现 / 需加强功能

| 能力 | 优先级 | 复杂度 | 备注 |
|------|--------|--------|------|
| 容器隔离（Sandbox Executor） | P0 | 高 | 需 Docker / MicroVM 集成 |
| Session Replay 系统 | P0 | 中 | JSONL + HTML 渲染 |
| 语音输入 | P0 | 中 | Web Speech API |
| 截图输入 | P1 | 低 | Canvas API |
| 设计稿 → 代码 | P1 | 中 | 多模态 LLM |
| Worktree 任务隔离 | P1 | 中 | Git worktree 集成 |
| Embedding 语义搜索 | P1 | 中 | sentence-transformers |
| Session Retention Policy | P1 | 低 | 自动清理 + 压缩 |

### 3.3 Cycle 69 候选 P0 任务

基于对标度与实现成本，建议 Cycle 69 聚焦：

1. **G69-01: SandboxExecutor（容器隔离执行器）**
   - Docker 容器集成
   - 资源限制（CPU/Memory/GPU preset）
   - 网络默认拒绝 + 域名白名单
   - Init hook 机制
   - 与现有 `CLIExecutor` 解耦
   - **对标**: Codex codex-sandbox + Docker Sandboxes

2. **G69-02: Session Replay System（会话回放）**
   - JSONL rollout 记录（与现有 RolloutWriter 集成）
   - HTML 渲染器（turn-by-turn 播放器）
   - Reasoning / Tool / System 过滤器
   - Retention policy（自动压缩 + 清理）
   - Replay 面板集成到 EmbeddedTools
   - **对标**: codex-replay + Codex session picker

3. **G69-03: VoiceInput + MultimodalInput（语音 + 多模态输入）**
   - Web Speech API 集成（浏览器端 ASR）
   - 图片上传 + base64 编码
   - 截图工具（页面截取 + 编辑）
   - 多模态 LLM 集成（GPT-4o / Claude 3.5）
   - **对标**: Trae SOLO Multimodal Interaction

---

## 4. 风险评估

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| Docker 不可用（Windows/WSL） | 中 | 提供 bubblewrap fallback |
| 容器启动开销大 | 中 | 复用容器池 + 预热 |
| Session JSONL 体积爆炸 | 高 | 实施 retention policy + truncation |
| 语音 API 浏览器兼容性 | 低 | 提供文本输入降级 |
| 多模态 LLM 成本 | 中 | 控制图片大小 + 缓存 |

---

## 5. 参考文献

1. [codex-sandbox - Z7Lab GitHub](https://github.com/Z7Lab/codex-sandbox) - 容器隔离实现
2. [Docker Sandboxes 公告](https://www.docker.com/ja-jp/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/) - MicroVM 隔离
3. [Running Codex CLI in Devcontainers and Docker Sandboxes](https://codex.danielvaughan.com/2026/04/20/codex-cli-devcontainers-docker-sandboxes-secure-containerised-agents/) - 三种隔离方式对比
4. [codex-lockbox](https://github.com/paulux84/codex-lockbox) - Egress-restricted Sandbox
5. [Codex CLI Rollout Files: Session Recording, Replay](https://codex.danielvaughan.com/2026/04/29/codex-cli-rollout-files-session-recording-replay-audit-trails/) - JSONL 格式
6. [Codex CLI Session History Local Search](https://codex.danielvaughan.com/2026/06/01/codex-cli-session-history-local-search-rollout-format-knowledge-mining/) - 会话搜索
7. [codex-replay npm package](https://www.pkgstats.com/pkg:codex-replay) - HTML 渲染
8. [Codex issue #24948](https://github.com/openai/codex/issues/24948) - Session log 体积问题
9. [TRAE Changelog 2026-07](https://www.trae.cn/changelog) - Trae 更新日志
10. [TRAE SOLO Features](https://aisharenet.com/en/trae-solo/) - Solo 模式核心能力
11. [Multimodal RAG with Sentence Embeddings](https://www.traeai.com/en/articles/996c0036-466a-4664-8cf7-30cd5fc507e1) - 语义搜索实现
12. [Trae IDE: AI-Driven Development Revolution](https://createaiagent.net/tools/trae/) - Builder + SOLO 模式对比
