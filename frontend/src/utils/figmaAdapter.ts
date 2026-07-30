/**
 * # ============================================================
 * # FigmaAdapter - Figma 设计稿转代码 (v1.0.0 Cycle 24 G24-04)
 * # ============================================================
 * # 核心作用：解析 Figma URL + 节点树转换为 React/Vue/HTML 代码
 * # 运行流程：
 * #   1. parseUrl 提取 fileKey + nodeId
 * #   2. fetchFile/fetchNode 拉取数据（或使用 Mock）
 * #   3. toReact/toVue/toHtml 转换代码
 * #   4. 样式映射：Figma 颜色 → Tailwind class
 * # 输入参数：parseUrl(url), fetchFile(fileKey), toReact(node, options)
 * # 输出结果：GeneratedCode { code, framework, warnings, stats }
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-04 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * Figma 填充
 */
export interface FigmaFill {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'IMAGE' | 'PATTERN';
  color?: { r: number; g: number; b: number; a: number };
  opacity?: number;
  visible?: boolean;
}

/**
 * Figma 描边
 */
export interface FigmaStroke {
  type: 'SOLID';
  color: { r: number; g: number; b: number; a: number };
  weight: number;
}

/**
 * Figma 效果（阴影等）
 */
export interface FigmaEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
  visible?: boolean;
}

/**
 * Figma 文本样式
 */
export interface FigmaTextStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
}

/**
 * Figma 节点
 */
export interface FigmaNode {
  id: string;
  name: string;
  type: 'FRAME' | 'GROUP' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'COMPONENT' | 'INSTANCE' | 'VECTOR' | 'IMAGE';
  x: number;
  y: number;
  width: number;
  height: number;
  fills: FigmaFill[];
  strokes: FigmaStroke[];
  effects: FigmaEffect[];
  cornerRadius: number;
  characters?: string;
  style?: FigmaTextStyle;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  children?: FigmaNode[];
  visible?: boolean;
}

/**
 * Figma 文件
 */
export interface FigmaFile {
  name: string;
  document: FigmaNode;
  components: Record<string, FigmaNode>;
}

/**
 * 框架
 */
export type Framework = 'react' | 'vue' | 'html';

/**
 * 样式方案
 */
export type Styling = 'tailwind' | 'css-modules' | 'inline';

/**
 * 转换选项
 */
export interface FigmaToCodeOptions {
  framework: Framework;
  styling: Styling;
  includeComments: boolean;
  componentName: string;
  extractImages: boolean;
}

/**
 * 生成的代码
 */
export interface GeneratedCode {
  code: string;
  framework: Framework;
  styling: Styling;
  componentName: string;
  warnings: string[];
  stats: {
    nodeCount: number;
    textCount: number;
    frameCount: number;
    lineCount: number;
    bytes: number;
  };
}

/**
 * Figma 配置
 */
export interface FigmaConfig {
  accessToken: string;
  baseUrl: string;
  useMockData: boolean;
  cacheEnabled: boolean;
  cacheTtlMs: number;
}

/**
 * 解析 URL 结果
 */
export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

/**
 * 事件类型
 */
export type FigmaEventType = 'fetched' | 'converted' | 'error' | 'cache-hit' | 'config-updated';

export type FigmaEventHandler = (payload: any) => void;

/**
 * 默认配置
 */
export const DEFAULT_FIGMA_CONFIG: FigmaConfig = {
  accessToken: '',
  baseUrl: 'https://api.figma.com/v1',
  useMockData: true,
  cacheEnabled: true,
  cacheTtlMs: 5 * 60 * 1000, // 5 分钟
};

// ============ Tailwind 颜色映射 ============

/**
 * 将 RGB (0-1) 转换为 hex 颜色
 */
export function rgbaToHex(color: { r: number; g: number; b: number; a?: number }): string {
  const toHex = (v: number) => {
    const n = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

/**
 * Tailwind 颜色名映射
 */
const TAILWIND_COLORS: Record<string, string> = {
  '#000000': 'black',
  '#ffffff': 'white',
  '#ef4444': 'red-500',
  '#f87171': 'red-400',
  '#dc2626': 'red-600',
  '#f59e0b': 'amber-500',
  '#fbbf24': 'amber-400',
  '#d97706': 'amber-600',
  '#eab308': 'yellow-500',
  '#facc15': 'yellow-400',
  '#84cc16': 'lime-500',
  '#a3e635': 'lime-400',
  '#22c55e': 'green-500',
  '#4ade80': 'green-400',
  '#16a34a': 'green-600',
  '#10b981': 'emerald-500',
  '#34d399': 'emerald-400',
  '#059669': 'emerald-600',
  '#14b8a6': 'teal-500',
  '#2dd4bf': 'teal-400',
  '#0d9488': 'teal-600',
  '#06b6d4': 'cyan-500',
  '#22d3ee': 'cyan-400',
  '#0891b2': 'cyan-600',
  '#0ea5e9': 'sky-500',
  '#38bdf8': 'sky-400',
  '#0284c7': 'sky-600',
  '#3b82f6': 'blue-500',
  '#60a5fa': 'blue-400',
  '#2563eb': 'blue-600',
  '#6366f1': 'indigo-500',
  '#818cf8': 'indigo-400',
  '#4f46e5': 'indigo-600',
  '#8b5cf6': 'violet-500',
  '#a78bfa': 'violet-400',
  '#7c3aed': 'violet-600',
  '#a855f7': 'purple-500',
  '#c084fc': 'purple-400',
  '#9333ea': 'purple-600',
  '#d946ef': 'fuchsia-500',
  '#e879f9': 'fuchsia-400',
  '#c026d3': 'fuchsia-600',
  '#ec4899': 'pink-500',
  '#f472b6': 'pink-400',
  '#db2777': 'pink-600',
  '#f43f5e': 'rose-500',
  '#fb7185': 'rose-400',
  '#e11d48': 'rose-600',
  '#6b7280': 'gray-500',
  '#9ca3af': 'gray-400',
  '#4b5563': 'gray-600',
  '#374151': 'gray-700',
  '#1f2937': 'gray-800',
  '#111827': 'gray-900',
  '#d1d5db': 'gray-300',
  '#e5e7eb': 'gray-200',
  '#f3f4f6': 'gray-100',
  '#f9fafb': 'gray-50',
  '#1e293b': 'slate-800',
  '#0f172a': 'slate-900',
  '#334155': 'slate-700',
  '#475569': 'slate-600',
};

/**
 * 将 hex 颜色转换为 Tailwind class
 */
export function colorToTailwind(hex: string): string {
  const lower = hex.toLowerCase();
  if (TAILWIND_COLORS[lower]) return TAILWIND_COLORS[lower];
  return `[${hex}]`;
}

// ============ 事件总线 ============

export class FigmaEventBus {
  private listeners: Map<FigmaEventType, Set<FigmaEventHandler>> = new Map();

  on(type: FigmaEventType, handler: FigmaEventHandler): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  emit(type: FigmaEventType, payload: any): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (err) {
        // swallow
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(type?: FigmaEventType): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

// ============ 缓存 ============

interface CacheEntry {
  data: any;
  expiresAt: number;
}

// ============ Mock 数据 ============

export const FIGMA_MOCK_PRESETS: Record<string, FigmaNode> = {
  'button-primary': {
    id: 'mock-1',
    name: 'Primary Button',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 0.231, g: 0.51, b: 0.965, a: 1 } }],
    strokes: [],
    effects: [],
    cornerRadius: 8,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlignItems: 'CENTER',
    counterAxisAlignItems: 'CENTER',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 8,
    paddingBottom: 8,
    itemSpacing: 8,
    children: [
      {
        id: 'mock-1-text',
        name: 'Label',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 60,
        height: 24,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: 'Click me',
        style: { fontFamily: 'Inter', fontWeight: 600, fontSize: 14 },
      },
    ],
  },
  'card-simple': {
    id: 'mock-2',
    name: 'Card',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    strokes: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, weight: 1 }],
    effects: [{ type: 'DROP_SHADOW', radius: 4, color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 2 }, spread: 0 }],
    cornerRadius: 12,
    layoutMode: 'VERTICAL',
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 20,
    paddingBottom: 20,
    itemSpacing: 12,
    children: [
      {
        id: 'mock-2-title',
        name: 'Title',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 200,
        height: 28,
        fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: 'Card Title',
        style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 20 },
      },
      {
        id: 'mock-2-desc',
        name: 'Description',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 280,
        height: 60,
        fills: [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4, a: 1 } }],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: 'This is a card description that explains the content.',
        style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 14, lineHeightPx: 22 },
      },
    ],
  },
  'input-field': {
    id: 'mock-3',
    name: 'Input Field',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 280,
    height: 44,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    strokes: [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, weight: 1 }],
    effects: [],
    cornerRadius: 6,
    layoutMode: 'HORIZONTAL',
    counterAxisAlignItems: 'CENTER',
    paddingLeft: 14,
    paddingRight: 14,
    itemSpacing: 8,
    children: [
      {
        id: 'mock-3-placeholder',
        name: 'Placeholder',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 200,
        height: 20,
        fills: [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6, a: 1 } }],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: 'Enter text...',
        style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 14 },
      },
    ],
  },
  'navbar': {
    id: 'mock-4',
    name: 'Navbar',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 1200,
    height: 64,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    strokes: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, weight: 1 }],
    effects: [],
    cornerRadius: 0,
    layoutMode: 'HORIZONTAL',
    primaryAxisAlignItems: 'SPACE_BETWEEN',
    counterAxisAlignItems: 'CENTER',
    paddingLeft: 32,
    paddingRight: 32,
    children: [
      {
        id: 'mock-4-logo',
        name: 'Logo',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 100,
        height: 28,
        fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: 'Brand',
        style: { fontFamily: 'Inter', fontWeight: 700, fontSize: 20 },
      },
      {
        id: 'mock-4-menu',
        name: 'Menu',
        type: 'FRAME',
        x: 0,
        y: 0,
        width: 300,
        height: 24,
        fills: [],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        layoutMode: 'HORIZONTAL',
        itemSpacing: 24,
        children: [
          { id: 'm1', name: 'Home', type: 'TEXT', x: 0, y: 0, width: 40, height: 20, fills: [], strokes: [], effects: [], cornerRadius: 0, characters: 'Home', style: { fontFamily: 'Inter', fontWeight: 500, fontSize: 14 } },
          { id: 'm2', name: 'About', type: 'TEXT', x: 0, y: 0, width: 50, height: 20, fills: [], strokes: [], effects: [], cornerRadius: 0, characters: 'About', style: { fontFamily: 'Inter', fontWeight: 500, fontSize: 14 } },
          { id: 'm3', name: 'Contact', type: 'TEXT', x: 0, y: 0, width: 60, height: 20, fills: [], strokes: [], effects: [], cornerRadius: 0, characters: 'Contact', style: { fontFamily: 'Inter', fontWeight: 500, fontSize: 14 } },
        ],
      },
    ],
  },
  'alert': {
    id: 'mock-5',
    name: 'Alert',
    type: 'FRAME',
    x: 0,
    y: 0,
    width: 360,
    height: 80,
    fills: [{ type: 'SOLID', color: { r: 0.99, g: 0.95, b: 0.78, a: 1 } }],
    strokes: [{ type: 'SOLID', color: { r: 0.85, g: 0.7, b: 0.2, a: 1 }, weight: 1 }],
    effects: [],
    cornerRadius: 8,
    layoutMode: 'HORIZONTAL',
    counterAxisAlignItems: 'CENTER',
    paddingLeft: 16,
    paddingRight: 16,
    itemSpacing: 12,
    children: [
      {
        id: 'mock-5-icon',
        name: 'Icon',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 24,
        height: 24,
        fills: [],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: '⚠️',
        style: { fontFamily: 'Inter', fontWeight: 400, fontSize: 18 },
      },
      {
        id: 'mock-5-text',
        name: 'Message',
        type: 'TEXT',
        x: 0,
        y: 0,
        width: 280,
        height: 40,
        fills: [{ type: 'SOLID', color: { r: 0.4, g: 0.3, b: 0.05, a: 1 } }],
        strokes: [],
        effects: [],
        cornerRadius: 0,
        characters: 'This is a warning alert with important information.',
        style: { fontFamily: 'Inter', fontWeight: 500, fontSize: 14, lineHeightPx: 20 },
      },
    ],
  },
};

// ============ 适配器 ============

export class FigmaAdapter {
  private config: FigmaConfig;
  private eventBus: FigmaEventBus = new FigmaEventBus();
  private cache: Map<string, CacheEntry> = new Map();

  constructor(config?: Partial<FigmaConfig>) {
    this.config = { ...DEFAULT_FIGMA_CONFIG, ...(config || {}) };
  }

  // ============== 配置 ==============

  getConfig(): FigmaConfig {
    return { ...this.config };
  }

  setConfig(patch: Partial<FigmaConfig>): void {
    this.config = { ...this.config, ...patch };
    this.eventBus.emit('config-updated', { config: this.config });
  }

  isReady(): boolean {
    return this.config.useMockData || !!this.config.accessToken;
  }

  // ============== URL 解析 ==============

  parseUrl(url: string): ParsedFigmaUrl | null {
    if (!url) return null;
    // 格式1: https://www.figma.com/file/<fileKey>/<name>?node-id=<id>
    // 格式2: https://www.figma.com/design/<fileKey>/<name>?node-id=<id>
    // 格式3: https://www.figma.com/proto/<fileKey>/<name>?node-id=<id>

    const match = url.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)(?:\/[^?]+)?(?:\?[^#]*node-id=([^&]+))?/);
    if (!match) {
      // 尝试简单的 fileKey 格式
      const simple = url.match(/^[a-zA-Z0-9]{10,}$/);
      if (simple) return { fileKey: url };
      return null;
    }
    const result: ParsedFigmaUrl = { fileKey: match[1] };
    if (match[2]) {
      // node-id 可能是 "1-2" 格式，需要转换为 "1:2"
      result.nodeId = match[2].replace(/-/g, ':');
    }
    return result;
  }

  // ============== Mock 数据 ==============

  loadMockData(name: string): FigmaNode | null {
    return FIGMA_MOCK_PRESETS[name] || null;
  }

  listMockPresets(): string[] {
    return Object.keys(FIGMA_MOCK_PRESETS);
  }

  // ============== 远程拉取 ==============

  async fetchFile(fileKey: string): Promise<FigmaFile> {
    if (this.config.useMockData) {
      // 返回 mock 文件
      return {
        name: 'Mock File',
        document: FIGMA_MOCK_PRESETS['card-simple'],
        components: { ...FIGMA_MOCK_PRESETS },
      };
    }

    if (!this.config.accessToken) {
      const error = '未配置 accessToken';
      this.eventBus.emit('error', { error, fileKey });
      throw new Error(error);
    }

    // 检查缓存
    const cacheKey = `file:${fileKey}`;
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.eventBus.emit('cache-hit', { fileKey, data: cached.data });
        return cached.data;
      }
    }

    try {
      const url = `${this.config.baseUrl}/files/${fileKey}`;
      const response = await fetch(url, {
        headers: { 'X-Figma-Token': this.config.accessToken },
      });
      if (!response.ok) {
        throw new Error(`Figma API error: ${response.status}`);
      }
      const data = await response.json();
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, { data, expiresAt: Date.now() + this.config.cacheTtlMs });
      }
      this.eventBus.emit('fetched', { fileKey, type: 'file' });
      return data;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'fetch failed';
      this.eventBus.emit('error', { error, fileKey });
      throw err;
    }
  }

  async fetchNode(fileKey: string, nodeId: string): Promise<FigmaNode> {
    if (this.config.useMockData) {
      return FIGMA_MOCK_PRESETS['button-primary'];
    }
    if (!this.config.accessToken) {
      const error = '未配置 accessToken';
      this.eventBus.emit('error', { error, fileKey, nodeId });
      throw new Error(error);
    }

    const cacheKey = `node:${fileKey}:${nodeId}`;
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        this.eventBus.emit('cache-hit', { fileKey, nodeId, data: cached.data });
        return cached.data;
      }
    }

    try {
      const url = `${this.config.baseUrl}/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;
      const response = await fetch(url, {
        headers: { 'X-Figma-Token': this.config.accessToken },
      });
      if (!response.ok) {
        throw new Error(`Figma API error: ${response.status}`);
      }
      const data = await response.json();
      const node = data.nodes?.[nodeId]?.document;
      if (!node) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      if (this.config.cacheEnabled) {
        this.cache.set(cacheKey, { data: node, expiresAt: Date.now() + this.config.cacheTtlMs });
      }
      this.eventBus.emit('fetched', { fileKey, nodeId, type: 'node' });
      return node;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'fetch failed';
      this.eventBus.emit('error', { error, fileKey, nodeId });
      throw err;
    }
  }

  // ============== 转换 ==============

  toReact(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode {
    return this.generate(node, options, 'react');
  }

  toVue(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode {
    return this.generate(node, options, 'vue');
  }

  toHtml(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode {
    return this.generate(node, options, 'html');
  }

  // ============== 内部 ==============

  private generate(node: FigmaNode, options: FigmaToCodeOptions, framework: Framework): GeneratedCode {
    const warnings: string[] = [];
    const stats = { nodeCount: 0, textCount: 0, frameCount: 0, lineCount: 0, bytes: 0 };

    const countNode = (n: FigmaNode) => {
      stats.nodeCount += 1;
      if (n.type === 'TEXT') stats.textCount += 1;
      if (n.type === 'FRAME' || n.type === 'COMPONENT') stats.frameCount += 1;
      (n.children || []).forEach(countNode);
    };
    countNode(node);

    let code = '';
    if (framework === 'react') {
      code = this.generateReact(node, options, 0, warnings);
    } else if (framework === 'vue') {
      code = this.generateVue(node, options, 0, warnings);
    } else {
      code = this.generateHtml(node, options, 0, warnings);
    }

    stats.lineCount = code.split('\n').length;
    stats.bytes = code.length;

    this.eventBus.emit('converted', { framework, componentName: options.componentName, stats });

    return {
      code,
      framework,
      styling: options.styling,
      componentName: options.componentName,
      warnings,
      stats,
    };
  }

  private getTailwindClasses(node: FigmaNode, _options: FigmaToCodeOptions): string[] {
    const classes: string[] = [];

    // 填充
    if (node.fills && node.fills.length > 0) {
      const fill = node.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const hex = rgbaToHex(fill.color);
        const tw = colorToTailwind(hex);
        if (tw.startsWith('[')) {
          classes.push(`bg-[${hex}]`);
        } else {
          classes.push(`bg-${tw}`);
        }
      }
    }

    // 描边
    if (node.strokes && node.strokes.length > 0) {
      const stroke = node.strokes[0];
      if (stroke.color) {
        const hex = rgbaToHex(stroke.color);
        const tw = colorToTailwind(hex);
        classes.push(tw.startsWith('[') ? `border border-[${hex}]` : `border border-${tw}`);
        classes.push(`border-[${stroke.weight}px]`);
      }
    }

    // 圆角
    if (node.cornerRadius > 0) {
      const r = node.cornerRadius;
      const standard = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32];
      const closest = standard.reduce((a, b) => Math.abs(b - r) < Math.abs(a - r) ? b : a, 999);
      if (Math.abs(closest - r) < 2) {
        classes.push(`rounded${closest === 0 ? '' : `-${closest}`}`);
      } else {
        classes.push(`rounded-[${r}px]`);
      }
    }

    // 阴影
    if (node.effects && node.effects.length > 0) {
      const shadow = node.effects.find((e) => e.type === 'DROP_SHADOW' && e.visible !== false);
      if (shadow) {
        if (shadow.offset && (shadow.offset.x === 0 && shadow.offset.y === 2) && shadow.radius === 4) {
          classes.push('shadow-sm');
        } else if (shadow.offset && (shadow.offset.x === 0 && shadow.offset.y === 4) && shadow.radius === 6) {
          classes.push('shadow-md');
        } else if (shadow.radius >= 10) {
          classes.push('shadow-lg');
        } else {
          classes.push('shadow');
        }
      }
    }

    // 布局
    if (node.layoutMode === 'HORIZONTAL') {
      classes.push('flex flex-row');
      if (node.primaryAxisAlignItems === 'CENTER') classes.push('justify-center');
      else if (node.primaryAxisAlignItems === 'MAX') classes.push('justify-end');
      else if (node.primaryAxisAlignItems === 'SPACE_BETWEEN') classes.push('justify-between');
      if (node.counterAxisAlignItems === 'CENTER') classes.push('items-center');
      else if (node.counterAxisAlignItems === 'MAX') classes.push('items-end');
    } else if (node.layoutMode === 'VERTICAL') {
      classes.push('flex flex-col');
      if (node.primaryAxisAlignItems === 'CENTER') classes.push('items-center');
      if (node.counterAxisAlignItems === 'CENTER') classes.push('justify-center');
      else if (node.counterAxisAlignItems === 'MAX') classes.push('justify-end');
    }

    // 内边距
    if (node.paddingTop || node.paddingBottom || node.paddingLeft || node.paddingRight) {
      const t = node.paddingTop || 0;
      const b = node.paddingBottom || 0;
      const l = node.paddingLeft || 0;
      const r = node.paddingRight || 0;
      if (t === b && l === r && t === l) {
        classes.push(`p-${t}`);
      } else if (l === r && t === b) {
        classes.push(`px-${l}`, `py-${t}`);
      } else {
        if (t) classes.push(`pt-${t}`);
        if (b) classes.push(`pb-${b}`);
        if (l) classes.push(`pl-${l}`);
        if (r) classes.push(`pr-${r}`);
      }
    }

    // 间距
    if (node.itemSpacing && node.children) {
      const standard = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32];
      const closest = standard.reduce((a, b) => Math.abs(b - (node.itemSpacing! / 4)) < Math.abs(a - (node.itemSpacing! / 4)) ? b : a, 999);
      if (Math.abs(closest * 4 - node.itemSpacing) < 2) {
        classes.push(`gap-${closest}`);
      } else {
        classes.push(`gap-[${node.itemSpacing}px]`);
      }
    }

    // 宽高
    if (node.width) classes.push(`w-[${node.width}px]`);
    if (node.height) classes.push(`h-[${node.height}px]`);

    return classes;
  }

  private inlineStyle(node: FigmaNode): string {
    const style: string[] = [];
    if (node.width) style.push(`width: ${node.width}px`);
    if (node.height) style.push(`height: ${node.height}px`);
    if (node.fills && node.fills.length > 0) {
      const fill = node.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const hex = rgbaToHex(fill.color);
        style.push(`background-color: ${hex}`);
      }
    }
    if (node.strokes && node.strokes.length > 0) {
      const stroke = node.strokes[0];
      const hex = rgbaToHex(stroke.color);
      style.push(`border: ${stroke.weight}px solid ${hex}`);
    }
    if (node.cornerRadius) style.push(`border-radius: ${node.cornerRadius}px`);
    if (node.layoutMode === 'HORIZONTAL') style.push('display: flex; flex-direction: row;');
    else if (node.layoutMode === 'VERTICAL') style.push('display: flex; flex-direction: column;');
    if (node.itemSpacing) style.push(`gap: ${node.itemSpacing}px`);
    if (node.paddingTop || node.paddingBottom || node.paddingLeft || node.paddingRight) {
      style.push(`padding: ${node.paddingTop || 0}px ${node.paddingRight || 0}px ${node.paddingBottom || 0}px ${node.paddingLeft || 0}px`);
    }
    return style.join('; ');
  }

  private elementName(node: FigmaNode): string {
    switch (node.type) {
      case 'TEXT': return 'span';
      case 'FRAME':
      case 'COMPONENT':
      case 'INSTANCE': return 'div';
      case 'RECTANGLE': return 'div';
      case 'ELLIPSE': return 'div';
      case 'IMAGE': return 'img';
      default: return 'div';
    }
  }

  private generateReact(node: FigmaNode, options: FigmaToCodeOptions, depth: number, warnings: string[]): string {
    const indent = '  '.repeat(depth + 1);
    const tag = this.elementName(node);
    let className = '';
    let style: string | null = null;
    if (options.styling === 'tailwind') {
      className = this.getTailwindClasses(node, options).join(' ');
    } else if (options.styling === 'inline') {
      style = this.inlineStyle(node);
    } else {
      className = `figma-${node.type.toLowerCase()}-${node.id}`;
    }

    const props: string[] = [];
    if (className) props.push(`className="${className}"`);
    if (style) props.push(`style={{ ${style} }}`);

    // 文本
    if (node.type === 'TEXT' && node.characters !== undefined) {
      if (options.styling === 'tailwind' && node.style) {
        if (node.style.fontSize) props.push(`style={{ fontSize: ${node.style.fontSize} }}`);
      }
      if (options.includeComments) {
        return `${indent}// ${node.name}\n${indent}<${tag} ${props.join(' ')}>${node.characters}</${tag}>`;
      }
      return `${indent}<${tag} ${props.join(' ')}>${node.characters}</${tag}>`;
    }

    // 图片
    if (node.type === 'IMAGE') {
      props.push('src="..." alt="..."');
      return `${indent}<img ${props.join(' ')} />`;
    }

    // 自闭合
    if (!node.children || node.children.length === 0) {
      return `${indent}<${tag} ${props.join(' ')} />`;
    }

    // 容器
    let result = `${indent}<${tag} ${props.join(' ')}>`;
    if (options.includeComments) result += ` {/* ${node.name} */}`;
    result += '\n';
    for (const child of node.children) {
      result += this.generateReact(child, options, depth + 1, warnings) + '\n';
    }
    result += `${indent}</${tag}>`;
    return result;
  }

  private generateVue(node: FigmaNode, options: FigmaToCodeOptions, depth: number, warnings: string[]): string {
    const indent = '  '.repeat(depth + 1);
    const tag = this.elementName(node);
    let className = '';
    if (options.styling === 'tailwind') {
      className = this.getTailwindClasses(node, options).join(' ');
    }
    const props: string[] = [];
    if (className) props.push(`class="${className}"`);

    if (node.type === 'TEXT' && node.characters !== undefined) {
      return `${indent}<${tag} ${props.join(' ')}>${node.characters}</${tag}>`;
    }
    if (!node.children || node.children.length === 0) {
      return `${indent}<${tag} ${props.join(' ')} />`;
    }
    let result = `${indent}<${tag} ${props.join(' ')}>`;
    result += ` <!-- ${node.name} -->\n`;
    for (const child of node.children) {
      result += this.generateVue(child, options, depth + 1, warnings) + '\n';
    }
    result += `${indent}</${tag}>`;
    return result;
  }

  private generateHtml(node: FigmaNode, options: FigmaToCodeOptions, depth: number, warnings: string[]): string {
    const indent = '  '.repeat(depth + 1);
    const tag = this.elementName(node);
    let className = '';
    let style: string | null = null;
    if (options.styling === 'tailwind') {
      className = this.getTailwindClasses(node, options).join(' ');
    } else if (options.styling === 'inline') {
      style = this.inlineStyle(node);
    }
    const props: string[] = [];
    if (className) props.push(`class="${className}"`);
    if (style) props.push(`style="${style}"`);

    if (node.type === 'TEXT' && node.characters !== undefined) {
      return `${indent}<${tag} ${props.join(' ')}>${node.characters}</${tag}>`;
    }
    if (!node.children || node.children.length === 0) {
      return `${indent}<${tag} ${props.join(' ')}></${tag}>`;
    }
    let result = `${indent}<${tag} ${props.join(' ')}>`;
    result += '\n';
    for (const child of node.children) {
      result += this.generateHtml(child, options, depth + 1, warnings) + '\n';
    }
    result += `${indent}</${tag}>`;
    return result;
  }

  // ============== 包装生成 ==============

  generateFullComponent(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode {
    const inner = this.generate(node, { ...options, componentName: 'inner' }, options.framework);
    let code = '';
    if (options.framework === 'react') {
      code = `import React from 'react';\n\ninterface ${options.componentName}Props {\n  className?: string;\n}\n\nexport const ${options.componentName}: React.FC<${options.componentName}Props> = ({ className }) => {\n  return (\n${inner.code}\n  );\n};\n\nexport default ${options.componentName};\n`;
    } else if (options.framework === 'vue') {
      code = `<template>\n${inner.code}\n</template>\n\n<script setup lang="ts">\ndefineProps<{ className?: string }>();\n</script>\n`;
    } else {
      code = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>${options.componentName}</title>\n</head>\n<body>\n${inner.code}\n</body>\n</html>\n`;
    }
    return { ...inner, code };
  }

  // ============== 事件 ==============

  on(type: FigmaEventType, handler: FigmaEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  // ============== 缓存管理 ==============

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  // ============== 销毁 ==============

  destroy(): void {
    this.cache.clear();
    this.eventBus.clear();
  }
}

// ============ 单例 ============

let _instance: FigmaAdapter | null = null;

export function getFigmaAdapter(config?: Partial<FigmaConfig>): FigmaAdapter {
  if (!_instance) {
    _instance = new FigmaAdapter(config);
  }
  return _instance;
}

export function resetFigmaAdapter(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
