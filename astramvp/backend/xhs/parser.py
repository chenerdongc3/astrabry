from __future__ import annotations

import asyncio
import random
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
                async with httpx.AsyncClient(
                    proxies={"http://": proxy.http, "https://": proxy.https},
                    headers=self.base_headers,
                    timeout=10,
                ) as client:
                    resp = await client.get(url)
                    if resp.status_code == 429:
                        self.proxy_rotator.rotate()
                        raise AntiScrapeError("Rate limited")
                    resp.raise_for_status()
                    data = resp.json()
                    if not data:
                        raise ValueError("Empty response from XHS")
                    return data
            except (httpx.HTTPError, AntiScrapeError):
                await asyncio.sleep(1.5 * (attempt + 1))
                self.proxy_rotator.rotate()
                continue
        raise AntiScrapeError("Unable to bypass anti-scraping after retries")


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
