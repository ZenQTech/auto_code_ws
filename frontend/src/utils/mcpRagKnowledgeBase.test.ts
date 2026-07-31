/**
 * # ============================================================
 * # McpRagKnowledgeBase 测试 (v1.0.0 Cycle 45 G45-02)
 * # ============================================================
 * # 覆盖：知识库核心能力
 * #   1. 加载器注册 / 自动选择
 * #   2. 文件添加 / 移除
 * #   3. 目录索引
 * #   4. 语义搜索 + 搜索历史
 * #   5. 持久化 (export/import)
 * #   6. 变更检测
 * #   7. 统计
 * # ====================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  McpRagKnowledgeBase,
  createMcpRagKnowledgeBase,
  CodeLoader,
  KnowledgeBaseMarkdownLoader,
  KnowledgeBaseJSONLoader,
  KnowledgeBaseHTMLLoader,
  KnowledgeBaseTextLoader,
  type KnowledgeBaseDocumentLoader,
  type IndexedFileInfo,
  type KnowledgeBaseStats,
} from './mcpRagKnowledgeBase';
import { createMcpRagEngine } from './mcpRagEngine';

// ============ Mock Resource Bridge ============

function createMockBridge() {
  const resources = new Map<string, { info: any; content: any }>();
  return {
    resources,
    async resolve(uri: string) {
      return resources.get(uri) ?? null;
    },
    async listResources(_serverId: string) {
      return Array.from(resources.values()).map((r) => ({
        uri: r.info.uri,
        name: r.info.name,
        mimeType: r.info.mimeType,
        serverId: r.info.serverId,
      }));
    },
  };
}

// ============ Tests ============

describe('McpRagKnowledgeBase', () => {
  let kb: McpRagKnowledgeBase;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    bridge = createMockBridge();
    const ragEngine = createMcpRagEngine({ resourceBridge: bridge });
    kb = createMcpRagKnowledgeBase(ragEngine);
  });

  // ============ 工厂 / 初始化 ============

  describe('工厂和初始化', () => {
    it('createMcpRagKnowledgeBase 应返回实例', () => {
      expect(kb).toBeInstanceOf(McpRagKnowledgeBase);
    });

    it('默认应注册 5 个加载器', () => {
      const loaders = kb.getLoaders();
      expect(loaders.length).toBe(5);
      const names = loaders.map((l) => l.name);
      expect(names).toContain('code');
      expect(names).toContain('markdown');
      expect(names).toContain('json');
      expect(names).toContain('html');
      expect(names).toContain('text');
    });
  });

  // ============ 加载器管理 ============

  describe('加载器管理', () => {
    it('registerLoader 应能注册自定义加载器', () => {
      const before = kb.getLoaders().length;
      kb.registerLoader({
        name: 'custom',
        supportedMimeTypes: ['application/x-custom'],
        supportedExtensions: ['.custom'],
        async load() {
          return { id: 'c1', content: '', metadata: { source: 'x', createdAt: Date.now(), updatedAt: Date.now() } };
        },
      });
      expect(kb.getLoaders().length).toBe(before + 1);
    });

    it('unregisterLoader 应能注销加载器', () => {
      const ok = kb.unregisterLoader('code');
      expect(ok).toBe(true);
      expect(kb.getLoaders().find((l) => l.name === 'code')).toBeUndefined();
    });

    it('注销不存在的加载器应返回 false', () => {
      expect(kb.unregisterLoader('nonexistent')).toBe(false);
    });
  });

  // ============ Loader 自动选择 ============

  describe('selectLoader - 加载器选择', () => {
    it('应按 MIME 选择加载器', () => {
      const loader = kb.selectLoader('text/markdown', 'test.md');
      expect(loader?.name).toBe('markdown');
    });

    it('应按文件扩展名选择加载器', () => {
      const loader = kb.selectLoader(undefined, 'script.ts');
      expect(loader?.name).toBe('code');
    });

    it('应支持 text/* 通配符', () => {
      const loader = kb.selectLoader('text/yaml', 'config.yaml');
      expect(loader).not.toBeNull();
    });

    it('无匹配时应返回 null', () => {
      const loader = kb.selectLoader('image/png', 'image.png');
      expect(loader).toBeNull();
    });

    it('.json 应选择 json 加载器', () => {
      const loader = kb.selectLoader(undefined, 'data.json');
      expect(loader?.name).toBe('json');
    });

    it('.html 应选择 html 加载器', () => {
      const loader = kb.selectLoader(undefined, 'page.html');
      expect(loader?.name).toBe('html');
    });

    it('.txt 应选择 text 加载器', () => {
      const loader = kb.selectLoader(undefined, 'notes.txt');
      expect(loader?.name).toBe('text');
    });
  });

  // ============ 文件索引 ============

  describe('addFile - 文件索引', () => {
    it('应能索引文本文件', async () => {
      const file = await kb.addFile('fs', 'file:///test.txt', 'Hello world', {
        filename: 'test.txt',
        mimeType: 'text/plain',
        size: 11,
      });
      expect(file.uri).toBe('file:///test.txt');
      expect(file.serverId).toBe('fs');
      expect(file.filename).toBe('test.txt');
      expect(file.loaderName).toBe('text');
      expect(file.size).toBe(11);
    });

    it('应能索引 markdown 文件', async () => {
      const file = await kb.addFile('fs', 'file:///doc.md', '# Title\n\nContent', {
        filename: 'doc.md',
      });
      expect(file.loaderName).toBe('markdown');
    });

    it('应能索引 JSON 文件', async () => {
      const file = await kb.addFile('fs', 'file:///data.json', '{"key":"value"}', {
        filename: 'data.json',
      });
      expect(file.loaderName).toBe('json');
    });

    it('不支持的扩展名应抛出错误', async () => {
      await expect(
        kb.addFile('fs', 'file:///image.png', 'binary', { filename: 'image.png' })
      ).rejects.toThrow(/未找到适合的加载器/);
    });

    it('mtime 未变更时应跳过', async () => {
      const t = Date.now();
      const f1 = await kb.addFile('fs', 'file:///a.txt', 'content', {
        filename: 'a.txt',
        modifiedAt: t,
      });
      const f2 = await kb.addFile('fs', 'file:///a.txt', 'NEW content', {
        filename: 'a.txt',
        modifiedAt: t,
      });
      // 跳过，不更新
      expect(f2.indexedAt).toBe(f1.indexedAt);
    });

    it('mtime 较新时应重新索引', async () => {
      const t = Date.now();
      await kb.addFile('fs', 'file:///a.txt', 'OLD', { filename: 'a.txt', modifiedAt: t });
      const f2 = await kb.addFile('fs', 'file:///a.txt', 'NEW', {
        filename: 'a.txt',
        modifiedAt: t + 1000,
      });
      expect(f2.modifiedAt).toBe(t + 1000);
    });
  });

  // ============ 文件移除 / 清空 ============

  describe('文件移除和清空', () => {
    beforeEach(async () => {
      await kb.addFile('fs', 'file:///a.txt', 'A content', { filename: 'a.txt' });
      await kb.addFile('fs', 'file:///b.txt', 'B content', { filename: 'b.txt' });
    });

    it('removeFile 应能移除指定文件', async () => {
      const ok = await kb.removeFile('file:///a.txt');
      expect(ok).toBe(true);
      expect(kb.listFiles().length).toBe(1);
    });

    it('移除不存在的文件应返回 false', async () => {
      const ok = await kb.removeFile('file:///nonexistent.txt');
      expect(ok).toBe(false);
    });

    it('clearAllFiles 应清空所有文件', async () => {
      const removed = await kb.clearAllFiles();
      expect(removed).toBe(2);
      expect(kb.listFiles().length).toBe(0);
    });
  });

  // ============ 搜索 ============

  describe('search - 搜索', () => {
    beforeEach(async () => {
      await kb.addFile('fs', 'file:///cat.txt', 'Cats are wonderful pets. They love fish.', {
        filename: 'cat.txt',
      });
      await kb.addFile('fs', 'file:///dog.txt', 'Dogs are loyal companions. They love bones.', {
        filename: 'dog.txt',
      });
    });

    it('应能搜索相关内容', async () => {
      const results = await kb.search('cat');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].file.uri).toContain('cat');
    });

    it('topK 应限制返回数量', async () => {
      const results = await kb.search('pets', { topK: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('serverIds 应过滤结果', async () => {
      const results = await kb.search('cat', { serverIds: ['nonexistent'] });
      expect(results.length).toBe(0);
    });

    it('应记录搜索历史', async () => {
      await kb.search('cat');
      await kb.search('dog');
      const history = kb.getSearchHistory();
      expect(history.length).toBe(2);
    });

    it('clearSearchHistory 应清空历史', async () => {
      await kb.search('cat');
      kb.clearSearchHistory();
      expect(kb.getSearchHistory().length).toBe(0);
    });

    it('搜索历史应限制在最近 100 条', async () => {
      for (let i = 0; i < 110; i++) {
        await kb.search(`query ${i}`);
      }
      const history = kb.getSearchHistory(200);
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  // ============ 持久化 ============

  describe('export / import - 持久化', () => {
    beforeEach(async () => {
      await kb.addFile('fs', 'file:///a.txt', 'A content', { filename: 'a.txt' });
      await kb.addFile('fs', 'file:///b.md', '# Title', { filename: 'b.md' });
      await kb.search('content');
    });

    it('export 应返回完整快照', () => {
      const snapshot = kb.export();
      expect(snapshot.version).toBe('1.0.0');
      expect(snapshot.files.length).toBe(2);
      expect(snapshot.searchHistory.length).toBe(1);
    });

    it('toJSON 应能序列化为 JSON 字符串', () => {
      const json = kb.toJSON();
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.files.length).toBe(2);
    });

    it('import 应能恢复文件清单', () => {
      const snapshot = kb.export();
      const newKb = createMcpRagKnowledgeBase(createMcpRagEngine({ resourceBridge: bridge }));
      const count = newKb.import(snapshot);
      expect(count).toBe(2);
      expect(newKb.listFiles().length).toBe(2);
    });

    it('import 应能恢复搜索历史', () => {
      const snapshot = kb.export();
      const newKb = createMcpRagKnowledgeBase(createMcpRagEngine({ resourceBridge: bridge }));
      newKb.import(snapshot);
      expect(newKb.getSearchHistory().length).toBe(1);
    });
  });

  // ============ 变更检测 ============

  describe('detectChanges - 变更检测', () => {
    // 共享 timestamp: 避免 beforeEach 与 test 体时间漂移导致 flaky
    let beforeEachT: number;

    beforeEach(async () => {
      beforeEachT = Date.now();
      await kb.addFile('fs', 'file:///a.txt', 'A', { filename: 'a.txt', modifiedAt: beforeEachT });
      await kb.addFile('fs', 'file:///b.txt', 'B', { filename: 'b.txt', modifiedAt: beforeEachT });
    });

    it('应识别新增文件', () => {
      // 使用 beforeEach 时刻 + 小偏移, 避免 Date.now() 时间漂移
      const t = beforeEachT;
      const changes = kb.detectChanges([
        { uri: 'file:///a.txt', modifiedAt: t },
        { uri: 'file:///b.txt', modifiedAt: t },
        { uri: 'file:///c.txt', modifiedAt: t },
      ]);
      expect(changes.updated).toContain('file:///c.txt');
    });

    it('应识别已修改文件', () => {
      // 使用 beforeEach 时刻, a 标记为更新(+1000), b 标记为未变更
      const t = beforeEachT;
      const changes = kb.detectChanges([
        { uri: 'file:///a.txt', modifiedAt: t + 1000 }, // 新
        { uri: 'file:///b.txt', modifiedAt: t },
      ]);
      expect(changes.updated).toContain('file:///a.txt');
      expect(changes.unchanged).toContain('file:///b.txt');
    });

    it('应识别已删除文件', () => {
      // 使用 beforeEach 时刻, 只传 a, b 应识别为删除
      const t = beforeEachT;
      const changes = kb.detectChanges([
        { uri: 'file:///a.txt', modifiedAt: t },
      ]);
      expect(changes.removed).toContain('file:///b.txt');
    });
  });

  // ============ 统计 / 查询 ============

  describe('统计和查询', () => {
    beforeEach(async () => {
      await kb.addFile('fs', 'file:///a.txt', 'A', { filename: 'a.txt', size: 1 });
      await kb.addFile('fs', 'file:///b.md', '# B', { filename: 'b.md', size: 3 });
      await kb.addFile('git', 'file:///c.json', '{}', { filename: 'c.json', size: 2 });
    });

    it('getStats 应返回完整统计', () => {
      const stats = kb.getStats();
      expect(stats.totalFiles).toBe(3);
      expect(stats.totalBytes).toBe(6);
      expect(stats.serverBreakdown['fs']).toBe(2);
      expect(stats.serverBreakdown['git']).toBe(1);
      expect(stats.loaders).toContain('text');
      expect(stats.loaders).toContain('markdown');
    });

    it('listFiles 应能按 serverId 过滤', () => {
      const fsFiles = kb.listFiles({ serverId: 'fs' });
      expect(fsFiles.length).toBe(2);
    });

    it('listFiles 应能按 mimeType 过滤', () => {
      const mdFiles = kb.listFiles({ mimeType: 'text/markdown' });
      expect(mdFiles.length).toBe(1);
    });

    it('getFile 应能获取文件信息', () => {
      const f = kb.getFile('file:///a.txt');
      expect(f?.filename).toBe('a.txt');
    });
  });

  // ============ 内置加载器 ============

  describe('CodeLoader', () => {
    it('应能加载 TypeScript 代码', async () => {
      const loader = new CodeLoader();
      const doc = await loader.load({
        content: '// comment\nconst x = 1;\n/* multi\nline */\nconst y = 2;',
        mimeType: 'text/x-typescript',
        filename: 'test.ts',
      });
      expect(doc.content).not.toContain('// comment');
      expect(doc.content).not.toContain('/* multi');
      expect(doc.content).toContain('const x = 1');
    });

    it('应支持 Python 注释', async () => {
      const loader = new CodeLoader();
      const doc = await loader.load({
        content: '# comment\nx = 1\n# another\ny = 2',
        filename: 'test.py',
      });
      expect(doc.content).not.toContain('# comment');
      expect(doc.content).toContain('x = 1');
    });
  });
});
