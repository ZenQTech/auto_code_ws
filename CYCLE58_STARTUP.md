# CYCLE 58 启动文档

**日期**: 2026-08-03
**前序周期**: Cycle 57 - 实时数据流处理 ✅

---

## 📊 Cycle 57 状态总结

| 指标 | 数值 |
|------|------|
| 调研方向 | D. 实时数据流处理 |
| 集成策略 | B. 真实集成 |
| P0 任务数 | 5 (G57-01 ~ G57-04 + G57-INTEGRATION) |
| 新增代码行 | ~4500 行 (4 引擎 + 1 主面板 + 4 测试) |
| 新增测试用例 | 123 个 |
| 测试通过率 | 100% (123/123) |
| TypeScript 错误 | 0 |
| Vite 构建 | 25.29s 成功 |
| Git 提交 | 6 个原子提交 |
| 状态 | ✅ 100% 完成 |

---

## 🎯 Cycle 58 候选方向

### 方向 A: 真实数据源接入 (推荐 ⭐⭐⭐⭐⭐)
**核心价值**: 验证流处理引擎与真实数据源的端到端能力
- Apache Kafka Connect (Source/Sink)
- Confluent Schema Registry (Avro/Protobuf/JSON Schema)
- Debezium CDC (MySQL/PostgreSQL/MongoDB)
- MQTT/Kinesis/Pub-Sub 适配器
- 端到端 E2E 验证 + 真实数据集测试

**任务清单** (推荐 5 P0):
- G58-01: Kafka Connect Source/Sink 生成器
- G58-02: Confluent Schema Registry 集成
- G58-03: Debezium CDC 适配器
- G58-04: 真实数据 E2E 验证套件
- G58-INTEGRATION: McpDataSourcePanel 5-Tab UI

**预计产出**: ~5000 行代码, 120+ 测试

### 方向 B: 流处理 SQL 引擎
**核心价值**: 降低流处理开发门槛
- Apache Flink SQL / Kafka KSQL
- 流表对偶 (Stream-Table Duality)
- 物化视图 (Materialized View)
- 持续查询 (Continuous Query)
- 自定义 UDF/UDTF/UDAF

### 方向 C: 流处理可观测性深度集成
**核心价值**: 实时洞察流处理健康
- 流拓扑可视化 (DAG + Metrics 热力图)
- 滞后监控 (Lag / Backpressure / Skew)
- 数据血缘 (Data Lineage)
- 异常检测 (Anomaly Detection in Streams)
- OpenTelemetry 流处理 span 传播

### 方向 D: 状态管理与持久化
**核心价值**: 跨重启/扩缩容的状态一致性
- RocksDB 状态后端深度优化
- 增量检查点 (Incremental Checkpointing)
- 状态分片 (State Sharding) 与再平衡
- 状态查询 API (Queryable State)
- Savepoint 生命周期管理

### 方向 E: 流处理测试与基准
**核心价值**: 性能可预测性 + 回归保证
- 性能基准套件 (NEXMark / TPC-H Streaming)
- 混沌工程在流处理场景 (网络分区/算子崩溃)
- A/B 测试框架 (新旧版本对比)
- 性能回归检测
- SLA 验证套件

---

## 🏗️ Cycle 57 交付物回顾

### 4 大核心引擎
1. **Kafka Streams**: 拓扑 + DSL 算子 + 状态存储
2. **Apache Flink**: JobGraph + 检查点 + 水位线
3. **窗口聚合**: Tumbling/Sliding/Session + 迟到事件
4. **Exactly-Once**: 事务性生产者 + 幂等消费者

### 主应用集成
- **McpStreamProcessingPanel** 5-Tab UI
- **useModals**: 41 panel + 2 util = 43 keys
- **App.tsx**: v6.150.0 集成
- **BrandHeader**: 🌊 MCP × Stream Processing 菜单

---

## ❓ 待确认事项

请回答以下问题以确定 Cycle 58 方向:

1. **调研方向**:
   - A. 真实数据源接入 (推荐)
   - B. 流处理 SQL 引擎
   - C. 流处理可观测性深度集成
   - D. 状态管理与持久化
   - E. 流处理测试与基准

2. **任务节奏** (P0 任务数):
   - A. 3 大 P0 (核心即可)
   - B. 4 大 P0 (推荐)
   - C. 5 大 P0 (完整覆盖)

3. **集成策略**:
   - A. Mock 集成 (快速验证)
   - B. 真实集成 (生产级)
   - C. 混合 (核心真实 + 周边 Mock)

---

## 💡 候选方向优势对比

| 方向 | 价值 | 复杂度 | 推荐指数 |
|------|------|--------|----------|
| A. 真实数据源 | ⭐⭐⭐⭐⭐ | 中 | ⭐⭐⭐⭐⭐ |
| B. 流处理 SQL | ⭐⭐⭐⭐ | 高 | ⭐⭐⭐ |
| C. 可观测性深度 | ⭐⭐⭐⭐ | 中 | ⭐⭐⭐⭐ |
| D. 状态管理 | ⭐⭐⭐ | 高 | ⭐⭐⭐ |
| E. 测试基准 | ⭐⭐⭐ | 中 | ⭐⭐⭐ |

---

## 📝 Cycle 58 启动清单

无论选择哪个方向，Cycle 58 启动前应完成:

1. **代码清理**: 移除 Cycle 57 调试/临时文件
2. **依赖检查**: 确认新方向所需包已安装
3. **架构设计**: 编写架构文档 + 接口设计
4. **任务分解**: 按 P0/P1/P2 拆分 4-6 个 P0 任务
5. **测试策略**: 单元 + 集成 + E2E 三维度

---

**等待用户确认**: 调研方向 / 任务节奏 / 集成策略 三个选项。
