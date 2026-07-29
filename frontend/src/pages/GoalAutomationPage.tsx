/**
 * # ============================================================
 * # GoalAutomationPage - Goal 自动轮转 + 多 Agent 委派独立页面
 * # ============================================================
 * # 核心作用：在独立路由 /goal-automation 展示 Goal Automation 完整能力
 * #   - Auto-Turn 标签：注册/暂停/触发轮转 + 历史查看
 * #   - Agents 标签：注册 Agent + 状态管理 + 负载分布
 * #   - Delegations 标签：委派任务 + 完成回调 + 历史审计
 * # 运行流程：
 * #   1. 用户访问 /goal-automation 路由 → 渲染独立页面容器
 * #   2. 复用 GoalAutomationPanel 组件，无需内嵌在主布局中
 * #   3. 全屏背景采用渐变色以区分主对话区
 * # 输入参数：无
 * # 输出结果：完整的 Goal Automation 操作页面
 * # 修改记录：
 * #   - 2026-07-28 | v1.0.0 | Cycle 14 P1-4 新建
 * # ============================================================
 */

import React from 'react';
import GoalAutomationPanel from '../components/GoalAutomationPanel';

export const GoalAutomationPage: React.FC = () => {
  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-blue-50 via-violet-50 to-pink-50">
      <div className="flex-1 p-4 overflow-hidden">
        <div className="h-full max-w-7xl mx-auto">
          <GoalAutomationPanel />
        </div>
      </div>
    </div>
  );
};

export default GoalAutomationPage;
