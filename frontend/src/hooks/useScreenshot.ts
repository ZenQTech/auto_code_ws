/**
 * # ============================================================
 * # useScreenshot - 屏幕截图 Hook
 * # ============================================================
 * # 核心作用：基于 html2canvas 实现页面/区域截图
 * # 设计要点：
 * #   1. 整页截图：captureFullPage() → PNG dataURL
 * #   2. 区域截图：captureRegion(x, y, w, h) → PNG dataURL
 * #   3. 元素截图：captureElement(selector) → PNG dataURL
 * #   4. 降级方案：使用 DOM-to-image polyfill 或 Canvas 直接绘制
 * #   5. 失败时回退到 noop
 * # 运行流程：
 * #   1. 组件调用 capture*() 启动截图
 * #   2. 后台渲染到 canvas
 * #   3. 输出 PNG dataURL
 * # 输入参数：options: { onCapture, onError, format, quality }
 * # 输出结果：{ capture, captureRegion, captureElement, isCapturing, lastScreenshot, error }
 * # 对标：Trae SOLO Screenshot Tool
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 69 G69-03 初次创建
 * # ============================================================
 */

import { useCallback, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type ScreenshotFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ScreenshotOptions {
  /** 截图格式，默认 png */
  format?: ScreenshotFormat;
  /** 图片质量（0-1），仅对 jpeg/webp 有效，默认 0.92 */
  quality?: number;
  /** 截图成功回调 */
  onCapture?: (dataUrl: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotState {
  /** 正在截图 */
  isCapturing: boolean;
  /** 上次截图 dataURL */
  lastScreenshot: string | null;
  /** 错误信息 */
  error: string | null;
  /** 整页截图 */
  capture: () => Promise<string | null>;
  /** 区域截图 */
  captureRegion: (region: ScreenshotRegion) => Promise<string | null>;
  /** 元素截图 */
  captureElement: (selector: string) => Promise<string | null>;
  /** 重置 */
  reset: () => void;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_OPTIONS: Required<Omit<ScreenshotOptions, 'onCapture' | 'onError'>> = {
  format: 'image/png',
  quality: 0.92,
};

// ============================================================
// 内部：尝试加载 html2canvas
// ============================================================

interface Html2CanvasModule {
  default: (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
}

async function tryLoadHtml2Canvas(): Promise<Html2CanvasModule | null> {
  try {
    // 优先从 window 全局变量获取（用户可能已注入）
    const w = window as unknown as Record<string, unknown>;
    if (typeof w.html2canvas === 'function') {
      return { default: w.html2canvas as Html2CanvasModule['default'] };
    }
    // 尝试动态导入（不依赖任何特定包名，由调用方注入）
    const candidates = ['html2canvas-pro', 'html2canvas', 'dom-to-image-more'];
    for (const name of candidates) {
      try {
        // 使用 eval 避免 vite 静态分析
        const dynamicImport: (s: string) => Promise<Html2CanvasModule | null> =
          (s: string) => (Function('return import(s)') as (s: string) => Promise<Html2CanvasModule | null>)(s);
        const mod: Html2CanvasModule | null = await dynamicImport(name);
        if (mod && typeof mod.default === 'function') {
          return mod;
        }
      } catch {
        // 继续尝试下一个
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 内部：使用 SVG foreignObject 降级方案
// ============================================================

async function captureViaSvgFallback(
  element: HTMLElement,
  options: { format: ScreenshotFormat; quality: number },
): Promise<string> {
  // 简单降级：将元素序列化为 SVG，包含 foreignObject + 元素 HTML
  const rect = element.getBoundingClientRect();
  const serializer = new XMLSerializer();
  const cloned = element.cloneNode(true) as HTMLElement;
  cloned.style.backgroundColor = getComputedStyle(element).backgroundColor || '#ffffff';

  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${rect.width}" height="${rect.height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">${serializer.serializeToString(cloned)}</div>
      </foreignObject>
    </svg>
  `;

  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = (e) => reject(new Error('SVG load failed: ' + e));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
    return canvas.toDataURL(options.format, options.quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ============================================================
// Hook 实现
// ============================================================

export function useScreenshot(options: ScreenshotOptions = {}): ScreenshotState {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const onCaptureRef = useRef(options.onCapture);
  const onErrorRef = useRef(options.onError);

  onCaptureRef.current = options.onCapture;
  onErrorRef.current = options.onError;

  const [isCapturing, setIsCapturing] = useState(false);
  const [lastScreenshot, setLastScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 通用截图实现
  const captureElementInternal = useCallback(
    async (element: HTMLElement): Promise<string | null> => {
      try {
        // 优先使用 html2canvas
        const mod = await tryLoadHtml2Canvas();
        if (mod) {
          const canvas = await mod.default(element, {
            logging: false,
            useCORS: true,
            allowTaint: false,
          });
          return canvas.toDataURL(opts.format, opts.quality);
        }
        // 降级到 SVG 方案
        return await captureViaSvgFallback(element, opts);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onErrorRef.current?.(msg);
        return null;
      }
    },
    [opts],
  );

  // 整页截图
  const capture = useCallback(async (): Promise<string | null> => {
    setIsCapturing(true);
    setError(null);
    try {
      const dataUrl = await captureElementInternal(document.body);
      if (dataUrl) {
        setLastScreenshot(dataUrl);
        onCaptureRef.current?.(dataUrl);
      }
      return dataUrl;
    } finally {
      setIsCapturing(false);
    }
  }, [captureElementInternal]);

  // 区域截图
  const captureRegion = useCallback(
    async (region: ScreenshotRegion): Promise<string | null> => {
      setIsCapturing(true);
      setError(null);
      try {
        const dataUrl = await captureElementInternal(document.body);
        if (!dataUrl) return null;
        // 裁剪到指定区域
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = reject;
          i.src = dataUrl;
        });
        const canvas = document.createElement('canvas');
        canvas.width = region.width;
        canvas.height = region.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context');
        ctx.drawImage(
          img,
          region.x, region.y, region.width, region.height,
          0, 0, region.width, region.height,
        );
        const cropped = canvas.toDataURL(opts.format, opts.quality);
        setLastScreenshot(cropped);
        onCaptureRef.current?.(cropped);
        return cropped;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onErrorRef.current?.(msg);
        return null;
      } finally {
        setIsCapturing(false);
      }
    },
    [captureElementInternal, opts],
  );

  // 元素截图
  const captureElement = useCallback(
    async (selector: string): Promise<string | null> => {
      setIsCapturing(true);
      setError(null);
      try {
        const element = document.querySelector(selector);
        if (!element || !(element instanceof HTMLElement)) {
          throw new Error(`Element not found: ${selector}`);
        }
        const dataUrl = await captureElementInternal(element);
        if (dataUrl) {
          setLastScreenshot(dataUrl);
          onCaptureRef.current?.(dataUrl);
        }
        return dataUrl;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onErrorRef.current?.(msg);
        return null;
      } finally {
        setIsCapturing(false);
      }
    },
    [captureElementInternal],
  );

  // 重置
  const reset = useCallback(() => {
    setLastScreenshot(null);
    setError(null);
  }, []);

  return {
    isCapturing,
    lastScreenshot,
    error,
    capture,
    captureRegion,
    captureElement,
    reset,
  };
}

export default useScreenshot;
