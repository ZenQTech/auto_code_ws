# CYCLE31 SPEC - G31-02 远程 Worktree Backend（RemoteWorktreeAdapter）

**任务 ID**：G31-02
**版本**：v1.0.0
**日期**：2026-07-30
**优先级**：P0
**来源调研**：[Cursor 3 Cloud Agent](https://thenextgentechinsider.com/pulse/cursor-3-launches-design-mode-and-boosts-remote-agent-features)、[Codex App](https://openai.com/ko-KR/index/introducing-the-codex-app/)

---

## 一、目标

实现 `RemoteWorktreeAdapter`，抽象 local / remote / hybrid 多种 Worktree 后端，支持 local→remote 会话迁移，对接 Codex Cloud Agent、Cursor 3 Cloud Handoff 等行业实践。

## 二、核心能力

### 2.1 后端抽象

三种后端实现：
- **LocalBackend**：本地文件系统（git worktree）
- **RemoteBackend**：远程服务器（SSH/API）
- **HybridBackend**：本地 + 远程混合（本地编辑，远程运行）

后端接口统一：
```typescript
interface WorktreeBackend {
  readonly id: string;
  readonly type: 'local' | 'remote' | 'hybrid';
  readonly name: string;
  healthCheck(): Promise<HealthStatus>;
  createWorktree(opts: WorktreeCreateOptions): Promise<Worktree>;
  deleteWorktree(id: string): Promise<void>;
  listWorktrees(): Promise<Worktree[]>;
  syncWorktree(id: string): Promise<Worktree>;
}
```

### 2.2 智能后端选择

- **基于成本**：优先选择低成本后端
- **基于延迟**：优先选择低延迟后端
- **基于可用性**：避免选择不健康后端
- **用户偏好**：用户可指定首选后端

### 2.3 会话迁移

- **local → remote**：将本地 worktree 状态序列化 + 推送到远程 + 在远程重启
- **remote → local**：将远程 worktree 拉取到本地 + 重启
- **remote → remote**：跨远程后端迁移

### 2.4 健康检查

- 定期 ping 后端（默认 60s）
- 健康状态：`healthy` / `degraded` / `unhealthy` / `offline`
- 自动从选择池中移除不健康后端

## 三、数据模型

### 3.1 Worktree

```typescript
interface Worktree {
  id: string;
  backendId: string;        // 所属后端
  branch: string;            // git 分支
  baseBranch: string;        // 基线分支
  path: string;              // 文件系统路径
  status: 'creating' | 'ready' | 'syncing' | 'paused' | 'migrating' | 'error';
  createdAt: number;
  lastSyncAt?: number;
  lastError?: string;
  metadata?: Record<string, any>;
  size?: number;             // 字节
  fileCount?: number;
  commitCount?: number;
}
```

### 3.2 后端配置

```typescript
interface WorktreeBackendConfig {
  id: string;
  name: string;
  type: 'local' | 'remote' | 'hybrid';
  enabled: boolean;
  priority: number;          // 优先级（0-100，越高越优先）
  config: LocalBackendConfig | RemoteBackendConfig | HybridBackendConfig;
}

interface LocalBackendConfig {
  basePath: string;          // 本地仓库根目录
}

interface RemoteBackendConfig {
  endpoint: string;          // API 端点
  authToken?: string;        // 认证 token
  sshConfig?: { host: string; port: number; user: string; keyPath?: string };
  region?: string;
}

interface HybridBackendConfig {
  localPath: string;
  remoteEndpoint: string;
  syncMode: 'on-save' | 'periodic' | 'manual';
  syncIntervalMs?: number;
}
```

### 3.3 迁移收据

```typescript
interface MigrationReceipt {
  migrationId: string;
  worktreeId: string;
  fromBackend: string;
  toBackend: string;
  startedAt: number;
  completedAt: number;
  filesTransferred: number;
  bytesTransferred: number;
  status: 'success' | 'failed' | 'partial';
  error?: string;
}
```

## 四、核心 API

```typescript
class RemoteWorktreeAdapter {
  // 后端管理
  registerBackend(config: WorktreeBackendConfig): void
  unregisterBackend(backendId: string): void
  listBackends(): WorktreeBackend[]
  getBackend(id: string): WorktreeBackend
  
  // 智能选择
  selectBackend(criteria: BackendSelectionCriteria): string
  
  // Worktree 操作
  create(options: WorktreeCreateOptions): Promise<Worktree>
  delete(worktreeId: string): Promise<void>
  list(filter?: WorktreeFilter): Promise<Worktree[]>
  get(worktreeId: string): Promise<Worktree | null>
  sync(worktreeId: string): Promise<Worktree>
  
  // 会话迁移
  migrateToRemote(worktreeId: string, targetBackendId: string): Promise<MigrationReceipt>
  migrateToLocal(worktreeId: string, targetBackendId?: string): Promise<MigrationReceipt>
  migrateBetweenRemotes(worktreeId: string, targetBackendId: string): Promise<MigrationReceipt>
  
  // 健康检查
  healthCheck(backendId: string): Promise<HealthStatus>
  healthCheckAll(): Promise<Map<string, HealthStatus>>
  getBackendMetrics(backendId: string): BackendMetrics
  
  // 事件订阅
  on(event: AdapterEventType, listener: (e: AdapterEvent) => void): () => void
}
```

## 五、关键实现

### 5.1 后端接口

定义统一接口 `WorktreeBackend`，所有后端实现该接口。LocalBackend 用 git CLI 或 isomorphic-git；RemoteBackend 用 fetch API；HybridBackend 组合两者。

### 5.2 选择算法

```typescript
function selectBackend(criteria: BackendSelectionCriteria): string {
  // 1. 过滤 enabled=true 且 healthy 的后端
  // 2. 按 criteria.weight 排序（cost / latency / availability）
  // 3. 优先级 + 加权评分
  // 4. 返回最高分后端 ID
}
```

### 5.3 迁移流程（local → remote）

1. 暂停 worktree 中的所有 agent
2. 序列化 worktree 状态（commit + uncommitted changes + agent state）
3. 推送到远程后端
4. 在远程后端创建对应 worktree
5. 恢复 agent 状态
6. 验证远程 worktree 可用
7. 删除本地 worktree（或保留为只读）
8. 触发 `worktree-migrated` 事件

## 六、测试策略

| 测试维度 | 测试数 | 说明 |
|---------|--------|------|
| 后端注册 | 10 | 各种后端配置 |
| Worktree CRUD | 15 | create/read/list/delete/sync |
| 智能选择 | 10 | 不同 criteria 下选择 |
| 会话迁移 | 15 | 三种迁移方向 + 失败回滚 |
| 健康检查 | 8 | 单个/全部 |
| 事件系统 | 5 | 订阅/退订 |
| 持久化 | 5 | localStorage |
| 边界条件 | 10 | 后端离线、迁移失败 |
| **合计** | **~78** | 单元测试 |

## 七、UI 组件

### 7.1 RemoteWorktreePanel（3 Tab 页）

1. **后端管理**：注册/配置/启停后端
2. **Worktree 列表**：跨后端列出 + 操作（创建/删除/同步/迁移）
3. **迁移历史**：迁移记录 + 回滚

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| 远程后端离线 | 健康检查 + 自动重试 + 降级到本地 |
| 迁移中数据丢失 | 迁移前快照 + 迁移后验证 + 失败回滚 |
| 认证 token 泄露 | 不在 localStorage 明文存储 + 提示用户 |
| 网络带宽限制 | 增量迁移 + 压缩 + 后台任务 |

## 九、与现有能力的关系

- **WorktreeManager（Cycle 20 G20-01）**：本地 Worktree → 多后端抽象（上游）
- **BestOfN×Worktree（Cycle 21 G21-01）**：每个候选在独立 worktree → 跨后端候选
- **DynamicWorkflow（Cycle 30 G30-02）**：Phase-based 编排 → 远程 phase 迁移
- **OrchestratedAgent（Cycle 30 G30-03）**：6 阶段编排 → 跨后端阶段调度

---

**G31-02 SPEC 完成。下一阶段：G31-03 SPEC。**
