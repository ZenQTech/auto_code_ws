# Cycle 8 P0-14: Custom Models + Bearer Token Auto-Refresh (v6.0.0)

> **任务**: Cycle 8 P0-14
> **版本**: v6.0.0
> **日期**: 2026-07-27
> **状态**: ✅ 100% 完成
> **关联调研**: [CYCLE8_RESEARCH_REPORT.md](../CYCLE8_RESEARCH_REPORT.md)
> **关联差距**: [CYCLE8_GAP_ANALYSIS.md](../CYCLE8_GAP_ANALYSIS.md)
> **关联 Spec**: [.trae/specs/cycle8/custom-models/spec.md](../.trae/specs/cycle8/custom-models/spec.md)

---

## 一、任务背景

### 1.1 现状

Hermes 平台的 `ModelSelector` 组件当前仅支持 3 个硬编码模型（Sol/Terra/Luna），无法满足用户接入 DeepSeek/GLM/Kimi/MiniMax 等第三方 OpenAI-compatible 模型的需求。Codex v0.150+ 已支持 Dynamic Bearer Tokens + Custom Models。

### 1.2 解决的问题

- **多模型支持**: 实现 DeepSeek/GLM/Kimi 等高性价比模型接入
- **Bearer Token 自动刷新**: 长会话中 token 过期无需手动重新输入
- **符合 Codex 标准**: 对齐行业最佳实践

### 1.3 目标

实现 **Custom Models v1.0**：
1. ✅ 动态注册 OpenAI-compatible 模型提供商
2. ✅ 支持 4 种 Provider 类型：OpenAI / Anthropic / Azure / Custom
3. ✅ API Key 加密存储（Fernet 对称加密）
4. ✅ Bearer Token 自动刷新（OAuth 2.1 + 静态 API Key）
5. ✅ ModelSelector 动态加载自定义模型
6. ✅ CustomModelsPanel 管理 UI

---

## 二、交付清单

### 2.1 后端实现

| 文件 | 行数 | 描述 |
|------|------|------|
| `backend/app/services/custom_models/__init__.py` | - | 模块导出 |
| `backend/app/services/custom_models/models_store.py` | 476 | ModelProvider + ModelEntry 数据模型 + Fernet 加密 + SQLite 存储 |
| `backend/app/services/custom_models/bearer_token_refresher.py` | 211 | BearerTokenRefresher + 后台 60s 检查 + 5 分钟提前刷新 |
| `backend/app/services/custom_models/service.py` | 219 | CustomModelsService 高层 API（CRUD + 测试 + 刷新 + 摘要）|
| `backend/app/api/custom_models.py` | 270 | 12 个 REST API 端点 |

### 2.2 前端实现

| 文件 | 行数 | 描述 |
|------|------|------|
| `frontend/src/hooks/useCustomModelsApi.ts` | 425 | 11 个 API Hook（useAllModels/useProviders/useCreateProvider/...）|
| `frontend/src/components/CustomModelsPanel.tsx` | 770 | 完整管理面板（摘要卡片 + Provider 卡片 + 表单 + 模型列表）|
| `frontend/src/components/ModelSelector.tsx` (v2.0.0) | +100 | 动态加载内置 + 自定义模型，紫色 Custom 徽章 |

### 2.3 集成修改

| 文件 | 修改 |
|------|------|
| `backend/app/main.py` | 注册 `/api/custom-models` 路由 + 启动初始化 + 后台刷新任务 |
| `frontend/src/hooks/useModals.ts` | v2.2.0 新增 `customModels` 面板控制器 |
| `frontend/src/components/BrandHeader.tsx` | v2.11.0 新增 `onOpenCustomModels` + 🧠 brain-network 图标 + 菜单项 |
| `frontend/src/components/AppLayout.tsx` | v6.24.0 透传 `onOpenCustomModels` |
| `frontend/src/App.tsx` | 解构 `customModelsModal` + 渲染 `<CustomModelsPanel>` |

### 2.4 测试

| 文件 | 行数 | 测试数 |
|------|------|--------|
| `tests/test_custom_models_units.py` | 478 | 39 单元测试 |
| `tests/test_e2e_custom_models.sh` | 219 | 13 E2E 测试 |

---

## 三、API 端点

### 3.1 Provider 管理

- `GET    /api/custom-models/providers` - 列出 providers（支持 `enabled_only`）
- `POST   /api/custom-models/providers` - 创建 provider
- `GET    /api/custom-models/providers/{id}` - 详情（支持 `include_secrets`）
- `PATCH  /api/custom-models/providers/{id}` - 更新
- `DELETE /api/custom-models/providers/{id}` - 删除
- `POST   /api/custom-models/providers/{id}/test` - 测试连接
- `POST   /api/custom-models/providers/{id}/refresh` - 刷新 token

### 3.2 Model 管理

- `GET    /api/custom-models/models` - 列出所有模型（内置 + 自定义）
- `POST   /api/custom-models/models` - 添加模型条目
- `DELETE /api/custom-models/models/{id}` - 删除模型
- `GET    /api/custom-models/models/provider/{provider_id}` - 列出 provider 下的模型

### 3.3 全局状态

- `GET    /api/custom-models/status` - Token 刷新状态
- `GET    /api/custom-models/summary` - 摘要统计

---

## 四、技术亮点

### 4.1 安全合规

- ✅ **Fernet 对称加密** API Key（密钥自动生成于 `~/.hermes/.encryption_key`）
- ✅ **脱敏显示** API Key（仅保留前 4 位 + **** + 后 4 位）
- ✅ **to_dict(include_secrets=False)** 默认不返回密文
- ✅ **背景后台检查** 60s 间隔，提前 5 分钟自动刷新
- ✅ **可插拔 handler** 支持每种 Provider 类型的自定义刷新逻辑

### 4.2 用户体验

- ✅ **类型徽章** 4 种 Provider 类型颜色区分（绿/橙/蓝/紫）
- ✅ **状态指示器** 已过期/即将过期/活跃/已禁用
- ✅ **倒计时显示** Token 过期时间（"5m 后过期" / "已过期"）
- ✅ **Provider 覆盖** 多个 Provider 同名 model_id 时按字母排序
- ✅ **Custom 徽章** 在 ModelSelector 中显示自定义模型
- ✅ **测试连接** 一键验证 Provider 配置

### 4.3 测试覆盖

- ✅ **39 单元测试** 覆盖 ModelsStore CRUD、加密、BearerTokenRefresher、Service 高层 API、API 路由
- ✅ **13 E2E 测试** 端到端验证 12 个核心 API 端点
- ✅ **TypeScript 编译** 0 错误
- ✅ **Vite 生产构建** 11.46s 成功

---

## 五、测试结果

| 测试维度 | 数量 | 通过率 |
|----------|------|--------|
| 单元测试 (`test_custom_models_units.py`) | 39/39 | 100% |
| E2E 测试 (`test_e2e_custom_models.sh`) | 13/13 | 100% |
| TypeScript 编译 | 0 错误 | 100% |
| Vite 生产构建 | 11.46s | 100% |
| 后端路由注册 | 12 routes | OK |
| **总计** | **52/52** | **100%** |

---

## 六、修改文件清单

```
backend/app/main.py                                       (修改: +24 行 路由注册 + 服务初始化)
backend/app/services/custom_models/__init__.py            (新建: 模块导出)
backend/app/services/custom_models/models_store.py        (新建: 476 行 核心存储)
backend/app/services/custom_models/bearer_token_refresher.py (新建: 211 行 自动刷新)
backend/app/services/custom_models/service.py             (新建: 219 行 服务层)
backend/app/api/custom_models.py                          (新建: 270 行 12 端点)
frontend/src/hooks/useCustomModelsApi.ts                  (新建: 425 行 11 Hook)
frontend/src/components/CustomModelsPanel.tsx              (新建: 770 行 管理面板)
frontend/src/components/ModelSelector.tsx                  (v2.0.0 升级: +100 行 动态加载)
frontend/src/hooks/useModals.ts                           (v2.2.0: +5 行 customModels)
frontend/src/components/BrandHeader.tsx                   (v2.11.0: +30 行 菜单项 + 图标)
frontend/src/components/AppLayout.tsx                     (v6.24.0: +5 行 透传)
frontend/src/App.tsx                                      (修改: +4 行 useModals 解构 + 渲染)
tests/test_custom_models_units.py                         (新建: 478 行 39 单元)
tests/test_e2e_custom_models.sh                           (新建: 219 行 13 E2E)
.trae/specs/cycle8/custom-models/spec.md                  (已存在: 完整设计)
CYCLE8_P0_14_SUMMARY.md                                   (新建: 本文件)
代码修改日志.md                                             (修改: 追加 P0-14 记录)
```

---

## 七、下一轮规划

完成 P0-14 后，Cycle 8 整体 P0 任务全部完成：
- ✅ P0-12: Slash Commands 系统
- ✅ P0-13: Custom Skills/Commands (.trae/commands/)
- ✅ P0-14: Custom Models + Bearer Token Auto-Refresh

下轮（Cycle 9）可候选方向：
- **P1-3 DiffView 组件** - 代码修改细节追踪与可视化
- **P1-4 Loop Engineering /loop 命令集** - 循环工程命令支持
- **P1-5 Custom Agents 路由层** - 用户自定义智能体
- **P2-1 OpenAI-compatible 流式协议适配器** - 真实接入 DeepSeek/GLM
- **P2-2 Token 用量统计 + 计费** - 多模型成本管理

---

**结论**: Cycle 8 P0-14 已 100% 完成，自动化测试 52/52 通过（100%），TypeScript 0 错误，Vite 构建 11.46s 成功。前端可通过 BrandHeader → 🧠 Custom Models 管理 菜单进入。ModelSelector v2.0.0 动态加载内置 + 自定义模型。
