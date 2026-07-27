/**
 * # ============================================================
 * # 极简顶部品牌栏组件 - BrandHeader
 * # ============================================================
 * # 核心作用：替代原 App.tsx 顶部复杂布局，遵循豆包式极简风格，
 * #           把次要操作（设置 / 回收站 / 用量）移到三个点下拉菜单，
 * #           顶部只保留 Logo + Session 标题 + 新建对话按钮。
 * # 运行流程：
 * #   1. 左侧：Logo（圆形渐变背景 + 闪电图标，Hermes 主色调）
 * #   2. 中间：Session 标题（仅 md+ 显示，移动端隐藏）
 * #   3. 右侧：新建对话按钮（圆形，hover 旋转 90°）+ 三个点下拉菜单
 * #   4. 点击外部区域关闭下拉菜单（通过 useEffect 绑定 document mousedown）
 * #   5. 菜单项点击后触发对应 onOpen* 回调，同时关闭菜单
 * # 输入参数：
 * #   - sessionTitle: 当前 Session 标题（中间显示）
 * #   - onNewChat: 新建对话回调
 * #   - onOpenSettings?: 打开设置面板回调（可选）
 * #   - onOpenTrash?: 打开回收站回调（可选）
 * #   - onOpenUsage?: 打开/切换用量监控回调（可选）
 * # 输出结果：56px 高极简顶部品牌栏（sticky 吸顶 + 半透明背景 + 底部细边）
 * # 复用说明：
 * #   - 无复用（全新组件）
 * #   - lucide-react 未安装，下拉菜单图标使用 inline SVG
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：极简顶部 + 半透明背景 + 下拉菜单（豆包风格）
 * #   - 2026-06-24 | v1.1.0 | 新增 appMode prop + 模式指示器 pill（聊天 / 编程双模式标识）
 * #   - 2026-06-24 | v1.1.0 | 下拉菜单新增"文件浏览器"切换项（控制 fileExplorerOpen state）
 * #   - 2026-06-24 | v1.2.0 | 渲染模式切换 pill（解决 BrandHeader appMode prop 未渲染问题）
 * #   - 2026-06-24 | v1.3.0 | 删除模式切换 pill（信息密度过高；保留 Sidebar/ProjectSelector 入口）
 * #   - 2026-07-24 | v1.4.0 | 新增 onOpenLoopV7 回调 + 菜单项"Loop v7 工作流"，提供端到端 15 步工作流启动入口
#   - 2026-07-24 | v1.5.0 | 新增 newChatLoading 可选 prop：新建对话按钮显示加载态
#     防止快速重复点击触发多次 handleNewTask，避免并发创建多个空 Session
#   - 2026-07-27 | v1.6.0 | Cycle 2 新增：菜单项 MCP 工具 / 会话压缩 / 技能管理 / AGENTS.md 记忆
#     提供 onOpenMCP / onOpenCompaction / onOpenSkills / onOpenAgentsMd 回调
#   - 2026-07-27 | v1.7.0 | Cycle 3 新增：菜单项 MCP 高级功能 / 双触发压缩 / 多类型规则扫描
#     新增 onOpenCycle3 / onOpenDualCompaction / onOpenRules 回调
#     新增 shield (盾牌) + cpu (CPU) 内联 SVG 图标
#     新增"Cycle 3 新功能"分组（带顶部分割线）
#   - 2026-07-27 | v2.8.0 | Cycle 7 P0-10 新增：菜单项 Multi-Agent v2 Path Tree
#     新增 onOpenMultiAgentTree 回调 + tree（树状）图标
#     对应 Codex v0.121+ path-based addressing + TRAE "对话流节点自动折叠"
# ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * BrandHeader 组件 Props
 */
export interface BrandHeaderProps {
  /** 当前 Session 标题，用于中间区域展示 */
  sessionTitle: string;
  /** 新建对话按钮点击回调 */
  onNewChat: () => void;
  /** v1.5.0 新增：新建对话按钮是否处于加载态（true 时禁用按钮 + 显示旋转图标） */
  newChatLoading?: boolean;
  /** 打开设置面板回调（可选，提供则菜单显示"设置"项） */
  onOpenSettings?: () => void;
  /** 打开回收站回调（可选，提供则菜单显示"回收站"项） */
  onOpenTrash?: () => void;
  /** 打开/切换用量监控回调（可选，提供则菜单显示"用量监控"项） */
  onOpenUsage?: () => void;
  /** v1.1.0 新增：切换文件浏览器显示/隐藏回调（可选，提供则菜单显示"文件浏览器"项） */
  onOpenFileExplorer?: () => void;
  /** v1.1.0 新增：当前文件浏览器显示状态（用于菜单项右侧状态指示） */
  fileExplorerOpen?: boolean;
  /** v1.4.0 新增：打开 Loop v7 工作流弹窗回调（可选，提供则菜单显示"Loop v7 工作流"项） */
  onOpenLoopV7?: () => void;
  /** v1.6.0 新增：打开 MCP 工具面板回调（可选，提供则菜单显示"MCP 工具"项） */
  onOpenMCP?: () => void;
  /** v1.6.0 新增：打开会话压缩面板回调（可选，提供则菜单显示"会话压缩"项） */
  onOpenCompaction?: () => void;
  /** v1.6.0 新增：打开技能管理面板回调（可选，提供则菜单显示"技能管理"项） */
  onOpenSkills?: () => void;
  /** v1.6.0 新增：打开 AGENTS.md 记忆管理回调（可选，提供则菜单显示"AGENTS.md 记忆"项） */
  onOpenAgentsMd?: () => void;
  /** Cycle 3 v1.0.0 新增：打开 Cycle 3 MCP 高级功能面板回调（可选） */
  onOpenCycle3?: () => void;
  /** Cycle 3 v1.0.0 新增：打开双触发压缩面板回调（可选） */
  onOpenDualCompaction?: () => void;
  /** Cycle 3 v1.0.0 新增：打开多类型规则扫描面板回调（可选） */
  onOpenRules?: () => void;
  /** v2.0.0 (Cycle 4 P0-3) 新增：打开 Plan 编辑器面板回调（可选） */
  onOpenPlanEditor?: () => void;
  /** v2.1.0 (Cycle 4 P0-4) 新增：打开 Hooks 事件系统面板回调（可选） */
  onOpenHooks?: () => void;
  /** v2.2.0 (Cycle 4 P0-4) 新增：打开 SubAgent 记忆查看器回调（可选） */
  onOpenSubagentMemory?: () => void;
  /** v2.3.0 (Cycle 5 P0-6) 新增：打开 Hook 触发链路查看器回调（可选） */
  onOpenHookChain?: () => void;
  /** v2.4.0 (Cycle 6 P0-7-A) 新增：打开 LLM 缓存统计面板回调（可选） */
  onOpenCacheStats?: () => void;
  /** v2.5.0 (Cycle 6 P0-7-B) 新增：打开流式恢复网关面板回调（可选） */
  onOpenStreamList?: () => void;
  /** v2.6.0 (Cycle 7 P0-8) 新增：打开 OAuth 2.1 + PKCE 配置面板回调（可选） */
  onOpenOAuthConfig?: () => void;
  /** v2.7.0 (Cycle 7 P0-9) 新增：打开 Session Rollout JSONL 持久化面板回调（可选） */
  onOpenSessionRollout?: () => void;
  /** v2.8.0 (Cycle 7 P0-10) 新增：打开 Multi-Agent v2 Path Tree 面板回调（可选） */
  onOpenMultiAgentTree?: () => void;
  /** v2.9.0 (Cycle 7 P0-11) 新增：打开 TRACE 规则管理面板回调（可选） */
  onOpenTraceRule?: () => void;
}

/**
 * 内联 SVG 图标渲染器
 * 参数：
 *   - name: 图标键
 *   - className: 尺寸/颜色类名
 * 返回值：JSX 元素
 */
function Icon({ name, className = 'w-5 h-5' }: { name: 'zap' | 'plus' | 'more' | 'chart' | 'settings' | 'trash' | 'folder' | 'rocket' | 'plug' | 'compress' | 'sparkles' | 'book' | 'shield' | 'cpu' | 'plan' | 'hook' | 'brain' | 'chain' | 'cache' | 'stream' | 'oauth' | 'rollout' | 'tree' | 'shield-check'; className?: string }) {
  switch (name) {
    case 'zap':
      // 闪电 - Logo 内图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case 'plus':
      // 加号 - 新建对话
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'more':
      // 三个水平点 - 下拉菜单触发器
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      );
    case 'chart':
      // 柱状图 - 用量监控
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 3v18h18" />
          <path d="M7 16V10" />
          <path d="M11 16V6" />
          <path d="M15 16v-4" />
          <path d="M19 16v-8" />
        </svg>
      );
    case 'settings':
      // 齿轮 - 设置
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'trash':
      // 垃圾桶 - 回收站
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'folder':
      // v1.1.0 新增：FolderTree - 文件浏览器（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          <path d="M3 7h18M9 12h6M9 16h6" />
        </svg>
      );
    case 'rocket':
      // v1.4.0 新增：火箭 - Loop v7 端到端工作流（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      );
    case 'plug':
      // v1.6.0 新增：插头 - MCP 工具（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22v-5" />
          <path d="M9 7V2" />
          <path d="M15 7V2" />
          <path d="M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
        </svg>
      );
    case 'compress':
      // v1.6.0 新增：压缩 - 会话压缩（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4 9l4-4M4 9h6V3" />
          <path d="M20 15l-4 4m4-4h-6v6" />
        </svg>
      );
    case 'sparkles':
      // v1.6.0 新增：闪光 - 技能管理（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
        </svg>
      );
    case 'book':
      // v1.6.0 新增：书 - AGENTS.md 记忆（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'shield':
      // Cycle 3 v1.0.0 新增：盾牌 - MCP 高级功能（权限/审批/审计）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'cpu':
      // Cycle 3 v1.0.0 新增：CPU - 双触发压缩 / 规则扫描（技术感）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        </svg>
      );
    case 'plan':
      // v2.0.0 (Cycle 4 P0-3) 新增：Plan - 计划编辑（清单+复选框感）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <path d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'hook':
      // v2.1.0 (Cycle 4 P0-4) 新增：Hook - 钩子事件（U 形弯钩）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 9V4a2 2 0 00-2-2h-3a2 2 0 00-2 2v15a6 6 0 006 6 6 6 0 006-6V11a2 2 0 00-2-2h-1" />
          <circle cx="15" cy="6" r="2" />
        </svg>
      );
    case 'chain':
      // v2.3.0 (Cycle 5 P0-6) 新增：Chain - 触发链路（链条节点）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'stream':
      // v2.5.0 (Cycle 6 P0-7-B) 新增：Stream - 流式恢复网关（波浪线+断点）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
          <path d="M2 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
          <circle cx="20" cy="6" r="2" fill="currentColor" />
        </svg>
      );
    case 'oauth':
      // v2.6.0 (Cycle 7 P0-8) 新增：OAuth 2.1 + PKCE（锁+钥匙）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 1 1 8 0v4" />
          <circle cx="12" cy="16" r="1.5" fill="currentColor" />
          <path d="M12 17.5v2.5" />
        </svg>
      );
    case 'rollout':
      // v2.7.0 (Cycle 7 P0-9) 新增：Session Rollout JSONL（卷轴+播放）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="16" x2="13" y2="16" />
          <path d="M16 18l2-1.5L16 15" />
        </svg>
      );
    case 'tree':
      // v2.8.0 (Cycle 7 P0-10) 新增：Multi-Agent v2 Path Tree（树状层级）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M5 3v18" />
          <path d="M5 7h6" />
          <path d="M5 12h8" />
          <path d="M5 17h10" />
          <circle cx="5" cy="3" r="1.5" fill="currentColor" />
          <circle cx="11" cy="7" r="1.5" fill="currentColor" />
          <circle cx="13" cy="12" r="1.5" fill="currentColor" />
          <circle cx="15" cy="17" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'shield-check':
      // v2.9.0 (Cycle 7 P0-11) 新增：TRACE 规则管理（盾牌+勾, 表达 enforcement）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * 极简顶部品牌栏组件
 * - 高度 56px（h-14），sticky 吸顶，半透明背景 + 底部细边
 * - Logo + Session 标题 + 新建按钮 + 三个点菜单
 * - 移动端（< 768px）隐藏中间标题
 */
export default function BrandHeader({
  sessionTitle,
  onNewChat,
  newChatLoading = false,
  onOpenSettings,
  onOpenTrash,
  onOpenUsage,
  onOpenFileExplorer,
  fileExplorerOpen,
  onOpenLoopV7,
  onOpenMCP,
  onOpenCompaction,
  onOpenSkills,
  onOpenAgentsMd,
  onOpenCycle3,
  onOpenDualCompaction,
  onOpenRules,
  /** v2.0.0 (Cycle 4 P0-3) 新增 */
  onOpenPlanEditor,
  /** v2.1.0 (Cycle 4 P0-4) 新增 */
  onOpenHooks,
  /** v2.2.0 (Cycle 4 P0-4) 新增 */
  onOpenSubagentMemory,
  /** v2.3.0 (Cycle 5 P0-6) 新增 */
  onOpenHookChain,
  /** v2.4.0 (Cycle 6 P0-7-A) 新增 */
  onOpenCacheStats,
  /** v2.5.0 (Cycle 6 P0-7-B) 新增 */
  onOpenStreamList,
  /** v2.6.0 (Cycle 7 P0-8) 新增 */
  onOpenOAuthConfig,
  /** v2.7.0 (Cycle 7 P0-9) 新增 */
  onOpenSessionRollout,
  /** v2.8.0 (Cycle 7 P0-10) 新增 */
  onOpenMultiAgentTree,
  /** v2.9.0 (Cycle 7 P0-11) 新增 */
  onOpenTraceRule,
}: BrandHeaderProps) {
  /** 下拉菜单开关状态 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 下拉菜单容器 ref（用于检测外部点击） */
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * 点击下拉菜单外部区域时自动关闭菜单
   * 绑定时机：menuOpen 为 true 时绑定；为 false 时解绑
   */
  useEffect(() => {
    if (!menuOpen) return;
    /**
     * 外部点击检测
     * 步骤：判断点击目标是否在 menuRef 容器内；不在则关闭菜单
     */
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  /**
   * 触发菜单项的通用回调包装
   * 步骤：调用外部回调 → 关闭菜单
   * 参数：
   *   - cb?: 外部回调（可能未提供）
   * 返回值：包装后的事件处理函数
   */
  const wrapMenuItem = useCallback((cb?: () => void) => () => {
    if (cb) cb();
    setMenuOpen(false);
  }, []);

  return (
    <header
      // sticky 吸顶 + 半透明背景 + backdrop-blur（玻璃质感）+ 底部 1px 边
      className="sticky top-0 z-40 h-14 bg-white/80 backdrop-blur-md border-b border-surface-200/60
                 flex items-center justify-between px-4"
    >
      {/* 左侧：Logo（圆形渐变 + 闪电图标） */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-hermes-400 to-hermes-600 flex items-center justify-center shadow-glow-hermes">
          <Icon name="zap" className="w-5 h-5 text-white" />
        </div>
        {/* 品牌名（仅 md+ 显示，移动端隐藏） */}
        <span className="hidden md:inline text-lg font-medium text-surface-900">Hermes</span>
      </div>

      {/* 中间：v1.3.0 仅显示 Session 标题（仅 md+ 显示）；模式切换入口已移至 Sidebar/ProjectSelector */}
      <h2 className="hidden md:block text-body font-medium text-surface-700 truncate max-w-md">
        {sessionTitle}
      </h2>

      {/* 右侧：新建对话按钮 + 三个点下拉菜单 */}
      <div className="flex items-center gap-2">
        {/* 新建对话按钮：圆形，hover 时旋转 90° */}
        {/* v1.5.0：newChatLoading=true 时禁用按钮 + 显示旋转加载图标 + 灰化样式 */}
        <button
          onClick={onNewChat}
          disabled={newChatLoading}
          title={newChatLoading ? '创建中...' : '新建对话'}
          aria-label={newChatLoading ? '创建中...' : '新建对话'}
          aria-busy={newChatLoading}
          className={`w-9 h-9 rounded-full flex items-center justify-center shadow-glow-hermes-sm
                      transition-all duration-default ease-spring
                      ${newChatLoading
                        ? 'bg-surface-200 text-surface-500 cursor-not-allowed'
                        : 'bg-hermes-50 hover:bg-hermes-100 text-hermes-600 hover:rotate-90'
                      }`}
        >
          {newChatLoading ? (
            // 加载中：旋转的 spinner
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <Icon name="plus" className="w-5 h-5" />
          )}
        </button>

        {/* 三个点下拉菜单 */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-9 h-9 rounded-full hover:bg-surface-100 text-surface-600
                       flex items-center justify-center transition-colors duration-fast"
          >
            <Icon name="more" className="w-5 h-5" />
          </button>

          {/* 下拉菜单面板：仅在 menuOpen 时渲染 */}
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl
                         shadow-level-3 border border-surface-200 py-1
                         animate-lift-in z-50"
            >
              {/* v1.1.0 新增：文件浏览器（菜单首位，FolderTree 图标）
               *  行为：点击调 onOpenFileExplorer() 切换父组件 state + 关闭菜单
               *  状态指示：fileExplorerOpen=true 时右侧显示绿色实心圆 ●
               *           fileExplorerOpen=false 时显示灰色空心圆 ○
               *  父组件 App.tsx 仅在 appMode === 'coding' && selectedProject 时
               *  才透传 onOpenFileExplorer 回调，其他场景下本项不渲染 */}
              {onOpenFileExplorer && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenFileExplorer)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center justify-between
                             transition-colors duration-fast"
                >
                  <span className="flex items-center gap-2">
                    <Icon name="folder" className="w-4 h-4" />
                    <span>文件浏览器</span>
                  </span>
                  {/* 状态指示：●（已展开，hermes-500 实心） / ○（已折叠，surface-400 空心） */}
                  {fileExplorerOpen ? (
                    <span className="text-hermes-500 text-xs">●</span>
                  ) : (
                    <span className="text-surface-400 text-xs">○</span>
                  )}
                </button>
              )}

              {/* v1.4.0 新增：Loop v7 工作流（菜单项）
               *  行为：点击调 onOpenLoopV7() 弹出 LoopV7Runner 端到端运行器
               *  图标：火箭（rocket），强调端到端自动化全流程
               *  父组件 App.tsx 透传回调以激活本项 */}
              {onOpenLoopV7 && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenLoopV7)}
                  className="w-full px-4 py-2 text-left text-sm text-hermes-700
                             hover:bg-hermes-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="rocket" className="w-4 h-4" />
                  <span>🚀 Loop v7 工作流</span>
                </button>
              )}

              {/* v1.6.0 新增：分组标题 - Cycle 2 高级功能 */}
              {(onOpenMCP || onOpenCompaction || onOpenSkills || onOpenAgentsMd) && (
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-surface-400 font-medium">
                  高级功能
                </div>
              )}

              {/* v1.6.0 新增：MCP 工具（菜单项）
               *  行为：点击调 onOpenMCP() 弹出 McpPanel 工具调用面板
               *  图标：插头（plug），强调外部工具集成 */}
              {onOpenMCP && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMCP)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="plug" className="w-4 h-4" />
                  <span>🔌 MCP 工具</span>
                </button>
              )}

              {/* v1.6.0 新增：会话压缩（菜单项）
               *  行为：点击调 onOpenCompaction() 弹出 CompactionIndicator
               *  图标：压缩（compress），强调长会话上下文管理 */}
              {onOpenCompaction && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCompaction)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="compress" className="w-4 h-4" />
                  <span>🗜️ 会话压缩</span>
                </button>
              )}

              {/* v1.6.0 新增：技能管理（菜单项）
               *  行为：点击调 onOpenSkills() 弹出 Skills 管理面板
               *  图标：闪光（sparkles），强调 Skills 插件系统 */}
              {onOpenSkills && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSkills)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="sparkles" className="w-4 h-4" />
                  <span>✨ 技能管理</span>
                </button>
              )}

              {/* v1.6.0 新增：AGENTS.md 记忆（菜单项）
               *  行为：点击调 onOpenAgentsMd() 弹出 AGENTS.md 记忆管理
               *  图标：书（book），强调项目级规则持久化 */}
              {onOpenAgentsMd && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentsMd)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="book" className="w-4 h-4" />
                  <span>📚 AGENTS.md 记忆</span>
                </button>
              )}

              {/* Cycle 3 v1.0.0 新增：分组标题 - Cycle 3 高级功能 */}
              {(onOpenCycle3 || onOpenDualCompaction || onOpenRules) && (
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-surface-400 font-medium border-t border-surface-100 mt-1">
                  Cycle 3 新功能
                </div>
              )}

              {/* Cycle 3 v1.0.0 新增：MCP 高级功能（菜单项）
               *  行为：点击调 onOpenCycle3() 弹出 Cycle3Panel 权限/服务器/审批/审计面板
               *  图标：盾牌（shield），强调权限保护与安全控制 */}
              {onOpenCycle3 && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCycle3)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="shield" className="w-4 h-4 text-indigo-500" />
                  <span>🛡️ MCP 高级功能</span>
                </button>
              )}

              {/* Cycle 3 v1.0.0 新增：双触发压缩（菜单项）
               *  行为：点击调 onOpenDualCompaction() 弹出 DualCompactionPanel
               *  图标：CPU（cpu），强调双触发机制与计算密集 */}
              {onOpenDualCompaction && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDualCompaction)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cpu" className="w-4 h-4 text-amber-500" />
                  <span>⚡ 双触发压缩</span>
                </button>
              )}

              {/* Cycle 3 v1.0.0 新增：多类型规则扫描（菜单项）
               *  行为：点击调 onOpenRules() 弹出 RulesPanel 多文件类型扫描面板
               *  图标：CPU（cpu），强调多文件类型 + 4 层架构 */}
              {onOpenRules && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenRules)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-teal-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cpu" className="w-4 h-4 text-teal-500" />
                  <span>📜 多类型规则扫描</span>
                </button>
              )}

              {/* v2.0.0 (Cycle 4 P0-3) 新增：分组标题 - Cycle 4 计划模式 */}
              {onOpenPlanEditor && (
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-surface-400 font-medium border-t border-surface-100 mt-1">
                  Cycle 4 新功能
                </div>
              )}

              {/* v2.0.0 (Cycle 4 P0-3) 新增：Plan 编辑器（菜单项）
               *  行为：点击调 onOpenPlanEditor() 弹出 PlanEditorModal
               *       Plan → Execute → Rollback 完整链路
               *  图标：plan（清单+复选框），强调计划编辑+风险点+回滚 */}
              {onOpenPlanEditor && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenPlanEditor)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-purple-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="plan" className="w-4 h-4 text-purple-500" />
                  <span>📋 Plan 编辑器</span>
                </button>
              )}

              {/* v2.1.0 (Cycle 4 P0-4) 新增：Hooks 事件系统（菜单项）
               *  行为：点击调 onOpenHooks() 弹出 HooksPanel
               *       仿照 Codex v0.150+ Hooks 规范设计（10 类事件）
               *  图标：hook（U 形弯钩），强调事件触发+执行+审计 */}
              {onOpenHooks && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHooks)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="hook" className="w-4 h-4 text-cyan-500" />
                  <span>🪝 Hooks 事件系统</span>
                </button>
              )}

              {/* v2.2.0 (Cycle 4 P0-4) 新增：SubAgent 记忆（菜单项）
               *  行为：点击调 onOpenSubagentMemory() 弹出 SubAgentMemoryViewer
               *       对应 TRAE Sub Agent 三大组件中的"独立工作区"
               *  图标：brain（脑），强调独立 context + 父→子记忆继承 */}
              {onOpenSubagentMemory && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSubagentMemory)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-pink-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="brain" className="w-4 h-4 text-pink-500" />
                  <span>🧠 SubAgent 记忆</span>
                </button>
              )}

              {/* v2.3.0 (Cycle 5 P0-6) 新增：Hook 触发链路 */}
              {onOpenHookChain && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHookChain)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="chain" className="w-4 h-4 text-cyan-500" />
                  <span>🔗 Hook 触发链路</span>
                </button>
              )}

              {/* v2.4.0 (Cycle 6 P0-7-A) 新增：LLM 缓存统计 */}
              {onOpenCacheStats && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCacheStats)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cache" className="w-4 h-4 text-emerald-500" />
                  <span>⚡ LLM 缓存统计</span>
                </button>
              )}

              {/* v2.5.0 (Cycle 6 P0-7-B) 新增：流式恢复网关 */}
              {onOpenStreamList && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenStreamList)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="stream" className="w-4 h-4 text-blue-500" />
                  <span>🌊 流式恢复网关</span>
                </button>
              )}

              {/* v2.6.0 (Cycle 7 P0-8) 新增：OAuth 2.1 + PKCE（菜单项）
               *  行为：点击调 onOpenOAuthConfig() 弹出 OAuthConfigModal
               *       符合 MCP Authorization Spec 2026-06-18 强制规范
               *  图标：oauth（锁+钥匙），强调授权 + 安全 */}
              {onOpenOAuthConfig && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenOAuthConfig)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="oauth" className="w-4 h-4 text-indigo-500" />
                  <span>🔐 OAuth 2.1 + PKCE</span>
                </button>
              )}

              {/* v2.7.0 (Cycle 7 P0-9) 新增：Session Rollout JSONL（菜单项）
               *  行为：点击调 onOpenSessionRollout() 弹出 SessionRolloutPanel
               *       实现 Codex v0.136+ thread/fork JSONL 持久化格式
               *  图标：rollout（卷轴+播放），强调持久化 + 历史回放 */}
              {onOpenSessionRollout && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSessionRollout)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="rollout" className="w-4 h-4 text-blue-500" />
                  <span>📜 Session Rollout JSONL</span>
                </button>
              )}

              {/* v2.8.0 (Cycle 7 P0-10) 新增：Multi-Agent v2 Path Tree（菜单项）
               *  行为：点击调 onOpenMultiAgentTree() 弹出 MultiAgentTreePanel
               *       实现 Codex v0.121+ path-based addressing 多智能体编排
               *  图标：tree（树状层级），强调 path-based addressing + spawn/wait/close */}
              {onOpenMultiAgentTree && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMultiAgentTree)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="tree" className="w-4 h-4 text-emerald-500" />
                  <span>🌳 Multi-Agent v2 Path Tree</span>
                </button>
              )}

              {/* v2.9.0 (Cycle 7 P0-11) 新增：TRACE 规则管理（菜单项）
               *  行为：点击调 onOpenTraceRule() 弹出 RulePanel 规则管理面板
               *       实现 Zhou et al. June 2026 论文：用户纠正编译为运行时强制规则
               *  图标：shield-check（盾牌+勾），表达 enforcement + compliance */}
              {onOpenTraceRule && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTraceRule)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-rose-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="shield-check" className="w-4 h-4 text-rose-500" />
                  <span>🛡️ TRACE 规则管理</span>
                </button>
              )}

              {/* 用量监控 */}
              {onOpenUsage && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenUsage)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="chart" className="w-4 h-4" />
                  <span>用量监控</span>
                </button>
              )}

              {/* 设置 */}
              {onOpenSettings && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSettings)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="settings" className="w-4 h-4" />
                  <span>设置</span>
                </button>
              )}

              {/* 回收站 */}
              {onOpenTrash && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTrash)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="trash" className="w-4 h-4" />
                  <span>回收站</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
