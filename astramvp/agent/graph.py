from __future__ import annotations

from typing import Literal, TypedDict

import json
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.vectorstores import VectorStore
from langchain_core.tools import tool
from langgraph.graph import MessagesState, StateGraph, END


class AgentState(MessagesState, total=False):
  account_id: str
  platform: str
  spike_report: dict
  guidelines: list[str]
  strategy: str
  fast_responses: list[str]
  alert_payload: dict


class StrategyMemoryStore:
  def __init__(self, collection):
    self.collection = collection

  async def store(self, account_id: str, payload: dict) -> None:
    document = {"account_id": account_id, **payload}
    if hasattr(self.collection, "insert_one"):
      await self.collection.insert_one(document)
      return
    if hasattr(self.collection, "rpush"):
      await self.collection.rpush(f"astra:memory:{account_id}", json.dumps(document))
      return
    raise RuntimeError("Unsupported memory store backend")


@tool("data_monitor_tool", return_direct=False)
def data_monitor_tool(account_id: str, platform: str) -> dict:
  """Fetches the latest engagement deltas for a managed account."""
  # placeholder. Replace with redis/time-series fetch.
  return {"account_id": account_id, "platform": platform, "spike": True, "delta": 3.2}


def build_agent_graph(
  llm: BaseChatModel,
  vector_store: VectorStore,
  memory_store: StrategyMemoryStore,
):
  prompt = ChatPromptTemplate.from_messages(
    [
      SystemMessage(
        content=(
          "You are Astra, an AI growth strategist. Always follow the operator's guidelines "
          "before acting. Reference spikes detected via data_monitor_tool."
        )
      ),
      ("placeholder", "{messages}"),
    ]
  )

  retriever = vector_store.as_retriever(search_kwargs={"k": 4})

  def ingest_guidelines(state: AgentState):
    docs = retriever.invoke(f"guidelines for {state['account_id']}")
    state["guidelines"] = [doc.page_content for doc in docs]
    return state

  def monitor(state: AgentState):
    report = data_monitor_tool.invoke(
      {"account_id": state["account_id"], "platform": state["platform"]}
    )
    state["spike_report"] = report
    state["messages"] = [
      HumanMessage(
        content=f"Recent spike report: {report}. Guidelines: {state.get('guidelines', [])}"
      )
    ]
    return state

  def generate_strategy(state: AgentState):
    chain = prompt | llm
    response = chain.invoke(state["messages"])
    state["messages"] = state["messages"] + [response]
    state["strategy"] = response.content
    return state

  async def persist(state: AgentState):
    await memory_store.store(
      state["account_id"],
      {
        "platform": state["platform"],
        "strategy": state["strategy"],
        "spike_report": state["spike_report"],
      },
    )
    return state

  def fast_responses(state: AgentState):
    templates = retriever.invoke(f"fast response templates for {state['account_id']}")
    suggestions = [
      f"{i+1}. {doc.metadata.get('action', 'Engage')}: {doc.page_content}"
      for i, doc in enumerate(templates[:3])
    ]
    if not suggestions:
      suggestions = [
        "1. Reply to top performing comment with a clarifying question.",
        "2. Post a behind-the-scenes note referencing the current spike.",
        "3. Pin a CTA comment linking to lead magnet.",
      ]
    state["fast_responses"] = suggestions
    formatted = "\n".join(suggestions)
    state["messages"] += [AIMessage(content=f"FAST RESPONSES:\n{formatted}")]
    return state

  graph = StateGraph(AgentState)
  graph.add_node("guidelines", ingest_guidelines)
  graph.add_node("monitor", monitor)
  graph.add_node("strategy", generate_strategy)
  graph.add_node("fast", fast_responses)
  graph.add_node("memory", persist)

  graph.set_entry_point("guidelines")
  graph.add_edge("guidelines", "monitor")
  graph.add_edge("monitor", "strategy")
  graph.add_edge("strategy", "fast")
  graph.add_edge("fast", "memory")
  graph.add_edge("memory", END)

  return graph.compile()
