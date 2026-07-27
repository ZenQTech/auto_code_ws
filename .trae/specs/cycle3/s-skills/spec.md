# T7: SKILL.md 导入/导出 - 规格说明

## 1. 功能需求描述

### 1.1 功能目标
实现 SKILL.md 文件格式的导入/导出，兼容 Vercel skills 生态系统。

### 1.2 用户场景
- 用户下载了第三方 SKILL.md 文件，希望导入到本平台
- 用户在本平台创建了 Skills，希望导出分享
- 用户希望批量管理多个 Skills

### 1.3 使用流程
1. 用户打开 Skills 面板
2. 拖拽 SKILL.md 文件到上传区，或点击"上传文件"按钮
3. 后端解析 YAML 头 + Markdown 体，验证字段
4. 解析成功则创建 Skill，失败则显示错误
5. 批量导入：选择 zip 包 → 批量解析 → 全部创建
6. 导出：选择 Skill → 下载为 SKILL.md

## 2. 技术实现方案

### 2.1 技术选型
- **YAML 解析**: `pyyaml`
- **Markdown 解析**: 内置 `markdown` 库
- **Schema 验证**: `pydantic` v2
- **压缩**: `zipfile`（批量）

### 2.2 SKILL.md 格式标准

```yaml
---
name: my-skill                    # 必需
description: When to invoke       # 必需
argument-hint: "[file-path]"      # 可选
allowed-tools: Bash, Read, Write  # 可选
model: claude-sonnet-4.5          # 可选
user-invocable: true              # 可选，默认 true
disable-model-invocation: false   # 可选，默认 false
context: fork                     # 可选
agent: general-purpose            # 可选
version: 1.0.0                    # 可选
tags: [pdf, ocr]                  # 可选
---

# My Skill Instructions

Markdown body with detailed instructions
```

### 2.3 核心算法
- **解析**: 正则提取 `^---` 包裹的 YAML 头 + 剩余 Markdown 体
- **验证**: Pydantic model 验证必需字段、字段类型、枚举值
- **冲突处理**: 同名 Skill 提示用户覆盖/重命名/跳过

## 3. 接口设计规范

### 3.1 数据模型

```python
class SkillFrontmatter(BaseModel):
    name: str
    description: str
    argument_hint: Optional[str] = None
    allowed_tools: List[str] = []
    model: Optional[str] = None
    user_invocable: bool = True
    disable_model_invocation: bool = False
    context: Optional[str] = None
    agent: Optional[str] = None
    version: Optional[str] = None
    tags: List[str] = []
```

### 3.2 REST API 端点

```http
# 导入单个 SKILL.md
POST /api/skills/import
Content-Type: multipart/form-data
Body: file=@skill.md
Response: { "success": true, "skill_id": "uuid", "warnings": [] }

# 批量导入 zip 包
POST /api/skills/import-zip
Content-Type: multipart/form-data
Body: file=@skills.zip
Response: { "success": true, "imported": 5, "failed": 0, "errors": [] }

# 导出单个 skill
GET /api/skills/{id}/export
Response: SKILL.md 文件下载

# 批量导出 zip
GET /api/skills/export-zip?ids=id1,id2,id3
Response: skills.zip 文件下载

# 预览 SKILL.md 内容
POST /api/skills/preview
Body: { "content": "---\nname: ..." }
Response: { "valid": true, "frontmatter": {...}, "body": "..." }
```

## 4. 数据结构定义

### 4.1 SKILL.md 文件结构

```
skill-name/
├── SKILL.md           # 主文件（必需）
├── scripts/           # 可选：辅助脚本
├── references/        # 可选：参考文档
└── assets/            # 可选：资源文件
```

### 4.2 数据库变更
- 在 `skills` 表新增字段:
  - `source_format` TEXT DEFAULT 'native'  -- 'native' | 'skill_md'
  - `imported_at` TIMESTAMP
  - `original_path` TEXT

## 5. 性能与安全要求

### 5.1 性能指标
- 单个 SKILL.md 解析 ≤ 100ms
- 10 个 skills 批量导入 ≤ 3s
- 100 个 skills 批量导出 zip ≤ 5s

### 5.2 安全要求
- YAML 安全加载（避免代码执行）
- Markdown 注入过滤
- 文件大小限制：单个 SKILL.md ≤ 1MB

## 6. 验收标准

### 6.1 功能验收
- 4 个 REST API 端点正常
- SKILL.md 格式兼容性 100%（Vercel 标准）
- 字段验证准确率 100%

### 6.2 测试用例
- **正常场景**: 导入/导出/批量操作
- **异常场景**: 格式错误、字段缺失、YAML 注入
- **边界场景**: 空文件、超大文件、Unicode 字符

### 6.3 通过条件
- 自动化测试通过率 100%
- 浏览器 E2E 测试通过
- 与 Vercel skills 生态格式兼容
