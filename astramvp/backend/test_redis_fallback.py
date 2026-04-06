from __future__ import annotations

import unittest
from datetime import timedelta

from astramvp.backend.redis_fallback import ResilientRedis


class FailingRedis:
    async def get(self, key: str):
        raise ConnectionError("redis down")

    async def setex(self, key: str, ttl, value):
        raise ConnectionError("redis down")

    async def ttl(self, key: str):
        raise ConnectionError("redis down")

    async def hgetall(self, key: str):
        raise ConnectionError("redis down")

    async def hset(self, key: str, mapping):
        raise ConnectionError("redis down")

    async def expire(self, key: str, ttl):
        raise ConnectionError("redis down")

    async def rpush(self, key: str, value):
        raise ConnectionError("redis down")


class ResilientRedisTest(unittest.IsolatedAsyncioTestCase):
    async def test_string_cache_falls_back_when_redis_is_unavailable(self) -> None:
        redis = ResilientRedis(real_client=FailingRedis())

        await redis.setex("demo", 30, "value")

        self.assertEqual(await redis.get("demo"), "value")
        self.assertGreaterEqual(await redis.ttl("demo"), 0)

    async def test_hash_cache_falls_back_when_redis_is_unavailable(self) -> None:
        redis = ResilientRedis(real_client=FailingRedis())

        await redis.hset("pulse", {"likes": 12, "ts": 123.4})
        payload = await redis.hgetall("pulse")

        self.assertEqual(payload[b"likes"], b"12")
        self.assertEqual(payload[b"ts"], b"123.4")
        self.assertTrue(await redis.expire("pulse", timedelta(seconds=30)))

    async def test_list_push_falls_back_when_redis_is_unavailable(self) -> None:
        redis = ResilientRedis(real_client=FailingRedis())

        size = await redis.rpush("memory", '{"account_id":"acc-1"}')

        self.assertEqual(size, 1)


if __name__ == "__main__":
    unittest.main()
