"""
# ============================================================
# 企业级 Plugin Hub - 90+ 插件目录
# ============================================================
# 核心作用：定义企业级 Plugin 目录的预置数据集（≥ 90 个插件）
# 按 12 个分类组织：AI/ML、DevOps、Code Quality、Testing、Security、
#               Monitoring、Database、Documentation、Communication、
#               Version Control、Project Management、Productivity
# 运行流程：
#   1. 模块加载时自动生成插件元数据（id、版本、分类、定价、标签等）
#   2. EnterpriseHubManager 启动时从本模块拉取预置目录
#   3. 支持按分类/来源/标签/企业级/SOC2 多维过滤
#   4. 插件 SHA-256 签名自动计算
# 修改记录：
#   - 2026-07-28 | v6.28.0 | Cycle 14 P0-3 初始版本：90+ 插件预置目录
# ============================================================
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Optional

from .models import PluginCatalogItem, PricingModel


# ============================================================
# 分类定义
# ============================================================

CATEGORIES: List[Dict[str, str]] = [
    {"id": "ai-ml", "name": "AI/ML", "icon": "brain", "description": "人工智能、机器学习、代码生成与代码审查"},
    {"id": "devops", "name": "DevOps/CI-CD", "icon": "rocket", "description": "持续集成、持续部署、构建流水线"},
    {"id": "code-quality", "name": "Code Quality", "icon": "check", "description": "代码质量分析、格式化、Lint"},
    {"id": "testing", "name": "Testing", "icon": "beaker", "description": "单元测试、集成测试、端到端测试"},
    {"id": "security", "name": "Security", "icon": "shield", "description": "代码安全、依赖扫描、漏洞检测"},
    {"id": "monitoring", "name": "Monitoring", "icon": "activity", "description": "应用监控、日志聚合、性能分析"},
    {"id": "database", "name": "Database", "icon": "database", "description": "数据库管理、迁移、查询优化"},
    {"id": "documentation", "name": "Documentation", "icon": "book", "description": "API 文档、技术文档、Wiki"},
    {"id": "communication", "name": "Communication", "icon": "message", "description": "团队协作、消息通知、聊天集成"},
    {"id": "version-control", "name": "Version Control", "icon": "git", "description": "版本控制、分支管理、Code Review"},
    {"id": "project-management", "name": "Project Management", "icon": "kanban", "description": "任务管理、看板、敏捷协作"},
    {"id": "productivity", "name": "Productivity", "icon": "zap", "description": "效率工具、笔记、时间管理"},
]


# ============================================================
# 插件元数据定义
# ============================================================

def _make_plugin(
    name: str,
    category: str,
    vendor: str,
    description: str,
    *,
    version: str = "1.0.0",
    source: str = "community",
    license: str = "MIT",
    pricing_model: str = PricingModel.FREE.value,
    price_usd: float = 0.0,
    enterprise_ready: bool = False,
    soc2_compliant: bool = False,
    data_residency: Optional[List[str]] = None,
    permissions_required: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
    verified: bool = True,
) -> PluginCatalogItem:
    """构造一个 PluginCatalogItem 实例（自动生成 plugin_id 与 signature）

    Args:
        name: 插件名
        category: 分类 ID
        vendor: 供应商
        description: 简短描述
        version: 版本号
        source: 来源（official/community/local）
        license: 许可证
        pricing_model: 定价模式
        price_usd: 价格
        enterprise_ready: 是否企业级就绪
        soc2_compliant: 是否 SOC2 合规
        data_residency: 数据驻留地
        permissions_required: 所需权限
        tags: 标签
        verified: 是否已验证

    Returns:
        PluginCatalogItem: 插件目录项
    """
    if data_residency is None:
        data_residency = ["global"]
    if permissions_required is None:
        permissions_required = ["read"]
    if tags is None:
        tags = []

    plugin_id = f"plugin_{category}_{name.lower().replace(' ', '-').replace('/', '-')}"
    # 计算签名（基于 name+version+vendor 的 SHA-256）
    sig_src = f"{name}|{version}|{vendor}".encode("utf-8")
    signature = "sha256:" + hashlib.sha256(sig_src).hexdigest()

    return PluginCatalogItem(
        plugin_id=plugin_id,
        name=name,
        version=version,
        source=source,
        category=category,
        vendor=vendor,
        license=license,
        description=description,
        long_description=description + " 集成到 Hermes 平台，提供企业级能力。",
        icon_url=f"https://cdn.hermes.dev/icons/{plugin_id}.svg",
        screenshots=[],
        tags=tags,
        pricing_model=pricing_model,
        price_usd=price_usd,
        enterprise_ready=enterprise_ready,
        soc2_compliant=soc2_compliant,
        data_residency=data_residency,
        permissions_required=permissions_required,
        downloads=0,
        rating=0.0,
        rating_count=0,
        install_commands=0,
        last_updated="2026-07-28T00:00:00Z",
        verified=verified,
        signature=signature,
    )


# ============================================================
# 90+ 插件目录（按 12 分类）
# ============================================================

PLUGINS_DATA: List[PluginCatalogItem] = [
    # ----- 1. AI/ML (25+) -----
    _make_plugin("Code Generator", "ai-ml", "Hermes Labs", "AI 驱动的代码生成器，支持多语言多框架", source="official", enterprise_ready=True, soc2_compliant=True, tags=["code-gen", "ai", "llm"], verified=True),
    _make_plugin("Code Reviewer Pro", "ai-ml", "Hermes Labs", "智能代码审查，自动识别 bug、漏洞与代码异味", source="official", pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=29.0, enterprise_ready=True, soc2_compliant=True, tags=["review", "ai", "quality"]),
    _make_plugin("Test Generator", "ai-ml", "Hermes Labs", "基于 LLM 自动生成单元测试与集成测试", source="official", pricing_model=PricingModel.USAGE_BASED.value, price_usd=0.01, tags=["testing", "ai", "generation"]),
    _make_plugin("Doc Writer AI", "ai-ml", "DocuMind", "AI 文档生成器，从代码自动产出 API 文档", pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=19.0, tags=["docs", "ai"]),
    _make_plugin("Refactor Bot", "ai-ml", "Hermes Labs", "AI 辅助代码重构，识别重复代码并提出改进", tags=["refactor", "ai"]),
    _make_plugin("Bug Predictor", "ai-ml", "PredictiveAI", "基于历史 commit 与代码特征预测潜在 bug", pricing_model=PricingModel.PAID.value, price_usd=49.0, enterprise_ready=True, tags=["prediction", "ai"]),
    _make_plugin("Code Translator", "ai-ml", "Polyglot Inc", "代码语言转换器（Python ↔ Go ↔ Rust）", tags=["translate", "polyglot"]),
    _make_plugin("Inline Chat", "ai-ml", "Hermes Labs", "编辑器内联 AI 助手，支持多轮对话", source="official", enterprise_ready=True, soc2_compliant=True, tags=["chat", "inline"]),
    _make_plugin("Smart Snippet", "ai-ml", "CodeBrain", "基于上下文的智能代码片段推荐", tags=["snippet", "ai"]),
    _make_plugin("Vibe Composer", "ai-ml", "Hermes Labs", "Vibe Coding 模式 - 自然语言生成完整应用", source="official", enterprise_ready=True, tags=["vibe", "composer", "ai"]),
    _make_plugin("Loop Workflow Engine", "ai-ml", "Hermes Labs", "循环工程工作流编排器", source="official", enterprise_ready=True, soc2_compliant=True, tags=["loop", "workflow", "orchestration"]),
    _make_plugin("Multi-Agent Orchestrator", "ai-ml", "Hermes Labs", "多 Agent 协同编排，Direct/Reviewed 双合约模式", source="official", enterprise_ready=True, soc2_compliant=True, tags=["multi-agent", "orchestration"]),
    _make_plugin("LLM-as-Judge", "ai-ml", "Hermes Labs", "基于 LLM 的语义正确性验证层（5维度评分）", source="official", enterprise_ready=True, tags=["judge", "verification"]),
    _make_plugin("Prompt Optimizer", "ai-ml", "Hermes Labs", "自动优化 LLM 提示词，提升模型输出质量", tags=["prompt", "optimize"]),
    _make_plugin("Embeddings Cache", "ai-ml", "Hermes Labs", "Embedding 缓存层，降低 LLM 成本", source="official", tags=["cache", "embedding"]),
    _make_plugin("Token Counter", "ai-ml", "Hermes Labs", "实时 token 用量统计与成本预估", source="official", tags=["token", "cost"]),
    _make_plugin("Model Router", "ai-ml", "Hermes Labs", "智能模型路由，根据任务难度选择最优模型", source="official", enterprise_ready=True, tags=["router", "model"]),
    _make_plugin("Self-Directing Agent", "ai-ml", "Hermes Labs", "自进化智能体 - Proactive Memory + 主动建议", source="official", tags=["agent", "proactive"]),
    _make_plugin("Vision Engine", "ai-ml", "Hermes Labs", "图像理解引擎（OCR/对象检测/UI元素）", source="official", tags=["vision", "ocr"]),
    _make_plugin("Audio Engine", "ai-ml", "Hermes Labs", "音频转写与情感分析引擎", source="official", tags=["audio", "transcribe"]),
    _make_plugin("Streaming Recovery", "ai-ml", "Hermes Labs", "流式响应恢复网关，断线重连不丢消息", source="official", enterprise_ready=True, tags=["stream", "recovery"]),
    _make_plugin("Context Compactor", "ai-ml", "Hermes Labs", "上下文自动压缩，节省 token 成本", source="official", tags=["compaction", "context"]),
    _make_plugin("Reasoning Visualizer", "ai-ml", "Hermes Labs", "大模型思考过程实时可视化", source="official", tags=["reasoning", "visualize"]),
    _make_plugin("Plan Editor", "ai-ml", "Hermes Labs", "AI 任务计划编辑器，支持人工修正", source="official", tags=["plan", "editor"]),
    _make_plugin("Verification Loop", "ai-ml", "Hermes Labs", "自动验证循环（语法/独立/端到端三维）", source="official", enterprise_ready=True, tags=["verification", "loop"]),

    # ----- 2. DevOps/CI-CD (15+) -----
    _make_plugin("GitHub Actions", "devops", "GitHub", "GitHub Actions 集成，PR/Issue 自动化", source="official", enterprise_ready=True, soc2_compliant=True, tags=["ci", "github"]),
    _make_plugin("GitLab CI", "devops", "GitLab", "GitLab CI/CD 集成", enterprise_ready=True, tags=["ci", "gitlab"]),
    _make_plugin("Jenkins", "devops", "Jenkins", "Jenkins 流水线集成", tags=["ci", "jenkins"]),
    _make_plugin("CircleCI", "devops", "CircleCI", "CircleCI 工作流集成", tags=["ci", "circleci"]),
    _make_plugin("Buildkite", "devops", "Buildkite", "Buildkite CI/CD 集成", enterprise_ready=True, tags=["ci", "buildkite"]),
    _make_plugin("Argo CD", "devops", "Argo", "GitOps 持续部署工具", enterprise_ready=True, tags=["gitops", "cd"]),
    _make_plugin("Spinnaker", "devops", "Netflix", "Netflix 多云持续交付平台", enterprise_ready=True, tags=["cd", "multi-cloud"]),
    _make_plugin("Docker Buildx", "devops", "Docker Inc", "多架构 Docker 镜像构建", tags=["docker", "build"]),
    _make_plugin("Kaniko", "devops", "Google", "容器内构建镜像工具", enterprise_ready=True, tags=["container", "build"]),
    _make_plugin("Helm Linter", "devops", "Helm", "Helm Chart 静态检查", tags=["helm", "k8s"]),
    _make_plugin("Kustomize", "devops", "Kubernetes", "Kustomize 模板管理", tags=["k8s", "template"]),
    _make_plugin("Terraform Validator", "devops", "HashiCorp", "Terraform Plan 安全校验", enterprise_ready=True, soc2_compliant=True, tags=["iac", "terraform"]),
    _make_plugin("Pulumi Scanner", "devops", "Pulumi", "Pulumi IaC 集成", tags=["iac", "pulumi"]),
    _make_plugin("Ansible Playbook", "devops", "Red Hat", "Ansible 自动化执行", enterprise_ready=True, tags=["ansible", "config"]),
    _make_plugin("Packer Build", "devops", "HashiCorp", "镜像构建工具集成", tags=["packer", "image"]),

    # ----- 3. Code Quality (10+) -----
    _make_plugin("SonarQube", "code-quality", "SonarSource", "代码质量平台，识别 bug、漏洞、异味", enterprise_ready=True, soc2_compliant=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=150.0, tags=["quality", "scan"]),
    _make_plugin("ESLint", "code-quality", "OpenJS", "JavaScript/TypeScript Lint 工具", tags=["lint", "javascript"]),
    _make_plugin("Pylint", "code-quality", "Pylint", "Python 代码静态分析", tags=["lint", "python"]),
    _make_plugin("Prettier", "code-quality", "Prettier", "代码自动格式化工具", tags=["format", "javascript"]),
    _make_plugin("Black", "code-quality", "Python", "Python 严格代码格式化", tags=["format", "python"]),
    _make_plugin("RuboCop", "code-quality", "RuboCop", "Ruby 静态分析与格式化", tags=["lint", "ruby"]),
    _make_plugin("GolangCI-Lint", "code-quality", "Go Community", "Go 多 Linter 聚合", tags=["lint", "go"]),
    _make_plugin("Clippy", "code-quality", "Rust", "Rust 官方 Lint 工具", tags=["lint", "rust"]),
    _make_plugin("Checkstyle", "code-quality", "Checkstyle", "Java 代码风格检查", tags=["lint", "java"]),
    _make_plugin("Detekt", "code-quality", "Detekt", "Kotlin 静态分析", tags=["lint", "kotlin"]),
    _make_plugin("CodeClimate", "code-quality", "CodeClimate", "可维护性评分与技术债追踪", pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=49.0, enterprise_ready=True, tags=["quality", "metric"]),
    _make_plugin("CodeScene", "code-quality", "CodeScene", "代码健康度可视化", enterprise_ready=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=99.0, tags=["health", "viz"]),

    # ----- 4. Testing (10+) -----
    _make_plugin("Jest Runner", "testing", "Meta", "Jest 单元测试执行器", tags=["unit", "javascript"]),
    _make_plugin("Pytest", "testing", "pytest-dev", "Python 测试框架", tags=["unit", "python"]),
    _make_plugin("Selenium Grid", "testing", "Selenium", "Selenium 浏览器自动化", enterprise_ready=True, tags=["e2e", "browser"]),
    _make_plugin("Cypress", "testing", "Cypress.io", "现代 Web E2E 测试", enterprise_ready=True, tags=["e2e", "web"]),
    _make_plugin("Playwright", "testing", "Microsoft", "跨浏览器 E2E 测试", enterprise_ready=True, tags=["e2e", "browser"]),
    _make_plugin("JUnit", "testing", "JUnit", "Java 单元测试框架", tags=["unit", "java"]),
    _make_plugin("Go Test", "testing", "Go", "Go 内置测试支持", tags=["unit", "go"]),
    _make_plugin("Cargo Test", "testing", "Rust", "Rust 内置测试支持", tags=["unit", "rust"]),
    _make_plugin("K6 Load", "testing", "Grafana", "K6 负载测试工具", enterprise_ready=True, tags=["perf", "load"]),
    _make_plugin("Locust", "testing", "Locust", "Python 分布式负载测试", tags=["perf", "load"]),
    _make_plugin("Postman", "testing", "Postman", "API 测试与 Mock", enterprise_ready=True, tags=["api", "test"]),
    _make_plugin("Coverage.py", "testing", "Ned Batchelder", "Python 覆盖率统计", tags=["coverage", "python"]),

    # ----- 5. Security (10+) -----
    _make_plugin("Snyk", "security", "Snyk", "依赖与容器漏洞扫描", enterprise_ready=True, soc2_compliant=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=99.0, tags=["vuln", "sca"]),
    _make_plugin("OWASP ZAP", "security", "OWASP", "Web 应用安全扫描", tags=["dast", "web"]),
    _make_plugin("Trivy", "security", "Aqua Security", "全栈漏洞扫描器", enterprise_ready=True, tags=["vuln", "scan"]),
    _make_plugin("Bandit", "security", "PyCQA", "Python 安全 Lint", tags=["lint", "security"]),
    _make_plugin("Semgrep", "security", "Semgrep", "代码语义安全搜索", enterprise_ready=True, tags=["sast", "search"]),
    _make_plugin("Dependabot", "security", "GitHub", "自动依赖更新 PR", tags=["deps", "update"]),
    _make_plugin("Trivy IaC", "security", "Aqua Security", "Terraform/K8s 配置扫描", enterprise_ready=True, soc2_compliant=True, tags=["iac", "scan"]),
    _make_plugin("GitGuardian", "security", "GitGuardian", "Secrets 检测与告警", enterprise_ready=True, soc2_compliant=True, tags=["secrets", "detect"]),
    _make_plugin("Vault Scanner", "security", "HashiCorp", "HashiCorp Vault 集成", enterprise_ready=True, soc2_compliant=True, tags=["secrets", "vault"]),
    _make_plugin("OAuth 2.1 PKCE", "security", "Hermes Labs", "OAuth 2.1 + PKCE 安全认证", source="official", enterprise_ready=True, soc2_compliant=True, tags=["oauth", "auth"]),
    _make_plugin("SBOM Generator", "security", "Hermes Labs", "自动生成 CycloneDX/SPDX SBOM", source="official", enterprise_ready=True, tags=["sbom", "compliance"]),
    _make_plugin("Pen Test Report", "security", "Pentest Co", "渗透测试报告模板", pricing_model=PricingModel.PAID.value, price_usd=199.0, tags=["pentest", "report"]),

    # ----- 6. Monitoring (8+) -----
    _make_plugin("Prometheus", "monitoring", "Prometheus", "Prometheus 指标采集", enterprise_ready=True, tags=["metrics", "tsdb"]),
    _make_plugin("Grafana", "monitoring", "Grafana", "Grafana 仪表盘", enterprise_ready=True, tags=["viz", "dashboard"]),
    _make_plugin("Datadog APM", "monitoring", "Datadog", "应用性能监控", enterprise_ready=True, soc2_compliant=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=99.0, tags=["apm", "tracing"]),
    _make_plugin("New Relic", "monitoring", "New Relic", "全栈可观测性", enterprise_ready=True, soc2_compliant=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=149.0, tags=["apm", "tracing"]),
    _make_plugin("Sentry", "monitoring", "Sentry", "错误追踪与监控", enterprise_ready=True, soc2_compliant=True, tags=["error", "tracking"]),
    _make_plugin("Loki", "monitoring", "Grafana", "Loki 日志聚合", enterprise_ready=True, tags=["log", "aggregation"]),
    _make_plugin("Tempo", "monitoring", "Grafana", "分布式追踪后端", enterprise_ready=True, tags=["tracing", "otel"]),
    _make_plugin("OpenTelemetry", "monitoring", "CNCF", "OTel 统一观测", enterprise_ready=True, soc2_compliant=True, tags=["otel", "standard"]),

    # ----- 7. Database (5+) -----
    _make_plugin("Postgres Tools", "database", "PostgreSQL", "Postgres 客户端与管理", enterprise_ready=True, tags=["sql", "postgres"]),
    _make_plugin("Redis CLI", "database", "Redis", "Redis 命令行与监控", tags=["nosql", "redis"]),
    _make_plugin("MongoDB Compass", "database", "MongoDB", "MongoDB GUI 与查询", enterprise_ready=True, tags=["nosql", "mongo"]),
    _make_plugin("Flyway", "database", "Redgate", "数据库迁移工具", enterprise_ready=True, tags=["migration", "sql"]),
    _make_plugin("Liquibase", "database", "Liquibase", "数据库变更管理", enterprise_ready=True, soc2_compliant=True, tags=["migration", "sql"]),
    _make_plugin("Prisma Migrate", "database", "Prisma", "Prisma 数据库迁移", tags=["orm", "migration"]),

    # ----- 8. Documentation (5+) -----
    _make_plugin("Swagger", "documentation", "SmartBear", "OpenAPI 文档生成", enterprise_ready=True, tags=["api", "openapi"]),
    _make_plugin("JSDoc", "documentation", "JSDoc", "JavaScript API 文档", tags=["api", "js"]),
    _make_plugin("Sphinx", "documentation", "Sphinx", "Python 文档生成器", tags=["docs", "python"]),
    _make_plugin("Docusaurus", "documentation", "Meta", "Docusaurus 静态站点", tags=["docs", "site"]),
    _make_plugin("Mintlify", "documentation", "Mintlify", "现代 API 文档平台", enterprise_ready=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=49.0, tags=["api", "modern"]),
    _make_plugin("ReadTheDocs", "documentation", "RTD", "Read the Docs 托管", tags=["docs", "hosting"]),

    # ----- 9. Communication (3+) -----
    _make_plugin("Slack Notifier", "communication", "Slack", "Slack 消息推送", enterprise_ready=True, soc2_compliant=True, tags=["chat", "alert"]),
    _make_plugin("MS Teams", "communication", "Microsoft", "Microsoft Teams 集成", enterprise_ready=True, soc2_compliant=True, tags=["chat", "teams"]),
    _make_plugin("Discord Webhook", "communication", "Discord", "Discord Webhook 通知", tags=["chat", "discord"]),
    _make_plugin("Email SMTP", "communication", "Hermes Labs", "SMTP 邮件通知", tags=["email", "smtp"]),
    _make_plugin("PagerDuty", "communication", "PagerDuty", "On-call 告警", enterprise_ready=True, soc2_compliant=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=21.0, tags=["oncall", "pager"]),

    # ----- 10. Version Control (5+) -----
    _make_plugin("Git", "version-control", "Git", "Git 核心命令封装", tags=["git", "core"]),
    _make_plugin("GitHub", "version-control", "GitHub", "GitHub API 集成", enterprise_ready=True, soc2_compliant=True, tags=["github", "api"]),
    _make_plugin("GitLab", "version-control", "GitLab", "GitLab API 集成", enterprise_ready=True, soc2_compliant=True, tags=["gitlab", "api"]),
    _make_plugin("Bitbucket", "version-control", "Atlassian", "Bitbucket API 集成", enterprise_ready=True, tags=["bitbucket", "api"]),
    _make_plugin("Gitea", "version-control", "Gitea", "Gitea 自托管 Git 集成", tags=["gitea", "self-host"]),
    _make_plugin("Gerrit", "version-control", "Gerrit", "Gerrit Code Review", enterprise_ready=True, tags=["review", "gerrit"]),

    # ----- 11. Project Management (3+) -----
    _make_plugin("Jira", "project-management", "Atlassian", "Jira Issue 同步", enterprise_ready=True, soc2_compliant=True, pricing_model=PricingModel.SUBSCRIPTION.value, price_usd=14.0, tags=["issue", "jira"]),
    _make_plugin("Trello", "project-management", "Atlassian", "Trello 看板集成", tags=["kanban", "trello"]),
    _make_plugin("Asana", "project-management", "Asana", "Asana 任务管理", enterprise_ready=True, tags=["task", "asana"]),
    _make_plugin("Linear", "project-management", "Linear", "Linear Issue 跟踪", enterprise_ready=True, tags=["issue", "linear"]),
    _make_plugin("Notion", "project-management", "Notion", "Notion 文档与数据库集成", enterprise_ready=True, tags=["docs", "notion"]),

    # ----- 12. Productivity (5+) -----
    _make_plugin("Calendar Sync", "productivity", "Google", "Google Calendar 同步", tags=["calendar", "google"]),
    _make_plugin("Todo Manager", "productivity", "Hermes Labs", "任务清单管理", source="official", tags=["todo"]),
    _make_plugin("Notes Engine", "productivity", "Hermes Labs", "Markdown 笔记引擎", source="official", tags=["notes", "markdown"]),
    _make_plugin("Time Tracker", "productivity", "Hermes Labs", "番茄钟与时间追踪", source="official", tags=["time", "pomodoro"]),
    _make_plugin("Workflow Triggers", "productivity", "Hermes Labs", "自动化触发器（定时/事件）", source="official", enterprise_ready=True, tags=["trigger", "automation"]),
    _make_plugin("Background Worker", "productivity", "Hermes Labs", "后台异步任务执行", source="official", tags=["background", "worker"]),
]


# ============================================================
# 目录查询 API
# ============================================================

def get_default_catalog() -> List[PluginCatalogItem]:
    """获取预置目录的拷贝

    Returns:
        List[PluginCatalogItem]: 全部插件列表
    """
    return list(PLUGINS_DATA)


def get_categories() -> List[Dict[str, str]]:
    """获取分类定义列表

    Returns:
        List[Dict[str, str]]: 分类列表
    """
    return [dict(c) for c in CATEGORIES]


def get_featured_plugins(limit: int = 10) -> List[PluginCatalogItem]:
    """获取推荐插件（按 enterprise_ready + 评分排序）

    Args:
        limit: 返回数量上限

    Returns:
        List[PluginCatalogItem]: 推荐插件列表
    """
    candidates = [p for p in PLUGINS_DATA if p.enterprise_ready]
    # 用 rating_count 排序
    candidates.sort(key=lambda p: (p.rating_count, p.downloads), reverse=True)
    return candidates[:limit]


def filter_by_category(category: str) -> List[PluginCatalogItem]:
    """按分类过滤

    Args:
        category: 分类 ID

    Returns:
        List[PluginCatalogItem]: 该分类的插件列表
    """
    return [p for p in PLUGINS_DATA if p.category == category]


def filter_by_source(source: str) -> List[PluginCatalogItem]:
    """按来源过滤

    Args:
        source: official / community / local

    Returns:
        List[PluginCatalogItem]: 该来源的插件列表
    """
    return [p for p in PLUGINS_DATA if p.source == source]


def count_by_category() -> Dict[str, int]:
    """按分类统计数量

    Returns:
        Dict[str, int]: {category: count}
    """
    result: Dict[str, int] = {}
    for p in PLUGINS_DATA:
        result[p.category] = result.get(p.category, 0) + 1
    return result


def catalog_summary() -> Dict[str, Any]:
    """目录摘要信息

    Returns:
        Dict[str, Any]: 摘要统计
    """
    return {
        "total": len(PLUGINS_DATA),
        "categories": len(CATEGORIES),
        "by_category": count_by_category(),
        "by_source": {
            "official": sum(1 for p in PLUGINS_DATA if p.source == "official"),
            "community": sum(1 for p in PLUGINS_DATA if p.source == "community"),
            "local": sum(1 for p in PLUGINS_DATA if p.source == "local"),
        },
        "enterprise_ready_count": sum(1 for p in PLUGINS_DATA if p.enterprise_ready),
        "soc2_compliant_count": sum(1 for p in PLUGINS_DATA if p.soc2_compliant),
    }


def search_plugins(
    query: str = "",
    category: Optional[str] = None,
    source: Optional[str] = None,
    enterprise_only: bool = False,
    soc2_only: bool = False,
    free_only: bool = False,
) -> List[PluginCatalogItem]:
    """多条件搜索

    Args:
        query: 关键字（匹配 name/description/tags）
        category: 分类
        source: 来源
        enterprise_only: 仅企业级
        soc2_only: 仅 SOC2 合规
        free_only: 仅免费

    Returns:
        List[PluginCatalogItem]: 命中的插件列表
    """
    results = list(PLUGINS_DATA)
    if query:
        q = query.lower()
        results = [
            p for p in results
            if q in p.name.lower()
            or q in p.description.lower()
            or any(q in t.lower() for t in p.tags)
            or q in p.vendor.lower()
        ]
    if category:
        results = [p for p in results if p.category == category]
    if source:
        results = [p for p in results if p.source == source]
    if enterprise_only:
        results = [p for p in results if p.enterprise_ready]
    if soc2_only:
        results = [p for p in results if p.soc2_compliant]
    if free_only:
        results = [p for p in results if p.pricing_model == PricingModel.FREE.value]
    return results


def get_plugin_by_id(plugin_id: str) -> Optional[PluginCatalogItem]:
    """按 ID 获取插件

    Args:
        plugin_id: 插件 ID

    Returns:
        Optional[PluginCatalogItem]: 插件项（未找到为 None）
    """
    for p in PLUGINS_DATA:
        if p.plugin_id == plugin_id:
            return p
    return None
