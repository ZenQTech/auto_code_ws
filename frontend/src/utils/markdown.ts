/**
 * # ============================================================
 * # 共享 Markdown 渲染工具
 * # ============================================================
 * # 核心作用：将 Markdown 文本转换为 HTML 字符串，供多个组件复用
 * # 支持的语法：标题（h1-h3）、无序列表、有序列表、
#           代码块、行内代码、粗体、斜体、表格、分隔线、段落
# 输入参数：
#   - md: string，原始 Markdown 文本
# 返回值：string，HTML 字符串
# 修改记录：
#   - 2026-06-25 | v1.0.0 | 从 PlanViewer.tsx / ArchitectureViewer.tsx 提取合并
#   - 2026-07-01 | v1.1.0 | 新增表格渲染（|...| 语法 + 对齐符）和分隔线（---）渲染支持
# ============================================================
 */

/**
 * 简易 Markdown 转 HTML 渲染器
 * 作用：将 Markdown 文本转换为 HTML 字符串
 * 参数：
 *   - md: string，原始 Markdown 文本
 * 返回值：string，HTML 字符串
 */
export function renderMarkdown(md: string): string {
  if (!md) return '';

  // 对 HTML 特殊字符进行转义，防止 XSS 注入
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 代码块（```...```）—— 必须在行内代码之前处理
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const langLabel = lang ? `<span class="text-xs text-hermes-400 block mb-1">${lang}</span>` : '';
    return `<pre class="bg-surface-50 rounded-lg p-4 my-3 overflow-x-auto text-sm text-surface-800 font-mono leading-relaxed">${langLabel}${code.trim()}</pre>`;
  });

  // 表格（|...| 语法）—— 必须在段落拆分之前处理（跨多行）
  // 匹配：表头行 + 对齐行 + 一行或多行数据行
  html = html.replace(
    /^\|(.+)\|\n^\|([-: |]+)\|\n((?:^\|.+\|\n?)+)/gm,
    (_match: string, headerRow: string, _alignRow: string, dataRows: string) => {
      // 解析表头单元格
      const headers = headerRow.split('|').map((c: string) => c.trim()).filter(Boolean);
      // 解析数据行
      const rows = dataRows.trim().split('\n').filter(Boolean);
      const bodyRows = rows.map((row: string) =>
        row.split('|').map((c: string) => c.trim()).filter(Boolean)
      );

      // 构建表头 HTML
      const thead = `<thead><tr class="bg-surface-100">${headers.map((h: string) =>
        `<th class="border border-surface-400 px-3 py-2 text-left text-sm font-semibold text-surface-900">${h}</th>`
      ).join('')}</tr></thead>`;

      // 构建表体 HTML（斑马纹）
      const tbody = `<tbody>${bodyRows.map((cells: string[], ri: number) =>
        `<tr class="${ri % 2 === 0 ? 'bg-transparent' : 'bg-surface-50'}">${cells.map((c: string) =>
          `<td class="border border-surface-400 px-3 py-2 text-sm text-surface-800">${c}</td>`
        ).join('')}</tr>`
      ).join('')}</tbody>`;

      return `<div class="overflow-x-auto my-3"><table class="w-full border-collapse border border-surface-400 rounded-lg">${thead}${tbody}</table></div>`;
    }
  );

  // 分隔线（--- 单独一行）
  html = html.replace(/^---$/gm, '<hr class="border-surface-400 my-4">');

  // 行内代码（`code`）
  html = html.replace(/`([^`]+)`/g, '<code class="bg-surface-200 text-hermes-300 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');

  // 粗体（**text**）
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-surface-950 font-semibold">$1</strong>');

  // 斜体（*text*）
  html = html.replace(/\*([^*]+)\*/g, '<em class="text-surface-800 italic">$1</em>');

  // 标题（### 、## 、# ）
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-hermes-300 mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-hermes-200 mt-5 mb-3 border-b border-surface-400 pb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-hermes-100 mt-6 mb-3">$1</h1>');

  // 无序列表项（- item）
  html = html.replace(/^- (.+)$/gm, '<li class="text-surface-800 ml-4 list-disc my-1">$1</li>');

  // 有序列表项（1. item）
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="text-surface-800 ml-4 list-decimal my-1">$1</li>');

  // 将连续的 <li> 包裹在 <ul> 或 <ol> 中
  html = html.replace(/((?:<li class="text-surface-800 ml-4 list-disc my-1">.*?<\/li>\n?)+)/g, '<ul class="my-2">$1</ul>');
  html = html.replace(/((?:<li class="text-surface-800 ml-4 list-decimal my-1">.*?<\/li>\n?)+)/g, '<ol class="my-2">$1</ol>');

  // 普通段落：将非标签的连续文本行包裹在 <p> 中
  // 先按双换行分割段落
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(para => {
    const trimmed = para.trim();
    if (!trimmed) return '';
    // 如果段落已经包含 HTML 块级标签，不包裹
    if (/^<(h[1-3]|pre|ul|ol|li|div)/.test(trimmed)) return trimmed;
    // 将段落内的单换行转为 <br>
    const withBreaks = trimmed.replace(/\n/g, '<br>');
    return `<p class="text-surface-800 my-2 leading-relaxed">${withBreaks}</p>`;
  }).join('\n');

  return html;
}
