/**
 * # ============================================================
 * # Agent Checkpoint Types - 代理检查点类型定义 (v1.0.0 Cycle 27 G27-02)
 * # ============================================================
 * # 核心作用：定义 Agent Checkpoint 引擎的所有类型与默认配置
 * # 参考：Claude Code 2026-06 #7 Agent Checkpointing and Resume
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-02 初次创建
 * # ============================================================
 */

/**
 * 检查点 - 描述某个时刻整个代理树的状态
 * 区别于 Session Persistence：仅保存对话历史
 * Agent Checkpoint 保存完整代理树状态
 */
export interface AgentCheckpoint {
  /** 检查点唯一 ID */
  id: string;
  /** 检查点名称（用户可命名） */
  name: string;
  /** 检查点描述 */
  description: string;
  /** 创建时间 */
  createdAt: number;
  /** 创建时执行的代理 UUID（标识哪个 root 创建的） */
  rootUuid: string;
  /** 检查点大小（字节） */
  sizeBytes: number;
  /** 节点数量 */
  nodeCount: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 标签 */
  tags: string[];
  /** 序列化的代理树 */
  treeData: unknown;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 检查点引擎配置
 */
export interface AgentCheckpointConfig {
  /** 最大保留检查点数（超过自动清理最旧） */
  maxCheckpoints: number;
  /** 清理时间（天） */
  cleanupDays: number;
  /** 是否启用差异存储 */
  diffStorage: boolean;
  /** 是否启用 IndexedDB */
  useIndexedDB: boolean;
  /** localStorage 存储 key */
  storageKey: string;
}

/**
 * 检查点事件类型
 */
export type AgentCheckpointEventType =
  | 'checkpoint-saved'
  | 'checkpoint-restored'
  | 'checkpoint-deleted'
  | 'checkpoint-renamed'
  | 'cleanup-completed'
  | 'cleanup-failed'
  | 'storage-quota-exceeded';

/**
 * 检查点事件
 */
export interface AgentCheckpointEvent {
  type: AgentCheckpointEventType;
  timestamp: number;
  checkpointId?: string;
  data?: Record<string, unknown>;
}

/**
 * 默认配置
 */
export const DEFAULT_AGENT_CHECKPOINT_CONFIG: AgentCheckpointConfig = {
  maxCheckpoints: 50,
  cleanupDays: 30,
  diffStorage: true,
  useIndexedDB: false,
  storageKey: 'hermes.agentCheckpoints',
};

/**
 * 生成检查点 ID
 */
export function generateCheckpointId(): string {
  return 'cp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 计算检查点大小（字节）
 */
export function calculateCheckpointSize(data: unknown): number {
  return new Blob([JSON.stringify(data)]).size;
}
