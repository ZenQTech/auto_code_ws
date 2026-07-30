/**
 * # ============================================================
 * # MTC Adapter - MTC（More Than Coding）适配器核心实现 (v1.0.0 Cycle 26 G26-03)
 * # ============================================================
 * # 核心作用：实现非编码任务的文件处理与任务执行
 * # 运行流程：
 * #   1. loadFile 检测文件类型 + 解析内容
 * #   2. createTask 创建任务
 * #   3. runTask 路由到对应 handler（summarize/translate/...）
 * #   4. handler 调用 LLM 生成结果
 * #   5. exportResult 导出为指定格式
 * # 输入参数：loadFile, createTask, runTask
 * # 输出结果：MtcFile/MtcTask/MtcResult
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-03 初次创建
 * # ============================================================
 */

import {
  MtcConfig,
  MtcFile,
  MtcTask,
  MtcResult,
  MtcFileType,
  MtcTaskParams,
  MtcOutputFormat,
  MtcVisualization,
  CreateTaskInput,
  LLMCaller,
  MtcEvent,
  MtcEventType,
  DEFAULT_MTC_CONFIG,
  generateFileId,
  generateTaskId,
  generateResultId,
} from './mtcAdapterTypes';

// ============ 文件类型检测 ============

const EXTENSION_MAP: Record<string, MtcFileType> = {
  '.txt': 'text',
  '.md': 'code-md',
  '.markdown': 'code-md',
  '.csv': 'data-csv',
  '.json': 'data-json',
  '.ts': 'code-ts',
  '.tsx': 'code-ts',
  '.js': 'code-js',
  '.jsx': 'code-js',
  '.py': 'code-py',
  '.css': 'code-css',
  '.scss': 'code-css',
  '.html': 'code-html',
  '.htm': 'code-html',
};

/**
 * 检测文件类型
 */
export function detectFileType(name: string, content: string): MtcFileType {
  const lowerName = name.toLowerCase();
  // 先按扩展名
  for (const ext of Object.keys(EXTENSION_MAP)) {
    if (lowerName.endsWith(ext)) {
      return EXTENSION_MAP[ext];
    }
  }
  // 启发式检测
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'data-json';
    } catch {
      // 不是 JSON
    }
  }
  if (trimmed.includes(',') && trimmed.split('\n').length > 1) {
    // 可能是 CSV
    const firstLine = trimmed.split('\n')[0];
    if (firstLine.split(',').length > 1) {
      return 'data-csv';
    }
  }
  return 'text';
}

// ============ 文件解析 ============

/**
 * 解析文件内容（CSV/JSON）
 */
export function parseFileContent(file: MtcFile): MtcFile {
  if (file.type === 'data-csv') {
    const lines = file.content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return file;
    const headers = parseCsvLine(lines[0]);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = values[j] ?? '';
      }
      rows.push(row);
    }
    return { ...file, parsed: { headers, rows } };
  }
  if (file.type === 'data-json') {
    try {
      return { ...file, parsed: JSON.parse(file.content) };
    } catch {
      return file;
    }
  }
  return file;
}

/**
 * 简单 CSV 行解析（支持引号）
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(field);
        field = '';
      } else {
        field += ch;
      }
    }
  }
  result.push(field);
  return result;
}

// ============ 核心引擎类 ============

export class MtcAdapter {
  private config: MtcConfig;
  private files: Map<string, MtcFile> = new Map();
  private tasks: Map<string, MtcTask> = new Map();
  private listeners: Map<string, Set<Function>> = new Map();
  private stats = { files: 0, tasks: 0, completed: 0, failed: 0 };
  private storageKey = 'hermes.mtcAdapter';
  private llmCaller?: LLMCaller;

  constructor(config: Partial<MtcConfig> = {}) {
    this.config = { ...DEFAULT_MTC_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ LLM 注入 ============

  /**
   * 设置 LLM 调用函数
   */
  setLLMCaller(caller: LLMCaller): void {
    this.llmCaller = caller;
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data.files)) {
          for (const f of data.files) {
            this.files.set(f.id, f);
          }
        }
        if (Array.isArray(data.tasks)) {
          for (const t of data.tasks) {
            this.tasks.set(t.id, t);
          }
        }
        this.stats = data.stats ?? this.stats;
      }
    } catch (e) {
      console.warn('MtcAdapter: failed to load from localStorage', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        files: Array.from(this.files.values()),
        tasks: Array.from(this.tasks.values()).slice(-50), // 仅保留最近 50 个
        stats: this.stats,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      console.warn('MtcAdapter: failed to save to localStorage', e);
    }
  }

  // ============ 事件系统 ============

  on(event: MtcEventType, listener: (e: MtcEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: MtcEventType, listener: Function): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: MtcEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error(`MtcAdapter: error in event handler for ${event.type}`, err);
        }
      }
    }
  }

  // ============ 文件管理 ============

  /**
   * 从 File 对象加载
   */
  async loadFile(file: File): Promise<MtcFile> {
    if (file.size > this.config.maxFileSize) {
      throw new Error(`File too large: ${file.size} > ${this.config.maxFileSize}`);
    }
    const content = await file.text();
    return this.loadFileFromContent(file.name, content);
  }

  /**
   * 从名称 + 内容加载
   */
  loadFileFromContent(name: string, content: string): MtcFile {
    const type = detectFileType(name, content);
    let mtcFile: MtcFile = {
      id: generateFileId(),
      name,
      type,
      size: content.length,
      content,
      loadedAt: Date.now(),
    };
    mtcFile = parseFileContent(mtcFile);
    this.files.set(mtcFile.id, mtcFile);
    this.stats.files++;
    this.save();
    this.emit({ type: 'file-loaded', file: mtcFile });
    return mtcFile;
  }

  /**
   * 批量加载
   */
  async loadFiles(files: File[]): Promise<MtcFile[]> {
    const results: MtcFile[] = [];
    for (const f of files) {
      results.push(await this.loadFile(f));
    }
    return results;
  }

  /**
   * 移除文件
   */
  removeFile(fileId: string): boolean {
    const removed = this.files.delete(fileId);
    if (removed) {
      this.save();
      this.emit({ type: 'file-removed', fileId });
    }
    return removed;
  }

  /**
   * 获取文件
   */
  getFile(fileId: string): MtcFile | undefined {
    return this.files.get(fileId);
  }

  /**
   * 获取所有文件
   */
  getAllFiles(): MtcFile[] {
    return Array.from(this.files.values()).sort((a, b) => b.loadedAt - a.loadedAt);
  }

  // ============ 任务管理 ============

  /**
   * 创建任务
   */
  createTask(input: CreateTaskInput): MtcTask {
    // 验证文件存在
    for (const fileId of input.fileIds) {
      if (!this.files.has(fileId)) {
        throw new Error(`File ${fileId} not found`);
      }
    }
    const task: MtcTask = {
      id: generateTaskId(),
      type: input.type,
      fileIds: input.fileIds,
      params: input.params,
      outputFormat: input.outputFormat,
      status: 'pending',
      createdAt: Date.now(),
      model: input.model,
    };
    this.tasks.set(task.id, task);
    this.stats.tasks++;
    this.save();
    this.emit({ type: 'task-created', task });
    return task;
  }

  /**
   * 启动任务
   */
  async runTask(taskId: string): Promise<MtcResult> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === 'running') throw new Error(`Task ${taskId} is already running`);

    task.status = 'running';
    task.startedAt = Date.now();
    this.save();
    this.emit({ type: 'task-started', taskId });

    try {
      const result = await this.runHandler(task);
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;
      this.stats.completed++;
      this.save();
      this.emit({ type: 'task-completed', taskId, result });
      return result;
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = Date.now();
      this.stats.failed++;
      this.save();
      this.emit({ type: 'task-failed', taskId, error: task.error });
      throw err;
    }
  }

  /**
   * 取消任务（仅能取消未开始的）
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'pending') {
      task.status = 'cancelled';
      this.save();
      this.emit({ type: 'task-cancelled', taskId });
    }
  }

  /**
   * 批量运行
   */
  async runBatch(taskIds: string[]): Promise<MtcResult[]> {
    const results: MtcResult[] = [];
    const concurrency = Math.max(1, Math.min(10, this.config.maxConcurrency));
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(
        (async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= taskIds.length) return;
            const result = await this.runTask(taskIds[idx]).catch((e) => ({
              id: '',
              taskId: taskIds[idx],
              content: '',
              duration: 0,
              metadata: { error: String(e) },
            } as MtcResult));
            results.push(result);
          }
        })()
      );
    }
    await Promise.all(workers);
    return results;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): MtcTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): MtcTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  // ============ 处理器路由 ============

  private async runHandler(task: MtcTask): Promise<MtcResult> {
    const startedAt = Date.now();
    let content = '';
    let extracted: unknown[] | undefined;
    let visualization: MtcVisualization | undefined;
    let metadata: Record<string, unknown> | undefined;

    switch (task.type) {
      case 'summarize':
        content = await this.handleSummarize(task);
        break;
      case 'translate':
        content = await this.handleTranslate(task);
        break;
      case 'rewrite':
        content = await this.handleRewrite(task);
        break;
      case 'analyze':
        const analysis = await this.handleAnalyze(task);
        content = analysis.content;
        visualization = analysis.visualization;
        metadata = analysis.metadata;
        break;
      case 'convert':
        content = await this.handleConvert(task);
        break;
      case 'extract':
        const extractResult = await this.handleExtract(task);
        content = extractResult.content;
        extracted = extractResult.extracted;
        break;
      case 'optimize':
        content = await this.handleOptimize(task);
        metadata = { optimized: true };
        break;
      default:
        throw new Error(`Unknown task type: ${(task.params as { type: string }).type}`);
    }

    return {
      id: generateResultId(),
      taskId: task.id,
      content,
      metadata,
      extracted,
      visualization,
      duration: Date.now() - startedAt,
    };
  }

  // ============ 处理器实现 ============

  private async handleSummarize(task: MtcTask): Promise<string> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'summarize' }>;
    const prompt = `请用${params.language || '中文'}总结以下内容${params.maxLength ? `（不超过 ${params.maxLength} 字）` : ''}：${params.focusAreas?.length ? `\n重点关注：${params.focusAreas.join('、')}` : ''}\n\n${content}`;
    return await this.callLLM(prompt, task.model);
  }

  private async handleTranslate(task: MtcTask): Promise<string> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'translate' }>;
    const prompt = `请将以下内容从 ${params.from} 翻译为 ${params.to}${params.preserveFormatting ? '（保持原格式）' : ''}：\n\n${content}`;
    return await this.callLLM(prompt, task.model);
  }

  private async handleRewrite(task: MtcTask): Promise<string> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'rewrite' }>;
    const prompt = `请用 ${params.style} 风格重写以下内容${params.preserveMeaning ? '（保持原意）' : ''}：\n\n${content}`;
    return await this.callLLM(prompt, task.model);
  }

  private async handleAnalyze(task: MtcTask): Promise<{ content: string; visualization?: MtcVisualization; metadata?: Record<string, unknown> }> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'analyze' }>;
    const prompt = `请分析以下数据${params.questions?.length ? `，重点回答：${params.questions.join('; ')}` : '，提取关键洞察'}${params.generateVisualization ? '，并建议合适的可视化方案' : ''}：\n\n${content}\n\n输出格式：\n## 关键洞察\n- ...\n## 趋势分析\n- ...\n## 建议\n- ...\n${params.generateVisualization ? '## 可视化建议\n- 图表类型: ...\n- 维度: ...' : ''}`;
    const llmResult = await this.callLLM(prompt, task.model);
    let visualization: MtcVisualization | undefined;
    if (params.generateVisualization) {
      visualization = this.extractVisualization(llmResult);
    }
    return { content: llmResult, visualization, metadata: { analyzedAt: Date.now() } };
  }

  private async handleConvert(task: MtcTask): Promise<string> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'convert' }>;
    const prompt = `请将以下内容转换为 ${params.targetFormat} 格式：\n\n${content}`;
    return await this.callLLM(prompt, task.model);
  }

  private async handleExtract(task: MtcTask): Promise<{ content: string; extracted: unknown[] }> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'extract' }>;
    const prompt = `请从以下内容中提取以下字段：${params.fields.join(', ')}\n\n内容：\n${content}\n\n请以 ${params.format} 格式输出，仅返回提取结果。`;
    const llmResult = await this.callLLM(prompt, task.model);
    // 尝试解析为结构化数据
    let extracted: unknown[] = [];
    try {
      if (params.format === 'json') {
        const parsed = JSON.parse(llmResult);
        extracted = Array.isArray(parsed) ? parsed : [parsed];
      } else if (params.format === 'csv') {
        const lines = llmResult.trim().split('\n');
        if (lines.length > 1) {
          const headers = lines[0].split(',');
          extracted = lines.slice(1).map((l) => {
            const values = l.split(',');
            const obj: Record<string, string> = {};
            headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
            return obj;
          });
        }
      } else {
        extracted = llmResult.split('\n').filter((l) => l.trim()).map((l) => l.replace(/^[-*]\s*/, ''));
      }
    } catch {
      extracted = [llmResult];
    }
    return { content: llmResult, extracted };
  }

  private async handleOptimize(task: MtcTask): Promise<string> {
    const files = task.fileIds.map((id) => this.files.get(id)!);
    const content = files.map((f) => f.content).join('\n\n');
    const params = task.params as Extract<MtcTaskParams, { type: 'optimize' }>;
    const prompt = `请优化以下代码${params.preserveApi ? '（保持 API 不变）' : ''}：\n优化目标：${params.goals.join(', ')}\n\n代码：\n${content}\n\n输出：\n## 优化建议\n- ...\n## 重构后代码\n\`\`\`\n...\n\`\`\``;
    return await this.callLLM(prompt, task.model);
  }

  // ============ 工具方法 ============

  private extractVisualization(content: string): MtcVisualization | undefined {
    // 简单解析：找到 "图表类型: xxx" 模式
    const typeMatch = content.match(/图表类型[::]\s*(\w+)/);
    if (!typeMatch) return undefined;
    const typeMap: Record<string, MtcVisualization['type']> = {
      bar: 'bar',
      柱状图: 'bar',
      line: 'line',
      折线图: 'line',
      pie: 'pie',
      饼图: 'pie',
      scatter: 'scatter',
      散点图: 'scatter',
      table: 'table',
      表格: 'table',
      heatmap: 'heatmap',
      热力图: 'heatmap',
    };
    const t = (typeMatch[1] || '').toLowerCase();
    const vtype = typeMap[t] ?? 'table';
    return {
      type: vtype,
      title: 'Data Visualization',
      data: null,
      description: 'Auto-suggested from analysis',
    };
  }

  private async callLLM(prompt: string, model?: string): Promise<string> {
    if (!this.llmCaller) {
      // 提供一个 mock 默认实现
      return `[MOCK LLM Output]\nPrompt length: ${prompt.length} chars\nModel: ${model || this.config.defaultModel}\n\n(This is a placeholder response. Set llmCaller via setLLMCaller() to use a real LLM.)`;
    }
    return await this.llmCaller(prompt, model);
  }

  // ============ 导出 ============

  /**
   * 导出结果为指定格式（支持 taskId 或 resultId）
   */
  exportResult(idOrTaskId: string, format: MtcOutputFormat): string {
    // 先按 taskId 查找
    const taskById = this.tasks.get(idOrTaskId);
    if (taskById?.result) {
      return this.formatOutput(taskById.result.content, format);
    }
    // 再按 resultId 查找
    for (const task of this.tasks.values()) {
      if (task.result?.id === idOrTaskId) {
        return this.formatOutput(task.result.content, format);
      }
    }
    throw new Error(`Result ${idOrTaskId} not found`);
  }

  /**
   * 批量导出
   */
  exportBatch(taskIds: string[]): string {
    const results: string[] = [];
    for (const id of taskIds) {
      const task = this.tasks.get(id);
      if (task?.result) {
        results.push(`# ${task.type}: ${task.id}\n\n${task.result.content}`);
      }
    }
    return results.join('\n\n---\n\n');
  }

  private formatOutput(content: string, format: MtcOutputFormat): string {
    if (format === 'markdown') return content;
    if (format === 'text') {
      // 移除 markdown 标记
      return content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/`/g, '');
    }
    if (format === 'json') {
      // 包装为 JSON
      return JSON.stringify({ result: content, generatedAt: new Date().toISOString() }, null, 2);
    }
    if (format === 'html') {
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Result</title></head><body><pre>${content.replace(/</g, '&lt;')}</pre></body></html>`;
    }
    return content;
  }

  /**
   * 获取统计
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 清理所有数据
   */
  clear(): void {
    this.files.clear();
    this.tasks.clear();
    this.stats = { files: 0, tasks: 0, completed: 0, failed: 0 };
    this.save();
  }
}

// ============ 单例 ============

let _defaultAdapter: MtcAdapter | undefined;

export function getDefaultMtcAdapter(): MtcAdapter {
  if (!_defaultAdapter) {
    _defaultAdapter = new MtcAdapter();
  }
  return _defaultAdapter;
}

export function resetDefaultMtcAdapter(): void {
  _defaultAdapter?.clear();
  _defaultAdapter = undefined;
}
