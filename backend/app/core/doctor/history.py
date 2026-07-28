"""
# ============================================================
# Hermes Doctor - 历史报告存储
# ============================================================
# 核心作用：持久化诊断报告，支持查询 / 列表 / 清理
# 存储：
#   - JSON 文件：~/.hermes/doctor/history/{report_id}.json
#   - 内存索引：threading.RLock 保护
#   - 保留策略：最近 50 份
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .base import DoctorReport


# ============================================================
# 历史报告存储
# ============================================================
class ReportHistoryStore:
    """历史报告存储"""

    def __init__(
        self,
        hermes_home: Path,
        keep_count: int = 50,
    ):
        """
        参数：
          - hermes_home: ~/.hermes 路径
          - keep_count: 保留最近报告数
        """
        self.hermes_home = hermes_home
        self.keep_count = keep_count
        self.history_dir = hermes_home / "doctor" / "history"
        self.history_dir.mkdir(parents=True, exist_ok=True)

        self._lock = threading.RLock()
        self._index: Dict[str, DoctorReport] = {}
        self._load_index()

    def _load_index(self) -> None:
        """从磁盘加载索引"""
        with self._lock:
            self._index.clear()
            for json_file in self.history_dir.glob("doc_*.json"):
                try:
                    data = json.loads(json_file.read_text(encoding="utf-8"))
                    report = self._dict_to_report(data)
                    if report:
                        self._index[report.report_id] = report
                except Exception:
                    # 损坏文件跳过
                    continue

    def _dict_to_report(self, data: Dict[str, Any]) -> Optional[DoctorReport]:
        """dict -> DoctorReport（仅顶层字段，避免重建嵌套）"""
        try:
            report = DoctorReport(
                report_id=data["report_id"],
                timestamp=data["timestamp"],
                hostname=data["hostname"],
                hermes_version=data["hermes_version"],
                duration_ms=data.get("duration_ms", 0),
                overall_status=data.get("overall_status", "ok"),
                summary=data.get("summary", {}),
            )
            return report
        except Exception:
            return None

    def save(self, report: DoctorReport) -> None:
        """保存报告"""
        with self._lock:
            path = self.history_dir / f"{report.report_id}.json"
            try:
                path.write_text(
                    json.dumps(report.to_dict(), indent=2, ensure_ascii=False),
                    encoding="utf-8",
                )
            except Exception as e:
                # 保存失败不影响索引
                pass

            self._index[report.report_id] = report
            self._cleanup_old_reports()

    def _cleanup_old_reports(self) -> None:
        """清理旧报告，保留最近 keep_count 份"""
        if len(self._index) <= self.keep_count:
            return

        # 按时间戳排序
        sorted_reports = sorted(
            self._index.values(),
            key=lambda r: r.timestamp,
            reverse=True,
        )

        # 删除超出保留数的
        to_delete = sorted_reports[self.keep_count:]
        for report in to_delete:
            del self._index[report.report_id]
            # 删除磁盘文件
            json_file = self.history_dir / f"{report.report_id}.json"
            if json_file.exists():
                try:
                    json_file.unlink()
                except Exception:
                    pass

    def get(self, report_id: str) -> Optional[DoctorReport]:
        """获取报告"""
        with self._lock:
            return self._index.get(report_id)

    def list_reports(self, limit: int = 20) -> List[Dict[str, Any]]:
        """列出最近报告（仅元信息）"""
        with self._lock:
            reports = sorted(
                self._index.values(),
                key=lambda r: r.timestamp,
                reverse=True,
            )[:limit]
            return [
                {
                    "report_id": r.report_id,
                    "timestamp": r.timestamp,
                    "overall_status": r.overall_status,
                    "summary": r.summary,
                    "duration_ms": r.duration_ms,
                    "hostname": r.hostname,
                    "hermes_version": r.hermes_version,
                }
                for r in reports
            ]

    def count(self) -> int:
        """报告总数"""
        with self._lock:
            return len(self._index)

    def clear(self) -> int:
        """清空所有历史"""
        with self._lock:
            count = len(self._index)
            for report_id in list(self._index.keys()):
                json_file = self.history_dir / f"{report_id}.json"
                if json_file.exists():
                    try:
                        json_file.unlink()
                    except Exception:
                        pass
            self._index.clear()
            return count

    def delete(self, report_id: str) -> bool:
        """删除单个报告"""
        with self._lock:
            if report_id not in self._index:
                return False
            json_file = self.history_dir / f"{report_id}.json"
            if json_file.exists():
                try:
                    json_file.unlink()
                except Exception:
                    pass
            del self._index[report_id]
            return True


# ============================================================
# 全局单例
# ============================================================
_history_instance: Optional[ReportHistoryStore] = None
_history_lock = threading.Lock()


def get_history_store(hermes_home: Optional[Path] = None) -> ReportHistoryStore:
    """获取全局历史存储单例"""
    global _history_instance
    with _history_lock:
        if _history_instance is None:
            home = hermes_home or Path.home() / ".hermes"
            _history_instance = ReportHistoryStore(home)
        return _history_instance


def reset_history_store() -> None:
    """重置单例（用于测试）"""
    global _history_instance
    with _history_lock:
        _history_instance = None
