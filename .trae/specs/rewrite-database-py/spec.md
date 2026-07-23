# 重写 database.py 消除 basedpyright 误报

## Why
`database.py` 模块文档字符串内使用 `#` 前缀，导致 basedpyright 类型检查器将其误解析为 Python 代码，产生 4 个缩进/语法错误误报。需重写为规范格式以消除诊断。

## What Changes
- 将模块头注释从 `"""...#..."""` 格式改为标准 `#` 行注释格式
- 保留所有现有功能和迁移逻辑不变

## Impact
- Affected specs: 无
- Affected code: `backend/app/database.py`

## MODIFIED Requirements
### Requirement: 模块头注释格式
模块 SHALL 使用标准 `#` 行注释（而非 `"""..."""` 内嵌 `#`）作为文件头注释，确保 basedpyright 不产生误报。

#### Scenario: 文件头注释格式正确
- **WHEN** basedpyright 检查 `database.py`
- **THEN** 不再出现"缩进有误"/"缩进退回有误"/"此处应有表达式"/"语句必须用换行符或分号分隔"误报
