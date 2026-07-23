"""
# ============================================================
# WebSocket 实时通信模块
# ============================================================
# 核心作用：提供 WebSocket 连接，实现实时状态推送和流式输出
# 运行流程：
#   1. 客户端建立 WebSocket 连接
#   2. 服务端注册连接
#   3. 任务状态变更时推送消息
#   4. 客户端断开时清理连接
# 输入参数：WebSocket 连接
# 输出结果：实时 JSON 消息流
# ============================================================
"""

import json
import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

ws_router = APIRouter()


class ConnectionManager:
    """
    WebSocket 连接管理器
    作用：管理所有活跃的 WebSocket 连接，广播消息
    调用方：WebSocket 路由、任务执行引擎
    被调用方：无
    """

    def __init__(self):
        # 活跃连接集合
        self._connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        """
        接受新连接
        参数：
          - websocket: WebSocket 连接对象
        """
        await websocket.accept()
        self._connections.add(websocket)
        logger.info(f"WebSocket 客户端已连接，当前连接数: {len(self._connections)}")

    def disconnect(self, websocket: WebSocket):
        """
        断开连接
        参数：
          - websocket: WebSocket 连接对象
        """
        self._connections.discard(websocket)
        logger.info(f"WebSocket 客户端已断开，当前连接数: {len(self._connections)}")

    async def broadcast(self, message: dict):
        """
        广播消息到所有连接的客户端
        运行步骤：
          1. 序列化消息为 JSON
          2. 遍历所有连接发送
          3. 忽略发送失败的连接
        参数：
          - message: 要广播的消息字典
        """
        dead_connections: Set[WebSocket] = set()
        payload = json.dumps(message, ensure_ascii=False)

        for connection in self._connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead_connections.add(connection)

        # 清理失效连接
        for conn in dead_connections:
            self._connections.discard(conn)

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
        """活跃连接数"""
        return len(self._connections)


# 全局连接管理器
manager = ConnectionManager()


@ws_router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket 端点
    运行步骤：
      1. 接受连接
      2. 发送欢迎消息
      3. 循环接收客户端消息
      4. 处理心跳和状态请求
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
                    # 订阅特定智能体或任务的状态更新
                    await manager.send_to(websocket, {
                        "type": "subscribed",
                        "target": msg.get("target", ""),
                        "target_id": msg.get("target_id", ""),
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
