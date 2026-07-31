# Cycle 18 Spec: 项目级 AI 规则系统（G18-02）

> **任务编号**: G18-02
> **优先级**: P1
> **工作量**: 4 人天
> **负责人**: Hermes AI Agent
> **日期**: 2026-07-29

---

## 一、功能需求

### 1.1 用户场景

用户希望在特定项目中定制 AI 行为：
- 代码风格（type_safety、import_order、naming）
- 错误处理偏好（error_handling、logging）
- 框架规范（framework_best_practices）
- 测试要求（testing_coverage、test_framework）
- 安全约束（security_rules）

### 1.2 核心需求

1. **规则文件**：
   - 路径：项目根目录 `.hermesrules.yaml` 或 `.cursorrules`
   - 格式：YAML（zod schema 验证）
   - 模板：5 套预置（TS Strict / Python PEP8 / React Best / Vue Best / Generic）

2. **规则管理**：
   - 前端：RulesEditor 模态（可视化编辑）
   - 后端：CRUD + 验证 + 模板应用
   - Composer：自动加载 + 注入到 system prompt

3. **规则注入**：
   - 在 Composer 发送 prompt 时附加 rules 摘要
   - 注入格式：结构化 + 自然语言双格式

---

## 二、技术实现方案

### 2.1 HermesRules Schema

```typescript
import { z } from 'zod';

export const HermesRulesSchema = z.object({
  version: z.string().default('1.0'),
  project_type: z.enum(['typescript', 'python', 'react', 'vue', 'generic']).optional(),
  rules: z.object({
    type_safety: z.enum(['strict', 'loose', 'off']).default('strict'),
    error_handling: z.enum(['try_catch', 'result_type', 'throws']).default('try_catch'),
    framework_best_practices: z.boolean().default(true),
    import_order: z.enum(['alphabetical', 'grouped', 'none']).default('alphabetical'),
    naming_convention: z.enum(['camelCase', 'snake_case', 'PascalCase', 'mixed']).default('mixed'),
    testing: z.object({
      required: z.boolean().default(true),
      framework: z.enum(['jest', 'vitest', 'pytest', 'go_test', 'none']).default('vitest'),
      coverage_threshold: z.number().min(0).max(100).default(80),
    }).default({}),
    documentation: z.object({
      required: z.boolean().default(true),
      language: z.enum(['chinese', 'english', 'auto']).default('auto'),
    }).default({}),
    security: z.object({
      no_secrets_in_code: z.boolean().default(true),
      parameter_validation: z.boolean().default(true),
      input_sanitization: z.boolean().default(true),
    }).default({}),
  }),
  custom_rules: z.array(z.string()).default([]),
});

export type HermesRules = z.infer<typeof HermesRulesSchema>;
```

### 2.2 后端 API

```
GET /api/projects/{id}/rules
→ { rules: HermesRules, file_exists: boolean, last_modified: string }

PUT /api/projects/{id}/rules
Body: { rules: HermesRules }
→ { rules: HermesRules, file_written: boolean }

POST /api/projects/{id}/rules/validate
Body: { yaml_content: string }
→ { valid: boolean, errors: string[], rules?: HermesRules }

POST /api/projects/{id}/rules/apply-template
Body: { template: 'typescript_strict' | 'python_pep8' | 'react_best' | 'vue_best' | 'generic' }
→ { rules: HermesRules }
```

### 2.3 前端组件

```typescript
// RulesEditor.tsx - 模态对话框
export function RulesEditor({ projectId, onClose }: RulesEditorProps) {
  // 1. 加载当前 rules
  // 2. 加载模板列表
  // 3. 表单编辑
  // 4. 实时验证
  // 5. 保存
}

// RulesTemplates.tsx - 模板卡片
export function RulesTemplates({ onSelect }: RulesTemplatesProps) {
  // 5 套预置模板
}

// RulesPreview.tsx - 预览注入效果
export function RulesPreview({ rules }: RulesPreviewProps) {
  // 显示注入到 system prompt 的内容
}
```

### 2.4 Composer 集成

```typescript
// 在 useComposer 中
const { rules } = useProjectRules(projectId);

const sendPrompt = async (prompt: string) => {
  const enrichedPrompt = injectRules(prompt, rules);
  return composer.generateEdits(enrichedPrompt);
};

function injectRules(prompt: string, rules: HermesRules): string {
  const summary = generateRulesSummary(rules);
  return `[Project Rules]
${summary}

[User Prompt]
${prompt}`;
}

function generateRulesSummary(rules: HermesRules): string {
  const lines: string[] = [];
  lines.push(`- Type Safety: ${rules.rules.type_safety}`);
  lines.push(`- Error Handling: ${rules.rules.error_handling}`);
  // ... 等等
  return lines.join('\n');
}
```

---

## 三、接口设计

### 3.1 前端 API

```typescript
// useProjectRules.ts
export interface UseProjectRulesResult {
  rules: HermesRules | null;
  isLoading: boolean;
  error: string | null;
  save: (rules: HermesRules) => Promise<void>;
  applyTemplate: (templateId: string) => Promise<void>;
  validate: (yaml: string) => Promise<{ valid: boolean; errors: string[] }>;
  templates: RulesTemplate[];
}

// api.ts
export const rulesApi = {
  get: (projectId: string) => fetch(`/api/projects/${projectId}/rules`),
  put: (projectId: string, rules: HermesRules) => fetch(`/api/projects/${projectId}/rules`, { method: 'PUT', body: JSON.stringify({ rules }) }),
  validate: (projectId: string, yaml: string) => fetch(`/api/projects/${projectId}/rules/validate`, { method: 'POST', body: JSON.stringify({ yaml_content: yaml }) }),
  applyTemplate: (projectId: string, template: string) => fetch(`/api/projects/${projectId}/rules/apply-template`, { method: 'POST', body: JSON.stringify({ template }) }),
};
```

### 3.2 后端接口

```python
# backend/app/api/project_rules.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/projects/{project_id}/rules", tags=["rules"])

class RulesRequest(BaseModel):
    rules: HermesRules

class RulesResponse(BaseModel):
    rules: HermesRules
    file_exists: bool
    last_modified: str

@router.get("", response_model=RulesResponse)
async def get_rules(project_id: str):
    # 读取 .hermesrules.yaml
    pass

@router.put("", response_model=RulesResponse)
async def put_rules(project_id: str, request: RulesRequest):
    # 验证 + 写入
    pass

@router.post("/validate")
async def validate_rules(project_id: str, yaml_content: str):
    pass

@router.post("/apply-template")
async def apply_template(project_id: str, template: str):
    pass
```

---

## 四、数据结构

### 4.1 YAML 格式

```yaml
version: "1.0"
project_type: typescript

rules:
  type_safety: strict
  error_handling: try_catch
  framework_best_practices: true
  import_order: alphabetical
  naming_convention: camelCase
  
  testing:
    required: true
    framework: vitest
    coverage_threshold: 80
  
  documentation:
    required: true
    language: chinese
  
  security:
    no_secrets_in_code: true
    parameter_validation: true
    input_sanitization: true

custom_rules:
  - "始终使用绝对路径"
  - "禁止使用 any 类型"
```

### 4.2 模板示例

```typescript
// TS Strict Template
export const TS_STRICT_TEMPLATE: HermesRules = {
  version: '1.0',
  project_type: 'typescript',
  rules: {
    type_safety: 'strict',
    error_handling: 'try_catch',
    framework_best_practices: true,
    import_order: 'alphabetical',
    naming_convention: 'camelCase',
    testing: { required: true, framework: 'vitest', coverage_threshold: 90 },
    documentation: { required: true, language: 'chinese' },
    security: { no_secrets_in_code: true, parameter_validation: true, input_sanitization: true },
  },
  custom_rules: [
    '禁止使用 any 类型（使用 unknown 替代）',
    '所有函数必须有完整中文注释',
    '所有用户输入必须做合法性校验',
  ],
};
```

---

## 五、性能与安全要求

### 5.1 性能
- 规则加载 ≤ 100ms（缓存命中 ≤ 5ms）
- 规则注入 prompt 增加 ≤ 500 tokens
- 模板应用 ≤ 200ms

### 5.2 安全
- YAML 解析使用安全解析器（避免反序列化攻击）
- 规则内容不直接执行（仅作为 prompt 注入）
- 文件路径校验（防止越权访问）

### 5.3 错误处理
- 文件不存在 → 返回默认规则
- YAML 解析失败 → 返回错误 + 原始内容
- zod 验证失败 → 返回详细错误信息
- 写入失败 → 保留原文件 + 提示

---

## 六、验收标准

### 6.1 功能测试

- [ ] 后端单测 ≥ 10 个
  - GET / PUT / validate / apply-template
  - 5 个模板正确性
  - zod 验证
- [ ] 前端单测 ≥ 12 个
  - useProjectRules
  - RulesEditor 表单
  - 模板应用
  - 实时验证
- [ ] E2E 断言 ≥ 6 个
  - 完整流程：编辑 → 验证 → 保存 → 注入

### 6.2 UI 测试

- [ ] RulesEditor 模态打开/关闭正常
- [ ] 模板预览可视化
- [ ] 错误提示清晰
- [ ] 保存成功 Toast 提示

### 6.3 验收条件

- 所有测试通过率 100%
- TypeScript 编译 0 错误
- 后端 API 全部 mock 通过
- Composer 集成测试 100% 通过

---

**Spec 完成日期**: 2026-07-29
**负责人**: Hermes AI Agent
**下一步**: 实现 frontend/src/utils/hermesRules.ts + frontend/src/components/RulesEditor.tsx + backend mock API
