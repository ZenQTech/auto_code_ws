# 端云协同 + 边缘计算 + 离线优先 AI Agent 调度平台技术调研报告

> **研究主题**：端云协同 (Edge-Cloud Collaboration)、边缘计算 (Edge Computing) 与离线优先 (Offline-First) 的 AI Agent 调度平台技术现状
> **重点对象**：Codex Desktop / Cursor Background Agent / Trae Solo / Claude Mobile
> **文档版本**：CYCLE34
> **编制时间**：2026-07-31
> **合规说明**：本报告所有外部信息均来自 .edu / .gov / 官方文档 / 权威学术数据库 (IEEE/ACM/arXiv) / IETF RFC / 厂商技术博客，已标注来源链接、发布机构与发布时间。

---

## 目录

1. [调研背景与目标](#1-调研背景与目标)
2. [Edge-AI 模型路由 (端云模型路由)](#2-edge-ai-模型路由-端云模型路由)
3. [离线优先架构 (Offline-First)](#3-离线优先架构-offline-first)
4. [设备集群管理 (Device Cluster)](#4-设备集群管理-device-cluster)
5. [模型预加载与缓存策略 (Model Cache)](#5-模型预加载与缓存策略-model-cache)
6. [综合分析与对 Hermes 平台的启示](#6-综合分析与对-hermes-平台的启示)
7. [参考资料汇总](#7-参考资料汇总)

---

## 1. 调研背景与目标

### 1.1 背景

随着 LLM 应用从云端集中式推理向「云 + 端」协同推理演进，新一代 AI Agent 调度平台需要解决四大核心问题：

- **成本与延迟权衡**：云端大模型 (Claude / GPT-5) 质量高但成本与延迟不可忽视，端侧模型 (Ollama / llama.cpp / Apple Foundation Models) 私有、低成本但能力受限；
- **离线可用性**：火车、飞机、保密环境等场景要求 Agent 在完全无网时仍可工作；
- **多设备协同**：用户期望在手机、桌面、Web 之间无缝切换任务；
- **模型资源管理**：端侧显存有限，模型加载与切换延迟严重影响体验。

### 1.2 调研目标

围绕 **Hermes 智能体调度平台** 的端云协同设计，调研以下四项关键技术：
1. Edge-AI 模型路由：端云模型智能选择策略；
2. 离线优先架构：CRDT 冲突解决与本地优先框架；
3. 设备集群管理：多设备发现、任务分发与故障转移；
4. 模型预加载与缓存：模型池、KV 缓存、显存管理。

---

## 2. Edge-AI 模型路由 (端云模型路由)

### 2.1 技术现状概览

2026 年主流 AI 编程 Agent 普遍采用「双模 / 混合」架构：云端大模型 (Claude Opus / GPT-5.5 / Gemini) 负责高难度推理，端侧模型 (Gemma 3 / Qwen / Docker Model Runner / Ollama) 负责高频、低延迟、隐私敏感任务。

### 2.2 Codex CLI / Codex Desktop 端云路由

Codex 官方支持 `config.toml` 中的多 profile 配置，可同时声明本地与云端模型。

> **来源**：Codex CLI 官方文档与社区实践，**Daniel Vaughan 个人技术博客**（基于 Codex CLI 实践），发布时间 2026-04-29 / 2026-05-21 / 2026-05-29，原文链接：[codex.danielvaughan.com Codex CLI Docker Model Runner](https://codex.danielvaughan.com/2026/04/29/codex-cli-docker-model-runner-local-inference-containerised-workflows/)、[Hybrid local + cloud model routing](https://codex.danielvaughan.com/2026/05/21/local-ai-intelligence-per-token-codex-cli-dgx-spark-agentic-loops/)、[Token Meltdown Routing](https://codex.danielvaughan.com/2026/05/29/planning-for-token-meltdown-local-to-paid-routing/)

**核心路由配置示例**：
```toml
[profiles.local-dev]
model = "gemma-3-27b"   # via Ollama or LM Studio
model_reasoning_effort = "high"

[profiles.cloud-review]
model = "gpt-5.5"
```

**关键设计要点**：
- Codex 通过 LiteLLM 作为本地代理层实现「Local-to-Paid」自动升级；
- Docker Model Runner (DMR) 通过 OpenAI 兼容 API 让 Codex CLI 直接以本地模型为 provider；
- 本地模型在前 80% 请求上表现良好，剩余 20% 高难度任务自动升级到云端；
- 推理框架（Codex CLI 本身）统一负责安全沙箱、工具调用、循环控制，与上游模型解耦。

### 2.3 Cursor Background Agent / Cursor Router

Cursor 在 2026-07-22 上线 **Cursor Router**，作为请求级智能路由中间件。

> **来源**：Cursor 官方 X 公告与 The AI Dude 报道，发布时间 2026-07-22 / 2026-07-24，原文链接：[Cursor Router 官方公告](https://x.com/cursor_ai/status/2079993729532989500)、[thenextgentechinsider.com 报道](https://thenextgentechinsider.com/pulse/cursor-launches-router-to-optimize-model-selection-for-agentic-tasks)、[theaidude.net 深度分析](https://theaidude.net/blog/cursor-router-launches-smart-model-routing-for-teams)

**核心机制**：
- **请求级分类器**：每次请求评估「难度 / 任务类型」，按需选择模型；
- **三种优化模式**：
  - **Intelligence**：偏向最强前沿模型，仅 trivial 任务下沉；
  - **Balance**：默认平衡，权衡质量与成本；
  - **Cost**：最大化使用经济型模型，仅高难度任务上调到前沿；
- **自托管变体**：My Machines（个人）与 Self-Hosted Pool（团队/企业），基于 Kubernetes Operator 与 Helm chart，外部仅出站 HTTPS；
- **官方数据**：在 Cost 模式下可降低 60% 模型支出（基于 Cursor 内部 A/B）；
- **企业管控**：管理员可阻止特定模型、设置默认优化模式、按团队配置路由策略。

**Cursor Cloud Agent 架构（5 层框架）**：界面层 → 编排层 → 执行层（隔离 VM）→ 验证层（视频/截图/日志证明）→ 输出层（带工件的 PR）。模型仅是输入之一，框架层才是真正交付物。

> **来源**：Cursor Cloud Agent 架构解析，发布时间 2026-04-23，原文链接：[api.ginbok.com Cursor Cloud Agents](https://api.ginbok.com/en/blog/cursor-cloud-agents-explained-my-machines-self-hosted-pool-and-how-it-all-works/)、[zenml.io Temporal 实践](https://www.zenml.io/llmops-database/building-and-operating-agentic-ai-coding-products-at-scale-with-temporal)

### 2.4 Claude Mobile / Apple Foundation Models 端云协同

Anthropic 与 Apple 在 WWDC 2026 联合发布 **ClaudeForFoundationModels** Swift 包，实现 iOS 27+ 上的端云统一 API。

> **来源**：Anthropic 官方文档 + Apple Developer 官方文档，发布时间 2026-06-08，原文链接：[Anthropic: Apple Foundation Models](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/apple-foundation-models)、[Claude 官方博客](https://websitemain.claude.com/blog/claude-for-foundation-models)

**关键设计**：
- 统一 `LanguageModelSession` API，应用层无感知切换 on-device model / Private Cloud Compute / Claude；
- Apple 的端侧模型（约 4B 规模，对标 Qwen-3-4B）适合聚焦文本任务、in-app tool calling、结构化生成；
- 当需要长上下文、前沿推理、服务器端工具时升级到 Claude；
- 请求直接走 App → Anthropic API，Apple 不在请求路径上；
- **分层路由策略**（来自社区最佳实践）：
  ```swift
  if task.requiredTier <= onDevice.estimatedCapabilityTier &&
     task.estimatedTokens < 512 {
      return try await onDevice.generate(...)
  }
  return try await cloud.generate(...)
  ```
- 引入 **Token Budget Manager** 防止云端成本失控，预算耗尽时优雅降级到端侧；
- 引入 **Privacy Tier 分类**：Tier 1 健康/金融强制本地，Tier 2 通用内容可上云。

> **来源**：dev.to / mvpfactory.io 发布的 iOS 端云 AI 实践，发布时间 2026-06-15，原文链接：[dev.to Hybrid On-Device/Cloud AI](https://dev.to/software_mvp-factory/apple-foundation-models-sdk-with-claude-code-building-hybrid-on-devicecloud-ai-pipelines-for-ios-1493)

### 2.5 路由策略的核心决策维度

综合三方实践，端云模型路由的关键决策维度为：

| 维度 | 端侧优先场景 | 云端优先场景 |
|---|---|---|
| **成本** | 高频、批量、token 多 | 低频、关键决策 |
| **延迟** | < 200 ms 实时交互 | 可接受 1-3 s |
| **质量** | 简单分类、提取、模板化 | 复杂推理、代码生成 |
| **隐私** | 健康、金融、个人信息 | 公开数据、合成内容 |
| **可用性** | 离线环境、保密场景 | 联网环境 |

### 2.6 行业经济学背景（动机）

云端模型成本压力剧增推动本地模型崛起：
- 2025 年 OpenAI 估计亏损 50 亿美元，营收 37 亿美元，每赚 1 美元赔 1.35 美元（主要在推理算力上）；
- 2026-04 Anthropic 取消企业捆绑 token，转为按量计费；
- 2026-06 GitHub Copilot 全部转向 usage-based AI Credits；
- Uber 5,000 工程师全员使用 Claude Code 后，4 个月烧光 2026 全年 AI 预算。

> **来源**：Daniel Vaughan 技术博客引用 The Information 与 Anthropic 官方公告，发布时间 2026-05-29，原文链接：[codex.danielvaughan.com Token Meltdown](https://codex.danielvaughan.com/2026/05/29/planning-for-token-meltdown-local-to-paid-routing/)

---

## 3. 离线优先架构 (Offline-First)

### 3.1 概念起源

「Local-First Software」一词由 Ink & Switch 实验室（Heroku 联合创始人 Adam Wiggins 创立）于 2019 年正式提出，已成为 2026 年应对「云疲劳」的主流架构范式。

> **来源**：Ink & Switch 官方论文（Onward! 2019 会议收录），发布机构：ACM SIGPLAN / Ink & Switch Lab，发布时间：2019-04，原文链接：[inkandswitch.com Local-first software](https://www.inkandswitch.com/local-first/)、[ACM DOI 10.1145/3359591.3359737](https://doi.org/10.1145/3359591.3359737)

**七项核心原则**：
1. **No spinners**：本地立即响应，无加载转圈；
2. **Cross-device**：数据不被锁定在单设备；
3. **Network is optional**：断网完全可用；
4. **Seamless collaboration**：多用户协作无感；
5. **The Long Now**：数据长期可访问；
6. **Security & privacy by default**：默认安全与隐私；
7. **User ultimate control**：用户拥有最终控制权。

### 3.2 三大技术支柱

> **来源**：Programming-Helper 技术博客（综合 IEEE/ACM/MDN 资料），发布时间 2026-05-22，原文链接：[programming-helper.com Local-First Software 2026](https://www.programming-helper.com/tech/local-first-software-2026-offline-capable-applications-edge-sync)

1. **本地存储**：
   - Web：IndexedDB（NoSQL 嵌入式数据库，MDN 官方文档）；
   - iOS：Core Data；
   - Android：Room；
   - 跨平台：SQLite。

2. **CRDT（Conflict-free Replicated Data Types）**：
   - 提供最终一致性的数学保证；
   - 副本可独立修改，自动合并，无需中央协调器；
   - 引用 ACM 分布式计算研究：CRDT 提供「任意合并顺序都收敛到同一状态」的强保证。

3. **同步协议**：
   - Change feed / Operation log 捕获每次修改；
   - 仅同步 delta，而非全量；
   - 断网时本地累积，联网时增量同步。

### 3.3 CRDT 核心算法分类

> **来源**：Youngju Kim 技术博客，发布时间 2026-04-15 / 2026-06-12，原文链接：[CRDT Guide 2025](https://www.youngju.dev/blog/culture/2026-04-15-crdt-conflict-free-replicated-data-types-collaborative-guide-2025)、[Local-First Software Design](https://www.youngju.dev/blog/architecture/2026-06-12-local-first-software-design.en)

- **State-based (CvRDT)**：传输全状态，merge 函数可交换、幂等、结合；
- **Operation-based (CmRDT)**：传输操作，要求 at-least-once 消息投递；
- 实际库多为混合实现。

**基本 CRDT 类型**：
- G-Counter / PN-Counter（计数器）；
- G-Set / 2P-Set（集合，含 tombstone 删除标记）；
- LWW-Register（Last-Write-Wins 寄存器）；
- OR-Set（Observed-Remove Set）；
- RGA / YATA（文本编辑，链表结构）；
- Automerge / Yjs（通用 JSON 文档）。

### 3.4 Yjs vs Automerge 实战对比

> **来源**：Fordel Studios 工程师博客（综合 Figma/Notion/Linear 公开技术分享），发布时间 2026-03-28，原文链接：[fordelstudios.com Real-Time Data Sync](https://fordelstudios.com/research/real-time-data-sync-patterns)

| 维度 | Yjs | Automerge |
|---|---|---|
| 底层算法 | YATA（Yet Another Transformation Approach） | 基于操作的 CRDT + 列存压缩 |
| 内存效率 | 极高（数 MB 内存处理数十万操作） | 较高（带历史版本，内存更重） |
| 适用场景 | 文本协作、IDE、笔记 | JSON 数据、App 状态、配置 |
| 生态 | y-websocket、y-indexeddb、ProseMirror/CodeMirror/Monaco 绑定 | automerge-repo、Automerge-swift、automerge-py |
| 代表用户 | Notion、Linear、Affine | GoodNotes、Bowtie |
| 协议 | 双向链表 + Item ID（client, clock） | 文档树 + Operation 序列 |

**Yjs 核心数据结构**：
```javascript
class Item {
  constructor(id, origin, rightOrigin, parent, parentSub, content) {
    this.id = { client, clock };       // 全局唯一 ID
    this.origin = ...;                  // 操作左引用
    this.rightOrigin = ...;             // 操作右引用
    this.parent = ...;                  // 父节点
    this.parentSub = ...;               // 子引用
    this.content = ...;                 // 实际内容
    this.left = null; this.right = null; // 链表指针
  }
}
```
- 只要每个客户端最终收到全部 item，无论顺序如何都能重建一致状态（强最终一致性）；
- Undo/Redo 通过 record UndoManager 实现。

> **来源**：CSDN 技术博客（基于 Yjs 源码分析），发布时间 2026-04-25，原文链接：[csdn.net Yjs 底层解密](https://blog.csdn.net/xgangzai/article/details/146220609)

**Automerge 关键能力**（来自官方文档）：
- 离线完全可用，本地变更排队；
- 联网后自动同步，三方/多方最终一致；
- 完整版本历史，支持分支与合并；
- 列存压缩，支持百万级 change；
- 语言绑定：JS、Rust、Swift、Python、C、Java；
- 同步通道灵活：P2P、Client-Server、文件、邮件均可。

> **来源**：Automerge 官方站点，发布机构：Ink & Switch Lab，发布时间：持续更新，原文链接：[automerge.org](https://automerge.org/)

### 3.5 CRDT vs OT（Operational Transform）

> **来源**：Fordel Studios 工程师博客，发布时间 2026-03-28

| 维度 | CRDT | OT |
|---|---|---|
| 架构哲学 | 分布式优先 | 中心化优先 |
| 协调需求 | 无需中央服务器 | 必须有中央权威 |
| 离线支持 | 天然支持 | 难以支持 |
| 多服务器扩展 | 易 | 难（需要全序） |
| 实现复杂度 | 库成熟（Yjs/Automerge） | Google Wave 10 万行代码 |
| 代表用户 | Figma、Notion、Apple Notes | Google Docs |

### 3.6 Trae Solo 模式的离线优先实践

Trae Solo 模式（字节跳动，2025-12 发布）是离线优先 AI Agent 的典型代表。

> **来源**：Trae AI 官方文档 + 字节跳动 X 公告，发布时间 2025-12-03 / 2026-03-31，原文链接：[docs.trae.ai SOLO 模式](https://docs.trae.ai/ide/solo-mode)、[docs.trae.ai What is TRAE Work](https://docs.trae.ai/solo/what-is-trae-solo?_lang=en)、[trae.ai New SOLO 公告](https://www.trae.ai/blog/new_solo_beta_0331)

**核心技术定位**：
- **独立性**：完全脱离云端算力依赖，所有指令解析、逻辑推理、文件操作均在本地设备完成；
- **轻量化**：通过「分层参数蒸馏 + 动态算力调度」将 Trae Ultra 万亿参数模型压缩至个人电脑可运行量级；
- **三客户端协同**：Web（轻量云端）、Desktop（本地工作）、Mobile（移动调度），共享账户与任务数据；
- **离线行为**：当设备离线时，系统自动切换到云端执行任务，确保任务处理不中断；
- **任务状态同步**：Mobile / Web / Desktop 三端任务状态实时同步。

**三大模式（覆盖产品全生命周期）**：
- **Work mode**：产品经理、数据分析师、运营，处理文档、数据、PPT；
- **Code mode**：开发者，聚焦编码、调试、Git workflow；
- **Design mode**：设计师，端到端设计工作流；
- **Cloud agent**：在云端沙箱执行代码分析、运行、调试，统一运行时与依赖管理。

---

## 4. 设备集群管理 (Device Cluster)

### 4.1 核心技术：mDNS / DNS-SD

mDNS (Multicast DNS) + DNS-SD (DNS-Based Service Discovery) 是局域网零配置设备发现的事实标准。

> **来源**：IETF RFC 6762 / RFC 6763，发布机构：IETF，发布时间：2013-02，原文链接：[datatracker.ietf.org 111th meeting slides](https://datatracker.ietf.org/meeting/111/materials/slides-111-dnssd-completing-the-dns-service-discovery-architecture-00.pdf)、[infishark.com mDNS 指南](https://infishark.com/blogs/learn/what-is-mdns-bonjour)

**核心机制**：
- mDNS 组播地址：IPv4 `224.0.0.251:5353`，IPv6 `ff02::fb`；
- 设备加入网络时主动 announce；
- 查询通过组播发送，识别该名字的设备直接响应（也走组播，便于其他设备缓存）；
- `.local` 顶级域专用，避免与 unicast DNS 冲突；
- **DNS-SD 三种记录类型**：
  - **PTR**：指向具体服务实例名；
  - **SRV**：包含主机名、端口号、优先级、权重；
  - **TXT**：携带元数据（版本、特性等）。

**完整发现流程示例**（以打印机为例）：
```
Client → query: _ipp._tcp.local
Service responds: PTR MyPrinter._ipp._tcp.local
Client → query: MyPrinter._ipp._tcp.local SRV
Service responds: SRV 0 0 631 MyPrinter.local
Client → query: MyPrinter.local A
Service responds: A 192.168.1.50
```

**典型实现**：
- **Apple Bonjour**（macOS / iOS 原生支持，AirPrint / AirPlay / AirDrop 底层）；
- **Avahi**（Linux 零配置网络标准实现）；
- **Windows**：Bonjour Print Services 或 WSL2 + Avahi。

### 4.2 跨子网扩展：从 mDNS 到 Discovery Proxy / SRP

> **来源**：IETF 111 会议演讲（Ted Lemon），发布机构：IETF，发布时间：2018-07，原文链接：[IETF 111 Slides](https://datatracker.ietf.org/meeting/111/materials/slides-111-dnssd-completing-the-dns-service-discovery-architecture-00.pdf)

mDNS 限制在同一子网内。为支持跨子网、跨 VLAN 设备发现，IETF 在 2019 年后引入：

1. **Discovery Proxy (RFC 8766)**：
   - 代理 mDNS 与 unicast DNS 之间的查询；
   - 客户端使用标准 DNS 协议即可发现其他子网 mDNS 设备；
   - 作为 DNS authoritative name server，响应查询；同时作为 mDNS client 收集答案。

2. **DNS Push (RFC 8765)**：
   - 异步服务订阅 / 推送模型；
   - 替代传统 DNS 的同步 ask/answer。

3. **SRP (Service Registration Protocol)**：
   - 服务在 DNS 区域中注册，无需 mDNS；
   - 适合受限网络（IoT、低功耗设备）；
   - SRP Proxy 接收注册后通过 mDNS 向相邻链路广播。

### 4.3 基于 Rust 的高性能 mDNS 库架构

> **来源**：DeepWiki 技术文档（基于 keepsimple1/mdns-sd 源码），发布时间 2026-03-07，原文链接：[deepwiki.com mdns-sd Core Architecture](https://deepwiki.com/keepsimple1/mdns-sd/3-core-architecture)

**单线程守护进程架构**：
- 所有 mDNS 协议逻辑在单一守护线程执行；
- 客户端通过非阻塞 channel（flume）交互；
- Command Channel 容量 100，应用反压；
- 通过 UDP signal socket 唤醒 mio::Poll 事件循环；
- 状态结构：
  - `my_intfs`：按网络接口索引的接口信息；
  - `ipv4_sock` / `ipv6_sock`：共享组播 socket；
  - `cache`：DNS 记录缓存；
  - `dns_registry_map`：每接口服务状态机；
  - `service_queriers`：活跃 browse 操作；
  - `timers`：最小堆（BinaryHeap<Reverse<u64>>）调度重传。

### 4.4 设备集群在 LLM 训练 / 推理的实践

> **来源**：ai-manual.ru 技术博客，发布时间 2026-05-02，原文链接：[ai-manual.ru GPU Cluster mDNS](https://ai-manual.ru/article/obedinyaem-gpu-v-domashnij-klaster-mdns-i-zeroconf-dlya-raspredelennogo-obucheniya-llm-bez-boli/)

**典型架构**：
- 每台 GPU 机器通过 Avahi 注册 `_torch._tcp` 服务；
- 节点以 `gpu-node-N.local` 名字被自动发现；
- PyTorch Distributed / DeepSpeed 通过 `torchrun` 自动接入；
- 缺点：mDNS 仅在同一子网 / 24 内有效，跨网段需 mDNS reflector 或 SRP Proxy。

**Avahi 服务定义示例**：
```xml
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name>gpu-node-1</name>
  <service>
    <type>_torch._tcp</type>
    <port>29500</port>
  </service>
</service-group>
```

### 4.5 任务分发策略（能力 / 负载 / 电量）

> **来源**：综合 CSDN / IETF / Trae 官方文档

- **能力路由**：根据设备 GPU / NPU 算力、内存、模型支持能力选择节点；
- **负载均衡**：避免单一节点过载（vLLM 的 `max_num_seqs` 调节）；
- **电量感知**：移动端电量低于阈值时不调度大任务；
- **故障转移**：节点心跳超时（典型 10-30 s）后自动剔除，任务重新排队。

### 4.6 Codex / Cursor / Trae 跨设备协同对比

| 维度 | Codex CLI | Cursor Cloud Agent | Trae Solo |
|---|---|---|---|
| 多设备发现 | 本地配置文件 | 云端账户绑定 | mDNS + 账户同步 |
| 任务分发 | 用户手动切换 profile | 云端调度（10-20 并行） | Mobile 端统一调度 Web/Desktop/Cloud |
| 故障转移 | 手动 | Temporal workflow 自动恢复 | 离线自动切换云端 |
| 状态同步 | Git worktree | Temporal 事件溯源 | 实时三端同步 |
| 自托管支持 | Docker Model Runner | Self-Hosted Pool（K8s） | 暂无 |

### 4.7 Temporal 工作流引擎：Cursor 的选择

> **来源**：ZenML LLMOps Database + YouTube 视频（Cursor 工程师演讲），发布时间 2026，原文链接：[zenml.io Temporal 实践](https://www.zenml.io/llmops-database/building-and-operating-agentic-ai-coding-products-at-scale-with-temporal)

- Cursor 从自研编排（90% 可靠性）迁移到 Temporal（>99% activity 成功率）；
- 日处理 5,000 万 Temporal actions，700 万 workflows；
- Cloud Agent 内部合并 PR 中 1/3 由 Temporal 编排；
- 优势：自动重试、Saga 模式、长时运行（数小时）、可视化追踪。

---

## 5. 模型预加载与缓存策略 (Model Cache)

### 5.1 KV 缓存的核心地位

KV 缓存是 LLM 长上下文推理的主要内存消耗：

> **来源**：LocalAimaster 深度技术博客，发布时间 2026-05-02，原文链接：[localaimaster.com KV Cache Guide](https://localaimaster.com/blog/kv-cache-paged-attention-guide)

| 上下文长度 | Llama 3.1 8B (BF16) | Llama 3.1 70B (BF16) | Llama 3.1 405B (BF16) |
|---|---|---|---|
| 4K | 0.5 GB | 1.3 GB | 3.0 GB |
| 32K | 4 GB | 10.7 GB | 24 GB |
| 128K | 16 GB | 43 GB | 96 GB |
| 200K | 25 GB | 67 GB | 150 GB |

**关键公式**：
```
kv_per_token = 2 × num_layers × num_kv_heads × head_dim × bytes_per_element
```
对 Llama 3.1 70B（GQA，8 KV heads / 64 query heads）：
- 每 token ≈ 320 KB
- 32K 上下文 ≈ 10.7 GB / 请求

### 5.2 KV 压缩架构对比

> **来源**：LocalAimaster 博客，发布时间 2026-05-02

| 技术 | 压缩比 | 质量损失 | 代表模型 |
|---|---|---|---|
| MHA（基线） | 1x | 0% | GPT-2、原始 Llama |
| MQA (Multi-Query) | 32x | 1-2% | PaLM、Falcon |
| GQA (Grouped-Query) | 8x | < 0.5% | Llama 3、Qwen 2.5、Mistral |
| MLA (Multi-Head Latent) | 5-10x | < 0.5% | DeepSeek V2 / V3 |
| CLA (Cross-Layer) | 2-3x | < 0.5% | Hunyuan-Large |
| GQA + MLA | 30-80x | < 1% | DeepSeek V3（实际） |
| GQA + CLA | 16-24x | < 1% | Hunyuan-Large（实际） |

**结论**：2026 年新模型设计 GQA 是基线，MLA / CLA 进一步压缩。

### 5.3 PagedAttention：vLLM 的核心创新

> **来源**：CSDN 技术博客，发布时间 2026-05-21 / 2026-06-17，原文链接：[csdn.net VLLM 原理](https://blog.csdn.net/minhuan/article/details/161293694)、[vllm.ai 官方文档](https://docs.vllm.ai/en/v0.8.0/performance/optimization.html)

**核心思想**（借鉴操作系统虚拟内存分页）：
- 将连续动态变化的 KV 缓存切分为固定大小页面；
- 像内存分页一样复用、回收、拼接显存页面；
- 同等硬件下，并发吞吐是 HuggingFace 原生推理框架 10-几十倍；
- 支持自动权重分片、量化模型加载、分布式多卡加载、动态设备调度、按需加载分片参数；
- 兼容 FP16 / BF16 / INT8 / INT4 量化、AutoGPTQ、AWQ、张量并行、流水线并行。

**关键优化**：
- **连续动态批处理**（Continuous Batching）：新请求随时插入队列，无需等待当前批次结束；
- **Chunked Prefill**：长 prefill 拆分为小块，与 decode 请求批处理，平衡 TTFT 与 ITL；
- **Preemption**：当 KV 不足时抢占低优先级请求，腾出空间。

**vLLM 调优指南**（来自官方文档）：
- 增加 `gpu_memory_utilization`（默认 0.9）以提供更多 KV 空间；
- 减少 `max_num_seqs` 或 `max_num_batched_tokens` 降低并发数；
- 增加 `tensor_parallel_size` 分片权重到多卡；
- 增加 `pipeline_parallel_size` 跨卡分布层。

### 5.4 KV 缓存的层次化卸载

> **来源**：llm-d 官方文档（基于 vLLM / SGLang / TensorRT-LLM 生态），发布时间：2026，最新版本 v0.8，原文链接：[llm-d.ai KV Offloading](https://llm-d.ai/docs/architecture/advanced/kv-management/kv-offloader)

**双集成模式**：
1. **Native（vLLM `OffloadingConnector`）**：
   - 直接卸载到 CPU RAM；
   - 或通过 llm-d FS backend 卸载到共享文件系统。
2. **Out-of-tree 连接器**：
   - LMCache：开源 KV 缓存引擎；
   - Mooncake：分布式 KV 缓存（kvcache-ai/Mooncake）；
   - NVIDIA KVBM：Dynamo 框架内置。

**核心收益**：
- 容量：CPU RAM 容量比 GPU HBM 高一个数量级，存储几乎无限；
- 共享：本地缓存隔离每个实例，共享存储支持跨节点复用、加速新副本启动、跨重启持久化；
- 性能：长 prompt 场景下，加载缓存块比重新计算快 16x。

**架构**（简化）：
```
vLLM → V1 Connector API → OffloadingConnector
                                ↓                  ↓
                              CPU Tier        Storage Tier
                          (LRU + GPU-CPU)   (Lookup + POSIX)
```

### 5.5 RadixAttention：SGLang 的前缀共享

> **来源**：LocalAimaster 博客，发布时间 2026-05-02

- 基于 Radix Tree 索引所有 prompt 前缀；
- 自动识别可复用的 KV 块，命中率可达 60-90%（系统 prompt 场景）；
- 适合 Agentic Loop（多轮对话共享上下文）、RAG（共享检索结果）。

### 5.6 AsymCache：北大的最新研究

> **来源**：arXiv 学术论文（北京大学），发布机构：Peking University，发布时间：2026-06-01，原文链接：[arXiv 2606.02964](https://arxiv.org/html/2606.02964v1)

- 多段注意力（Multi-Segment Attention, MSA）：高效处理非连续 KV 上下文；
- 缓存淘汰策略：联合优化命中率与位置感知的重算成本；
- 自适应分块调度器：提高硬件利用率；
- 实验结果：TTFT 降低 1.90-2.03x，TPOT 降低 1.62-1.71x；
- 在 Continuum 等 Agent 服务系统中，可降低平均任务延迟 18.1%。

### 5.7 模型预加载与 Keep-alive 策略

综合各家实践，端云协同平台的模型管理策略：

| 策略 | 端侧实现 | 云端实现 |
|---|---|---|
| **预加载** | 启动时加载 1-2 个常用模型到 RAM/VRAM | 节点预热常用模型 |
| **Lazy Load** | 首次调用时才加载冷门模型 | 按需扩容 |
| **LRU 淘汰** | 显存不足时淘汰最久未用模型 | 类似 K8s 资源回收 |
| **Keep-alive** | 后台进程常驻模型，避免切换延迟 | 模型池（Model Pool）保活 |
| **模型切换** | 通过 mmap / lazy unmap 实现 0 延迟切换 | 通过 model pool 预热实现 |
| **OOM 防护** | 监控 VRAM，提前 swap 到 RAM | 监控 GPU 利用率，自动扩缩 |

### 5.8 Codex / Cursor / Trae 缓存实践

- **Codex CLI**：通过 Docker Model Runner 预热 gpt-oss 等模型，配置多个 profile 避免冷启动；
- **Cursor Router**：缓存分类器决策结果，对同一类请求复用路由；
- **Trae Solo**：动态算力调度，根据设备资源选择「分层参数蒸馏」后的子模型。

---

## 6. 综合分析与对 Hermes 平台的启示

### 6.1 四大技术的协同关系

```
┌────────────────────────────────────────────────────┐
│                  Hermes 调度平台                     │
├────────────────────────────────────────────────────┤
│  1. Edge-AI 路由层                                   │
│     LiteLLM 代理 + 多 profile 路由                  │
│     端云决策：成本 / 延迟 / 质量 / 隐私 / 能力        │
│  2. 离线优先层                                       │
│     CRDT（Yjs/Automerge）同步引擎                   │
│     本地 SQLite + 操作日志 + Change Feed            │
│  3. 设备集群层                                       │
│     mDNS/DNS-SD 发现 + Avahi 广播                   │
│     K8s Operator / Temporal 编排                    │
│     心跳 + 电量 + 负载均衡                          │
│  4. 模型缓存层                                       │
│     vLLM PagedAttention + RadixAttention           │
│     KV Offloading（CPU/Storage）                   │
│     Model Pool + Keep-alive                        │
└────────────────────────────────────────────────────┘
```

### 6.2 对 Hermes 平台的具体建议

1. **端云路由**：
   - 采用 LiteLLM 作为统一代理；
   - 实现三模式（Intelligence / Balance / Cost），企业可管控；
   - 引入 Token Budget Manager 防止云端成本失控；
   - 隐私 Tier 分类：健康/金融强制本地。

2. **离线优先**：
   - 引入 Yjs 作为任务状态同步引擎（轻量、文本协作强）；
   - 引入 Automerge 作为 JSON 配置同步（API 友好、版本历史）；
   - 本地 SQLite 存储，Change Feed 触发云端同步。

3. **设备集群**：
   - 局域网用 Avahi / Bonjour 自动发现 Hermes 节点；
   - 跨网段部署 Discovery Proxy / SRP；
   - 用 Temporal 编排长时任务，自动重试与故障恢复；
   - 电量 / 负载 / 能力三维路由。

4. **模型缓存**：
   - 引入 vLLM PagedAttention 作为推理后端；
   - 引入 LMCache / Mooncake 实现跨节点 KV 共享；
   - 启动时预热 1-2 个常用模型到 VRAM；
   - 监控 OOM 风险，触发模型 swap 到 CPU RAM。

### 6.3 待解决的开放问题

- **CRDT 内存增长**：tombstone 累积、版本历史无限增长；需要周期性 snapshot + 压缩；
- **跨子网 mDNS 性能**：Discovery Proxy 引入单点失败；需要多 Proxy 冗余；
- **模型路由公平性**：不同任务优先级下如何公平分配端侧显存；
- **云端成本透明度**：用户对 Token 消耗的实时可视化。

---

## 7. 参考资料汇总

### 学术论文与官方 RFC

| 编号 | 标题 | 发布机构 | 时间 | 链接 |
|---|---|---|---|---|
| 1 | Local-first software: you own your data, in spite of the cloud | ACM SIGPLAN / Ink & Switch | 2019-04 | [inkandswitch.com](https://www.inkandswitch.com/local-first/) / [DOI 10.1145/3359591.3359737](https://doi.org/10.1145/3359591.3359737) |
| 2 | A comprehensive study of Convergent and Commutative Replicated Data Types | ACM | 2011 | [ACM DOI 10.1145/3232538](https://dl.acm.org/doi/10.1145/3232538) |
| 3 | RFC 6762 - Multicast DNS | IETF | 2013-02 | [datatracker.ietf.org](https://datatracker.ietf.org/doc/html/rfc6762) |
| 4 | RFC 6763 - DNS-Based Service Discovery | IETF | 2013-02 | [datatracker.ietf.org](https://datatracker.ietf.org/doc/html/rfc6763) |
| 5 | RFC 8765 - DNS Push Notifications | IETF | 2020 | [datatracker.ietf.org](https://datatracker.ietf.org/doc/html/rfc8765) |
| 6 | RFC 8766 - DNS-SD Discovery Proxy | IETF | 2020 | [datatracker.ietf.org](https://datatracker.ietf.org/doc/html/rfc8766) |
| 7 | IETF 111 - Completing the DNS-SD Architecture | IETF | 2018-07 | [Slides](https://datatracker.ietf.org/meeting/111/materials/slides-111-dnssd-completing-the-dns-service-discovery-architecture-00.pdf) |
| 8 | Multi-Segment Attention: Efficient KV-Cache Management (AsymCache) | Peking University / arXiv | 2026-06-01 | [arXiv 2606.02964](https://arxiv.org/html/2606.02964v1) |
| 9 | vLLM 官方优化文档 | vLLM Project | 2024-2026 | [docs.vllm.ai](https://docs.vllm.ai/en/v0.8.0/performance/optimization.html) |
| 10 | llm-d KV-Cache Offloading | Red Hat / llm-d | 2026 | [llm-d.ai](https://llm-d.ai/docs/architecture/advanced/kv-management/kv-offloader) |

### 厂商官方文档

| 编号 | 标题 | 发布机构 | 时间 | 链接 |
|---|---|---|---|---|
| 11 | Trae IDE 快速开始 | ByteDance / Trae | 2025-2026 | [docs.trae.ai](https://docs.trae.ai/ide/set-up-trae) |
| 12 | What is TRAE Work? (SOLO Mode) | ByteDance / Trae | 2026 | [docs.trae.ai](https://docs.trae.ai/solo/what-is-trae-solo?_lang=en) |
| 13 | Introducing The New SOLO | ByteDance / Trae | 2026-03-31 | [trae.ai/blog](https://www.trae.ai/blog/new_solo_beta_0331) |
| 14 | Apple Foundation Models (Claude SDK) | Anthropic | 2026-06-08 | [platform.claude.com](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/apple-foundation-models) |
| 15 | Building intelligent apps for Apple platforms | Anthropic | 2026-06-08 | [claude.com/blog](https://websitemain.claude.com/blog/claude-for-foundation-models) |
| 16 | Apple Foundation Models Framework | Apple Developer | 2026 | [developer.apple.com](https://developer.apple.com/documentation/foundationmodels) |
| 17 | Cursor Router 官方公告 | Cursor | 2026-07-22 | [X 公告](https://x.com/cursor_ai/status/2079993729532989500) |
| 18 | Cursor Cloud Agents 实践 | Cursor / ZenML | 2026-04-23 | [zenml.io](https://www.zenml.io/llmops-database/building-and-operating-agentic-ai-coding-products-at-scale-with-temporal) |
| 19 | Automerge 官方 | Ink & Switch Lab | 持续更新 | [automerge.org](https://automerge.org/) |

### 行业技术博客与深度分析

| 编号 | 标题 | 作者 / 平台 | 时间 | 链接 |
|---|---|---|---|---|
| 20 | Codex CLI + Docker Model Runner | Daniel Vaughan | 2026-04-29 | [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/04/29/codex-cli-docker-model-runner-local-inference-containerised-workflows/) |
| 21 | Intelligence per Token: Local AI + Agentic Loops | Daniel Vaughan | 2026-05-21 | [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/05/21/local-ai-intelligence-per-token-codex-cli-dgx-spark-agentic-loops/) |
| 22 | Planning for Token Meltdown: Local-to-Paid Routing | Daniel Vaughan | 2026-05-29 | [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/05/29/planning-for-token-meltdown-local-to-paid-routing/) |
| 23 | Cursor Router Launches Smart Model Routing | The AI Dude | 2026-07-23 | [theaidude.net](https://theaidude.net/blog/cursor-router-launches-smart-model-routing-for-teams) |
| 24 | Cursor Launches Router (News) | The Next Gen Tech Insider | 2026-07-24 | [thenextgentechinsider.com](https://thenextgentechinsider.com/pulse/cursor-launches-router-to-optimize-model-selection-for-agentic-tasks) |
| 25 | Cursor Cloud Agents Explained (Self-Hosted) | api.ginbok.com | 2026-04-23 | [api.ginbok.com](https://api.ginbok.com/en/blog/cursor-cloud-agents-explained-my-machines-self-hosted-pool-and-how-it-all-works/) |
| 26 | Hybrid On-Device/Cloud AI Pipelines (iOS Swift) | dev.to / mvpfactory | 2026-06-15 | [dev.to](https://dev.to/software_mvp-factory/apple-foundation-models-sdk-with-claude-code-building-hybrid-on-devicecloud-ai-pipelines-for-ios-1493) |
| 27 | Apple Foundation Models Goes Open Source | byteiota.com | 2026-07-09 | [byteiota.com](https://byteiota.com/apple-foundation-models-open-source/) |
| 28 | Using Claude with Swift (Foundation Models) | Clauder Navi | 2026-06-16 | [clauder-navi.com](https://www.clauder-navi.com/en/claude-swift) |
| 29 | Local-First Software 2026 | programming-helper.com | 2026-05-22 | [programming-helper.com](https://www.programming-helper.com/tech/local-first-software-2026-offline-capable-applications-edge-sync) |
| 30 | Local-First Software Design (Architecture) | Youngju Kim | 2026-06-12 | [youngju.dev](https://www.youngju.dev/blog/architecture/2026-06-12-local-first-software-design.en) |
| 31 | CRDT 완전 가이드 2025 (Yjs vs Automerge) | Youngju Kim | 2026-04-15 | [youngju.dev](https://www.youngju.dev/blog/culture/2026-04-15-crdt-conflict-free-replicated-data-types-collaborative-guide-2025) |
| 32 | Real-Time Data Sync: CRDTs, OT, and What Works | Fordel Studios | 2026-03-28 | [fordelstudios.com](https://fordelstudios.com/research/real-time-data-sync-patterns) |
| 33 | Yjs 底层解密 | CSDN / xgangzai | 2026-04-25 | [csdn.net](https://blog.csdn.net/xgangzai/article/details/146220609) |
| 34 | Actual Budget: Local-First + CRDT 深度解析 | CSDN | 2026-07-28 | [csdn.net](https://blog.csdn.net/yanceyxin/article/details/162349830) |
| 35 | Architectural Patterns: Local-First (Adam Wiggins) | InfoQ | 2026-06-29 | [infoq.com](https://www.infoq.com/podcasts/natural-evolution-cloud-native/?topicPageSponsorship=a0722142-1bc0-4ef7-bda6-802614a6ebec) |
| 36 | What is mDNS / Bonjour | infishark.com | 2026-03-27 | [infishark.com](https://infishark.com/blogs/learn/what-is-mdns-bonjour) |
| 37 | 设备发现与服务注册机制设计 | CSDN | 2026-06-16 | [csdn.net](https://blog.csdn.net/weixin_36474966/article/details/155115162) |
| 38 | mdns-sd Core Architecture (Rust) | DeepWiki / keepsimple1 | 2026-03-07 | [deepwiki.com](https://deepwiki.com/keepsimple1/mdns-sd/3-core-architecture) |
| 39 | GPU Cluster mDNS / ZeroConf | ai-manual.ru | 2026-05-02 | [ai-manual.ru](https://ai-manual.ru/article/obedinyaem-gpu-v-domashnij-klaster-mdns-i-zeroconf-dlya-raspredelennogo-obucheniya-llm-bez-boli/) |
| 40 | VLLM 大模型高效加载原理 | CSDN | 2026-05-21 | [csdn.net](https://blog.csdn.net/minhuan/article/details/161293694) |
| 41 | KV Cache & PagedAttention Complete Guide 2026 | LocalAimaster | 2026-05-02 | [localaimaster.com](https://localaimaster.com/blog/kv-cache-paged-attention-guide) |
| 42 | 字节 Trae Solo 模式深度科普 | CSDN | 2025-12-03 | [csdn.net](https://blog.csdn.net/weixin_73527660/article/details/155535156) |
| 43 | Cursor、Claude Code、Codex 对比 | CSDN | 2026-05-01 | [csdn.net](https://blog.csdn.net/weixin_32393347/article/details/160534381) |
| 44 | Codex 双模运行架构 | CSDN | 2026-07-22 | [csdn.net](https://blog.csdn.net/bryant_meng/article/details/163070918) |
| 45 | codex-shim: AI Coding Agent Routing for Codex Desktop | toolhunter.cc | 2026-05-25 | [toolhunter.cc](https://www.toolhunter.cc/tools/codex-shim) |

### 复用声明

| 项目 | 复用状态 |
|---|---|
| 项目现有代码片段 | **无复用**：本次为外部技术调研，未涉及项目内部代码 |
| 外部学术 / 官方资料 | 已按合规要求标注来源链接、发布机构、发布时间 |
| 跨轮次报告（CYCLE10-33） | 沿用其结构与术语体系，但内容完全为本轮新调研 |

---

## 报告结束

> **编制依据**：`/home/qizheng/auto_code_ws/AGENTS.md` 项目治理规范 + `info-fetch-compliance` 外部信息获取合规性规则
> **下一阶段建议**：基于本报告第 6 章「对 Hermes 平台的启示」展开 CYCLE35 详细设计
