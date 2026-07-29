# Cycle 12 P0-1 Plugin 系统 - 验收清单

> **周期**: Cycle 12
> **任务**: P0-1 Plugin 系统
> **时间**: 2026-07-28
> **模块版本**: v1.0.0

---

## 一、功能验收

### 1.1 Plugin 加载

- [ ] 从 `.trae/plugins/{official,community,personal}/` 目录扫描
- [ ] 解析 manifest.json（Pydantic 模型）
- [ ] 支持缺失字段的容错处理
- [ ] 记录加载日志
- [ ] 跳过 _template 占位符

### 1.2 Plugin 注册

- [ ] 线程安全注册表（RLock）
- [ ] 全局单例
- [ ] 支持按 id 查询
- [ ] 支持按 name 查询
- [ ] 支持按 category 查询
- [ ] 统计信息（总数/启用/禁用）

### 1.3 Plugin 依赖解析

- [ ] Hermes 版本约束（semver）
- [ ] Plugin 间依赖
- [ ] 循环依赖检测
- [ ] 依赖缺失检测
- [ ] 依赖版本冲突检测

### 1.4 Plugin 验证

- [ ] manifest.json 必填字段验证
- [ ] 路径白名单检查
- [ ] 组件路径存在性验证
- [ ] 签名验证（HMAC-SHA256 简化版）

### 1.5 Plugin 生命周期

- [ ] install（从本地路径）
- [ ] uninstall（清理注册表）
- [ ] enable（激活）
- [ ] disable（停用）
- [ ] reload（重新加载）

## 二、API 验收

- [ ] GET /api/plugins/health - 健康检查
- [ ] GET /api/plugins/list - 列出所有
- [ ] POST /api/plugins/scan - 扫描目录
- [ ] POST /api/plugins/install - 安装
- [ ] POST /api/plugins/uninstall - 卸载
- [ ] POST /api/plugins/enable - 启用
- [ ] POST /api/plugins/disable - 禁用
- [ ] GET /api/plugins/{id} - 详情
- [ ] POST /api/plugins/{id}/reload - 重载
- [ ] GET /api/plugins/marketplace/search - 搜索
- [ ] GET /api/plugins/stats - 统计

## 三、测试验收

### 3.1 单元测试（90+ 用例）

- [ ] base.py 数据模型（20+ 用例）
  - PluginManifest 解析
  - 必填字段验证
  - 可选字段处理
  - JSON 序列化
- [ ] loader.py 加载器（15+ 用例）
  - 目录扫描
  - manifest 解析
  - 错误处理
- [ ] registry.py 注册表（15+ 用例）
  - 注册/注销
  - 查询（id/name/category）
  - 线程安全
- [ ] installer.py 安装器（15+ 用例）
  - 安装流程
  - 卸载流程
  - 依赖检查
- [ ] resolver.py 解析器（10+ 用例）
  - semver 约束
  - 依赖图
- [ ] validator.py 验证器（15+ 用例）
  - 路径白名单
  - 签名验证

### 3.2 E2E 测试（30+ 断言）

- [ ] 健康检查
- [ ] 扫描目录
- [ ] 列出 Plugin
- [ ] 安装 Plugin
- [ ] 卸载 Plugin
- [ ] 启用/禁用
- [ ] 详情查询
- [ ] 重新加载
- [ ] 错误路径（不存在/无效）

### 3.3 集成测试（20+ 断言）

- [ ] 加载示例 Plugin
- [ ] 完整生命周期
- [ ] 依赖解析流程
- [ ] 性能（< 1s 扫描）

## 四、代码质量

- [ ] 所有函数有中文注释
- [ ] 所有文件有头部注释
- [ ] 所有模块有修改记录
- [ ] Pydantic 模型验证
- [ ] 异常处理完整
- [ ] 路径白名单严格

## 五、文档验收

- [ ] spec.md 完整
- [ ] task.md 详细
- [ ] checklist.md 完整
- [ ] CYCLE12_P0_1_SUMMARY.md 总结
- [ ] 代码修改日志 v6.18.0
- [ ] 示例 Plugin README

## 六、集成验收

- [ ] 后端服务启动正常
- [ ] 前端构建无错误
- [ ] 路由注册无冲突
- [ ] API 响应 < 500ms
- [ ] 端到端工作流通过

## 七、最终交付

- [ ] Git 提交
- [ ] 标签 v6.18.0
- [ ] 代码修改日志
- [ ] 测试通过 100%
- [ ] 示例 Plugin 可用
- [ ] 前端可访问
