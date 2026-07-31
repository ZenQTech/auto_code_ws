# Cycle 18 P1-3 Spec: 乐观更新模式（Optimistic Updates）

## 目标

实现乐观更新模式，让用户操作立即生效，失败时自动回滚，提升交互响应速度。

## 解决的问题

### 当前痛点
- 每次创建/删除/更新都需要等待后端响应
- 网络延迟（200-500ms）期间 UI 卡住
- 用户体验差，缺少即时反馈

### 典型场景
- 侧边栏删除会话 → 立即消失（成功）/ 重新出现（失败）
- 收藏 / 取消收藏 → 立即切换图标（成功）/ 还原（失败）
- 编辑会话标题 → 立即更新（成功）/ 还原（失败）

## 设计

### 核心 API：useOptimisticMutation

```typescript
const { mutate, isLoading, error } = useOptimisticMutation({
  // 同步更新：立即修改本地状态
  onOptimistic: (variables) => {
    setItems((prev) => [...prev, variables.newItem]);
  },
  // 异步操作
  mutationFn: async (variables) => {
    return await apiFetch('/items', { method: 'POST', body: JSON.stringify(variables) });
  },
  // 成功后用真实数据替换
  onSuccess: (response, variables) => {
    setItems((prev) => prev.map((it) => (it.id === variables.tempId ? response : it)));
  },
  // 失败回滚
  onError: (error, variables) => {
    setItems((prev) => prev.filter((it) => it.id !== variables.tempId));
    showToast('操作失败，已撤销');
  },
});

// 调用
await mutate({ newItem: { id: 'temp_123', name: 'New' } });
```

### 通用 Hook：useOptimisticState

封装 useState + 乐观更新：

```typescript
const [items, setItems] = useOptimisticState(initialItems);

const addItem = useCallback(async (newItem) => {
  const tempId = `temp_${Date.now()}`;
  await setItems.optimistic(
    (prev) => [...prev, { ...newItem, id: tempId, _pending: true }],
    async () => apiFetch('/items', { method: 'POST', body: JSON.stringify(newItem) }),
    {
      onSuccess: (saved) => {
        // 替换 tempId 为真实 ID
        setItems.real((prev) => prev.map((it) => (it.id === tempId ? saved : it)));
      },
    },
  );
}, [setItems]);
```

### 工具函数

```typescript
// 简单场景：直接 await mutate
const result = await optimisticUpdate({
  optimistic: () => applyOptimistic(),
  mutation: () => apiCall(),
  rollback: () => applyRollback(),
  onSuccess: (data) => applyRealData(data),
  onError: (err) => showToast(err.message),
});
```

## 文件结构

```
frontend/src/utils/
├── optimisticUpdate.ts        # 核心工具函数
├── useOptimisticMutation.ts   # React Hook
├── useOptimisticState.ts      # 状态 Hook
└── __tests__/
    ├── optimisticUpdate.test.ts
    └── useOptimisticMutation.test.tsx
```

## 验收标准

- ✅ 单元测试 ≥ 15 个
- ✅ TypeScript 编译 0 错误
- ✅ 完整覆盖：成功 / 失败 / 重入 / 异常
- ✅ 支持自定义 ID 字段（tempId → realId 替换）

## 实施步骤

### Phase 1: 核心实现
1. 创建 `optimisticUpdate.ts` 工具函数
2. 创建 `useOptimisticMutation.ts` Hook
3. 创建 `useOptimisticState.ts` Hook

### Phase 2: 单元测试
1. 测试工具函数（成功/失败/异常）
2. 测试 Hook（React Testing Library）

### Phase 3: 文档 + 提交

## 应用场景（后续 P1-4 集成）

- ✅ 删除会话（侧边栏）
- ✅ 重命名会话
- ✅ 收藏会话
- ✅ 切换主题
- ✅ 删除消息
