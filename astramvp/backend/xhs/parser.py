from __future__ import annotations

import asyncio
import hashlib
import json
import random
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from io import BytesIO
from typing import Iterable, Sequence

import httpx
from PIL import Image
import imagehash
import pytesseract
from redis.asyncio import Redis

from .schemas import (
    ParsedNote,
    XHSSEResponse,
    XHSVisualElement,
    XHSContentSections,
    XHSEngagementMetrics,
)


class AntiScrapeError(RuntimeError):
    pass


@dataclass
class ProxyProfile:
    http: str
    https: str
    provider: str


class ProxyRotator:
    def __init__(self, proxies: Sequence[ProxyProfile]):
        if not proxies:
            raise ValueError("At least one proxy profile required.")
        self._proxies = proxies
        self._cursor = 0

    def current(self) -> ProxyProfile:
        return self._proxies[self._cursor]

    def rotate(self) -> ProxyProfile:
        self._cursor = (self._cursor + 1) % len(self._proxies)
        return self.current()


class XHSHttpClient:
    def __init__(self, proxy_rotator: ProxyRotator, base_headers: dict | None = None):
        self.proxy_rotator = proxy_rotator
        self.base_headers = base_headers or {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }

    async def fetch(self, url: str) -> dict:
        retries = 3
        for attempt in range(retries):
            proxy = self.proxy_rotator.current()
            await asyncio.sleep(random.uniform(0.85, 1.85))
            try:
                proxy_url = proxy.https or proxy.http
                async with httpx.AsyncClient(
                    proxy=(proxy_url.strip() if isinstance(proxy_url, str) and proxy_url.strip() else None),
                    headers=self.base_headers,
                    timeout=10,
                ) as client:
                    resp = await client.get(url)
                    if resp.status_code == 429:
                        self.proxy_rotator.rotate()
                        raise AntiScrapeError("Rate limited")
                    if resp.status_code >= 500:
                        resp.raise_for_status()

                    content_type = (resp.headers.get("content-type") or "").lower()
                    if resp.status_code >= 400:
                        if "text/html" in content_type or "<!doctype html" in resp.text[:256].lower():
                            return self._build_fallback_payload(url=url, html=resp.text)
                        resp.raise_for_status()

                    content_type = (resp.headers.get("content-type") or "").lower()
                    if "application/json" in content_type:
                        data = resp.json()
                        if not data:
                            raise ValueError("Empty response from XHS")
                        return data
                    return self._build_fallback_payload(url=url, html=resp.text)
            except (httpx.HTTPError, AntiScrapeError):
                await asyncio.sleep(1.5 * (attempt + 1))
                self.proxy_rotator.rotate()
                continue
        raise AntiScrapeError("Unable to bypass anti-scraping after retries")

    def _build_fallback_payload(self, url: str, html: str) -> dict:
        """Build a minimal payload from HTML so profile URLs remain ingestible."""
        now = datetime.utcnow()
        url_id = self._extract_profile_id(url) or f"xhs_{self._stable_suffix(url)}"
        recent_notes = self._extract_recent_notes_from_html(html=html, profile_url=url, user_id=url_id)
        primary = recent_notes[0] if recent_notes else None
        author_red_id = (
            primary.get("author_red_id")
            if primary and isinstance(primary.get("author_red_id"), str)
            else self._extract_profile_red_id(html)
        )

        title = (
            primary.get("title")
            if primary
            else (self._extract_title(html) or f"XHS Profile {url_id}")
        )
        description = (
            primary.get("content")
            if primary
            else (self._extract_description(html) or f"Profile snapshot for {url_id}")
        )
        author_name = (
            primary.get("author_name")
            if primary and isinstance(primary.get("author_name"), str)
            else (self._extract_profile_author_name(html) or self._extract_author_name(title))
        )
        likes = self._as_int(primary.get("likes"), default=0) if primary else 0
        collects = self._as_int(primary.get("collects"), default=0) if primary else 0
        comments = self._as_int(primary.get("comments"), default=0) if primary else 0
        shares = self._as_int(primary.get("shares"), default=0) if primary else 0
        views = self._as_int(primary.get("views"), default=1) if primary else 1
        published_at = (
            primary.get("published_at")
            if primary and isinstance(primary.get("published_at"), str)
            else now.isoformat()
        )
        note_id = (
            primary.get("id")
            if primary and isinstance(primary.get("id"), str) and primary.get("id").strip()
            else f"profile_{url_id}"
        )
        return {
            "note_id": note_id,
            "author_id": url_id,
            "category": "profile",
            "sub_category": "snapshot",
            "published_at": published_at,
            "media": [],
            "metrics": {
                "likes": likes,
                "collects": collects,
                "comments": comments,
                "shares": shares,
                "views": max(views, 1),
                "updated_at": now.isoformat(),
            },
            "title": title,
            "content": description,
            "hashtags": ["#profile", "#snapshot"],
            "extra": {
                "author_name": author_name,
                "author_custom_id": author_red_id or url_id,
                "author_red_id": author_red_id or None,
                "author_user_id": url_id,
                "profile_url": url,
                "ingest_mode": "profile_recent_notes" if recent_notes else "html_fallback",
                "recent_notes": recent_notes[:10],
            },
        }

    def _extract_recent_notes_from_html(self, html: str, profile_url: str, user_id: str) -> list[dict]:
        """
        Parse latest note cards from profile page initial state.
        Returns at most 10 note-like entries with interaction metrics.
        """
        state = self._extract_initial_state(html)
        if not state:
            return []

        notes_tab = (((state.get("user") or {}).get("notes") or [None])[0])  # first tab = latest posts
        if not isinstance(notes_tab, list):
            return []

        basic_info = (((state.get("user") or {}).get("userPageData") or {}).get("basicInfo")) or {}
        author_red_id = self._first_non_empty(
            basic_info.get("redId") if isinstance(basic_info, dict) else "",
            basic_info.get("red_id") if isinstance(basic_info, dict) else "",
        )
        author_page_name = self._first_non_empty(
            basic_info.get("nickName") if isinstance(basic_info, dict) else "",
            basic_info.get("nickname") if isinstance(basic_info, dict) else "",
            basic_info.get("name") if isinstance(basic_info, dict) else "",
        )

        result: list[dict] = []
        for idx, item in enumerate(notes_tab[:10]):
            if not isinstance(item, dict):
                continue
            card = item.get("noteCard")
            if not isinstance(card, dict):
                continue

            interact = card.get("interactInfo") if isinstance(card.get("interactInfo"), dict) else {}
            user = card.get("user") if isinstance(card.get("user"), dict) else {}
            title = (card.get("displayTitle") or "").strip() if isinstance(card.get("displayTitle"), str) else ""
            if not title:
                title = f"XHS Note {idx + 1}"

            likes = self._parse_count(interact.get("likedCount"))
            comments = self._parse_count(interact.get("commentCount") or interact.get("commentNum"))
            shares = self._parse_count(interact.get("shareCount") or interact.get("sharedCount"))
            collects = self._parse_count(interact.get("collectedCount") or interact.get("collectCount"))
            views = self._parse_count(interact.get("viewCount") or interact.get("viewNum"))
            if views <= 0:
                views = max(1, likes * 8)

            note_id = self._resolve_note_id(item=item, card=card, user_id=user_id, index=idx)
            xsec_token = self._first_non_empty(
                card.get("xsecToken"),
                item.get("xsecToken"),
            )
            note_url = self._build_note_url(note_id=note_id, xsec_token=xsec_token, fallback_profile=profile_url, index=idx)
            author_name = self._first_non_empty(
                user.get("nickName"),
                user.get("nickname"),
                author_page_name,
                self._extract_author_name(title),
            )
            author_user_id = self._first_non_empty(
                user.get("userId"),
                user.get("user_id"),
                user_id,
            )
            published_at = (datetime.utcnow() - timedelta(hours=idx)).isoformat()

            result.append(
                {
                    "id": note_id,
                    "title": title,
                    "content": title,
                    "likes": likes,
                    "comments": comments,
                    "shares": shares,
                    "collects": collects,
                    "views": views,
                    "url": note_url,
                    "xsec_token": xsec_token,
                    "author_name": author_name,
                    "author_red_id": author_red_id,
                    "author_user_id": author_user_id,
                    "published_at": published_at,
                }
            )
        return result

    def _extract_initial_state(self, html: str) -> dict | None:
        marker = "window.__INITIAL_STATE__="
        start = html.find(marker)
        if start == -1:
            return None
        start += len(marker)
        raw = self._extract_js_object_literal(html, start)
        if not raw:
            return None

        # The payload is mostly JSON with `undefined` values; normalize for json parsing.
        normalized = re.sub(r"\bundefined\b", "null", raw)
        try:
            return json.loads(normalized)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _extract_js_object_literal(text: str, start_index: int) -> str | None:
        depth = 0
        in_string = False
        quote = ""
        escaped = False
        begin = None

        for idx in range(start_index, len(text)):
            ch = text[idx]
            if in_string:
                if escaped:
                    escaped = False
                    continue
                if ch == "\\":
                    escaped = True
                    continue
                if ch == quote:
                    in_string = False
                continue

            if ch in {'"', "'"}:
                in_string = True
                quote = ch
                continue
            if ch == "{":
                if begin is None:
                    begin = idx
                depth += 1
                continue
            if ch == "}":
                depth -= 1
                if depth == 0 and begin is not None:
                    return text[begin: idx + 1]
        return None

    def _resolve_note_id(self, item: dict, card: dict, user_id: str, index: int) -> str:
        raw_id = self._first_non_empty(card.get("noteId"), item.get("id"))
        if raw_id:
            return raw_id
        cover = card.get("cover") if isinstance(card.get("cover"), dict) else {}
        trace = self._first_non_empty(
            cover.get("traceId") if isinstance(cover, dict) else "",
            cover.get("fileId") if isinstance(cover, dict) else "",
            cover.get("urlPre") if isinstance(cover, dict) else "",
            cover.get("urlDefault") if isinstance(cover, dict) else "",
        )
        title = card.get("displayTitle") if isinstance(card.get("displayTitle"), str) else ""
        if title or trace:
            seed = f"{user_id}:{title}:{trace}"
        else:
            seed = f"{user_id}:{index}"
        digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:24]
        return f"profile_{digest}"

    def _build_note_url(self, note_id: str, xsec_token: str | None, fallback_profile: str, index: int) -> str:
        is_real_note_id = bool(re.fullmatch(r"[0-9a-f]{24}", note_id))
        if not is_real_note_id:
            return f"{fallback_profile}#note-{index + 1}"
        if xsec_token:
            return f"https://www.xiaohongshu.com/explore/{note_id}?xsec_token={xsec_token}&xsec_source=pc_profile"
        return f"https://www.xiaohongshu.com/explore/{note_id}"

    @staticmethod
    def _first_non_empty(*values: object) -> str:
        for value in values:
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def _parse_count(self, value: object) -> int:
        if isinstance(value, int):
            return max(value, 0)
        if isinstance(value, float):
            return max(int(value), 0)
        if not isinstance(value, str):
            return 0

        text = value.strip().lower().replace(",", "").replace("+", "")
        if not text:
            return 0
        multiplier = 1
        if text.endswith("w"):
            multiplier = 10_000
            text = text[:-1]
        elif text.endswith("万"):
            multiplier = 10_000
            text = text[:-1]
        elif text.endswith("k"):
            multiplier = 1_000
            text = text[:-1]
        elif text.endswith("千"):
            multiplier = 1_000
            text = text[:-1]

        try:
            return max(int(float(text) * multiplier), 0)
        except ValueError:
            digits = re.sub(r"[^\d]", "", text)
            return int(digits) if digits else 0

    @staticmethod
    def _as_int(value: object, default: int = 0) -> int:
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            digits = re.sub(r"[^\d]", "", value)
            if digits:
                return int(digits)
        return default

    @staticmethod
    def _extract_profile_id(url: str) -> str | None:
        match = re.search(r"/user/profile/([^/?]+)", url)
        if match:
            return match.group(1)
        return None

    @staticmethod
    def _extract_title(html: str) -> str | None:
        match = re.search(r"<title>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            return None
        title = re.sub(r"\s+", " ", match.group(1)).strip()
        return title or None

    @staticmethod
    def _extract_description(html: str) -> str | None:
        meta = re.search(
            r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
            html,
            flags=re.IGNORECASE,
        )
        if meta:
            text = re.sub(r"\s+", " ", meta.group(1)).strip()
            return text or None
        return None

    def _extract_profile_red_id(self, html: str) -> str:
        state = self._extract_initial_state(html)
        if not isinstance(state, dict):
            return ""
        basic_info = (((state.get("user") or {}).get("userPageData") or {}).get("basicInfo")) or {}
        if not isinstance(basic_info, dict):
            return ""
        return self._first_non_empty(
            basic_info.get("redId"),
            basic_info.get("red_id"),
            basic_info.get("displayId"),
            basic_info.get("display_id"),
        )

    def _extract_profile_author_name(self, html: str) -> str:
        state = self._extract_initial_state(html)
        if not isinstance(state, dict):
            return ""
        basic_info = (((state.get("user") or {}).get("userPageData") or {}).get("basicInfo")) or {}
        if not isinstance(basic_info, dict):
            return ""
        return self._first_non_empty(
            basic_info.get("nickName"),
            basic_info.get("nickname"),
            basic_info.get("name"),
        )

    @staticmethod
    def _extract_author_name(title: str) -> str:
        normalized = title.replace(" - 小红书", "").strip()
        return normalized[:40] or "XHS Creator"

    @staticmethod
    def _stable_suffix(value: str, length: int = 10) -> str:
        digest = hashlib.sha1(value.encode("utf-8")).hexdigest()
        return digest[:length]


class XHSNoteParser:
    def __init__(self, http_client: XHSHttpClient):
        self.client = http_client

    async def parse(self, url: str | None, payload: dict | None) -> ParsedNote:
        raw = payload
        if url:
            raw = await self.client.fetch(url)
        if raw is None:
            raise ValueError("No payload fetched for note.")
        note = XHSSEResponse.model_validate(raw)
        visuals = await self._parse_visual_elements(note.media)
        content = self._structure_content(note.title, note.content, note.hashtags)
        keywords = self._derive_keywords(note.category, note.sub_category, content)
        return ParsedNote(note=note, visuals=visuals, content=content, seo_keywords=keywords)

    async def _parse_visual_elements(self, media_urls: Iterable[str]) -> list[XHSVisualElement]:
        visuals: list[XHSVisualElement] = []
        async with httpx.AsyncClient(timeout=10) as client:
            for url in media_urls:
                try:
                    resp = await client.get(url)
                    resp.raise_for_status()
                    img = Image.open(BytesIO(resp.content)).convert("RGB")
                    ocr_text = pytesseract.image_to_string(img, lang="chi_sim+eng").strip()
                    phash = str(imagehash.phash(img, hash_size=16))
                    visuals.append(XHSVisualElement(image_url=url, ocr_text=ocr_text, perceptual_hash=phash))
                except Exception as exc:  # pylint: disable=broad-except
                    visuals.append(XHSVisualElement(image_url=url, ocr_text=None, perceptual_hash=None))
        return visuals

    def _structure_content(self, title: str, body: str, hashtags: list[str]) -> XHSContentSections:
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        hook = title or (lines[0] if lines else "")
        main_body = "\n".join(lines[1:]) if len(lines) > 1 else body
        hidden = [tag.lstrip("#") for tag in hashtags if tag.startswith("#")]
        return XHSContentSections(hook_title=hook, body=main_body, hidden_tags=hidden)

    def _derive_keywords(
        self,
        category: str,
        sub_category: str | None,
        content: XHSContentSections,
    ) -> list[str]:
        words = set()
        if category:
            words.add(category.lower())
        if sub_category:
            words.add(sub_category.lower())
        words.update(tag.lower() for tag in content.hidden_tags)
        for token in content.hook_title.split():
            if len(token) > 2:
                words.add(token.lower())
        return sorted(words)


class PulseBenchmarks:
    def __init__(self, redis: Redis, prefix: str = "xhs:benchmarks"):
        self.redis = redis
        self.prefix = prefix

    async def get_interaction_view_ratio(self, category: str) -> float:
        cached = await self.redis.get(f"{self.prefix}:{category}")
        if cached:
            return float(cached)
        # default baseline ratio
        ratio = 0.035
        await self.redis.setex(f"{self.prefix}:{category}", timedelta(minutes=30), ratio)
        return ratio


class PulseEngine:
    def __init__(self, redis: Redis, benchmarks: PulseBenchmarks):
        self.redis = redis
        self.benchmarks = benchmarks

    async def calculate(self, note: XHSSEResponse) -> dict:
        key = f"xhs:pulse:{note.note_id}"
        prev = await self.redis.hgetall(key)
        prev_likes = int(prev.get(b"likes", 0)) if prev else 0
        prev_ts = float(prev.get(b"ts", 0)) if prev else None

        velocity = 0.0
        now_ts = datetime.utcnow().timestamp()
        if prev_ts:
            delta_minutes = max((now_ts - prev_ts) / 60, 1 / 60)
            velocity = (note.metrics.likes - prev_likes) / delta_minutes

        interaction = note.metrics.likes + note.metrics.collects + note.metrics.comments + note.metrics.shares
        ratio = interaction / max(note.metrics.views, 1)

        benchmark = await self.benchmarks.get_interaction_view_ratio(note.category)

        decay = self._decay_classification(
            velocity=velocity,
            elapsed=0 if not prev_ts else (now_ts - prev_ts) / 60,
        )
        is_high_priority = ratio > benchmark * 1.8 or velocity > 250

        await self.redis.hset(
            key,
            mapping={
                "likes": note.metrics.likes,
                "ratio": ratio,
                "ts": now_ts,
                "velocity": velocity,
            },
        )
        await self.redis.expire(key, 900)

        score = (ratio / benchmark) * 0.6 + min(velocity / 300, 1.5) * 0.4

        return {
            "note_id": note.note_id,
            "score": round(score, 4),
            "velocity": round(velocity, 2),
            "interaction_view_ratio": round(ratio, 4),
            "trend": decay,
            "is_high_priority": is_high_priority,
            "benchmark_ratio": benchmark,
        }

    def _decay_classification(self, velocity: float, elapsed: float) -> str:
        if velocity > 400 and elapsed <= 5:
            return "short_spike"
        if velocity > 150 and elapsed > 5:
            return "consistent_growth"
        return "stable"
