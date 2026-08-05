/**
 * # ============================================================
 * # useImageUpload - 图片上传与压缩 Hook
 * # ============================================================
 * # 核心作用：提供图片选择/拖拽/压缩/上传能力
 * # 设计要点：
 * #   1. 支持文件选择、拖拽、剪贴板粘贴
 * #   2. 客户端压缩（max 1MB，max 2048x2048）
 * #   3. base64 dataURL 输出（与后端多模态 API 兼容）
 * #   4. 验证：MIME 白名单 + 大小限制
 * #   5. 提供缩略图 dataURL（用于预览）
 * # 运行流程：
 * #   1. 组件调用 upload(file) 或通过拖拽/粘贴触发
 * #   2. 验证格式 + 大小
 * #   3. 加载 + 压缩 + 编码
 * #   4. 返回 dataURL + 缩略图
 * # 输入参数：options: { maxSizeMB, maxWidth, maxHeight, acceptedFormats }
 * # 输出结果：{ upload, validate, isUploading, preview, error }
 * # 对标：Trae SOLO ImageUpload
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 69 G69-03 初次创建
 * # ============================================================
 */

import { useCallback, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type ImageFormat = 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/webp' | 'image/gif';

export interface ImageUploadOptions {
  /** 最大文件大小（MB），默认 10MB */
  maxSizeMB?: number;
  /** 压缩目标大小（MB），默认 1MB */
  compressTargetMB?: number;
  /** 最大宽度（像素），默认 2048 */
  maxWidth?: number;
  /** 最大高度（像素），默认 2048 */
  maxHeight?: number;
  /** 接受的格式，默认 png/jpeg/webp/gif */
  acceptedFormats?: ImageFormat[];
  /** 缩略图最大宽度，默认 256 */
  thumbnailMaxWidth?: number;
  /** 上传成功回调 */
  onUpload?: (result: UploadResult) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

export interface UploadResult {
  /** 完整 dataURL */
  dataUrl: string;
  /** 缩略图 dataURL */
  thumbnailDataUrl: string;
  /** 文件名 */
  fileName: string;
  /** MIME 类型 */
  mimeType: string;
  /** 原始大小（字节） */
  originalSize: number;
  /** 压缩后大小（字节） */
  compressedSize: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ImageUploadState {
  /** 上传中 */
  isUploading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 预览 dataURL */
  preview: string | null;
  /** 当前上传结果 */
  result: UploadResult | null;
  /** 操作函数 */
  upload: (file: File) => Promise<UploadResult | null>;
  validate: (file: File) => ValidationResult;
  /** 重置 */
  reset: () => void;
  /** 剪贴板粘贴处理 */
  handlePaste: (event: ClipboardEvent) => Promise<UploadResult | null>;
  /** 拖拽处理 */
  handleDrop: (event: DragEvent) => Promise<UploadResult | null>;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_OPTIONS: Required<Omit<ImageUploadOptions, 'onUpload' | 'onError'>> = {
  maxSizeMB: 10,
  compressTargetMB: 1,
  maxWidth: 2048,
  maxHeight: 2048,
  acceptedFormats: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'],
  thumbnailMaxWidth: 256,
};

// ============================================================
// 工具函数
// ============================================================

function estimateBase64SizeMB(dataUrl: string): number {
  // base64 编码大小约为原始数据的 4/3
  const base64 = dataUrl.split(',')[1] || '';
  return (base64.length * 3) / 4 / (1024 * 1024);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function drawToCanvas(
  img: HTMLImageElement,
  width: number,
  height: number,
  format: ImageFormat,
  quality: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }
  ctx.drawImage(img, 0, 0, width, height);
  // GIF 输出 PNG（浏览器 canvas 不支持直接输出 GIF）
  const outputFormat = format === 'image/gif' ? 'image/png' : format;
  return canvas.toDataURL(outputFormat, quality);
}

function compressImage(
  img: HTMLImageElement,
  originalFormat: ImageFormat,
  options: Required<Omit<ImageUploadOptions, 'onUpload' | 'onError'>>,
): { dataUrl: string; width: number; height: number; sizeMB: number } {
  // 1. 缩放
  let { width, height } = img;
  if (width > options.maxWidth || height > options.maxHeight) {
    const ratio = Math.min(options.maxWidth / width, options.maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  // 2. 初始质量
  let quality = 0.9;
  let dataUrl = drawToCanvas(img, width, height, originalFormat, quality);
  let sizeMB = estimateBase64SizeMB(dataUrl);

  // 3. 迭代降低质量直到达标（仅对有损格式）
  const isLossy = originalFormat === 'image/jpeg' || originalFormat === 'image/jpg' || originalFormat === 'image/webp';
  if (isLossy) {
    while (sizeMB > options.compressTargetMB && quality > 0.3) {
      quality -= 0.1;
      dataUrl = drawToCanvas(img, width, height, originalFormat, quality);
      sizeMB = estimateBase64SizeMB(dataUrl);
    }
  }

  return { dataUrl, width, height, sizeMB };
}

function makeThumbnail(
  img: HTMLImageElement,
  maxWidth: number,
): string {
  const ratio = maxWidth / img.width;
  const w = Math.min(img.width, maxWidth);
  const h = Math.round(img.height * (w / img.width));
  return drawToCanvas(img, w, h, 'image/png', 0.8);
}

function normalizeFormat(mime: string): ImageFormat {
  const m = mime.toLowerCase() as ImageFormat;
  if (m === 'image/jpg') return 'image/jpeg';
  return m;
}

// ============================================================
// Hook 实现
// ============================================================

export function useImageUpload(options: ImageUploadOptions = {}): ImageUploadState {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const onUploadRef = useRef(options.onUpload);
  const onErrorRef = useRef(options.onError);

  // 同步 callback refs
  onUploadRef.current = options.onUpload;
  onErrorRef.current = options.onError;

  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  // 验证
  const validate = useCallback(
    (file: File): ValidationResult => {
      const format = normalizeFormat(file.type);
      if (!opts.acceptedFormats.includes(format)) {
        return { valid: false, error: `Unsupported format: ${file.type}` };
      }
      const sizeMB = file.size / (1024 * 1024);
      if (sizeMB > opts.maxSizeMB) {
        return { valid: false, error: `File too large: ${sizeMB.toFixed(2)}MB > ${opts.maxSizeMB}MB` };
      }
      return { valid: true };
    },
    [opts],
  );

  // 上传核心逻辑
  const upload = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      const validation = validate(file);
      if (!validation.valid) {
        setError(validation.error || 'Validation failed');
        onErrorRef.current?.(validation.error || 'Validation failed');
        return null;
      }

      setIsUploading(true);
      setError(null);

      try {
        // 1. 加载图片
        const img = await loadImage(file);
        const originalFormat = normalizeFormat(file.type);

        // 2. 压缩
        const { dataUrl, width, height } = compressImage(img, originalFormat, opts);

        // 3. 缩略图
        const thumbnailDataUrl = makeThumbnail(img, opts.thumbnailMaxWidth);

        // 4. 构造结果
        const uploadResult: UploadResult = {
          dataUrl,
          thumbnailDataUrl,
          fileName: file.name,
          mimeType: originalFormat,
          originalSize: file.size,
          compressedSize: Math.round(
            (dataUrl.split(',')[1]?.length || 0) * 3 / 4,
          ),
          width,
          height,
        };

        setResult(uploadResult);
        setPreview(thumbnailDataUrl);
        onUploadRef.current?.(uploadResult);
        return uploadResult;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        onErrorRef.current?.(msg);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [validate, opts],
  );

  // 剪贴板粘贴
  const handlePaste = useCallback(
    async (event: ClipboardEvent): Promise<UploadResult | null> => {
      if (!event.clipboardData) return null;
      const items = Array.from(event.clipboardData.items);
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            return await upload(file);
          }
        }
      }
      return null;
    },
    [upload],
  );

  // 拖拽
  const handleDrop = useCallback(
    async (event: DragEvent): Promise<UploadResult | null> => {
      if (!event.dataTransfer) return null;
      const files = Array.from(event.dataTransfer.files);
      const imageFile = files.find((f) => f.type.startsWith('image/'));
      if (imageFile) {
        event.preventDefault();
        return await upload(imageFile);
      }
      return null;
    },
    [upload],
  );

  // 重置
  const reset = useCallback(() => {
    setResult(null);
    setPreview(null);
    setError(null);
  }, []);

  return {
    isUploading,
    error,
    preview,
    result,
    upload,
    validate,
    reset,
    handlePaste,
    handleDrop,
  };
}

export default useImageUpload;
