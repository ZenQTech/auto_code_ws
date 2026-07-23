/**
 * # ============================================================
 * # 文件浏览器组件（FileExplorer）
 * # ============================================================
 * # 核心作用：以树形视图展示项目目录结构，支持展开/折叠目录、
 * #           按扩展名显示文件图标、点击文件触发文件选择回调
 * # 运行流程：
 * #   1. 组件挂载时调用 fetchFileTree API 拉取项目文件树
 * #   2. 递归渲染树节点：目录可展开/折叠（▶/▼ 箭头），文件可点击
 * #   3. 文件按扩展名显示对应图标（.py=🐍 .ts=🔷 .js=🟨 .json=📋
 * #      .md=📝 .html=🌐 .css=🎨 .yaml=⚙️ .cpp=⚡ default=📄）
 * #   4. 选中的文件高亮（hermes-500/20 背景）
 * #   5. 排序：目录优先，同类型按字母序
 * #   6. 空项目显示"项目为空，等待代码生成..."
 * # 输入参数（Props）：
 * #   - project: string，项目名称
 * #   - onFileSelect: (path: string) => void，文件选择回调
 * #   - selectedFile: string | null，当前选中的文件路径
 * #   - onClose?: () => void，v2.10.2 新增：标题栏关闭按钮回调（可选）
 * #     通知父组件隐藏文件浏览器容器（不销毁内部文件树缓存）
 * # 输出结果：纯 UI 组件，无返回值
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-24 | v2.10.0 | 初始版本：文件浏览器树形组件
 * #   - 2026-06-24 | v2.10.1 | 修复：loadTree 增加 Array.isArray 防御性校验，
 * #     防止 fetchFileTree 返回非数组数据时 [...tree].sort() 导致 React 渲染崩溃（黑屏）；
 * #     sortedTree 计算同样增加 Array.isArray 兜底防护
 * #   - 2026-06-24 | v2.10.2 | 标题栏新增关闭按钮（onClose 回调）
 * # ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchFileTree, deleteFile as apiDeleteFile, copyFile as apiCopyFile, renameFile as apiRenameFile } from '../hooks/useApi';
import type { FileTreeNode } from '../types';

interface Props {
  /** 项目名称 */
  project: string;
  /** 文件选择回调：传入选中文件的路径 */
  onFileSelect: (path: string) => void;
  /** 当前选中的文件路径（高亮用） */
  selectedFile: string | null;
  /**
   * v2.10.2 新增：标题栏关闭按钮回调（可选）
   * 调用时机：用户点击标题栏右侧"关闭"按钮
   * 行为：通知父组件隐藏文件浏览器容器，本组件内部 state（文件树缓存、展开目录）保持不变
   */
  onClose?: () => void;
}

/** 根据文件扩展名返回对应图标 emoji */
function getFileIcon(extension?: string): string {
  switch (extension) {
    case '.py':    return '🐍';
    case '.ts':
    case '.tsx':   return '🔷';
    case '.js':
    case '.jsx':   return '🟨';
    case '.json':  return '📋';
    case '.md':    return '📝';
    case '.html':
    case '.htm':   return '🌐';
    case '.css':   return '🎨';
    case '.yaml':
    case '.yml':   return '⚙️';
    case '.cpp':
    case '.c':
    case '.h':
    case '.hpp':   return '⚡';
    default:       return '📄';
  }
}

/** 单个树节点组件：递归渲染目录和文件 */
function TreeNode({
  node,
  depth,
  onFileSelect,
  selectedFile,
  expandedDirs,
  onToggleDir,
  onContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  onFileSelect: (path: string) => void;
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, filePath: string) => void;
}) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = selectedFile === node.path;

  /** 对子节点排序：目录优先，同类按字母序 */
  const sortedChildren = node.children
    ? [...node.children].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <div>
      {/* 当前节点 */}
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer
                    rounded-md transition-colors duration-fast
                    ${isSelected
                      ? 'bg-hermes-500/20 border-l-2 border-l-hermes-500'
                      : 'border-l-2 border-l-transparent hover:bg-surface-200/60'
                    }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (isDir) {
            onToggleDir(node.path);
          } else {
            onFileSelect(node.path);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(e, node.path);
        }}
      >
        {/* 展开/折叠箭头（仅目录显示） */}
        {isDir ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-surface-500">
            {isExpanded ? '▼' : '▶'}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        {/* 图标 */}
        <span className="text-sm flex-shrink-0">
          {isDir ? (isExpanded ? '📂' : '📁') : getFileIcon(node.extension)}
        </span>

        {/* 文件名 / 目录名 */}
        <span
          className={`text-xs truncate ml-1 select-none
                     ${isSelected ? 'text-hermes-400 font-medium' : 'text-surface-800'}
                     ${isDir ? 'font-medium' : ''}`}
        >
          {node.name}
        </span>
      </div>

      {/* 子节点（仅展开的目录渲染） */}
      {isDir && isExpanded && sortedChildren.length > 0 && (
        <div>
          {sortedChildren.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}

      {/* 空目录提示 */}
      {isDir && isExpanded && sortedChildren.length === 0 && (
        <div
          className="text-xs text-surface-600 py-1"
          style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
        >
          （空目录）
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({ project, onFileSelect, selectedFile, onClose }: Props) {
  /** 文件树数据 */
  const [tree, setTree] = useState<FileTreeNode[]>([]);
  /** 加载态 */
  const [loading, setLoading] = useState(true);
  /** 错误信息 */
  const [error, setError] = useState('');
  /** 已展开的目录路径集合 */
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // -- 右键菜单状态 --
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    filePath: string;
  } | null>(null);
  const explorerRef = useRef<HTMLDivElement>(null);

  /**
   * 加载文件树
   * 运行步骤：
   *   1. 设置加载态，清空旧错误
   *   2. 调用 fetchFileTree API
   *   3. 自动展开第一层目录
   *   4. 错误时设置错误信息
   */
  const loadTree = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFileTree(project);
      // 防御性校验：确保 data 为有效数组，防止非数组数据导致后续渲染崩溃
      if (!Array.isArray(data)) {
        console.error('fetchFileTree 返回了非数组数据：', data);
        setTree([]);
        throw new Error('服务器返回了非预期的数据格式');
      }
      setTree(data);
      // 自动展开第一层目录
      const firstLevelDirs = new Set<string>();
      data.forEach(node => {
        if (node.type === 'directory') {
          firstLevelDirs.add(node.path);
        }
      });
      setExpandedDirs(firstLevelDirs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [project]);

  // 项目变化时重新加载
  useEffect(() => {
    loadTree();
  }, [loadTree]);

  /**
   * 切换目录展开/折叠
   * 参数：
   *   - path: string，目录路径
   */
  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // -- 右键菜单操作 --

  /** 打开右键菜单 */
  const handleContextMenu = useCallback((e: React.MouseEvent, filePath: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, filePath });
  }, []);

  /** 关闭右键菜单 */
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /** 删除文件 */
  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    const ok = confirm(`确定要删除 "${contextMenu.filePath}" 吗？`);
    if (!ok) return;
    try {
      await apiDeleteFile(project, contextMenu.filePath);
      closeContextMenu();
      await loadTree();
    } catch (e) {
      alert(`删除失败: ${(e as Error).message}`);
    }
  }, [contextMenu, project, closeContextMenu, loadTree]);

  /** 复制文件 */
  const handleCopy = useCallback(async () => {
    if (!contextMenu) return;
    const target = prompt('请输入目标路径（相对于项目根目录）：', contextMenu.filePath + '.copy');
    if (!target) return;
    try {
      await apiCopyFile(project, contextMenu.filePath, target);
      closeContextMenu();
      await loadTree();
    } catch (e) {
      alert(`复制失败: ${(e as Error).message}`);
    }
  }, [contextMenu, project, closeContextMenu, loadTree]);

  /** 重命名文件 */
  const handleRename = useCallback(async () => {
    if (!contextMenu) return;
    const currentName = contextMenu.filePath.split('/').pop() || '';
    const newName = prompt('请输入新文件名：', currentName);
    if (!newName || newName === currentName) return;
    try {
      await apiRenameFile(project, contextMenu.filePath, newName);
      closeContextMenu();
      await loadTree();
    } catch (e) {
      alert(`重命名失败: ${(e as Error).message}`);
    }
  }, [contextMenu, project, closeContextMenu, loadTree]);

  /** 复制相对路径 */
  const handleCopyRelativePath = useCallback(() => {
    if (!contextMenu) return;
    navigator.clipboard.writeText(contextMenu.filePath);
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  /** 复制绝对路径 */
  const handleCopyAbsolutePath = useCallback(() => {
    if (!contextMenu) return;
    const absPath = `workspace/${project}/${contextMenu.filePath}`;
    navigator.clipboard.writeText(absPath);
    closeContextMenu();
  }, [contextMenu, project, closeContextMenu]);

  /** 排序根节点：目录优先，同类按字母序 */
  const sortedTree = Array.isArray(tree)
    ? [...tree].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    : [];

  return (
    <div className="flex flex-col h-full bg-surface-100 border-l border-surface-300" ref={explorerRef}>
      {/* 标题栏 */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-surface-300/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-surface-800 uppercase tracking-wider">
            📁 文件浏览器
          </span>
          {/* 标题栏右侧操作按钮组：刷新 + 关闭（v2.10.2 新增关闭按钮） */}
          <div className="flex items-center gap-1">
            {/* 刷新按钮：拉取最新文件树（保留原逻辑） */}
            <button
              onClick={loadTree}
              className="icon-btn !w-6 !h-6"
              title="刷新文件树"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {/* v2.10.2 新增：关闭按钮（X 图标），仅在 onClose 提供时渲染
             *  行为：触发 props.onClose() → 父组件 App.tsx 隐藏容器
             *  样式：与刷新按钮一致（icon-btn !w-6 !h-6），hover 变红提示危险 */}
            {onClose && (
              <button
                onClick={onClose}
                className="icon-btn !w-6 !h-6 hover:text-red-400"
                title="关闭文件浏览器"
                aria-label="关闭文件浏览器"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 文件树内容区 */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* 加载态 */}
        {loading && (
          <div className="p-3 space-y-1.5">
            <div className="skeleton h-6 w-3/4 rounded" />
            <div className="skeleton h-6 w-2/3 rounded ml-3" />
            <div className="skeleton h-6 w-1/2 rounded ml-3" />
            <div className="skeleton h-6 w-4/5 rounded" />
          </div>
        )}

        {/* 错误态 */}
        {!loading && error && (
          <div className="px-3 py-2">
            <div className="text-xs text-red-400 bg-red-500/10 rounded-lg px-2 py-1.5">
              加载失败：{error}
            </div>
          </div>
        )}

        {/* 空态 */}
        {!loading && !error && sortedTree.length === 0 && (
          <div className="empty-state py-6">
            <span className="empty-icon text-base">📭</span>
            <span className="text-xs text-surface-500">项目为空，等待代码生成...</span>
          </div>
        )}

        {/* 文件树 */}
        {!loading && !error && sortedTree.length > 0 && (
          <div>
            {sortedTree.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <>
          {/* 遮罩层：点击任意位置关闭菜单 */}
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed z-50 bg-surface-100 border border-surface-300 rounded-lg shadow-2xl py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button onClick={handleDelete} className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-surface-200 flex items-center gap-2">
              🗑 删除文件
            </button>
            <button onClick={handleCopy} className="w-full text-left px-4 py-2 text-xs text-surface-800 hover:bg-surface-200 flex items-center gap-2">
              📋 复制文件
            </button>
            <button onClick={handleRename} className="w-full text-left px-4 py-2 text-xs text-surface-800 hover:bg-surface-200 flex items-center gap-2">
              ✏️ 重命名文件
            </button>
            <div className="border-t border-surface-300 my-1" />
            <button onClick={handleCopyRelativePath} className="w-full text-left px-4 py-2 text-xs text-surface-800 hover:bg-surface-200 flex items-center gap-2">
              📎 复制相对路径
            </button>
            <button onClick={handleCopyAbsolutePath} className="w-full text-left px-4 py-2 text-xs text-surface-800 hover:bg-surface-200 flex items-center gap-2">
              🔗 复制绝对路径
            </button>
          </div>
        </>
      )}
    </div>
  );
}
