"""
# ============================================================
# Hermes LLM-as-Judge - Prompt 模板
# ============================================================
# 核心作用：定义 5 维度 Judge Prompt 模板（Handlebars 风格变量替换）
# 特性：
#   - 可配置评分维度
#   - 多领域支持
#   - 标准 JSON 输出格式
# Cycle 13 P0-3 新建
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from .models import (
    ALL_DIMENSIONS,
    DEFAULT_RUBRIC,
    DIMENSION_CORRECTNESS,
    DIMENSION_MAINTAINABILITY,
    DIMENSION_PERFORMANCE,
    DIMENSION_SAFETY,
    DIMENSION_STYLE,
    Difficulty,
    Domain,
)


# ============================================================
# 默认 Prompt 模板
# ============================================================
DEFAULT_JUDGE_PROMPT = """You are an expert code reviewer evaluating the following code change.

## Task
{task_description}

## Code Diff
```
{code_diff}
```

## Test Results
{test_results}

## Evaluation Criteria
1. Correctness (0-10): Does the code correctly implement the task?
2. Style (0-10): Does the code follow project style guidelines?
3. Safety (0-10): Are there any safety issues (injection, overflow, etc.)?
4. Performance (0-10): Is the code performant (no obvious O(n^3) etc.)?
5. Maintainability (0-10): Is the code readable and maintainable?

## Output Format
Return a JSON object:
```json
OUTPUT_JSON_TEMPLATE
```

## Important
- Be strict but fair
- Consider edge cases
- Check for security vulnerabilities
- Verify the code matches the task description
"""


# JSON 模板（独立字符串，避免被 .format() 干扰）
OUTPUT_JSON_TEMPLATE = """{
  "scores": {
    "correctness": <int 0-10>,
    "style": <int 0-10>,
    "safety": <int 0-10>,
    "performance": <int 0-10>,
    "maintainability": <int 0-10>
  },
  "overall_pass": <bool>,
  "issues": ["<issue1>", "<issue2>"],
  "suggestions": ["<suggestion1>", "<suggestion2>"]
}"""


# ============================================================
# 不同领域的 Prompt 增强
# ============================================================
DOMAIN_PROMPTS: Dict[str, str] = {
    Domain.GENERAL.value: "",
    Domain.BACKEND.value: """
## Backend Specific
- Check API design consistency
- Verify error handling and edge cases
- Check database query safety (parameterized queries)
- Verify authentication and authorization
""",
    Domain.FRONTEND.value: """
## Frontend Specific
- Check accessibility (a11y)
- Verify responsive design
- Check for XSS vulnerabilities
- Verify state management correctness
""",
    Domain.DATABASE.value: """
## Database Specific
- Check for SQL injection vulnerabilities
- Verify indexing strategy
- Check transaction boundaries
- Verify data integrity constraints
""",
    Domain.SECURITY.value: """
## Security Specific
- Check for injection vulnerabilities (SQL, XSS, command)
- Verify authentication and authorization
- Check for sensitive data leakage
- Verify input validation
- Check for CSRF and CORS issues
""",
    Domain.PERFORMANCE.value: """
## Performance Specific
- Check for O(n^2) or worse algorithms
- Verify caching strategy
- Check for unnecessary I/O operations
- Verify memory usage patterns
""",
    Domain.TESTING.value: """
## Testing Specific
- Check test coverage
- Verify test isolation
- Check for flaky tests
- Verify edge case coverage
""",
    Domain.DOCS.value: """
## Documentation Specific
- Check completeness
- Verify examples are correct
- Check for typos and grammar
- Verify formatting consistency
""",
}


# ============================================================
# 难度调整
# ============================================================
DIFFICULTY_INSTRUCTIONS: Dict[str, str] = {
    Difficulty.EASY.value: "Be lenient - this is a simple change.",
    Difficulty.MEDIUM.value: "Apply standard evaluation criteria.",
    Difficulty.HARD.value: "Be strict - this is a complex change requiring careful review.",
}


# ============================================================
# 工具函数
# ============================================================
def render_template(template: str, variables: Dict[str, Any]) -> str:
    """
    简单的 Handlebars 风格变量替换
    支持 {{var}} 语法
    """
    def replace(match):
        key = match.group(1).strip()
        return str(variables.get(key, match.group(0)))
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", replace, template)


def build_prompt(
    task_description: str,
    code_diff: str = "",
    test_results: str = "",
    rubric: List[str] = None,
    domain: str = Domain.GENERAL.value,
    difficulty: str = Difficulty.MEDIUM.value,
) -> str:
    """
    构建 Judge Prompt
    参数：
      - task_description: 任务描述
      - code_diff: 代码差异
      - test_results: 测试结果
      - rubric: 自定义评分维度
      - domain: 领域
      - difficulty: 难度
    """
    rubric = rubric or DEFAULT_RUBRIC
    # 基础变量
    variables = {
        "task_description": task_description or "(no description)",
        "code_diff": code_diff or "(no diff)",
        "test_results": test_results or "(no test results)",
    }
    # 渲染基础模板：先做 Handlebars 风格替换（兼容性），再做 .format() 替换
    rendered = render_template(DEFAULT_JUDGE_PROMPT, variables)
    try:
        prompt = rendered.format(**variables)
    except (KeyError, IndexError):
        prompt = rendered
    # 将占位符 OUTPUT_JSON_TEMPLATE 替换为 JSON 示例
    prompt = prompt.replace("OUTPUT_JSON_TEMPLATE", OUTPUT_JSON_TEMPLATE)
    # 添加领域增强
    domain_extra = DOMAIN_PROMPTS.get(domain, "")
    if domain_extra:
        prompt = prompt + "\n" + domain_extra
    # 添加难度调整
    difficulty_note = DIFFICULTY_INSTRUCTIONS.get(difficulty, "")
    if difficulty_note:
        prompt = prompt + f"\n## Difficulty\n{difficulty_note}\n"
    # 添加自定义 rubric
    if rubric and rubric != DEFAULT_RUBRIC:
        prompt = prompt + "\n## Custom Rubric\n"
        for i, item in enumerate(rubric, 1):
            prompt = prompt + f"{i}. {item}\n"
    return prompt


def extract_json_from_response(response: str) -> Dict[str, Any]:
    """
    从 LLM 响应中提取 JSON
    支持 markdown ```json ... ``` 包裹
    """
    if not response:
        return {}
    # 尝试查找 ```json ... ``` 块
    json_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", response, re.DOTALL)
    if json_block:
        json_str = json_block.group(1)
    else:
        # 尝试查找最外层 {}
        first_brace = response.find("{")
        last_brace = response.rfind("}")
        if first_brace == -1 or last_brace == -1 or first_brace >= last_brace:
            return {}
        json_str = response[first_brace:last_brace + 1]
    # 解析
    import json
    try:
        return json.loads(json_str)
    except (json.JSONDecodeError, ValueError):
        return {}


def default_rubric() -> List[str]:
    """返回默认 rubric"""
    return list(DEFAULT_RUBRIC)


def validate_rubric(rubric: List[str]) -> bool:
    """校验 rubric 格式"""
    if not rubric or not isinstance(rubric, list):
        return False
    for item in rubric:
        if not isinstance(item, str) or len(item.strip()) == 0:
            return False
    return True
