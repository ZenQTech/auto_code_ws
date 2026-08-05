/**
 * # ============================================================
 * # useApplyPatch Hook (v1.0.0)
 * # Cycle 68 G68-02
 * # ====================================
 * # 核心作用：封装 ApplyPatch V4A REST API
 * # 功能：
 * #   1. validate：解析 patch 并收集 file_hashes
 * #   2. preview：生成 unified diff 预览
 * #   3. apply：事务性应用 patch
 * #   4. 状态管理：loading / error / result
 * # 输入参数：baseUrl
 * # 输出结果：UseApplyPatchResult
 * # 对标：Codex codex-rs/apply_patch
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 68 G68-02 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface PatchOp {
  type: 'update' | 'add' | 'delete';
  file: string;
  hunks?: number;
  content_length?: number;
  expected_hash?: string;
}

export interface ValidateResult {
  valid: boolean;
  ops_count: number;
  files: string[];
  file_hashes: Record<string, string>;
  error: string;
  error_line: number;
  ops: PatchOp[];
}

export interface FileDiff {
  file: string;
  type: string;
  before_hash: string;
  after_hash: string;
  diff: string;
}

export interface Conflict {
  file: string;
  expected_hash: string;
  actual_hash: string;
  op_type: string;
  reason: string;
}

export interface PreviewResult {
  safe: boolean;
  ops_count: number;
  diffs: FileDiff[];
  conflicts: Conflict[];
  error: string;
}

export interface ApplyResult {
  success: boolean;
  snapshot_id: string | null;
  applied_ops: number;
  duration_ms: number;
  error: string;
  failed_op: Record<string, any> | null;
  rolled_back: boolean;
  diffs: FileDiff[];
}

export interface UseApplyPatchResult {
  // Validate
  validate: (patchText: string, root: string) => Promise<ValidateResult>;
  lastValidate: ValidateResult | null;
  validating: boolean;

  // Preview
  preview: (patchText: string, root: string) => Promise<PreviewResult>;
  lastPreview: PreviewResult | null;
  previewing: boolean;

  // Apply
  apply: (
    patchText: string,
    root: string,
    options?: { force?: boolean; createSnapshot?: boolean; sessionId?: string },
  ) => Promise<ApplyResult>;
  lastApply: ApplyResult | null;
  applying: boolean;

  // Error
  error: string | null;
  reset: () => void;
}

// ============================================================
// Hook
// ============================================================

export function useApplyPatch(baseUrl: string = ''): UseApplyPatchResult {
  const [lastValidate, setLastValidate] = useState<ValidateResult | null>(null);
  const [validating, setValidating] = useState(false);

  const [lastPreview, setLastPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [lastApply, setLastApply] = useState<ApplyResult | null>(null);
  const [applying, setApplying] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const apiUrl = useCallback(
    (path: string): string => {
      const base = baseUrl || '';
      return `${base}/api/apply-patch${path}`;
    },
    [baseUrl],
  );

  // ============================================================
  // Validate
  // ============================================================

  const validate = useCallback(
    async (patchText: string, root: string): Promise<ValidateResult> => {
      setValidating(true);
      setError(null);
      try {
        const resp = await fetch(apiUrl('/validate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch_text: patchText, root }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        }
        const result: ValidateResult = {
          valid: data.valid || false,
          ops_count: data.ops_count || 0,
          files: data.files || [],
          file_hashes: data.file_hashes || {},
          error: data.error || '',
          error_line: data.error_line || 0,
          ops: data.ops || [],
        };
        if (isMounted.current) {
          setLastValidate(result);
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isMounted.current) {
          setError(msg);
        }
        throw e;
      } finally {
        if (isMounted.current) {
          setValidating(false);
        }
      }
    },
    [apiUrl],
  );

  // ============================================================
  // Preview
  // ============================================================

  const preview = useCallback(
    async (patchText: string, root: string): Promise<PreviewResult> => {
      setPreviewing(true);
      setError(null);
      try {
        const resp = await fetch(apiUrl('/preview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch_text: patchText, root }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        }
        const result: PreviewResult = {
          safe: data.safe || false,
          ops_count: data.ops_count || 0,
          diffs: data.diffs || [],
          conflicts: data.conflicts || [],
          error: data.error || '',
        };
        if (isMounted.current) {
          setLastPreview(result);
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isMounted.current) {
          setError(msg);
        }
        throw e;
      } finally {
        if (isMounted.current) {
          setPreviewing(false);
        }
      }
    },
    [apiUrl],
  );

  // ============================================================
  // Apply
  // ============================================================

  const apply = useCallback(
    async (
      patchText: string,
      root: string,
      options: { force?: boolean; createSnapshot?: boolean; sessionId?: string } = {},
    ): Promise<ApplyResult> => {
      setApplying(true);
      setError(null);
      try {
        const resp = await fetch(apiUrl('/apply'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patch_text: patchText,
            root,
            force: options.force ?? false,
            create_snapshot: options.createSnapshot ?? true,
            session_id: options.sessionId,
          }),
        });
        const data = await resp.json();
        // 409 冲突：data.detail 包含 error + conflicts
        if (resp.status === 409) {
          const detail = data.detail || {};
          const result: ApplyResult = {
            success: false,
            snapshot_id: null,
            applied_ops: 0,
            duration_ms: 0,
            error: detail.error || 'CONFLICTS_DETECTED',
            failed_op: { conflicts: detail.conflicts || [] },
            rolled_back: false,
            diffs: [],
          };
          if (isMounted.current) {
            setLastApply(result);
          }
          return result;
        }
        if (!resp.ok) {
          throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail));
        }
        const result: ApplyResult = {
          success: data.success || false,
          snapshot_id: data.snapshot_id || null,
          applied_ops: data.applied_ops || 0,
          duration_ms: data.duration_ms || 0,
          error: data.error || '',
          failed_op: data.failed_op || null,
          rolled_back: data.rolled_back || false,
          diffs: data.diffs || [],
        };
        if (isMounted.current) {
          setLastApply(result);
        }
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isMounted.current) {
          setError(msg);
        }
        throw e;
      } finally {
        if (isMounted.current) {
          setApplying(false);
        }
      }
    },
    [apiUrl],
  );

  // ============================================================
  // Reset
  // ============================================================

  const reset = useCallback(() => {
    setLastValidate(null);
    setLastPreview(null);
    setLastApply(null);
    setError(null);
  }, []);

  return {
    validate,
    lastValidate,
    validating,
    preview,
    lastPreview,
    previewing,
    apply,
    lastApply,
    applying,
    error,
    reset,
  };
}
