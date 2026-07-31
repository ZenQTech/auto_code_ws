-- ============================================================
-- PostgreSQL 初始化脚本 - MCP × Multimodal RAG (Cycle 50 G50-04)
-- ============================================================
-- 核心作用：创建必要的 PostgreSQL 扩展和初始化表
-- 运行流程：
--   1. 启用 pg_trgm (三字符组相似度匹配)
--   2. 启用 vector 扩展 (如果可用, 留待未来切换)
--   3. 创建必要的 schema
-- 输入参数：POSTGRES_DB 环境变量
-- 输出结果：初始化后的数据库
-- 修改记录：
--   - 2026-08-01 | v1.0.0 | Cycle 50 G50-04 初次创建
-- ============================================================

-- 启用三字符组扩展 (用于文本相似度)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 启用 uuid 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 创建 schema
CREATE SCHEMA IF NOT EXISTS mcp_rag;

-- 设置默认 schema
SET search_path TO mcp_rag, public;

-- 创建 multimodal_documents 表 (用于持久化多模态 RAG 文档)
CREATE TABLE IF NOT EXISTS mcp_rag.multimodal_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    doc_id VARCHAR(255) UNIQUE NOT NULL,
    modality VARCHAR(20) NOT NULL CHECK (modality IN ('text', 'image', 'multimodal')),
    text_content TEXT,
    image_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    text_vector BYTEA,
    image_vector BYTEA,
    fused_vector BYTEA,
    dimension INTEGER NOT NULL DEFAULT 256,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_multimodal_documents_modality ON mcp_rag.multimodal_documents(modality);
CREATE INDEX IF NOT EXISTS idx_multimodal_documents_created_at ON mcp_rag.multimodal_documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_multimodal_documents_metadata ON mcp_rag.multimodal_documents USING GIN(metadata);

-- 创建 multimodal_search_history 表 (用于审计和分析)
CREATE TABLE IF NOT EXISTS mcp_rag.multimodal_search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_id VARCHAR(255) NOT NULL,
    query_modality VARCHAR(20) NOT NULL,
    query_text TEXT,
    query_image_url TEXT,
    result_count INTEGER NOT NULL,
    top_doc_ids TEXT[] DEFAULT '{}',
    latency_ms INTEGER NOT NULL,
    cache_hit BOOLEAN NOT NULL DEFAULT false,
    endpoint VARCHAR(50) NOT NULL,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_search_history_query_id ON mcp_rag.multimodal_search_history(query_id);
CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON mcp_rag.multimodal_search_history(created_at DESC);

-- 完成
SELECT 'MCP × Multimodal RAG database initialized' AS status;
