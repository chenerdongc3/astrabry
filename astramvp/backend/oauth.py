from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .accounts import AccountService, ManagedAccount, OAuthCallback, OAuthStart, TokenResponse, get_service

router = APIRouter(prefix="/oauth", tags=["oauth"])


@router.post("/start", status_code=202)
async def start_oauth(payload: OAuthStart, service: Annotated[AccountService, Depends(get_service)]):
    account = await service.upsert_account(payload)
    return {
        "account_id": account.id,
        "state": account.id,
        "platform": account.platform,
    }


@router.post("/callback")
async def oauth_callback(payload: OAuthCallback, service: Annotated[AccountService, Depends(get_service)]):
    tokens = await exchange_code_for_tokens(payload)
    credential = await service.store_tokens(account_id=payload.state, tokens=tokens)
    session = await service.create_session(account_id=payload.state)
    return {"credential_id": credential.id, "session_id": session.id, "jwt": session.jwt}


async def exchange_code_for_tokens(callback: OAuthCallback) -> TokenResponse:
    # Placeholder for per-platform OAuth exchange. In production, call platform-specific endpoints.
    fake_token = f"access-{callback.code}"
    return TokenResponse(
        access_token=fake_token,
        refresh_token=f"refresh-{callback.code}",
        expires_in=3600,
        scopes=["basic", "posts.read"],
    )


@router.post("/refresh/{account_id}")
async def refresh_token(account_id: str, service: Annotated[AccountService, Depends(get_service)]):
    account = await service.db.get(ManagedAccount, account_id)
    if not account or not account.credentials:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found")
    refreshed = TokenResponse(
        access_token=f"{account.platform}-rotated-{datetime.now(timezone.utc).timestamp()}",
        refresh_token=f"{account.platform}-refresh-{datetime.now(timezone.utc).timestamp()}",
        expires_in=3600,
        scopes=account.credentials.scopes,
    )
    await service.store_tokens(account_id=account_id, tokens=refreshed)
    session = await service.create_session(account_id=account_id)
    return {"session_id": session.id, "jwt": session.jwt}
