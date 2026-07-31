# Cycle 20 G20-04: Side-Chats 侧对话 - 技术规范

> **任务编号**: G20-04
> **优先级**: P1 (应做)
> **日期**: 2026-07-29
> **基于**: [CYCLE20_GAP_ANALYSIS.md](./CYCLE20_GAP_ANALYSIS.md)
> **负责人**: Hermes AI Agent

---

## 一、需求背景

### 1.1 问题

- 缺少 /side, /btw 轻量级侧对话
- 主对话中插入支线主题会污染上下文
- Cursor 通过 Side-Chats 解决此问题

### 1.2 目标

- 实现 /side, /btw 命令
- 侧对话独立上下文
- 可选择是否合并到主对话
- 侧对话历史保留

---

## 二、核心数据结构

### 2.1 SideChat

```typescript
export interface SideChat {
  /** 唯一 ID */
  id: string;
  /** 关联主对话 ID */
  parentChatId: string;
  /** 标题 */
  title: string;
  /** 类型 */
  type: 'side' | 'btw';
  /** 消息列表 */
  messages: SideChatMessage[];
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 状态 */
  status: 'active' | 'archived' | 'merged';
  /** 是否已合并到主对话 */
  mergedToParent: boolean;
}

export interface SideChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  /** Token 数 */
  tokens?: number;
}
```

### 2.2 SlashCommand

```typescript
export type SlashCommand = 'side' | 'btw' | 'help' | 'merge' | 'archive' | 'list';
```

---

## 三、核心 API

### 3.1 SideChatManager

```typescript
export class SideChatManager {
  private chats: Map<string, SideChat> = new Map();
  private parentChatId: string | null = null;
  private readonly eventBus: SideChatEventBus = new SideChatEventBus();
  private readonly storage: SideChatStorage;

  /**
   * 设置父对话
   */
  setParentChat(chatId: string): void;

  /**
   * 获取父对话 ID
   */
  getParentChatId(): string | null;

  /**
   * 创建侧对话
   */
  create(type: 'side' | 'btw', title?: string): SideChat;

  /**
   * 列出侧对话
   */
  list(filter?: SideChatFilter): SideChat[];

  /**
   * 获取单个侧对话
   */
  get(id: string): SideChat | null;

  /**
   * 添加消息
   */
  addMessage(chatId: string, message: Omit<SideChatMessage, 'id' | 'timestamp'>): SideChatMessage;

  /**
   * 合并到主对话
   */
  mergeToParent(chatId: string): MergeResult;

  /**
   * 归档
   */
  archive(chatId: string): void;

  /**
   * 解析 slash 命令
   */
  parseCommand(input: string): ParsedCommand | null;

  /**
   * 执行 slash 命令
   */
  executeCommand(command: ParsedCommand): CommandResult;

  /**
   * 订阅事件
   */
  on(event: SideChatEventType, handler: SideChatEventHandler): () => void;
}
```

---

## 四、Slash 命令语法

```
/side <title>          - 创建侧对话并切换到侧对话
/btw <question>        - 创建一次性"顺便问一下"对话，问完即归档
/side list             - 列出所有侧对话
/side switch <id>      - 切换到指定侧对话
/side merge <id>       - 合并侧对话到主对话
/side archive <id>     - 归档侧对话
/help                  - 显示帮助
```

---

## 五、UI 组件

### 5.1 SideChatPanel

- 侧对话列表
- 创建/切换/合并/归档
- 独立消息流渲染

### 5.2 SlashCommandInput

- 输入框 + 提示符
- / 触发命令提示
- 自动补全

### 5.3 SideChatBadge

- 主对话头部显示侧对话数量
- 点击展开侧对话列表

---

## 六、测试要求

### 6.1 单元测试 (30+)

- create / list / get / addMessage
- mergeToParent / archive
- parseCommand / executeCommand
- 持久化

### 6.2 集成测试 (20+)

- SideChatPanel 渲染
- SlashCommandInput 命令提示
- 与主对话的合并流程

### 6.3 E2E 测试 (15+ 断言)

- 侧对话创建/切换
- /side / /btw 命令
- 合并到主对话
- 归档

---

## 七、文件清单

- `frontend/src/utils/sideChatManager.ts` (450 行)
- `frontend/src/utils/sideChatManager.test.ts` (250 行)
- `frontend/src/components/SideChatPanel.tsx` (300 行)
- `frontend/src/components/SideChatPanel.test.tsx` (200 行)
- `frontend/src/hooks/useSlashCommand.ts` (150 行)
- `frontend/src/hooks/useSlashCommand.test.ts` (100 行)

---

## 八、验收标准

- ✅ /side, /btw 命令可用
- ✅ 侧对话独立上下文
- ✅ 可合并到主对话
- ✅ 单元测试 30+ 100% 通过
- ✅ 集成测试 20+ 100% 通过
- ✅ E2E 断言 15+ 100% 通过
- ✅ TypeScript 编译 0 错误
- ✅ Loop Engineering 工作流无回归

---

**SPEC 完成**: 2026-07-29 14:55
