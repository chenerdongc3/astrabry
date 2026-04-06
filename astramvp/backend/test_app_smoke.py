from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from astramvp.backend import main
from astramvp.backend.xhs.service import (
    XHS_AUTH_TOKEN_KEY,
    get_auth_status,
)


class FakeRedis:
    def __init__(self, values: dict[str, str | bytes] | None = None, ttls: dict[str, int] | None = None) -> None:
        self.values = values or {}
        self.ttls = ttls or {}

    async def get(self, key: str) -> str | bytes | None:
        return self.values.get(key)

    async def ttl(self, key: str) -> int | None:
        return self.ttls.get(key)


class AppLifespanSmokeTest(unittest.IsolatedAsyncioTestCase):
    async def test_lifespan_runs_database_hooks(self) -> None:
        init_database = AsyncMock()
        close_database = AsyncMock()

        with (
            patch("astramvp.backend.main.init_database", init_database),
            patch("astramvp.backend.main.close_database", close_database),
        ):
            async with main.app.router.lifespan_context(main.app):
                pass

        init_database.assert_awaited_once()
        close_database.assert_awaited_once()

    async def test_healthcheck_returns_ok(self) -> None:
        payload = await main.healthcheck()

        self.assertEqual(payload, {"status": "ok"})


class XHSAuthStatusSmokeTest(unittest.IsolatedAsyncioTestCase):
    async def test_auth_status_reports_sync_action_without_cached_credentials(self) -> None:
        redis = FakeRedis()

        status = await get_auth_status(redis=redis)

        self.assertFalse(status.can_ingest)
        self.assertEqual(status.auth_mode, "none")
        self.assertEqual(status.next_action, "sync")
        self.assertIsNotNone(status.auth_error)

    async def test_auth_status_reports_cached_token_details(self) -> None:
        redis = FakeRedis(
            values={
                XHS_AUTH_TOKEN_KEY: json.dumps(
                    {
                        "xsec_token": "token-123",
                        "xsec_source": "pc_feed",
                        "updated_at": "2026-03-23T12:00:00",
                    }
                )
            },
            ttls={XHS_AUTH_TOKEN_KEY: 3600},
        )

        status = await get_auth_status(redis=redis)

        self.assertTrue(status.has_token)
        self.assertTrue(status.can_ingest)
        self.assertEqual(status.auth_mode, "token")
        self.assertEqual(status.next_action, "retry")
        self.assertEqual(status.ttl_seconds, 3600)
        self.assertIsNone(status.auth_error)


if __name__ == "__main__":
    unittest.main()
