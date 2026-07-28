# P2-2 Hermes Doctor - 验收清单

> **任务 ID**: P2-2
> **关联规格**: [spec.md](./spec.md)
> **关联任务**: [task.md](./task.md)
> **日期**: 2026-07-28
> **状态**: ⏳ 待验收

---

## 一、功能验收

### 1.1 6 大类诊断器

- [ ] **Environment Checker**（10 项）
  - [ ] python_version 检查
  - [ ] node_version 检查
  - [ ] git_version 检查
  - [ ] os / shell / encoding 检查
  - [ ] anthropic_api_key 检查（脱敏）
  - [ ] anthropic_base_url 检查
  - [ ] home_dir / hermes_home 检查
- [ ] **Workspace Checker**（8 项）
  - [ ] current_path 检查
  - [ ] git_status 检查
  - [ ] remote 检查
  - [ ] trae_dir / agents_md / specs_dir 检查
  - [ ] disk_space 检查
  - [ ] file_count 检查
- [ ] **LLM Checker**（6 项）
  - [ ] api_reachable 检查
  - [ ] api_latency 检查
  - [ ] models_available 检查
  - [ ] token_quota 检查
  - [ ] streaming / tool_use 检查
- [ ] **Database Checker**（6 项）
  - [ ] connection 检查
  - [ ] migration 检查
  - [ ] tables 检查
  - [ ] indexes 检查
  - [ ] size / wal_mode 检查
- [ ] **MCP Checker**（6 项）
  - [ ] config_exists / config_valid 检查
  - [ ] servers_declared / servers_reachable 检查
  - [ ] protocol_version / tools_listed 检查
- [ ] **Dependencies Checker**（7 项）
  - [ ] fastapi / sqlalchemy / httpx / pydantic / uvicorn 版本检查
  - [ ] frontend_node_modules / dist_exists 检查

### 1.2 4 种输出模式

- [ ] **Summary**（默认，人类可读）
  - [ ] 6 类状态汇总展示
  - [ ] 关键问题列表
  - [ ] 修复建议内联显示
  - [ ] ANSI 颜色（绿/黄/红）
- [ ] **JSON**（机器可读）
  - [ ] 完整结构化数据
  - [ ] 可被 jq 解析
  - [ ] 包含 report_id / timestamp / hostname
- [ ] **All**（完整报告）
  - [ ] JSON + 全部 details
  - [ ] 原始输出捕获
  - [ ] 修复建议完整文本
- [ ] **No-color**（禁用颜色）
  - [ ] 去除所有 ANSI 码
  - [ ] 适用于日志文件

### 1.3 REST API 端点

- [ ] `GET  /api/doctor/health` - 健康检查
- [ ] `GET  /api/doctor/run` - 完整诊断
- [ ] `GET  /api/doctor/run?category={name}` - 单类诊断
- [ ] `GET  /api/doctor/{category}` - 类别诊断
- [ ] `POST /api/doctor/feedback` - 反馈
- [ ] `GET  /api/doctor/history` - 历史列表
- [ ] `GET  /api/doctor/history/{id}` - 单个历史
- [ ] `GET  /api/doctor/fix/{check_id}` - 修复建议

### 1.4 CLI 命令

- [ ] `hermes doctor` 默认 summary 输出
- [ ] `hermes doctor --json` JSON 输出
- [ ] `hermes doctor --all` 完整输出
- [ ] `hermes doctor --no-color` 禁用颜色
- [ ] `hermes doctor --category <name>` 单类
- [ ] `hermes doctor --help` 帮助信息

### 1.5 修复建议

- [ ] 覆盖所有 error 项（100%）
- [ ] 覆盖所有 warning 项（80%+）
- [ ] 风险评级（low / medium / high）
- [ ] 步骤化（每步独立可执行）
- [ ] 复制到剪贴板功能

### 1.6 历史报告

- [ ] 持久化到 `~/.hermes/doctor/history/`
- [ ] JSONL 格式人类可读
- [ ] 内存索引快速查询
- [ ] 自动清理（保留最近 50 份）
- [ ] 时间倒序排列

---

## 二、测试验收

### 2.1 单元测试（目标 50+ 用例）

- [ ] `TestBaseChecker`（5）
  - [ ] 数据模型序列化
  - [ ] 脱敏函数
  - [ ] 路径白名单
  - [ ] 超时控制
  - [ ] 异常处理
- [ ] `TestEnvironmentChecker`（10）
  - [ ] python_version 正常
  - [ ] python_version 过低
  - [ ] node_version 正常
  - [ ] node_version 缺失
  - [ ] git_version 正常
  - [ ] api_key 缺失
  - [ ] api_key 已设置
  - [ ] home_dir 可写
  - [ ] hermes_home 未初始化
  - [ ] encoding UTF-8
- [ ] `TestWorkspaceChecker`（8）
- [ ] `TestLLMChecker`（6）
- [ ] `TestDatabaseChecker`（6）
- [ ] `TestMCPChecker`（6）
- [ ] `TestDependenciesChecker`（7）
- [ ] `TestRunner`（4）
- [ ] `TestFormatters`（4）
- [ ] `TestFixAdvisor`（5）
- [ ] `TestHistory`（5）

### 2.2 E2E 测试（目标 30+ 断言）

- [ ] 模块 1: 健康检查（3 断言）
- [ ] 模块 2: 完整诊断（5 断言）
- [ ] 模块 3: 单类诊断（5 断言）
- [ ] 模块 4: 修复建议（4 断言）
- [ ] 模块 5: 历史报告（5 断言）
- [ ] 模块 6: 反馈（3 断言）
- [ ] 模块 7: 错误路径（5 断言）

### 2.3 性能测试

- [ ] 完整诊断 < 10s
- [ ] 单类诊断 < 5s
- [ ] 历史查询 < 100ms
- [ ] 报告保存 < 200ms

### 2.4 安全测试

- [ ] API 密钥脱敏
- [ ] 路径白名单
- [ ] 无副作用（仅读取）
- [ ] 修复建议不自动执行
- [ ] 超时控制

### 2.5 通过率

- [ ] 单元测试 100% 通过
- [ ] E2E 测试 100% 通过
- [ ] TypeScript 编译 0 错误
- [ ] 前端构建成功

---

## 三、UI/UX 验收

### 3.1 DoctorPanel

- [ ] 6 类卡片式展示
- [ ] 顶部统计（ok/warning/error 总数）
- [ ] 过滤栏（按状态/类别）
- [ ] 一键运行诊断按钮
- [ ] 自动刷新（可选）
- [ ] 加载状态显示
- [ ] 错误提示

### 3.2 DoctorCategoryCard

- [ ] 分类图标 + 标题
- [ ] 状态徽章（ok/warning/error）
- [ ] 计数（X/Y 项通过）
- [ ] 耗时显示
- [ ] 展开/折叠交互

### 3.3 DoctorFixSuggestion

- [ ] 步骤列表（带行号）
- [ ] 复制按钮
- [ ] 风险等级徽章
- [ ] 自动执行开关（默认关闭）

### 3.4 DoctorHistoryView

- [ ] 时间线列表
- [ ] 报告 ID + 时间
- [ ] 状态徽章
- [ ] 详情预览
- [ ] 删除按钮（可选）

### 3.5 响应式

- [ ] 桌面（≥1280px）3 列布局
- [ ] 平板（768-1280px）2 列布局
- [ ] 移动（<768px）1 列布局

---

## 四、集成验收

- [ ] 后端服务重启无错误
- [ ] 前端 dev server 启动正常
- [ ] 路由 `/doctor` 可访问
- [ ] BrandHeader 菜单新增"🩺 Doctor"入口
- [ ] 与 Verification Loop 联动（可选）
- [ ] 与 Memory 联动（保存诊断历史到 memory）

---

## 五、文档验收

- [ ] `CYCLE11_P2_2_SUMMARY.md` 创建
- [ ] `代码修改日志.md` 更新（v6.15.0）
- [ ] API 文档（OpenAPI 自动生成）
- [ ] 修复建议清单（FIX_TEMPLATES 完整）
- [ ] CLI 使用示例

---

## 六、最终交付

- [ ] 所有单元测试 100% 通过
- [ ] 所有 E2E 测试 100% 通过
- [ ] TypeScript 编译 0 错误
- [ ] 前端构建成功
- [ ] Git 提交完成
- [ ] 总结报告完成
- [ ] 代码修改日志更新
- [ ] 项目目录清理（无临时文件）
- [ ] 与 Cycle 11 其他功能（P3-1, P2-1）兼容

---

**最终状态**: ⏳ 待验收
**目标**: 100% 通过所有验收项
