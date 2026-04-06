from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

XHSAuthMode = Literal["token", "cookie", "none"]
XHSNextAction = Literal["login", "sync", "retry"]


def resolve_xhs_auth_mode(has_token: bool, has_cookie: bool) -> XHSAuthMode:
    if has_token:
        return "token"
    if has_cookie:
        return "cookie"
    return "none"


def resolve_xhs_next_action(can_ingest: bool, sync_available: bool) -> XHSNextAction:
    if can_ingest:
        return "retry"
    return "sync" if sync_available else "login"


class XHSAuthErrorDetail(BaseModel):
    code: Literal["XHS_AUTH_REQUIRED"] = "XHS_AUTH_REQUIRED"
    message: str
    login_url: str


class XHSAuthStatusResponse(BaseModel):
    has_token: bool
    has_cookie: bool = False
    can_ingest: bool = False
    login_url: str
    auth_mode: XHSAuthMode = "none"
    next_action: XHSNextAction = "login"
    xsec_source: str | None = None
    updated_at: str | None = None
    cookie_updated_at: str | None = None
    ttl_seconds: int | None = Field(default=None, ge=0)
    auth_error: XHSAuthErrorDetail | None = None


class XHSPlaywrightSyncResponse(BaseModel):
    success: bool
    has_cookie: bool
    updated_at: str | None = None
    message: str | None = None
