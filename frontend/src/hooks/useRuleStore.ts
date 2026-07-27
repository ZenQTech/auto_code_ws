/**
 * # ============================================================
 * useRuleStore - TRACE 规则管理 Hook（Cycle 7 P0-11）
 * # ============================================================
 * 核心作用：管理前端 TRACE 规则状态，与后端 /api/trace/* 端点交互
 * 设计要点：
 *   1. 集中管理：activeRules + stats + 加载态
 *   2. 编译 API：natural language → CompiledRule
 *   3. CRUD: list / get / deactivate / delete / clear
 *   4. 预检查 API: preCheck
 * 输入参数：sessionId (optional)
 * 输出结果：{ rules, stats, loading, error, compileRule, preCheck, ... }
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P0-11 初始化
 * ============================================================
 */

import { useState, useCallback, useEffect, useRef } from 'react';

const API_BASE = '/api/trace';

// ============================================================
// Types
// ============================================================
export type RuleScope = 'session' | 'user' | 'global';
export type RuleTier = 1 | 2 | 3;
export type RuleType = 'pattern' | 'file_path' | 'code_style' | 'intent';

export interface CompiledRule {
  rule_id: string;
  session_id: string;
  scope: RuleScope;
  tier: RuleTier;
  rule_type: RuleType;
  rule_data: {
    check: string;
    subject: string;
    target: string;
    category: string;
    tier_rationale: string;
    action?: 'deny' | 'require' | 'prefer' | 'style_check';
  };
  original_message: string;
  source_message_id?: string | null;
  created_at: number;
  is_active: boolean;
  hit_count: number;
  violation_count: number;
  last_hit_at?: number | null;
  last_violation_at?: number | null;
  priority: number;
}

export interface CorrectionIntent {
  is_correction: boolean;
  category: string;
  target: string;
  subject: string;
  confidence: number;
  detected_keywords: string[];
}

export interface EnforcementResult {
  allowed: boolean;
  rule_id?: string | null;
  rule_subject?: string | null;
  reason?: string | null;
  suggestion?: string | null;
  tier?: RuleTier | null;
  action?: string | null;
  check_time_ms: number;
  warnings: string[];
}

export interface RuleStats {
  total_rules: number;
  active_rules: number;
  total_hits: number;
  total_violations: number;
  violation_rate: number;
  by_tier: Record<number, number>;
}

// ============================================================
// Hook
// ============================================================
export interface UseRuleStoreResult {
  // 状态
  rules: CompiledRule[];
  activeRules: CompiledRule[];
  stats: RuleStats | null;
  loading: boolean;
  error: string | null;
  // 操作
  refetch: () => Promise<void>;
  compileRule: (
    userMessage: string,
    options?: { scope?: RuleScope; autoAdd?: boolean },
  ) => Promise<{ success: boolean; intent: CorrectionIntent; rule: CompiledRule | null; message: string }>;
  preCheck: (toolName: string, toolArgs: Record<string, unknown>) => Promise<EnforcementResult>;
  deactivateRule: (ruleId: string) => Promise<boolean>;
  deleteRule: (ruleId: string) => Promise<boolean>;
  clearSession: () => Promise<number>;
  // 工具
  getRule: (ruleId: string) => Promise<CompiledRule | null>;
}

export function useRuleStore(sessionId: string = 'default'): UseRuleStoreResult {
  const [rules, setRules] = useState<CompiledRule[]>([]);
  const [stats, setStats] = useState<RuleStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // ============================================================
  // Refetch
  // ============================================================
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesResp, statsResp] = await Promise.all([
        fetch(`${API_BASE}/rules?session_id=${encodeURIComponent(sessionIdRef.current)}`).then(r => r.json()),
        fetch(`${API_BASE}/stats?session_id=${encodeURIComponent(sessionIdRef.current)}`).then(r => r.json()),
      ]);
      if (rulesResp.success) {
        setRules(rulesResp.rules || []);
      }
      if (statsResp.success) {
        setStats(statsResp.stats || null);
      }
    } catch (e: any) {
      setError(e.message || 'Refetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // ============================================================
  // 编译
  // ============================================================
  const compileRule = useCallback(
    async (
      userMessage: string,
      options: { scope?: RuleScope; autoAdd?: boolean } = {},
    ) => {
      const { scope = 'session', autoAdd = true } = options;
      try {
        const resp = await fetch(`${API_BASE}/compile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionIdRef.current,
            user_message: userMessage,
            scope,
            auto_add: autoAdd,
          }),
        }).then(r => r.json());

        if (resp.success) {
          // 重新拉取
          await refetch();
          return {
            success: true,
            intent: {
              is_correction: resp.intent.is_correction,
              category: resp.intent.category,
              target: resp.intent.target,
              subject: resp.intent.subject,
              confidence: resp.intent.confidence,
              detected_keywords: resp.intent.detected_keywords || [],
            },
            rule: resp.compiled_rule,
            message: resp.message,
          };
        }
        return {
          success: false,
          intent: {
            is_correction: false,
            category: 'general',
            target: 'general',
            subject: '',
            confidence: 0,
            detected_keywords: [],
          },
          rule: null,
          message: resp.message || 'Compile failed',
        };
      } catch (e: any) {
        return {
          success: false,
          intent: {
            is_correction: false,
            category: 'general',
            target: 'general',
            subject: '',
            confidence: 0,
            detected_keywords: [],
          },
          rule: null,
          message: e.message || 'Network error',
        };
      }
    },
    [refetch],
  );

  // ============================================================
  // 预检查
  // ============================================================
  const preCheck = useCallback(
    async (toolName: string, toolArgs: Record<string, unknown>): Promise<EnforcementResult> => {
      try {
        const resp = await fetch(`${API_BASE}/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionIdRef.current,
            tool_name: toolName,
            tool_args: toolArgs,
          }),
        }).then(r => r.json());
        return {
          allowed: resp.allowed,
          rule_id: resp.rule_id,
          rule_subject: resp.rule_subject,
          reason: resp.reason,
          suggestion: resp.suggestion,
          tier: resp.tier,
          action: resp.action,
          check_time_ms: resp.check_time_ms || 0,
          warnings: resp.warnings || [],
        };
      } catch (e: any) {
        return {
          allowed: true,
          check_time_ms: 0,
          warnings: [],
        };
      }
    },
    [],
  );

  // ============================================================
  // 停用
  // ============================================================
  const deactivateRule = useCallback(async (ruleId: string) => {
    try {
      const resp = await fetch(`${API_BASE}/rules/${ruleId}`, { method: 'DELETE' }).then(r => r.json());
      if (resp.success) {
        await refetch();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }, [refetch]);

  // ============================================================
  // 删除
  // ============================================================
  const deleteRule = useCallback(async (ruleId: string) => {
    try {
      const resp = await fetch(`${API_BASE}/rules/${ruleId}/hard`, { method: 'DELETE' }).then(r => r.json());
      if (resp.success) {
        await refetch();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }, [refetch]);

  // ============================================================
  // 清空
  // ============================================================
  const clearSession = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionIdRef.current }),
      }).then(r => r.json());
      if (resp.success) {
        await refetch();
        return resp.cleared || 0;
      }
      return 0;
    } catch (e) {
      return 0;
    }
  }, [refetch]);

  // ============================================================
  // 获取单条
  // ============================================================
  const getRule = useCallback(async (ruleId: string): Promise<CompiledRule | null> => {
    try {
      const resp = await fetch(`${API_BASE}/rules/${ruleId}`).then(r => r.json());
      if (resp.success) {
        return resp.rule;
      }
      return null;
    } catch (e) {
      return null;
    }
  }, []);

  // 派生: activeRules
  const activeRules = rules.filter(r => r.is_active);

  return {
    rules,
    activeRules,
    stats,
    loading,
    error,
    refetch,
    compileRule,
    preCheck,
    deactivateRule,
    deleteRule,
    clearSession,
    getRule,
  };
}

export default useRuleStore;
