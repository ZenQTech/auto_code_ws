# 架构合规检查清单

## 1. 模块职责检查

- [ ] 模块职责单一，无循环依赖
  - agv_core 不依赖 agv_control（当前已满足 ✓）
  - backend 不依赖 agv_fleet_ws 的 C++ 编译产物（仅通过 ROS2 DDS 通信）
  - cli_integration 不依赖 frontend
- [ ] 每个 C++ 头文件有独立的 include guard（当前已满足 ✓）
- [ ] 每个模块有独立的命名空间（agv_core、agv_control 已隔离 ✓）

## 2. 栈溢出防护检查（核心需求）

- [ ] **CmdMux::submit()**: 对 `static_cast<size_t>(source)` 的结果进行边界检查
  - 当前状态：❌ 未检查，若 source 为 NONE(99) 会越界访问 slots_[99]
  - 修复方案：添加 `if (source >= CmdSource::_COUNT) return;` 哨兵检查
  - 严重程度：**CRITICAL**
- [ ] **CmdMux::set_timeout()**: 同上边界检查
  - 当前状态：❌ 未检查
  - 修复方案：与 submit() 统一
  - 严重程度：**CRITICAL**
- [ ] **CmdMux::get_effective()**: 硬编码循环 `for (size_t i = 0; i < 4; ++i)` 不够安全
  - 当前状态：⚠️ 使用魔术数字 4，应改为 `CmdSource::_COUNT` 或 `sizeof(slots_)/sizeof(slots_[0])`
  - 修复方案：替换魔术数字为命名常量
  - 严重程度：**MAJOR**
- [ ] **LifecycleManager::register_callback()**: 边界检查存在但不完整
  - 当前状态：✅ 有 `if (idx >= 6)` 检查，但使用魔术数字 6
  - 修复方案：将 6 替换为 `static_cast<size_t>(Transition::_COUNT)`
  - 严重程度：**MINOR**
- [ ] **LifecycleManager::trigger_transition()**: 使用 `auto idx = static_cast<size_t>(transition)` 但未做边界检查
  - 当前状态：❌ `is_valid_transition()` 仅检查状态转换合法性，不检查 transition 值本身
  - 修复方案：在 switch 前添加 `if (idx >= static_cast<size_t>(Transition::_COUNT)) return false;`
  - 严重程度：**CRITICAL**
- [ ] **agv_core/utils.h - index_from_agv_id()**: `std::stoi` 未捕获异常
  - 当前状态：❌ 若 `agv_id.substr(4)` 不是纯数字，会抛出 `std::invalid_argument` 导致未处理异常
  - 修复方案：包裹 try-catch 块，返回 -1
  - 严重程度：**MAJOR**
- [ ] **agv_core/utils.h - agv_id_from_index()**: 缓冲区大小验证
  - 当前状态：✅ 使用 `snprintf(buf, sizeof(buf), ...)` 安全
  - 验证通过：无需修复
- [ ] **编译选项**: 确保 `-fstack-protector-strong` 已启用
  - 当前状态：❓ 待验证 CMakeLists.txt
  - 修复方案：在 CMakeLists.txt 中强制添加编译选项
  - 严重程度：**CRITICAL**

## 3. 接口契约完整性检查

- [ ] 所有 ROS2 Topic 的 QoS 配置已明确声明
  - 当前状态：✅ constants.h 已定义 QOS_SENSOR_DEPTH 等
  - 待验证：实际节点创建时是否使用了这些常量
- [ ] CmdMux 接口文档完整
  - 当前状态：✅ 头文件有详细注释说明优先级
  - 待补充：错误处理行为说明
- [ ] 所有 ROS2 消息类型已明确
  - 当前状态：✅ geometry_msgs/Twist, nav_msgs/Odometry, sensor_msgs/JointState

## 4. 安全红线覆盖检查

- [ ] **安全停止机制**: 任何异常必须触发 cmd_vel 归零
  - 当前状态：✅ CmdMux::force_stop() 已实现
  - 待验证：Safety Watchdog 节点是否独立运行
- [ ] **急停响应时间**: ≤ 10ms
  - 当前状态：⚠️ constants.h 定义了 ESTOP_RESPONSE_MAX_MS=10
  - 待验证：实际端到端延迟测量
- [ ] **通信超时保护**: 命令超时后自动归零
  - 当前状态：✅ CmdMux::is_expired() 已实现超时检查
  - 待验证：超时后 get_effective() 返回零值的行为
- [ ] **线程安全**: 所有共享数据有 mutex 保护
  - 当前状态：✅ CmdMux 使用 mutable std::mutex
  - ✅ LifecycleManager 使用 mutable std::mutex
  - ✅ force_stop_ 使用 std::atomic<bool>
- [ ] **编译安全**: 所有编译器警告已清零
  - 当前状态：❓ 待 CI 流水线验证

## 5. 性能指标可量化检查

- [ ] 控制循环频率 100Hz → 可通过 ROS2 topic hz 测量
- [ ] 急停响应 10ms → 可通过注入故障 + 时间戳差值测量
- [ ] 命令超时 200ms/500ms → 可通过 CmdMux 内部时间戳测量
- [ ] API 响应 P99 ≤ 200ms → 可通过 FastAPI 中间件统计

## 6. 技术选型版本检查

- [ ] ROS2 Humble LTS → 2027年5月 EOL，当前版本有效
- [ ] C++17 → 编译器 GCC ≥ 11 支持
- [ ] FastAPI ≥ 0.110 → 与 Pydantic v2 兼容
- [ ] React 19 → 当前最新稳定版

## 7. 部署方案可执行性检查

- [ ] 仿真模式可直接启动（仅需 Gazebo + ROS2）
- [ ] 开发模式可独立运行（仅需 Python + Node.js）
- [ ] 实机模式需要硬件驱动（待硬件就绪后验证）
- [ ] 所有依赖在 requirements.txt / package.xml 中声明

## 8. 代码质量检查

- [ ] 无魔术数字（硬编码的 4、6 等）
- [ ] 所有 `static_cast<size_t>(enum_value)` 有前置边界检查
- [ ] 所有字符串解析函数有异常处理
- [ ] 所有 C++ 编译单元通过 clang-tidy 检查
- [ ] 所有 C++ 编译单元通过 AddressSanitizer 测试
- [ ] 所有 C++ 编译单元通过 UndefinedBehaviorSanitizer 测试

## 检查汇总

| 检查类别 | 总项数 | 通过 | 未通过 | 待验证 |
|---------|--------|------|--------|--------|
| 模块职责 | 3 | 3 | 0 | 0 |
| 栈溢出防护 | 9 | 2 | 4 | 3 |
| 接口契约 | 3 | 2 | 0 | 1 |
| 安全红线 | 5 | 3 | 0 | 2 |
| 性能指标 | 4 | 0 | 0 | 4 |
| 技术选型 | 4 | 4 | 0 | 0 |
| 部署方案 | 4 | 3 | 0 | 1 |
| 代码质量 | 6 | 0 | 6 | 0 |
| **总计** | **38** | **17** | **10** | **11** |