from __future__ import annotations

import unittest
from unittest.mock import patch

from astramvp.backend import db


class _FakeSession:
    def __init__(self) -> None:
        self.entered = False
        self.exited = False

    async def __aenter__(self):
        self.entered = True
        return self

    async def __aexit__(self, exc_type, exc, tb):
        self.exited = True


class _FakeSessionMaker:
    def __init__(self, session: _FakeSession) -> None:
        self.session = session
        self.calls = 0

    def __call__(self) -> _FakeSession:
        self.calls += 1
        return self.session


class GetDbSessionTest(unittest.IsolatedAsyncioTestCase):
    async def test_get_db_session_yields_real_session_instance(self) -> None:
        fake_session = _FakeSession()
        fake_maker = _FakeSessionMaker(fake_session)

        with patch("astramvp.backend.db.session_factory", return_value=fake_maker):
            gen = db.get_db_session()
            yielded = await anext(gen)
            self.assertIs(yielded, fake_session)
            await gen.aclose()

        self.assertEqual(fake_maker.calls, 1)
        self.assertTrue(fake_session.entered)
        self.assertTrue(fake_session.exited)


if __name__ == "__main__":
    unittest.main()
