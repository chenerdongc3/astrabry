from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from fastapi import Depends
from redis.asyncio import Redis
from langchain_openai import ChatOpenAI
from langchain_community.vectorstores import Chroma

from ..agent.graph import build_agent_graph, StrategyMemoryStore
from .redis_fallback import ResilientRedis


@lru_cache
def redis_client() -> ResilientRedis:
    client = Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"), decode_responses=False)
    return ResilientRedis(real_client=client)


async def get_redis() -> ResilientRedis:
    return redis_client()


@lru_cache
def agent_executor():
    llm = ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"), temperature=0)
    vector_store = Chroma(collection_name="astra_guidelines")
    memory_store = StrategyMemoryStore(collection=redis_client())
    return build_agent_graph(llm=llm, vector_store=vector_store, memory_store=memory_store)


async def get_agent_executor():
    return agent_executor()
