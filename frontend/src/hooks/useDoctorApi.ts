// ============================================================
// useDoctorApi - Doctor API 客户端
// ============================================================
// 封装 /api/doctor 端点调用
// 修改记录：
//   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
// ============================================================

import { useState, useEffect, useCallback } from 'react';

// 2026-08-03 | v1.0.1 | Cycle 60 G60-FIX-3 修复：补全 /api 前缀
//   之前 base 写为 /doctor，但后端 API 路由以 /api/doctor 暴露，
//   导致请求走 Vite dev server (返回 index.html) 而非 FastAPI。
const DOCTOR_BASE = '/api/doctor';

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${DOCTOR_BASE}${path}`;
    const resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    return resp.json();
}

// ============================================================
// 类型定义
// ============================================================
export type CheckStatus = 'ok' | 'warning' | 'error' | 'skipped';

export interface CheckItem {
    id: string;
    name: string;
    category: string;
    description: string;
    status: CheckStatus;
    value?: string | null;
    expected?: string | null;
    message: string;
    fix_suggestion?: string | null;
    duration_ms: number;
    details: Record<string, any>;
}

export interface CategoryReport {
    category: string;
    title: string;
    total_checks: number;
    ok_count: number;
    warning_count: number;
    error_count: number;
    skipped_count: number;
    duration_ms: number;
    overall_status: CheckStatus;
    items: CheckItem[];
    error?: string | null;
}

export interface DoctorReport {
    report_id: string;
    timestamp: string;
    hostname: string;
    hermes_version: string;
    duration_ms: number;
    overall_status: CheckStatus;
    summary: {
        ok: number;
        warning: number;
        error: number;
        skipped: number;
        total: number;
    };
    categories: Record<string, CategoryReport>;
}

export interface DoctorReportSummary {
    report_id: string;
    timestamp: string;
    overall_status: CheckStatus;
    summary: DoctorReport['summary'];
    duration_ms: number;
    hostname: string;
    hermes_version: string;
}

export interface FixSuggestion {
    check_id: string;
    title: string;
    steps: string[];
    risk_level: 'low' | 'medium' | 'high';
    automated: boolean;
    estimated_time: string;
}

export interface CategoryInfo {
    name: string;
    title: string;
    description: string;
    check_count_estimate: number;
}

// ============================================================
// API 函数
// ============================================================

/** 获取健康状态 */
export async function fetchHealth(): Promise<any> {
    return apiFetch('/health');
}

/** 列出所有分类 */
export async function listCategories(): Promise<{ count: number; categories: CategoryInfo[] }> {
    return apiFetch('/categories');
}

/** 运行完整诊断 */
export async function runDiagnosis(
    category?: string,
    saveHistory: boolean = true
): Promise<{ success: boolean; report: DoctorReport }> {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('save_history', String(saveHistory));
    return apiFetch(`/run?${params.toString()}`);
}

/** 运行单个分类 */
export async function runCategory(category: string): Promise<{ success: boolean; category: CategoryReport }> {
    return apiFetch(`/${category}`);
}

/** 获取历史列表 */
export async function listHistory(limit: number = 20): Promise<{
    success: boolean;
    count: number;
    total: number;
    reports: DoctorReportSummary[];
}> {
    return apiFetch(`/history?limit=${limit}`);
}

/** 获取单个历史 */
export async function getHistoryReport(reportId: string): Promise<any> {
    return apiFetch(`/history/${reportId}`);
}

/** 获取修复建议 */
export async function getFix(checkId: string): Promise<{ success: boolean; fix: FixSuggestion }> {
    return apiFetch(`/fix/${checkId}`);
}

/** 列出所有修复 */
export async function listAllFixes(): Promise<{
    success: boolean;
    total: number;
    by_category: Record<string, Record<string, any>>;
}> {
    return apiFetch('/fixes/all/list');
}

/** 提交反馈 */
export async function submitFeedback(
    reportId: string,
    userComment?: string,
    contactEmail?: string
): Promise<{ success: boolean; feedback_id: string; message: string }> {
    return apiFetch('/feedback', {
        method: 'POST',
        body: JSON.stringify({
            report_id: reportId,
            user_comment: userComment,
            contact_email: contactEmail,
            auto_collected: true,
        }),
    });
}

// ============================================================
// 辅助函数
// ============================================================

/** 状态颜色 */
export function getStatusColor(status: CheckStatus): string {
    switch (status) {
        case 'ok':
            return 'bg-green-100 text-green-700 border-green-300';
        case 'warning':
            return 'bg-yellow-100 text-yellow-700 border-yellow-300';
        case 'error':
            return 'bg-red-100 text-red-700 border-red-300';
        default:
            return 'bg-gray-100 text-gray-600 border-gray-300';
    }
}

/** 状态图标 */
export function getStatusIcon(status: CheckStatus): string {
    switch (status) {
        case 'ok':
            return '✅';
        case 'warning':
            return '⚠️';
        case 'error':
            return '❌';
        default:
            return '⏭️';
    }
}

/** 风险等级颜色 */
export function getRiskColor(level: 'low' | 'medium' | 'high'): string {
    switch (level) {
        case 'low':
            return 'bg-green-100 text-green-700';
        case 'medium':
            return 'bg-yellow-100 text-yellow-700';
        case 'high':
            return 'bg-red-100 text-red-700';
    }
}

/** 格式化时间戳 */
export function formatTimestamp(ts: string): string {
    try {
        const d = new Date(ts);
        return d.toLocaleString();
    } catch {
        return ts;
    }
}

/** 格式化耗时 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

// ============================================================
// React Hooks
// ============================================================
export function useDoctorHealth() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const d = await fetchHealth();
            setData(d);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { data, loading, error, refresh };
}

export function useDoctorCategories() {
    const [data, setData] = useState<CategoryInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        listCategories()
            .then((d) => setData(d.categories))
            .catch((e) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);

    return { data, loading, error };
}
