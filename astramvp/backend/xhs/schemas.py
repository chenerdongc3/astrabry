from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, HttpUrl, Field, field_validator


class XHSVisualElement(BaseModel):
    image_url: HttpUrl
    ocr_text: str | None = None
    perceptual_hash: str | None = None


class XHSEngagementMetrics(BaseModel):
    likes: int = Field(ge=0)
    collects: int = Field(ge=0)
    comments: int = Field(ge=0)
    shares: int = Field(ge=0)
    views: int = Field(ge=0)
    updated_at: datetime


class XHSContentSections(BaseModel):
    hook_title: str
    body: str
    hidden_tags: list[str] = []


class XHSSEResponse(BaseModel):
    note_id: str
    author_id: str
    category: str
    sub_category: str | None = None
    published_at: datetime
    media: list[HttpUrl]
    metrics: XHSEngagementMetrics
    title: str
    content: str
    hashtags: list[str] = []
    extra: dict[str, Any] = {}


class ParsedNote(BaseModel):
    note: XHSSEResponse
    visuals: list[XHSVisualElement]
    content: XHSContentSections
    seo_keywords: list[str]


class PulseScore(BaseModel):
    note_id: str
    score: float
    velocity: float
    interaction_view_ratio: float
    trend: Literal["short_spike", "consistent_growth", "stable"]
    is_high_priority: bool
    benchmark_ratio: float


class XHSMonitoredAccount(BaseModel):
    id: str
    name: str
    xhs_id: str
    platform: Literal["xiaohongshu"] = "xiaohongshu"
    avatar: str
    post_count: int = 0
    profile_url: HttpUrl | None = None


class XHSNoteSummary(BaseModel):
    id: str
    account_id: str
    url: HttpUrl | None = None
    title: str
    content: str
    likes: int
    shares: int
    comments: int
    collects: int
    views: int
    growth_rate: float
    status: Literal["viral", "normal", "low"]
    timestamp: datetime
    history: list[int]
    seo_keywords: list[str] = []


class NoteIngestRequest(BaseModel):
    url: HttpUrl | None = None
    payload: XHSSEResponse | None = None
    account_id: str | None = None
    platform: Literal["xiaohongshu"] = "xiaohongshu"

    @field_validator("payload")
    @classmethod
    def ensure_source(cls, payload, info):
        if not payload and not info.data.get("url"):
            raise ValueError("Either url or payload must be provided.")
        return payload


class NoteIngestResponse(BaseModel):
    parsed: ParsedNote
    pulse: PulseScore
    cached_key: str
    agent_task_id: str | None = None
    account: XHSMonitoredAccount
    post: XHSNoteSummary


class XHSAccountRefreshResult(BaseModel):
    account_id: str
    success: bool
    refreshed_posts: int = 0
    error: str | None = None


class XHSAccountsRefreshResponse(BaseModel):
    total_accounts: int
    refreshed_accounts: int
    failed_accounts: int
    total_posts: int
    results: list[XHSAccountRefreshResult] = []
