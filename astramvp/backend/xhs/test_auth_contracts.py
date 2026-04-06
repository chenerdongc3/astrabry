from __future__ import annotations

import unittest

from astramvp.backend.xhs.auth_contracts import (
    XHSAuthStatusResponse,
    resolve_xhs_auth_mode,
    resolve_xhs_next_action,
)


class XHSAuthContractsTest(unittest.TestCase):
    def test_token_auth_is_ingest_ready(self) -> None:
        status = XHSAuthStatusResponse(
            has_token=True,
            has_cookie=False,
            can_ingest=True,
            login_url="https://www.xiaohongshu.com",
            auth_mode=resolve_xhs_auth_mode(has_token=True, has_cookie=False),
            next_action=resolve_xhs_next_action(can_ingest=True, sync_available=True),
        )

        self.assertTrue(status.can_ingest)
        self.assertEqual(status.auth_mode, "token")
        self.assertEqual(status.next_action, "retry")

    def test_cookie_auth_is_ingest_ready(self) -> None:
        status = XHSAuthStatusResponse(
            has_token=False,
            has_cookie=True,
            can_ingest=True,
            login_url="https://www.xiaohongshu.com",
            auth_mode=resolve_xhs_auth_mode(has_token=False, has_cookie=True),
            next_action=resolve_xhs_next_action(can_ingest=True, sync_available=True),
        )

        self.assertTrue(status.can_ingest)
        self.assertEqual(status.auth_mode, "cookie")
        self.assertEqual(status.next_action, "retry")

    def test_missing_auth_can_recommend_sync(self) -> None:
        status = XHSAuthStatusResponse(
            has_token=False,
            has_cookie=False,
            can_ingest=False,
            login_url="https://www.xiaohongshu.com",
            auth_mode=resolve_xhs_auth_mode(has_token=False, has_cookie=False),
            next_action=resolve_xhs_next_action(can_ingest=False, sync_available=True),
        )

        self.assertFalse(status.can_ingest)
        self.assertEqual(status.auth_mode, "none")
        self.assertEqual(status.next_action, "sync")

    def test_missing_auth_falls_back_to_login_when_sync_is_unavailable(self) -> None:
        self.assertEqual(
            resolve_xhs_next_action(can_ingest=False, sync_available=False),
            "login",
        )


if __name__ == "__main__":
    unittest.main()
