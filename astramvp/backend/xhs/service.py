from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis

from ..deps import get_redis, get_agent_executor
from .auth_contracts import XHSAuthErrorDetail, XHSAuthStatusResponse
from .parser import ProxyRotator, ProxyProfile, XHSHttpClient, XHSNoteParser, PulseBenchmarks, PulseEngine
from .schemas import (
    NoteIngestRequest,
    NoteIngestResponse,
    ParsedNote,
    PulseScore,
    XHSMonitoredAccount,
    XHSNoteSummary,
)

router = APIRouter(prefix="/xhs", tags=["xiaohongshu"])
logger = logging.getLogger(__name__)

ACCOUNT_HASH_KEY = "xhs:accounts"
ACCOUNT_NOTES_PREFIX = "xhs:account_notes"
NOTE_CACHE_PREFIX = "xhs:note"
XHS_AUTH_TOKEN_KEY = "xhs:auth:token"
DEFAULT_XHS_LOGIN_URL = "https://www.xiaohongshu.com"
XHS_AUTH_REQUIRED_MESSAGE = "未检测到可用的小红书 xsec_token，请先登录小红书后重试。"


async def get_parser() -> XHSNoteParser:
    http_proxy = os.getenv("XHS_HTTP_PROXY", "").strip()
    https_proxy = os.getenv("XHS_HTTPS_PROXY", "").strip()
    proxies = [
        ProxyProfile(
            http=http_proxy,
            https=https_proxy or http_proxy,
            provider="env_proxy" if (http_proxy or https_proxy) else "direct",
        ),
    ]
    rotator = ProxyRotator(proxies=proxies)
    client = XHSHttpClient(proxy_rotator=rotator)
    return XHSNoteParser(http_client=client)


@router.get("/auth/status", response_model=XHSAuthStatusResponse)
async def get_auth_status(redis: Redis = Depends(get_redis)) -> XHSAuthStatusResponse:
    # Keep this endpoint lightweight so frontend can decide whether to show login jump before ingest.
    cached = await _load_cached_xhs_token_record(redis)
    has_token = cached is not None
    ttl_seconds = await _load_xhs_token_ttl(redis) if has_token else None
    auth_error = None if has_token else _build_xhs_auth_required_detail()

    return XHSAuthStatusResponse(
        has_token=has_token,
        login_url=_resolve_xhs_login_url(),
        xsec_source=cached.get("xsec_source") if cached else None,
        updated_at=cached.get("updated_at") if cached else None,
        ttl_seconds=ttl_seconds,
        auth_error=auth_error,
    )


@router.get("/accounts", response_model=list[XHSMonitoredAccount])
async def list_accounts(redis: Redis = Depends(get_redis)) -> list[XHSMonitoredAccount]:
    raw_accounts = await redis.hgetall(ACCOUNT_HASH_KEY)
    accounts: list[XHSMonitoredAccount] = []
    for value in raw_accounts.values():
        try:
            accounts.append(XHSMonitoredAccount.model_validate_json(value))
        except Exception:  # pylint: disable=broad-except
            continue
    accounts.sort(key=lambda acc: acc.name.lower())
    return accounts


@router.get("/accounts/{account_id}/notes", response_model=list[XHSNoteSummary])
async def list_account_notes(account_id: str, redis: Redis = Depends(get_redis)) -> list[XHSNoteSummary]:
    account = await _load_account(redis, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return await _load_notes(redis, account_id)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(account_id: str, redis: Redis = Depends(get_redis)) -> None:
    account = await _load_account(redis, account_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    await _delete_account(redis, account_id)


@router.post("/notes/ingest", response_model=NoteIngestResponse)
async def ingest_note(
    payload: NoteIngestRequest,
    redis: Redis = Depends(get_redis),
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
        redis,
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

    for note_summary in note_summaries:
        await _persist_note(redis, note_summary)

    cache_key = _note_cache_key(parsed.note.note_id)
    await redis.setex(cache_key, 900, parsed.model_dump_json())

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
    redis: Redis,
    account_id: str,
    name: str | None,
    xhs_id: str | None,
    profile_url: str | None,
    post_increment: int = 1,
) -> XHSMonitoredAccount:
    existing = await _load_account(redis, account_id)
    resolved_xhs_id = xhs_id or (existing.xhs_id if existing else account_id)
    resolved_name = name or (existing.name if existing else f"Creator {resolved_xhs_id[-4:]}")
    resolved_profile = profile_url or (existing.profile_url if existing else _build_profile_url(resolved_xhs_id))
    avatar = existing.avatar if existing else _derive_avatar(resolved_name, resolved_xhs_id)
    post_count = (existing.post_count if existing else 0) + max(1, post_increment)

    account = XHSMonitoredAccount(
        id=account_id,
        name=resolved_name,
        xhs_id=resolved_xhs_id,
        avatar=avatar,
        post_count=post_count,
        profile_url=resolved_profile,
    )
    await redis.hset(ACCOUNT_HASH_KEY, account_id, account.model_dump_json())
    return account


async def _load_account(redis: Redis, account_id: str) -> XHSMonitoredAccount | None:
    raw = await redis.hget(ACCOUNT_HASH_KEY, account_id)
    if not raw:
        return None
    try:
        return XHSMonitoredAccount.model_validate_json(raw)
    except Exception:  # pylint: disable=broad-except
        return None


async def _persist_note(redis: Redis, note: XHSNoteSummary) -> None:
    note_key = _note_cache_key(note.id)
    notes_key = _account_notes_key(note.account_id)
    await redis.set(note_key, note.model_dump_json())
    await redis.lrem(notes_key, 0, note.id)
    await redis.lpush(notes_key, note.id)
    await redis.ltrim(notes_key, 0, 49)


async def _load_notes(redis: Redis, account_id: str) -> list[XHSNoteSummary]:
    note_ids = await redis.lrange(_account_notes_key(account_id), 0, 49)
    notes: list[XHSNoteSummary] = []
    for raw_id in note_ids:
        note_key = _note_cache_key(raw_id.decode())
        raw_note = await redis.get(note_key)
        if not raw_note:
            continue
        try:
            notes.append(XHSNoteSummary.model_validate_json(raw_note))
        except Exception:  # pylint: disable=broad-except
            continue
    notes.sort(key=lambda item: item.timestamp, reverse=True)
    return notes


async def _delete_account(redis: Redis, account_id: str) -> None:
    note_ids = await redis.lrange(_account_notes_key(account_id), 0, -1)
    if note_ids:
        delete_keys = [_note_cache_key(raw.decode()) for raw in note_ids]
        await redis.delete(*delete_keys)
    await redis.delete(_account_notes_key(account_id))
    await redis.hdel(ACCOUNT_HASH_KEY, account_id)


def _extract_author_profile(parsed: ParsedNote, source_url: str | None) -> tuple[str | None, str | None, str | None]:
    extra: dict[str, Any] = parsed.note.extra or {}
    name_candidates = ["author_name", "nickname", "user_name", "name"]
    id_candidates = ["author_custom_id", "author_id", "user_id", "xhs_id"]
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

    xhs_id = source_profile_id or _search(extra, id_candidates)
    if isinstance(author_block, dict) and not xhs_id:
        xhs_id = _search(author_block, ["custom_id", "user_id", "id"])

    profile_url = _build_profile_url(xhs_id or parsed.note.author_id)
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
        note_id = _as_non_empty_str(item.get("id")) or f"profile_recent_{abs(hash(f'{account_id}:{idx}'))}"
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
            id=f"profile_recent_{abs(hash(account_id))}",
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


def _note_cache_key(note_id: str) -> str:
    return f"{NOTE_CACHE_PREFIX}:{note_id}"


def _account_notes_key(account_id: str) -> str:
    return f"{ACCOUNT_NOTES_PREFIX}:{account_id}"


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

    if _is_strict_xhs_auth_enabled():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_build_xhs_auth_required_detail().model_dump(),
        )
    return source_url


def _resolve_xhs_login_url() -> str:
    configured = os.getenv("XHS_LOGIN_URL", "").strip()
    return configured or DEFAULT_XHS_LOGIN_URL


def _is_strict_xhs_auth_enabled() -> bool:
    return os.getenv("XHS_STRICT_AUTH", "").strip().lower() in {"1", "true", "yes", "on"}


def _build_xhs_auth_required_detail() -> XHSAuthErrorDetail:
    # Keep one source of truth for auth-required payload to stabilize frontend handling.
    return XHSAuthErrorDetail(message=XHS_AUTH_REQUIRED_MESSAGE, login_url=_resolve_xhs_login_url())


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


async def _load_xhs_token_ttl(redis: Redis) -> int | None:
    ttl = await redis.ttl(XHS_AUTH_TOKEN_KEY)
    if not isinstance(ttl, int):
        return None
    if ttl < 0:
        return None
    return ttl
