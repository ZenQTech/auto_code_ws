# Cycle 24 SPEC: Figma to Code 设计稿转代码

## 概述

集成 Figma API，将设计稿节点树自动解析为 React + TypeScript 组件代码。支持单组件提取、整页生成、样式映射（颜色/字号/间距/布局）。

## 设计目标

1. **零配置优先**：用户粘贴 Figma URL + Personal Access Token 即可使用
2. **智能映射**：自动将 Figma Auto-Layout → Flexbox，颜色 → Tailwind 颜色
3. **可降级**：使用 Mock 数据演示完整流程，无需真实 Figma 账号

## 核心功能

### 1. Figma 适配器 (FigmaAdapter)

```typescript
interface FigmaConfig {
  accessToken: string;
  baseUrl: string;        // 'https://api.figma.com/v1'
  useMockData: boolean;   // 演示模式
  cacheEnabled: boolean;
  cacheTtlMs: number;
}

interface FigmaNode {
  id: string;
  name: string;
  type: 'FRAME' | 'GROUP' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | 'COMPONENT' | 'INSTANCE';
  x: number; y: number; width: number; height: number;
  fills: FigmaFill[];
  strokes: FigmaStroke[];
  effects: FigmaEffect[];
  cornerRadius: number;
  characters?: string;     // TEXT 类型
  style?: FigmaTextStyle;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft/Right/Top/Bottom?: number;
  itemSpacing?: number;
  children?: FigmaNode[];
}

interface FigmaToCodeOptions {
  framework: 'react' | 'vue' | 'html';
  styling: 'tailwind' | 'css-modules' | 'inline';
  includeComments: boolean;
  componentName: string;
  extractImages: boolean;
}

class FigmaAdapter {
  setConfig(config: Partial<FigmaConfig>): void;
  isReady(): boolean;
  
  // 解析
  parseUrl(url: string): { fileKey: string; nodeId?: string };
  fetchFile(fileKey: string): Promise<FigmaFile>;
  fetchNode(fileKey: string, nodeId: string): Promise<FigmaNode>;
  
  // 转换
  toReact(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode;
  toVue(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode;
  toHtml(node: FigmaNode, options: FigmaToCodeOptions): GeneratedCode;
  
  // Mock
  loadMockData(name: string): FigmaNode;
  
  // 事件
  on(type: 'fetched' | 'converted' | 'error', handler: Function): () => void;
}
```

### 2. UI 面板 (FigmaImportPanel)

- URL 输入框 + Token 输入（保存在 localStorage）
- 节点树预览（左侧）
- 实时代码生成（右侧，可切换 React/Vue/HTML）
- 样式映射表（颜色名转换、Tailwind class 生成）
- 复制/下载按钮
- 演示数据列表（5 个内置 mock）

## 验收标准

- [ ] 支持 URL 解析（file_key + node_id 提取）
- [ ] 支持 Mock 模式（无需真实 token）
- [ ] 转换结果包含完整可编译代码
- [ ] Tailwind class 准确率 > 90%
- [ ] 35+ 测试

---

**创建日期**: 2026-07-29
**目标 Cycle**: Cycle 24 P1-2
