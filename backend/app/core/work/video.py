"""
# TRAE Work - Video Generation
# ============================================================
# 核心作用：实现 TRAE Work 的 Video Generation 能力
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 核心能力：
#   - 视频元数据提取（模拟）
#   - 关键帧提取（基于时间均匀采样 + 场景变化）
#   - 视频摘要（基于关键帧 + 字幕 + 场景描述）
#   - Mock 视频生成（生成 SVG/GIF 占位文件）
#
# 算法：
#   - 帧采样：均匀采样 N 帧
#   - 场景检测：基于时长分段
#   - 摘要生成：场景描述拼接 + 关键词提取
#   - 复杂度：O(N) N = 帧数
# ============================================================
"""

from __future__ import annotations

import os
import re
from typing import Any, Dict, List, Optional, Tuple

from .models import (
    VideoFrame,
    VideoGeneration,
    VideoMetadata,
    VideoScene,
    VideoStatus,
    VideoStyle,
    VideoSummary,
    _new_id,
    _now_iso,
    path_within,
    safe_filename,
)


# ============================================================
# 模拟元数据提取
# ============================================================

# 模拟的视频元数据库
MOCK_VIDEO_METADATA = {
    "mp4": {"codec": "h264", "fps": 30, "width": 1920, "height": 1080},
    "webm": {"codec": "vp9", "fps": 30, "width": 1920, "height": 1080},
    "mov": {"codec": "h264", "fps": 30, "width": 1920, "height": 1080},
    "avi": {"codec": "h264", "fps": 24, "width": 1280, "height": 720},
    "mkv": {"codec": "h265", "fps": 30, "width": 1920, "height": 1080},
}


def _extract_extension(file_path: str) -> str:
    """提取文件扩展名"""
    if not file_path:
        return "mp4"
    _, ext = os.path.splitext(file_path)
    return ext.lstrip(".").lower() or "mp4"


def _mock_extract_metadata(file_path: str, file_size: int) -> VideoMetadata:
    """模拟提取视频元数据"""
    ext = _extract_extension(file_path)
    base_meta = MOCK_VIDEO_METADATA.get(ext, MOCK_VIDEO_METADATA["mp4"])

    # 模拟时长：基于文件大小估算（粗略）
    # 假设 1MB ≈ 5 秒（1080p30fps）
    duration = max(1.0, min(600.0, file_size / (200 * 1024)))

    return VideoMetadata(
        video_id=_new_id("vid"),
        file_path=file_path,
        duration=round(duration, 2),
        width=base_meta["width"],
        height=base_meta["height"],
        fps=base_meta["fps"],
        codec=base_meta["codec"],
        file_size=file_size,
    )


# ============================================================
# 关键帧提取
# ============================================================

def _generate_frame_placeholder(
    video_id: str,
    frame_id: str,
    timestamp: float,
    output_dir: str,
) -> str:
    """生成关键帧占位 SVG"""
    if not path_within(output_dir, "/tmp/hermes_trae_work"):
        raise ValueError(f"Unsafe output dir: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    filename = f"{frame_id}.svg"
    file_path = os.path.join(output_dir, filename)

    # 生成简单的 SVG 占位图
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <rect width="320" height="180" fill="#1F2937"/>
  <rect x="0" y="0" width="320" height="40" fill="#4F46E5"/>
  <text x="20" y="28" fill="white" font-family="sans-serif" font-size="18" font-weight="bold">Key Frame</text>
  <text x="20" y="80" fill="#D1D5DB" font-family="monospace" font-size="14">video: {video_id}</text>
  <text x="20" y="110" fill="#D1D5DB" font-family="monospace" font-size="14">timestamp: {timestamp:.2f}s</text>
  <text x="20" y="140" fill="#9CA3AF" font-family="monospace" font-size="12">frame: {frame_id}</text>
  <circle cx="280" cy="150" r="20" fill="#10B981"/>
  <text x="270" y="156" fill="white" font-family="sans-serif" font-size="10" font-weight="bold">KEY</text>
</svg>"""

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(svg)
    return file_path


def _generate_thumbnail_placeholder(
    video_id: str,
    output_dir: str,
) -> str:
    """生成视频缩略图占位 SVG"""
    if not path_within(output_dir, "/tmp/hermes_trae_work"):
        raise ValueError(f"Unsafe output dir: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    file_path = os.path.join(output_dir, f"{video_id}_thumb.svg")
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">
  <rect width="160" height="90" fill="#111827"/>
  <polygon points="70,30 70,60 100,45" fill="#4F46E5"/>
  <text x="50" y="80" fill="#9CA3AF" font-family="sans-serif" font-size="8">{video_id}</text>
</svg>"""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(svg)
    return file_path


# ============================================================
# 场景检测与摘要
# ============================================================

def _detect_scenes(
    duration: float,
    scene_count: Optional[int] = None,
) -> List[Tuple[float, float]]:
    """检测场景边界

    Args:
        duration: 视频总时长
        scene_count: 期望场景数（None 时自动估算）

    Returns:
        [(start, end), ...] 场景列表
    """
    if duration <= 0:
        return []

    if scene_count is None:
        # 自动估算：每 10 秒一个场景，最少 1 个，最多 8 个
        scene_count = max(1, min(8, int(duration / 10)))

    scene_count = max(1, min(20, scene_count))
    scene_duration = duration / scene_count

    scenes: List[Tuple[float, float]] = []
    for i in range(scene_count):
        start = i * scene_duration
        end = (i + 1) * scene_duration if i < scene_count - 1 else duration
        scenes.append((round(start, 2), round(end, 2)))
    return scenes


def _generate_scene_description(index: int, duration: float) -> str:
    """生成场景描述（Mock）"""
    templates = [
        "讲师介绍主题内容，背景包含关键词幻灯片",
        "演示代码示例，逐步展示实现过程",
        "展示运行效果与最终输出",
        "总结要点，提示后续学习路径",
        "互动问答环节，与观众交流",
        "案例分析，详细讲解实际应用",
        "深入剖析核心原理与技术细节",
        "对比不同方案的优缺点",
    ]
    template = templates[index % len(templates)]
    return f"场景 {index + 1}（{duration:.1f}秒）：{template}"


def _extract_keywords(text: str, top_k: int = 5) -> List[str]:
    """提取关键词"""
    if not text:
        return []
    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be",
        "的", "了", "是", "在", "有", "和", "与", "或", "但", "我", "你", "他",
    }
    words = re.findall(r"[A-Za-z]{3,}|[\u4e00-\u9fa5]{2,}", text)
    word_count: Dict[str, int] = {}
    for w in words:
        wl = w.lower()
        if wl in stop_words:
            continue
        word_count[wl] = word_count.get(wl, 0) + 1
    sorted_words = sorted(word_count.items(), key=lambda x: -x[1])
    return [w for w, _ in sorted_words[:top_k]]


# ============================================================
# Mock 视频生成
# ============================================================

def _generate_video_placeholder(
    gen_id: str,
    prompt: str,
    duration: float,
    resolution: str,
    style: str,
    output_dir: str,
) -> str:
    """生成视频占位 SVG（动画帧序列）"""
    if not path_within(output_dir, "/tmp/hermes_trae_work"):
        raise ValueError(f"Unsafe output dir: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)
    file_path = os.path.join(output_dir, f"{gen_id}.svg")

    # 风格配色
    style_colors = {
        "realistic": ("#1F2937", "#4F46E5"),
        "animated": ("#FEF3C7", "#F59E0B"),
        "abstract": ("#0F172A", "#EC4899"),
        "cinematic": ("#000000", "#D4AF37"),
    }
    bg, fg = style_colors.get(style, style_colors["realistic"])

    # 解析分辨率
    w, h = 640, 360
    m = re.match(r"(\d+)x(\d+)", resolution)
    if m:
        w, h = int(m.group(1)), int(m.group(2))

    # 截断 prompt
    safe_prompt = prompt[:80].replace("<", "").replace(">", "").replace("&", "&amp;")

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{bg}"/>
      <stop offset="100%" stop-color="{fg}"/>
    </linearGradient>
  </defs>
  <rect width="{w}" height="{h}" fill="url(#grad)"/>
  <text x="40" y="60" fill="white" font-family="sans-serif" font-size="24" font-weight="bold">TRAE Work Video</text>
  <text x="40" y="100" fill="white" opacity="0.9" font-family="sans-serif" font-size="16">Generated Video Preview</text>
  <rect x="40" y="130" width="{w - 80}" height="60" fill="black" opacity="0.4" rx="6"/>
  <text x="55" y="160" fill="white" font-family="sans-serif" font-size="13">Prompt: {safe_prompt}</text>
  <text x="55" y="180" fill="white" opacity="0.8" font-family="monospace" font-size="11">duration: {duration:.1f}s | resolution: {resolution} | style: {style}</text>
  <text x="40" y="{h - 30}" fill="white" opacity="0.6" font-family="monospace" font-size="11">gen_id: {gen_id}</text>
  <circle cx="{w - 60}" cy="{h - 60}" r="20" fill="{fg}" opacity="0.6"/>
  <polygon points="{w - 70},{h - 70} {w - 70},{h - 50} {w - 50},{h - 60}" fill="white"/>
</svg>"""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(svg)
    return file_path


# ============================================================
# Video 服务类
# ============================================================


class VideoService:
    """视频服务

    功能：
        - 视频上传 + 元数据提取
        - 关键帧提取
        - 视频摘要
        - Mock 视频生成
    """

    def __init__(self, base_dir: str = "/tmp/hermes_trae_work") -> None:
        # video_id -> VideoMetadata
        self._videos: Dict[str, VideoMetadata] = {}
        # summary_id -> VideoSummary
        self._summaries: Dict[str, VideoSummary] = {}
        # frame_id -> VideoFrame
        self._frames: Dict[str, VideoFrame] = {}
        # gen_id -> VideoGeneration
        self._generations: Dict[str, VideoGeneration] = {}

        # 路径白名单
        self._base_dir = base_dir
        os.makedirs(base_dir, exist_ok=True)
        self._frames_dir = os.path.join(base_dir, "frames")
        self._videos_dir = os.path.join(base_dir, "videos")
        self._gens_dir = os.path.join(base_dir, "generations")
        for d in [self._frames_dir, self._videos_dir, self._gens_dir]:
            os.makedirs(d, exist_ok=True)

        import threading
        self._lock = threading.RLock()
        # 统计
        self._stats = {
            "uploaded": 0,
            "frames_extracted": 0,
            "summaries": 0,
            "generations": 0,
        }

    # ============================================================
    # 视频上传
    # ============================================================

    def upload_video(
        self,
        file_path: str,
        file_size: int,
        uploaded_by: str = "default_user",
        title: str = "",
        description: str = "",
    ) -> VideoMetadata:
        """上传视频

        Args:
            file_path: 视频文件路径
            file_size: 文件大小（字节）
            uploaded_by: 上传者
            title: 标题
            description: 描述

        Returns:
            VideoMetadata 实例
        """
        # 路径白名单
        if not path_within(file_path, "/tmp"):
            raise ValueError(f"Unsafe file path: {file_path}")

        if file_size <= 0:
            raise ValueError("Invalid file size")
        if file_size > 100 * 1024 * 1024:
            raise ValueError(f"File too large: {file_size} > 100MB")

        # 提取元数据
        metadata = _mock_extract_metadata(file_path, file_size)
        metadata.uploaded_by = uploaded_by
        metadata.title = title
        metadata.description = description

        # 生成缩略图
        try:
            thumb_path = _generate_thumbnail_placeholder(metadata.video_id, self._videos_dir)
            metadata.thumbnail_path = thumb_path
        except Exception:
            pass

        with self._lock:
            self._videos[metadata.video_id] = metadata
            self._stats["uploaded"] += 1

        return metadata

    def get_video(self, video_id: str) -> Optional[VideoMetadata]:
        """获取视频元数据"""
        with self._lock:
            return self._videos.get(video_id)

    def list_videos(
        self,
        uploaded_by: Optional[str] = None,
        limit: int = 50,
    ) -> List[VideoMetadata]:
        """列出视频"""
        with self._lock:
            results = list(self._videos.values())
        if uploaded_by:
            results = [v for v in results if v.uploaded_by == uploaded_by]
        results.sort(key=lambda v: v.uploaded_at, reverse=True)
        return results[:limit]

    def delete_video(self, video_id: str) -> bool:
        """删除视频"""
        with self._lock:
            video = self._videos.pop(video_id, None)
            if not video:
                return False
            # 清理关联的帧和摘要
            for fid in list(self._frames.keys()):
                if self._frames[fid].video_id == video_id:
                    del self._frames[fid]
            for sid in list(self._summaries.keys()):
                if self._summaries[sid].video_id == video_id:
                    del self._summaries[sid]
            return True

    # ============================================================
    # 关键帧提取
    # ============================================================

    def extract_keyframes(
        self,
        video_id: str,
        frame_count: int = 5,
    ) -> List[VideoFrame]:
        """提取关键帧

        Args:
            video_id: 视频 ID
            frame_count: 帧数（1-20）

        Returns:
            关键帧列表
        """
        frame_count = max(1, min(20, frame_count))

        with self._lock:
            video = self._videos.get(video_id)
        if not video:
            raise ValueError(f"Video not found: {video_id}")

        # 均匀采样时间戳
        if video.duration <= 0:
            timestamps = [0.0]
        else:
            step = video.duration / frame_count
            timestamps = [i * step for i in range(frame_count)]

        # 生成帧
        frames: List[VideoFrame] = []
        for i, ts in enumerate(timestamps):
            frame_id = _new_id("frm")
            try:
                file_path = _generate_frame_placeholder(
                    video_id, frame_id, ts, self._frames_dir
                )
            except Exception:
                file_path = ""

            frame = VideoFrame(
                frame_id=frame_id,
                video_id=video_id,
                timestamp=round(ts, 2),
                file_path=file_path,
                description=f"关键帧 #{i+1} 在 {ts:.2f}s",
                is_key_frame=True,
            )
            with self._lock:
                self._frames[frame.frame_id] = frame
            frames.append(frame)

        with self._lock:
            self._stats["frames_extracted"] += len(frames)

        return frames

    def get_frame(self, frame_id: str) -> Optional[VideoFrame]:
        """获取帧"""
        with self._lock:
            return self._frames.get(frame_id)

    # ============================================================
    # 视频摘要
    # ============================================================

    def summarize(
        self,
        video_id: str,
        frame_count: int = 5,
        include_transcript: bool = True,
    ) -> VideoSummary:
        """生成视频摘要

        Args:
            video_id: 视频 ID
            frame_count: 关键帧数
            include_transcript: 是否包含字幕

        Returns:
            VideoSummary 实例
        """
        with self._lock:
            video = self._videos.get(video_id)
        if not video:
            raise ValueError(f"Video not found: {video_id}")

        # 提取关键帧
        frames = self.extract_keyframes(video_id, frame_count=frame_count)
        frame_ids = [f.frame_id for f in frames]

        # 场景检测
        scene_count = min(len(frames), max(1, int(video.duration / 10)))
        scene_bounds = _detect_scenes(video.duration, scene_count)

        # 构建场景
        scenes: List[VideoFrame] = []
        for i, (start, end) in enumerate(scene_bounds):
            scene = VideoScene(
                scene_id=_new_id("scn"),
                start=start,
                end=end,
                description=_generate_scene_description(i, end - start),
                key_frame_id=frame_ids[i] if i < len(frame_ids) else None,
            )
            scenes.append(scene)

        # 模拟字幕
        transcript = ""
        if include_transcript:
            transcript = self._mock_transcript(video)

        # 拼接摘要
        summary_text = self._build_summary_text(video, scenes, transcript)

        # 创建摘要对象
        summary = VideoSummary(
            summary_id=_new_id("vsum"),
            video_id=video_id,
            key_frames=frame_ids,
            duration=video.duration,
            transcript=transcript,
            scenes=[s.to_dict() for s in scenes],
            summary_text=summary_text,
        )

        with self._lock:
            self._summaries[summary.summary_id] = summary
            self._stats["summaries"] += 1

        return summary

    def get_summary(self, summary_id: str) -> Optional[VideoSummary]:
        """获取摘要"""
        with self._lock:
            return self._summaries.get(summary_id)

    def list_summaries(
        self,
        video_id: Optional[str] = None,
        limit: int = 50,
    ) -> List[VideoSummary]:
        """列出摘要"""
        with self._lock:
            results = list(self._summaries.values())
        if video_id:
            results = [s for s in results if s.video_id == video_id]
        results.sort(key=lambda s: s.created_at, reverse=True)
        return results[:limit]

    # ============================================================
    # Mock 视频生成
    # ============================================================

    def generate_video(
        self,
        prompt: str,
        duration: float = 5.0,
        resolution: str = "1280x720",
        style: str = "realistic",
        owner: str = "default_user",
    ) -> VideoGeneration:
        """生成视频（Mock）

        Args:
            prompt: 提示词
            duration: 目标时长（秒）
            resolution: 分辨率
            style: 风格
            owner: 所有者

        Returns:
            VideoGeneration 实例
        """
        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")
        if duration <= 0 or duration > 60:
            raise ValueError(f"Invalid duration: {duration}")
        if style not in {s.value for s in VideoStyle}:
            raise ValueError(f"Invalid style: {style}")

        gen = VideoGeneration(
            gen_id=_new_id("vgen"),
            prompt=prompt,
            duration=duration,
            resolution=resolution,
            style=style,
            status=VideoStatus.RUNNING.value,
            owner=owner,
        )

        # Mock：直接生成占位文件
        try:
            output_path = _generate_video_placeholder(
                gen.gen_id, prompt, duration, resolution, style, self._gens_dir
            )
            gen.output_path = output_path
            gen.status = VideoStatus.COMPLETED.value
            gen.progress = 1.0
            gen.completed_at = _now_iso()
        except Exception as e:
            gen.status = VideoStatus.FAILED.value
            gen.error = str(e)

        with self._lock:
            self._generations[gen.gen_id] = gen
            self._stats["generations"] += 1

        return gen

    def get_generation(self, gen_id: str) -> Optional[VideoGeneration]:
        """获取生成任务"""
        with self._lock:
            return self._generations.get(gen_id)

    def list_generations(
        self,
        owner: Optional[str] = None,
        limit: int = 50,
    ) -> List[VideoGeneration]:
        """列出生成任务"""
        with self._lock:
            results = list(self._generations.values())
        if owner:
            results = [g for g in results if g.owner == owner]
        results.sort(key=lambda g: g.created_at, reverse=True)
        return results[:limit]

    # ============================================================
    # 内部辅助
    # ============================================================

    def _mock_transcript(self, video: VideoMetadata) -> str:
        """模拟字幕生成"""
        title_part = video.title or "本视频"
        return (
            f"[00:00] 欢迎观看 {title_part}。\n"
            f"[00:05] 今天我们将讨论关键内容。\n"
            f"[00:15] 接下来演示具体实现。\n"
            f"[00:30] 这是一个重要概念。\n"
            f"[00:45] 总结要点：核心是理解原理。\n"
        )

    def _build_summary_text(
        self,
        video: VideoMetadata,
        scenes: List[VideoFrame],
        transcript: str,
    ) -> str:
        """构建摘要文本"""
        parts: List[str] = []
        title = video.title or f"视频 {video.video_id}"
        parts.append(f"# {title} 摘要\n")
        parts.append(f"**时长**: {video.duration:.1f}秒  ")
        parts.append(f"**分辨率**: {video.width}x{video.height}  ")
        parts.append(f"**帧率**: {video.fps}fps\n")
        parts.append("## 场景概览")
        for i, scene in enumerate(scenes, 1):
            parts.append(f"- {scene.description}")

        keywords = _extract_keywords(transcript + " ".join(s.description for s in scenes))
        if keywords:
            parts.append(f"\n## 关键词\n{', '.join(keywords)}")

        return "\n".join(parts)

    def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        with self._lock:
            return dict(self._stats)


# 全局单例
GLOBAL_VIDEO = VideoService()
