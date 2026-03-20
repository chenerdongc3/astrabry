from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class XHSAuthErrorDetail(BaseModel):
    code: Literal["XHS_AUTH_REQUIRED"] = "XHS_AUTH_REQUIRED"
    message: str
    login_url: str


class XHSAuthStatusResponse(BaseModel):
    has_token: bool
    login_url: str
    xsec_source: str | None = None
    updated_at: str | None = None
    ttl_seconds: int | None = Field(default=None, ge=0)
    auth_error: XHSAuthErrorDetail | None = None
