"""
# ============================================================
# 视觉回归基线
# ============================================================
# 核心作用：截图指纹计算、基线 CRUD、漂移检测
# 存储：JSONL 文件
# 漂移阈值：默认 5%（可配置）
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class VisualRegression:
    """
    视觉回归基线管理器
    - 计算截图指纹（SHA-256）
    - 存储/检索基线
    - 检测漂移
    """

    def __init__(
        self,
        baselines_dir: str = "/home/qizheng/auto_code_ws/tests/e2e_baselines",
        drift_threshold: float = 0.05,
    ):
        self.baselines_dir = Path(baselines_dir)
        self.baselines_dir.mkdir(parents=True, exist_ok=True)
        self.drift_threshold = drift_threshold
        self.baseline_file = self.baselines_dir / "baselines.jsonl"
        if not self.baseline_file.exists():
            self.baseline_file.touch()

    def _read_baselines(self) -> List[Dict[str, Any]]:
        """读取所有基线"""
        baselines: List[Dict[str, Any]] = []
        with open(self.baseline_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    baselines.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
        return baselines

    def _write_baselines(self, baselines: List[Dict[str, Any]]) -> None:
        """写入所有基线"""
        with open(self.baseline_file, "w", encoding="utf-8") as f:
            for bl in baselines:
                f.write(json.dumps(bl, ensure_ascii=False) + "\n")

    def compute_fingerprint(self, data: bytes) -> str:
        """计算数据指纹（SHA-256）"""
        return hashlib.sha256(data).hexdigest()

    def compute_fingerprint_from_file(self, filepath: str) -> str:
        """从文件计算指纹"""
        p = Path(filepath)
        if not p.exists():
            raise FileNotFoundError(f"screenshot not found: {filepath}")
        return self.compute_fingerprint(p.read_bytes())

    def capture_baseline(
        self,
        name: str,
        data: bytes,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """捕获基线"""
        baseline = {
            "name": name,
            "fingerprint": self.compute_fingerprint(data),
            "size": len(data),
            "captured_at": int(time.time()),
            "metadata": metadata or {},
        }
        # 删除同名基线
        baselines = [b for b in self._read_baselines() if b["name"] != name]
        baselines.append(baseline)
        self._write_baselines(baselines)
        # 同时保存数据
        data_path = self.baselines_dir / f"{name}.bin"
        data_path.write_bytes(data)
        logger.info(f"captured baseline: {name} ({len(data)} bytes)")
        return baseline

    def get_baseline(self, name: str) -> Optional[Dict[str, Any]]:
        """获取基线"""
        for bl in self._read_baselines():
            if bl["name"] == name:
                return bl
        return None

    def list_baselines(self) -> List[Dict[str, Any]]:
        """列出所有基线"""
        return self._read_baselines()

    def delete_baseline(self, name: str) -> bool:
        """删除基线"""
        baselines = self._read_baselines()
        new_baselines = [b for b in baselines if b["name"] != name]
        if len(new_baselines) == len(baselines):
            return False
        self._write_baselines(new_baselines)
        # 删除数据
        data_path = self.baselines_dir / f"{name}.bin"
        if data_path.exists():
            data_path.unlink()
        return True

    def compare(
        self,
        name: str,
        new_data: bytes,
        threshold: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        对比基线
        返回：
          {
            "matched": bool,
            "drift": float (0-1),
            "baseline_fingerprint": str,
            "new_fingerprint": str,
            "threshold": float,
          }
        """
        threshold = threshold if threshold is not None else self.drift_threshold
        baseline = self.get_baseline(name)
        if not baseline:
            return {
                "matched": False,
                "drift": 1.0,
                "error": "baseline_not_found",
                "name": name,
            }
        new_fp = self.compute_fingerprint(new_data)
        baseline_fp = baseline["fingerprint"]
        if new_fp == baseline_fp:
            return {
                "matched": True,
                "drift": 0.0,
                "baseline_fingerprint": baseline_fp,
                "new_fingerprint": new_fp,
                "threshold": threshold,
                "name": name,
            }
        # 不同指纹：估算漂移（基于字节大小）
        size_diff = abs(len(new_data) - baseline.get("size", 0))
        max_size = max(len(new_data), baseline.get("size", 1))
        drift = min(1.0, size_diff / max_size)
        return {
            "matched": drift < threshold,
            "drift": drift,
            "baseline_fingerprint": baseline_fp,
            "new_fingerprint": new_fp,
            "threshold": threshold,
            "name": name,
        }

    def drift_detected(self, name: str, new_data: bytes) -> bool:
        """是否检测到漂移"""
        result = self.compare(name, new_data)
        return not result.get("matched", False) and result.get("error") != "baseline_not_found"

    def stats(self) -> Dict[str, Any]:
        """统计信息"""
        baselines = self._read_baselines()
        return {
            "total_baselines": len(baselines),
            "drift_threshold": self.drift_threshold,
            "baselines_dir": str(self.baselines_dir),
        }
