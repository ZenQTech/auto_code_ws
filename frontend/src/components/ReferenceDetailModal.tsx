/**
 * # ============================================================
 * # ReferenceDetailModal - 引用详情模态 (v1.0.0 Cycle 18 P0-1)
 * # ============================================================
 * # 核心作用：展示已解析引用的详细信息
 * #           支持 codebase / git / diff 三种类型
 * # 运行流程：
 * #   1. 接收 ResolvedReference
 * #   2. 根据 type 渲染对应详情
 * #   3. 关闭按钮
 * # 输入参数：
 * #   - reference: 已解析引用
 * #   - open: 是否打开
 * #   - onClose: 关闭回调
 * # 输出结果：模态 JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 P0-1 初次创建
 * ============================================================
 */

import type { ResolvedReference } from '../utils/composerEngine.integration';

export interface ReferenceDetailModalProps {
  reference: ResolvedReference | null;
  open: boolean;
  onClose: () => void;
}

/** Codebase 详情 */
const CodebaseDetail: React.FC<{ ctx: any }> = ({ ctx }) => (
  <div data-testid="ref-detail-codebase" className="space-y-2">
    <div className="text-sm text-slate-300">
      <span className="text-slate-400">查询：</span>
      <span className="font-mono">{ctx.query}</span>
    </div>
    <div className="text-sm text-slate-300">
      <span className="text-slate-400">结果数：</span>
      {ctx.results?.length ?? 0}
    </div>
    {ctx.results && ctx.results.length > 0 && (
      <div className="space-y-1">
        {ctx.results.slice(0, 10).map((r: any, i: number) => (
          <div
            key={i}
            data-testid={`ref-detail-codebase-result-${i}`}
            className="bg-surface-800/50 p-2 rounded text-xs"
          >
            <div className="font-mono text-slate-200">{r.filePath}</div>
            {r.snippet && (
              <pre className="text-slate-400 mt-1 overflow-x-auto">{r.snippet.slice(0, 200)}</pre>
            )}
            <div className="text-slate-500 text-xs mt-1">score: {r.score?.toFixed(3)}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);

/** Git 详情 */
const GitDetail: React.FC<{ ctx: any }> = ({ ctx }) => {
  const data = ctx.data;
  return (
    <div data-testid="ref-detail-git" className="space-y-2">
      <div className="text-sm text-slate-300">
        <span className="text-slate-400">引用类型：</span>
        <span className="font-mono">{ctx.ref}</span>
      </div>
      <div className="text-sm text-slate-300">
        <span className="text-slate-400">查询：</span>
        <span className="font-mono">{ctx.query}</span>
      </div>
      {Array.isArray(data) ? (
        <div className="space-y-1">
          {data.slice(0, 10).map((item: any, i: number) => (
            <div
              key={i}
              data-testid={`ref-detail-git-item-${i}`}
              className="bg-surface-800/50 p-2 rounded text-xs"
            >
              {'sha' in item ? (
                <>
                  <div className="font-mono text-slate-200">
                    {item.shortSha} {item.message}
                  </div>
                  <div className="text-slate-500 text-xs mt-0.5">
                    {item.author} · {item.date}
                  </div>
                </>
              ) : 'commit' in item ? (
                <>
                  <div className="font-mono text-slate-200">
                    {item.filePath}:{item.line}
                  </div>
                  <div className="text-slate-400 text-xs mt-0.5">
                    {item.content?.slice(0, 100)}
                  </div>
                  <div className="text-slate-500 text-xs mt-0.5">
                    {item.commit?.shortSha} {item.commit?.message}
                  </div>
                </>
              ) : (
                <pre className="text-slate-400">{JSON.stringify(item, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      ) : (
        <pre className="text-xs text-slate-400">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
};

/** Diff 详情 */
const DiffDetail: React.FC<{ ctx: any }> = ({ ctx }) => (
  <div data-testid="ref-detail-diff" className="space-y-2">
    <div className="text-sm text-slate-300">
      <span className="text-slate-400">引用：</span>
      <span className="font-mono">{ctx.ref}</span>
    </div>
    <div className="text-sm text-slate-300">
      <span className="text-slate-400">统计：</span>
      <span className="text-green-300">+{ctx.totalAdditions}</span>{' '}
      <span className="text-red-300">-{ctx.totalDeletions}</span>{' '}
      <span className="text-slate-400">({ctx.files?.length ?? 0} 个文件)</span>
    </div>
    {ctx.files && ctx.files.length > 0 && (
      <div className="space-y-1">
        {ctx.files.slice(0, 10).map((f: any, i: number) => (
          <div
            key={i}
            data-testid={`ref-detail-diff-file-${i}`}
            className="bg-surface-800/50 p-2 rounded text-xs"
          >
            <div className="font-mono text-slate-200">
              {f.path} [{f.status}]{' '}
              <span className="text-green-300">+{f.additions}</span>{' '}
              <span className="text-red-300">-{f.deletions}</span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export const ReferenceDetailModal: React.FC<ReferenceDetailModalProps> = ({
  reference,
  open,
  onClose,
}) => {
  if (!open || !reference) return null;

  return (
    <div
      data-testid="reference-detail-modal"
      data-ref-type={reference.type}
      data-ref-state={reference.state}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100 font-mono">{reference.raw}</h2>
          <button
            data-testid="reference-detail-close"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xl"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {reference.state === 'failed' && reference.error && (
            <div data-testid="reference-detail-error" className="bg-red-500/10 border border-red-500/30 rounded p-3 text-sm text-red-200">
              <div className="font-semibold mb-1">解析失败</div>
              <div className="text-xs">{reference.error.message}</div>
            </div>
          )}
          {reference.state === 'resolved' && reference.context && (
            <>
              {reference.context.type === 'codebase' && (
                <CodebaseDetail ctx={reference.context} />
              )}
              {reference.context.type === 'git' && (
                <GitDetail ctx={reference.context} />
              )}
              {reference.context.type === 'diff' && (
                <DiffDetail ctx={reference.context} />
              )}
            </>
          )}
          {reference.state === 'resolving' && (
            <div data-testid="reference-detail-loading" className="text-sm text-slate-400 text-center py-8">
              ⚙️ 正在解析...
            </div>
          )}
          {reference.state === 'pending' && (
            <div data-testid="reference-detail-pending" className="text-sm text-slate-400 text-center py-8">
              ⏳ 等待解析
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReferenceDetailModal;
