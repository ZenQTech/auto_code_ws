# 任务分解文档

## 概述

本文档将"栈溢出防护与 C++ 安全加固"需求分解为可执行的开发任务。任务按依赖关系排序，优先级基于安全影响程度。

---

## 模块1: agv_control - CmdMux 边界检查加固

### 任务 1.1: 添加 CmdSource 哨兵值并修复边界检查

- **描述**: 在 `CmdSource` 枚举中添加 `_COUNT` 哨兵值，并修改 `CmdMux` 中所有使用 `static_cast<size_t>(source)` 的位置，添加前置边界检查。同时将硬编码的魔术数字 `4` 替换为 `static_cast<size_t>(CmdSource::_COUNT)`。
- **优先级**: high
- **依赖**: 无
- **预估复杂度**: 0.2
- **风险等级**: 低
- **涉及文件**:
  - `agv_fleet_ws/src/agv_control/include/agv_control/cmd_mux.h` (枚举定义)
  - `agv_fleet_ws/src/agv_control/src/cmd_mux.cpp` (边界检查)
- **验收标准**:
  - `submit()` 方法在 `source >= CmdSource::_COUNT` 时静默返回，不访问数组
  - `set_timeout()` 方法同上
  - `get_effective()` 中 `for (size_t i = 0; i < 4; ++i)` 改为使用 `_COUNT`
  - 编译无警告
  - AddressSanitizer 测试通过

### 任务 1.2: 添加 CmdMux 单元测试

- **描述**: 为 CmdMux 编写边界条件单元测试，覆盖：无效 source 值、空 slots、超时行为、force_stop 优先级、并发访问。
- **优先级**: high
- **依赖**: 任务 1.1
- **预估复杂度**: 0.3
- **风险等级**: 低
- **涉及文件**:
  - `agv_fleet_ws/src/agv_control/test/test_cmd_mux.cpp` (新建)
- **验收标准**:
  - 测试用例数量 ≥ 10
  - 覆盖所有 CmdSource 枚举值
  - 覆盖边界值（source=255, source=99 等无效值）
  - 覆盖并发场景（多线程 submit + get_effective）
  - 所有测试通过

---

## 模块2: agv_core - LifecycleManager 边界检查加固

### 任务 2.1: 添加 Transition 哨兵值并修复边界检查

- **描述**: 在 `Transition` 枚举中添加 `_COUNT` 哨兵值，修复 `trigger_transition()` 中缺失的边界检查，将硬编码的魔术数字 `6` 替换为 `static_cast<size_t>(Transition::_COUNT)`。
- **优先级**: high
- **依赖**: 无
- **预估复杂度**: 0.15
- **风险等级**: 低
- **涉及文件**:
  - `agv_fleet_ws/src/agv_core/include/agv_core/lifecycle/lifecycle_manager.h` (枚举定义)
  - `agv_fleet_ws/src/agv_core/src/lifecycle/lifecycle_manager.cpp` (边界检查)
- **验收标准**:
  - `trigger_transition()` 在 `idx >= static_cast<size_t>(Transition::_COUNT)` 时返回 false
  - `register_callback()` 中硬编码的 `6` 替换为 `_COUNT`
  - 编译无警告
  - AddressSanitizer 测试通过

### 任务 2.2: 添加 LifecycleManager 单元测试

- **描述**: 为 LifecycleManager 编写边界条件测试，覆盖：无效 transition 值、非法状态转换、回调失败处理、并发访问。
- **优先级**: high
- **依赖**: 任务 2.1
- **预估复杂度**: 0.25
- **风险等级**: 低
- **涉及文件**:
  - `agv_fleet_ws/src/agv_core/test/test_lifecycle_manager.cpp` (新建)
- **验收标准**:
  - 测试用例数量 ≥ 8
  - 覆盖所有 Transition 枚举值
  - 覆盖无效 transition (如 255)
  - 覆盖回调返回 false 的场景
  - 所有测试通过

---

## 模块3: agv_core - 字符串处理异常安全

### 任务 3.1: 修复 index_from_agv_id() 异常安全

- **描述**: 为 `agv_core/utils.h` 中的 `index_from_agv_id()` 函数添加 try-catch 块，捕获 `std::invalid_argument` 和 `std::out_of_range` 异常，确保任何非法输入都返回 -1 而非抛出未处理异常。
- **优先级**: medium
- **依赖**: 无
- **预估复杂度**: 0.1
- **风险等级**: 低
- **涉及文件**:
  - `agv_fleet_ws/src/agv_core/include/agv_core/utils.h`
- **验收标准**:
  - 输入 "agv_abc" → 返回 -1（不抛异常）
  - 输入 "agv_99999999999999999999" → 返回 -1（不抛异常）
  - 输入 "agv_01" → 返回 1（正常行为保持）
  - 输入 "invalid" → 返回 -1（不抛异常）
  - 输入 "" → 返回 -1（不抛异常）

### 任务 3.2: 添加字符串工具单元测试

- **描述**: 为 utils.h 中的字符串处理函数编写单元测试。
- **优先级**: medium
- **依赖**: 任务 3.1
- **预估复杂度**: 0.2
- **风险等级**: 低
- **涉及文件**:
  - `agv_fleet_ws/src/agv_core/test/test_utils.cpp` (新建)
- **验收标准**:
  - 覆盖 `agv_id_from_index()` 边界值（0, 99, -1, 100）
  - 覆盖 `index_from_agv_id()` 正常/异常输入
  - 覆盖 `build_agv_topic()` 等路径构建函数
  - 所有测试通过

---

## 模块4: 构建系统安全加固

### 任务 4.1: 强制安全编译选项

- **描述**: 在 agv_fleet_ws 的 CMakeLists.txt 中添加强制安全编译选项：`-fstack-protector-strong`、`-fstack-clash-protection`、`-D_FORTIFY_SOURCE=2`、`-Wformat=2`、`-Wconversion`、`-Wall -Wextra -Werror`。Debug 构建额外启用 ASan 和 UBSan。
- **优先级**: high
- **依赖**: 任务 1.1, 2.1, 3.1（编译选项可能导致新警告，需先修复代码）
- **预估复杂度**: 0.15
- **风险等级**: 中（可能触发大量新警告需要修复）
- **涉及文件**:
  - `agv_fleet_ws/CMakeLists.txt`
  - `agv_fleet_ws/src/agv_core/CMakeLists.txt`
  - `agv_fleet_ws/src/agv_control/CMakeLists.txt`
- **验收标准**:
  - `-fstack-protector-strong` 在所有构建类型中启用
  - `-Werror` 生效，编译 0 警告
  - Debug 构建自动启用 ASan + UBSan
  - CI 流水线中编译通过

### 任务 4.2: 配置 CI 安全扫描流水线

- **描述**: 配置 CI 流水线，在每次提交时自动运行：clang-tidy 静态分析、AddressSanitizer 动态测试、UndefinedBehaviorSanitizer 测试。
- **优先级**: medium
- **依赖**: 任务 4.1
- **预估复杂度**: 0.3
- **风险等级**: 低
- **涉及文件**:
  - `.github/workflows/security_scan.yml` (新建) 或 CI 配置文件
- **验收标准**:
  - PR 提交时自动触发安全扫描
  - 扫描失败时阻止合并
  - 扫描结果可在 PR 页面查看

---

## 模块5: 文档与知识沉淀

### 任务 5.1: 编写安全编码规范文档

- **描述**: 编写 C++ 安全编码规范，记录本次修复中识别的所有安全模式（边界检查模式、异常安全模式、编译选项配置），作为后续开发的强制约束。
- **优先级**: low
- **依赖**: 任务 1.1, 2.1, 3.1, 4.1
- **预估复杂度**: 0.2
- **风险等级**: 低
- **涉及文件**:
  - `docs/security_coding_standards.md` (新建)
- **验收标准**:
  - 包含边界检查模式说明与代码示例
  - 包含异常安全模式说明与代码示例
  - 包含禁止使用的函数列表
  - 包含编译选项清单

---

## 任务依赖关系图

```
任务 1.1 (CmdMux 边界检查) ──► 任务 1.2 (CmdMux 测试)
                                    │
任务 2.1 (Lifecycle 边界检查) ──► 任务 2.2 (Lifecycle 测试)
                                    │
任务 3.1 (字符串异常安全) ──► 任务 3.2 (字符串测试)
                                    │
                                    ▼
                              任务 4.1 (安全编译选项)
                                    │
                                    ▼
                              任务 4.2 (CI 安全扫描)
                                    │
                                    ▼
                              任务 5.1 (安全编码规范)
```

## 汇总

| 模块 | 任务数 | 总复杂度 | 最高优先级 |
|------|--------|---------|-----------|
| CmdMux 边界检查 | 2 | 0.5 | high |
| Lifecycle 边界检查 | 2 | 0.4 | high |
| 字符串异常安全 | 2 | 0.3 | medium |
| 构建系统安全 | 2 | 0.45 | high |
| 文档知识沉淀 | 1 | 0.2 | low |
| **总计** | **9** | **1.85** | - |