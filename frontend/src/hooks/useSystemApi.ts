import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiShared';
import type { ArchitectureCritique, ArchitectureDesign, ArchitectureStatus, ConfigSection, EvaluationReport, FileContent, FileTreeNode, GitBranch, GitCommit, GitStatus, MemorySearchResult, MemoryStats, Project, QuotaOverview, SecurityReview } from '../types';

/**
 * # ============================================================
 * 系统 API 模块
 * # ============================================================
 * 核心作用：封装配额 / 架构 / Git / Memory / 模型选择 / 评估 API
 * 拆分日期：2026-07-27
 * 来源文件：hooks/useApi.ts (v3.0.0, 1872 行单文件)
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 useQuota + useArchitectureStatus* + useEvaluationReport + useGitStatus + useGitLog + useGitBranches + fetchDiffFiles + checkoutFile + useMemorySearch + useMemoryStats + 模型/强度/Review/Fix API 共 30 个函数
 * ============================================================
 */

/**
 * 共享类型导入
 */
export function useQuota() {
  const [quota, setQuota] = useState<QuotaOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchQuota = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<QuotaOverview>('/quota/overview');
      setQuota(data);
    } catch (e) {
      console.error('获取配额数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQuota();
    const interval = setInterval(fetchQuota, 30000);
    return () => clearInterval(interval);
  }, [fetchQuota]);

  return { quota, loading, refetch: fetchQuota };
}

/**
 * 获取架构设计工作流状态
 * 作用：拉取架构设计阶段的迭代状态、审核状态
 * 调用方：ArchitectureViewer.tsx 架构设计查看器
 * 被调用方：GET /api/architecture/status
 * 参数：无
 * 返回值：{ status, loading, refetch }
 */
export function useArchitectureStatus() {
  const [status, setStatus] = useState<ArchitectureStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ArchitectureStatus>('/architecture/status');
      setStatus(data);
    } catch (e) {
      console.error('获取架构状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return { status, loading, refetch: fetchStatus };
}

/**
 * 获取架构设计文档
 * 作用：拉取架构设计文档的 Markdown 内容
 * 调用方：ArchitectureViewer.tsx 架构设计查看器
 * 被调用方：GET /api/architecture/design
 * 参数：无
 * 返回值：{ design, loading, refetch }
 */
export function useArchitectureDesign() {
  const [design, setDesign] = useState<ArchitectureDesign | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDesign = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ArchitectureDesign>('/architecture/design');
      setDesign(data);
    } catch (e) {
      console.error('获取架构设计文档失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDesign(); }, [fetchDesign]);

  return { design, loading, refetch: fetchDesign };
}

/**
 * 获取架构审查结果
 * 作用：拉取架构审查的缺陷列表和审查结论
 * 调用方：ArchitectureViewer.tsx 架构设计查看器
 * 被调用方：GET /api/architecture/critique
 * 参数：无
 * 返回值：{ critique, loading, refetch }
 */
export function useArchitectureCritique() {
  const [critique, setCritique] = useState<ArchitectureCritique | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCritique = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ArchitectureCritique>('/architecture/critique');
      setCritique(data);
    } catch (e) {
      console.error('获取架构审查结果失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCritique(); }, [fetchCritique]);

  return { critique, loading, refetch: fetchCritique };
}

/**
 * 获取评测报告
 * 作用：拉取指定类型的评测报告（architecture / code / integration / security）
 * 调用方：EvaluationReport.tsx 评测报告查看器
 * 被调用方：GET /api/evaluation/report/{type}
 * 参数：
 *   - type: string，报告类型
 * 返回值：{ report, loading, refetch }
 */
export function useEvaluationReport(type: string) {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<EvaluationReport>(`/evaluation/report/${type}`);
      setReport(data);
    } catch (e) {
      console.error('获取评测报告失败:', e);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  return { report, loading, refetch: fetchReport };
}

/**
 * 获取 Git 仓库状态
 * 作用：拉取当前仓库的分支、干净/脏状态、变更文件数等
 * 调用方：GitPanel.tsx Git 管理面板
 * 被调用方：GET /api/git/status
 * 参数：无
 * 返回值：{ gitStatus, loading, refetch }
 */
export function useGitStatus() {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchGitStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<GitStatus>('/git/status');
      setGitStatus(data);
    } catch (e) {
      console.error('获取 Git 状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGitStatus(); }, [fetchGitStatus]);

  return { gitStatus, loading, refetch: fetchGitStatus };
}

/**
 * 获取 Git 提交日志
 * 作用：拉取最近的 Git 提交记录
 * 调用方：GitPanel.tsx Git 管理面板
 * 被调用方：GET /api/git/log
 * 参数：
 *   - limit?: number，返回条数上限（默认 10）
 * 返回值：{ commits, loading, refetch }
 */
export function useGitLog(limit?: number) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCommits = useCallback(async () => {
    setLoading(true);
    try {
      const params = limit ? `?limit=${limit}` : '';
      const data = await apiFetch<GitCommit[]>(`/git/log${params}`);
      setCommits(data);
    } catch (e) {
      console.error('获取 Git 日志失败:', e);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => { fetchCommits(); }, [fetchCommits]);

  return { commits, loading, refetch: fetchCommits };
}

/**
 * 获取 Git 分支列表
 * 作用：拉取所有分支及其最后提交信息
 * 调用方：GitPanel.tsx Git 管理面板
 * 被调用方：GET /api/git/branches
 * 参数：无
 * 返回值：{ branches, loading, refetch }
 */
export function useGitBranches() {
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<GitBranch[]>('/git/branches');
      setBranches(data);
    } catch (e) {
      console.error('获取分支列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  return { branches, loading, refetch: fetchBranches };
}

// ============================================================
// DiffView API（v2.10.0 新增 - Module D）
// 核心作用：提供文件级 diff 与单文件回退能力
// 端点契约：
//   - POST /api/git/diff-files?staged=false  列出变更文件及每文件 diff
//   - POST /api/git/checkout-file           回退指定文件
// ============================================================

/** 文件级 diff 响应（单文件） */
export interface FileDiffResponse {
  /** 文件路径 */
  path: string;
  /** 变更类型：modified / added / deleted / renamed / untracked */
  status: string;
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
  /** diff patch 文本 */
  patch: string;
  /** 是否已暂存 */
  is_staged: boolean;
}

/** 文件级 diff 列表响应 */
export interface DiffFilesResponse {
  files: FileDiffResponse[];
  total_files: number;
  total_additions: number;
  total_deletions: number;
  staged_only: boolean;
}

/** 文件回退响应 */
export interface CheckoutFileResponse {
  success: boolean;
  message: string;
  file_path: string;
}

/**
 * 获取工作区文件级 diff 列表（v2.10.0 新增 - Module D）
 * 作用：列出所有变更文件及每文件的 path / status / additions / deletions / patch
 * 调用方：DiffView.tsx
 * 被调用方：POST /api/git/diff-files
 * 参数：
 *   - staged?: boolean，是否仅返回已暂存变更（默认 false）
 * 返回值：DiffFilesResponse
 */
export async function fetchDiffFiles(staged: boolean = false): Promise<DiffFilesResponse> {
  return apiFetch<DiffFilesResponse>(
    `/git/diff-files${staged ? '?staged=true' : ''}`,
    { method: 'POST' }
  );
}

/**
 * 回退（撤销）指定文件的工作区修改（v2.10.0 新增 - Module D）
 * 作用：撤销该文件所有未提交修改（恢复为 HEAD 状态）
 * 调用方：DiffView.tsx
 * 被调用方：POST /api/git/checkout-file
 * 参数：
 *   - filePath: string，待回退的文件路径
 * 返回值：CheckoutFileResponse
 */
export async function checkoutFile(filePath: string): Promise<CheckoutFileResponse> {
  return apiFetch<CheckoutFileResponse>('/git/checkout-file', {
    method: 'POST',
    body: JSON.stringify({ file_path: filePath }),
  });
}

/**
 * 搜索记忆库
 * 作用：根据查询关键词搜索代码片段记忆库
 * 调用方：MemoryPanel.tsx 记忆库面板
 * 被调用方：GET /api/memory/search
 * 参数：
 *   - query: string，搜索关键词
 * 返回值：{ results, loading, search }
 * 注意：不自动触发搜索，需手动调用 search(query)
 */
export function useMemorySearch() {
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<MemorySearchResult[]>(`/memory/search?q=${encodeURIComponent(query)}`);
      setResults(data);
    } catch (e) {
      console.error('搜索记忆库失败:', e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { results, loading, search };
}

/**
 * 获取记忆库统计信息
 * 作用：拉取记忆库的总体统计数据
 * 调用方：MemoryPanel.tsx 记忆库面板
 * 被调用方：GET /api/memory/stats
 * 参数：无
 * 返回值：{ stats, loading, refetch }
 */
export function useMemoryStats() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<MemoryStats>('/memory/stats');
      setStats(data);
    } catch (e) {
      console.error('获取记忆库统计失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}

/**
 * 获取安全审查记录
 * 作用：拉取安全审查的检查项列表和审查状态
 * 调用方：SecurityReviewPanel.tsx 安全审查面板
 * 被调用方：GET /api/security/review
 * 参数：无
 * 返回值：{ review, loading, refetch }
 */
export function useSecurityReview() {
  const [review, setReview] = useState<SecurityReview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<SecurityReview>('/security/review');
      setReview(data);
    } catch (e) {
      console.error('获取安全审查记录失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchReview(); }, [fetchReview]);

  return { review, loading, refetch: fetchReview };
}

/**
 * 获取全局配置分组
 * 作用：拉取所有可配置参数的分组列表
 * 调用方：ConfigPanel.tsx 全局配置中心
 * 被调用方：GET /api/config/sections
 * 参数：无
 * 返回值：{ sections, loading, refetch }
 */
export function useConfigSections() {
  const [sections, setSections] = useState<ConfigSection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<ConfigSection[]>('/config/sections');
      setSections(data);
    } catch (e) {
      console.error('获取配置分组失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSections(); }, [fetchSections]);

  return { sections, loading, refetch: fetchSections };
}

// ============================================================
// 全局配置中心 API（v1.7.0 新增 - Task 3/7）
// 核心作用：提供全局配置的读取和更新 API 函数
// 端点契约：
//   - GET  /api/config  读取完整配置
//   - PUT  /api/config  部分更新配置
// ============================================================

/** 全局配置完整响应类型 */
export interface FullConfig {
  server: Record<string, unknown>;
  database: Record<string, unknown>;
  cli: Record<string, unknown>;
  scheduling: Record<string, unknown>;
  hermes: Record<string, unknown>;
  logging: Record<string, unknown>;
  storage: Record<string, unknown>;
  quota: Record<string, unknown>;
  context: Record<string, unknown>;
  architecture: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  human_review: Record<string, unknown>;
  task_timeout: Record<string, unknown>;
  api_error_handling: Record<string, unknown>;
  git: Record<string, unknown>;
  memory_store: Record<string, unknown>;
  security: Record<string, unknown>;
  notification: Record<string, unknown>;
  local_intercept: Record<string, unknown>;
}

/**
 * 获取完整全局配置
 * 作用：调用 GET /api/config 读取 auto_code_config.yaml 全部内容
 * 调用方：SettingsPanel.tsx 设置面板（组件挂载时）
 * 被调用方：GET /api/config
 * 参数：无
 * 返回值：Promise<FullConfig>，包含所有 section 的完整配置
 */
export async function fetchConfig(): Promise<FullConfig> {
  return apiFetch<FullConfig>('/config');
}

/**
 * 更新全局配置（部分更新）
 * 作用：调用 PUT /api/config，将用户修改的 section 写入配置文件，
 *       后端自动合并到现有 YAML 并调用 settings.reload() 重载
 * 调用方：SettingsPanel.tsx「保存设置」按钮
 * 被调用方：PUT /api/config
 * 参数：
 *   - patch: Partial<FullConfig>，仅包含需要更新的 section 字段
 * 返回值：Promise<FullConfig>，更新后的完整配置
 */
export async function updateConfig(patch: Partial<FullConfig>): Promise<FullConfig> {
  return apiFetch<FullConfig>('/config', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// ============================================================
// 文件资源管理器 API（v2.10.0 新增）
// 核心作用：封装项目列表 / 文件树 / 文件内容相关接口
// 端点契约：
//   - GET  /api/workspace/projects            获取项目列表
//   - POST /api/workspace/projects            创建新项目
//   - GET  /api/workspace/tree?project=xxx    获取文件树
//   - GET  /api/workspace/file?project=xxx&path=xxx  获取文件内容
// ============================================================

/**
 * 获取项目列表
 * 作用：调用 GET /api/workspace/projects 拉取所有项目
 * 调用方：ProjectSelector.tsx「打开已有项目」
 * 被调用方：GET /api/workspace/projects
 * 参数：无
 * 返回值：Promise<Project[]>，项目列表
 */
export async function fetchProjects(): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>('/workspace/projects');
  return data.projects || [];
}

/**
 * 创建新项目
 * 作用：调用 POST /api/workspace/projects 创建新项目
 * 调用方：ProjectSelector.tsx「新建项目」
 * 被调用方：POST /api/workspace/projects
 * 参数：
 *   - name: string，项目名称
 * 返回值：Promise<{ name: string }>，创建结果
 */
export async function createProject(name: string): Promise<{ name: string }> {
  return apiFetch<{ name: string }>('/workspace/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * 获取文件树
 * 作用：调用 GET /api/workspace/tree?project=xxx 拉取项目目录结构
 * 调用方：FileExplorer.tsx 文件浏览器
 * 被调用方：GET /api/workspace/tree
 * 参数：
 *   - project: string，项目名称
 * 返回值：Promise<FileTreeNode[]>，文件树节点列表
 */
export async function fetchFileTree(project: string): Promise<FileTreeNode[]> {
  const data = await apiFetch<{ tree: FileTreeNode[] }>(`/workspace/tree?project=${encodeURIComponent(project)}`);
  return data.tree || [];
}

/**
 * 获取文件内容
 * 作用：调用 GET /api/workspace/file?project=xxx&path=xxx 拉取文件内容
 * 调用方：CodeViewer.tsx 代码查看器
 * 被调用方：GET /api/workspace/file
 * 参数：
 *   - project: string，项目名称
 *   - path: string，文件路径
 * 返回值：Promise<FileContent>，文件内容
 */
export async function fetchFileContent(project: string, path: string): Promise<FileContent> {
  return apiFetch<FileContent>(`/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`);
}

/**
 * 删除文件
 * 调用 DELETE /api/workspace/file
 */
export async function deleteFile(project: string, path: string): Promise<void> {
  await apiFetch(`/workspace/file?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

/**
 * 复制文件
 * 调用 POST /api/workspace/file/copy
 */
export async function copyFile(project: string, sourcePath: string, targetPath: string): Promise<void> {
  await apiFetch(`/workspace/file/copy?project=${encodeURIComponent(project)}&path=${encodeURIComponent(sourcePath)}&target=${encodeURIComponent(targetPath)}`, { method: 'POST' });
}

/**
 * 重命名文件
 * 调用 POST /api/workspace/file/rename
 */
export async function renameFile(project: string, path: string, newName: string): Promise<void> {
  await apiFetch(`/workspace/file/rename?project=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}&new_name=${encodeURIComponent(newName)}`, { method: 'POST' });
}

// ============================================================
// Loop Engineering v7 端到端工作流 API（v8.0.0 新增）
// ============================================================

/** Loop v7 工作流步骤信息 */
export interface LoopV7Step {
  step: number;
  name: string;
  success: boolean;
  duration_s: number;
  error: string | null;
  output_keys: string[];
}

/** Loop v7 启动响应 */
export interface LoopV7StartResponse {
  workflow_id: string;
  project_name: string;
  project_type: string;
  project_root: string;
  success: boolean;
  final_status: string;
  duration_s: number;
  steps: LoopV7Step[];
  files_generated_count: number;
  git_commits: number;
  event_count: number;
  files_generated_sample: string[];
}

/** Loop v7 Hook 事件 */
export interface LoopV7HookEvent {
  task_id: string;
  module: string;
  status: string;
  message: string;
  files_count: number;
  timestamp: number;
}

/**
 * 启动 Loop v7 端到端工作流（同步）
 * 作用：调用 POST /api/workflow/loop-v7/start，等待完成后返回完整结果
 * 调用方：LoopV7Runner 组件
 * 参数：
 *   - userInput: string，用户需求文本
 *   - projectName: string，项目名
 *   - projectType: 'frontend' | 'robot' | 'fullstack'
 *   - userAnswers: 5 轮澄清答案（全部填"方案A"）
 *   - realRun: bool，是否真实运行
 *   - realPush: bool，是否真实 git push
 * 返回值：LoopV7StartResponse，包含 15 步执行结果
 */
export async function startLoopV7(params: {
  userInput: string;
  projectName: string;
  projectType: 'frontend' | 'robot' | 'fullstack';
  userAnswers: string[];
  realRun?: boolean;
  realPush?: boolean;
  qaMaxRounds?: number;
}): Promise<LoopV7StartResponse> {
  return apiFetch<LoopV7StartResponse>('/workflow/loop-v7/start', {
    method: 'POST',
    body: JSON.stringify({
      user_input: params.userInput,
      project_name: params.projectName,
      project_type: params.projectType,
      user_answers: params.userAnswers,
      real_run: params.realRun ?? true,
      real_push: params.realPush ?? true,
      qa_max_rounds: params.qaMaxRounds ?? 2,
    }),
  });
}

/** Loop v7 健康检查 */
export async function checkLoopV7Health(): Promise<{ status: string; version: string }> {
  return apiFetch<{ status: string; version: string }>('/workflow/loop-v7/health');
}

/** Loop v7 进度回调 */
export interface LoopV7ProgressCallbacks {
  onHook?: (event: LoopV7HookEvent) => void;
  onHeartbeat?: (data: { elapsed_steps: number; pending: boolean }) => void;
  onCompleted?: (response: LoopV7StartResponse) => void;
  onFailed?: (error: string) => void;
}

/**
 * 启动 Loop v7 端到端工作流（SSE 流式）
 * 作用：调用 POST /api/workflow/loop-v7/stream，实时推送每步进度
 * 返回值：AbortController 用于停止
 */
export function startLoopV7Stream(
  params: {
    userInput: string;
    projectName: string;
    projectType: 'frontend' | 'robot' | 'fullstack';
    userAnswers: string[];
    realRun?: boolean;
    realPush?: boolean;
  },
  callbacks: LoopV7ProgressCallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch('/api/workflow/loop-v7/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_input: params.userInput,
          project_name: params.projectName,
          project_type: params.projectType,
          user_answers: params.userAnswers,
          real_run: params.realRun ?? true,
          real_push: params.realPush ?? true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        callbacks.onFailed?.(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onFailed?.('无法读取响应流');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;

          // 解析 event 和 data
          const eventMatch = block.match(/^event:\s*(.+)$/m);
          const dataMatch = block.match(/^data:\s*(.+)$/m);
          if (!eventMatch || !dataMatch) continue;

          const eventName = eventMatch[1].trim();
          try {
            const data = JSON.parse(dataMatch[1]);
            switch (eventName) {
              case 'hook':
                callbacks.onHook?.(data);
                break;
              case 'heartbeat':
                callbacks.onHeartbeat?.(data);
                break;
              case 'workflow_completed':
                callbacks.onCompleted?.(data);
                break;
              case 'workflow_failed':
                callbacks.onFailed?.(data.error || '工作流失败');
                break;
            }
          } catch (e) {
            console.error('Failed to parse SSE data:', e);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      callbacks.onFailed?.(err instanceof Error ? err.message : '流式连接失败');
    }
  })();

  return controller;
}

// ============================================================
// Module E：Codex 核心特性 API（v3.0.0 新增）
// 核心作用：封装模型选择 / 推理强度 / /review / /fix 四类端点
// 端点契约：
//   - GET    /api/models                  获取模型清单
//   - POST   /api/models/select           切换激活模型
//   - GET    /api/reasoning               获取推理强度清单
//   - GET    /api/reasoning/current       获取当前强度配置
//   - POST   /api/reasoning/set           设置推理强度
//   - POST   /api/review                  代码审查
//   - POST   /api/fix                     自动修复
//   - POST   /api/review/review-fix-loop  review-fix 自迭代循环
// ============================================================

/** 模型信息（与后端 ModelInfo 对齐） */
export interface ModelInfo {
  id: string;
  name: string;
  tagline: string;
  description: string;
  selected: boolean;
}

/** 推理强度信息（与后端 IntensityInfo 对齐） */
export interface IntensityInfo {
  id: 'low' | 'medium' | 'high';
  label: string;
  description: string;
  selected: boolean;
}

/** 推理强度对应的 LLM 配置 */
export interface IntensityConfig {
  temperature: number;
  max_tokens: number;
  top_p: number;
}

/** 当前推理强度响应 */
export interface CurrentIntensityResponse {
  intensity: 'low' | 'medium' | 'high';
  config: IntensityConfig;
}

/**
 * 获取模型清单
 * 作用：调用 GET /api/models 拉取 Sol / Terra / Luna 清单
 * 调用方：ModelSelector 组件挂载
 * 返回值：ModelInfo[]
 */
export async function fetchModels(): Promise<ModelInfo[]> {
  return apiFetch<ModelInfo[]>('/models');
}

/**
 * 切换激活模型
 * 作用：调用 POST /api/models/select，返回最新清单
 * 调用方：ModelSelector 用户点击选项
 * 参数：modelId: 'sol' | 'terra' | 'luna'
 * 返回值：ModelInfo[]（含更新后的 selected 标志）
 */
export async function selectModel(modelId: string): Promise<ModelInfo[]> {
  return apiFetch<ModelInfo[]>('/models/select', {
    method: 'POST',
    body: JSON.stringify({ model_id: modelId }),
  });
}

/**
 * 获取推理强度清单
 * 作用：调用 GET /api/reasoning 拉取 low / medium / high 清单
 * 调用方：ReasoningIntensitySelector 组件挂载
 * 返回值：IntensityInfo[]
 */
export async function fetchIntensities(): Promise<IntensityInfo[]> {
  return apiFetch<IntensityInfo[]>('/reasoning');
}

/**
 * 获取当前推理强度及配置
 * 作用：调用 GET /api/reasoning/current
 * 调用方：ReasoningIntensitySelector 选择后回读
 * 返回值：CurrentIntensityResponse
 */
export async function getCurrentIntensityApi(): Promise<CurrentIntensityResponse> {
  return apiFetch<CurrentIntensityResponse>('/reasoning/current');
}

/**
 * 设置推理强度
 * 作用：调用 POST /api/reasoning/set，返回当前强度 + config
 * 调用方：ReasoningIntensitySelector 用户点击
 * 参数：intensity: 'low' | 'medium' | 'high'
 * 返回值：CurrentIntensityResponse
 */
export async function setReasoningIntensity(
  intensity: 'low' | 'medium' | 'high'
): Promise<CurrentIntensityResponse> {
  return apiFetch<CurrentIntensityResponse>('/reasoning/set', {
    method: 'POST',
    body: JSON.stringify({ intensity }),
  });
}

/** 单条审查问题 */
export interface ReviewIssue {
  id: string;
  severity: 'critical' | 'major' | 'minor';
  line: number;
  description: string;
  fix_suggestion: string;
  file?: string | null;
  rule?: string | null;
}

/** 审查响应 */
export interface ReviewResponse {
  issues: ReviewIssue[];
  summary: string;
  score: number;
  file_count: number;
  issue_count: number;
  model_id: string;
  intensity: string;
}

/** 审查请求 */
export interface ReviewRequestPayload {
  code_diff?: string;
  files?: string[];
  session_id?: string;
}

/**
 * 触发代码审查（/review 命令）
 * 作用：调用 POST /api/review
 * 调用方：App.tsx /review 命令检测
 * 参数：payload: ReviewRequestPayload
 * 返回值：ReviewResponse
 */
export async function reviewCode(payload: ReviewRequestPayload): Promise<ReviewResponse> {
  return apiFetch<ReviewResponse>('/review', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** 单个文件修复结果 */
export interface FixedFileResult {
  path: string;
  diff: string;
  applied_fixes: string[];
  skipped_issues: string[];
  new_content?: string | null;
}

/** 修复响应 */
export interface FixResponse {
  fixed_files: FixedFileResult[];
  remaining_issues: Array<Record<string, unknown>>;
  summary: string;
  model_id: string;
  intensity: string;
}

/** 修复请求 */
export interface FixRequestPayload {
  review: Record<string, unknown>;
  file_paths: string[];
  session_id?: string;
}

/**
 * 触发代码自动修复（/fix 命令）
 * 作用：调用 POST /api/fix
 * 调用方：App.tsx /fix 命令检测
 * 参数：payload: FixRequestPayload
 * 返回值：FixResponse
 */
export async function fixCode(payload: FixRequestPayload): Promise<FixResponse> {
  return apiFetch<FixResponse>('/fix', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** review-fix 循环单轮结果 */
export interface ReviewFixIteration {
  round: number;
  issues_before: number;
  issues_after: number;
  applied_fixes: string[];
  skipped_issues: string[];
  score: number;
}

/** review-fix 循环最终结果 */
export interface ReviewFixLoopResult {
  file_path: string;
  iterations: ReviewFixIteration[];
  converged: boolean;
  final_issues: ReviewIssue[];
  final_score: number;
  final_diff: string;
  summary: string;
  write_back: boolean;
}

/** review-fix 循环请求 */
export interface ReviewFixLoopPayload {
  file_path: string;
  max_iterations?: number;
  session_id?: string;
}

/**
 * 触发 review-fix 自迭代循环
 * 作用：调用 POST /api/review/review-fix-loop
 * 调用方：/review-fix-loop 命令检测
 * 参数：payload: ReviewFixLoopPayload
 * 返回值：ReviewFixLoopResult
 */
export async function runReviewFixLoop(
  payload: ReviewFixLoopPayload
): Promise<ReviewFixLoopResult> {
  return apiFetch<ReviewFixLoopResult>('/review/review-fix-loop', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

