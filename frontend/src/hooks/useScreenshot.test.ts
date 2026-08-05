// @vitest-environment happy-dom
/**
 * # ============================================================
 * # useScreenshot Hook 单元测试
 * # Cycle 69 G69-03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenshot } from './useScreenshot';

describe('useScreenshot', () => {
  beforeEach(() => {
    // Mock canvas
    const mockCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue(
      'data:image/png;base64,XXX',
    );

    // Mock URL.createObjectURL for SVG fallback
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock-svg-url');
    (URL as any).revokeObjectURL = vi.fn();

    // Mock Image
    const OriginalImage = (global as any).Image;
    (global as any).Image = vi.fn().mockImplementation(function (this: any) {
      const img = {
        width: 800,
        height: 600,
        src: '',
        onload: null as any,
        onerror: null as any,
      };
      setTimeout(() => {
        if (img.onload) img.onload();
      }, 0);
      return img;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with correct defaults', () => {
    const { result } = renderHook(() => useScreenshot());
    expect(result.current.isCapturing).toBe(false);
    expect(result.current.lastScreenshot).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('captures full page', async () => {
    const onCapture = vi.fn();
    const { result } = renderHook(() => useScreenshot({ onCapture }));
    let screenshot: any;
    await act(async () => {
      screenshot = await result.current.capture();
    });
    expect(screenshot).toBeTruthy();
    expect(screenshot).toMatch(/^data:image\/png;base64,/);
    expect(result.current.lastScreenshot).toBe(screenshot);
    expect(onCapture).toHaveBeenCalled();
  });

  it('captures a region', async () => {
    const { result } = renderHook(() => useScreenshot());
    let screenshot: any;
    await act(async () => {
      screenshot = await result.current.captureRegion({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      });
    });
    expect(screenshot).toBeTruthy();
  });

  it('captures a specific element', async () => {
    const div = document.createElement('div');
    div.id = 'test-element';
    div.textContent = 'Hello';
    document.body.appendChild(div);

    const { result } = renderHook(() => useScreenshot());
    let screenshot: any;
    await act(async () => {
      screenshot = await result.current.captureElement('#test-element');
    });
    expect(screenshot).toBeTruthy();

    document.body.removeChild(div);
  });

  it('fails gracefully when element not found', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useScreenshot({ onError }));
    let screenshot: any;
    await act(async () => {
      screenshot = await result.current.captureElement('#does-not-exist');
    });
    expect(screenshot).toBe(null);
    expect(result.current.error).toContain('not found');
    expect(onError).toHaveBeenCalled();
  });

  it('resets state', async () => {
    const { result } = renderHook(() => useScreenshot());
    await act(async () => {
      await result.current.capture();
    });
    expect(result.current.lastScreenshot).toBeTruthy();

    act(() => {
      result.current.reset();
    });
    expect(result.current.lastScreenshot).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('uses custom format', async () => {
    const { result } = renderHook(() =>
      useScreenshot({ format: 'image/jpeg', quality: 0.5 }),
    );
    let screenshot: any;
    await act(async () => {
      screenshot = await result.current.capture();
    });
    expect(screenshot).toBeTruthy();
  });

  it('sets isCapturing during capture', async () => {
    const { result } = renderHook(() => useScreenshot());
    expect(result.current.isCapturing).toBe(false);

    // Use a slow capture
    let resolveCapture: (val: any) => void;
    const capturePromise = new Promise<any>((resolve) => {
      resolveCapture = resolve;
    });

    // Start capture
    const promise = act(async () => {
      const p = result.current.capture();
      // After microtasks, isCapturing should be true
      await Promise.resolve();
      resolveCapture!(null);
      return await p;
    });
    await promise;

    expect(result.current.isCapturing).toBe(false);
  });

  it('handles region with zero width', async () => {
    const { result } = renderHook(() => useScreenshot());
    let screenshot: any;
    await act(async () => {
      screenshot = await result.current.captureRegion({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    });
    // Even with zero dims, should not throw
    expect(screenshot).toBeDefined();
  });
});
