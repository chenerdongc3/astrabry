from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db_session
from ..deps import get_redis, get_agent_executor
from .auth_contracts import (
    XHSAuthErrorDetail,
    XHSAuthStatusResponse,
    XHSNextAction,
    XHSPlaywrightSyncResponse,
    resolve_xhs_auth_mode,
    resolve_xhs_next_action,
)
from .parser import ProxyRotator, ProxyProfile, XHSHttpClient, XHSNoteParser, PulseBenchmarks, PulseEngine
from .schemas import (
    NoteIngestRequest,
    NoteIngestResponse,
    ParsedNote,
    PulseScore,
    XHSAccountRefreshResult,
    XHSAccountsRefreshResponse,
    XHSMonitoredAccount,
    XHSNoteSummary,
)
from .store import (
    delete_account as delete_account_record,
    list_accounts as list_accounts_db,
    list_notes as list_notes_db,
    load_account as load_account_db,
    replace_account_notes,
    sync_account_post_count,
    upsert_account as upsert_account_record,
    upsert_note,
)

router = APIRouter(prefix="/xhs", tags=["xiaohongshu"])
logger = logging.getLogger(__name__)

PARSED_CACHE_PREFIX = "xhs:parsed"
XHS_AUTH_TOKEN_KEY = "xhs:auth:token"
XHS_AUTH_COOKIE_KEY = "xhs:auth:cookies"
XHS_AUTH_COOKIE_TTL_SECONDS = 7 * 24 * 3600
DEFAULT_XHS_LOGIN_URL = "https://www.xiaohongshu.com"
XHS_AUTH_REQUIRED_MESSAGE = "请先登录小红书，并在完成登录后同步当前浏览器登录态，然后重试。"
XHS_AUTH_LOGIN_REQUIRED_MESSAGE = "请先打开小红书登录页完成登录后重试。"
XHS_AUTH_SYNC_REQUIRED_MESSAGE = "请先完成小红书登录，然后点击“同步当前浏览器登录态”后重试。"
XHS_PLAYWRIGHT_RESULT_PREFIX = "XHS_LOGIN_SYNC_RESULT="


async def get_parser(redis: Redis = Depends(get_redis)) -> XHSNoteParser:
    http_proxy = os.getenv("XHS_HTTP_PROXY", "").strip()
    https_proxy = os.getenv("XHS_HTTPS_PROXY", "").strip()
    cookie_header = await _load_cached_xhs_cookie_header(redis)
    proxies = [
        ProxyProfile(
            http=http_proxy,
            https=https_proxy or http_proxy,
            provider="env_proxy" if (http_proxy or https_proxy) else "direct",
        ),
    ]
    base_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if cookie_header:
        base_headers["Cookie"] = cookie_header
        base_headers["Referer"] = "https://www.xiaohongshu.com/"
        base_headers["Origin"] = "https://www.xiaohongshu.com"

    rotator = ProxyRotator(proxies=proxies)
    client = XHSHttpClient(proxy_rotator=rotator, base_headers=base_headers)
    return XHSNoteParser(http_client=client)


@router.get("/auth/status", response_model=XHSAuthStatusResponse)
async def get_auth_status(redis: Redis = Depends(get_redis)) -> XHSAuthStatusResponse:
    # Keep this endpoint lightweight so frontend can decide whether to show login jump before ingest.
    cached = await _load_cached_xhs_token_record(redis)
    cached_cookie = await _load_cached_xhs_cookie_record(redis)
    has_token = cached is not None
    has_cookie = cached_cookie is not None
    can_ingest = has_token or has_cookie
    auth_mode = resolve_xhs_auth_mode(has_token=has_token, has_cookie=has_cookie)
    next_action = resolve_xhs_next_action(
        can_ingest=can_ingest,
        sync_available=_can_sync_xhs_auth_with_playwright(),
    )
    ttl_seconds = await _load_xhs_token_ttl(redis) if has_token else None
    auth_error = None if can_ingest else _build_xhs_auth_required_detail(next_action=next_action)

    return XHSAuthStatusResponse(
        has_token=has_token,
        has_cookie=has_cookie,
        can_ingest=can_ingest,
        login_url=_resolve_xhs_login_url(),
        auth_mode=auth_mode,
        next_action=next_action,
        xsec_source=cached.get("xsec_source") if cached else None,
        updated_at=cached.get("updated_at") if cached else None,
        cookie_updated_at=cached_cookie.get("updated_at") if cached_cookie else None,
        ttl_seconds=ttl_seconds,
        auth_error=auth_error,
    )


@router.post("/auth/playwright/sync", response_model=XHSPlaywrightSyncResponse)
async def sync_auth_with_playwright(
    timeout_seconds: int = 180,
    redis: Redis = Depends(get_redis),
) -> XHSPlaywrightSyncResponse:
    if timeout_seconds < 30 or timeout_seconds > 600:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="timeout_seconds must be between 30 and 600")

    try:
        result = await _run_playwright_login_sync(timeout_seconds=timeout_seconds)
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=_resolve_error_message(exc)) from exc

    cookie_header = result.get("cookie_header")
    if not isinstance(cookie_header, str) or not cookie_header.strip():
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Playwright login completed but no cookie header was captured.")

    await _cache_xhs_cookie_record(
        redis=redis,
        cookie_header=cookie_header.strip(),
        cookies=result.get("cookies") if isinstance(result.get("cookies"), dict) else None,
        updated_at=result.get("updated_at") if isinstance(result.get("updated_at"), str) else None,
    )

    record = await _load_cached_xhs_cookie_record(redis)
    return XHSPlaywrightSyncResponse(
        success=True,
        has_cookie=record is not None,
        updated_at=record.get("updated_at") if record else None,
        message="Playwright login synced. You can retry ingest now.",
    )


@router.get("/accounts", response_model=list[XHSMonitoredAccount])
async def list_accounts(db: AsyncSession = Depends(get_db_session)) -> list[XHSMonitoredAccount]:
    return await list_accounts_db(db)


@router.get("/accounts/{account_id}/notes", response_model=list[XHSNoteSummary])
async def list_account_notes(
    account_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> list[XHSNoteSummary]:
    account = await load_account_db(db, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return await list_notes_db(db, account_id)


@router.post("/accounts/refresh", response_model=XHSAccountsRefreshResponse)
async def refresh_accounts(
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
    parser: XHSNoteParser = Depends(get_parser),
) -> XHSAccountsRefreshResponse:
    accounts = await list_accounts_db(db)
    results: list[XHSAccountRefreshResult] = []
    refreshed_accounts = 0
    total_posts = 0

    for account in accounts:
        try:
            refreshed_posts = await _refresh_cached_account(
                redis=redis,
                db=db,
                parser=parser,
                account=account,
            )
            refreshed_accounts += 1
            total_posts += refreshed_posts
            results.append(
                XHSAccountRefreshResult(
                    account_id=account.id,
                    success=True,
                    refreshed_posts=refreshed_posts,
                )
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Failed to refresh account %s: %s", account.id, exc)
            results.append(
                XHSAccountRefreshResult(
                    account_id=account.id,
                    success=False,
                    refreshed_posts=0,
                    error=_resolve_error_message(exc),
                )
            )

    return XHSAccountsRefreshResponse(
        total_accounts=len(accounts),
        refreshed_accounts=refreshed_accounts,
        failed_accounts=max(0, len(accounts) - refreshed_accounts),
        total_posts=total_posts,
        results=results,
    )


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    account_id: str,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    account = await load_account_db(db, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    await delete_account_record(db, account_id)


@router.post("/notes/ingest", response_model=NoteIngestResponse)
async def ingest_note(
    payload: NoteIngestRequest,
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db_session),
    parser: XHSNoteParser = Depends(get_parser),
):
    source_url = str(payload.url) if payload.url else None
    if source_url and _is_xhs_profile_url(source_url):
        source_url = await _ensure_xhs_token_for_ingest(redis, source_url)

    try:
        parsed = await parser.parse(url=source_url, payload=payload.payload.model_dump() if payload.payload else None)
    except Exception as exc:  # pylint: disable=broad-except
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    # For profile URL ingest, always bind account identity to the parsed author id.
    # This prevents accidental overwrite of the currently selected sidebar account.
    if source_url and _is_xhs_profile_url(source_url) and parsed.note.author_id:
        account_id = parsed.note.author_id
    else:
        account_id = payload.account_id or parsed.note.author_id
    if not account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to determine account identifier")

    pulse_engine = PulseEngine(redis=redis, benchmarks=PulseBenchmarks(redis))
    pulse_dict = await pulse_engine.calculate(parsed.note)
    pulse = PulseScore.model_validate(pulse_dict)

    recent_notes = _extract_recent_note_items(parsed)
    post_increment = len(recent_notes) if recent_notes else 1
    author_name, xhs_id, profile_url = _extract_author_profile(parsed, source_url)
    account = await _upsert_account(
        db,
        account_id,
        author_name,
        xhs_id,
        profile_url,
        post_increment=post_increment,
    )

    if recent_notes:
        note_summaries = _build_note_summaries_from_recent_notes(
            recent_notes=recent_notes,
            account_id=account.id,
            source_url=source_url,
            default_keywords=parsed.seo_keywords,
        )
    else:
        note_summaries = [_build_note_summary(parsed, pulse, account.id, source_url)]

    if recent_notes:
        await replace_account_notes(db, account.id, note_summaries)
    else:
        for note_summary in note_summaries:
            await upsert_note(db, note_summary)

    cache_key = _parsed_cache_key(parsed.note.note_id)
    await redis.setex(cache_key, 900, parsed.model_dump_json())
    synced_account = await sync_account_post_count(db, account.id)
    if synced_account:
        account = synced_account

    agent_task_id = None
    if pulse.is_high_priority:
        try:
            agent = await get_agent_executor()
            agent_task_id = await trigger_agent_response(
                redis=redis,
                agent=agent,
                parsed=parsed,
                pulse=pulse,
                account_id=account.id,
            )
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning("Skip agent response because agent executor is unavailable: %s", exc)

    return NoteIngestResponse(
        parsed=parsed,
        pulse=pulse,
        cached_key=cache_key,
        agent_task_id=agent_task_id,
        account=account,
        post=note_summaries[0],
    )


async def trigger_agent_response(redis: Redis, agent, parsed: ParsedNote, pulse: PulseScore, account_id: str) -> str:
    fast_context = {
        "note_id": parsed.note.note_id,
        "hook": parsed.content.hook_title,
        "seo": parsed.seo_keywords,
        "pulse": pulse.model_dump(),
    }
    state = {
        "account_id": account_id,
        "platform": "xiaohongshu",
        "alert_payload": fast_context,
        "messages": [],
    }
    result = await agent.ainvoke(state)
    task_id = result.get("task_id") or parsed.note.note_id
    await redis.setex(f"xhs:agent:{task_id}", 900, json.dumps(result, default=str))
    return task_id


async def _upsert_account(
    db: AsyncSession,
    account_id: str,
    name: str | None,
    xhs_id: str | None,
    profile_url: str | None,
    post_increment: int = 1,
) -> XHSMonitoredAccount:
    existing = await load_account_db(db, account_id)
    resolved_xhs_id = xhs_id or (existing.xhs_id if existing else account_id)
    resolved_name = name or (existing.name if existing else f"Creator {resolved_xhs_id[-4:]}")
    resolved_profile = profile_url or (existing.profile_url if existing else _build_profile_url(account_id))
    avatar = existing.avatar if existing else _derive_avatar(resolved_name, resolved_xhs_id)
    post_count = (existing.post_count if existing else 0) + max(0, post_increment)

    return await upsert_account_record(
        db=db,
        account_id=account_id,
        name=resolved_name,
        xhs_id=resolved_xhs_id,
        profile_url=resolved_profile,
        avatar=avatar,
        post_count=post_count,
    )


async def _refresh_cached_account(
    redis: Redis,
    db: AsyncSession,
    parser: XHSNoteParser,
    account: XHSMonitoredAccount,
) -> int:
    source_url = str(account.profile_url) if account.profile_url else _build_profile_url(account.id or account.xhs_id)
    if not source_url:
        raise ValueError("Missing profile URL for account refresh.")

    if _is_xhs_profile_url(source_url):
        source_url = await _ensure_xhs_token_for_ingest(redis, source_url)

    parsed = await parser.parse(url=source_url, payload=None)

    pulse_engine = PulseEngine(redis=redis, benchmarks=PulseBenchmarks(redis))
    pulse_dict = await pulse_engine.calculate(parsed.note)
    pulse = PulseScore.model_validate(pulse_dict)

    recent_notes = _extract_recent_note_items(parsed)
    author_name, xhs_id, profile_url = _extract_author_profile(parsed, source_url)
    refreshed_account = await _upsert_account(
        db=db,
        account_id=account.id,
        name=author_name or account.name,
        xhs_id=xhs_id or account.xhs_id,
        profile_url=profile_url or source_url,
        post_increment=0,
    )

    if recent_notes:
        note_summaries = _build_note_summaries_from_recent_notes(
            recent_notes=recent_notes,
            account_id=refreshed_account.id,
            source_url=source_url,
            default_keywords=parsed.seo_keywords,
        )
    else:
        note_summaries = [_build_note_summary(parsed, pulse, refreshed_account.id, source_url)]

    if recent_notes:
        await replace_account_notes(db, refreshed_account.id, note_summaries)
    else:
        for note_summary in note_summaries:
            await upsert_note(db, note_summary)

    await redis.setex(_parsed_cache_key(parsed.note.note_id), 900, parsed.model_dump_json())
    await sync_account_post_count(db, refreshed_account.id)
    return len(note_summaries)


def _extract_author_profile(parsed: ParsedNote, source_url: str | None) -> tuple[str | None, str | None, str | None]:
    extra: dict[str, Any] = parsed.note.extra or {}
    name_candidates = ["author_name", "nickname", "user_name", "name"]
    display_id_candidates = ["author_red_id", "author_custom_id", "red_id", "xhs_red_id", "xhs_id"]
    profile_id_candidates = ["author_user_id", "author_id", "user_id", "xhs_user_id", "xhs_id"]
    source_profile_id = _parse_profile_identifier(source_url) if source_url else None

    def _search(obj: dict[str, Any], keys: list[str]) -> str | None:
        for key in keys:
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    name = _search(extra, name_candidates)
    author_block = extra.get("author")
    if isinstance(author_block, dict) and not name:
        name = _search(author_block, name_candidates)

    display_id = _search(extra, display_id_candidates)
    if isinstance(author_block, dict) and not display_id:
        display_id = _search(author_block, ["red_id", "custom_id", "display_id", "xhs_id"])

    profile_identifier = source_profile_id or _search(extra, profile_id_candidates)
    if isinstance(author_block, dict) and not profile_identifier:
        profile_identifier = _search(author_block, ["user_id", "id", "xhs_user_id"])
    profile_identifier = profile_identifier or parsed.note.author_id

    xhs_id = display_id or profile_identifier
    profile_url = _build_profile_url(profile_identifier)
    return name, xhs_id, profile_url


def _extract_recent_note_items(parsed: ParsedNote) -> list[dict[str, Any]]:
    extra: dict[str, Any] = parsed.note.extra or {}
    raw_items = extra.get("recent_notes")
    if not isinstance(raw_items, list):
        return []

    notes: list[dict[str, Any]] = []
    for item in raw_items[:10]:
        if not isinstance(item, dict):
            continue
        notes.append(item)
    return notes


def _build_note_summaries_from_recent_notes(
    recent_notes: list[dict[str, Any]],
    account_id: str,
    source_url: str | None,
    default_keywords: list[str],
) -> list[XHSNoteSummary]:
    summaries: list[XHSNoteSummary] = []
    for idx, item in enumerate(recent_notes[:10]):
        fallback_seed = "|".join(
            [
                account_id,
                _as_non_empty_str(item.get("title")),
                _as_non_empty_str(item.get("url")),
                _as_non_empty_str(item.get("published_at")),
                str(idx),
            ]
        )
        note_id = _as_non_empty_str(item.get("id")) or _stable_hash_id("profile_recent", fallback_seed)
        title = _as_non_empty_str(item.get("title")) or f"XHS Note {idx + 1}"
        content = _as_non_empty_str(item.get("content")) or title
        likes = _as_non_negative_int(item.get("likes"))
        shares = _as_non_negative_int(item.get("shares"))
        comments = _as_non_negative_int(item.get("comments"))
        collects = _as_non_negative_int(item.get("collects"))
        views = max(1, _as_non_negative_int(item.get("views"), fallback=max(1, likes * 8)))
        published_at = _parse_datetime(item.get("published_at"))

        interaction = likes + shares + comments + collects
        growth_rate = max(0.01, min((interaction / max(views, 1)) * 1.8, 0.65))
        status = _classify_status_by_growth(growth_rate)
        url = _as_non_empty_str(item.get("url")) or source_url or f"https://www.xiaohongshu.com/explore/{note_id}"

        raw_keywords = item.get("seo_keywords")
        keywords = (
            [str(keyword).strip() for keyword in raw_keywords if str(keyword).strip()]
            if isinstance(raw_keywords, list)
            else default_keywords
        )

        summaries.append(
            XHSNoteSummary(
                id=note_id,
                account_id=account_id,
                url=url,
                title=title,
                content=content,
                likes=likes,
                shares=shares,
                comments=comments,
                collects=collects,
                views=views,
                growth_rate=round(growth_rate, 4),
                status=status,
                timestamp=published_at,
                history=_synthesize_history(likes),
                seo_keywords=keywords,
            )
        )
    return summaries or [
        XHSNoteSummary(
            id=_stable_hash_id("profile_recent", account_id),
            account_id=account_id,
            url=source_url,
            title="XHS Profile Snapshot",
            content="Unable to parse recent note list from profile.",
            likes=0,
            shares=0,
            comments=0,
            collects=0,
            views=1,
            growth_rate=0.01,
            status="low",
            timestamp=datetime.utcnow(),
            history=_synthesize_history(0),
            seo_keywords=default_keywords,
        )
    ]


def _build_note_summary(
    parsed: ParsedNote,
    pulse: PulseScore,
    account_id: str,
    source_url: str | None,
) -> XHSNoteSummary:
    note = parsed.note
    likes = note.metrics.likes
    growth_rate = _derive_growth_rate(pulse)
    status = _classify_status(growth_rate, pulse)
    url = source_url or f"https://www.xiaohongshu.com/explore/{note.note_id}"

    return XHSNoteSummary(
        id=note.note_id,
        account_id=account_id,
        url=url,
        title=note.title or parsed.content.hook_title or "XHS Note",
        content=note.content or note.title,
        likes=likes,
        shares=note.metrics.shares,
        comments=note.metrics.comments,
        collects=note.metrics.collects,
        views=note.metrics.views,
        growth_rate=round(growth_rate, 4),
        status=status,
        timestamp=note.published_at or datetime.utcnow(),
        history=_synthesize_history(likes),
        seo_keywords=parsed.seo_keywords,
    )


def _derive_growth_rate(pulse: PulseScore) -> float:
    base = pulse.interaction_view_ratio
    adjusted = base * 1.8
    return max(0.01, min(adjusted, 0.65))


def _classify_status(growth_rate: float, pulse: PulseScore) -> str:
    if pulse.is_high_priority or growth_rate >= 0.35:
        return "viral"
    if growth_rate >= 0.15:
        return "normal"
    return "low"


def _classify_status_by_growth(growth_rate: float) -> str:
    if growth_rate >= 0.35:
        return "viral"
    if growth_rate >= 0.15:
        return "normal"
    return "low"


def _synthesize_history(likes: int) -> list[int]:
    total = max(likes, 50)
    history: list[int] = []
    for idx in range(1, 8):
        value = max(5, int(total * (idx / 7.0)))
        history.append(value)
    return history


def _as_non_empty_str(value: Any) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return ""


def _as_non_negative_int(value: Any, fallback: int = 0) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    if isinstance(value, str):
        text = value.strip().lower().replace(",", "").replace("+", "")
        if not text:
            return fallback
        multiplier = 1
        if text.endswith("w") or text.endswith("万"):
            multiplier = 10_000
            text = text[:-1]
        elif text.endswith("k") or text.endswith("千"):
            multiplier = 1_000
            text = text[:-1]
        try:
            return max(int(float(text) * multiplier), 0)
        except ValueError:
            digits = "".join(ch for ch in text if ch.isdigit())
            if digits:
                return int(digits)
    return max(fallback, 0)


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        normalized = value.strip()
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return datetime.utcnow()
    return datetime.utcnow()


def _derive_avatar(name: str | None, xhs_id: str | None) -> str:
    token = (name or "").strip()
    if token:
        return token[0].upper()
    if xhs_id:
        return xhs_id[0].upper()
    return "X"


def _build_profile_url(xhs_id: str | None) -> str | None:
    if not xhs_id:
        return None
    return f"https://www.xiaohongshu.com/user/profile/{xhs_id}"


def _parse_profile_identifier(url: str) -> str | None:
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) >= 3 and parts[0] == "user" and parts[1] == "profile":
        return parts[2]
    if len(parts) >= 2 and parts[0] == "profile":
        return parts[1]
    return None

def _parsed_cache_key(note_id: str) -> str:
    return f"{PARSED_CACHE_PREFIX}:{note_id}"


def _is_xhs_profile_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    return "xiaohongshu.com" in hostname


async def _ensure_xhs_token_for_ingest(redis: Redis, source_url: str) -> str:
    tokens = _extract_xhs_url_token(source_url)
    if tokens:
        await _cache_xhs_token(redis, tokens)
        return _inject_token_to_url(source_url, tokens)

    cached = await _load_cached_xhs_token(redis)
    if cached:
        return _inject_token_to_url(source_url, cached)

    cached_cookie_header = await _load_cached_xhs_cookie_header(redis)
    if cached_cookie_header:
        return source_url

    if _is_strict_xhs_auth_enabled():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_build_xhs_auth_required_detail().model_dump(),
        )
    return source_url


def _resolve_xhs_login_url() -> str:
    configured = os.getenv("XHS_LOGIN_URL", "").strip()
    return configured or DEFAULT_XHS_LOGIN_URL


def _can_sync_xhs_auth_with_playwright() -> bool:
    if shutil.which("node") is None:
        return False
    return _resolve_playwright_login_script_path().exists()


def _is_strict_xhs_auth_enabled() -> bool:
    return os.getenv("XHS_STRICT_AUTH", "").strip().lower() in {"1", "true", "yes", "on"}


def _build_xhs_auth_required_detail(next_action: XHSNextAction | None = None) -> XHSAuthErrorDetail:
    # Keep one source of truth for auth-required payload to stabilize frontend handling.
    resolved_next_action = next_action or resolve_xhs_next_action(
        can_ingest=False,
        sync_available=_can_sync_xhs_auth_with_playwright(),
    )

    if resolved_next_action == "login":
        message = XHS_AUTH_LOGIN_REQUIRED_MESSAGE
    elif resolved_next_action == "sync":
        message = XHS_AUTH_SYNC_REQUIRED_MESSAGE
    else:
        message = XHS_AUTH_REQUIRED_MESSAGE

    return XHSAuthErrorDetail(message=message, login_url=_resolve_xhs_login_url())


def _extract_xhs_url_token(url: str) -> dict[str, str] | None:
    try:
        parsed = urlparse(url)
    except ValueError:
        return None

    params = parse_qs(parsed.query)
    xsec_token = params.get("xsec_token", [""])[0].strip()
    if not xsec_token:
        return None

    xsec_source = params.get("xsec_source", [""])[0].strip() or "pc_feed"
    return {"xsec_token": xsec_token, "xsec_source": xsec_source}


def _inject_token_to_url(url: str, tokens: dict[str, str]) -> str:
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    params.setdefault("xsec_token", [tokens["xsec_token"]])
    params.setdefault("xsec_source", [tokens.get("xsec_source", "pc_feed")])
    query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=query))


async def _cache_xhs_token(redis: Redis, tokens: dict[str, str]) -> None:
    await redis.setex(
        XHS_AUTH_TOKEN_KEY,
        24 * 3600,
        json.dumps(
            {
                "xsec_token": tokens["xsec_token"],
                "xsec_source": tokens.get("xsec_source", "pc_feed"),
                "updated_at": datetime.utcnow().isoformat(),
            }
        ),
    )


async def _load_cached_xhs_token(redis: Redis) -> dict[str, str] | None:
    record = await _load_cached_xhs_token_record(redis)
    if not record:
        return None
    token = record.get("xsec_token")
    source = record.get("xsec_source")
    if not isinstance(token, str) or not isinstance(source, str):
        return None
    return {
        "xsec_token": token,
        "xsec_source": source,
    }


async def _load_cached_xhs_token_record(redis: Redis) -> dict[str, str | None] | None:
    raw = await redis.get(XHS_AUTH_TOKEN_KEY)
    if not raw:
        return None

    try:
        decoded = raw.decode() if isinstance(raw, bytes) else str(raw)
        data = json.loads(decoded)
    except (ValueError, TypeError, UnicodeDecodeError):
        return None

    token = data.get("xsec_token")
    source = data.get("xsec_source")
    if not isinstance(token, str) or not token.strip():
        return None

    normalized_source = source.strip() if isinstance(source, str) and source.strip() else "pc_feed"
    updated_at = data.get("updated_at")
    normalized_updated_at = updated_at.strip() if isinstance(updated_at, str) and updated_at.strip() else None
    return {
        "xsec_token": token.strip(),
        "xsec_source": normalized_source,
        "updated_at": normalized_updated_at,
    }


async def _cache_xhs_cookie_record(
    redis: Redis,
    cookie_header: str,
    cookies: dict[str, str] | None = None,
    updated_at: str | None = None,
) -> None:
    normalized_cookies: dict[str, str] = {}
    if isinstance(cookies, dict):
        for key, value in cookies.items():
            if isinstance(key, str) and isinstance(value, str) and key.strip() and value.strip():
                normalized_cookies[key.strip()] = value.strip()

    await redis.setex(
        XHS_AUTH_COOKIE_KEY,
        XHS_AUTH_COOKIE_TTL_SECONDS,
        json.dumps(
            {
                "cookie_header": cookie_header.strip(),
                "cookies": normalized_cookies,
                "updated_at": updated_at.strip() if isinstance(updated_at, str) and updated_at.strip() else datetime.utcnow().isoformat(),
            }
        ),
    )


async def _load_cached_xhs_cookie_record(redis: Redis) -> dict[str, Any] | None:
    raw = await redis.get(XHS_AUTH_COOKIE_KEY)
    if not raw:
        return None

    try:
        decoded = raw.decode() if isinstance(raw, bytes) else str(raw)
        data = json.loads(decoded)
    except (ValueError, TypeError, UnicodeDecodeError):
        return None

    header = data.get("cookie_header")
    if not isinstance(header, str) or not header.strip():
        return None

    cookies_block = data.get("cookies")
    normalized_cookies: dict[str, str] = {}
    if isinstance(cookies_block, dict):
        for key, value in cookies_block.items():
            if isinstance(key, str) and isinstance(value, str) and key.strip() and value.strip():
                normalized_cookies[key.strip()] = value.strip()

    updated_at = data.get("updated_at")
    normalized_updated_at = updated_at.strip() if isinstance(updated_at, str) and updated_at.strip() else None
    return {
        "cookie_header": header.strip(),
        "cookies": normalized_cookies,
        "updated_at": normalized_updated_at,
    }


async def _load_cached_xhs_cookie_header(redis: Redis) -> str | None:
    record = await _load_cached_xhs_cookie_record(redis)
    if not record:
        return None
    header = record.get("cookie_header")
    if isinstance(header, str) and header.strip():
        return header.strip()
    return None


def _resolve_playwright_login_script_path() -> Path:
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / "scripts" / "xhs_playwright_login_sync.cjs"


async def _run_playwright_login_sync(timeout_seconds: int) -> dict[str, Any]:
    script_path = _resolve_playwright_login_script_path()
    if not script_path.exists():
        raise RuntimeError(f"Playwright login script not found: {script_path}")

    try:
        process = await asyncio.create_subprocess_exec(
            "node",
            str(script_path),
            str(timeout_seconds),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Node.js is not installed or not found in PATH.") from exc

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout_seconds + 30)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise RuntimeError("Playwright login sync timed out. Please retry and scan QR code earlier.") from exc

    out_text = stdout.decode("utf-8", errors="ignore")
    err_text = stderr.decode("utf-8", errors="ignore")

    if process.returncode != 0:
        message = err_text.strip() or out_text.strip() or f"Playwright login process exited with code {process.returncode}."
        raise RuntimeError(message)

    for line in out_text.splitlines():
        if line.startswith(XHS_PLAYWRIGHT_RESULT_PREFIX):
            payload = line[len(XHS_PLAYWRIGHT_RESULT_PREFIX):].strip()
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise RuntimeError("Playwright login output is invalid JSON.") from exc
            if isinstance(parsed, dict):
                return parsed
            raise RuntimeError("Playwright login output has invalid payload format.")

    raise RuntimeError("Playwright login sync completed but no result payload was returned.")


async def _load_xhs_token_ttl(redis: Redis) -> int | None:
    ttl = await redis.ttl(XHS_AUTH_TOKEN_KEY)
    if not isinstance(ttl, int):
        return None
    if ttl < 0:
        return None
    return ttl


def _resolve_error_message(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            message = detail.get("message") or detail.get("detail")
            if isinstance(message, str) and message.strip():
                return message.strip()
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        return f"HTTP {exc.status_code}"
    message = str(exc).strip()
    return message or exc.__class__.__name__


def _stable_hash_id(prefix: str, seed: str, length: int = 24) -> str:
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:length]
    return f"{prefix}_{digest}"
