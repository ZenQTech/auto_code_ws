/**
 * # ============================================================
 * # FigmaImportPanel - Figma 设计稿导入 UI (v1.0.0 Cycle 24 G24-04)
 * # ============================================================
 * # 核心作用：FigmaAdapter 的可视化控制面板
 * # 主要功能：
 * #   1. URL 输入 + Token 管理（localStorage 持久化）
 * #   2. 节点树预览（树形结构展开/折叠）
 * #   3. 实时代码生成（React/Vue/HTML 三种框架切换）
 * #   4. 样式映射配置（Tailwind / CSS Modules / 内联）
 * #   5. Mock 数据集（5 个内置预设）
 * #   6. 复制/下载生成的代码
 * #   7. 转换统计（节点数/文本数/行数/字节数）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-04 初次创建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getFigmaAdapter,
  resetFigmaAdapter,
  type FigmaNode,
  type GeneratedCode,
  type Framework,
  type Styling,
  type FigmaToCodeOptions,
  type FigmaConfig,
  FIGMA_MOCK_PRESETS,
} from '../utils/figmaAdapter';
import { EmptyState } from './EmptyState';

interface FigmaImportPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const FRAMEWORK_LABELS: Record<Framework, string> = {
  react: 'React',
  vue: 'Vue',
  html: 'HTML',
};

const STYLING_LABELS: Record<Styling, string> = {
  tailwind: 'Tailwind',
  'css-modules': 'CSS Modules',
  inline: '内联样式',
};

const STORAGE_KEY = 'hermes.figimaImportPanel';

// 简单的 localStorage 安全读取
function safeGetItem(key: string): Record<string, any> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function safeSetItem(key: string, value: Record<string, any>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 忽略存储错误
  }
}

/**
 * 将树形节点展平为列表
 */
function flattenNodes(node: FigmaNode, depth = 0, parentPath = ''): Array<{
  node: FigmaNode;
  depth: number;
  path: string;
}> {
  const items: Array<{ node: FigmaNode; depth: number; path: string }> = [];
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  items.push({ node, depth, path });
  if (node.children) {
    for (const child of node.children) {
      items.push(...flattenNodes(child, depth + 1, path));
    }
  }
  return items;
}

/**
 * 节点类型对应的图标
 */
function getNodeIcon(type: string): string {
  switch (type) {
    case 'FRAME': return '▭';
    case 'GROUP': return '▦';
    case 'TEXT': return 'T';
    case 'RECTANGLE': return '▢';
    case 'ELLIPSE': return '○';
    case 'COMPONENT': return '◆';
    case 'INSTANCE': return '◇';
    case 'IMAGE': return '🖼';
    case 'VECTOR': return '✎';
    default: return '·';
  }
}

export function FigmaImportPanel({ isOpen, onClose }: FigmaImportPanelProps) {
  const adapter = useMemo(() => getFigmaAdapter(), []);
  const [config, setConfig] = useState<FigmaConfig>(adapter.getConfig());
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [componentName, setComponentName] = useState('MyComponent');
  const [framework, setFramework] = useState<Framework>('react');
  const [styling, setStyling] = useState<Styling>('tailwind');
  const [includeComments, setIncludeComments] = useState(true);
  const [extractImages, setExtractImages] = useState(false);
  const [currentNode, setCurrentNode] = useState<FigmaNode | null>(null);
  const [currentSource, setCurrentSource] = useState<string>('');
  const [generated, setGenerated] = useState<GeneratedCode | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [parsedInfo, setParsedInfo] = useState<{ fileKey: string; nodeId?: string } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const unsubsRef = useRef<Array<() => void>>([]);

  // 加载 localStorage 持久化
  useEffect(() => {
    if (!isOpen) return;
    const stored = safeGetItem(STORAGE_KEY);
    if (stored.token) setToken(stored.token);
    if (stored.url) setUrl(stored.url);
    if (stored.componentName) setComponentName(stored.componentName);
    if (stored.framework) setFramework(stored.framework);
    if (stored.styling) setStyling(stored.styling);
    if (typeof stored.includeComments === 'boolean') setIncludeComments(stored.includeComments);
    if (typeof stored.extractImages === 'boolean') setExtractImages(stored.extractImages);
  }, [isOpen]);

  // 同步 config
  useEffect(() => {
    if (!isOpen) return;
    setConfig(adapter.getConfig());
  }, [isOpen, adapter]);

  // 事件订阅
  useEffect(() => {
    if (!isOpen) return;
    const off1 = adapter.on('fetched', () => {
      setInfo('节点拉取成功');
      setLoading(false);
    });
    const off2 = adapter.on('converted', () => {
      setGenerating(false);
    });
    const off3 = adapter.on('error', (payload: any) => {
      setError(payload?.error || '未知错误');
      setLoading(false);
      setGenerating(false);
    });
    const off4 = adapter.on('config-updated', () => {
      setConfig(adapter.getConfig());
    });
    const off5 = adapter.on('cache-hit', () => {
      setInfo('命中缓存');
    });
    unsubsRef.current = [off1, off2, off3, off4, off5];
    return () => {
      for (const off of unsubsRef.current) off();
      unsubsRef.current = [];
    };
  }, [isOpen, adapter]);

  // 持久化设置
  const persistSettings = useCallback((patch: Record<string, any>) => {
    const cur = safeGetItem(STORAGE_KEY);
    safeSetItem(STORAGE_KEY, { ...cur, ...patch });
  }, []);

  // 解析 URL
  const handleParseUrl = useCallback(() => {
    setError(null);
    setInfo(null);
    if (!url.trim()) {
      setError('请输入 Figma URL');
      return;
    }
    const parsed = adapter.parseUrl(url.trim());
    if (!parsed) {
      setError('URL 格式无效，应为 https://www.figma.com/file/<key>/... 或 fileKey 本身');
      return;
    }
    setParsedInfo(parsed);
    setInfo(`已解析 fileKey: ${parsed.fileKey}${parsed.nodeId ? `, nodeId: ${parsed.nodeId}` : ''}`);
    persistSettings({ url: url.trim() });
  }, [url, adapter, persistSettings]);

  // 拉取数据
  const handleFetch = useCallback(async () => {
    setError(null);
    setInfo(null);
    if (!parsedInfo) {
      setError('请先解析 URL');
      return;
    }
    setLoading(true);
    try {
      let node: FigmaNode | null = null;
      if (parsedInfo.nodeId) {
        node = await adapter.fetchNode(parsedInfo.fileKey, parsedInfo.nodeId);
      } else {
        const file = await adapter.fetchFile(parsedInfo.fileKey);
        node = file.document;
      }
      setCurrentNode(node);
      setCurrentSource(`url:${url}`);
      setSelectedNodeId(node?.id || null);
      setInfo(`已加载节点：${node?.name || '未命名'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '拉取失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [parsedInfo, adapter, url]);

  // 加载 Mock 预设
  const handleLoadMock = useCallback((name: string) => {
    setError(null);
    setInfo(null);
    const node = adapter.loadMockData(name);
    if (!node) {
      setError(`Mock 数据 ${name} 不存在`);
      return;
    }
    setCurrentNode(node);
    setCurrentSource(`mock:${name}`);
    setSelectedNodeId(node.id);
    setParsedInfo(null);
    setUrl('');
    setInfo(`已加载 Mock 预设：${name}`);
  }, [adapter]);

  // 同步 Token 到 Adapter
  const handleTokenChange = useCallback((val: string) => {
    setToken(val);
    persistSettings({ token: val });
    adapter.setConfig({ accessToken: val, useMockData: !val });
  }, [adapter, persistSettings]);

  // 切换 Mock 模式
  const handleUseMockChange = useCallback((useMock: boolean) => {
    adapter.setConfig({ useMockData: useMock });
    setConfig(adapter.getConfig());
  }, [adapter]);

  // 切换 useMockData 时同步持久化
  useEffect(() => {
    persistSettings({ framework, styling, includeComments, extractImages, componentName });
  }, [framework, styling, includeComments, extractImages, componentName, persistSettings]);

  // 选择节点
  const handleSelectNode = useCallback((node: FigmaNode) => {
    setSelectedNodeId(node.id);
  }, []);

  // 生成代码
  const handleGenerate = useCallback(() => {
    if (!currentNode) {
      setInfo(null);
      setError('请先加载节点');
      return;
    }
    setError(null);
    setInfo(null);
    setGenerating(true);
    try {
      const opts: FigmaToCodeOptions = {
        framework,
        styling,
        includeComments,
        componentName,
        extractImages,
      };
      const result = adapter.generateFullComponent(currentNode, opts);
      setGenerated(result);
      setInfo(`代码已生成：${result.stats.lineCount} 行 / ${result.stats.bytes} 字节`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '生成失败';
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, [currentNode, framework, styling, includeComments, componentName, extractImages, adapter]);

  // 框架切换时重新生成
  useEffect(() => {
    if (currentNode && generated) {
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framework, styling, includeComments]);

  // 复制代码
  const handleCopy = useCallback(async () => {
    if (!generated) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(generated.code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = generated.code;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    } catch (err) {
      setError('复制失败');
    }
  }, [generated]);

  // 下载代码
  const handleDownload = useCallback(() => {
    if (!generated) return;
    try {
      let filename = `${componentName || 'Component'}`;
      let mime = 'text/plain';
      if (generated.framework === 'react') {
        filename += '.tsx';
        mime = 'text/typescript';
      } else if (generated.framework === 'vue') {
        filename += '.vue';
        mime = 'text/x-vue';
      } else {
        filename += '.html';
        mime = 'text/html';
      }
      const blob = new Blob([generated.code], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setInfo(`已下载 ${filename}`);
    } catch (err) {
      setError('下载失败');
    }
  }, [generated, componentName]);

  // 清空缓存
  const handleClearCache = useCallback(() => {
    adapter.clearCache();
    setInfo('缓存已清空');
  }, [adapter]);

  // 重置全部
  const handleReset = useCallback(() => {
    if (typeof window !== 'undefined' && !(window as { confirm?: (msg: string) => boolean }).confirm?.('确认重置 FigmaAdapter？所有配置和缓存将清空')) {
      return;
    }
    resetFigmaAdapter();
    setConfig(adapter.getConfig());
    setCurrentNode(null);
    setGenerated(null);
    setSelectedNodeId(null);
    setParsedInfo(null);
    setInfo('已重置 FigmaAdapter');
  }, [adapter]);

  if (!isOpen) return null;

  const flatNodes = currentNode ? flattenNodes(currentNode) : [];
  const mockPresets = Object.keys(FIGMA_MOCK_PRESETS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="figma-import-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[95vw] max-w-7xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-pink-500 to-rose-500 flex items-center justify-center">
              <span className="text-white text-sm">🎨</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Figma 设计稿转代码</h2>
              <p className="text-xs text-slate-400">
                URL 解析 · 节点拉取 · React/Vue/HTML 自动生成
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              data-testid="figma-reset"
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-white border border-surface-700 rounded bg-surface-800"
            >
              重置
            </button>
            <button
              onClick={onClose}
              data-testid="figma-close"
              className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* Status Bar */}
        {(error || info) && (
          <div
            data-testid="figma-status"
            className={`px-5 py-2 text-xs border-b ${
              error
                ? 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
            }`}
          >
            {error || info}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
          {/* Left Column: Input + Tree */}
          <div className="flex-1 flex flex-col border-r border-surface-700 min-w-0">
            {/* URL / Token 区域 */}
            <div className="p-4 border-b border-surface-700 space-y-2 bg-surface-800/30">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 w-20">Figma URL</label>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={handleParseUrl}
                  placeholder="https://www.figma.com/file/xxxxx/... 或 fileKey"
                  data-testid="figma-url-input"
                  className="flex-1 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-xs text-slate-200 placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                />
                <button
                  onClick={handleParseUrl}
                  data-testid="figma-parse"
                  className="px-3 py-1.5 text-xs bg-primary-500/20 text-primary-300 border border-primary-500/30 rounded hover:bg-primary-500/30"
                >
                  解析
                </button>
                <button
                  onClick={handleFetch}
                  disabled={loading || !parsedInfo}
                  data-testid="figma-fetch"
                  className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? '拉取中...' : '拉取'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-400 w-20">Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => handleTokenChange(e.target.value)}
                  placeholder="Personal Access Token (可选)"
                  data-testid="figma-token-input"
                  className="flex-1 px-2 py-1.5 bg-surface-900 border border-surface-700 rounded text-xs text-slate-200 placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.useMockData}
                    onChange={(e) => handleUseMockChange(e.target.checked)}
                    data-testid="figma-mock-toggle"
                    className="rounded"
                  />
                  Mock 模式
                </label>
                <button
                  onClick={handleClearCache}
                  data-testid="figma-clear-cache"
                  className="px-2 py-1.5 text-xs text-slate-400 hover:text-white border border-surface-700 rounded"
                >
                  清缓存
                </button>
              </div>
              {parsedInfo && (
                <div className="text-[10px] text-slate-500 font-mono pl-[88px]" data-testid="figma-parsed-info">
                  fileKey: {parsedInfo.fileKey}
                  {parsedInfo.nodeId ? ` · nodeId: ${parsedInfo.nodeId}` : ''}
                </div>
              )}
            </div>

            {/* Mock 预设 */}
            <div className="px-4 py-2 border-b border-surface-700 bg-surface-800/20 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400">Mock 预设:</span>
              {mockPresets.map((name) => (
                <button
                  key={name}
                  onClick={() => handleLoadMock(name)}
                  data-testid={`figma-mock-${name}`}
                  className={`px-2 py-1 text-[10px] rounded border transition ${
                    currentSource === `mock:${name}`
                      ? 'bg-primary-500/30 border-primary-500/50 text-primary-200'
                      : 'bg-surface-800 border-surface-700 text-slate-300 hover:bg-surface-700'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>

            {/* 节点树 */}
            <div className="flex-1 overflow-auto p-3 min-h-0">
              {currentNode ? (
                <div className="space-y-0.5" data-testid="figma-node-tree">
                  {flatNodes.map(({ node, depth, path }) => (
                    <button
                      key={node.id}
                      onClick={() => handleSelectNode(node)}
                      data-testid={`figma-node-${node.id}`}
                      className={`w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono transition ${
                        selectedNodeId === node.id
                          ? 'bg-primary-500/20 text-primary-200 border border-primary-500/30'
                          : 'hover:bg-surface-800 text-slate-300 border border-transparent'
                      }`}
                      style={{ paddingLeft: `${depth * 16 + 8}px` }}
                      title={path}
                    >
                      <span className="text-amber-400 w-4 text-center">{getNodeIcon(node.type)}</span>
                      <span className="text-slate-400 w-16 truncate text-[10px]">{node.type}</span>
                      <span className="truncate">{node.name}</span>
                      {node.width && node.height && (
                        <span className="ml-auto text-[10px] text-slate-500">
                          {Math.round(node.width)}×{Math.round(node.height)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="🎨"
                  title="暂无节点"
                  description="输入 Figma URL + Token，或选择 Mock 预设加载示例"
                />
              )}
            </div>
          </div>

          {/* Right Column: Config + Code */}
          <div className="flex-1 flex flex-col min-w-0 bg-surface-900">
            {/* Config Bar */}
            <div className="p-3 border-b border-surface-700 bg-surface-800/30 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-1">组件名</label>
                <input
                  type="text"
                  value={componentName}
                  onChange={(e) => setComponentName(e.target.value)}
                  data-testid="figma-component-name"
                  className="px-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs text-slate-200"
                />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-1">框架</label>
                <select
                  value={framework}
                  onChange={(e) => setFramework(e.target.value as Framework)}
                  data-testid="figma-framework-select"
                  className="px-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs text-slate-200"
                >
                  <option value="react">React</option>
                  <option value="vue">Vue</option>
                  <option value="html">HTML</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-1">样式</label>
                <select
                  value={styling}
                  onChange={(e) => setStyling(e.target.value as Styling)}
                  data-testid="figma-styling-select"
                  className="px-2 py-1 bg-surface-900 border border-surface-700 rounded text-xs text-slate-200"
                >
                  <option value="tailwind">Tailwind</option>
                  <option value="css-modules">CSS Modules</option>
                  <option value="inline">内联样式</option>
                </select>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-300 col-span-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeComments}
                    onChange={(e) => setIncludeComments(e.target.checked)}
                    data-testid="figma-comments-toggle"
                    className="rounded"
                  />
                  注释
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={extractImages}
                    onChange={(e) => setExtractImages(e.target.checked)}
                    data-testid="figma-images-toggle"
                    className="rounded"
                  />
                  提取图片
                </label>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  data-testid="figma-generate"
                  className="ml-auto px-3 py-1 text-xs bg-gradient-to-r from-primary-500 to-pink-500 text-white rounded hover:from-primary-400 hover:to-pink-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generating ? '生成中...' : '生成代码'}
                </button>
              </div>
            </div>

            {/* Code Area */}
            <div className="flex-1 overflow-auto p-3 min-h-0">
              {generated ? (
                <div className="space-y-2">
                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2" data-testid="figma-stats">
                    <StatBox label="节点" value={generated.stats.nodeCount} testId="stat-nodes" />
                    <StatBox label="文本" value={generated.stats.textCount} testId="stat-text" />
                    <StatBox label="框架" value={generated.stats.frameCount} testId="stat-frames" />
                    <StatBox label="行数" value={generated.stats.lineCount} testId="stat-lines" />
                    <StatBox label="字节" value={generated.stats.bytes} testId="stat-bytes" />
                  </div>
                  {/* Warnings */}
                  {generated.warnings.length > 0 && (
                    <div
                      data-testid="figma-warnings"
                      className="px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded text-[11px] text-amber-300"
                    >
                      <div className="font-medium mb-1">⚠️ 警告 ({generated.warnings.length})</div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {generated.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {/* Code Block */}
                  <div className="relative">
                    <div className="absolute top-2 right-2 flex items-center gap-2 z-10">
                      <span className="text-[10px] text-slate-500 px-2 py-0.5 bg-surface-800 rounded">
                        {FRAMEWORK_LABELS[generated.framework]} · {STYLING_LABELS[generated.styling]}
                      </span>
                      <button
                        onClick={handleCopy}
                        data-testid="figma-copy"
                        className="px-2 py-0.5 text-[10px] text-slate-300 hover:text-white border border-surface-700 rounded bg-surface-800"
                      >
                        {copySuccess ? '✓ 已复制' : '📋 复制'}
                      </button>
                      <button
                        onClick={handleDownload}
                        data-testid="figma-download"
                        className="px-2 py-0.5 text-[10px] text-slate-300 hover:text-white border border-surface-700 rounded bg-surface-800"
                      >
                        ⬇ 下载
                      </button>
                    </div>
                    <pre
                      data-testid="figma-code-block"
                      className="bg-surface-950 border border-surface-700 rounded p-3 text-[11px] text-slate-200 overflow-auto max-h-[60vh] font-mono leading-relaxed"
                    >
                      <code>{generated.code}</code>
                    </pre>
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon="✨"
                  title="未生成代码"
                  description="加载节点后点击「生成代码」按钮"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 统计小框
 */
function StatBox({ label, value, testId }: { label: string; value: number | string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="px-3 py-2 bg-surface-800/50 border border-surface-700 rounded"
    >
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default FigmaImportPanel;
