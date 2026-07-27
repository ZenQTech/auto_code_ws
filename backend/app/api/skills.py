"""
# ============================================================
# Skills API 路由
# ============================================================
# 端点：
#   - GET    /api/skills                   列出所有 Skills
#   - POST   /api/skills                   创建 Skill
#   - GET    /api/skills/{id}              获取 Skill 详情
#   - PUT    /api/skills/{id}              更新 Skill
#   - DELETE /api/skills/{id}              删除 Skill
#   - POST   /api/skills/{id}/enable       启用
#   - POST   /api/skills/{id}/disable      禁用
#   - GET    /api/skills/prompt/preview    预览拼接的 system prompt
#   - POST   /api/skills/import            导入 SKILL.md（Cycle 3）
#   - POST   /api/skills/import-zip        批量导入 zip（Cycle 3）
#   - GET    /api/skills/{id}/export       导出为 SKILL.md（Cycle 3）
#   - GET    /api/skills/export-zip        批量导出 zip（Cycle 3）
#   - POST   /api/skills/preview           预览 SKILL.md 解析（Cycle 3）
# 创建日期：2026-07-27
# 模块版本：v1.1.0 - Cycle 3 SKILL.md 导入导出
# ============================================================
"""

import logging
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Request, Query, UploadFile, File

from backend.app.services.skill_md import (
    parse_skill_md,
    build_skill_md,
    SkillImportExportService,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def get_skill_service(request: Request):
    svc = getattr(request.app.state, "skill_service", None)
    if svc is None:
        raise HTTPException(status_code=503, detail="SkillService 未初始化")
    return svc


@router.get("/skills")
async def list_skills(
    request: Request,
    enabled_only: bool = Query(False, description="仅返回启用的"),
):
    """列出所有 Skills"""
    svc = get_skill_service(request)
    skills = svc.list_skills(enabled_only=enabled_only)
    return {"success": True, "skills": skills, "count": len(skills)}


@router.post("/skills")
async def create_skill(request: Request, body: Dict[str, Any]):
    """创建 Skill"""
    svc = get_skill_service(request)
    try:
        skill = svc.create_skill(
            name=body.get("name"),
            display_name=body.get("display_name"),
            description=body.get("description", ""),
            system_prompt=body.get("system_prompt", ""),
            tools=body.get("tools", []),
            source=body.get("source", "user"),
            version=body.get("version", "1.0.0"),
        )
        return {"success": True, "skill": skill}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/skills/{skill_id}")
async def get_skill(skill_id: str, request: Request):
    """获取 Skill 详情"""
    svc = get_skill_service(request)
    skill = svc.get_skill(skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {skill_id}")
    return {"success": True, "skill": skill}


@router.put("/skills/{skill_id}")
async def update_skill(skill_id: str, request: Request, body: Dict[str, Any]):
    """更新 Skill"""
    svc = get_skill_service(request)
    skill = svc.update_skill(skill_id, body)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {skill_id}")
    return {"success": True, "skill": skill}


@router.delete("/skills/{skill_id}")
async def delete_skill(skill_id: str, request: Request):
    """删除 Skill"""
    svc = get_skill_service(request)
    success = svc.delete_skill(skill_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Skill 删除失败（可能是内置 Skill）: {skill_id}",
        )
    return {"success": True, "message": f"Skill {skill_id} 已删除"}


@router.post("/skills/{skill_id}/enable")
async def enable_skill(skill_id: str, request: Request):
    """启用 Skill"""
    svc = get_skill_service(request)
    skill = svc.set_enabled(skill_id, True)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {skill_id}")
    return {"success": True, "skill": skill}


@router.post("/skills/{skill_id}/disable")
async def disable_skill(skill_id: str, request: Request):
    """禁用 Skill"""
    svc = get_skill_service(request)
    skill = svc.set_enabled(skill_id, False)
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {skill_id}")
    return {"success": True, "skill": skill}


@router.get("/skills/prompt/preview")
async def preview_skill_prompt(
    request: Request,
    base_prompt: str = Query("", description="基础提示词"),
):
    """预览拼接的 system prompt"""
    svc = get_skill_service(request)
    prompt = svc.build_system_prompt(base_prompt=base_prompt)
    return {
        "success": True,
        "prompt": prompt,
        "length": len(prompt),
        "enabled_count": len([s for s in svc.list_skills() if s.get("enabled")]),
    }


# ============================================================
# Cycle 3 v1.0.0: SKILL.md 导入/导出
# ============================================================

@router.post("/skills/import")
async def import_skill_md(
    request: Request,
    file: UploadFile = File(...),
    overwrite: bool = Query(False, description="是否覆盖同名 skill"),
):
    """
    Cycle 3 v1.0.0: 导入 SKILL.md 文件
    - 解析 YAML 头 + Markdown body
    - 验证字段格式
    - 保存到 skills 表
    """
    svc = get_skill_service(request)
    content = (await file.read()).decode("utf-8")
    service = SkillImportExportService(skills_service=svc)
    result = service.import_from_file(content, filename=file.filename or "SKILL.md", overwrite=overwrite)

    if not result.success:
        return {
            "success": False,
            "skill_id": result.skill_id,
            "skill_name": result.skill_name,
            "errors": result.errors,
            "warnings": result.warnings,
        }
    return {
        "success": True,
        "skill_id": result.skill_id,
        "skill_name": result.skill_name,
        "warnings": result.warnings,
    }


@router.post("/skills/import-zip")
async def import_skills_zip(
    request: Request,
    file: UploadFile = File(...),
    overwrite: bool = Query(False, description="是否覆盖同名 skill"),
):
    """
    Cycle 3 v1.0.0: 批量导入 SKILL.md（zip 包）
    - 解析 zip 内所有 .md 文件
    - 返回每个文件的导入结果
    """
    svc = get_skill_service(request)
    zip_bytes = await file.read()
    service = SkillImportExportService(skills_service=svc)
    results = service.import_from_zip(zip_bytes, overwrite=overwrite)

    imported = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    return {
        "success": failed == 0,
        "imported": imported,
        "failed": failed,
        "results": [
            {
                "skill_name": r.skill_name,
                "skill_id": r.skill_id,
                "success": r.success,
                "errors": r.errors,
                "warnings": r.warnings,
            }
            for r in results
        ],
    }


@router.get("/skills/{skill_id}/export")
async def export_skill_md(skill_id: str, request: Request):
    """
    Cycle 3 v1.0.0: 导出单个 Skill 为 SKILL.md
    """
    from fastapi.responses import PlainTextResponse

    svc = get_skill_service(request)
    skill = svc.get_skill(skill_id) if hasattr(svc, "get_skill") else None
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill 不存在: {skill_id}")

    service = SkillImportExportService(skills_service=svc)
    content = service.export_to_md(skill)

    return PlainTextResponse(
        content=content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="{skill["name"]}.SKILL.md"',
        },
    )


@router.get("/skills/export-zip")
async def export_skills_zip(
    request: Request,
    ids: Optional[str] = Query(None, description="逗号分隔的 skill ID 列表（不传则导出全部）"),
):
    """
    Cycle 3 v1.0.0: 批量导出 Skills 为 zip 包
    """
    from fastapi.responses import Response

    svc = get_skill_service(request)
    all_skills = svc.list_skills()

    if ids:
        id_set = set(ids.split(","))
        skills = [s for s in all_skills if s.get("id") in id_set]
    else:
        skills = all_skills

    if not skills:
        raise HTTPException(status_code=404, detail="没有可导出的 Skill")

    service = SkillImportExportService(skills_service=svc)
    zip_bytes = service.export_to_zip(skills)

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="skills.zip"',
        },
    )


@router.post("/skills/preview")
async def preview_skill_md(body: Dict[str, Any]):
    """
    Cycle 3 v1.0.0: 预览 SKILL.md 解析结果（不保存）
    """
    content = body.get("content", "")
    if not content:
        raise HTTPException(status_code=400, detail="content 字段不能为空")

    parsed = parse_skill_md(content)
    return {
        "success": parsed.valid,
        "valid": parsed.valid,
        "errors": parsed.errors,
        "warnings": parsed.warnings,
        "frontmatter": parsed.frontmatter.model_dump() if parsed.valid else None,
        "body_length": len(parsed.body),
    }
