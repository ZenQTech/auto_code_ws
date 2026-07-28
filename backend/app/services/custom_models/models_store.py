"""
# ============================================================
# Custom Models Store - 自定义模型存储层
# ============================================================
# 核心作用：管理用户自定义 OpenAI-compatible 模型提供商
# 特性：
#   1. 支持 4 种 Provider: openai / anthropic / azure / custom
#   2. API Key Fernet 加密存储
#   3. Bearer Token 过期管理
#   4. SQLite 持久化
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 8 P0-14
# ============================================================
"""

import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

PROVIDER_TYPES = ("openai", "anthropic", "azure", "custom")

DEFAULT_DATA_DIR = Path.home() / ".hermes"
DB_FILENAME = "custom_models.db"
ENCRYPTION_KEY_FILENAME = ".encryption_key"

# 加密导入（可选）
try:
    from cryptography.fernet import Fernet, InvalidToken

    HAS_FERNET = True
except ImportError:
    HAS_FERNET = False
    logger.warning("cryptography 未安装，API Key 将以明文存储（不推荐生产）")


# ============================================================
# 数据模型
# ============================================================

@dataclass
class ModelProvider:
    """模型提供商"""
    id: str
    name: str
    type: str  # openai | anthropic | azure | custom
    base_url: str
    api_key_encrypted: str = ""
    api_key_masked: str = ""  # 仅显示前 4 位 + ***
    refresh_token_encrypted: str = ""
    expires_at: Optional[float] = None
    enabled: bool = True
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self, include_secrets: bool = False) -> Dict[str, Any]:
        """转换为字典"""
        result = asdict(self)
        if not include_secrets:
            result["api_key_encrypted"] = ""
            result["refresh_token_encrypted"] = ""
        return result

    def is_expired(self) -> bool:
        """是否已过期"""
        if self.expires_at is None:
            return False
        return time.time() >= self.expires_at

    def expires_in_seconds(self) -> Optional[int]:
        """距离过期还有多少秒"""
        if self.expires_at is None:
            return None
        return int(self.expires_at - time.time())


@dataclass
class ModelEntry:
    """模型条目"""
    id: str
    provider_id: str
    model_id: str
    display_name: str
    max_tokens: int = 4096
    context_window: int = 32768
    temperature_default: float = 0.7
    enabled: bool = True
    created_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 加密辅助
# ============================================================

def _get_encryption_key() -> Optional[bytes]:
    """获取或生成加密密钥"""
    if not HAS_FERNET:
        return None
    key_path = DEFAULT_DATA_DIR / ENCRYPTION_KEY_FILENAME
    if key_path.exists():
        try:
            return key_path.read_bytes()
        except OSError as e:
            logger.error(f"读取加密密钥失败: {e}")
            return None
    # 首次启动：生成新密钥
    try:
        DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
        key = Fernet.generate_key()
        key_path.write_bytes(key)
        os.chmod(key_path, 0o600)  # 仅所有者可读
        logger.info(f"生成新的加密密钥: {key_path}")
        return key
    except OSError as e:
        logger.error(f"生成加密密钥失败: {e}")
        return None


_cipher_instance: Optional["Fernet"] = None


def _get_cipher() -> Optional["Fernet"]:
    """获取 Fernet cipher 实例"""
    global _cipher_instance
    if _cipher_instance is not None:
        return _cipher_instance
    if not HAS_FERNET:
        return None
    key = _get_encryption_key()
    if key is None:
        return None
    _cipher_instance = Fernet(key)
    return _cipher_instance


def encrypt_value(plaintext: str) -> str:
    """加密字符串"""
    if not plaintext:
        return ""
    cipher = _get_cipher()
    if cipher is None:
        return plaintext  # 降级：明文存储
    try:
        return cipher.encrypt(plaintext.encode("utf-8")).decode("utf-8")
    except Exception as e:
        logger.error(f"加密失败: {e}")
        return ""


def decrypt_value(ciphertext: str) -> str:
    """解密字符串"""
    if not ciphertext:
        return ""
    cipher = _get_cipher()
    if cipher is None:
        return ciphertext  # 降级：明文返回
    try:
        return cipher.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except (InvalidToken, Exception) as e:
        logger.warning(f"解密失败: {e}")
        return ""


def mask_api_key(api_key: str) -> str:
    """脱敏显示 API Key"""
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "****"
    return api_key[:4] + "*" * (len(api_key) - 8) + api_key[-4:]


# ============================================================
# ModelsStore
# ============================================================

class ModelsStore:
    """
    模型存储（SQLite）

    使用方式：
        store = ModelsStore()
        provider = store.create_provider(name="DeepSeek", type="openai", ...)
    """

    def __init__(self, db_path: Optional[Path] = None) -> None:
        if db_path is None:
            DEFAULT_DATA_DIR.mkdir(parents=True, exist_ok=True)
            db_path = DEFAULT_DATA_DIR / DB_FILENAME
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """初始化数据库表结构"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS providers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    api_key_encrypted TEXT DEFAULT '',
                    api_key_masked TEXT DEFAULT '',
                    refresh_token_encrypted TEXT DEFAULT '',
                    expires_at REAL,
                    enabled INTEGER DEFAULT 1,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    metadata TEXT DEFAULT '{}'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS models (
                    id TEXT PRIMARY KEY,
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    max_tokens INTEGER DEFAULT 4096,
                    context_window INTEGER DEFAULT 32768,
                    temperature_default REAL DEFAULT 0.7,
                    enabled INTEGER DEFAULT 1,
                    created_at REAL NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
                )
            """)
            conn.commit()
        logger.info(f"模型数据库已就绪: {self.db_path}")

    # ============================================================
    # Provider CRUD
    # ============================================================

    def create_provider(
        self,
        name: str,
        type: str,
        base_url: str,
        api_key: str = "",
        refresh_token: str = "",
        expires_at: Optional[float] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ModelProvider:
        """创建 provider"""
        if type not in PROVIDER_TYPES:
            raise ValueError(f"不支持的 provider 类型: {type}")

        provider = ModelProvider(
            id=str(uuid.uuid4()),
            name=name,
            type=type,
            base_url=base_url,
            api_key_encrypted=encrypt_value(api_key),
            api_key_masked=mask_api_key(api_key),
            refresh_token_encrypted=encrypt_value(refresh_token),
            expires_at=expires_at,
            metadata=metadata or {},
        )

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO providers (
                    id, name, type, base_url, api_key_encrypted, api_key_masked,
                    refresh_token_encrypted, expires_at, enabled,
                    created_at, updated_at, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    provider.id, provider.name, provider.type, provider.base_url,
                    provider.api_key_encrypted, provider.api_key_masked,
                    provider.refresh_token_encrypted, provider.expires_at,
                    int(provider.enabled), provider.created_at, provider.updated_at,
                    json.dumps(provider.metadata),
                ),
            )
            conn.commit()
        return provider

    def get_provider(self, provider_id: str) -> Optional[ModelProvider]:
        """获取 provider"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT * FROM providers WHERE id = ?", (provider_id,)
            ).fetchone()
            if row is None:
                return None
            return self._row_to_provider(row)

    def list_providers(self, enabled_only: bool = False) -> List[ModelProvider]:
        """列出 providers"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            query = "SELECT * FROM providers"
            if enabled_only:
                query += " WHERE enabled = 1"
            query += " ORDER BY created_at DESC"
            rows = conn.execute(query).fetchall()
            return [self._row_to_provider(row) for row in rows]

    def update_provider(
        self,
        provider_id: str,
        **kwargs: Any,
    ) -> Optional[ModelProvider]:
        """更新 provider"""
        existing = self.get_provider(provider_id)
        if existing is None:
            return None

        # 处理加密字段
        if "api_key" in kwargs:
            kwargs["api_key_encrypted"] = encrypt_value(kwargs.pop("api_key"))
            kwargs["api_key_masked"] = mask_api_key(kwargs.get("api_key_encrypted", ""))
        if "refresh_token" in kwargs:
            kwargs["refresh_token_encrypted"] = encrypt_value(kwargs.pop("refresh_token"))

        kwargs["updated_at"] = time.time()

        # 构建 SQL
        set_clauses = []
        values = []
        for key, value in kwargs.items():
            if key in ("metadata",) and isinstance(value, dict):
                value = json.dumps(value)
            set_clauses.append(f"{key} = ?")
            values.append(value)
        values.append(provider_id)

        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                f"UPDATE providers SET {', '.join(set_clauses)} WHERE id = ?",
                values,
            )
            conn.commit()

        return self.get_provider(provider_id)

    def delete_provider(self, provider_id: str) -> bool:
        """删除 provider"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM providers WHERE id = ?", (provider_id,)
            )
            conn.commit()
            return cursor.rowcount > 0

    def _row_to_provider(self, row: sqlite3.Row) -> ModelProvider:
        """将数据库行转换为 ModelProvider"""
        try:
            metadata = json.loads(row["metadata"]) if row["metadata"] else {}
        except (json.JSONDecodeError, TypeError):
            metadata = {}
        return ModelProvider(
            id=row["id"],
            name=row["name"],
            type=row["type"],
            base_url=row["base_url"],
            api_key_encrypted=row["api_key_encrypted"] or "",
            api_key_masked=row["api_key_masked"] or "",
            refresh_token_encrypted=row["refresh_token_encrypted"] or "",
            expires_at=row["expires_at"],
            enabled=bool(row["enabled"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            metadata=metadata,
        )

    # ============================================================
    # ModelEntry CRUD
    # ============================================================

    def create_model(
        self,
        provider_id: str,
        model_id: str,
        display_name: str,
        max_tokens: int = 4096,
        context_window: int = 32768,
        temperature_default: float = 0.7,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> ModelEntry:
        """创建模型条目"""
        entry = ModelEntry(
            id=str(uuid.uuid4()),
            provider_id=provider_id,
            model_id=model_id,
            display_name=display_name,
            max_tokens=max_tokens,
            context_window=context_window,
            temperature_default=temperature_default,
            metadata=metadata or {},
        )
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO models (
                    id, provider_id, model_id, display_name,
                    max_tokens, context_window, temperature_default,
                    enabled, created_at, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.id, entry.provider_id, entry.model_id, entry.display_name,
                    entry.max_tokens, entry.context_window, entry.temperature_default,
                    int(entry.enabled), entry.created_at, json.dumps(entry.metadata),
                ),
            )
            conn.commit()
        return entry

    def list_models(
        self,
        provider_id: Optional[str] = None,
        enabled_only: bool = False,
    ) -> List[ModelEntry]:
        """列出模型"""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            query = "SELECT * FROM models"
            conditions = []
            values = []
            if provider_id:
                conditions.append("provider_id = ?")
                values.append(provider_id)
            if enabled_only:
                conditions.append("enabled = 1")
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY display_name"
            rows = conn.execute(query, values).fetchall()
            return [self._row_to_model(row) for row in rows]

    def delete_model(self, model_id: str) -> bool:
        """删除模型条目"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute("DELETE FROM models WHERE id = ?", (model_id,))
            conn.commit()
            return cursor.rowcount > 0

    def _row_to_model(self, row: sqlite3.Row) -> ModelEntry:
        """将数据库行转换为 ModelEntry"""
        try:
            metadata = json.loads(row["metadata"]) if row["metadata"] else {}
        except (json.JSONDecodeError, TypeError):
            metadata = {}
        return ModelEntry(
            id=row["id"],
            provider_id=row["provider_id"],
            model_id=row["model_id"],
            display_name=row["display_name"],
            max_tokens=row["max_tokens"],
            context_window=row["context_window"],
            temperature_default=row["temperature_default"],
            enabled=bool(row["enabled"]),
            created_at=row["created_at"],
            metadata=metadata,
        )
