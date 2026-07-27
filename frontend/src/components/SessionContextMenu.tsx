/**
 * # ============================================================
 * 会话右键菜单组件（含 Fork / Resume / Lineage 选项）
 * # ============================================================
 * 核心作用：会话列表中的右键操作菜单
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useState, useRef, useEffect } from 'react';
import { forkSession, getSessionLineage, archiveSession } from '../hooks/useCycle2Api';

export interface SessionContextMenuProps {
  sessionId: string;
  sessionTitle: string;
  onAction?: (action: string, data?: any) => void;
}

export const SessionContextMenu: React.FC<SessionContextMenuProps> = ({
  sessionId,
  sessionTitle,
  onAction,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [lineage, setLineage] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
    setOpen(true);
  };

  const handleFork = async () => {
    setOpen(false);
    setLoading(true);
    try {
      const newTitle = `${sessionTitle} (分叉)`;
      const result = await forkSession(sessionId, newTitle);
      onAction?.('fork', result);
    } catch (e: any) {
      console.error('Fork 失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleShowLineage = async () => {
    setOpen(false);
    setLoading(true);
    try {
      const data = await getSessionLineage(sessionId);
      setLineage(data);
      onAction?.('lineage', data);
    } catch (e: any) {
      console.error('获取 lineage 失败:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async () => {
    setOpen(false);
    try {
      await archiveSession(sessionId);
      onAction?.('archive');
    } catch (e: any) {
      console.error('归档失败:', e);
    }
  };

  return (
    <div onContextMenu={handleContextMenu} className="select-none">
      {loading && <span className="text-xs text-gray-400">...</span>}
      {open && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-white border rounded-lg shadow-lg py-1 min-w-[180px]"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button
            onClick={handleFork}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
          >
            <span>🔀</span>
            <span>Fork 会话</span>
          </button>
          <button
            onClick={handleShowLineage}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
          >
            <span>🌳</span>
            <span>查看血缘</span>
          </button>
          <button
            onClick={handleArchive}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 flex items-center gap-2"
          >
            <span>📦</span>
            <span>归档</span>
          </button>
        </div>
      )}
      {lineage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setLineage(null)}>
          <div className="bg-white rounded-lg p-4 max-w-md max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-2">会话血缘</h3>
            <div className="text-xs space-y-1">
              <div>会话 ID: {lineage.session_id}</div>
              <div>根 ID: {lineage.root_id}</div>
              <div>祖先: {lineage.ancestor_count}</div>
              <div>后代: {lineage.descendant_count}</div>
              {lineage.ancestors.length > 0 && (
                <div className="mt-2">
                  <div className="font-medium">祖先链:</div>
                  {lineage.ancestors.map((a: any) => (
                    <div key={a.id} className="text-gray-600 ml-2">↑ {a.title}</div>
                  ))}
                </div>
              )}
              {lineage.descendants.length > 0 && (
                <div className="mt-2">
                  <div className="font-medium">后代列表:</div>
                  {lineage.descendants.map((d: any) => (
                    <div key={d.id} className="text-gray-600 ml-2">↓ {d.title}</div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setLineage(null)}
              className="mt-3 w-full px-3 py-1.5 bg-gray-100 rounded text-sm"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SessionContextMenu;
