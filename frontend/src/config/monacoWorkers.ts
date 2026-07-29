/**
 * # ============================================================
 * # Monaco Editor Workers 配置 (v6.33.0 P0-5)
 * # ============================================================
 * # 核心作用：配置 Monaco Editor 的 Web Workers 按需懒加载
 * # 解决问题：Monaco 默认会一次性加载所有 workers (~7MB)，
 * #         改用懒加载后，主包保持精简，workers 按需触发
 * # 运行流程：
 * #   1. 设置 self.MonacoEnvironment.getWorker
 * #   2. 根据 label (json/css/html/typescript) 懒加载对应 worker
 * #   3. 编辑器默认场景（仅 typescript/javascript）只加载 ts.worker
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-5 初始化
 * # ============================================================
 */

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// ============================================================
// 配置 Monaco Workers 懒加载
// 根据 label 选择合适的 worker，避免加载所有 worker
// ============================================================

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    // 按 label 懒加载对应 worker（首次触发时下载 + 缓存）
    if (label === 'json') {
      return new JsonWorker();
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new CssWorker();
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new HtmlWorker();
    }
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker();
    }
    // 默认通用 editor worker
    return new EditorWorker();
  },
};
