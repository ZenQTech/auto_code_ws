# Cycle 20 G20-05: Long-running Job Monitor - 技术规范

> **任务编号**: G20-05
> **优先级**: P1 (应做)
> **日期**: 2026-07-29
> **基于**: [CYCLE20_GAP_ANALYSIS.md](./CYCLE20_GAP_ANALYSIS.md)
> **负责人**: Hermes AI Agent

---

## 一、需求背景

### 1.1 问题

- 长时域任务进度可视化弱
- 缺少阶段划分 + ETA 估算
- 暂停/恢复不流畅

### 1.2 目标

- 进度可视化增强（阶段、百分比、ETA）
- 阶段划分（初始化/执行/验证/完成）
- 暂停/恢复优化
- 进度通知（Toast/系统通知）

---

## 二、核心数据结构

### 2.1 JobStage

```typescript
export type JobStage =
  | 'init'         // 初始化
  | 'planning'     // 规划
  | 'executing'    // 执行
  | 'validating'   // 验证
  | 'finalizing'   // 收尾
  | 'complete'     // 完成
  | 'failed'       // 失败
  | 'cancelled'    // 取消;
```

### 2.2 JobProgress

```typescript
export interface JobProgress {
  /** 任务 ID */
  taskId: string;
  /** 当前阶段 */
  stage: JobStage;
  /** 整体进度 (0-100) */
  overallProgress: number;
  /** 当前阶段进度 (0-100) */
  stageProgress: number;
  /** ETA（毫秒时间戳） */
  etaMs?: number;
  /** 已耗时（毫秒） */
  elapsedMs: number;
  /** 速率（progress/second） */
  rate?: number;
  /** 当前活动消息 */
  currentActivity?: string;
  /** 阶段历史 */
  stageHistory: Array<{
    stage: JobStage;
    startedAt: number;
    endedAt?: number;
    duration?: number;
  }>;
  /** 子任务列表 */
  subtasks?: SubTaskProgress[];
  /** 时间戳 */
  timestamp: number;
}

export interface SubTaskProgress {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  progress: number;
  duration?: number;
}
```

---

## 三、核心 API

### 3.1 JobMonitor

```typescript
export class JobMonitor {
  private progressMap: Map<string, JobProgress> = new Map();
  private readonly eventBus: JobEventBus = new JobEventBus();
  private timers: Map<string, number> = new Map();

  /**
   * 注册任务
   */
  register(taskId: string, initial?: Partial<JobProgress>): void;

  /**
   * 注销任务
   */
  unregister(taskId: string): void;

  /**
   * 更新阶段
   */
  setStage(taskId: string, stage: JobStage): void;

  /**
   * 更新进度
   */
  updateProgress(taskId: string, update: ProgressUpdate): void;

  /**
   * 获取进度
   */
  getProgress(taskId: string): JobProgress | null;

  /**
   * 估算 ETA
   */
  estimateEta(taskId: string): number | null;

  /**
   * 订阅任务
   */
  watch(taskId: string, handler: ProgressHandler): () => void;

  /**
   * 订阅所有任务
   */
  watchAll(handler: ProgressHandler): () => void;

  /**
   * 通知配置
   */
  setNotificationConfig(config: NotificationConfig): void;
}
```

### 3.2 与 BackgroundTaskEngine 集成

```typescript
// BackgroundTaskEngine 改造
class BackgroundTaskEngine {
  private monitor: JobMonitor;

  // 任务启动时注册
  startTask(id: string) {
    // ...existing code...
    this.monitor.register(id, { stage: 'init' });
    this.monitor.setStage(id, 'executing');
  }

  // 进度更新
  private _updateProgress(id: string, percent: number, activity?: string) {
    this.monitor.updateProgress(id, { stageProgress: percent, currentActivity: activity });
  }

  // 任务完成
  completeTask(id: string, result: unknown) {
    // ...existing code...
    this.monitor.setStage(id, 'finalizing');
    this.monitor.setStage(id, 'complete');
  }
}
```

---

## 四、UI 组件

### 4.1 JobMonitorPanel

- 任务列表 + 进度条
- 阶段徽章
- ETA 显示
- 子任务展开
- 实时更新（WebSocket/SSE 模拟）

### 4.2 JobProgressCard

- 阶段图标 + 名称
- 整体进度条 + 阶段进度条
- 活动消息
- 暂停/恢复/取消按钮
- 已耗时 / ETA

### 4.3 StageTimeline

- 阶段历史可视化
- 当前阶段高亮
- 已完成阶段打勾

### 4.4 通知

- 关键阶段切换时 Toast 通知
- 桌面通知（如果允许）
- 阶段完成震动反馈

---

## 五、ETA 估算算法

```typescript
function estimateEta(progress: JobProgress): number | null {
  if (progress.rate && progress.rate > 0) {
    const remaining = 100 - progress.overallProgress;
    return Date.now() + (remaining / progress.rate) * 1000;
  }
  // 基于历史阶段的平均耗时
  if (progress.stageHistory.length > 0) {
    const completed = progress.stageHistory.filter(s => s.endedAt);
    if (completed.length > 0) {
      const avgDuration = completed.reduce((sum, s) => sum + (s.duration ?? 0), 0) / completed.length;
      const remainingStages = 6 - progress.stageHistory.length; // 6 个阶段
      return Date.now() + avgDuration * remainingStages;
    }
  }
  return null;
}
```

---

## 六、测试要求

### 6.1 单元测试 (30+)

- register / unregister
- setStage / updateProgress
- estimateEta 算法
- 阶段切换正确性
- 持久化

### 6.2 集成测试 (20+)

- JobMonitorPanel 渲染
- 进度更新动画
- 与 BackgroundTask 集成

### 6.3 E2E 测试 (15+ 断言)

- 任务进度可视化
- 阶段切换
- ETA 显示
- 暂停/恢复

---

## 七、文件清单

- `frontend/src/utils/jobMonitor.ts` (450 行)
- `frontend/src/utils/jobMonitor.test.ts` (250 行)
- `frontend/src/components/JobMonitorPanel.tsx` (350 行)
- `frontend/src/components/JobMonitorPanel.test.tsx` (200 行)
- `frontend/src/components/StageTimeline.tsx` (200 行)
- `frontend/src/components/StageTimeline.test.tsx` (120 行)
- 修改：
  - `frontend/src/utils/backgroundTaskEngine.ts` (+30 行)

---

## 八、验收标准

- ✅ 进度可视化清晰
- ✅ 阶段划分合理
- ✅ ETA 估算准确
- ✅ 暂停/恢复流畅
- ✅ 单元测试 30+ 100% 通过
- ✅ 集成测试 20+ 100% 通过
- ✅ E2E 断言 15+ 100% 通过
- ✅ TypeScript 编译 0 错误
- ✅ Loop Engineering 工作流无回归

---

**SPEC 完成**: 2026-07-29 15:00
