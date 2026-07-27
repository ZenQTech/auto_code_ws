"""
# ============================================================
# WebSocket 实时通信模块
# ============================================================
# 核心作用：提供 WebSocket 连接，实现实时状态推送和流式输出
# 运行流程：
#   1. 客户端建立 WebSocket 连接（可携带 session_id 订阅特定会话）
#   2. 服务端注册连接到 ConnectionManager
#   3. 任务状态变更时按 session_id 精准广播或全量广播
#   4. 客户端断开时清理连接
# 输入参数：WebSocket 连接（可选 session_id）
# 输出结果：实时 JSON 消息流
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始版本
#   - 2026-07-24 | v2.0.0 | Module B：ConnectionManager 改造为按 session_id 索引，
#     connect() 支持 session_id 参数；新增 broadcast_to(session_id, message)；
#     保留 broadcast() 向后兼容全量广播
#   - 2026-07-24 | v2.1.0 | Module D：扩展 code_stream / stage / reasoning_stage
#     事件类型与协议文档，支撑 DiffView 实时跟随 / 思考阶段展示 / 代码流式生成
# ============================================================
#
# ============================================================
# 客户端 -> 服务端 消息协议
# ============================================================
# 1. 心跳：{ "type": "ping" }
#    响应：{ "type": "pong" }
# 2. 订阅切换：{ "type": "subscribe", "session_id": "xxx" }
#    响应：{ "type": "subscribed", "session_id": "xxx", "message": "..." }
#
# ============================================================
# 服务端 -> 客户端 事件类型（v2.1.0 新增）
# ============================================================
# 1. code_stream（Module D - D7 代码流式生成）
#    作用：实时推送 AI 正在生成的代码片段（token-by-token / 增量行）
#    协议：
#      {
#        "type": "code_stream",
#        "session_id": "xxx",         # 关联会话 ID
#        "file_path": "src/foo.py",   # 目标文件路径
#        "language": "python",        # 编程语言（可选，便于语法高亮）
#        "stage": "coding",           # 当前工作流阶段（驱动 ToolPanel 实时跟随）
#        "delta": "    def foo():\n", # 本次新增的代码片段
#        "total_content": "def foo...",# 累积完整内容（首次/快照使用）
#        "is_final": false            # 是否本文件流式生成结束
#      }
# 2. stage（Module D - D4 实时跟随模式）
#    作用：通知前端当前工作流阶段，前端 ToolPanel 据此切换 Tab
#    协议：
#      {
#        "type": "stage",
#        "session_id": "xxx",
#        "stage": "coding"            # analyzing / planning / coding / testing / reviewing / done
#      }
# 3. reasoning_stage（Module D - D8 分步推理展示）
#    作用：通知前端当前 AI 思考阶段，ThinkingBlock 据此切换进度
#    协议：
#      {
#        "type": "reasoning_stage",
#        "session_id": "xxx",
#        "stage": "analysis"          # analysis / planning / coding / testing
#        "label": "需求分析",         # 可选，本地化展示文本
#        "progress": 0.25             # 可选，0-1 进度值
#      }
# ============================================================
"""

import json
import logging
from typing import Dict, Optional, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

ws_router = APIRouter()


# 标识"无 session 订阅"的全局桶（向后兼容）
GLOBAL_SESSION_ID = "__global__"


class ConnectionManager:
    """
    WebSocket 连接管理器（v2.0.0 Module B 改造）
    作用：管理所有活跃的 WebSocket 连接，支持按 session_id 精准广播
    调用方：WebSocket 路由、任务执行引擎
    被调用方：无
    数据结构：
      - _session_connections: Dict[session_id, Set[WebSocket]] 按 session 索引
      - _websocket_sessions: Dict[WebSocket, session_id] 反向索引，便于断开清理
    """

    def __init__(self):
        # session_id -> 该 session 的所有活跃连接
        self._session_connections: Dict[str, Set[WebSocket]] = {}
        # websocket -> 它所属的 session_id（用于 disconnect 时定位）
        self._websocket_sessions: Dict[WebSocket, str] = {}

    async def connect(self, websocket: WebSocket, session_id: Optional[str] = None):
        """
        接受新连接
        参数：
          - websocket: WebSocket 连接对象
          - session_id: 可选；订阅的会话 ID（不传则进入全局桶）
        运行步骤：
          1. 接受 WebSocket 握手
          2. 计算目标 session_id（缺省为 GLOBAL_SESSION_ID）
          3. 写入 _session_connections 索引
          4. 记录反向索引 _websocket_sessions
        """
        await websocket.accept()
        sid = session_id or GLOBAL_SESSION_ID
        if sid not in self._session_connections:
            self._session_connections[sid] = set()
        self._session_connections[sid].add(websocket)
        self._websocket_sessions[websocket] = sid
        total = self.active_count
        logger.info(
            f"WebSocket 客户端已连接 (session_id={sid})，"
            f"当前总会话数: {len(self._session_connections)}, 总连接数: {total}"
        )

    def disconnect(self, websocket: WebSocket):
        """
        断开连接
        参数：
          - websocket: WebSocket 连接对象
        运行步骤：
          1. 从反向索引定位所属 session_id
          2. 从对应 session 集合中移除
          3. 若集合为空则删除该 session 桶
          4. 清理反向索引
        """
        sid = self._websocket_sessions.pop(websocket, GLOBAL_SESSION_ID)
        bucket = self._session_connections.get(sid)
        if bucket is not None:
            bucket.discard(websocket)
            if not bucket:
                del self._session_connections[sid]
        total = self.active_count
        logger.info(
            f"WebSocket 客户端已断开 (session_id={sid})，"
            f"当前总会话数: {len(self._session_connections)}, 总连接数: {total}"
        )

    async def broadcast(self, message: dict):
        """
        广播消息到所有连接的客户端（向后兼容）
        运行步骤：
          1. 序列化消息为 JSON
          2. 遍历所有 session 的所有连接发送
          3. 忽略发送失败的连接
        参数：
          - message: 要广播的消息字典
        """
        dead: Set[WebSocket] = set()
        payload = json.dumps(message, ensure_ascii=False)

        for bucket in list(self._session_connections.values()):
            for connection in list(bucket):
                try:
                    await connection.send_text(payload)
                except Exception:
                    dead.add(connection)

        for conn in dead:
            self.disconnect(conn)

    async def broadcast_to(self, session_id: str, message: dict):
        """
        精准广播到指定 session_id 的所有连接
        运行步骤：
          1. 定位 session 桶
          2. 序列化消息为 JSON
          3. 遍历桶内所有连接发送
          4. 失败连接自动清理
        参数：
          - session_id: 目标会话 ID
          - message: 要发送的消息字典
        """
        bucket = self._session_connections.get(session_id)
        if not bucket:
            return
        dead: Set[WebSocket] = set()
        payload = json.dumps(message, ensure_ascii=False)
        for connection in list(bucket):
            try:
                await connection.send_text(payload)
            except Exception:
                dead.add(connection)
        for conn in dead:
            self.disconnect(conn)

    async def send_to(self, websocket: WebSocket, message: dict):
        """
        向指定连接发送消息
        参数：
          - websocket: 目标连接
          - message: 消息字典
        """
        try:
            payload = json.dumps(message, ensure_ascii=False)
            await websocket.send_text(payload)
        except Exception as e:
            logger.error(f"WebSocket 发送失败: {e}")

    @property
    def active_count(self) -> int:
        """活跃连接数（跨所有 session）"""
        return len(self._websocket_sessions)

    @property
    def session_count(self) -> int:
        """活跃 session 数（含全局桶）"""
        return len(self._session_connections)

    def get_session_ids(self) -> list:
        """返回当前所有 session_id 列表（用于诊断）"""
        return list(self._session_connections.keys())


# 全局连接管理器
manager = ConnectionManager()


# ============================================================
# Module D 事件发送辅助函数（v2.1.0 新增）
# 作用：业务模块（workflow / agent / streaming）调用这些便捷方法
#       即可向指定 session 广播 code_stream / stage / reasoning_stage 事件
# 调用方：workflow_engine / Loop Engineering v7 / 任何需要推送实时状态的服务
# 被调用方：manager.broadcast_to()
# ============================================================

async def send_code_stream(
    session_id: str,
    file_path: str,
    delta: str,
    total_content: str = "",
    language: str = "",
    stage: str = "coding",
    is_final: bool = False,
) -> None:
    """
    发送 code_stream 事件（D7 代码流式生成）
    作用：将 AI 正在生成的代码片段实时推送给前端 CodeViewer
    运行步骤：
      1. 组装协议消息（type=code_stream, session_id, file_path, ...）
      2. 调用 manager.broadcast_to 精准推送到该 session 的所有连接
    参数：
      - session_id: 目标会话 ID
      - file_path: 目标文件路径
      - delta: 本次新增的代码片段
      - total_content: 累积完整内容（默认空）
      - language: 编程语言（默认空）
      - stage: 当前工作流阶段（默认 coding）
      - is_final: 是否流式结束（默认 False）
    返回值：无
    """
    payload = {
        "type": "code_stream",
        "session_id": session_id,
        "file_path": file_path,
        "delta": delta,
        "total_content": total_content,
        "language": language,
        "stage": stage,
        "is_final": is_final,
    }
    try:
        await manager.broadcast_to(session_id, payload)
    except Exception as e:
        logger.error(f"send_code_stream 失败: {e}")


async def send_stage_event(session_id: str, stage: str) -> None:
    """
    发送 stage 事件（D4 实时跟随模式）
    作用：通知前端 ToolPanel 切换到对应 Tab
    参数：
      - session_id: 目标会话 ID
      - stage: 工作流阶段标识
    """
    payload = {
        "type": "stage",
        "session_id": session_id,
        "stage": stage,
    }
    try:
        await manager.broadcast_to(session_id, payload)
    except Exception as e:
        logger.error(f"send_stage_event 失败: {e}")


async def send_reasoning_stage(
    session_id: str,
    stage: str,
    label: str = "",
    progress: float = 0.0,
) -> None:
    """
    发送 reasoning_stage 事件（D8 分步推理展示）
    作用：通知前端 ThinkingBlock 更新阶段进度
    参数：
      - session_id: 目标会话 ID
      - stage: 推理阶段（analysis / planning / coding / testing）
      - label: 本地化标签（默认空，使用前端默认）
      - progress: 0-1 进度值（默认 0）
    """
    payload = {
        "type": "reasoning_stage",
        "session_id": session_id,
        "stage": stage,
        "label": label,
        "progress": progress,
    }
    try:
        await manager.broadcast_to(session_id, payload)
    except Exception as e:
        logger.error(f"send_reasoning_stage 失败: {e}")


@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket 端点
    运行步骤：
      1. 接受连接（默认进入全局桶）
      2. 发送欢迎消息
      3. 循环接收客户端消息
      4. 处理心跳 / subscribe / echo
      5. 断开时清理
    """
    await manager.connect(websocket)

    # 发送欢迎消息
    await manager.send_to(websocket, {
        "type": "connected",
        "message": "已连接到 Claude Code CLI 调度平台",
    })

    try:
        while True:
            # 接收客户端消息
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type", "")

                if msg_type == "ping":
                    # 心跳响应
                    await manager.send_to(websocket, {"type": "pong"})
                elif msg_type == "subscribe":
                    # 订阅特定 session 的状态更新
                    # 注意：当前实现下 subscribe 不重新绑定 session 桶，
                    # 仅回执确认。如需迁移到目标 session，请断开后重连时携带 session_id。
                    target_sid = msg.get("session_id") or msg.get("target_id", "")
                    await manager.send_to(websocket, {
                        "type": "subscribed",
                        "session_id": target_sid,
                        "message": "如需切换订阅 session，请重连时携带 session_id 参数",
                    })
                else:
                    await manager.send_to(websocket, {
                        "type": "echo",
                        "data": msg,
                    })
            except json.JSONDecodeError:
                await manager.send_to(websocket, {
                    "type": "error",
                    "message": "无效的 JSON 格式",
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket 异常: {e}")
        manager.disconnect(websocket)
