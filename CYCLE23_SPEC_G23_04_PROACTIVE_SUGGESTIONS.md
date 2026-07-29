# Cycle 23 G23-04 SPEC: AI 主动建议（Proactive Suggestions）引擎

## 1. 功能概述

基于上下文主动提示用户下一步操作，提升交互效率与用户体验。

## 2. 业务价值

- **降低学习成本**：新用户可快速了解可用功能
- **提升效率**：减少用户搜索/查找功能的时间
- **避免遗忘**：主动提醒用户可能用得上的功能
- **持续优化**：基于用户反馈调整建议质量

## 3. 核心功能

### 3.1 上下文分析
- 当前对话状态（空闲/对话中/工作流中）
- 任务类型识别（编码/写作/分析/学习）
- 历史模式（用户常用的操作）
- 当前可用功能（基于 appMode / project）

### 3.2 建议生成
- 4 种建议类型：
  - 下一步操作（如"试试让 AI 解释这段代码"）
  - 相关功能（如"开启 Composer 多文件编辑"）
  - 常见问题（如"如何压缩会话？"）
  - 优化提示（如"建议开启成本预测以避免超支"）
- 2 种生成方式：
  - 基于规则（确定性，零延迟）
  - 基于 LLM（智能，1-2 秒）

### 3.3 智能去重
- 时间窗口去重（同类型建议 5 分钟内不重复）
- 接受/拒绝记录
- 用户手动关闭建议

### 3.4 反馈学习
- 接受建议 → 增加该类建议权重
- 拒绝建议 → 降低该类建议权重
- 基于用户行为模式学习

## 4. 接口设计

### 4.1 数据结构

```typescript
/** 建议类型 */
export type SuggestionType = 'next-action' | 'related-feature' | 'faq' | 'optimization';

/** 建议 */
export interface Suggestion {
  suggestionId: string;
  type: SuggestionType;
  title: string;
  description: string;
  action?: {
    label: string;
    callback: string; // 函数名
  };
  reason: string; // 为什么推荐这个
  confidence: number; // 0-1
  context: Record<string, any>;
  createdAt: number;
  expiresAt: number;
}

/** 建议反馈 */
export interface SuggestionFeedback {
  suggestionId: string;
  feedback: 'accepted' | 'dismissed' | 'ignored';
  duration: number; // 展示时长
  timestamp: number;
}

/** 建议配置 */
export interface SuggestionConfig {
  maxActiveSuggestions: number;
  dedupWindowMs: number;
  enabledTypes: SuggestionType[];
  enableLLMGeneration: boolean;
  showOnIdle: boolean;
  idleThresholdMs: number;
}
```

### 4.2 核心 API

```typescript
export class ProactiveSuggestionEngine {
  // 生成建议
  generateSuggestions(context: SessionContext): Suggestion[];
  
  // 接受建议
  acceptSuggestion(suggestionId: string): void;
  
  // 拒绝建议
  dismissSuggestion(suggestionId: string): void;
  
  // 获取活跃建议
  getActiveSuggestions(): Suggestion[];
  
  // 清空所有建议
  clearAll(): void;
  
  // 配置管理
  updateConfig(config: Partial<SuggestionConfig>): void;
  
  // 获取统计
  getStats(): SuggestionStats;
  
  // 事件订阅
  on(event: 'suggestion-generated' | 'suggestion-accepted' | 'suggestion-dismissed', handler: Function): () => void;
}
```

## 5. UI 面板

### ProactiveSuggestionPanel 组件
- 顶部：当前活跃建议列表（卡片式）
- 中部：建议历史（接受/拒绝记录）
- 底部：配置（启用类型 / 阈值 / 频率）
- 集成入口：主对话区右下角浮动按钮

### 浮动建议气泡
- 在主对话区右上角显示小气泡
- 点击展开查看详情
- 接受/拒绝按钮

## 6. 验收标准

- [ ] 单元测试覆盖：generate / accept / dismiss / clear / config / stats
- [ ] 单元测试通过率 100%
- [ ] UI 面板可正常打开/关闭/Esc 退出
- [ ] 浮动气泡可正常显示/隐藏
- [ ] 智能去重生效
- [ ] TypeScript 0 错误

## 7. 依赖关系

- 依赖 SessionContext（提供上下文数据）
- 不影响其他模块

## 8. 风险评估

- **建议骚扰**：建议过多会干扰用户，需控制频率
- **LLM 成本**：基于 LLM 的建议会增加 API 调用成本
- **隐私保护**：建议生成不上传用户对话内容

## 9. 工作量估算

- 核心引擎：400-500 行代码
- 单元测试：200-300 行
- UI 面板：300-400 行
- 浮动气泡：100-200 行
- 集成：50-100 行
- **总计**：约 1100-1500 行

## 10. 实施计划

1. 实现 ProactiveSuggestionEngine 核心（400 行）
2. 编写单元测试（200 行，30+ 测试）
3. 实现 ProactiveSuggestionPanel UI（300 行）
4. 实现浮动气泡组件（100 行）
5. 集成到 App.tsx + AppLayout + BrandHeader
6. 编写 E2E 测试
7. UI/UX 优化
