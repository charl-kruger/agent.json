---
title: Claude (Anthropic)
description: Connect Claude to agent-inbox using tool use.
---

Claude can interact with any agent-inbox endpoint using [tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use). Define the inbox's actions as Claude tools, and Claude will call them with structured parameters.

## Setup

### 1. Discover the inbox

First, fetch the discovery document to learn what actions are available:

```bash
curl https://example.com/.well-known/agent.json
```

### 2. Define tools from actions

Map each action from the discovery document to a Claude tool definition:

```python
import anthropic
import httpx

# Fetch discovery document
discovery = httpx.get("https://example.com/.well-known/agent.json").json()
INBOX_URL = discovery["message_endpoint"]
TOKEN = "your-bearer-token"

# Convert actions to Claude tools
tools = []
for action in discovery["actions"]:
    tools.append({
        "name": f"inbox_{action['name']}",
        "description": f"Send to website inbox: {action['description']}",
        "input_schema": action["parameters"]
    })

# Add a generic "send message" tool for free-form
tools.append({
    "name": "inbox_send_message",
    "description": "Send a free-form message to the website inbox",
    "input_schema": {
        "type": "object",
        "properties": {
            "subject": {"type": "string", "description": "Message subject"},
            "body": {"type": "string", "description": "Message body"}
        },
        "required": ["subject"]
    }
})
```

### 3. Handle tool calls

When Claude calls an inbox tool, send the message to the inbox endpoint:

```python
def handle_inbox_tool(tool_name, tool_input, user_email=None):
    """Send a tool call to the agent-inbox endpoint."""
    if tool_name == "inbox_send_message":
        payload = {
            "from": {
                "agent": "claude-assistant",
                "on_behalf_of": user_email
            },
            "subject": tool_input["subject"],
            "body": tool_input.get("body", "")
        }
    else:
        # Structured action call
        action_name = tool_name.removeprefix("inbox_")
        payload = {
            "from": {
                "agent": "claude-assistant",
                "on_behalf_of": user_email
            },
            "action": action_name,
            "parameters": tool_input
        }

    response = httpx.post(
        INBOX_URL,
        json=payload,
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    return response.json()
```

### 4. Complete conversation loop

```python
client = anthropic.Anthropic()

messages = [
    {"role": "user", "content": "I need a refund for order #1234, it arrived damaged."}
]

# First turn — Claude decides to call the tool
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=1024,
    tools=tools,
    messages=messages
)

# Process tool calls
for block in response.content:
    if block.type == "tool_use":
        result = handle_inbox_tool(block.name, block.input, "customer@example.com")

        # Feed result back to Claude
        messages.append({"role": "assistant", "content": response.content})
        messages.append({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": str(result)
            }]
        })

        # Claude summarizes the result for the user
        final = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            tools=tools,
            messages=messages
        )
        print(final.content[0].text)
```

### 5. Poll for responses (optional)

If the website sends a response later, you can poll for it:

```python
def check_for_response(message_id):
    """Poll the inbox for a response to a previously sent message."""
    response = httpx.get(
        f"{INBOX_URL}/{message_id}",
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    data = response.json()
    if data.get("response"):
        return data["response"]
    return None
```

## With callbacks

For real-time responses without polling, provide a `callback_url` when sending:

```python
payload = {
    "from": {
        "agent": "claude-assistant",
        "on_behalf_of": "customer@example.com",
        "callback_url": "https://your-server.com/webhooks/inbox"
    },
    "action": "request_refund",
    "parameters": {"order_id": "1234", "reason": "damaged"}
}
```

See [Callbacks](/protocol/callbacks/) for how to verify the HMAC signature on your webhook endpoint.

## MCP server

You can also wrap agent-inbox as an [MCP server](https://modelcontextprotocol.io/) to make it available to any MCP-compatible client (Claude Desktop, Cursor, etc.):

```typescript
// Fetch discovery doc at startup, expose each action as an MCP tool
// The MCP server translates tool calls into POST /.agent/inbox requests
```

This turns any agent-inbox endpoint into a tool that Claude can use across all MCP-enabled interfaces.
