/**
 * # ============================================================
 * # MarketplacePanel - 技能市场面板 (v1.0.0 Cycle 29 G29-02)
 * # ============================================================
 * # 核心作用：提供技能市场的浏览/搜索/安装/评分/评论 UI
 * # 运行流程：
 * #   1. 打开面板，列出所有市场技能（默认按安装数排序）
 * #   2. 顶部工具栏：分类筛选 + 排序 + 搜索框
 * #   3. 主区：技能卡片网格
 * #   4. 详情侧栏：选中技能后显示详情 + 评论 + 评分
 * #   5. 用户可安装/卸载/评分/评论
 * # 输入参数：isOpen (面板显示), onClose (关闭回调)
 * # 输出结果：技能市场交互界面
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-02 初次创建
 * # ============================================================
 */

import { useState, useMemo, useEffect } from 'react';
import { getDefaultMarketplace } from '../utils/marketplaceEngine';
import type { MarketplaceSkill, SkillCategory, MarketplaceSortBy, MarketplaceComment } from '../utils/marketplaceTypes';
import { MARKETPLACE_CATEGORIES } from '../utils/marketplaceTypes';

export interface MarketplacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** v6.78.0 (Cycle 29) 新增：是否作为独立页面渲染（去掉外层 fixed inset-0 背景） */
  standalone?: boolean;
}

const StarRating: React.FC<{ value: number; onChange?: (v: number) => void }> = ({ value, onChange }) => {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-0.5" data-testid="star-rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`text-lg leading-none transition-colors ${
            n <= (hover || value) ? 'text-amber-400' : 'text-slate-300'
          }`}
          onMouseEnter={() => onChange && setHover(n)}
          onMouseLeave={() => onChange && setHover(0)}
          onClick={() => onChange && onChange(n)}
          disabled={!onChange}
          data-testid={`star-${n}`}
        >
          ★
        </button>
      ))}
    </div>
  );
};

export const MarketplacePanel: React.FC<MarketplacePanelProps> = ({ isOpen, onClose, standalone }) => {
  const marketplace = useMemo(() => getDefaultMarketplace(), []);
  const [category, setCategory] = useState<SkillCategory | 'all'>('all');
  const [sortBy, setSortBy] = useState<MarketplaceSortBy>('installs');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [commentRating, setCommentRating] = useState(5);
  const [refreshKey, setRefreshKey] = useState(0);

  // 订阅事件
  useEffect(() => {
    if (!isOpen) return;
    const unsubInstall = marketplace.on('skill-installed', () => setRefreshKey((k) => k + 1));
    const unsubUninstall = marketplace.on('skill-uninstalled', () => setRefreshKey((k) => k + 1));
    const unsubRated = marketplace.on('skill-rated', () => setRefreshKey((k) => k + 1));
    const unsubComment = marketplace.on('comment-added', () => setRefreshKey((k) => k + 1));
    return () => {
      unsubInstall();
      unsubUninstall();
      unsubRated();
      unsubComment();
    };
  }, [isOpen, marketplace]);

  // 列表
  const skills = useMemo(() => {
    if (!isOpen) return [];
    return marketplace.listSkills({
      category,
      sortBy,
      searchQuery: searchQuery.trim() || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, category, sortBy, searchQuery, refreshKey]);

  // 选中
  const selected = useMemo(
    () => (selectedId ? marketplace.getSkill(selectedId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, refreshKey]
  );

  const comments = useMemo<MarketplaceComment[]>(
    () => (selectedId ? marketplace.getComments(selectedId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, refreshKey]
  );

  const stats = useMemo(() => marketplace.getStats(), // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshKey]);

  if (!isOpen && !standalone) return null;

  const handleInstallToggle = (skill: MarketplaceSkill) => {
    if (skill.installed) {
      marketplace.uninstallSkill(skill.id);
    } else {
      marketplace.installSkill(skill.id);
    }
  };

  const handleRate = (rating: number) => {
    if (!selected) return;
    marketplace.rateSkill(selected.id, rating as 1 | 2 | 3 | 4 | 5);
  };

  const handleSubmitComment = () => {
    if (!selected || !commentText.trim()) return;
    try {
      marketplace.commentOnSkill(selected.id, commentText, 'current-user', commentRating as 1 | 2 | 3 | 4 | 5);
      setCommentText('');
      setCommentRating(5);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className={
        standalone
          ? 'h-full flex flex-col'
          : 'fixed inset-0 z-50 flex items-center justify-center bg-black/40'
      }
      data-testid="marketplace-panel"
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-[min(96vw,1200px)] h-[min(92vh,820px)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">技能市场</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              共 {stats.totalSkills} 个技能 · 已安装 {stats.installedSkills} · 累计 {stats.totalInstalls.toLocaleString()} 安装
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500"
            data-testid="close-btn"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SkillCategory | 'all')}
            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900"
            data-testid="category-select"
          >
            <option value="all">全部分类</option>
            {MARKETPLACE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as MarketplaceSortBy)}
            className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900"
            data-testid="sort-select"
          >
            <option value="installs">安装数</option>
            <option value="rating">评分</option>
            <option value="newest">最新</option>
            <option value="name">名称</option>
          </select>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索技能..."
            className="flex-1 px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900"
            data-testid="search-input"
          />
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Skills Grid */}
          <div className="flex-1 overflow-y-auto p-6">
            {skills.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <div className="text-4xl mb-2">🔍</div>
                <p>没有找到匹配的技能</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="skills-grid">
                {skills.map((skill) => (
                  <div
                    key={skill.id}
                    onClick={() => setSelectedId(skill.id)}
                    className={`cursor-pointer rounded-lg border p-4 transition-all hover:shadow-md ${
                      selectedId === skill.id
                        ? 'border-indigo-500 ring-2 ring-indigo-200 dark:ring-indigo-800'
                        : 'border-slate-200 dark:border-slate-700'
                    } bg-white dark:bg-slate-800`}
                    data-testid={`skill-card-${skill.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-3xl">{skill.thumbnail}</div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {skill.displayName}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {skill.author} · v{skill.version}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 line-clamp-2">
                      {skill.description}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span>⭐ {skill.rating.toFixed(1)}</span>
                        <span>📦 {skill.installs.toLocaleString()}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInstallToggle(skill);
                        }}
                        className={`px-3 py-1 text-xs rounded-md font-medium ${
                          skill.installed
                            ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                        }`}
                        data-testid={`install-btn-${skill.id}`}
                      >
                        {skill.installed ? '已安装' : '安装'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail Sidebar */}
          {selected && (
            <div
              className="w-[360px] border-l border-slate-200 dark:border-slate-700 overflow-y-auto bg-slate-50 dark:bg-slate-800/30"
              data-testid="detail-sidebar"
            >
              <div className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="text-4xl">{selected.thumbnail}</div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                      {selected.displayName}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {selected.author} · v{selected.version}
                    </p>
                  </div>
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                  {selected.longDescription}
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                  <div className="bg-white dark:bg-slate-900 rounded p-2">
                    <div className="text-slate-500">评分</div>
                    <div className="font-medium">⭐ {selected.rating.toFixed(1)} ({selected.ratingCount})</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded p-2">
                    <div className="text-slate-500">安装数</div>
                    <div className="font-medium">📦 {selected.installs.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded p-2">
                    <div className="text-slate-500">周活</div>
                    <div className="font-medium">👥 {selected.weeklyActiveUsers.toLocaleString()}</div>
                  </div>
                  <div className="bg-white dark:bg-slate-900 rounded p-2">
                    <div className="text-slate-500">Token 成本</div>
                    <div className="font-medium">💎 {selected.estimatedTokenCost}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {selected.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {selected.compatibility.map((c) => (
                    <span
                      key={c}
                      className="text-xs px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 rounded"
                    >
                      {c}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => handleInstallToggle(selected)}
                  className={`w-full py-2 rounded-md font-medium text-sm ${
                    selected.installed
                      ? 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  }`}
                  data-testid="detail-install-btn"
                >
                  {selected.installed ? '卸载' : '安装此技能'}
                </button>

                {/* Rating */}
                <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-700">
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">为这个技能评分</h4>
                  <StarRating
                    value={
                      marketplace.getUserRating(selected.id)?.rating ?? 0
                    }
                    onChange={handleRate}
                  />
                </div>

                {/* Comments */}
                <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-700">
                  <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                    用户评论 ({comments.length})
                  </h4>
                  <div className="space-y-3 mb-4" data-testid="comments-list">
                    {comments.length === 0 ? (
                      <p className="text-xs text-slate-400">暂无评论</p>
                    ) : (
                      comments.slice(0, 5).map((c) => (
                        <div
                          key={c.id}
                          className="bg-white dark:bg-slate-900 rounded p-2 text-xs"
                          data-testid={`comment-${c.id}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {c.author}
                            </span>
                            <span className="text-amber-500">{'★'.repeat(c.rating)}</span>
                          </div>
                          <p className="text-slate-600 dark:text-slate-300">{c.content}</p>
                          <div className="mt-1 flex items-center gap-2 text-slate-400">
                            <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                            <button
                              onClick={() => marketplace.markCommentHelpful(c.id)}
                              className="hover:text-indigo-500"
                            >
                              👍 {c.helpful}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add Comment */}
                  <div className="space-y-2">
                    <StarRating value={commentRating} onChange={setCommentRating} />
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="写下你的评论..."
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900"
                      rows={3}
                      data-testid="comment-input"
                    />
                    <button
                      onClick={handleSubmitComment}
                      disabled={!commentText.trim()}
                      className="w-full py-1.5 text-sm bg-indigo-600 text-white rounded-md disabled:opacity-50 hover:bg-indigo-700"
                      data-testid="submit-comment-btn"
                    >
                      提交评论
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MarketplacePanel;
