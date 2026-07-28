# Cycle 8 P0-14: Custom Models + Bearer Token Auto-Refresh (v6.0.0)

> **任务**: Cycle 8 P0-14
> **版本**: v6.0.0
> **日期**: 2026-07-27
> **状态**: 实施阶段
> **关联调研**: [CYCLE8_RESEARCH_REPORT.md](../../../CYCLE8_RESEARCH_REPORT.md)
> **关联差距**: [CYCLE8_GAP_ANALYSIS.md](../../../CYCLE8_GAP_ANALYSIS.md)
> **关联 P0-12**: [../slash-commands/spec.md](../slash-commands/spec.md) - Slash Commands 基础

---

## 一、任务背景

### 1.1 现状

Hermes 平台的 `ModelSelector` 组件当前仅支持 3 个硬编码模型（Sol/Terra/Luna），无法满足用户接入 DeepSeek/GLM/Kimi/MiniMax 等第三方 OpenAI-compatible 模型的需求。Codex v0.150+ 已支持 Dynamic Bearer Tokens + Custom Models。

### 1.2 问题

- **多模型支持缺失**: 无法使用 DeepSeek/GLM/Kimi 等高性价比模型
- **Bearer Token 无自动刷新**: 长会话中 token 过期需手动重新输入
- **不符合 Codex 标准**: 偏离行业最佳实践

### 1.3 目标

实现 **Custom Models v1.0**：
1. 动态注册 OpenAI-compatible 模型提供商
2. 支持 4 种 Provider 类型：OpenAI / Anthropic / Azure / Custom
3. API Key 加密存储（Fernet 对称加密）
4. Bearer Token 自动刷新（OAuth 2.1 + 静态 API Key）
5. ModelSelector 动态加载自定义模型
6. CustomModelsPanel 管理 UI

---

## 二、技术调研

参考 [Codex v0.150+ Dynamic Bearer Tokens](https://docs.openai.com/codex/cli/dynamic-bearer-tokens)：

| 特性 | Codex 实现 |
|------|----------|
| Provider 类型 | OpenAI / Anthropic / Azure / Ollama / Custom |
| 认证方式 | API Key / OAuth 2.1 / Device Code |
| Token 存储 | 加密（machine-specific key） |
| 刷新策略 | 提前 5 分钟自动刷新 |
| 速率限制 | 429 响应触发指数退避 |
| 模型格式 | OpenAI-compatible chat completions API |

---

## 三、技术实现

### 3.1 后端实现

#### 3.1.1 `models_store.py` (~200 行)
- `ModelProvider` 数据类（id/name/type/base_url/api_key_encrypted/refresh_token/expires_at）
- `ModelEntry` 数据类（id/provider_id/model_id/display_name/max_tokens/context_window/temperature_default）
- `ModelsStore` 类（SQLite 持久化 + Fernet 加密）
- CRUD: create/read/update/delete/list
- 加密：使用 cryptography.fernet

#### 3.1.2 `bearer_token_refresher.py` (~180 行)
- `BearerTokenRefresher` 类
  - `schedule_refresh(provider_id)` - 调度下次刷新
  - `refresh_now(provider_id)` - 立即刷新
  - `_refresh_oauth_token()` - OAuth 2.1 流程
  - `_validate_token()` - 验证当前 token 有效性
- 后台任务：每 60s 检查即将过期的 token
- 提前 5 分钟自动刷新

#### 3.1.3 `models_service.py` (~150 行)
- `ModelsService` 类
  - `list_available_models()` - 列出所有可用模型（内置 + 自定义）
  - `select_model(model_id)` - 选择默认模型
  - `test_provider(provider_id)` - 测试 provider 连接性
  - `get_provider_status()` - 获取 provider 状态

#### 3.1.4 `api/custom_models.py` (~250 行)
- 12 个 REST API 端点:
  - `GET /api/custom-models/providers` - 列出 providers
  - `POST /api/custom-models/providers` - 创建 provider
  - `GET /api/custom-models/providers/{id}` - 详情
  - `PATCH /api/custom-models/providers/{id}` - 更新
  - `DELETE /api/custom-models/providers/{id}` - 删除
  - `POST /api/custom-models/providers/{id}/test` - 测试连接
  - `POST /api/custom-models/providers/{id}/refresh` - 刷新 token
  - `GET /api/custom-models/models` - 列出所有模型
  - `POST /api/custom-models/models` - 添加模型
  - `DELETE /api/custom-models/models/{id}` - 删除模型
  - `GET /api/custom-models/status` - 全局状态
  - `POST /api/custom-models/select` - 选择默认模型

### 3.2 前端实现

#### 3.2.1 `useCustomModelsApi.ts` (~250 行)
- `useProviders()` - 列出 providers
- `useProvider(id)` - 单个 provider 详情
- `useCreateProvider()` - 创建
- `useUpdateProvider()` - 更新
- `useDeleteProvider()` - 删除
- `useTestProvider()` - 测试连接
- `useRefreshProvider()` - 手动刷新 token
- `useAllModels()` - 列出所有模型
- `useStatus()` - 全局状态

#### 3.2.2 `CustomModelsPanel.tsx` (~400 行)
- **Provider 列表卡片**
  - 类型徽章 (OpenAI/Anthropic/Azure/Custom)
  - 状态指示器（绿/红/灰）
  - Token 过期时间
  - 操作按钮（测试/刷新/编辑/删除）
- **创建表单**
  - 类型选择 + 名称 + Base URL + API Key
  - OAuth 流程（Device Code）
- **模型列表**
  - 每个 provider 下的模型
  - 显示 context window / max tokens
- **统计卡片**（总数/已启用/即将过期）

#### 3.2.3 `ModelSelector.tsx` v2.0.0 (~100 行新增)
- 整合 `useAllModels()` 替换硬编码列表
- 保留 Sol/Terra/Luna 作为内置模型
- 追加用户自定义模型（按字母排序）
- Provider 徽章显示

### 3.3 集成修改

| 文件 | 修改内容 |
|------|---------|
| `backend/app/main.py` | 注册 `/api/custom-models` 路由 + 启动时加载 + 后台刷新任务 |
| `frontend/src/hooks/useModals.ts` | 添加 `customModels` 面板控制器 |
| `frontend/src/components/BrandHeader.tsx` | 添加 "🧠 Custom Models" 菜单项 |
| `frontend/src/components/AppLayout.tsx` | 集成 CustomModelsPanel |
| `frontend/src/components/ModelSelector.tsx` | 升级到 v2.0.0 动态加载 |

---

## 四、数据模型

### 4.1 ModelProvider

```python
@dataclass
class ModelProvider:
    id: str                    # UUID
    name: str                  # "DeepSeek Official"
    type: str                  # "openai" | "anthropic" | "azure" | "custom"
    base_url: str              # "https://api.deepseek.com/v1"
    api_key_encrypted: str     # Fernet 加密
    refresh_token: Optional[str]
    expires_at: Optional[float]  # unix timestamp
    enabled: bool = True
    created_at: float
    updated_at: float
    metadata: Dict[str, Any]   # 自定义字段
```

### 4.2 ModelEntry

```python
@dataclass
class ModelEntry:
    id: str                    # UUID
    provider_id: str           # 关联 provider
    model_id: str              # "deepseek-chat"
    display_name: str          # "DeepSeek Chat"
    max_tokens: int = 4096
    context_window: int = 32768
    temperature_default: float = 0.7
    enabled: bool = True
```

---

## 五、安全要求

### 5.1 API Key 加密

- 使用 `cryptography.fernet.Fernet` 对称加密
- 密钥从 `~/.hermes/.encryption_key` 读取（首次启动自动生成）
- 数据库中仅存储密文
- 内存中临时解密（用完即清）

### 5.2 OAuth Token 刷新

- 检测到 401/403 响应时触发刷新
- 提前 5 分钟主动刷新
- 刷新失败时标记 provider 为"过期"状态
- 用户可在 UI 中手动触发刷新

### 5.3 速率限制处理

- 429 响应触发指数退避（1s → 2s → 4s → ...）
- 最多重试 3 次
- 失败后返回明确错误信息

---

## 六、测试要求

### 6.1 单元测试

- T1: ModelsStore CRUD + 加密 (≥ 8 测试)
- T2: BearerTokenRefresher (≥ 6 测试)
- T3: ModelsService (≥ 6 测试)
- **合计**: ≥ 20 个单元测试

### 6.2 E2E 测试

- [1] 列出 providers
- [2] 创建 provider
- [3] 查询 provider 详情
- [4] 更新 provider
- [5] 删除 provider
- [6] 测试 provider 连接
- [7] 列出模型
- [8] 添加模型
- [9] 删除模型
- [10] 选择默认模型
- [11] 全局状态
- **合计**: ≥ 11 个 E2E 测试

### 6.3 验收标准

- ✅ 4 种 provider 类型支持
- ✅ API Key 加密存储
- ✅ Bearer Token 自动刷新
- ✅ ModelSelector 动态加载自定义模型
- ✅ 0 TypeScript 错误
- ✅ 100% 自动化测试通过率

---

## 七、风险评估

### 7.1 加密密钥管理
- **风险**: 加密密钥丢失导致所有 API Key 无法解密
- **缓解**: 启动时检测密钥文件，缺失则警告用户

### 7.2 OAuth 流程复杂度
- **风险**: OAuth Device Code 流程在某些环境下不可用
- **缓解**: 同时支持 API Key 静态认证作为降级

### 7.3 Provider 协议差异
- **风险**: 不同 provider API 路径/参数不一致
- **缓解**: Adapter 模式抽象统一接口

---

## 八、交付清单

- ✅ 4 个新后端文件
- ✅ 3 个新前端文件
- ✅ 5 个修改文件
- ✅ 2 个测试文件（≥ 31 测试）
- ✅ 1 个总结报告（CYCLE8_P0_14_SUMMARY.md）

---

## 九、下一轮规划

完成 P0-14 后：
- **P1-3 DiffView 组件**
- **P1-4 Loop Engineering /loop 命令集**
- **P1-5 Custom Agents 路由层**
