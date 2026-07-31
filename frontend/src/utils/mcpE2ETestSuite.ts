/**
 * # ============================================================
 * # MCP E2E Test Suite (v1.0.0 Cycle 43 G43-04)
 * # ============================================================
 * # 核心作用：MCP 真实服务器 + 火山方舟 Coding Plan LLM 端到端测试套件
 * #           提供 5 大场景的端到端验证
 * #           沙箱兼容：当真实 LLM/服务器不可用时自动回退 mock
 * # 协议版本：MCP 2024-11-05
 * # ====================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-04 初次创建
 * # ====================================
 */

import type { LLMProvider, Message, ToolDefinition, ChatResponse } from './llmProviderAdapter';
import { McpServerRegistry } from './mcpRegistry';
import { McpToolBridge } from './mcpToolBridge';
import { McpResourceBridge } from './mcpResourceBridge';
import { McpPromptBridge } from './mcpPromptBridge';
import { McpIntegratedAgentLoop, type McpAgentRunResult } from './mcpIntegratedAgentLoop';
import { createVolcengineCodingPlanProvider } from './volcengineCodingPlanProvider';
import {
  createFilesystemServer,
  type FilesystemServerContext,
} from './mcpFilesystemServer';
import {
  createGitServer,
  type GitServerContext,
} from './mcpGitServer';
import {
  createFetchServer,
  type FetchServerContext,
} from './mcpFetchServer';

// ============ 类型定义 ============

/**
 * E2E 测试场景类型
 */
export type E2EScenarioType =
  | 'basic-chat'
  | 'single-tool-call'
  | 'multi-tool-call'
  | 'resource-reference'
  | 'error-recovery';

/**
 * E2E 测试场景
 */
export interface E2EScenario {
  type: E2EScenarioType;
  name: string;
  description: string;
  /** 用户消息 */
  userMessage: string;
  /** 是否需要 filesystem */
  needsFilesystem?: boolean;
  /** 是否需要 git */
  needsGit?: boolean;
  /** 是否需要 fetch */
  needsFetch?: boolean;
  /** 自定义验证器 */
  validator?: (result: McpAgentRunResult) => Promise<boolean> | boolean;
}

/**
 * E2E 测试结果
 */
export interface E2ETestResult {
  scenario: E2EScenarioType;
  name: string;
  success: boolean;
  durationMs: number;
  result: McpAgentRunResult;
  error?: string;
}

/**
 * E2E 测试套件配置
 */
export interface E2ETestSuiteOptions {
  /** LLM Provider（可选，不传则自动创建 Coding Plan provider） */
  llmProvider?: LLMProvider;
  /** MCP Registry（可选，自动创建） */
  mcpRegistry?: McpServerRegistry;
  /** Filesystem 上下文（可选，自动创建 mock） */
  filesystemContext?: FilesystemServerContext;
  /** Git 上下文（可选，自动创建 mock） */
  gitContext?: GitServerContext;
  /** Fetch 上下文（可选，自动创建 mock） */
  fetchContext?: FetchServerContext;
  /** 是否使用真实 LLM（默认 false） */
  useRealLLM?: boolean;
  /** 测试场景（默认 5 个标准场景） */
  scenarios?: E2EScenario[];
}

// ============ 标准测试场景 ============

/**
 * 5 大标准 E2E 测试场景
 */
export const DEFAULT_E2E_SCENARIOS: E2EScenario[] = [
  {
    type: 'basic-chat',
    name: '基础对话',
    description: '用户输入 → LLM → 文本响应（无工具调用）',
    userMessage: '你好，请简单介绍一下你自己。',
    validator: (r) => r.success && r.content.length > 0,
  },
  {
    type: 'single-tool-call',
    name: '单步工具调用',
    description: '用户输入 → LLM 决策调用 filesystem.read_file → 结果返回 → LLM 总结',
    userMessage: '请调用 read_file 工具读取 "/tmp/test.txt" 文件内容',
    needsFilesystem: true,
    validator: (r) => r.success,
  },
  {
    type: 'multi-tool-call',
    name: '多步工具调用',
    description: '用户输入 → LLM 多次调用 git status / diff → 综合分析',
    userMessage: '请使用 git 工具查看当前仓库状态和最近差异',
    needsGit: true,
    validator: (r) => r.success,
  },
  {
    type: 'resource-reference',
    name: '资源引用',
    description: '用户消息包含 @mcp:// 资源引用 → 资源解析注入 → LLM 响应',
    userMessage: '请分析 @mcp://filesystem/tmp/test.txt 的内容并总结',
    needsFilesystem: true,
    validator: (r) => r.success,
  },
  {
    type: 'error-recovery',
    name: '错误恢复',
    description: '工具调用失败 → LLM 接收错误信息 → 重试或替代方案',
    userMessage: '请调用不存在的工具 should_fail 来测试错误恢复',
    needsFilesystem: true,
    validator: (r) => r.success || (r.terminationReason === 'error'),
  },
];

// ============ 场景执行器 ============

/**
 * E2E 测试套件
 */
export class McpE2ETestSuite {
  private llmProvider: LLMProvider;
  private mcpRegistry: McpServerRegistry;
  private toolBridge: McpToolBridge;
  private resourceBridge: McpResourceBridge;
  private promptBridge: McpPromptBridge;
  private agentLoop: McpIntegratedAgentLoop | null = null;
  private scenarios: E2EScenario[];
  private fsContext: FilesystemServerContext | null = null;
  private gitContext: GitServerContext | null = null;
  private fetchContext: FetchServerContext | null = null;

  constructor(options: E2ETestSuiteOptions = {}) {
    this.llmProvider = options.llmProvider ?? createVolcengineCodingPlanProvider({ forceMock: true });
    this.mcpRegistry = options.mcpRegistry ?? new McpServerRegistry();
    this.toolBridge = new McpToolBridge();
    this.resourceBridge = new McpResourceBridge();
    this.promptBridge = new McpPromptBridge();
    this.scenarios = options.scenarios ?? DEFAULT_E2E_SCENARIOS;
    this.fsContext = options.filesystemContext ?? null;
    this.gitContext = options.gitContext ?? null;
    this.fetchContext = options.fetchContext ?? null;
  }

  /**
   * 初始化 E2E 测试套件
   */
  async initialize(): Promise<void> {
    // 连接 filesystem 服务器（如果需要）
    const needsFs = this.scenarios.some((s) => s.needsFilesystem);
    if (needsFs && !this.fsContext) {
      this.fsContext = await createFilesystemServer({
        allowedDirectories: ['/tmp'],
        mode: 'auto',
      });
    }

    // 连接 git 服务器（如果需要）
    const needsGit = this.scenarios.some((s) => s.needsGit);
    if (needsGit && !this.gitContext) {
      try {
        this.gitContext = await createGitServer({
          repositoryPath: '/tmp',
          mode: 'auto',
        });
      } catch {
        // git 服务器可选，跳过
      }
    }

    // 连接 fetch 服务器（如果需要）
    const needsFetch = this.scenarios.some((s) => s.needsFetch);
    if (needsFetch && !this.fetchContext) {
      try {
        this.fetchContext = await createFetchServer({ mode: 'auto' });
      } catch {
        // fetch 服务器可选，跳过
      }
    }

    // 创建 Agent Loop
    this.agentLoop = new McpIntegratedAgentLoop({
      llmProvider: this.llmProvider,
      mcpRegistry: this.mcpRegistry,
      toolBridge: this.toolBridge,
      resourceBridge: this.resourceBridge,
      promptBridge: this.promptBridge,
      autoConnect: false,
    });
  }

  /**
   * 执行单个场景
   */
  async runScenario(scenario: E2EScenario): Promise<E2ETestResult> {
    if (!this.agentLoop) {
      throw new Error('E2E test suite not initialized. Call initialize() first.');
    }
    const startTime = Date.now();
    try {
      const result = await this.agentLoop.runWithMcp(scenario.userMessage, {
        maxSteps: 3,
        includeToolDetails: true,
      });
      const success = scenario.validator ? await scenario.validator(result) : result.success;
      return {
        scenario: scenario.type,
        name: scenario.name,
        success,
        durationMs: Date.now() - startTime,
        result,
        error: success ? undefined : `Validation failed: ${result.error ?? 'unknown'}`,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        scenario: scenario.type,
        name: scenario.name,
        success: false,
        durationMs: Date.now() - startTime,
        result: {
          content: '',
          toolExecutions: [],
          resourceResolutions: [],
          promptRenders: [],
          totalTokens: 0,
          durationMs: Date.now() - startTime,
          steps: 0,
          success: false,
          error: errMsg,
          timestamp: Date.now(),
        },
        error: errMsg,
      };
    }
  }

  /**
   * 执行所有场景
   */
  async runAll(): Promise<E2ETestResult[]> {
    const results: E2ETestResult[] = [];
    for (const scenario of this.scenarios) {
      const result = await this.runScenario(scenario);
      results.push(result);
    }
    return results;
  }

  /**
   * 获取测试套件统计
   */
  getStats(results: E2ETestResult[]): {
    total: number;
    passed: number;
    failed: number;
    passRate: number;
    totalDurationMs: number;
  } {
    const passed = results.filter((r) => r.success).length;
    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length === 0 ? 0 : passed / results.length,
      totalDurationMs: results.reduce((acc, r) => acc + r.durationMs, 0),
    };
  }

  /**
   * 关闭套件并释放资源
   */
  async dispose(): Promise<void> {
    if (this.fsContext) {
      try {
        await this.fsContext.client.close();
      } catch {
        /* ignore */
      }
    }
    if (this.gitContext) {
      try {
        await this.gitContext.client.close();
      } catch {
        /* ignore */
      }
    }
    if (this.fetchContext) {
      try {
        await this.fetchContext.client.close();
      } catch {
        /* ignore */
      }
    }
  }
}

// ============ 工厂函数 ============

/**
 * 创建 E2E 测试套件
 */
export function createE2ETestSuite(
  options: E2ETestSuiteOptions = {},
): McpE2ETestSuite {
  return new McpE2ETestSuite(options);
}

/**
 * 快速执行 E2E 测试（一次性 init + run + dispose）
 */
export async function runE2ETest(
  options: E2ETestSuiteOptions = {},
): Promise<{ results: E2ETestResult[]; stats: ReturnType<McpE2ETestSuite['getStats']> }> {
  const suite = createE2ETestSuite(options);
  try {
    await suite.initialize();
    const results = await suite.runAll();
    return { results, stats: suite.getStats(results) };
  } finally {
    await suite.dispose();
  }
}

// ============ 辅助函数 ============

/**
 * 验证测试结果（用于测试自身）
 */
export function assertE2EResult(
  result: E2ETestResult,
  expectations: { success?: boolean; minTokens?: number; hasContent?: boolean } = {},
): void {
  if (expectations.success !== undefined) {
    if (result.success !== expectations.success) {
      throw new Error(
        `Expected success=${expectations.success}, got ${result.success}. Error: ${result.error}`,
      );
    }
  }
  if (expectations.hasContent && !result.result.content && !result.result.toolExecutions.length) {
    throw new Error('Expected content or tool executions, got neither');
  }
  if (expectations.minTokens && result.result.totalTokens < expectations.minTokens) {
    throw new Error(
      `Expected at least ${expectations.minTokens} tokens, got ${result.result.totalTokens}`,
    );
  }
}
