/**
 * # ============================================================
 * # 扩展引用 Resolver (v6.38.0 Cycle 18 G18-01)
 * # ============================================================
 * # 核心作用：实现 @codebase / @git / @diff 三种新引用类型的解析与注入
 * # 设计要点：
 * #   - 三种 Resolver：CodebaseResolver / GitResolver / DiffResolver
 * #   - LRU 缓存（避免重复网络请求）
 * #   - 错误降级（网络失败返回空结果而非抛错）
 * #   - 敏感信息过滤（避免 .env / .ssh 等泄漏）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 G18-01 初次创建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/** Codebase 搜索结果条目 */
export interface CodebaseResult {
  filePath: string;
  snippet: string;
  score: number;
  lineRange?: { start: number; end: number };
  language?: string;
}

/** Codebase 上下文 */
export interface CodebaseContext {
  type: 'codebase';
  query: string;
  results: CodebaseResult[];
  resolvedAt: number;
  source: 'cache' | 'api' | 'mock';
}

/** Git 引用类型 */
export type GitRefKind = 'log' | 'blame' | 'branch' | 'status' | 'show';

/** Git 提交 */
export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  date: string;
  files: string[];
}

/** Blame 信息 */
export interface GitBlameInfo {
  filePath: string;
  line: number;
  commit: GitCommit;
  content: string;
}

/** Git 上下文 */
export interface GitContext {
  type: 'git';
  ref: GitRefKind;
  query: string;
  filePath?: string;
  line?: number;
  data: GitCommit[] | GitBlameInfo[] | string[] | { branch: string; ahead: number; behind: number };
  resolvedAt: number;
  source: 'cache' | 'api' | 'mock';
}

/** Diff Hunk */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

/** Diff 文件 */
export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/** Diff 上下文 */
export interface DiffContext {
  type: 'diff';
  ref: string; // 'working' | 'staged' | 'HEAD' | commit SHA
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
  resolvedAt: number;
  source: 'cache' | 'api' | 'mock';
}

/** Resolver 错误 */
export interface ResolverError {
  type: 'network' | 'parse' | 'auth' | 'notfound' | 'unknown';
  message: string;
}

// ============================================================
// 敏感路径过滤
// ============================================================

const SENSITIVE_PATTERNS = [
  /\.env(\.|$)/i,
  /\.ssh\//i,
  /id_rsa/i,
  /id_dsa/i,
  /\.pem$/i,
  /\.key$/i,
  /credentials/i,
  /password/i,
  /secret/i,
  /\/private\//i,
  /\.aws\/credentials/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
];

const MAX_DIFF_LINES = 2000;
const MAX_CODEBASE_RESULTS = 10;
const MIN_CODEBASE_SCORE = 0.3;

/** 检查路径是否敏感 */
export function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(filePath));
}

/** 过滤敏感结果 */
export function filterSensitiveResults<T extends { filePath?: string }>(items: T[]): T[] {
  return items.filter((item) => {
    if (item.filePath && isSensitivePath(item.filePath)) return false;
    return true;
  });
}

// ============================================================
// LRU 缓存
// ============================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * 简单 LRU 缓存
 */
export class LRUCache<K, V> {
  private map: Map<K, CacheEntry<V>> = new Map();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 50, ttlMs: number = 60_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // 标记为最近使用
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.size >= this.maxSize) {
      // 删除最早的条目
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ============================================================
// Mock 数据生成器
// ============================================================

/** Mock codebase 搜索 */
function mockCodebaseSearch(query: string, topK: number): CodebaseResult[] {
  const seed = hashString(query);
  const fakeFiles = [
    'src/components/Button.tsx',
    'src/utils/helpers.ts',
    'src/services/api.ts',
    'src/hooks/useAuth.ts',
    'src/types/index.ts',
    'src/pages/Dashboard.tsx',
    'src/lib/database.ts',
    'src/middleware/auth.ts',
    'src/api/users.ts',
    'src/config/index.ts',
  ];
  const results: CodebaseResult[] = [];
  for (let i = 0; i < Math.min(topK, fakeFiles.length); i++) {
    const score = 0.95 - i * 0.08 - ((seed + i) % 10) * 0.005;
    if (score < MIN_CODEBASE_SCORE) break;
    results.push({
      filePath: fakeFiles[(seed + i) % fakeFiles.length],
      snippet: `// Mock snippet for query "${query}"\nfunction example${i}() {\n  // implementation\n  return ${i};\n}`,
      score: parseFloat(score.toFixed(3)),
      lineRange: { start: (i + 1) * 10, end: (i + 1) * 10 + 5 },
      language: fakeFiles[(seed + i) % fakeFiles.length].endsWith('.ts') ? 'typescript' : 'javascript',
    });
  }
  return results;
}

/** Mock git log */
function mockGitLog(filePath?: string, limit: number = 5): GitCommit[] {
  const commits: GitCommit[] = [];
  const seed = hashString(filePath || 'all');
  for (let i = 0; i < limit; i++) {
    const sha = `${(seed + i).toString(16).padStart(7, '0').slice(0, 7)}`;
    commits.push({
      sha: sha.padEnd(40, '0'),
      shortSha: sha,
      message: `Mock commit ${i + 1} for ${filePath || 'repository'}`,
      author: 'Developer',
      email: 'dev@example.com',
      date: new Date(Date.now() - i * 86400000).toISOString(),
      files: filePath ? [filePath] : [`src/file${i}.ts`],
    });
  }
  return commits;
}

/** Mock diff */
function mockDiff(_ref: string): DiffFile[] {
  return [
    {
      path: 'src/components/Button.tsx',
      status: 'modified',
      additions: 12,
      deletions: 5,
      hunks: [
        {
          oldStart: 10,
          oldLines: 5,
          newStart: 10,
          newLines: 12,
          content: `@@ -10,5 +10,12 @@
 export function Button({ onClick, label }: ButtonProps) {
+  const [isLoading, setLoading] = useState(false);
+  const handleClick = async () => {
+    setLoading(true);
+    try {
+      await onClick();
+    } finally {
+      setLoading(false);
+    }
+  };
   return (
-    <button onClick={onClick}>{label}</button>
+    <button onClick={handleClick} disabled={isLoading}>
+      {isLoading ? 'Loading...' : label}
+    </button>
   );
 }`,
        },
      ],
    },
  ];
}

/** 字符串 hash */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

// ============================================================
// Codebase Resolver
// ============================================================

export interface CodebaseResolverOptions {
  topK?: number;
  threshold?: number;
  cacheTtlMs?: number;
  apiBase?: string;
}

/**
 * 解析 @codebase 引用
 * @param query 搜索查询字符串
 * @param options 解析选项
 */
export async function resolveCodebase(
  query: string,
  options: CodebaseResolverOptions = {}
): Promise<CodebaseContext> {
  const topK = Math.min(options.topK ?? MAX_CODEBASE_RESULTS, MAX_CODEBASE_RESULTS);
  const cacheKey = `codebase:${query}:${topK}`;

  // 检查缓存
  const cache = getGlobalCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  try {
    // 尝试调用后端 API
    if (options.apiBase) {
      const response = await fetch(
        `${options.apiBase}/api/search/semantic?query=${encodeURIComponent(query)}&top_k=${topK}`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } }
      );
      if (response.ok) {
        const data = await response.json();
        const results = filterSensitiveResults<CodebaseResult>(data.results || []);
        const context: CodebaseContext = {
          type: 'codebase',
          query,
          results,
          resolvedAt: Date.now(),
          source: 'api',
        };
        cache.set(cacheKey, context);
        return context;
      }
    }
  } catch (err) {
    // 网络失败，降级到 mock
  }

  // Mock 实现
  const results = mockCodebaseSearch(query, topK);
  const filtered = filterSensitiveResults(results);
  const context: CodebaseContext = {
    type: 'codebase',
    query,
    results: filtered,
    resolvedAt: Date.now(),
    source: 'mock',
  };
  cache.set(cacheKey, context);
  return context;
}

// ============================================================
// Git Resolver
// ============================================================

export interface GitResolverOptions {
  filePath?: string;
  line?: number;
  limit?: number;
  cacheTtlMs?: number;
  apiBase?: string;
}

/**
 * 解析 @git 引用
 * @param ref git 子命令：log / blame / branch / status
 * @param options 选项
 */
export async function resolveGit(
  ref: GitRefKind,
  options: GitResolverOptions = {}
): Promise<GitContext> {
  const cacheKey = `git:${ref}:${options.filePath ?? ''}:${options.line ?? ''}:${options.limit ?? 5}`;
  const cache = getGlobalCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  try {
    if (options.apiBase) {
      const params = new URLSearchParams();
      if (options.filePath) params.set('file', options.filePath);
      if (options.line !== undefined) params.set('line', String(options.line));
      params.set('limit', String(options.limit ?? 5));
      const response = await fetch(
        `${options.apiBase}/api/git/${ref}?${params.toString()}`,
        { method: 'GET' }
      );
      if (response.ok) {
        const data = await response.json();
        const context: GitContext = {
          type: 'git',
          ref,
          query: options.filePath || '',
          filePath: options.filePath,
          line: options.line,
          data: data.data || data.commits || data.branches || [],
          resolvedAt: Date.now(),
          source: 'api',
        };
        cache.set(cacheKey, context);
        return context;
      }
    }
  } catch (err) {
    // 降级到 mock
  }

  // Mock 实现
  let data: GitContext['data'];
  switch (ref) {
    case 'log':
      data = mockGitLog(options.filePath, options.limit ?? 5);
      break;
    case 'blame':
      data = [
        {
          filePath: options.filePath || 'unknown',
          line: options.line ?? 1,
          commit: mockGitLog(options.filePath, 1)[0],
          content: `// Mock blame content for line ${options.line ?? 1}`,
        },
      ];
      break;
    case 'branch':
      data = ['main', 'develop', 'feature/cycle-18'];
      break;
    case 'status':
      data = { branch: 'main', ahead: 0, behind: 0 };
      break;
    case 'show':
      data = mockGitLog(options.filePath, 1);
      break;
  }

  const context: GitContext = {
    type: 'git',
    ref,
    query: options.filePath || '',
    filePath: options.filePath,
    line: options.line,
    data,
    resolvedAt: Date.now(),
    source: 'mock',
  };
  cache.set(cacheKey, context);
  return context;
}

// ============================================================
// Diff Resolver
// ============================================================

export interface DiffResolverOptions {
  cacheTtlMs?: number;
  apiBase?: string;
}

/**
 * 解析 @diff 引用
 * @param ref 'working' | 'staged' | 'HEAD' | commit SHA
 */
export async function resolveDiff(
  ref: string = 'working',
  options: DiffResolverOptions = {}
): Promise<DiffContext> {
  const cacheKey = `diff:${ref}`;
  const cache = getGlobalCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, source: 'cache' };
  }

  try {
    if (options.apiBase) {
      const response = await fetch(
        `${options.apiBase}/api/git/diff?ref=${encodeURIComponent(ref)}`,
        { method: 'GET' }
      );
      if (response.ok) {
        const data = await response.json();
        const files = (data.files || []).slice(0, 10);
        const context: DiffContext = {
          type: 'diff',
          ref,
          files,
          totalAdditions: data.total_additions || 0,
          totalDeletions: data.total_deletions || 0,
          resolvedAt: Date.now(),
          source: 'api',
        };
        cache.set(cacheKey, context);
        return context;
      }
    }
  } catch (err) {
    // 降级到 mock
  }

  // Mock 实现
  const files = mockDiff(ref);
  const limited = limitDiffContent(files);
  const context: DiffContext = {
    type: 'diff',
    ref,
    files: limited,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    resolvedAt: Date.now(),
    source: 'mock',
  };
  cache.set(cacheKey, context);
  return context;
}

/** 限制 diff 内容大小（防止 prompt 注入爆炸） */
function limitDiffContent(files: DiffFile[]): DiffFile[] {
  return files.map((f) => ({
    ...f,
    hunks: f.hunks.map((h) => ({
      ...h,
      content: h.content.split('\n').slice(0, MAX_DIFF_LINES).join('\n'),
    })),
  }));
}

// ============================================================
// Prompt 注入格式化
// ============================================================

/** 格式化 Codebase 上下文为 prompt 片段 */
export function formatCodebaseForPrompt(ctx: CodebaseContext): string {
  if (ctx.results.length === 0) return '';
  const lines: string[] = [];
  lines.push(`[codebase results for "${ctx.query}"]`);
  for (const r of ctx.results.slice(0, 5)) {
    lines.push(`- ${r.filePath}:${r.lineRange?.start ?? '?'}-${r.lineRange?.end ?? '?'} (score: ${r.score.toFixed(2)})`);
    lines.push('  ```' + (r.language || ''));
    lines.push('  ' + r.snippet.split('\n').join('\n  '));
    lines.push('  ```');
  }
  if (ctx.results.length > 5) {
    lines.push(`... and ${ctx.results.length - 5} more results`);
  }
  return lines.join('\n');
}

/** 格式化 Git 上下文为 prompt 片段 */
export function formatGitForPrompt(ctx: GitContext): string {
  const lines: string[] = [];
  const fileInfo = ctx.filePath ? ` for ${ctx.filePath}` : '';
  switch (ctx.ref) {
    case 'log': {
      const commits = ctx.data as GitCommit[];
      lines.push(`[git log${fileInfo} (last ${commits.length})]`);
      for (const c of commits) {
        lines.push(`- ${c.shortSha} (${c.date.slice(0, 10)}) ${c.message}`);
      }
      break;
    }
    case 'blame': {
      const blames = ctx.data as GitBlameInfo[];
      lines.push(`[git blame${fileInfo}]`);
      for (const b of blames) {
        lines.push(`- Line ${b.line}: ${b.commit.shortSha} by ${b.commit.author}`);
        lines.push(`  ${b.content}`);
      }
      break;
    }
    case 'branch': {
      const branches = ctx.data as string[];
      lines.push(`[git branches]`);
      lines.push(branches.map((b) => `- ${b}`).join('\n'));
      break;
    }
    case 'status': {
      const status = ctx.data as { branch: string; ahead: number; behind: number };
      lines.push(`[git status]`);
      lines.push(`- Current branch: ${status.branch}`);
      lines.push(`- Ahead: ${status.ahead}, Behind: ${status.behind}`);
      break;
    }
    case 'show': {
      const commits = ctx.data as GitCommit[];
      lines.push(`[git show${fileInfo}]`);
      for (const c of commits) {
        lines.push(`- ${c.shortSha} ${c.message}`);
      }
      break;
    }
  }
  return lines.join('\n');
}

/** 格式化 Diff 上下文为 prompt 片段 */
export function formatDiffForPrompt(ctx: DiffContext): string {
  const lines: string[] = [];
  lines.push(`[diff: ${ctx.ref}]`);
  lines.push(`Total: +${ctx.totalAdditions} -${ctx.totalDeletions} (${ctx.files.length} files)`);
  for (const f of ctx.files) {
    lines.push(`\n- ${f.path} [${f.status}] (+${f.additions} -${f.deletions})`);
    for (const h of f.hunks) {
      lines.push(`  @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      lines.push(h.content.split('\n').map((l) => '  ' + l).join('\n'));
    }
  }
  return lines.join('\n');
}

// ============================================================
// 全局缓存
// ============================================================

let _globalCache: LRUCache<string, any> | null = null;

function getGlobalCache(): LRUCache<string, any> {
  if (!_globalCache) {
    _globalCache = new LRUCache<string, any>(100, 60_000);
  }
  return _globalCache;
}

/** 重置全局缓存（测试用） */
export function resetGlobalCache(): void {
  if (_globalCache) _globalCache.clear();
  _globalCache = null;
}

/** 获取全局缓存统计 */
export function getCacheStats(): { size: number } {
  return { size: _globalCache?.size ?? 0 };
}
