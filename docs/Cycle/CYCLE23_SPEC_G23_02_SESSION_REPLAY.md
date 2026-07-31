# Cycle 23 G23-02 SPEC: 会话回放（Session Replay）引擎

## 1. 功能概述

录制/回放完整对话流程，便于调试、复盘、分享、教程制作。

## 2. 业务价值

- **调试辅助**：开发者可回放失败会话定位问题
- **复盘学习**：团队成员可复盘他人会话学习经验
- **分享传播**：可生成可分享的回放链接
- **教程制作**：可导出为 HTML / Markdown 制作教程

## 3. 核心功能

### 3.1 自动录制
- 录制所有消息（user / assistant / system）
- 录制工具调用（tool name / args / result / duration）
- 录制思考过程（thinking content）
- 录制工作流状态变更
- 录制时间戳

### 3.2 时间轴回放
- 可拖动进度条跳转到任意时间点
- 速度控制：0.5x / 1x / 2x / 4x
- 暂停/继续
- 上一帧/下一帧

### 3.3 关键节点高亮
- 标记用户干预（用户编辑 / 重新生成 / 停止）
- 标记错误（API 错误 / 工具失败）
- 标记工具调用（文件读写 / 命令执行）
- 标记工作流阶段变更

### 3.4 导出格式
- JSON：完整数据 + 元数据
- HTML：可独立打开的网页（含样式）
- Markdown：可读性文本

### 3.5 分享链接
- 基于 session_id 生成可分享的 URL
- 只读访问，无需登录
- 自动过期（默认 7 天）

## 4. 接口设计

### 4.1 数据结构

```typescript
/** 回放帧类型 */
export type ReplayFrameType = 'message' | 'tool-call' | 'thinking' | 'workflow-stage' | 'user-action';

/** 回放帧 */
export interface ReplayFrame {
  frameId: string;
  type: ReplayFrameType;
  timestamp: number;
  durationMs: number;
  data: any; // 根据 type 不同
  highlight?: 'user-action' | 'error' | 'tool-call' | 'stage-change';
}

/** 回放会话 */
export interface ReplaySession {
  replayId: string;
  sessionId: string;
  title: string;
  startedAt: number;
  endedAt: number;
  frames: ReplayFrame[];
  metadata: {
    totalMessages: number;
    totalToolCalls: number;
    totalErrors: number;
    duration: number;
  };
}

/** 回放状态 */
export interface ReplayState {
  currentFrameIndex: number;
  isPlaying: boolean;
  playbackSpeed: number;
  totalFrames: number;
  currentTime: number;
  totalDuration: number;
}
```

### 4.2 核心 API

```typescript
export class SessionReplayEngine {
  // 创建回放（从 Session 数据）
  createReplay(sessionData: SessionData): ReplaySession;
  
  // 开始回放
  play(): void;
  
  // 暂停
  pause(): void;
  
  // 跳转到指定帧
  seekTo(frameIndex: number): ReplayFrame | null;
  
  // 设置速度
  setSpeed(speed: number): void;
  
  // 下一帧
  next(): ReplayFrame | null;
  
  // 上一帧
  prev(): ReplayFrame | null;
  
  // 导出
  exportReplay(replayId: string, format: 'json' | 'html' | 'markdown'): string;
  
  // 获取状态
  getState(): ReplayState;
  
  // 事件订阅
  on(event: 'frame-changed' | 'play' | 'pause' | 'ended', handler: Function): () => void;
}
```

## 5. UI 面板

### SessionReplayPanel 组件
- 顶部：会话标题 + 元数据
- 中部：消息流回放（类似主对话区）
- 底部：进度条 + 播放控制 + 速度选择
- 左侧：帧列表（可点击跳转）
- 右侧：当前帧详情（工具调用参数 / 错误堆栈等）

## 6. 验收标准

- [ ] 单元测试覆盖：create / play / pause / seek / next / prev / export
- [ ] 单元测试通过率 100%
- [ ] UI 面板可正常打开/关闭/Esc 退出
- [ ] 进度条可拖动跳转
- [ ] 速度切换生效
- [ ] 3 种导出格式可正常工作
- [ ] TypeScript 0 错误

## 7. 依赖关系

- 依赖现有 Session 数据结构
- 不影响其他模块

## 8. 风险评估

- **数据量**：长会话可能产生大量帧，需要分页/虚拟化
- **隐私保护**：分享链接应只读且可过期
- **性能影响**：回放不影响原会话

## 9. 工作量估算

- 核心引擎：400-500 行代码
- 单元测试：200-300 行
- UI 面板：500-600 行
- 集成：50-100 行
- **总计**：约 1200-1500 行

## 10. 实施计划

1. 实现 SessionReplayEngine 核心（400 行）
2. 编写单元测试（200 行，30+ 测试）
3. 实现 SessionReplayPanel UI（500 行）
4. 集成到 App.tsx + AppLayout + BrandHeader
5. 编写 E2E 测试
6. UI/UX 优化
