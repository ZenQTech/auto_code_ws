// @vitest-environment happy-dom
/**
 * # ============================================================
 * # useImageUpload Hook 单元测试
 * # Cycle 69 G69-03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImageUpload } from './useImageUpload';

function createMockFile(
  name: string,
  type: string,
  size: number = 1024,
): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

function createMockImage(): { width: number; height: number; onload: () => void } {
  const img: any = {
    width: 1000,
    height: 800,
    src: '',
    onload: null as any,
    onerror: null as any,
  };
  setTimeout(() => {
    if (img.onload) img.onload();
  }, 0);
  return img as any;
}

describe('useImageUpload', () => {
  beforeEach(() => {
    // Mock URL.createObjectURL
    (URL as any).createObjectURL = vi.fn(() => 'blob:mock-url');
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

    // Mock canvas
    const mockCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockImplementation(
      (format: string, quality?: number) => {
        // 模拟输出 dataURL
        const size = Math.floor(1000 * (quality || 0.9));
        return `data:${format};base64,${'A'.repeat(size)}`;
      },
    );

    return () => {
      (global as any).Image = OriginalImage;
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with correct defaults', () => {
    const { result } = renderHook(() => useImageUpload());
    expect(result.current.isUploading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.preview).toBe(null);
    expect(result.current.result).toBe(null);
  });

  it('validates supported format', () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('test.png', 'image/png', 1024);
    const v = result.current.validate(file);
    expect(v.valid).toBe(true);
  });

  it('rejects unsupported format', () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('test.bmp', 'image/bmp', 1024);
    const v = result.current.validate(file);
    expect(v.valid).toBe(false);
    expect(v.error).toContain('Unsupported format');
  });

  it('rejects too large file', () => {
    const { result } = renderHook(() => useImageUpload({ maxSizeMB: 1 }));
    const file = createMockFile('big.png', 'image/png', 5 * 1024 * 1024);
    const v = result.current.validate(file);
    expect(v.valid).toBe(false);
    expect(v.error).toContain('too large');
  });

  it('accepts jpg format', () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('test.jpg', 'image/jpg', 1024);
    const v = result.current.validate(file);
    expect(v.valid).toBe(true);
  });

  it('uploads a file', async () => {
    const onUpload = vi.fn();
    const { result } = renderHook(() => useImageUpload({ onUpload }));
    const file = createMockFile('test.png', 'image/png', 1024);

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.upload(file);
    });

    expect(uploadResult).toBeTruthy();
    expect(uploadResult.fileName).toBe('test.png');
    expect(uploadResult.mimeType).toBe('image/png');
    expect(onUpload).toHaveBeenCalled();
  });

  it('sets error on validation failure', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useImageUpload({ onError }));
    const file = createMockFile('test.bmp', 'image/bmp', 1024);

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.upload(file);
    });

    expect(uploadResult).toBe(null);
    expect(result.current.error).toContain('Unsupported');
    expect(onError).toHaveBeenCalled();
  });

  it('resets state', async () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('test.png', 'image/png', 1024);

    await act(async () => {
      await result.current.upload(file);
    });

    expect(result.current.result).toBeTruthy();

    act(() => {
      result.current.reset();
    });

    expect(result.current.result).toBe(null);
    expect(result.current.preview).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('handles paste event', async () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('pasted.png', 'image/png', 1024);

    const item = {
      type: 'image/png',
      getAsFile: vi.fn(() => file),
    };
    const clipboardData = {
      items: [item],
    } as any;

    const event = {
      clipboardData,
      preventDefault: vi.fn(),
    } as any;

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.handlePaste(event);
    });

    expect(uploadResult).toBeTruthy();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('handles paste event with no image', async () => {
    const { result } = renderHook(() => useImageUpload());
    const clipboardData = {
      items: [{ type: 'text/plain', getAsFile: () => null }],
    } as any;
    const event = {
      clipboardData,
      preventDefault: vi.fn(),
    } as any;

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.handlePaste(event);
    });

    expect(uploadResult).toBe(null);
  });

  it('handles drop event', async () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('dropped.png', 'image/png', 1024);

    const dataTransfer = {
      files: [file],
    } as any;
    const event = {
      dataTransfer,
      preventDefault: vi.fn(),
    } as any;

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.handleDrop(event);
    });

    expect(uploadResult).toBeTruthy();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('handles drop event with no image', async () => {
    const { result } = renderHook(() => useImageUpload());
    const dataTransfer = {
      files: [createMockFile('text.txt', 'text/plain')],
    } as any;
    const event = {
      dataTransfer,
      preventDefault: vi.fn(),
    } as any;

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.handleDrop(event);
    });

    expect(uploadResult).toBe(null);
  });

  it('produces thumbnail and dataurl', async () => {
    const { result } = renderHook(() => useImageUpload());
    const file = createMockFile('test.png', 'image/png', 1024);

    let uploadResult: any;
    await act(async () => {
      uploadResult = await result.current.upload(file);
    });

    expect(uploadResult.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(uploadResult.thumbnailDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(uploadResult.width).toBe(800);
    expect(uploadResult.height).toBe(600);
  });
});
