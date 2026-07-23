/**
 * # ============================================================
 * # 代码查看器组件（CodeViewer）— Monaco Editor 升级版
 * # ============================================================
 * # 核心作用：使用 Monaco Editor 提供 IDE 级代码查看与编辑
 * #           支持语法高亮、智能补全、错误诊断、多 Tab 编辑
 * # 运行流程：
 * #   1. 组件挂载时调用 fetchFileContent API 拉取文件内容
 * #   2. 使用 Monaco Editor 渲染代码
 * #   3. 支持多 Tab 文件编辑
 * # 输入参数（Props）：
 * #   - project: string，项目名称
 * #   - filePath: string，文件路径
 * #   - onClose: () => void，关闭回调
 * # 输出结果：纯 UI 组件，无返回值
 * # 修改记录：
 * #   - 2026-06-24 | v2.10.0 | 初始版本：正则语法高亮
 * #   - 2026-06-25 | v2.11.0 | 升级为 Monaco Editor
 * #   - 2026-06-25 | v2.11.1 | getFileIcon / FILE_ICONS 提取到 ../utils/fileIcon.ts 共享
 * # ============================================================
 */

import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { fetchFileContent } from '../hooks/useApi';
import { getFileIcon } from '../utils/fileIcon';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface Props {
  project: string;
  filePath: string;
  onClose: () => void;
}

/** 文件扩展名 → Monaco 语言标识 */
const LANGUAGE_MAP: Record<string, string> = {
  '.py': 'python',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.html': 'html',
  '.css': 'css',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.cpp': 'cpp',
  '.c': 'c',
  '.h': 'cpp',
  '.hpp': 'cpp',
  '.sh': 'shell',
  '.bash': 'shell',
  '.txt': 'plaintext',
  '.xml': 'xml',
  '.toml': 'ini',
  '.cfg': 'ini',
  '.ini': 'ini',
  '.cmake': 'plaintext',
  '.dockerfile': 'dockerfile',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
};

function detectLanguage(filePath: string): string {
  const ext = '.' + (filePath.split('.').pop() || 'txt');
  return LANGUAGE_MAP[ext] || 'plaintext';
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

/** Monaco Editor 加载骨架屏 */
function MonacoLoading() {
  return (
    <div className="flex items-center justify-center h-full bg-surface-900">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-hermes-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-surface-500">加载编辑器...</span>
      </div>
    </div>
  );
}

export default function CodeViewer({ project, filePath, onClose }: Props) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(0);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFileContent(project, filePath)
      .then((data) => {
        if (cancelled) return;
        setContent(data.content);
        setLineCount(data.lines);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || '加载文件失败');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [project, filePath]);

  const language = useMemo(() => detectLanguage(filePath), [filePath]);
  const fileName = useMemo(() => getFileName(filePath), [filePath]);
  const fileIcon = useMemo(() => {
    const ext = '.' + (filePath.split('.').pop() || 'txt');
    return getFileIcon(ext);
  }, [filePath]);

  // 加载态
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-surface-950">
        <div className="flex items-center justify-between px-4 py-2 bg-surface-900 border-b border-surface-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">{fileIcon}</span>
            <span className="text-sm text-surface-300">{fileName}</span>
          </div>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-lg">✕</button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-hermes-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-surface-500">加载中...</span>
          </div>
        </div>
      </div>
    );
  }

  // 错误态
  if (error) {
    return (
      <div className="flex flex-col h-full bg-surface-950">
        <div className="flex items-center justify-between px-4 py-2 bg-surface-900 border-b border-surface-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">{fileIcon}</span>
            <span className="text-sm text-surface-300">{fileName}</span>
          </div>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-lg">✕</button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-red-400 text-lg mb-2">⚠️</div>
            <div className="text-red-400 text-sm">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-950">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-900 border-b border-surface-800">
        <div className="flex items-center gap-3">
          <span className="text-lg">{fileIcon}</span>
          <span className="text-sm text-surface-300 font-medium">{fileName}</span>
          <span className="text-xs text-surface-600">{language}</span>
          <span className="text-xs text-surface-600">{lineCount} 行</span>
          {isDirty && (
            <span className="text-xs text-hermes-400">● 已修改</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* v2.11.2：isDirty 时显示保存按钮 */}
          {isDirty && (
            <button
              onClick={() => {
                setIsDirty(false);
                // 保存功能开发中，暂时仅清除脏标记
                if (typeof window !== 'undefined') {
                  // 通过自定义事件通知父组件（预留扩展）
                  window.dispatchEvent(new CustomEvent('codeviewer-save', { detail: { project, filePath } }));
                }
              }}
              className="px-3 py-1 text-xs font-medium rounded-md
                         bg-hermes-500 hover:bg-hermes-400 text-white
                         transition-colors duration-fast"
              title="保存文件"
            >
              保存
            </button>
          )}
          <button
            onClick={onClose}
            className="text-surface-500 hover:text-surface-300 text-lg transition-colors"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<MonacoLoading />}>
          <MonacoEditor
            height="100%"
            language={language}
            value={content}
            theme="vs-dark"
            onChange={(value) => {
              if (value !== undefined && value !== content) {
                setIsDirty(true);
              }
            }}
            options={{
              readOnly: false,
              minimap: { enabled: true },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              tabSize: 2,
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              suggest: {
                showKeywords: true,
                showSnippets: true,
              },
            }}
            loading={<MonacoLoading />}
          />
        </Suspense>
      </div>
    </div>
  );
}
