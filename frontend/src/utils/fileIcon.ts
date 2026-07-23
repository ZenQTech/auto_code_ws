/**
 * # ============================================================
 * # 共享文件图标工具
 * # ============================================================
 * # 核心作用：根据文件扩展名返回对应的 emoji 图标
 * # 输入参数：
 * #   - extension?: string，文件扩展名（如 ".py"、".ts"）
 * # 返回值：string，emoji 图标
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 从 FileExplorer.tsx / CodeViewer.tsx 提取合并
 * # ============================================================
 */

/** 文件扩展名 → emoji 图标映射表 */
export const FILE_ICONS: Record<string, string> = {
  '.py': '🐍',
  '.ts': '🔷',
  '.tsx': '⚛️',
  '.js': '🟨',
  '.jsx': '⚛️',
  '.json': '📋',
  '.md': '📝',
  '.html': '🌐',
  '.htm': '🌐',
  '.css': '🎨',
  '.yaml': '⚙️',
  '.yml': '⚙️',
  '.cpp': '⚡',
  '.c': '⚡',
  '.h': '⚡',
  '.hpp': '⚡',
  '.sh': '💻',
  '.bash': '💻',
};

/**
 * 根据文件扩展名返回对应图标 emoji
 * 作用：从 FILE_ICONS 映射表中查找对应图标，未匹配时返回默认图标 📄
 * 参数：
 *   - extension?: string，文件扩展名（如 ".py"）
 * 返回值：string，emoji 图标
 */
export function getFileIcon(extension?: string): string {
  if (!extension) return '📄';
  return FILE_ICONS[extension] || '📄';
}
