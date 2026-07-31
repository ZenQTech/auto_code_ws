/**
 * # ============================================================
 * # McpRagKnowledgeBase - MCP 资源 RAG 知识库 (v1.0.0 Cycle 45 G45-02)
 * # ============================================================
 * # 核心作用：将 MCP filesystem 资源自动构建为可语义检索的知识库
 * #           - 多格式文档加载器 (text/markdown/json/html/code)
 * #           - 自动类型检测 (扩展名 / MIME)
 * #           - 目录批量索引 (递归)
 * #           - 索引持久化 (JSON 导出/导入)
 * #           - 搜索历史 + 统计
 * #           - 文件变更检测 (mtime 比对)
 * # 对标产品：LlamaIndex SimpleDirectoryReader / LangChain FileSystemLoader
 * # 运行流程：
 * #   1. 初始化 McpRagKnowledgeBase (注入 mcpRagEngine)
 * #   2. addLoader() 注册自定义文档加载器
 * #   3. indexDirectory() 递归索引整个目录
 * #   4. addFile() 索引单个文件 (自动选择 loader)
 * #   5. search() 语义搜索
 * #   6. export() / import() 持久化索引
 * # 输入参数：文件路径 / URI / 目录
 * # 输出结果：索引条目 / 搜索结果 / 统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 45 G45-02 初次创建
 * # ============================================================
 */

import { McpRagEngine, type McpRagIndexEntry, type McpRagHit } from './mcpRagEngine';
import { type Document, TextLoader, MarkdownLoader, JSONLoader, HTMLLoader } from './ragEngine';

// ============ 类型定义 ============

/**
 * 文档加载器接口
 */
export interface KnowledgeBaseDocumentLoader {
  /** 加载器名称 */
  readonly name: string;
  /** 支持的 MIME 类型 */
  readonly supportedMimeTypes: string[];
  /** 支持的文件扩展名（小写，含点） */
  readonly supportedExtensions: string[];
  /** 加载文档 */
  load(source: {
    content: string;
    mimeType?: string;
    filename?: string;
  }): Promise<Document>;
}

/**
 * 索引文件信息
 */
export interface IndexedFileInfo {
  /** 文件 URI */
  uri: string;
  /** 文件名 */
  filename: string;
  /** 服务器 ID */
  serverId: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 文件大小（字节） */
  size: number;
  /** 修改时间 */
  modifiedAt: number;
  /** 索引时间 */
  indexedAt: number;
  /** 加载器名称 */
  loaderName: string;
  /** 关联的索引条目 */
  entry: McpRagIndexEntry;
}

/**
 * 目录索引结果
 */
export interface DirectoryIndexResult {
  /** 总文件数 */
  total: number;
  /** 成功索引数 */
  indexed: number;
  /** 跳过数（不支持类型） */
  skipped: number;
  /** 失败数 */
  failed: number;
  /** 耗时（毫秒） */
  durationMs: number;
  /** 索引的文件 */
  files: IndexedFileInfo[];
  /** 错误列表 */
  errors: Array<{ uri: string; filename: string; error: string }>;
}

/**
 * 搜索结果（含文件元数据）
 */
export interface KnowledgeBaseSearchResult extends McpRagHit {
  /** 文件元数据 */
  file: IndexedFileInfo;
}

/**
 * 知识库统计
 */
export interface KnowledgeBaseStats {
  totalFiles: number;
  totalChunks: number;
  totalSearches: number;
  totalBytes: number;
  avgSearchTimeMs: number;
  loaders: string[];
  serverBreakdown: Record<string, number>;
  mimeTypeBreakdown: Record<string, number>;
}

/**
 * 搜索历史记录
 */
export interface SearchHistoryEntry {
  query: string;
  hitCount: number;
  durationMs: number;
  timestamp: number;
}

/**
 * 持久化数据结构
 */
export interface KnowledgeBaseSnapshot {
  version: string;
  createdAt: number;
  files: Array<{
    uri: string;
    serverId: string;
    filename: string;
    mimeType?: string;
    size: number;
    modifiedAt: number;
    indexedAt: number;
    loaderName: string;
    documentId: string;
  }>;
  searchHistory: SearchHistoryEntry[];
}

// ============ 内置加载器 ============

/**
 * 代码文件加载器
 * - 支持 .ts .tsx .js .jsx .py .go .rs .java 等
 * - 简单去除注释 + 规范化空白
 */
export class CodeLoader implements KnowledgeBaseDocumentLoader {
  readonly name = 'code';
  readonly supportedMimeTypes: string[] = [
    'text/x-typescript',
    'text/typescript',
    'application/typescript',
    'text/javascript',
    'application/javascript',
    'text/x-python',
    'text/x-go',
    'text/x-rust',
    'text/x-java',
    'text/x-c',
    'text/x-cpp',
  ];
  readonly supportedExtensions: string[] = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.py', '.pyx',
    '.go',
    '.rs',
    '.java',
    '.c', '.h', '.cpp', '.hpp', '.cc',
    '.rb', '.php', '.sh', '.bash',
  ];

  async load(source: { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    let content = source.content;

    // 移除多行注释 /* ... */
    content = content.replace(/\/\*[\s\S]*?\*\//g, '');
    // 移除单行注释 // ...
    content = content.replace(/\/\/.*$/gm, '');
    // 移除 Python 注释 # ...
    content = content.replace(/^\s*#.*$/gm, '');
    // 规范化空白
    content = content.replace(/\n\s*\n/g, '\n\n').trim();

    return {
      id: `code_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content,
      metadata: {
        source: source.filename ?? 'inline.code',
        title: source.filename ?? 'code',
        mimeType: source.mimeType ?? 'text/x-typescript',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        size: content.length,
        isCode: true,
      },
    };
  }
}

/**
 * Markdown 加载器（基于内置 MarkdownLoader）
 */
export class KnowledgeBaseMarkdownLoader implements KnowledgeBaseDocumentLoader {
  readonly name = 'markdown';
  readonly supportedMimeTypes = ['text/markdown', 'text/x-markdown'];
  readonly supportedExtensions = ['.md', '.markdown', '.mdown'];
  private innerLoader = new MarkdownLoader();

  async load(source: { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    return await this.innerLoader.load(source);
  }
}

/**
 * JSON 加载器
 */
export class KnowledgeBaseJSONLoader implements KnowledgeBaseDocumentLoader {
  readonly name = 'json';
  readonly supportedMimeTypes = ['application/json', 'text/json'];
  readonly supportedExtensions = ['.json', '.jsonc', '.json5'];
  private innerLoader = new JSONLoader();

  async load(source: { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    return await this.innerLoader.load(source);
  }
}

/**
 * HTML 加载器
 */
export class KnowledgeBaseHTMLLoader implements KnowledgeBaseDocumentLoader {
  readonly name = 'html';
  readonly supportedMimeTypes = ['text/html', 'application/xhtml+xml'];
  readonly supportedExtensions = ['.html', '.htm', '.xhtml'];
  private innerLoader = new HTMLLoader();

  async load(source: { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    return await this.innerLoader.load(source);
  }
}

/**
 * 纯文本加载器
 */
export class KnowledgeBaseTextLoader implements KnowledgeBaseDocumentLoader {
  readonly name = 'text';
  readonly supportedMimeTypes = ['text/plain', 'text/*'];
  readonly supportedExtensions = ['.txt', '.log', '.csv', '.tsv'];
  private innerLoader = new TextLoader();

  async load(source: { content: string; mimeType?: string; filename?: string }): Promise<Document> {
    return await this.innerLoader.load(source);
  }
}

// ============ McpRagKnowledgeBase 主类 ============

/**
 * MCP 资源 RAG 知识库
 *
 * 核心能力：
 *   1. 多格式文档加载（text/markdown/json/html/code）
 *   2. 自动类型检测
 *   3. 目录递归索引
 *   4. 索引持久化
 *   5. 搜索历史
 *   6. 增量更新（mtime 检测）
 */
export class McpRagKnowledgeBase {
  private ragEngine: McpRagEngine;
  private loaders: KnowledgeBaseDocumentLoader[] = [];
  /** URI → IndexedFileInfo */
  private files: Map<string, IndexedFileInfo> = new Map();
  /** 搜索历史（最近 100 条） */
  private searchHistory: SearchHistoryEntry[] = [];
  /** 累计搜索耗时 */
  private _totalSearchTimeMs = 0;

  constructor(ragEngine: McpRagEngine) {
    this.ragEngine = ragEngine;
    // 注册默认加载器（按优先级）
    this.registerLoader(new CodeLoader());
    this.registerLoader(new KnowledgeBaseMarkdownLoader());
    this.registerLoader(new KnowledgeBaseJSONLoader());
    this.registerLoader(new KnowledgeBaseHTMLLoader());
    this.registerLoader(new KnowledgeBaseTextLoader());
  }

  // ============ 加载器管理 ============

  /**
   * 注册加载器
   * - 高优先级加载器放前面
   */
  registerLoader(loader: KnowledgeBaseDocumentLoader): void {
    this.loaders.push(loader);
  }

  /**
   * 注销加载器
   */
  unregisterLoader(name: string): boolean {
    const idx = this.loaders.findIndex((l) => l.name === name);
    if (idx === -1) return false;
    this.loaders.splice(idx, 1);
    return true;
  }

  /**
   * 获取所有加载器
   */
  getLoaders(): KnowledgeBaseDocumentLoader[] {
    return [...this.loaders];
  }

  /**
   * 根据 MIME 或扩展名选择加载器
   */
  selectLoader(mimeType?: string, filename?: string): KnowledgeBaseDocumentLoader | null {
    // 1. 先按 MIME 匹配
    if (mimeType) {
      for (const loader of this.loaders) {
        if (loader.supportedMimeTypes.includes(mimeType)) {
          return loader;
        }
        // 处理通配符 text/*
        for (const mt of loader.supportedMimeTypes) {
          if (mt.endsWith('/*') && mimeType.startsWith(mt.slice(0, -1))) {
            return loader;
          }
        }
      }
    }

    // 2. 按扩展名匹配
    if (filename) {
      const ext = this.getExtension(filename);
      if (ext) {
        for (const loader of this.loaders) {
          if (loader.supportedExtensions.includes(ext)) {
            return loader;
          }
        }
      }
    }

    return null;
  }

  /**
   * 获取文件扩展名
   */
  private getExtension(filename: string): string | null {
    const idx = filename.lastIndexOf('.');
    if (idx === -1) return null;
    const slashIdx = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
    if (slashIdx > idx) return null; // 扩展名在路径分隔符前
    return filename.substring(idx).toLowerCase();
  }

  // ============ 索引操作 ============

  /**
   * 索引单个文件
   * - 自动选择加载器
   * - 转换文档并通过 ragEngine.indexResource 添加
   */
  async addFile(
    serverId: string,
    resourceUri: string,
    content: string,
    options: {
      filename?: string;
      mimeType?: string;
      modifiedAt?: number;
      size?: number;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<IndexedFileInfo> {
    const filename = options.filename ?? resourceUri.split('/').pop() ?? 'unknown';
    const mimeType = options.mimeType;
    const loader = this.selectLoader(mimeType, filename);

    if (!loader) {
      throw new Error(
        `未找到适合的加载器: mimeType=${mimeType}, filename=${filename}`
      );
    }

    // 检查文件是否已存在（mtime 比对）
    const existing = this.files.get(resourceUri);
    if (existing && options.modifiedAt && existing.modifiedAt >= options.modifiedAt) {
      // 文件未变更，跳过
      return existing;
    }

    // 如果已存在，先删除旧索引
    if (existing) {
      await this.removeFile(resourceUri);
    }

    // 加载文档
    const doc = await loader.load({ content, mimeType, filename });

    // 通过 RAG 引擎索引（使用 preloadedContent 跳过 bridge 解析）
    const entry = await this.ragEngine.indexResource(serverId, resourceUri, {
      generateEmbedding: true,
      preloadedContent: {
        text: doc.content,
        mimeType,
        name: filename,
      },
      metadata: {
        ...options.metadata,
        originalMimeType: mimeType,
        loaderName: loader.name,
        modifiedAt: options.modifiedAt,
        size: options.size,
        filename,
      },
    });

    // 若未提供 mimeType，从加载器推断
    const finalMimeType = mimeType ?? loader.supportedMimeTypes[0];

    const fileInfo: IndexedFileInfo = {
      uri: resourceUri,
      filename,
      serverId,
      mimeType: finalMimeType,
      size: options.size ?? content.length,
      modifiedAt: options.modifiedAt ?? Date.now(),
      indexedAt: Date.now(),
      loaderName: loader.name,
      entry,
    };
    this.files.set(resourceUri, fileInfo);

    return fileInfo;
  }

  /**
   * 移除文件索引
   */
  async removeFile(uri: string): Promise<boolean> {
    const file = this.files.get(uri);
    if (!file) return false;
    this.files.delete(uri);
    await this.ragEngine.removeResourceIndex(uri);
    return true;
  }

  /**
   * 清空所有文件索引
   */
  async clearAllFiles(): Promise<number> {
    const uris = Array.from(this.files.keys());
    let removed = 0;
    for (const uri of uris) {
      if (await this.removeFile(uri)) removed++;
    }
    this.searchHistory = [];
    return removed;
  }

  // ============ 目录索引 ============

  /**
   * 索引目录
   * - 列出目录下所有资源
   * - 逐个 addFile
   * - 支持文件过滤（glob 模式）
   * - 支持递归
   *
   * 注意：需要资源桥接支持 listDirectory(directoryUri)
   */
  async indexDirectory(
    serverId: string,
    directoryUri: string,
    options: {
      recursive?: boolean;
      maxDepth?: number;
      filePattern?: RegExp;
      concurrency?: number;
      onProgress?: (indexed: number, total: number, current: string) => void;
    } = {}
  ): Promise<DirectoryIndexResult> {
    const startTime = Date.now();
    const concurrency = options.concurrency ?? 3;
    const errors: Array<{ uri: string; filename: string; error: string }> = [];
    const indexedFiles: IndexedFileInfo[] = [];
    let skipped = 0;

    // 1. 列出目录
    const files = await this.listDirectory(serverId, directoryUri, options.recursive ?? true);
    const total = files.length;

    // 2. 过滤
    const filtered = options.filePattern
      ? files.filter((f) => options.filePattern!.test(f.uri))
      : files;

    // 3. 并发索引
    let cursor = 0;
    const filteredTotal = filtered.length;

    async function worker(self: McpRagKnowledgeBase) {
      while (cursor < filteredTotal) {
        const idx = cursor++;
        const file = filtered[idx];
        try {
          // 检查是否有可用加载器
          const loader = self.selectLoader(file.mimeType, file.filename);
          if (!loader) {
            skipped++;
            continue;
          }

          // 读取内容
          const content = await self.readResource(serverId, file.uri);
          if (!content) {
            errors.push({ uri: file.uri, filename: file.filename, error: '内容为空' });
            continue;
          }

          // 索引
          const info = await self.addFile(serverId, file.uri, content, {
            filename: file.filename,
            mimeType: file.mimeType,
            modifiedAt: file.modifiedAt,
            size: file.size,
          });
          indexedFiles.push(info);

          if (options.onProgress) {
            options.onProgress(indexedFiles.length, filteredTotal, file.filename);
          }
        } catch (err) {
          errors.push({
            uri: file.uri,
            filename: file.filename,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const workers: Array<Promise<void>> = [];
    for (let i = 0; i < Math.min(concurrency, filteredTotal); i++) {
      workers.push(worker(this));
    }
    await Promise.all(workers);

    const durationMs = Date.now() - startTime;
    return {
      total,
      indexed: indexedFiles.length,
      skipped,
      failed: errors.length,
      durationMs,
      files: indexedFiles,
      errors,
    };
  }

  /**
   * 列出目录下文件
   * - 通过 MCP 资源桥接 listResources
   * - 简化实现：返回数组
   */
  private async listDirectory(
    serverId: string,
    directoryUri: string,
    recursive: boolean
  ): Promise<Array<{ uri: string; filename: string; mimeType?: string; modifiedAt: number; size: number }>> {
    const bridge = (this.ragEngine as any).resourceBridge as any;
    if (!bridge || typeof bridge.listResources !== 'function') {
      throw new Error('resourceBridge 未配置 listResources');
    }

    try {
      const all = await bridge.listResources(serverId);
      const prefix = directoryUri.endsWith('/') ? directoryUri : directoryUri + '/';
      return all
        .filter((r: any) => r.uri.startsWith(prefix))
        .filter((r: any) => recursive || !r.uri.substring(prefix.length).includes('/'))
        .map((r: any) => ({
          uri: r.uri,
          filename: r.name ?? r.uri.split('/').pop() ?? 'unknown',
          mimeType: r.mimeType,
          modifiedAt: Date.now(),
          size: 0,
        }));
    } catch {
      return [];
    }
  }

  /**
   * 读取资源内容
   */
  private async readResource(serverId: string, resourceUri: string): Promise<string | null> {
    const bridge = (this.ragEngine as any).resourceBridge as any;
    if (!bridge) return null;
    try {
      const resolved = await bridge.resolve(resourceUri);
      if (!resolved || !resolved.content) return null;
      const contents = Array.isArray(resolved.content) ? resolved.content : [resolved.content];
      let text = '';
      for (const c of contents) {
        if ('text' in c && c.text) {
          text += c.text + '\n\n';
        }
      }
      return text || null;
    } catch {
      return null;
    }
  }

  // ============ 搜索 ============

  /**
   * 语义搜索
   * - 委托给 ragEngine
   * - 增强结果含文件元数据
   * - 记录搜索历史
   */
  async search(
    query: string,
    options: {
      topK?: number;
      serverIds?: string[];
      mimeTypes?: string[];
      minScore?: number;
    } = {}
  ): Promise<KnowledgeBaseSearchResult[]> {
    const startTime = Date.now();

    // 1. 基础检索
    const hits = await this.ragEngine.retrieve(query, {
      topK: options.topK ?? 10,
      serverIds: options.serverIds,
      minScore: options.minScore,
    });

    // 2. 转换为知识库结果 + 应用 MIME 过滤
    const results: KnowledgeBaseSearchResult[] = [];
    for (const hit of hits) {
      // 找到文件元数据
      let file: IndexedFileInfo | undefined;
      if (hit.type === 'mcp-resource' && hit.resourceUri) {
        file = this.files.get(hit.resourceUri);
      } else if (hit.type === 'local-document') {
        // 本地文档：使用 documentId 作为 key
        file = this.files.get(hit.documentId);
      }

      // MIME 类型过滤
      if (options.mimeTypes && options.mimeTypes.length > 0 && file?.mimeType) {
        if (!options.mimeTypes.includes(file.mimeType)) {
          continue;
        }
      }

      // 跳过没有 file 信息的命中（不显示在 KB 结果中）
      if (!file) continue;

      results.push({
        ...hit,
        file,
      });
    }

    // 3. 记录历史
    const durationMs = Date.now() - startTime;
    this._totalSearchTimeMs += durationMs;
    this.searchHistory.push({
      query,
      hitCount: results.length,
      durationMs,
      timestamp: Date.now(),
    });
    if (this.searchHistory.length > 100) {
      this.searchHistory = this.searchHistory.slice(-100);
    }

    return results;
  }

  // ============ 持久化 ============

  /**
   * 导出知识库快照
   * - 文件清单
   * - 搜索历史
   * - 不含实际内容（内容仍由 RAG 引擎管理）
   */
  export(): KnowledgeBaseSnapshot {
    return {
      version: '1.0.0',
      createdAt: Date.now(),
      files: Array.from(this.files.values()).map((f) => ({
        uri: f.uri,
        serverId: f.serverId,
        filename: f.filename,
        mimeType: f.mimeType,
        size: f.size,
        modifiedAt: f.modifiedAt,
        indexedAt: f.indexedAt,
        loaderName: f.loaderName,
        documentId: f.entry.documentId,
      })),
      searchHistory: [...this.searchHistory],
    };
  }

  /**
   * 导入知识库快照
   * - 重建文件清单
   * - 不重建文档（需要调用方重新索引内容）
   */
  import(snapshot: KnowledgeBaseSnapshot): number {
    this.files.clear();
    this.searchHistory = snapshot.searchHistory ?? [];

    for (const fileData of snapshot.files) {
      // 构造一个虚拟的 IndexedFileInfo（不含 entry，因为 entry 依赖 RAG 引擎）
      const file: IndexedFileInfo = {
        uri: fileData.uri,
        serverId: fileData.serverId,
        filename: fileData.filename,
        mimeType: fileData.mimeType,
        size: fileData.size,
        modifiedAt: fileData.modifiedAt,
        indexedAt: fileData.indexedAt,
        loaderName: fileData.loaderName,
        entry: {
          id: `idx-${fileData.documentId}`,
          documentId: fileData.documentId,
          serverId: fileData.serverId,
          resourceUri: fileData.uri,
          resourceName: fileData.filename,
          mimeType: fileData.mimeType,
          indexedAt: fileData.indexedAt,
          chunkCount: 0,
          size: fileData.size,
        },
      };
      this.files.set(fileData.uri, file);
    }

    return snapshot.files.length;
  }

  /**
   * 序列化为 JSON
   */
  toJSON(): string {
    return JSON.stringify(this.export());
  }

  // ============ 统计 / 查询 ============

  /**
   * 获取统计
   */
  getStats(): KnowledgeBaseStats {
    const files = Array.from(this.files.values());
    const totalChunks = files.reduce((sum, f) => sum + f.entry.chunkCount, 0);
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

    const serverBreakdown: Record<string, number> = {};
    const mimeTypeBreakdown: Record<string, number> = {};
    for (const f of files) {
      serverBreakdown[f.serverId] = (serverBreakdown[f.serverId] ?? 0) + 1;
      const mt = f.mimeType ?? 'unknown';
      mimeTypeBreakdown[mt] = (mimeTypeBreakdown[mt] ?? 0) + 1;
    }

    return {
      totalFiles: this.files.size,
      totalChunks,
      totalSearches: this.searchHistory.length,
      totalBytes,
      avgSearchTimeMs:
        this.searchHistory.length > 0
          ? this._totalSearchTimeMs / this.searchHistory.length
          : 0,
      loaders: this.loaders.map((l) => l.name),
      serverBreakdown,
      mimeTypeBreakdown,
    };
  }

  /**
   * 列出所有文件
   */
  listFiles(filter?: { serverId?: string; mimeType?: string }): IndexedFileInfo[] {
    let files = Array.from(this.files.values());
    if (filter?.serverId) {
      files = files.filter((f) => f.serverId === filter.serverId);
    }
    if (filter?.mimeType) {
      files = files.filter((f) => f.mimeType === filter.mimeType);
    }
    return files;
  }

  /**
   * 获取文件信息
   */
  getFile(uri: string): IndexedFileInfo | undefined {
    return this.files.get(uri);
  }

  /**
   * 获取搜索历史
   */
  getSearchHistory(limit: number = 20): SearchHistoryEntry[] {
    return this.searchHistory.slice(-limit);
  }

  /**
   * 清空搜索历史
   */
  clearSearchHistory(): void {
    this.searchHistory = [];
  }

  /**
   * 检测文件变更
   * - 对比 modifiedAt
   * - 返回需要重新索引的文件 URI 列表
   */
  detectChanges(
    currentFiles: Array<{ uri: string; modifiedAt: number }>
  ): { updated: string[]; removed: string[]; unchanged: string[] } {
    const updated: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    const currentUris = new Set(currentFiles.map((f) => f.uri));
    for (const f of currentFiles) {
      const existing = this.files.get(f.uri);
      if (!existing) {
        updated.push(f.uri);
      } else if (existing.modifiedAt < f.modifiedAt) {
        updated.push(f.uri);
      } else {
        unchanged.push(f.uri);
      }
    }
    for (const uri of this.files.keys()) {
      if (!currentUris.has(uri)) {
        removed.push(uri);
      }
    }

    return { updated, removed, unchanged };
  }
}

// ============ 工厂函数 ============

/**
 * 创建 McpRagKnowledgeBase 实例
 */
export function createMcpRagKnowledgeBase(ragEngine: McpRagEngine): McpRagKnowledgeBase {
  return new McpRagKnowledgeBase(ragEngine);
}

export default McpRagKnowledgeBase;
