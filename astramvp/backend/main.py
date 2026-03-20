from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .xhs.service import router as xhs_router
from .oauth import router as oauth_router

app = FastAPI(title="Astra Command Center API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(xhs_router, prefix="/api")
app.include_router(oauth_router, prefix="/api")
