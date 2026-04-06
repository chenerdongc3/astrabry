from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import XHSAccountRecord, XHSNoteRecord
from .schemas import XHSMonitoredAccount, XHSNoteSummary


def _account_to_schema(record: XHSAccountRecord) -> XHSMonitoredAccount:
    return XHSMonitoredAccount(
        id=record.id,
        name=record.name,
        xhs_id=record.xhs_id,
        platform=record.platform,
        avatar=record.avatar,
        post_count=record.post_count,
        profile_url=record.profile_url,
    )


def _note_to_schema(record: XHSNoteRecord) -> XHSNoteSummary:
    return XHSNoteSummary(
        id=record.id,
        account_id=record.account_id,
        url=record.url,
        title=record.title,
        content=record.content,
        likes=record.likes,
        shares=record.shares,
        comments=record.comments,
        collects=record.collects,
        views=record.views,
        growth_rate=record.growth_rate,
        status=record.status,
        timestamp=record.timestamp,
        history=record.history or [],
        seo_keywords=record.seo_keywords or [],
    )


async def list_accounts(db: AsyncSession) -> list[XHSMonitoredAccount]:
    result = await db.execute(select(XHSAccountRecord).order_by(func.lower(XHSAccountRecord.name)))
    records = result.scalars().all()
    return [_account_to_schema(record) for record in records]


async def load_account(db: AsyncSession, account_id: str) -> XHSMonitoredAccount | None:
    record = await db.get(XHSAccountRecord, account_id)
    if not record:
        return None
    return _account_to_schema(record)


async def upsert_account(
    db: AsyncSession,
    account_id: str,
    name: str | None,
    xhs_id: str | None,
    profile_url: str | None,
    avatar: str,
    post_count: int,
) -> XHSMonitoredAccount:
    record = await db.get(XHSAccountRecord, account_id)
    if record is None:
        record = XHSAccountRecord(
            id=account_id,
            name=name or f"Creator {account_id[-4:]}",
            xhs_id=xhs_id or account_id,
            avatar=avatar,
            post_count=post_count,
            profile_url=profile_url,
        )
        db.add(record)
    else:
        record.name = name or record.name
        record.xhs_id = xhs_id or record.xhs_id
        record.avatar = avatar or record.avatar
        record.profile_url = profile_url or record.profile_url
        record.post_count = max(0, post_count)

    await db.commit()
    await db.refresh(record)
    return _account_to_schema(record)


async def upsert_note(db: AsyncSession, note: XHSNoteSummary) -> None:
    record = await db.get(XHSNoteRecord, note.id)
    if record is None:
        db.add(
            XHSNoteRecord(
                id=note.id,
                account_id=note.account_id,
                url=str(note.url) if note.url else None,
                title=note.title,
                content=note.content,
                likes=note.likes,
                shares=note.shares,
                comments=note.comments,
                collects=note.collects,
                views=note.views,
                growth_rate=note.growth_rate,
                status=note.status,
                timestamp=note.timestamp,
                history=note.history,
                seo_keywords=note.seo_keywords,
            )
        )
    else:
        record.account_id = note.account_id
        record.url = str(note.url) if note.url else None
        record.title = note.title
        record.content = note.content
        record.likes = note.likes
        record.shares = note.shares
        record.comments = note.comments
        record.collects = note.collects
        record.views = note.views
        record.growth_rate = note.growth_rate
        record.status = note.status
        record.timestamp = note.timestamp
        record.history = note.history
        record.seo_keywords = note.seo_keywords

    await db.commit()


async def list_notes(db: AsyncSession, account_id: str, limit: int = 50) -> list[XHSNoteSummary]:
    result = await db.execute(
        select(XHSNoteRecord)
        .where(XHSNoteRecord.account_id == account_id)
        .order_by(XHSNoteRecord.timestamp.desc())
        .limit(limit)
    )
    records = result.scalars().all()
    return [_note_to_schema(record) for record in records]


async def replace_account_notes(db: AsyncSession, account_id: str, notes: list[XHSNoteSummary]) -> None:
    await db.execute(delete(XHSNoteRecord).where(XHSNoteRecord.account_id == account_id))
    for note in notes:
        db.add(
            XHSNoteRecord(
                id=note.id,
                account_id=note.account_id,
                url=str(note.url) if note.url else None,
                title=note.title,
                content=note.content,
                likes=note.likes,
                shares=note.shares,
                comments=note.comments,
                collects=note.collects,
                views=note.views,
                growth_rate=note.growth_rate,
                status=note.status,
                timestamp=note.timestamp,
                history=note.history,
                seo_keywords=note.seo_keywords,
            )
        )
    await db.commit()


async def delete_account(db: AsyncSession, account_id: str) -> None:
    record = await db.get(XHSAccountRecord, account_id)
    if not record:
        return
    await db.delete(record)
    await db.commit()


async def sync_account_post_count(db: AsyncSession, account_id: str) -> XHSMonitoredAccount | None:
    record = await db.get(XHSAccountRecord, account_id)
    if not record:
        return None

    count_result = await db.execute(
        select(func.count(XHSNoteRecord.id)).where(XHSNoteRecord.account_id == account_id)
    )
    count = count_result.scalar_one()
    record.post_count = max(0, int(count))
    await db.commit()
    await db.refresh(record)
    return _account_to_schema(record)
