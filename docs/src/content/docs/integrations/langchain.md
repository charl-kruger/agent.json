---
title: LangChain / LangGraph
description: Use agent-inbox as a LangChain tool or LangGraph node.
---

agent-inbox actions map naturally to LangChain tools. Each action becomes a `StructuredTool` with the parameter schema derived directly from the discovery document.

## LangChain tools

### 1. Auto-generate tools from the discovery document

```python
import httpx
from langchain_core.tools import StructuredTool
from pydantic import create_model, Field

# Fetch discovery document
discovery = httpx.get("https://example.com/.well-known/agent.json").json()
INBOX_URL = discovery["message_endpoint"]
TOKEN = "your-bearer-token"

TYPE_MAP = {"string": str, "number": float, "boolean": bool}


def make_inbox_tool(action: dict) -> StructuredTool:
    """Create a LangChain tool from an agent-inbox action."""

    # Build a Pydantic model from the action's parameter schema
    fields = {}
    props = action["parameters"].get("properties", {})
    required = set(action["parameters"].get("required", []))

    for name, schema in props.items():
        python_type = TYPE_MAP.get(schema.get("type", "string"), str)
        if name in required:
            fields[name] = (python_type, Field(description=schema.get("description", "")))
        else:
            fields[name] = (python_type | None, Field(default=None, description=schema.get("description", "")))

    InputModel = create_model(f"{action['name']}_input", **fields)

    def send_to_inbox(**kwargs):
        payload = {
            "from": {"agent": "langchain-agent"},
            "action": action["name"],
            "parameters": {k: v for k, v in kwargs.items() if v is not None}
        }
        resp = httpx.post(
            INBOX_URL,
            json=payload,
            headers={"Authorization": f"Bearer {TOKEN}"}
        )
        return resp.json()

    return StructuredTool.from_function(
        func=send_to_inbox,
        name=action["name"],
        description=action["description"],
        args_schema=InputModel
    )


# Generate all tools
tools = [make_inbox_tool(a) for a in discovery["actions"]]
```

### 2. Use with a chat model

```python
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

llm = ChatOpenAI(model="gpt-4o").bind_tools(tools)

result = llm.invoke([
    HumanMessage("I need a refund for order #1234, the item was damaged.")
])

# Process tool calls
for call in result.tool_calls:
    tool = next(t for t in tools if t.name == call["name"])
    output = tool.invoke(call["args"])
    print(f"Sent to inbox: {output}")
```

## LangGraph agent

For a full agent loop that can send messages and poll for responses:

```python
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI

# Add a poll tool
def check_inbox_response(message_id: str) -> dict:
    """Check if the website has responded to a message."""
    resp = httpx.get(
        f"{INBOX_URL}/{message_id}",
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    return resp.json()

poll_tool = StructuredTool.from_function(
    func=check_inbox_response,
    name="check_inbox_response",
    description="Check if the website has responded to a previously sent message. Pass the message ID."
)

all_tools = tools + [poll_tool]

agent = create_react_agent(
    ChatOpenAI(model="gpt-4o"),
    tools=all_tools,
    prompt="You help customers interact with the website. "
           "Send requests via inbox tools and check for responses when needed."
)

# Run the agent
result = agent.invoke({
    "messages": [("user", "Request a refund for order ORD-789, reason: damaged. "
                          "Then check if they've responded.")]
})

for msg in result["messages"]:
    print(msg.pretty_print())
```

## Auto-discovery utility

You can create a reusable utility that generates LangChain tools from any agent-inbox endpoint:

```python
def discover_inbox_tools(base_url: str, token: str) -> list[StructuredTool]:
    """Auto-discover and create LangChain tools from an agent-inbox endpoint."""
    discovery = httpx.get(f"{base_url}/.well-known/agent.json").json()
    endpoint = discovery["message_endpoint"]

    tools = []
    for action in discovery["actions"]:
        # ... same as make_inbox_tool above, but with endpoint and token in closure
        tools.append(make_inbox_tool(action))

    return tools

# Usage: give an agent tools for any website
tools = discover_inbox_tools("https://example.com", "token123")
```

This means any LangChain agent can interact with any agent-inbox website with a single function call.
