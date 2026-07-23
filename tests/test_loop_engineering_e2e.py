"""
# ============================================================
# Loop Engineering 工作流端到端自动化测试脚本
# ============================================================
# 核心作用：通过 API 驱动完整 Loop Engineering 工作流，
#           从提示词注入到需求澄清、架构设计、任务分发、
#           代码评审的全链路自动化测试
# 运行流程：
#   1. 启动服务器（需手动启动）
#   2. 创建 coding 模式会话
#   3. 注入提示词，触发工作流
#   4. 自动处理需求澄清（选择第一个选项）
#   5. 跳过不确定项，进入架构设计
#   6. 确认架构设计
#   7. 监控全链路直到完成
# 输入参数：无（通过 API 交互）
# 输出结果：测试报告
# 修改记录：
#   - 2026-07-22 | v1.0.0 | 初始创建
# ============================================================
"""

import requests
import json
import time
import sys
import re

BASE_URL = "http://localhost:8080"
SESSION_ID = "e2689ad0-9013-4951-b53f-a3bfa9ae9793"
WORKFLOW_ID = None

PROMPT = """# 智能仓储多机器人调度与控制系统

## 项目概述
开发一个基于 ROS2 Humble 的智能仓储多机器人调度与控制系统，实现 3 台 AGV 机器人在 500 平方米仓库内的协同搬运、路径规划、避障与任务调度。

## 功能需求
1. **多机器人任务调度模块**：支持最多 5 台 AGV 的并发任务分配、优先级调度、死锁检测与恢复
2. **全局路径规划模块**：基于 A* 算法的全局路径规划，支持动态障碍物重规划，路径平滑优化
3. **局部避障与运动控制模块**：基于 DWA（动态窗口法）的实时局部避障，PID 速度/位置双闭环控制
4. **多传感器融合定位模块**：融合 LiDAR + IMU + 轮式里程计数据，使用扩展卡尔曼滤波实现厘米级定位
5. **安全保护与急停模块**：碰撞检测、紧急制动、安全区域限位、故障降级策略
6. **仓库状态可视化与监控模块**：Web 端实时展示机器人位置、任务状态、货架状态、告警信息
7. **全局任务调度 API 模块**：提供 REST API 供上层 WMS 系统调用，包括任务下发、状态查询、紧急干预接口

## 非功能需求
- **实时性要求**：运动控制回路频率 ≥ 100Hz，避障决策延迟 < 50ms，急停响应延迟 < 10ms
- **安全要求**：符合 ISO 3691-4 无人驾驶工业车辆安全标准，急停回路为 SIL2 安全等级
- **定位精度**：静态定位误差 < 2cm，动态定位误差 < 5cm
- **可靠性**：系统可用性 ≥ 99.9%，单点故障自动切换，支持热备
- **ROS2 规范**：严格遵循 ROS2 官方最佳实践，使用 ament_cmake 构建，QoS 按场景配置

## 技术约束
- 开发语言：C++17（运动控制、路径规划、传感器融合）、Python 3.10（任务调度、API 服务、可视化）
- ROS 版本：ROS2 Humble
- 构建工具：ament_cmake + colcon
- 仿真环境：Gazebo Ignition + 仓库场景模型
- 消息通信：全局接口使用自定义 ROS2 .msg/.srv 定义，各模块间通过 topic/service/action 通信
- 参数管理：所有可调参数通过 ROS2 参数服务器统一管理，禁止硬编码

## 安全红线要求
- 急停模块必须独立于主控逻辑，支持硬件急停按钮和软件急停指令双路触发
- 碰撞检测必须包含物理碰撞检测 + 虚拟安全区域双重保护
- 运动控制输出必须包含速度/加速度/力矩三层限幅约束
- 安全相关代码禁止动态内存分配，禁止阻塞调用，禁止文件 IO

## 验收标准
1. 仿真环境中 3 台 AGV 同时运行 30 分钟无碰撞、无死锁
2. 急停触发后所有机器人 10ms 内停止运动
3. 定位误差在全路径上 < 5cm
4. 任务调度系统支持 100 个并发任务无延迟堆积
5. 全局接口变更后所有依赖模块自动适配完成
6. 全量代码通过 Cppcheck/Clang-Tidy/Pylint 静态检查
7. 系统评测报告综合评分 ≥ A 级（90 分）

## 补充要求
- 请严格按照全流程 SOP 执行
- 每个阶段完成后请等待人工确认再进入下一阶段
- 高风险模块（急停、碰撞检测、运动控制）必须标记为极高风险等级
- 所有模块代码完成后请生成原子任务清单进行 100% 闭环核验"""


def create_session():
    """创建 coding 模式会话"""
    global SESSION_ID
    resp = requests.post(f"{BASE_URL}/api/sessions", json={
        "mode": "coding",
        "title": "智能仓储多机器人调度与控制系统"
    })
    data = resp.json()
    SESSION_ID = "e2689ad0-9013-4951-b53f-a3bfa9ae9793"
    print(f"✓ 会话已创建: {SESSION_ID[:8]}...")
    return SESSION_ID


def send_chat_message(message):
    """发送聊天消息（SSE 流式），收集所有事件"""
    events = []
    url = f"{BASE_URL}/api/hermes/chat/stream"
    body = {
        "message": message,
        "session_id": SESSION_ID,
        "session_mode": "coding"
    }
    
    print(f"→ 发送消息 ({len(message)} 字符)...")
    resp = requests.post(url, json=body, stream=True, timeout=600)
    
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        try:
            event = json.loads(line[6:])
            events.append(event)
            event_type = event.get("type", "?")
            if event_type == "text":
                content = event.get("content", "")[:80]
                print(f"  [text] {content}...")
            elif event_type == "thinking":
                print(f"  [thinking] {event.get('content', '')[:60]}...")
            elif event_type == "clarify_questions":
                qs = event.get("questions", [])
                complete = event.get("complete", False)
                print(f"  [clarify] {len(qs)} 个问题, 完成={complete}, 轮次={event.get('round', '?')}")
            elif event_type == "clarify_complete":
                print(f"  [clarify_complete] {event.get('content', '')}")
            elif event_type == "workflow_started":
                global WORKFLOW_ID
                WORKFLOW_ID = event.get("workflow_id")
                print(f"  [workflow_started] ID={WORKFLOW_ID[:8] if WORKFLOW_ID else '?'}...")
            elif event_type == "stage_dispatch":
                print(f"  [stage_dispatch] {json.dumps(event, ensure_ascii=False)[:200]}")
            elif event_type == "done":
                print(f"  [done]")
            elif event_type == "error":
                print(f"  [ERROR] {event.get('content', '')[:200]}")
            else:
                print(f"  [{event_type}]")
        except json.JSONDecodeError:
            pass
    
    return events


def extract_clarify_options(events):
    """从 SSE 事件中提取澄清问题和选项"""
    for ev in events:
        if ev.get("type") == "clarify_questions":
            return ev
    return None


def handle_clarification(events):
    """处理需求澄清：对每个问题选择第一个选项"""
    clarify_ev = extract_clarify_options(events)
    if not clarify_ev:
        return None
    
    questions = clarify_ev.get("questions", [])
    complete = clarify_ev.get("complete", False)
    
    if complete:
        print("→ 需求澄清已完成，准备跳过不确定项进入架构设计")
        return {"action": "skip", "complete": True}
    
    # 构建回答：每个问题选择第一个选项
    answer_parts = []
    for q in questions:
        dim = q.get("dimension", "")
        question = q.get("question", "")
        options = q.get("options", [])
        if options:
            answer_parts.append(f"【{dim}】{question} → 选择：{options[0]}")
        else:
            answer_parts.append(f"【{dim}】{question} → 已确认")
    
    # 如果没有可选选项，说明是确认性问题
    if not any(q.get("options") for q in questions):
        # 所有问题都选第一个选项（兜底选项）
        for q in questions:
            opts = q.get("options", [])
            if not opts:
                # 生成默认回答
                answer_parts.append(f"【{q.get('dimension', '')}】确认")
    
    answer = "\n".join(answer_parts)
    print(f"→ 自动回答澄清问题:\n{answer}")
    return {"action": "answer", "message": answer}


def confirm_clarification():
    """确认需求澄清阶段，推进到架构设计"""
    if not WORKFLOW_ID:
        print("✗ 无工作流 ID，无法确认")
        return None

    # 真实 API 契约：backend/app/api/workflow.py:571 → ClarifyConfirmRequest
    # 字段名: confirmed (bool)，不是 skip_uncertain
    resp = requests.post(
        f"{BASE_URL}/api/workflow/{WORKFLOW_ID}/clarify/confirm",
        json={"confirmed": True}
    )
    data = resp.json()
    print(f"→ 需求澄清确认结果: {json.dumps(data, ensure_ascii=False)[:300]}")
    return data


def get_workflow_status():
    """获取工作流状态"""
    if not WORKFLOW_ID:
        return None
    resp = requests.get(f"{BASE_URL}/api/workflow/{WORKFLOW_ID}/status")
    return resp.json()


def start_design_phase():
    """
    触发架构设计阶段开始
    真实端点: POST /api/architecture/start-design-phase
    请求体: {workflow_id: str}
    """
    if not WORKFLOW_ID:
        print("✗ 无工作流 ID，无法启动设计阶段")
        return None
    resp = requests.post(
        f"{BASE_URL}/api/architecture/start-design-phase",
        json={"workflow_id": WORKFLOW_ID}
    )
    data = resp.json()
    print(f"→ 启动架构设计: {json.dumps(data, ensure_ascii=False)[:300]}")
    return data


def confirm_designing():
    """
    确认架构设计阶段完成
    真实端点: POST /api/architecture/confirm-design
    请求体: {workflow_id: str, confirmed: bool}
    """
    if not WORKFLOW_ID:
        return None
    resp = requests.post(
        f"{BASE_URL}/api/architecture/confirm-design",
        json={"workflow_id": WORKFLOW_ID, "confirmed": True}
    )
    data = resp.json()
    print(f"→ 架构设计确认结果: {json.dumps(data, ensure_ascii=False)[:300]}")
    return data


def trigger_pipeline_test():
    """触发全链路测试"""
    if not WORKFLOW_ID:
        return None
    resp = requests.post(
        f"{BASE_URL}/api/workflow/{WORKFLOW_ID}/pipeline-test",
        stream=True, timeout=600
    )
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            try:
                ev = json.loads(line[6:])
                print(f"  [pipeline] {json.dumps(ev, ensure_ascii=False)[:200]}")
            except:
                pass


def main():
    global SESSION_ID, WORKFLOW_ID
    
    print("=" * 60)
    print("Loop Engineering 工作流端到端测试")
    print("=" * 60)
    
    # 步骤 1: 创建会话
    SESSION_ID = "e2689ad0-9013-4951-b53f-a3bfa9ae9793"
    
    # 步骤 2: 注入提示词，触发工作流
    print("\n--- 步骤 2: 注入提示词 ---")
    events = send_chat_message(PROMPT)
    
    # 提取 workflow_id
    for ev in events:
        if ev.get("type") == "workflow_started":
            WORKFLOW_ID = ev.get("workflow_id")
            break
    
    if not WORKFLOW_ID:
        print("✗ 工作流未启动，检查事件:")
        for ev in events:
            if ev.get("type") == "error":
                print(f"  错误: {ev.get('content', '')[:500]}")
        return
    
    print(f"\n✓ 工作流已启动: {WORKFLOW_ID[:8]}...")
    
    # 步骤 3: 需求澄清循环（最多 5 轮）
    print("\n--- 步骤 3: 需求澄清循环 ---")
    clarification_rounds = 0
    max_clarify_rounds = 5
    
    while clarification_rounds < max_clarify_rounds:
        clarification_rounds += 1
        print(f"\n→ 需求澄清第 {clarification_rounds} 轮")
        
        result = handle_clarification(events)
        if not result:
            print("  ⚠ 无澄清问题，等待...")
            time.sleep(2)
            continue
        
        if result.get("complete"):
            # 澄清完成，跳过不确定项
            print(f"\n--- 步骤 4: 跳过不确定项，进入架构设计 ---")
            confirm_result = confirm_clarification()
            if confirm_result and confirm_result.get("success"):
                print("✓ 已进入架构设计阶段")
                break
            else:
                print(f"✗ 确认失败: {confirm_result}")
                return
        else:
            # 发送回答
            msg = result.get("message", "")
            if msg:
                events = send_chat_message(msg)
            time.sleep(1)
    
    # 步骤 5: 等待架构设计阶段完成
    print("\n--- 步骤 5: 监控架构设计阶段 ---")
    max_designing_wait = 120  # 最多等 2 分钟
    for i in range(max_designing_wait // 5):
        time.sleep(5)
        status = get_workflow_status()
        if status:
            stage = status.get("current_stage", "?")
            wf_status = status.get("status", "?")
            print(f"  [{i*5}s] 阶段={stage}, 状态={wf_status}")
            if stage == "designing" and wf_status == "DESIGNING":
                # 检查是否弹出架构设计结果
                pass
            elif stage == "prompting":
                print("✓ 架构设计阶段已完成，进入提示词工程阶段")
                break
    
    # 步骤 6: 确认架构设计
    print("\n--- 步骤 6: 确认架构设计 ---")
    confirm_designing()
    
    # 步骤 7: 监控后续阶段
    print("\n--- 步骤 7: 监控后续阶段 ---")
    max_wait = 300  # 最多等 5 分钟
    for i in range(max_wait // 10):
        time.sleep(10)
        status = get_workflow_status()
        if status:
            stage = status.get("current_stage", "?")
            wf_status = status.get("status", "?")
            progress = status.get("progress", 0)
            iteration = status.get("iteration_count", 0)
            print(f"  [{i*10}s] 阶段={stage}, 状态={wf_status}, 进度={progress:.0f}%, 迭代={iteration}")
            
            if wf_status == "COMPLETED":
                print("\n✓ 工作流已完成!")
                break
            elif wf_status == "FAILED":
                print(f"\n✗ 工作流失败: {status.get('error_message', '')[:200]}")
                break
            elif wf_status == "ITERATING":
                print(f"  → 进入迭代闭环 (第 {iteration} 轮)")
    
    # 步骤 8: 最终状态
    print("\n--- 最终状态 ---")
    final_status = get_workflow_status()
    if final_status:
        print(json.dumps(final_status, ensure_ascii=False, indent=2)[:2000])
    
    # 步骤 9: 检查 Git 仓库
    print("\n--- 步骤 9: Git 仓库检查 ---")
    import subprocess
    result = subprocess.run(
        ["git", "log", "--oneline", "-5"],
        cwd="/home/qizheng/auto_code_ws",
        capture_output=True, text=True
    )
    print(f"Git 最近提交:\n{result.stdout}")
    
    print("\n" + "=" * 60)
    print("测试完成")
    print("=" * 60)


if __name__ == "__main__":
    main()