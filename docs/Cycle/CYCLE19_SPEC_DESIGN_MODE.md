# CYCLE19 SPEC: G19-03 Design Mode 可视化反馈

> **任务 ID**: G19-03
> **版本**: v6.43.0
> **日期**: 2026-07-29
> **优先级**: P0（极高）
> **基于**: [Cursor 3.0 Design Mode (⌘+Shift+D)](https://cursor.com/es/changelog/3-0)

---

## 一、功能需求

### 1.1 用户场景

**主用户场景**：用户希望直接点击页面元素反馈给 AI，而不是用文字描述视觉修改需求。

**典型流程**：
1. 用户在 Preview 模式看到页面预览
2. 启用 Design Mode（⌘+Shift+D）
3. 鼠标悬停元素 → 高亮 outline
4. 点击按钮 → 选中状态 + 附加到 prompt
5. Shift+drag 框选区域 → 截图附加
6. 用户输入修改需求 → 发送到 Composer
7. AI 收到元素信息 + 截图 + 文本描述

### 1.2 功能目标

| 目标 | 描述 | 验证指标 |
|---|---|---|
| 元素选择 | 点击/框选 UI 元素 | 99% 命中 |
| 高亮反馈 | 悬停/选中元素高亮 | < 16ms 渲染 |
| 元素信息 | 自动提取 element 上下文 | 包含 selector / position / size |
| 截图能力 | 框选区域截图 | html2canvas |
| 引用集成 | @element:btn-primary 解析 | 与其他 @ 引用一致 |
| 快捷键 | ⌘+Shift+D 切换 | 全局可用 |

### 1.3 使用流程

```
[Preview 模式激活]
        ↓
[Design Mode 切换]
  - 快捷键 ⌘+Shift+D
  - 工具栏按钮
        ↓
[DesignModeOverlay 激活]
  - 覆盖层显示
  - 鼠标事件接管
        ↓
[悬停阶段]
  - mouseover → 元素识别 → 高亮 outline
  - 显示 element 标签（class / id / tag）
        ↓
[选择阶段]
  - click → 选中状态（蓝色 outline）
  - 自动添加 @element:selector 到 prompt
  - 元素信息注入（位置/大小/类名）
        ↓
[框选阶段]
  - Shift+drag → 拖拽框
  - 松开 → 截图（html2canvas）
  - 截图附加到 prompt
        ↓
[退出]
  - ESC / 再次快捷键
  - Overlay 移除
  - 选中状态保留在 prompt
```

---

## 二、技术实现方案

### 2.1 架构图

```
┌──────────────────────────────────────────────────────────┐
│                DesignModeController                       │
├──────────────────────────────────────────────────────────┤
│  - isActive: boolean                                      │
│  - hoveredElement: HTMLElement | null                     │
│  - selectedElements: HTMLElement[]                        │
│  - onSelect: (elements, screenshot) => void              │
│                                                          │
│  Methods:                                                │
│    + activate(): void                                    │
│    + deactivate(): void                                  │
│    + toggle(): void                                      │
│    + clear(): void                                       │
│    + getSelectedInfo(): ElementInfo[]                    │
│    + captureRegion(bounds): Promise<Blob>                │
└──────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────┐
│                  ElementInfo                             │
├──────────────────────────────────────────────────────────┤
│  - selector: string (CSS path)                           │
│  - tagName: string                                       │
│  - className: string                                     │
│  - id: string                                            │
│  - textContent: string (truncated)                       │
│  - position: { x, y, width, height }                     │
│  - attributes: Record<string, string>                    │
│  - styles: Record<string, string> (key computed styles)  │
└──────────────────────────────────────────────────────────┘
        ↓
┌──────────────────────────────────────────────────────────┐
│                DesignModeOverlay (UI)                    │
├──────────────────────────────────────────────────────────┤
│  - Fullscreen overlay (fixed, z-50)                      │
│  - HoveredOutline (single element)                       │
│  - SelectedOutline (multiple)                            │
│  - SelectionBox (drag area)                              │
│  - ElementTooltip (label)                                │
│  - Toolbar (capture / clear / exit)                      │
└──────────────────────────────────────────────────────────┘
```

### 2.2 核心数据模型

```typescript
// 元素信息
export interface ElementInfo {
  selector: string;       // "body > div.container > button.btn-primary"
  tagName: string;        // "BUTTON"
  id?: string;
  className?: string;
  textContent?: string;   // 截断 200 字符
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  attributes: Record<string, string>;
  computedStyles: {
    color?: string;
    backgroundColor?: string;
    fontSize?: string;
    fontWeight?: string;
    padding?: string;
    borderRadius?: string;
    // ... 关键样式
  };
}

// Design Mode 状态
export interface DesignModeState {
  isActive: boolean;
  hovered: ElementInfo | null;
  selected: ElementInfo[];
  selectionBox: SelectionBox | null;
  isDragging: boolean;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
  screenshot?: Blob;
}

// @element 引用类型
export interface ElementContext {
  type: 'element';
  elements: ElementInfo[];
  screenshot?: string;  // base64
  capturedAt: number;
  source: 'preview' | 'page';
}
```

### 2.3 元素识别算法

```typescript
class ElementSelector {
  /**
   * 递归获取元素的 CSS selector
   * 避免使用 nth-child，优先使用 id / class / data-testid
   */
  getSelector(el: HTMLElement): string {
    if (el.id) return `#${el.id}`;
    if (el.dataset?.testid) return `[data-testid="${el.dataset.testid}"]`;

    const parts: string[] = [];
    let current: HTMLElement | null = el;
    let depth = 0;

    while (current && current !== document.body && depth < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`#${current.id}`);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/)
          .filter(c => !c.startsWith('_') && c.length > 0)
          .slice(0, 2);
        if (classes.length > 0) {
          part += '.' + classes.join('.');
        }
      }
      parts.unshift(part);
      current = current.parentElement;
      depth++;
    }

    return 'body > ' + parts.join(' > ');
  }

  /**
   * 提取关键 computed styles
   */
  getComputedStyles(el: HTMLElement): ElementInfo['computedStyles'] {
    const cs = window.getComputedStyle(el);
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      padding: cs.padding,
      margin: cs.margin,
      borderRadius: cs.borderRadius,
      border: cs.border,
      display: cs.display,
    };
  }

  /**
   * 提取元素信息
   */
  getInfo(el: HTMLElement): ElementInfo {
    const rect = el.getBoundingClientRect();
    return {
      selector: this.getSelector(el),
      tagName: el.tagName,
      id: el.id || undefined,
      className: typeof el.className === 'string' ? el.className : undefined,
      textContent: (el.textContent || '').slice(0, 200).trim() || undefined,
      position: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      attributes: this.getAttributes(el),
      computedStyles: this.getComputedStyles(el),
    };
  }
}
```

### 2.4 截图实现

```typescript
import html2canvas from 'html2canvas';

class ScreenshotService {
  async captureRegion(box: SelectionBox): Promise<Blob> {
    // 找到 box 覆盖的所有元素，捕获整个区域
    const canvas = await html2canvas(document.body, {
      x: box.startX,
      y: box.startY,
      width: box.width,
      height: box.height,
      backgroundColor: null,
      scale: window.devicePixelRatio,
    });
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob failed'));
      }, 'image/png');
    });
  }

  async captureElement(el: HTMLElement): Promise<Blob> {
    const canvas = await html2canvas(el, {
      backgroundColor: null,
      scale: window.devicePixelRatio,
    });
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob failed'));
      }, 'image/png');
    });
  }
}
```

---

## 三、接口设计规范

### 3.1 前端 API

```typescript
// DesignModeController
export class DesignModeController {
  constructor(options?: DesignModeOptions);

  // 状态
  activate(): void;
  deactivate(): void;
  toggle(): void;
  isActive(): boolean;

  // 选择
  select(el: HTMLElement): void;
  deselect(el: HTMLElement): void;
  clear(): void;
  selectByBox(box: SelectionBox): HTMLElement[];

  // 查询
  getHovered(): ElementInfo | null;
  getSelected(): ElementInfo[];

  // 事件
  on(event: DesignEventType, handler: DesignEventHandler): () => void;
}

// DesignModeOverlay
export interface DesignModeOverlayProps {
  isActive: boolean;
  onExit: () => void;
  onSelect: (info: ElementInfo[]) => void;
  onCapture?: (blob: Blob, info: ElementInfo[]) => void;
  container?: HTMLElement; // 默认为 PreviewPanel iframe content
}

// useDesignMode Hook
export function useDesignMode(options?: UseDesignModeOptions): {
  isActive: boolean;
  selected: ElementInfo[];
  hovered: ElementInfo | null;
  activate: () => void;
  deactivate: () => void;
  toggle: () => void;
  clear: () => void;
  registerContainer: (el: HTMLElement | null) => void;
};
```

### 3.2 ComposerPanel 集成

```typescript
// 在 ComposerPanel 中：
- 添加 Design Mode 切换按钮
- Preview 模式激活时显示按钮
- Design Mode 状态同步到 ContextWindowMeter
- 选中的元素自动注入 prompt
```

### 3.3 @element 引用

```typescript
// parseAndResolveReferences 扩展
{
  type: 'element',
  regex: /@(element|Element):([a-zA-Z0-9\-_]+)/g,
  resolver: resolveElement,
}

async function resolveElement(
  query: string,
  context?: { designModeState?: DesignModeState }
): Promise<ElementContext> {
  // 从 DesignModeController 查找选中的元素
  // 如果找到：返回完整信息
  // 否则：抛出 ElementNotFoundError
}
```

### 3.4 后端 API

```python
# backend/app/api/design.py

@router.post("/api/design/elements/info")
async def get_elements_info(
    request: ElementsInfoRequest,
) -> ElementsInfoResponse:
    """批量获取元素信息（前端预处理后端验证）"""
    ...

@router.post("/api/design/screenshot")
async def upload_screenshot(
    file: UploadFile = File(...),
    metadata: str = Form(...),
) -> ScreenshotResponse:
    """上传截图（用于历史回看）"""
    ...
```

---

## 四、数据结构定义

### 4.1 ElementInfo 序列化

```typescript
{
  "version": "1.0",
  "elements": [
    {
      "selector": "body > div > button.btn-primary",
      "tagName": "BUTTON",
      "className": "btn btn-primary",
      "textContent": "Submit",
      "position": { "x": 100, "y": 200, "width": 80, "height": 40 },
      "attributes": { "type": "submit", "aria-label": "Submit form" },
      "computedStyles": {
        "backgroundColor": "rgb(59, 130, 246)",
        "color": "rgb(255, 255, 255)",
        "borderRadius": "6px"
      }
    }
  ],
  "screenshot": "data:image/png;base64,..."  // 可选
}
```

### 4.2 ElementContext 注入

```typescript
// 注入到 system prompt 的格式：
function injectElementContext(ctx: ElementContext): string {
  const lines = ['# Selected UI Elements', ''];
  ctx.elements.forEach((el, i) => {
    lines.push(`## Element ${i + 1}: ${el.tagName.toLowerCase()}`);
    lines.push(`- Selector: \`${el.selector}\``);
    if (el.textContent) lines.push(`- Text: "${el.textContent}"`);
    lines.push(`- Position: ${el.position.width}x${el.position.height} at (${el.position.x}, ${el.position.y})`);
    if (el.className) lines.push(`- Class: ${el.className}`);
    lines.push('- Styles:');
    Object.entries(el.computedStyles).slice(0, 5).forEach(([k, v]) => {
      lines.push(`  - ${k}: ${v}`);
    });
    lines.push('');
  });
  if (ctx.screenshot) {
    lines.push('## Screenshot');
    lines.push(`![Selected area](${ctx.screenshot})`);
  }
  return lines.join('\n');
}
```

---

## 五、性能与安全要求

### 5.1 性能

| 指标 | 要求 |
|---|---|
| 元素识别延迟 | < 16ms |
| 高亮渲染 | < 16ms (60fps) |
| 截图延迟（1080p） | < 500ms |
| Overlay 激活 | < 100ms |
| 元素信息提取 | < 50ms |

### 5.2 安全

- **DOM 范围限制**：仅在 Preview iframe 内启用
- **敏感元素过滤**：密码输入框 / .env 容器不显示
- **截图大小限制**：单次 < 5MB
- **权限控制**：仅在用户主动启用时激活

---

## 六、验收标准

### 6.1 功能验收

- [ ] ⌘+Shift+D 切换 Design Mode
- [ ] 鼠标悬停高亮
- [ ] 点击选中元素
- [ ] Shift+drag 框选
- [ ] 元素信息自动提取
- [ ] 截图功能
- [ ] @element 引用解析
- [ ] 元素信息注入 prompt
- [ ] ESC 退出

### 6.2 UI 验收

- [ ] Overlay 全屏覆盖
- [ ] 高亮 outline 清晰（蓝色 2px）
- [ ] 选中状态有徽章
- [ ] 工具栏位置合理（右下角）
- [ ] 元素标签显示
- [ ] 截图预览

### 6.3 测试验收

- [ ] 单元测试 ≥ 10 个
- [ ] 集成测试 ≥ 6 个
- [ ] E2E 断言 ≥ 8 个
- [ ] TypeScript 零错误
- [ ] 100% 测试通过

### 6.4 测试用例清单

#### 单元测试
1. DesignModeController.activate 激活
2. DesignModeController.deactivate 退出
3. DesignModeController.toggle 切换
4. select 添加到 selected
5. deselect 移除
6. clear 清空所有
7. ElementSelector.getSelector 处理 id
8. ElementSelector.getSelector 处理 class
9. ElementSelector.getSelector 处理嵌套
10. ElementSelector.getInfo 提取样式
11. ScreenshotService.captureElement 调用 html2canvas
12. 事件总线发出 hover/select/deselect

#### 集成测试
1. Overlay 渲染正确
2. 鼠标移动触发高亮
3. 点击触发选中
4. Shift+drag 触发框选
5. 工具栏按钮响应
6. ESC 退出

#### E2E 测试
1. 文件存在
2. API 暴露
3. @element 解析
4. 元素信息注入
5. 截图上传

---

## 七、风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| html2canvas 性能 | 中 | 限制最大尺寸 + 异步 |
| Shadow DOM | 中 | 递归穿透 |
| iframe 跨域 | 中 | postMessage 桥接 |
| 样式隔离 | 低 | 仅在 Preview 内启用 |

---

**完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 进入 Phase 3 实现
