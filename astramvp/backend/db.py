from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, AsyncGenerator
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _normalize_database_url(url: str) -> str:
    normalized = url.strip()
    if normalized.startswith("postgres://"):
        normalized = normalized.replace("postgres://", "postgresql://", 1)
    if normalized.startswith("postgresql://") and "+asyncpg" not in normalized:
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    return normalized


def database_url() -> str:
    raw_url = os.getenv("SUPABASE_DB_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if not raw_url:
        raise RuntimeError(
            "Missing Supabase database URL. Set SUPABASE_DB_URL (or DATABASE_URL) before starting the backend."
        )
    return _normalize_database_url(raw_url)


def _uses_transaction_pooler(url: str) -> bool:
    mode = os.getenv("SUPABASE_POOL_MODE", "").strip().lower()
    if mode == "transaction":
        return True
    if mode in {"session", "direct"}:
        return False

    parsed = urlparse(url)
    return parsed.port == 6543


@lru_cache
def db_engine() -> AsyncEngine:
    url = database_url()
    connect_args: dict[str, Any] = {}
    engine_kwargs: dict[str, Any] = {
        "echo": _env_flag("SQLALCHEMY_ECHO"),
        "pool_pre_ping": True,
    }

    if _uses_transaction_pooler(url):
        engine_kwargs["poolclass"] = NullPool
        # Supabase transaction poolers do not support prepared statements.
        connect_args["statement_cache_size"] = 0

    if connect_args:
        engine_kwargs["connect_args"] = connect_args

    return create_async_engine(url, **engine_kwargs)


@lru_cache
def session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(bind=db_engine(), expire_on_commit=False)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    session_maker = session_factory()
    async with session_maker() as session:
        yield session


async def init_database() -> None:
    from . import accounts
    from .xhs import models as xhs_models

    async with db_engine().begin() as connection:
        await connection.run_sync(accounts.Base.metadata.create_all)
        await connection.run_sync(xhs_models.Base.metadata.create_all)


async def close_database() -> None:
    await db_engine().dispose()
