from __future__ import annotations

import logging
from datetime import timedelta
from time import time
from typing import Any

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


def _ttl_seconds(ttl: int | timedelta) -> int:
    if isinstance(ttl, timedelta):
        return max(int(ttl.total_seconds()), 0)
    return max(int(ttl), 0)


def _encode_hash_mapping(mapping: dict[str, Any]) -> dict[bytes, bytes]:
    encoded: dict[bytes, bytes] = {}
    for key, value in mapping.items():
        encoded[str(key).encode("utf-8")] = str(value).encode("utf-8")
    return encoded


class InMemoryRedis:
    def __init__(self) -> None:
        self._values: dict[str, tuple[Any, float | None]] = {}
        self._hashes: dict[str, tuple[dict[bytes, bytes], float | None]] = {}
        self._lists: dict[str, list[Any]] = {}

    def _expiry_at(self, ttl: int | timedelta) -> float | None:
        seconds = _ttl_seconds(ttl)
        if seconds <= 0:
            return None
        return time() + seconds

    def _is_expired(self, expires_at: float | None) -> bool:
        return expires_at is not None and expires_at <= time()

    def _purge_if_expired(self, key: str) -> None:
        value_item = self._values.get(key)
        if value_item and self._is_expired(value_item[1]):
            self._values.pop(key, None)

        hash_item = self._hashes.get(key)
        if hash_item and self._is_expired(hash_item[1]):
            self._hashes.pop(key, None)

    async def get(self, key: str) -> Any:
        self._purge_if_expired(key)
        item = self._values.get(key)
        return item[0] if item else None

    async def setex(self, key: str, ttl: int | timedelta, value: Any) -> bool:
        self._values[key] = (value, self._expiry_at(ttl))
        return True

    async def ttl(self, key: str) -> int:
        self._purge_if_expired(key)
        item = self._values.get(key)
        if not item:
            return -2
        expires_at = item[1]
        if expires_at is None:
            return -1
        return max(int(expires_at - time()), 0)

    async def hgetall(self, key: str) -> dict[bytes, bytes]:
        self._purge_if_expired(key)
        item = self._hashes.get(key)
        if not item:
            return {}
        return dict(item[0])

    async def hset(self, key: str, mapping: dict[str, Any]) -> int:
        self._purge_if_expired(key)
        current, expires_at = self._hashes.get(key, ({}, None))
        current.update(_encode_hash_mapping(mapping))
        self._hashes[key] = (current, expires_at)
        return len(mapping)

    async def expire(self, key: str, ttl: int | timedelta) -> bool:
        expires_at = self._expiry_at(ttl)
        if key in self._values:
            value, _ = self._values[key]
            self._values[key] = (value, expires_at)
            return True
        if key in self._hashes:
            value, _ = self._hashes[key]
            self._hashes[key] = (value, expires_at)
            return True
        return False

    async def rpush(self, key: str, value: Any) -> int:
        values = self._lists.setdefault(key, [])
        values.append(value)
        return len(values)


class ResilientRedis:
    def __init__(self, real_client: Redis) -> None:
        self._real_client = real_client
        self._fallback = InMemoryRedis()
        self._fallback_enabled = False

    async def _call(self, method_name: str, *args: Any, **kwargs: Any) -> Any:
        if self._fallback_enabled:
            fallback_method = getattr(self._fallback, method_name)
            return await fallback_method(*args, **kwargs)

        try:
            method = getattr(self._real_client, method_name)
            return await method(*args, **kwargs)
        except Exception as exc:  # pylint: disable=broad-except
            self._fallback_enabled = True
            logger.warning(
                "Redis unavailable, switching to in-memory fallback for this process: %s",
                exc,
            )
            fallback_method = getattr(self._fallback, method_name)
            return await fallback_method(*args, **kwargs)

    async def get(self, key: str) -> Any:
        return await self._call("get", key)

    async def setex(self, key: str, ttl: int | timedelta, value: Any) -> Any:
        return await self._call("setex", key, ttl, value)

    async def ttl(self, key: str) -> int:
        return await self._call("ttl", key)

    async def hgetall(self, key: str) -> dict[bytes, bytes]:
        return await self._call("hgetall", key)

    async def hset(self, key: str, mapping: dict[str, Any]) -> int:
        return await self._call("hset", key, mapping=mapping)

    async def expire(self, key: str, ttl: int | timedelta) -> bool:
        return await self._call("expire", key, ttl)

    async def rpush(self, key: str, value: Any) -> int:
        return await self._call("rpush", key, value)
