/**
 * # ============================================================
 * MemoryPage - Memory System 独立访问页面 (v1.0.1 - Cycle 10 P1-8)
 * # ============================================================
 * 核心作用：独立路由 /memory 全屏显示 MemoryPanel
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * 修改记录：
 *   - 2026-08-03 | v1.0.1 | G60-FIX-16 修复主题感知：bg-white 替换为 var(--bg-panel)
 * ====================================
 */

import { useNavigate } from 'react-router-dom';
import MemoryPanel from '../components/MemoryPanel';

const MemoryPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="h-screen flex flex-col bg-[var(--bg-app)]">
      <div className="p-3 bg-[var(--bg-panel)] border-b border-[var(--border-color)] flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1.5 text-sm bg-surface-100 text-[var(--text-primary)] rounded hover:bg-surface-200"
        >
          ← 返回主页
        </button>
        <h1 className="text-base font-semibold text-[var(--text-primary)]">
          🧠 Memory System
        </h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <MemoryPanel standalone />
      </div>
    </div>
  );
};

export default MemoryPage;
