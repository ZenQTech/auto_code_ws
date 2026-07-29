# Cycle 12 P0-1 Plugin 系统 - 规格文档

> **周期**: Cycle 12
> **任务**: P0-1 Plugin 系统
> **时间**: 2026-07-28
> **模块版本**: v1.0.0

---

## 一、目标

实现 Hermes Plugin 系统，将分散的扩展能力（skills/agents/rules/hooks/commands）打包为可分发的 Plugin bundle。

## 二、核心能力

### 2.1 Plugin 加载
- 从 `.trae/plugins/{official,community,personal}/` 扫描
- 解析 manifest.json
- 验证依赖关系
- 注册到 PluginRegistry

### 2.2 Plugin 管理
- install / uninstall / enable / disable
- list / search / get
- reload / validate

### 2.3 依赖解析
- Hermes 版本约束（semver）
- Plugin 间依赖（graph resolve）
- Python/Node 版本要求

### 2.4 签名验证（最小原型）
- HMAC-SHA256 校验和
- 简化版 publisher 验证

## 三、目录结构

```
backend/app/core/plugins/
├── __init__.py              # 模块入口
├── base.py                  # 数据模型
├── loader.py                # 加载器
├── registry.py              # 线程安全注册表
├── installer.py             # 安装/卸载
├── resolver.py              # 依赖解析
├── validator.py             # 验证
├── exceptions.py            # 异常类
└── examples/                # 示例 Plugin
    ├── hermes-core/
    └── sentry-triage/
```

## 四、API 端点

| 端点 | 方法 | 描述 |
| --- | --- | --- |
| `/api/plugins/health` | GET | 健康检查 |
| `/api/plugins/list` | GET | 列出所有 Plugin |
| `/api/plugins/scan` | POST | 扫描 Plugin 目录 |
| `/api/plugins/install` | POST | 安装 Plugin |
| `/api/plugins/uninstall` | POST | 卸载 Plugin |
| `/api/plugins/enable` | POST | 启用 Plugin |
| `/api/plugins/disable` | POST | 禁用 Plugin |
| `/api/plugins/{id}` | GET | Plugin 详情 |
| `/api/plugins/{id}/reload` | POST | 重新加载 |
| `/api/plugins/marketplace/search` | GET | 搜索 |

## 五、数据模型

```python
@dataclass
class PluginManifest:
    id: str
    name: str
    version: str
    description: str
    author: Dict[str, str]
    license: str
    hermes_version: str  # semver 约束
    dependencies: Dict[str, Any]
    components: Dict[str, List[str]]
    permissions: Dict[str, Any]
    verification: Dict[str, str]

@dataclass
class Plugin:
    manifest: PluginManifest
    base_path: Path
    enabled: bool
    installed_at: str
    components_loaded: Dict[str, int]
```

## 六、验收标准

- [ ] 7 个后端模块
- [ ] 至少 2 个示例 Plugin
- [ ] 10+ REST 端点
- [ ] 90+ 单元测试
- [ ] 30+ E2E 断言
- [ ] 前端 PluginPanel（基础）
- [ ] 100% 测试通过
- [ ] 完整中文注释
