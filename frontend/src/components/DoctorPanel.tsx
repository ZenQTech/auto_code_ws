// ============================================================
// DoctorPanel - 环境诊断面板
// ============================================================
// 6 类诊断卡片式展示 + 修复建议 + 历史报告
// 修改记录：
//   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
    DoctorReport,
    CategoryReport,
    CheckItem,
    FixSuggestion,
    DoctorReportSummary,
    getStatusColor,
    getStatusIcon,
    getRiskColor,
    formatTimestamp,
    formatDuration,
    runDiagnosis,
    runCategory,
    listHistory,
    getFix,
    submitFeedback,
} from '../hooks/useDoctorApi';

type ViewMode = 'overview' | 'category' | 'history';

const DoctorPanel: React.FC = () => {
    const [viewMode, setViewMode] = useState<ViewMode>('overview');
    const [report, setReport] = useState<DoctorReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [history, setHistory] = useState<DoctorReportSummary[]>([]);
    const [selectedFix, setSelectedFix] = useState<FixSuggestion | null>(null);
    const [showFeedbackModal, setShowFeedbackModal] = useState(false);
    const [feedbackComment, setFeedbackComment] = useState('');
    const [feedbackEmail, setFeedbackEmail] = useState('');

    // ============================================================
    // 操作
    // ============================================================
    const runFullDiagnosis = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const r = await runDiagnosis(undefined, true);
            setReport(r.report);
            // 刷新历史
            const h = await listHistory(10);
            setHistory(h.reports);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const runCategoryDiagnosis = useCallback(async (category: string) => {
        setLoading(true);
        setError(null);
        try {
            const r = await runCategory(category);
            setReport((prev) => {
                if (!prev) {
                    return {
                        report_id: 'partial',
                        timestamp: new Date().toISOString(),
                        hostname: '',
                        hermes_version: '',
                        duration_ms: r.category.duration_ms,
                        overall_status: r.category.overall_status,
                        summary: { ok: 0, warning: 0, error: 0, skipped: 0, total: 0 },
                        categories: { [category]: r.category },
                    };
                }
                return {
                    ...prev,
                    categories: { ...prev.categories, [category]: r.category },
                };
            });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadHistory = useCallback(async () => {
        setLoading(true);
        try {
            const h = await listHistory(20);
            setHistory(h.reports);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleShowFix = useCallback(async (checkId: string) => {
        try {
            const r = await getFix(checkId);
            setSelectedFix(r.fix);
        } catch (e: any) {
            setError(e.message);
        }
    }, []);

    const handleSubmitFeedback = useCallback(async () => {
        if (!report) return;
        try {
            await submitFeedback(report.report_id, feedbackComment, feedbackEmail);
            setShowFeedbackModal(false);
            setFeedbackComment('');
            setFeedbackEmail('');
            alert('反馈已提交，感谢您的支持！');
        } catch (e: any) {
            setError(e.message);
        }
    }, [report, feedbackComment, feedbackEmail]);

    // 初始加载历史
    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    // ============================================================
    // 渲染
    // ============================================================
    return (
        <div className="flex flex-col h-full bg-white">
            {/* 顶部工具栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">🩺 Hermes Doctor</h1>
                    <p className="text-sm text-gray-600 mt-1">
                        环境诊断 · 自动检查 6 大类共 43+ 项
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={runFullDiagnosis}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
                    >
                        {loading ? '⏳ 运行中...' : '🔍 运行诊断'}
                    </button>
                    <button
                        onClick={() => {
                            setViewMode(viewMode === 'history' ? 'overview' : 'history');
                            if (viewMode !== 'history') loadHistory();
                        }}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 font-medium"
                    >
                        {viewMode === 'history' ? '📋 当前报告' : '📜 历史'}
                    </button>
                </div>
            </div>

            {/* 错误提示 */}
            {error && (
                <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-300 rounded-md text-red-700 text-sm">
                    ❌ {error}
                    <button onClick={() => setError(null)} className="ml-2 text-red-500">×</button>
                </div>
            )}

            {/* 概览模式 */}
            {viewMode === 'overview' && report && (
                <OverviewView
                    report={report}
                    onCategoryClick={(cat) => {
                        setSelectedCategory(cat);
                        setViewMode('category');
                    }}
                    onFixClick={handleShowFix}
                    onFeedback={() => setShowFeedbackModal(true)}
                />
            )}

            {/* 分类详情模式 */}
            {viewMode === 'category' && selectedCategory && report && (
                <CategoryDetailView
                    category={report.categories[selectedCategory]}
                    onBack={() => setViewMode('overview')}
                    onFixClick={handleShowFix}
                    onRerun={() => runCategoryDiagnosis(selectedCategory)}
                />
            )}

            {/* 历史模式 */}
            {viewMode === 'history' && (
                <HistoryView reports={history} />
            )}

            {/* 初始空状态 */}
            {viewMode === 'overview' && !report && !loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <div className="text-6xl mb-4">🩺</div>
                        <h2 className="text-xl font-semibold text-gray-700 mb-2">
                            准备诊断您的环境
                        </h2>
                        <p className="text-gray-500 mb-6">
                            点击"运行诊断"按钮开始全面健康检查
                        </p>
                        <button
                            onClick={runFullDiagnosis}
                            className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-lg"
                        >
                            🚀 开始诊断
                        </button>
                    </div>
                </div>
            )}

            {/* 加载中 */}
            {loading && !report && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <div className="text-4xl mb-4 animate-pulse">⏳</div>
                        <p className="text-gray-600">正在运行诊断...</p>
                    </div>
                </div>
            )}

            {/* 修复建议弹窗 */}
            {selectedFix && (
                <FixSuggestionModal
                    fix={selectedFix}
                    onClose={() => setSelectedFix(null)}
                />
            )}

            {/* 反馈弹窗 */}
            {showFeedbackModal && report && (
                <FeedbackModal
                    comment={feedbackComment}
                    email={feedbackEmail}
                    onCommentChange={setFeedbackComment}
                    onEmailChange={setFeedbackEmail}
                    onSubmit={handleSubmitFeedback}
                    onClose={() => setShowFeedbackModal(false)}
                />
            )}
        </div>
    );
};

// ============================================================
// 子组件：概览视图
// ============================================================
const OverviewView: React.FC<{
    report: DoctorReport;
    onCategoryClick: (cat: string) => void;
    onFixClick: (checkId: string) => void;
    onFeedback: () => void;
}> = ({ report, onCategoryClick, onFixClick, onFeedback }) => {
    const summary = report.summary;
    return (
        <div className="flex-1 overflow-auto p-6">
            {/* 状态横幅 */}
            <div className={`mb-6 p-4 rounded-lg border-2 ${getStatusColor(report.overall_status)}`}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            {getStatusIcon(report.overall_status)}
                            总体状态: {report.overall_status.toUpperCase()}
                        </h2>
                        <p className="text-sm mt-1 opacity-80">
                            {summary.ok} OK · {summary.warning} 警告 · {summary.error} 错误 · {summary.skipped} 跳过
                        </p>
                    </div>
                    <div className="text-right text-sm opacity-80">
                        <div>⏱️ {formatDuration(report.duration_ms)}</div>
                        <div>📅 {formatTimestamp(report.timestamp)}</div>
                        <div>🖥️ {report.hostname}</div>
                    </div>
                </div>
            </div>

            {/* 6 大类卡片 */}
            <h3 className="text-lg font-semibold text-gray-800 mb-3">📂 诊断分类</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.values(report.categories).map((cat) => (
                    <CategoryCard
                        key={cat.category}
                        category={cat}
                        onClick={() => onCategoryClick(cat.category)}
                    />
                ))}
            </div>

            {/* 关键问题列表 */}
            {(summary.error > 0 || summary.warning > 0) && (
                <div className="mt-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-3">⚠️ 关键问题</h3>
                    <div className="space-y-2">
                        {Object.values(report.categories)
                            .flatMap((cat) => cat.items)
                            .filter((item) => item.status === 'error' || item.status === 'warning')
                            .slice(0, 10)
                            .map((item) => (
                                <div
                                    key={item.id}
                                    className={`p-3 rounded-md border ${getStatusColor(item.status)} flex items-start gap-3`}
                                >
                                    <span className="text-xl flex-shrink-0">{getStatusIcon(item.status)}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium">{item.name}</div>
                                        <div className="text-sm opacity-80 mt-0.5">{item.message}</div>
                                        {item.id && (
                                            <button
                                                onClick={() => onFixClick(item.id)}
                                                className="mt-2 text-xs text-blue-600 hover:underline"
                                            >
                                                💡 查看修复建议
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {/* 反馈按钮 */}
            <div className="mt-6 flex justify-end">
                <button
                    onClick={onFeedback}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                >
                    📤 反馈此报告
                </button>
            </div>
        </div>
    );
};

// ============================================================
// 子组件：分类卡片
// ============================================================
const CategoryCard: React.FC<{
    category: CategoryReport;
    onClick: () => void;
}> = ({ category, onClick }) => {
    return (
        <button
            onClick={onClick}
            className={`p-4 rounded-lg border-2 text-left hover:shadow-md transition-shadow ${getStatusColor(category.overall_status)}`}
        >
            <div className="flex items-center justify-between mb-2">
                <h4 className="font-semibold text-base">{category.title}</h4>
                <span className="text-2xl">{getStatusIcon(category.overall_status)}</span>
            </div>
            <div className="text-sm space-y-1">
                <div>📊 总计: {category.total_checks} 项</div>
                {category.ok_count > 0 && <div className="text-green-700">✅ {category.ok_count} 通过</div>}
                {category.warning_count > 0 && <div className="text-yellow-700">⚠️ {category.warning_count} 警告</div>}
                {category.error_count > 0 && <div className="text-red-700">❌ {category.error_count} 错误</div>}
                <div className="opacity-60 mt-2">⏱️ {formatDuration(category.duration_ms)}</div>
            </div>
        </button>
    );
};

// ============================================================
// 子组件：分类详情
// ============================================================
const CategoryDetailView: React.FC<{
    category: CategoryReport;
    onBack: () => void;
    onFixClick: (checkId: string) => void;
    onRerun: () => void;
}> = ({ category, onBack, onFixClick, onRerun }) => {
    return (
        <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-4">
                <button onClick={onBack} className="text-blue-600 hover:underline">
                    ← 返回概览
                </button>
                <button
                    onClick={onRerun}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 text-sm"
                >
                    🔄 重新检测
                </button>
            </div>

            <h2 className="text-xl font-bold mb-2">{category.title}</h2>
            <div className={`mb-4 p-3 rounded-md border ${getStatusColor(category.overall_status)}`}>
                <span className="text-xl mr-2">{getStatusIcon(category.overall_status)}</span>
                <span className="font-semibold">{category.overall_status.toUpperCase()}</span>
                <span className="ml-3 text-sm opacity-80">
                    {category.ok_count}/{category.total_checks} 通过 · {formatDuration(category.duration_ms)}
                </span>
            </div>

            {category.error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-md text-red-700 text-sm">
                    ❌ 执行错误: {category.error}
                </div>
            )}

            <div className="space-y-2">
                {category.items.map((item) => (
                    <CheckItemRow key={item.id} item={item} onFixClick={onFixClick} />
                ))}
            </div>
        </div>
    );
};

// ============================================================
// 子组件：检查项行
// ============================================================
const CheckItemRow: React.FC<{
    item: CheckItem;
    onFixClick: (checkId: string) => void;
}> = ({ item, onFixClick }) => {
    return (
        <div className={`p-3 rounded-md border ${getStatusColor(item.status)}`}>
            <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{getStatusIcon(item.status)}</span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <h5 className="font-medium">{item.name}</h5>
                        <span className="text-xs opacity-60">{item.duration_ms}ms</span>
                    </div>
                    <p className="text-sm opacity-80 mt-0.5">{item.message}</p>
                    {(item.value || item.expected) && (
                        <div className="text-xs mt-1 opacity-70">
                            {item.value && <span>当前: <code className="bg-white bg-opacity-50 px-1 rounded">{item.value}</code></span>}
                            {item.expected && <span className="ml-2">期望: <code className="bg-white bg-opacity-50 px-1 rounded">{item.expected}</code></span>}
                        </div>
                    )}
                    {(item.status === 'error' || item.status === 'warning') && item.fix_suggestion && (
                        <button
                            onClick={() => onFixClick(item.id)}
                            className="mt-2 text-xs text-blue-600 hover:underline"
                        >
                            💡 查看详细修复建议
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================================
// 子组件：历史视图
// ============================================================
const HistoryView: React.FC<{ reports: DoctorReportSummary[] }> = ({ reports }) => {
    if (reports.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-gray-500">
                    <div className="text-4xl mb-2">📜</div>
                    <p>暂无历史报告</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto p-6">
            <h2 className="text-xl font-bold mb-4">📜 历史报告</h2>
            <div className="space-y-2">
                {reports.map((r) => (
                    <div
                        key={r.report_id}
                        className={`p-3 rounded-md border ${getStatusColor(r.overall_status)}`}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-lg">{getStatusIcon(r.overall_status)}</span>
                                    <code className="text-sm">{r.report_id}</code>
                                </div>
                                <div className="text-sm opacity-80 mt-1">
                                    {formatTimestamp(r.timestamp)} · {r.hostname} · {formatDuration(r.duration_ms)}
                                </div>
                            </div>
                            <div className="text-right text-sm opacity-80">
                                <div>✅ {r.summary.ok}</div>
                                <div>⚠️ {r.summary.warning}</div>
                                <div>❌ {r.summary.error}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ============================================================
// 子组件：修复建议弹窗
// ============================================================
const FixSuggestionModal: React.FC<{
    fix: FixSuggestion;
    onClose: () => void;
}> = ({ fix, onClose }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const text = fix.steps.join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-lg font-semibold">💡 {fix.title}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
                </div>
                <div className="p-4 overflow-auto flex-1">
                    <div className="flex items-center gap-2 mb-3">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${getRiskColor(fix.risk_level)}`}>
                            风险等级: {fix.risk_level}
                        </span>
                        <span className="text-sm text-gray-600">预计耗时: {fix.estimated_time}</span>
                    </div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">修复步骤:</h4>
                    <ol className="space-y-1 text-sm font-mono bg-gray-50 p-3 rounded">
                        {fix.steps.map((step, i) => (
                            <li key={i} className="flex gap-2">
                                <span className="text-gray-400 select-none">{i + 1}.</span>
                                <span className="break-all">{step}</span>
                            </li>
                        ))}
                    </ol>
                </div>
                <div className="p-4 border-t flex justify-end gap-2">
                    <button
                        onClick={handleCopy}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        {copied ? '✓ 已复制' : '📋 复制命令'}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};

// ============================================================
// 子组件：反馈弹窗
// ============================================================
const FeedbackModal: React.FC<{
    comment: string;
    email: string;
    onCommentChange: (v: string) => void;
    onEmailChange: (v: string) => void;
    onSubmit: () => void;
    onClose: () => void;
}> = ({ comment, email, onCommentChange, onEmailChange, onSubmit, onClose }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-lg font-semibold">📤 反馈诊断报告</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl">×</button>
                </div>
                <div className="p-4 space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            邮箱（可选）
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => onEmailChange(e.target.value)}
                            placeholder="your@email.com"
                            className="w-full px-3 py-2 border rounded-md"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            意见或问题描述
                        </label>
                        <textarea
                            value={comment}
                            onChange={(e) => onCommentChange(e.target.value)}
                            rows={4}
                            placeholder="您对诊断结果有任何问题或建议吗？"
                            className="w-full px-3 py-2 border rounded-md"
                        />
                    </div>
                </div>
                <div className="p-4 border-t flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
                    >
                        取消
                    </button>
                    <button
                        onClick={onSubmit}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                    >
                        提交反馈
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DoctorPanel;
