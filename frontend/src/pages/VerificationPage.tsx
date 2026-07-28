/**
 * # ============================================================
 * VerificationPage - Verification Loop 独立访问页面 (v1.0.0 - Cycle 10 P1-10)
 * # ============================================================
 * 核心作用：独立路由 /verification 全屏显示 VerificationPanel
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import { useNavigate } from 'react-router-dom';
import VerificationPanel from '../components/VerificationPanel';

const VerificationPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="p-3 bg-white border-b border-gray-200 flex items-center gap-3">
        <button
          onClick={() => navigate('/')}
          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          ← 返回主页
        </button>
        <h1 className="text-base font-semibold text-gray-700">
          🔁 Verification Loop
        </h1>
        <span className="text-xs text-gray-500">
          多维度验证 · 自动修复 · 性能基线 · Webhook 触发
        </span>
      </div>
      <div className="flex-1 overflow-hidden p-4">
        <VerificationPanel standalone />
      </div>
    </div>
  );
};

export default VerificationPage;
