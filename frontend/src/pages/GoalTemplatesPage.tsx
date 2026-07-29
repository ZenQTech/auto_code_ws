/**
 * # ============================================================
 * # GoalTemplatesPage - Goal 模板库独立访问页面
 * # ============================================================
 * # 核心作用：Cycle 14 P1-5 Goal Templates 模板库独立路由页面
 * #   复用 GoalTemplatesPanel 组件，提供独立访问入口
 * # 运行流程：
 * #   1. 渲染 GoalTemplatesPanel
 * #   2. 返回按钮回到主页
 * # 输入参数：无
 * # 输出结果：完整的模板库页面
 * # 修改记录：
 * #   - 2026-07-29 | v6.33.0 | Cycle 14 P1-5 初始版本
 * # ============================================================
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import GoalTemplatesPanel from '../components/GoalTemplatesPanel';

const GoalTemplatesPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/')}
            className="text-blue-600 hover:text-blue-800 hover:underline"
          >
            ← 返回主页
          </button>
        </div>
        <GoalTemplatesPanel />
      </div>
    </div>
  );
};

export default GoalTemplatesPage;
