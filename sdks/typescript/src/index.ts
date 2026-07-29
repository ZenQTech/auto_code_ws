/**
 * Hermes TypeScript SDK
 * =====================
 *
 * TypeScript / JavaScript SDK for the Hermes Agent Scheduling
 * Platform. Mirrors the Codex SDK API surface (HermesClient /
 * Thread / Run / EventStream) so web apps and Node CLIs can drive
 * the Hermes backend in a type-safe way.
 *
 * Usage:
 *
 *     import { Hermes, Sandbox } from "@hermes/sdk";
 *
 *     const hermes = new Hermes({ apiKey: "hermes-xxx" });
 *     const thread = await hermes.threadStart({ sandbox: Sandbox.WORKSPACE_WRITE });
 *     const result = await thread.run("Explain this codebase in 3 bullets.");
 *     console.log(result.finalResponse);
 */

// ----- Types -----

export interface HermesConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffFactor?: number;
  defaultModel?: string;
  defaultSandbox?: SandboxName;
  projectId?: string;
  extraHeaders?: Record<string, string>;
}

export type SandboxName = "read_only" | "workspace_write" | "full_access";

export interface ThreadConfig {
  sandbox?: SandboxName;
  model?: string;
  projectId?: string;
  workingDirectory?: string;
  systemPrompt?: string;
}

export interface RunOptions {
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RunResult {
  threadId: string;
  runId: string;
  status: string;
  finalResponse: string;
  usage: Usage;
  collectedItems: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export interface StreamEvent {
  type: string;
  text: string;
  data: Record<string, unknown>;
  runId: string;
  threadId: string;
}

export interface StreamResult {
  events: StreamEvent[];
  final: RunResult;
}

// ----- Errors -----

export class HermesError extends Error {
  public readonly payload: Record<string, unknown>;
  constructor(message: string, payload: Record<string, unknown> = {}) {
    super(message);
    this.name = "HermesError";
    this.payload = payload;
  }
}

export class HermesApiError extends HermesError {
  public readonly statusCode?: number;
  constructor(message: string, statusCode?: number, payload: Record<string, unknown> = {}) {
    super(message, payload);
    this.name = "HermesApiError";
    this.statusCode = statusCode;
  }
}

export class HermesAuthError extends HermesApiError {
  constructor(message: string, payload: Record<string, unknown> = {}) {
    super(message, 401, payload);
    this.name = "HermesAuthError";
  }
}

export class HermesNotFoundError extends HermesApiError {
  constructor(message: string, payload: Record<string, unknown> = {}) {
    super(message, 404, payload);
    this.name = "HermesNotFoundError";
  }
}

export class HermesTimeoutError extends HermesError {
  constructor(message: string, payload: Record<string, unknown> = {}) {
    super(message, payload);
    this.name = "HermesTimeoutError";
  }
}

// ----- Sandbox enum-like -----

export const Sandbox: Record<string, SandboxName> = Object.freeze({
  READ_ONLY: "read_only",
  WORKSPACE_WRITE: "workspace_write",
  FULL_ACCESS: "full_access",
});

// ----- Internal HTTP -----

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

class HttpClient {
  constructor(private readonly config: Required<HermesConfig>) {}

  buildUrl(path: string, params?: Record<string, string | number | undefined>): string {
    const base = this.config.baseUrl.replace(/\/$/, "");
    const normalised = path.startsWith("/") ? path : `/${path}`;
    let url = `${base}${normalised}`;
    if (params) {
      const filtered: string[][] = [];
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        filtered.push([encodeURIComponent(key), encodeURIComponent(String(value))]);
      }
      if (filtered.length > 0) {
        url = `${url}?${filtered.map(([k, v]) => `${k}=${v}`).join("&")}`;
      }
    }
    return url;
  }

  async request<T = Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, timeoutMs } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.config.timeoutMs);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "hermes-sdk-typescript/0.1.0",
      ...this.config.extraHeaders,
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(this.buildUrl(path), init);
        clearTimeout(timer);
        const text = await response.text();
        const data = text ? safeJsonParse(text) : {};
        if (!response.ok) {
          const err = mapHttpError(response.status, data, response.statusText);
          if (attempt < this.config.maxRetries && isRetryable(err)) {
            lastError = err;
            await sleep(this.config.backoffFactor * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
        return data as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof HermesApiError) {
          throw err;
        }
        if ((err as { name?: string }).name === "AbortError") {
          throw new HermesTimeoutError("Request timed out");
        }
        lastError = err;
        if (attempt < this.config.maxRetries) {
          await sleep(this.config.backoffFactor * Math.pow(2, attempt));
          continue;
        }
        throw new HermesError(
          `Network error: ${(err as Error).message ?? String(err)}`
        );
      }
    }
    throw lastError instanceof Error ? lastError : new HermesError("Unknown error");
  }
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { data: value };
  } catch {
    return { raw: text };
  }
}

function mapHttpError(statusCode: number, payload: Record<string, unknown>, fallback: string): HermesApiError {
  const message = String(payload.detail ?? payload.message ?? fallback);
  if (statusCode === 401 || statusCode === 403) return new HermesAuthError(message, payload);
  if (statusCode === 404) return new HermesNotFoundError(message, payload);
  return new HermesApiError(message, statusCode, payload);
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof HermesApiError)) return false;
  if (err.statusCode === undefined) return false;
  return err.statusCode === 429 || err.statusCode >= 500;
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// ----- Thread -----

export class Thread {
  public readonly id: string;
  public readonly config: Required<ThreadConfig>;

  constructor(private readonly client: HermesClient, threadId: string, threadConfig: Required<ThreadConfig>) {
    this.id = threadId;
    this.config = threadConfig;
  }

  async run(prompt: string, options: RunOptions = {}): Promise<RunResult> {
    const data = await this.client.http.request(`/api/sdk/threads/${this.id}/runs`, {
      method: "POST",
      body: {
        prompt,
        output_schema: options.outputSchema,
        metadata: options.metadata,
      },
      timeoutMs: options.timeoutMs,
    });
    return parseRunResult(data);
  }

  async runStream(prompt: string, options: RunOptions = {}): Promise<StreamResult> {
    const data = await this.client.http.request(`/api/sdk/threads/${this.id}/runs/stream`, {
      method: "POST",
      body: {
        prompt,
        output_schema: options.outputSchema,
        metadata: options.metadata,
        stream: true,
      },
      timeoutMs: options.timeoutMs,
    });
    return parseStreamResult(data);
  }

  async status(): Promise<Record<string, unknown>> {
    return this.client.http.request(`/api/sdk/threads/${this.id}`);
  }

  async close(): Promise<Record<string, unknown>> {
    return this.client.http.request(`/api/sdk/threads/${this.id}`, { method: "DELETE" });
  }
}

function parseRunResult(data: Record<string, unknown>): RunResult {
  const usage = (data.usage as Record<string, number>) ?? {};
  return {
    threadId: String(data.thread_id ?? ""),
    runId: String(data.run_id ?? ""),
    status: String(data.status ?? "completed"),
    finalResponse: String(data.final_response ?? data.text ?? ""),
    usage: {
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
    },
    collectedItems: Array.isArray(data.collected_items)
      ? (data.collected_items as Array<Record<string, unknown>>)
      : [],
    metadata: (data.metadata as Record<string, unknown>) ?? {},
  };
}

function parseStreamResult(data: Record<string, unknown>): StreamResult {
  const eventsRaw = Array.isArray(data.events) ? (data.events as Array<Record<string, unknown>>) : [];
  const events: StreamEvent[] = eventsRaw.map((raw) => ({
    type: String(raw.type ?? "message"),
    text: String(raw.text ?? raw.delta ?? ""),
    data: raw,
    runId: String(raw.run_id ?? ""),
    threadId: String(raw.thread_id ?? ""),
  }));
  const finalData = (data.final as Record<string, unknown>) ?? {};
  return {
    events,
    final: parseRunResult(finalData),
  };
}

// ----- HermesClient -----

export class HermesClient {
  public readonly http: HttpClient;
  public readonly config: Required<HermesConfig>;

  constructor(input: HermesConfig = {}) {
    const baseUrl = input.baseUrl ?? defaultBaseUrl();
    const config: Required<HermesConfig> = {
      apiKey: input.apiKey ?? "",
      baseUrl,
      timeoutMs: input.timeoutMs ?? 60_000,
      maxRetries: input.maxRetries ?? 2,
      backoffFactor: input.backoffFactor ?? 0.5,
      defaultModel: input.defaultModel ?? "claude-sonnet-4.5",
      defaultSandbox: input.defaultSandbox ?? "workspace_write",
      projectId: input.projectId ?? "",
      extraHeaders: input.extraHeaders ?? {},
    };
    this.config = config;
    this.http = new HttpClient(config);
  }

  async threadStart(threadConfig: ThreadConfig = {}): Promise<Thread> {
    const sandbox = threadConfig.sandbox ?? this.config.defaultSandbox;
    const model = threadConfig.model ?? this.config.defaultModel;
    const payload = {
      sandbox,
      model,
      project_id: threadConfig.projectId ?? this.config.projectId,
      working_directory: threadConfig.workingDirectory ?? "",
      system_prompt: threadConfig.systemPrompt ?? "",
    };
    const data = await this.http.request("/api/sdk/threads", { method: "POST", body: payload });
    const threadId = String(data.thread_id ?? data.id ?? "");
    if (!threadId) {
      throw new HermesApiError("Backend returned a thread without an id", undefined, data);
    }
    const finalConfig: Required<ThreadConfig> = {
      sandbox,
      model,
      projectId: payload.project_id,
      workingDirectory: payload.working_directory,
      systemPrompt: payload.system_prompt,
    };
    return new Thread(this, threadId, finalConfig);
  }

  async resumeThread(threadId: string): Promise<Thread> {
    const data = await this.http.request(`/api/sdk/threads/${threadId}`);
    const finalConfig: Required<ThreadConfig> = {
      sandbox: (data.sandbox as SandboxName | undefined) ?? this.config.defaultSandbox,
      model: (data.model as string | undefined) ?? this.config.defaultModel,
      projectId: (data.project_id as string | undefined) ?? "",
      workingDirectory: (data.working_directory as string | undefined) ?? "",
      systemPrompt: (data.system_prompt as string | undefined) ?? "",
    };
    return new Thread(this, String(data.thread_id ?? threadId), finalConfig);
  }

  async listThreads(): Promise<Record<string, unknown>> {
    return this.http.request("/api/sdk/threads");
  }

  async health(): Promise<Record<string, unknown>> {
    return this.http.request("/api/sdk/health");
  }
}

function defaultBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.HERMES_BASE_URL) {
    return process.env.HERMES_BASE_URL;
  }
  return "http://localhost:8000";
}

export const Hermes = HermesClient;
export default HermesClient;

// Exposed for testing / advanced usage
export { parseRunResult, parseStreamResult, HttpClient, mapHttpError, isRetryable, safeJsonParse, defaultBaseUrl };
