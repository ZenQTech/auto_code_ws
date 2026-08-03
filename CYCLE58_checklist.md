# CYCLE58 验收清单

> **日期**: 2026-08-03
> **验收原则**: 每项必须 100% 通过才能进入下一阶段

---

## A. 调研完整性 (Phase 1)

- [ ] **A-01**: 7 主题调研报告完整（a~g）
- [ ] **A-02**: CYCLE58_RESEARCH_REPORT.md 汇总报告
- [ ] **A-03**: 所有引用标注来源 URL + 时间 + 机构
- [ ] **A-04**: 调研覆盖 codex 0.146 + TRAE Solo 全部能力

## B. 差距分析 (Phase 2)

- [ ] **B-01**: CYCLE58_GAP_ANALYSIS.md 完整
- [ ] **B-02**: 5 大 P0 任务明确
- [ ] **B-03**: 风险与回退策略完整
- [ ] **B-04**: 验收标准量化

## C. Spec 文档 (Phase 2)

- [ ] **C-01**: CYCLE58_SPEC.md 5 大 P0 任务规范
- [ ] **C-02**: CYCLE58_task.md 任务分解（每个任务含 Hook 触发 + Git 提交）
- [ ] **C-03**: CYCLE58_checklist.md（本文件）
- [ ] **C-04**: 接口设计、数据结构、性能安全要求明确

## D. G58-01 验收

- [ ] **D-01**: useMode 扩展 vibe-coding 模式
- [ ] **D-02**: VibeCodingPage.tsx 创建
- [ ] **D-03**: ModeSelectorPage.tsx 3 模式卡片
- [ ] **D-04**: router.tsx 添加 /vibe-coding
- [ ] **D-05**: useVibeCoding Hook
- [ ] **D-06**: useModals 注册 4 新 panel
- [ ] **D-07**: 单元测试 ≥ 90%
- [ ] **D-08**: 集成测试通过
- [ ] **D-09**: Git 提交: `feat(cycle58 G58-01)`

## E. G58-02 验收（高风险）

- [ ] **E-01**: cli_integration/claude_code_shell.py 创建
- [ ] **E-02**: subprocess 流式调用实现
- [ ] **E-03**: is_available 探测实现
- [ ] **E-04**: 降级为 LLM HTTP 实现
- [ ] **E-05**: 路径净化实现
- [ ] **E-06**: 超时熔断实现
- [ ] **E-07**: backend/app/api/claude_shell.py 创建
- [ ] **E-08**: SSE 事件推送实现
- [ ] **E-09**: useClaudeCodeShell Hook
- [ ] **E-10**: 单元测试 ≥ 90%（subprocess / 降级 / 超时 / 路径净化 / 沙箱）
- [ ] **E-11**: 集成测试通过
- [ ] **E-12**: 真实 `claude` CLI 调用演示成功（若可用）
- [ ] **E-13**: 降级模式演示成功
- [ ] **E-14**: Git 提交: `feat(cycle58 G58-02)`

## F. G58-03 验收

- [ ] **F-01**: backend/app/services/loop_state_machine.py 创建
- [ ] **F-02**: 集成到 loop_engineering_v7.py
- [ ] **F-03**: backend/app/api/loop_state.py 创建
- [ ] **F-04**: SSE 推送 loop_state_changed
- [ ] **F-05**: LoopStatusBar.tsx 创建
- [ ] **F-06**: LoopStateMachineView.tsx 创建
- [ ] **F-07**: AppLayout.tsx 插入 LoopStatusBar
- [ ] **F-08**: useLoopState Hook
- [ ] **F-09**: 单元测试 ≥ 90%
- [ ] **F-10**: Git 提交: `feat(cycle58 G58-03)`

## G. G58-04 验收

- [ ] **G-01**: backend/app/api/auto_follow.py 创建
- [ ] **G-02**: STAGE_TO_PANEL 映射配置
- [ ] **G-03**: enable / disable 端点
- [ ] **G-04**: AutoFollowController.tsx 创建
- [ ] **G-05**: useAutoFollow Hook
- [ ] **G-06**: 集成到 VibeCodingPage
- [ ] **G-07**: 单元测试 ≥ 90%
- [ ] **G-08**: Git 提交: `feat(cycle58 G58-04)`

## H. G58-05 验收

- [ ] **H-01**: backend/app/services/vibe_coding_orchestrator.py 创建
- [ ] **H-02**: execute_plan 流式执行
- [ ] **H-03**: pause / resume / cancel
- [ ] **H-04**: 失败重试
- [ ] **H-05**: 超时熔断
- [ ] **H-06**: backend/app/api/vibe_coding.py 创建
- [ ] **H-07**: SSE 推送 vibe_step_*
- [ ] **H-08**: PlanExecutorPanel.tsx 创建
- [ ] **H-09**: usePlanExecutor Hook
- [ ] **H-10**: 与 ComposerPanel plan mode 集成
- [ ] **H-11**: 单元测试 ≥ 90%
- [ ] **H-12**: Git 提交: `feat(cycle58 G58-05)`

## I. G58-INTEGRATION 验收

- [ ] **I-01**: VibeCodingPage 集成 5 大组件
- [ ] **I-02**: TypeScript 编译 0 错误
- [ ] **I-03**: Vite 构建成功
- [ ] **I-04**: pytest 全部通过
- [ ] **I-05**: vitest 全部通过
- [ ] **I-06**: 单元测试覆盖率 ≥ 90%
- [ ] **I-07**: TRAE-browseruse 端到端测试 100% 通过
- [ ] **I-08**: 实际运行项目（npm run dev + 端口探测）
- [ ] **I-09**: 示范项目仓库创建在 /home/qizheng/auto_code_data/hermes-vibe-coding-demo/
- [ ] **I-10**: UI/UX 对标 codex/trae 视觉风格
- [ ] **I-11**: CYCLE58_ACCEPTANCE_REPORT.md
- [ ] **I-12**: CYCLE58_CODE_MODIFICATION_LOG.md
- [ ] **I-13**: 推 main 分支
- [ ] **I-14**: Git 提交: `feat(cycle58 G58-INTEGRATION)`

## J. 循环接续

- [ ] **J-01**: CYCLE59_STARTUP.md
- [ ] **J-02**: 下一轮 P1 任务清单

## K. 总体目标验收

- [ ] **K-01**: 5 大 P0 任务全部实现
- [ ] **K-02**: 7 大调研主题报告完整
- [ ] **K-03**: Loop V7 工作流加固并能持续运行
- [ ] **K-04**: codex + trae solo 模式功能 100% 对齐目标
- [ ] **K-05**: 项目实运行效果与用户需求完全一致
- [ ] **K-06**: 无关键 bug
- [ ] **K-07**: 自动化测试覆盖率 ≥ 90%
- [ ] **K-08**: 端到端测试 100% 通过
- [ ] **K-09**: 完整 loop engineering 工作流保留并验证
- [ ] **K-10**: 累计 6 个原子 Git 提交
- [ ] **K-11**: 累计 ~5500 行新代码
- [ ] **K-12**: 累计 ~150 个新测试用例
