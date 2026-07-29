# Hermes SDK

Hermes SDK 为 Hermes 智能体调度平台提供官方客户端库，
支持 Python 与 TypeScript/JavaScript 两种语言，
与 Codex SDK 的 API 表面兼容（Hermes / Thread / Run / EventStream）。

## 仓库结构

```
sdks/
├── python/              # Python SDK (hermes_sdk)
│   ├── hermes_sdk/
│   │   ├── __init__.py
│   │   ├── client.py    # Hermes 客户端
│   │   ├── thread.py    # Thread 对象
│   │   ├── run.py       # RunResult / Usage
│   │   ├── stream.py    # EventStream / StreamEvent
│   │   ├── sandbox.py   # Sandbox 枚举
│   │   ├── config.py    # HermesConfig
│   │   └── exceptions.py
│   └── ../tests/test_hermes_sdk_units.py
├── typescript/          # TypeScript SDK (@hermes/sdk)
│   ├── src/
│   │   ├── index.ts     # 入口
│   │   └── test/        # 单元测试
│   ├── examples/        # 示例代码
│   ├── package.json
│   └── tsconfig.json
└── examples/            # 跨语言示例
    └── basic.py         # Python 端到端示例
```

## 安装

### Python

```bash
# 从源码安装（开发模式）
cd sdks/python
pip install -e .

# 或者直接使用 PYTHONPATH
export PYTHONPATH=$PWD:$PYTHONPATH
```

### TypeScript

```bash
cd sdks/typescript
npm install
npm run build
```

## 快速开始

### Python

```python
from hermes_sdk import Hermes, Sandbox

with Hermes(api_key="hermes-xxx") as hermes:
    # 启动一个 Thread
    thread = hermes.thread_start(
        sandbox=Sandbox.WORKSPACE_WRITE,
        project_id="my-project",
    )

    # 同步运行
    result = thread.run("Explain this codebase in 3 bullets.")
    print(result.final_response)
    print(result.usage)

    # 流式运行
    stream = thread.run_stream("Walk me through the verification loop.")
    for event in stream:
        if event.type == "text_delta":
            print(event.text, end="", flush=True)

    # 关闭 Thread
    thread.close()
```

#### 异步 API

```python
import asyncio
from hermes_sdk import Hermes, Sandbox

async def main():
    hermes = Hermes(api_key="hermes-xxx")
    thread = hermes.thread_start(sandbox=Sandbox.READ_ONLY)
    result = await thread.arun("Async hello")
    print(result.final_response)
    await thread.aclose()

asyncio.run(main())
```

### TypeScript

```typescript
import { Hermes, Sandbox } from "@hermes/sdk";

const hermes = new Hermes({ apiKey: "hermes-xxx" });

// 启动一个 Thread
const thread = await hermes.threadStart({
  sandbox: Sandbox.WORKSPACE_WRITE,
  projectId: "my-project",
});

// 同步运行
const result = await thread.run("Explain this codebase in 3 bullets.");
console.log(result.finalResponse);
console.log(result.usage);

// 流式运行
const stream = await thread.runStream("Walk me through the verification loop.");
for (const event of stream.events) {
  if (event.type === "text_delta") {
    process.stdout.write(event.text);
  }
}

// 关闭 Thread
await thread.close();
```

## API 概览

### Hermes 客户端

| 方法 | 说明 |
| ---- | ---- |
| `thread_start(sandbox, model, project_id, working_directory, system_prompt)` | 启动新 Thread |
| `resume_thread(thread_id)` | 按 ID 恢复已存在的 Thread |
| `list_threads()` | 列出所有 Thread |
| `close()` | 关闭客户端（同步/异步上下文管理器） |

### Thread 对象

| 方法 | 说明 |
| ---- | ---- |
| `run(prompt, output_schema, metadata, timeout)` | 同步运行 |
| `run_stream(prompt, output_schema, metadata, timeout)` | 流式运行 |
| `arun(...)` | 异步运行（Python） |
| `arun_stream(...)` | 异步流式运行（Python） |
| `status()` | 获取 Thread 状态 |
| `close()` | 关闭 Thread（同步） |
| `aclose()` | 异步关闭 Thread（Python） |

### Sandbox 模式

| 值 | 描述 |
| ---- | ---- |
| `read_only` | 只读，禁止任何文件系统写入 |
| `workspace_write` | 仅允许项目工作区内写入（推荐） |
| `full_access` | 完全访问权限（仅受信任环境） |

## 错误处理

### Python

```python
from hermes_sdk import (
    Hermes,
    HermesAuthError,
    HermesNotFoundError,
    HermesRateLimitError,
    HermesServerError,
    HermesTimeoutError,
)

try:
    thread = hermes.resume_thread("invalid")
except HermesNotFoundError as e:
    print(f"Thread not found: {e.message}")
except HermesAuthError as e:
    print(f"Auth failed: {e.message}")
```

### TypeScript

```typescript
import { Hermes, HermesNotFoundError, HermesAuthError } from "@hermes/sdk";

try {
  const thread = await hermes.resumeThread("invalid");
} catch (e) {
  if (e instanceof HermesNotFoundError) {
    console.log(`Thread not found: ${e.message}`);
  } else if (e instanceof HermesAuthError) {
    console.log(`Auth failed: ${e.message}`);
  }
}
```

## 配置

### Python

| 字段 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `api_key` | `str` | `""` | API Key |
| `base_url` | `str` | `"http://localhost:8000"` | 后端地址 |
| `timeout` | `float` | `60.0` | 请求超时（秒） |
| `max_retries` | `int` | `2` | 最大重试次数 |
| `backoff_factor` | `float` | `0.5` | 退避因子 |
| `default_model` | `str` | `"claude-sonnet-4.5"` | 默认模型 |
| `default_sandbox` | `str` | `"workspace_write"` | 默认 sandbox |
| `project_id` | `str` | `""` | 默认项目 ID |
| `extra_headers` | `dict` | `{}` | 附加请求头 |

支持环境变量：
- `HERMES_API_KEY`
- `HERMES_BASE_URL`
- `HERMES_TIMEOUT`

### TypeScript

与 Python 类似，使用 `HermesConfig` 接口：

```typescript
const hermes = new Hermes({
  apiKey: "hermes-xxx",
  baseUrl: "https://api.hermes.example.com",
  timeoutMs: 60_000,
  maxRetries: 3,
  defaultModel: "claude-sonnet-4.5",
  defaultSandbox: "workspace_write",
  projectId: "my-project",
  extraHeaders: { "X-Trace": "1" },
});
```

支持环境变量 `HERMES_BASE_URL`。

## 测试

### Python 单元测试

```bash
cd /home/qizheng/auto_code_ws
PYTHONPATH=sdks/python python3 -m pytest tests/test_hermes_sdk_units.py -v
```

### TypeScript 单元测试

```bash
cd /home/qizheng/auto_code_ws/sdks/typescript
export PATH=/home/qizheng/.nvm/versions/node/v24.15.0/bin:$PATH
npx tsc -p .
node --test dist/test/*.test.js
```

### E2E 测试

需要后端服务运行在 `http://localhost:8000`：

```bash
cd /home/qizheng/auto_code_ws
bash tests/test_e2e_sdk.sh
```

## 版本历史

- **v0.1.0** (2026-07-28) Cycle 13 P0-2
  - 初始版本
  - Python SDK：55 个单元测试通过
  - TypeScript SDK：24 个单元测试通过
  - E2E 测试：46 个断言通过
  - 支持同步/异步、Run/RunStream、Sandbox 模式、结构化输出

## 相关文档

- [Codex SDK 参考](https://github.com/openai/codex)
- [Hermes 后端 API 文档](../backend/app/api/sdk.py)
