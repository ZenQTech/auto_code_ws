# 会话 fork / resume 高级管理 - Spec

## 1. 功能需求

### 1.1 目标
实现 Codex 风格的会话 fork（分叉）和 resume（恢复）功能，使用户能够基于现有会话创建新分支或恢复历史会话。

### 1.2 用户场景
1. **场景 A：会话 fork**
   - 用户在对话第 5 轮时想尝试不同方向
   - 点击"分叉"按钮 → 创建新会话，继承前 5 轮上下文
   - 之后两个会话独立演化

2. **场景 B：会话 resume**
   - 用户关闭应用 1 周后回来
   - 打开会话列表 → 选择历史会话
   - 完整恢复历史消息和状态

3. **场景 C：跨设备同步**
   - 用户在 A 设备开始会话
   - 在 B 设备打开 → 自动同步
   - 继续对话

### 1.3 使用流程
```
原始会话 → 点击 Fork → 创建新会话 + 复制消息 → 独立演化
历史会话 → 点击 Resume → 加载完整状态 → 继续对话
```

## 2. 技术实现方案

### 2.1 数据模型

**Session 扩展**：
```python
class Session(Base):
    # 已有字段...
    parent_session_id: Optional[str]  # 父会话 ID（fork 来源）
    forked_at: Optional[datetime]     # fork 时间
    fork_point_message_id: Optional[str]  # fork 时的消息 ID
    is_archived: bool = False
    last_active_at: datetime
    device_id: Optional[str]  # 最后操作的设备
```

### 2.2 Fork 算法

```
输入：source_session_id, fork_point_message_id
1. 创建新 Session：
   - title: "源会话名 (fork)"
   - parent_session_id: source_session_id
   - fork_point_message_id: <input>
2. 复制消息：source 中 fork_point 之前（含）的所有消息
3. 复制工作流状态（如果有 workflow_id）
4. 复制 agent/task/conversation 关联
5. 返回新 session_id
```

### 2.3 Resume 算法

```
输入：session_id, device_id (optional)
1. 查询 session + messages + agents + tasks + conversations
2. 若 device_id 不同：标记 device_id 为新设备
3. 更新 last_active_at
4. 返回完整 detail
```

## 3. 接口设计规范

### 3.1 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sessions/{id}/fork` | POST | 分叉会话 |
| `/api/sessions/{id}/resume` | POST | 恢复会话（带设备同步） |
| `/api/sessions/{id}/lineage` | GET | 查询会话血缘（父子链） |

### 3.2 请求/响应格式

```json
// POST /api/sessions/{id}/fork
{
  "fork_point_message_id": "msg-uuid-xxx",
  "title": "探索方案 B"  // 可选
}

// 响应
{
  "success": true,
  "session": {
    "id": "new-session-uuid",
    "title": "新会话 (fork)",
    "parent_session_id": "source-uuid",
    "fork_point_message_id": "msg-uuid-xxx",
    "created_at": "2026-07-27T..."
  },
  "messages_copied": 42
}
```

## 4. 数据结构定义

### 4.1 Session 扩展
```python
class Session(Base):
    id: str
    title: str
    mode: str
    # v3.0 新增
    parent_session_id: Optional[str]
    forked_at: Optional[datetime]
    fork_point_message_id: Optional[str]
    device_id: Optional[str]
    last_active_at: datetime
```

### 4.2 SessionLineage
```python
class SessionLineage(BaseModel):
    session_id: str
    ancestors: List[SessionInfo]  # 父辈链
    descendants: List[SessionInfo]  # 子辈链
    depth: int  # 血缘深度
```

## 5. 性能与安全要求

### 5.1 性能指标
- Fork 延迟：< 500ms（100 条消息内）
- Resume 延迟：< 200ms
- Lineage 查询：< 100ms

### 5.2 安全要求
- Fork 必须有用户认证
- 不能 fork 跨用户的会话
- Resume 时检查设备合法性

## 6. 验收标准

### 6.1 功能验证
- [ ] Fork 创建新会话，复制 5 条消息
- [ ] Fork 后两个会话独立演化（互不影响）
- [ ] Resume 恢复完整历史
- [ ] Lineage 查询返回正确的父-子链

### 6.2 测试项目

#### 6.2.1 脚本自动测试
```python
def test_fork_session():
    """验证 fork 创建新会话并复制消息"""

def test_fork_independence():
    """验证 fork 后独立性"""

def test_resume_session():
    """验证 resume 恢复完整状态"""

def test_lineage_chain():
    """验证 lineage 查询（A → B → C）"""

def test_fork_permissions():
    """验证 fork 跨用户权限检查"""
```

#### 6.2.2 前端 E2E 测试
- [ ] 会话列表右键菜单显示"分叉"选项
- [ ] 点击分叉 → 新会话出现在列表
- [ ] 新会话包含原会话前 N 条消息
- [ ] 两个会话独立接收新消息
- [ ] 点击历史会话 → 完整恢复

## 7. 实施步骤

1. **M1: 数据模型扩展**（0.5h）
2. **M2: Fork 算法**（1h）
3. **M3: Resume 算法**（1h）
4. **M4: API 端点**（1h）
5. **M5: 前端 UI**（1.5h）
6. **M6: 端到端测试**（0.5h）
