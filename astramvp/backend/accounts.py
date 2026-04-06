from __future__ import annotations

import enum
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import Depends, HTTPException, status
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, declarative_base, mapped_column, relationship

from .db import get_db_session

Base = declarative_base()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class Platform(str, enum.Enum):
    tiktok = "tiktok"
    instagram = "instagram"
    twitter = "twitter"
    xiaohongshu = "xiaohongshu"


class ManagedAccount(Base):
    __tablename__ = "managed_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    platform: Mapped[Platform] = mapped_column(Enum(Platform, name="platform_enum"), nullable=False)
    handle: Mapped[str] = mapped_column(String(140), nullable=False)
    # Use a non-reserved attribute name; keep column name as 'metadata' for compatibility
    account_metadata: Mapped[dict] = mapped_column("metadata", JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    credentials: Mapped["AccountCredential"] = relationship(
        back_populates="account", cascade="all, delete-orphan", uselist=False
    )

    __table_args__ = (
        UniqueConstraint("owner_id", "platform", "handle", name="uq_owner_platform_handle"),
    )


class AccountCredential(Base):
    __tablename__ = "account_credentials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    account_id: Mapped[str] = mapped_column(ForeignKey("managed_accounts.id", ondelete="CASCADE"), nullable=False)
    access_token_ciphertext: Mapped[str] = mapped_column(String, nullable=False)
    refresh_token_ciphertext: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    account: Mapped[ManagedAccount] = relationship(back_populates="credentials")

    __table_args__ = (
        CheckConstraint("expires_at > created_at", name="ck_token_expiry"),
    )


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    account_id: Mapped[str] = mapped_column(ForeignKey("managed_accounts.id", ondelete="CASCADE"), nullable=False)
    jwt: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )

    account: Mapped[ManagedAccount] = relationship()


class OAuthStart(BaseModel):
    owner_id: str
    platform: Platform
    redirect_uri: str
    scopes: list[str]


class OAuthCallback(BaseModel):
    code: str
    state: str
    owner_id: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int = Field(gt=0)
    scopes: list[str]


@dataclass
class TokenVault:
    secret: bytes

    def seal(self, plaintext: str) -> str:
        salt = secrets.token_bytes(16)
        digest = pwd_context.hash((salt + plaintext.encode()).hex())
        return f"{salt.hex()}:{digest}"

    def unseal(self, ciphertext: str, raw: str) -> bool:
        salt_hex, digest = ciphertext.split(":")
        candidate = (bytes.fromhex(salt_hex) + raw.encode()).hex()
        return pwd_context.verify(candidate, digest)


class AccountService:
    def __init__(self, db: AsyncSession, vault: TokenVault):
        self.db = db
        self.vault = vault

    async def upsert_account(self, payload: OAuthStart) -> ManagedAccount:
        account = ManagedAccount(
            owner_id=payload.owner_id,
            platform=payload.platform,
            handle="",
            account_metadata={"scopes": payload.scopes},
        )
        self.db.add(account)
        await self.db.flush()
        return account

    async def store_tokens(self, account_id: str, tokens: TokenResponse) -> AccountCredential:
        credential = AccountCredential(
            account_id=account_id,
            access_token_ciphertext=self.vault.seal(tokens.access_token),
            refresh_token_ciphertext=self.vault.seal(tokens.refresh_token),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=tokens.expires_in),
            scopes=tokens.scopes,
        )
        self.db.add(credential)
        await self.db.commit()
        await self.db.refresh(credential)
        return credential

    async def create_session(self, account_id: str) -> AgentSession:
        now = datetime.now(timezone.utc)
        ttl = timedelta(hours=2)
        payload = {
            "sub": account_id,
            "iat": int(now.timestamp()),
            "exp": int((now + ttl).timestamp()),
        }
        token = jwt.encode(payload, key=self.vault.secret, algorithm="HS256")
        session = AgentSession(account_id=account_id, jwt=token, expires_at=now + ttl)
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def ensure_account_scope(self, session_id: str, account_id: str) -> ManagedAccount:
        session = await self.db.get(AgentSession, session_id)
        if not session or session.account_id != account_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-account access denied")
        return await self.db.get(ManagedAccount, account_id)


def get_token_vault() -> TokenVault:
    secret = (
        os.getenv("ACCOUNT_TOKEN_VAULT_SECRET", "").strip()
        or os.getenv("SUPABASE_JWT_SECRET", "").strip()
        or os.getenv("JWT_SECRET", "").strip()
    )
    if not secret:
        raise RuntimeError(
            "Missing token vault secret. Set ACCOUNT_TOKEN_VAULT_SECRET (or SUPABASE_JWT_SECRET / JWT_SECRET)."
        )
    return TokenVault(secret=secret.encode("utf-8"))


async def get_service(
    db: AsyncSession = Depends(get_db_session),
    vault: TokenVault = Depends(get_token_vault),
) -> AccountService:
    return AccountService(db=db, vault=vault)
