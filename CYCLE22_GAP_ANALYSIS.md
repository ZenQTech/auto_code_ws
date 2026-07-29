# Cycle 22 差距分析报告

> **周期**: Cycle 22 (v6.51.0 - v6.54.0)
> **日期**: 2026-07-29
> **关联文档**: [CYCLE22_RESEARCH_REPORT.md](CYCLE22_RESEARCH_REPORT.md)

---

## 一、6 大差距优先级

| 编号 | 差距 | 优先级 | 估时 | 引擎 | 面板 |
|------|------|--------|------|------|------|
| **G22-01** | Side Chat / Multi-Conversation | **P0** | 1.5d | SideChatManager | SideChatPanel |
| **G22-02** | Cost Prediction 成本预测 | **P0** | 1d | CostPredictor | CostPredictionPanel |
| **G22-03** | Hook Performance Analyzer | **P1** | 1d | HookPerformanceAnalyzer | HookPerformancePanel |
| **G22-04** | Model Router 优化模式增强 | **P1** | 1d | 扩展 ModelRouter | ModelRouterAdminPanel |
| **G22-05** | Auto-Selection Learning 候选学习 | **P2** | 1d | 扩展 BestOfNCoordinator | (集成到 BestOfNCoordinatorPanel) |
| **G22-06** | Session Replay 会话回放 | **P2** | 1.5d | SessionRecorder | SessionReplayPanel |

**本周期重点实现 G22-01 ~ G22-04**（P0+P1），后续 Cycle 23 推进 P2

---

## 二、详细差距分析

### 2.1 G22-01: Side Chat / Multi-Conversation 能力 (P0)

#### 问题描述
- 当前对话只能单线进行，无法在不打断主对话的情况下讨论子话题
- 探索性对话会污染主对话上下文
- 缺少 /side、/btw 风格的轻量级子对话
- 用户尝试讨论子问题时会创建新 Session，丢失上下文关联

#### 用户故事
```
作为用户，我想要：
1. 在主对话中遇到子问题时，能开一个 Side-Chat 讨论
2. Side-Chat 的结论可以"晋升"到主对话
3. Side-Chat 不污染主对话的上下文窗口
4. 关闭/重新打开 Side-Chat 不丢失内容
```

#### 解决方案
- **SideChatManager 单例**：
  - 支持最多 5 个 Side-Chat 并行
  - 可关联到主 Session（parentSessionId）
  - 独立消息列表 + 独立上下文
  - 5 种状态：active / archived / promoted / merged / discarded
- **SideChatPanel UI**：
  - 浮层模式：右下角弹出
  - 列表模式：侧边栏显示所有 Side-Chat
  - 快捷键：`/side`、`/btw`、加号按钮

#### 验收标准
- ✅ 创建 Side-Chat < 100ms
- ✅ 支持多 Side-Chat 并行
- ✅ Side-Chat 可晋升到主对话
- ✅ 关闭/重新打开不丢失
- ✅ 单元测试 ≥ 25 条
- ✅ E2E 测试通过

---

### 2.2 G22-02: Cost Prediction 成本预测模型 (P0)

#### 问题描述
- 当前 ModelCostStatsCollector 仅展示历史数据
- 缺少未来成本预测
- 缺少预算告警
- 用户无法提前规划成本

#### 用户故事
```
作为用户，我想要：
1. 预测未来 7/30 天的成本
2. 设置日/周/月预算
3. 接近预算时收到告警
4. 查看成本趋势预测曲线
```

#### 解决方案
- **CostPredictor 单例**：
  - 基于历史数据的线性回归预测
  - 基于指数平滑的加权预测
  - 3 种时间粒度：日/周/月
  - 4 种预测模式：simple/linear/exponential/seasonal
- **CostPredictionPanel UI**：
  - 预测曲线图（基于 SVG）
  - 预算设置
  - 告警配置
  - 历史 vs 预测对比

#### 验收标准
- ✅ 预测准确率 ≥ 80%（基于历史数据回测）
- ✅ 支持 4 种预测模式
- ✅ 预算告警实时触发
- ✅ 单元测试 ≥ 20 条
- ✅ E2E 测试通过

---

### 2.3 G22-03: Hook Performance Analyzer (P1)

#### 问题描述
- HookChainTracker 仅展示链路结构和状态
- 缺少性能分析（慢节点、超时节点）
- 缺少优化建议
- 用户难以识别性能瓶颈

#### 用户故事
```
作为用户，我想要：
1. 识别执行慢的 Hook 节点
2. 识别失败率高的 Hook
3. 获得优化建议
4. 导出性能报告
```

#### 解决方案
- **HookPerformanceAnalyzer 单例**：
  - 慢节点检测：> 平均时长 2x
  - 超时节点：> 配置阈值
  - 失败率统计
  - 优化建议生成
  - 5 种严重级别：critical / high / medium / low / info
- **HookPerformancePanel UI**：
  - 性能概览
  - 慢节点 TOP 10
  - 失败率排行
  - 优化建议列表
  - 报告导出

#### 验收标准
- ✅ 慢节点检测准确率 100%
- ✅ 优化建议 ≥ 3 类（重试/超时调整/重写/合并/拆分）
- ✅ 支持 json / html / markdown 3 种导出格式
- ✅ 单元测试 ≥ 20 条
- ✅ E2E 测试通过

---

### 2.4 G22-04: Model Router 优化模式增强 (P1)

#### 问题描述
- 当前 ModelRouter 已有 cost/balance/intelligence 模式
- 缺少管理员控制（团队/组激活）
- 缺少模型白/黑名单
- 缺少显示/隐藏所选模型
- Cursor Router 已实现这些能力

#### 用户故事
```
作为管理员，我想要：
1. 为不同团队设置不同优化模式
2. 限制某些模型的使用
3. 设置团队默认模式
4. 控制用户是否能查看实际选择的模型
```

#### 解决方案
- **扩展 ModelRouter**：
  - 管理员策略接口 RouterAdminConfig
  - 团队/组级别激活
  - 模型白/黑名单
  - 默认模式设置
  - 显示控制
- **ModelRouterAdminPanel UI**：
  - 团队/组列表
  - 模式启用/禁用
  - 模型白/黑名单管理
  - 默认模式选择
  - 实时预览

#### 验收标准
- ✅ 支持团队/组级别策略
- ✅ 模型白/黑名单生效
- ✅ 显示控制开关
- ✅ 单元测试 ≥ 15 条
- ✅ E2E 测试通过

---

## 三、任务工作量估算

### 3.1 引擎代码（4 个）

| 引擎 | 估时 | 代码行数 | 复杂度 |
|------|------|---------|--------|
| SideChatManager | 1.5d | ~600 | 中 |
| CostPredictor | 1d | ~500 | 中 |
| HookPerformanceAnalyzer | 1d | ~500 | 中 |
| ModelRouter 增强 | 1d | ~300（增量） | 低 |

**引擎总工时**: 4.5d
**引擎代码总量**: ~1900 行

### 3.2 UI 面板（4 个）

| 面板 | 估时 | 代码行数 | 复杂度 |
|------|------|---------|--------|
| SideChatPanel | 1d | ~500 | 中 |
| CostPredictionPanel | 0.5d | ~400 | 中 |
| HookPerformancePanel | 0.5d | ~400 | 中 |
| ModelRouterAdminPanel | 0.5d | ~400 | 低 |

**UI 总工时**: 2.5d
**UI 代码总量**: ~1700 行

### 3.3 测试

| 测试类型 | 数量 | 估时 |
|---------|------|------|
| 单元测试 | ~80 | 1d |
| E2E 测试 | ~150 断言 | 0.5d |

**测试总工时**: 1.5d

### 3.4 总工时
- 引擎: 4.5d
- UI: 2.5d
- 测试: 1.5d
- 集成 + 文档 + 提交: 1d
- **总计**: ~9.5d

---

## 四、风险评估

### 4.1 技术风险

| 风险 | 影响 | 应对 |
|------|------|------|
| SideChat 与 Session 冲突 | 中 | 清晰的接口边界，状态机严格 |
| 预测模型准确率不达标 | 中 | 多种预测模式，回测验证 |
| Hook 性能数据采集不完整 | 低 | 复用现有 HookChainTracker |
| ModelRouter 增强破坏现有 | 中 | 向后兼容，渐进式 |

### 4.2 时间风险
- 4 个 P0+P1 任务量较大
- 建议严格执行 SPEC 文档，避免范围蔓延

---

## 五、交付物清单

### 5.1 新增文件
- CYCLE22_RESEARCH_REPORT.md
- CYCLE22_GAP_ANALYSIS.md
- CYCLE22_SPEC_P0_1_SIDE_CHAT.md
- CYCLE22_SPEC_P0_2_COST_PREDICTION.md
- CYCLE22_SPEC_P1_1_HOOK_PERFORMANCE.md
- CYCLE22_SPEC_P1_2_MODEL_ROUTER_ENHANCE.md
- CYCLE22_SUMMARY.md
- frontend/src/utils/sideChatManager.ts
- frontend/src/utils/costPredictor.ts
- frontend/src/utils/hookPerformanceAnalyzer.ts
- frontend/src/utils/modelRouterEnhance.ts
- 各引擎 .test.ts
- frontend/src/components/SideChatPanel.tsx
- frontend/src/components/CostPredictionPanel.tsx
- frontend/src/components/HookPerformancePanel.tsx
- frontend/src/components/ModelRouterAdminPanel.tsx
- tests/test_e2e_cycle22.sh

### 5.2 修改文件
- frontend/src/App.tsx - 集成 4 个新面板
- frontend/src/components/AppLayout.tsx - 透传 prop
- frontend/src/components/BrandHeader.tsx - 4 个新菜单项
- frontend/src/utils/modelRouter.ts - 增强（增量）
- 代码修改日志
- ITERATION_LOG.md

---

**Cycle 22 差距分析完成，准备进入 Phase 3 功能开发。**
