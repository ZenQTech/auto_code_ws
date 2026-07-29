# Cycle 23 G23-01 SPEC: 候选学习（Candidate Learning）引擎

## 1. 功能概述

从历史 best-of-N 协同会话的结果中学习用户偏好，自动调整候选评分权重，实现个性化 best-of-N 推荐。

## 2. 业务价值

- **提升选择效率**：基于历史偏好自动调整评分，减少用户决策成本
- **个性化推荐**：不同用户得到不同的推荐结果
- **持续优化**：随着使用时间增加，推荐质量不断提升
- **透明可解释**：用户可查看自己的偏好画像

## 3. 核心功能

### 3.1 历史记录
- 自动记录 best-of-N 会话的选择结果
- 提取特征：任务类型 / prompt 关键词 / 候选模型 / 输出评分
- 持久化到 LocalStorage

### 3.2 偏好学习
- 4 种学习算法：简单加权 / 贝叶斯更新 / 协同过滤 / 强化学习
- 用户偏好向量：模型偏好权重 + 任务类型偏好
- 在线学习：每次选择后增量更新

### 3.3 偏好应用
- 评分调整：在原始评分基础上叠加偏好权重
- 排序调整：基于偏好重新排序候选
- 解释展示：告诉用户为什么这个候选被推荐

### 3.4 偏好 Dashboard
- 用户偏好画像可视化
- 任务类型分布
- 模型选择历史
- 偏好调整入口（手动覆盖）

## 4. 接口设计

### 4.1 数据结构

```typescript
/** 候选学习记录 */
export interface CandidateLearningRecord {
  recordId: string;
  sessionId: string;
  taskType: string;
  promptKeywords: string[];
  candidates: Array<{
    modelId: string;
    originalScore: number;
    finalScore: number;
    selected: boolean;
  }>;
  selectedModelId: string;
  feedback?: 'positive' | 'negative' | 'neutral';
  createdAt: number;
}

/** 用户偏好向量 */
export interface UserPreferenceVector {
  userId: string;
  modelPreferences: Record<string, number>; // modelId -> weight (0-1)
  taskPreferences: Record<string, number>; // taskType -> weight (0-1)
  totalDecisions: number;
  lastUpdated: number;
}

/** 学习算法 */
export type LearningAlgorithm = 'weighted' | 'bayesian' | 'collaborative' | 'reinforcement';

/** 推荐解释 */
export interface RecommendationExplanation {
  candidateId: string;
  baseScore: number;
  preferenceBoost: number;
  finalScore: number;
  reasons: string[];
}
```

### 4.2 核心 API

```typescript
export class CandidateLearningEngine {
  // 记录选择
  recordDecision(record: Omit<CandidateLearningRecord, 'recordId' | 'createdAt'>): CandidateLearningRecord;
  
  // 获取当前偏好
  getPreferences(userId?: string): UserPreferenceVector;
  
  // 应用偏好调整评分
  applyPreferences(scores: Array<{ candidateId: string; modelId: string; baseScore: number }>): Array<{ candidateId: string; originalScore: number; adjustedScore: number; explanation: RecommendationExplanation }>;
  
  // 反馈学习
  submitFeedback(recordId: string, feedback: 'positive' | 'negative' | 'neutral'): void;
  
  // 获取学习统计
  getStats(): LearningStats;
  
  // 重置偏好
  resetPreferences(): void;
  
  // 事件订阅
  on(event: 'decision-recorded' | 'preference-updated', handler: Function): () => void;
}
```

## 5. UI 面板

### CandidateLearningPanel 组件
- 偏好画像：模型偏好雷达图
- 历史决策：最近 20 次选择记录
- 任务统计：按任务类型分组的决策分布
- 反馈入口：对历史决策提供反馈
- 重置偏好按钮

## 6. 验收标准

- [ ] 单元测试覆盖：record / getPreferences / applyPreferences / feedback / stats / reset
- [ ] 单元测试通过率 100%
- [ ] UI 面板可正常打开/关闭/Esc 退出
- [ ] 历史记录可正确显示
- [ ] 评分调整逻辑正确
- [ ] TypeScript 0 错误
- [ ] 与 BestOfNCoordinator 集成

## 7. 依赖关系

- 依赖 BestOfNCoordinator（C21）提供会话数据
- 不影响其他模块

## 8. 风险评估

- **数据隐私**：偏好数据存储在 LocalStorage，不上传服务器
- **学习冷启动**：新用户无历史数据，使用默认权重
- **性能影响**：偏好计算 O(n)，对 best-of-N 性能无影响

## 9. 工作量估算

- 核心引擎：300-400 行代码
- 单元测试：200-300 行
- UI 面板：300-400 行
- 集成：50-100 行
- **总计**：约 1000-1200 行

## 10. 实施计划

1. 实现 CandidateLearningEngine 核心（300 行）
2. 编写单元测试（200 行，30+ 测试）
3. 实现 CandidateLearningPanel UI（300 行）
4. 集成到 App.tsx + AppLayout + BrandHeader
5. 编写 E2E 测试
6. UI/UX 优化
