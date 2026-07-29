"""
# Orchestrate Pipeline 模板
# ============================================================
# 核心作用：预定义 Pipeline 模板（code_review/research/writing/devops）
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 模板包含：
#   - 阶段定义（哪些 Stage）
#   - 阶段依赖关系
#   - 默认输入参数
#   - 模板元数据
# ============================================================
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .contracts import (
    ContractBuilder,
    build_text_field,
    build_int_field,
    build_bool_field,
    build_list_field,
    build_dict_field,
    invariant_non_null,
    invariant_non_empty,
    invariant_range,
)
from .models import (
    Pipeline,
    RetryPolicy,
    SLASpec,
    StageContract,
    StageRef,
)


@dataclass
class PipelineTemplate:
    """Pipeline 模板"""
    template_id: str
    name: str
    description: str
    category: str
    stage_refs: List[StageRef]
    stage_contracts: List[StageContract]
    default_inputs: Dict[str, Any] = field(default_factory=dict)
    version: str = "1.0.0"
    tags: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "template_id": self.template_id,
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "stage_refs": [s.to_dict() for s in self.stage_refs],
            "stage_contracts": [c.to_dict() for c in self.stage_contracts],
            "default_inputs": self.default_inputs,
            "version": self.version,
            "tags": self.tags,
        }


# ============================================================
# 模板构造函数
# ============================================================

def _build_code_review_template() -> PipelineTemplate:
    """代码审查模板：lint → security/perf (并行) → style → summary"""
    lint = (ContractBuilder("lint", "Lint code")
        .stage_id("lint")
        .input("repo", build_text_field("repo", min_length=1))
        .input("path", build_text_field("path", default="."))
        .output("lint_report", build_text_field("lint_report"))
        .postcondition(invariant_non_empty("lint_report"))
        .sla(SLASpec(p99_latency_ms=10000))
        .retry_policy(RetryPolicy(max_attempts=3))
        .capability("linter")
        .tag("review")
        .build())

    security = (ContractBuilder("security", "Security scan")
        .stage_id("security")
        .input("repo", build_text_field("repo"))
        .output("security_report", build_dict_field("security_report"))
        .postcondition(invariant_non_null("security_report"))
        .sla(SLASpec(p99_latency_ms=30000))
        .retry_policy(RetryPolicy(max_attempts=2))
        .capability("security_scanner")
        .tag("review")
        .tag("security")
        .build())

    perf = (ContractBuilder("perf", "Performance analysis")
        .stage_id("perf")
        .input("repo", build_text_field("repo"))
        .output("perf_report", build_dict_field("perf_report"))
        .postcondition(invariant_non_null("perf_report"))
        .sla(SLASpec(p99_latency_ms=20000))
        .capability("perf_analyzer")
        .tag("review")
        .tag("performance")
        .build())

    style = (ContractBuilder("style", "Style check")
        .stage_id("style")
        .input("repo", build_text_field("repo"))
        .input("security_report", build_dict_field("security_report", required=False))
        .input("perf_report", build_dict_field("perf_report", required=False))
        .output("style_report", build_text_field("style_report"))
        .postcondition(invariant_non_empty("style_report"))
        .sla(SLASpec(p99_latency_ms=15000))
        .capability("style_checker")
        .tag("review")
        .tag("style")
        .build())

    summary = (ContractBuilder("summary", "Generate summary")
        .stage_id("summary")
        .input("lint_report", build_text_field("lint_report"))
        .input("security_report", build_dict_field("security_report"))
        .input("perf_report", build_dict_field("perf_report"))
        .input("style_report", build_text_field("style_report"))
        .output("summary", build_text_field("summary"))
        .postcondition(invariant_non_empty("summary"))
        .sla(SLASpec(p99_latency_ms=10000))
        .capability("summarizer")
        .tag("review")
        .tag("summary")
        .build())

    return PipelineTemplate(
        template_id="tpl_code_review",
        name="Code Review",
        description="4 阶段代码审查：lint → security/perf → style → summary",
        category="development",
        stage_refs=[
            StageRef(stage_id="lint"),
            StageRef(stage_id="security", depends_on=["lint"], parallel_group="parallel_analysis"),
            StageRef(stage_id="perf", depends_on=["lint"], parallel_group="parallel_analysis"),
            StageRef(stage_id="style", depends_on=["security", "perf"]),
            StageRef(stage_id="summary", depends_on=["style"]),
        ],
        stage_contracts=[lint, security, perf, style, summary],
        default_inputs={"repo": ""},
        tags=["code_review", "static_analysis", "security"],
    )


def _build_research_template() -> PipelineTemplate:
    """研究模板：question → search/analysis (并行) → synthesis"""
    question = (ContractBuilder("question", "Process question")
        .input("query", build_text_field("query", min_length=1))
        .output("parsed_query", build_text_field("parsed_query"))
        .postcondition(invariant_non_empty("parsed_query"))
        .capability("nlp")
        .build())

    search = (ContractBuilder("search", "Web search")
        .input("parsed_query", build_text_field("parsed_query"))
        .output("search_results", build_list_field("search_results", item_type="string"))
        .postcondition(invariant_non_empty("search_results"))
        .sla(SLASpec(p99_latency_ms=15000))
        .capability("web_search")
        .build())

    analysis = (ContractBuilder("analysis", "Deep analysis")
        .input("parsed_query", build_text_field("parsed_query"))
        .output("analysis_report", build_text_field("analysis_report"))
        .postcondition(invariant_non_empty("analysis_report"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("reasoning")
        .build())

    synthesis = (ContractBuilder("synthesis", "Synthesize findings")
        .input("search_results", build_list_field("search_results"))
        .input("analysis_report", build_text_field("analysis_report"))
        .output("final_report", build_text_field("final_report"))
        .postcondition(invariant_non_empty("final_report"))
        .sla(SLASpec(p99_latency_ms=20000))
        .capability("writing")
        .build())

    return PipelineTemplate(
        template_id="tpl_research",
        name="Research",
        description="4 阶段研究：问题理解 → 搜索/分析 → 综合报告",
        category="research",
        stage_refs=[
            StageRef(stage_id="question"),
            StageRef(stage_id="search", depends_on=["question"], parallel_group="parallel"),
            StageRef(stage_id="analysis", depends_on=["question"], parallel_group="parallel"),
            StageRef(stage_id="synthesis", depends_on=["search", "analysis"]),
        ],
        stage_contracts=[question, search, analysis, synthesis],
        default_inputs={"query": ""},
        tags=["research", "analysis"],
    )


def _build_writing_template() -> PipelineTemplate:
    """写作模板：outline → draft (并行多段落) → review → polish"""
    outline = (ContractBuilder("outline", "Generate outline")
        .input("topic", build_text_field("topic", min_length=1))
        .input("audience", build_text_field("audience", default="general"))
        .output("outline_text", build_text_field("outline_text"))
        .postcondition(invariant_non_empty("outline_text"))
        .capability("writing")
        .build())

    intro = (ContractBuilder("intro", "Write introduction")
        .input("outline_text", build_text_field("outline_text"))
        .output("intro", build_text_field("intro"))
        .postcondition(invariant_non_empty("intro"))
        .capability("writing")
        .build())

    body = (ContractBuilder("body", "Write body")
        .input("outline_text", build_text_field("outline_text"))
        .output("body", build_text_field("body"))
        .postcondition(invariant_non_empty("body"))
        .capability("writing")
        .build())

    conclusion = (ContractBuilder("conclusion", "Write conclusion")
        .input("outline_text", build_text_field("outline_text"))
        .output("conclusion", build_text_field("conclusion"))
        .postcondition(invariant_non_empty("conclusion"))
        .capability("writing")
        .build())

    review = (ContractBuilder("review", "Review article")
        .input("intro", build_text_field("intro"))
        .input("body", build_text_field("body"))
        .input("conclusion", build_text_field("conclusion"))
        .output("review_notes", build_list_field("review_notes", item_type="string"))
        .postcondition(invariant_non_empty("review_notes"))
        .capability("review")
        .build())

    polish = (ContractBuilder("polish", "Polish final")
        .input("intro", build_text_field("intro"))
        .input("body", build_text_field("body"))
        .input("conclusion", build_text_field("conclusion"))
        .input("review_notes", build_list_field("review_notes"))
        .output("final_article", build_text_field("final_article"))
        .postcondition(invariant_non_empty("final_article"))
        .capability("editing")
        .build())

    return PipelineTemplate(
        template_id="tpl_writing",
        name="Article Writing",
        description="6 阶段写作：outline → intro/body/conclusion (并行) → review → polish",
        category="writing",
        stage_refs=[
            StageRef(stage_id="outline"),
            StageRef(stage_id="intro", depends_on=["outline"], parallel_group="parallel"),
            StageRef(stage_id="body", depends_on=["outline"], parallel_group="parallel"),
            StageRef(stage_id="conclusion", depends_on=["outline"], parallel_group="parallel"),
            StageRef(stage_id="review", depends_on=["intro", "body", "conclusion"]),
            StageRef(stage_id="polish", depends_on=["review"]),
        ],
        stage_contracts=[outline, intro, body, conclusion, review, polish],
        default_inputs={"topic": "", "audience": "general"},
        tags=["writing", "content"],
    )


def _build_devops_template() -> PipelineTemplate:
    """DevOps 模板：test → build → deploy (并行 healthcheck/smoketest) → notify"""
    test = (ContractBuilder("test", "Run tests")
        .input("repo", build_text_field("repo"))
        .output("test_results", build_dict_field("test_results"))
        .postcondition(invariant_non_null("test_results"))
        .sla(SLASpec(p99_latency_ms=60000))
        .capability("test_runner")
        .build())

    build = (ContractBuilder("build", "Build artifact")
        .input("repo", build_text_field("repo"))
        .output("artifact", build_text_field("artifact"))
        .postcondition(invariant_non_empty("artifact"))
        .sla(SLASpec(p99_latency_ms=120000))
        .capability("builder")
        .build())

    healthcheck = (ContractBuilder("healthcheck", "Health check")
        .input("deploy_url", build_text_field("deploy_url"))
        .output("health_status", build_bool_field("health_status"))
        .postcondition(invariant_non_null("health_status"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("monitoring")
        .build())

    smoketest = (ContractBuilder("smoketest", "Smoke test")
        .input("deploy_url", build_text_field("deploy_url"))
        .output("smoke_result", build_dict_field("smoke_result"))
        .postcondition(invariant_non_null("smoke_result"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("testing")
        .build())

    notify = (ContractBuilder("notify", "Notify stakeholders")
        .input("health_status", build_bool_field("health_status"))
        .input("smoke_result", build_dict_field("smoke_result"))
        .output("notification_log", build_list_field("notification_log", item_type="string"))
        .capability("notification")
        .build())

    return PipelineTemplate(
        template_id="tpl_devops",
        name="DevOps Deploy",
        description="5 阶段 DevOps：test → build → healthcheck/smoketest (并行) → notify",
        category="devops",
        stage_refs=[
            StageRef(stage_id="test"),
            StageRef(stage_id="build", depends_on=["test"]),
            StageRef(stage_id="healthcheck", depends_on=["build"], parallel_group="parallel"),
            StageRef(stage_id="smoketest", depends_on=["build"], parallel_group="parallel"),
            StageRef(stage_id="notify", depends_on=["healthcheck", "smoketest"]),
        ],
        stage_contracts=[test, build, healthcheck, smoketest, notify],
        default_inputs={"repo": "", "deploy_url": ""},
        tags=["devops", "deploy", "ci_cd"],
    )


def _build_data_pipeline_template() -> PipelineTemplate:
    """数据处理模板：extract → transform/validate (并行) → load → report"""
    extract = (ContractBuilder("extract", "Extract data")
        .input("source", build_text_field("source"))
        .output("raw_data", build_list_field("raw_data", item_type="dict"))
        .postcondition(invariant_non_empty("raw_data"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("etl")
        .build())

    transform = (ContractBuilder("transform", "Transform data")
        .input("raw_data", build_list_field("raw_data"))
        .output("transformed_data", build_list_field("transformed_data"))
        .postcondition(invariant_non_empty("transformed_data"))
        .sla(SLASpec(p99_latency_ms=60000))
        .capability("etl")
        .build())

    validate = (ContractBuilder("validate", "Validate data")
        .input("raw_data", build_list_field("raw_data"))
        .output("validation_errors", build_list_field("validation_errors"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("validation")
        .build())

    load = (ContractBuilder("load", "Load to destination")
        .input("transformed_data", build_list_field("transformed_data"))
        .output("load_stats", build_dict_field("load_stats"))
        .postcondition(invariant_non_null("load_stats"))
        .sla(SLASpec(p99_latency_ms=60000))
        .capability("etl")
        .build())

    report = (ContractBuilder("report", "Generate report")
        .input("load_stats", build_dict_field("load_stats"))
        .input("validation_errors", build_list_field("validation_errors"))
        .output("report", build_text_field("report"))
        .postcondition(invariant_non_empty("report"))
        .capability("reporting")
        .build())

    return PipelineTemplate(
        template_id="tpl_data_pipeline",
        name="Data Pipeline",
        description="5 阶段数据处理：extract → transform/validate (并行) → load → report",
        category="data",
        stage_refs=[
            StageRef(stage_id="extract"),
            StageRef(stage_id="transform", depends_on=["extract"], parallel_group="parallel"),
            StageRef(stage_id="validate", depends_on=["extract"], parallel_group="parallel"),
            StageRef(stage_id="load", depends_on=["transform"]),
            StageRef(stage_id="report", depends_on=["load", "validate"]),
        ],
        stage_contracts=[extract, transform, validate, load, report],
        default_inputs={"source": ""},
        tags=["data", "etl"],
    )


def _build_security_audit_template() -> PipelineTemplate:
    """安全审计模板：scan → analyze/penetrate (并行) → report"""
    scan = (ContractBuilder("scan", "Vulnerability scan")
        .input("target", build_text_field("target"))
        .output("scan_results", build_dict_field("scan_results"))
        .postcondition(invariant_non_null("scan_results"))
        .sla(SLASpec(p99_latency_ms=60000))
        .capability("security_scanner")
        .build())

    analyze = (ContractBuilder("analyze", "Analyze findings")
        .input("scan_results", build_dict_field("scan_results"))
        .output("analysis", build_dict_field("analysis"))
        .postcondition(invariant_non_null("analysis"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("security_analysis")
        .build())

    penetrate = (ContractBuilder("penetrate", "Penetration test")
        .input("scan_results", build_dict_field("scan_results"))
        .output("pentest_results", build_dict_field("pentest_results"))
        .postcondition(invariant_non_null("pentest_results"))
        .sla(SLASpec(p99_latency_ms=120000))
        .capability("penetration_test")
        .build())

    report = (ContractBuilder("security_report", "Security report")
        .input("analysis", build_dict_field("analysis"))
        .input("pentest_results", build_dict_field("pentest_results"))
        .output("security_report", build_text_field("security_report"))
        .postcondition(invariant_non_empty("security_report"))
        .sla(SLASpec(p99_latency_ms=30000))
        .capability("reporting")
        .build())

    return PipelineTemplate(
        template_id="tpl_security_audit",
        name="Security Audit",
        description="4 阶段安全审计：scan → analyze/pentest (并行) → report",
        category="security",
        stage_refs=[
            StageRef(stage_id="scan"),
            StageRef(stage_id="analyze", depends_on=["scan"], parallel_group="parallel"),
            StageRef(stage_id="penetrate", depends_on=["scan"], parallel_group="parallel"),
            StageRef(stage_id="security_report", depends_on=["analyze", "penetrate"]),
        ],
        stage_contracts=[scan, analyze, penetrate, report],
        default_inputs={"target": ""},
        tags=["security", "audit"],
    )


# ============================================================
# 模板集合
# ============================================================

PIPELINE_TEMPLATES: Dict[str, PipelineTemplate] = {
    "code_review": _build_code_review_template(),
    "research": _build_research_template(),
    "writing": _build_writing_template(),
    "devops": _build_devops_template(),
    "data_pipeline": _build_data_pipeline_template(),
    "security_audit": _build_security_audit_template(),
}


def list_templates() -> List[Dict[str, Any]]:
    """列出所有模板"""
    return [
        {
            "template_id": t.template_id,
            "name": t.name,
            "description": t.description,
            "category": t.category,
            "stage_count": len(t.stage_refs),
            "default_inputs": t.default_inputs,
            "version": t.version,
            "tags": t.tags,
        }
        for t in PIPELINE_TEMPLATES.values()
    ]


def get_template(name: str) -> Optional[PipelineTemplate]:
    """获取指定模板"""
    return PIPELINE_TEMPLATES.get(name)


def instantiate_template(
    name: str,
    inputs: Optional[Dict[str, Any]] = None,
    created_by: str = "system",
) -> Optional[Pipeline]:
    """从模板实例化 Pipeline"""
    template = get_template(name)
    if not template:
        return None

    # 合并默认输入
    merged_inputs = dict(template.default_inputs)
    if inputs:
        merged_inputs.update(inputs)

    pipeline = Pipeline(
        name=template.name,
        description=template.description,
        template=template.template_id,
        stages=[StageRef.from_dict(s.to_dict()) for s in template.stage_refs],
        inputs=merged_inputs,
        created_by=created_by,
    )
    return pipeline
