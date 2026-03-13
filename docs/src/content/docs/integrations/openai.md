---
title: OpenAI (GPTs & Assistants)
description: Connect OpenAI models and GPTs to agent.json using function calling.
---

OpenAI's function calling maps directly to agent.json actions. Each action becomes a function, and the parameters schema is already in JSON Schema format — exactly what OpenAI expects.

## Assistants API

### 1. Create tools from the discovery document

```python
import openai
import httpx

# Fetch discovery document
discovery = httpx.get("https://agent-json.com/.well-known/agent.json").json()
INBOX_URL = discovery["message_endpoint"]
TOKEN = "your-bearer-token"

# Convert actions to OpenAI function tools
tools = []
for action in discovery["actions"]:
    tools.append({
        "type": "function",
        "function": {
            "name": action["name"],
            "description": action["description"],
            "parameters": action["parameters"]
        }
    })
```

### 2. Create an assistant with inbox tools

```python
client = openai.OpenAI()

assistant = client.beta.assistants.create(
    name="Customer Service Agent",
    instructions="""You help customers interact with the website.
    When a customer needs something (refund, support, etc.), use the
    appropriate tool to send their request to the website's inbox.""",
    model="gpt-4o",
    tools=tools
)
```

### 3. Handle function calls

```python
def handle_inbox_function(function_name, arguments, user_email=None):
    """Send a function call to the agent.json endpoint."""
    payload = {
        "from": {
            "agent": "openai-assistant",
            "on_behalf_of": user_email
        },
        "action": function_name,
        "parameters": arguments
    }

    response = httpx.post(
        INBOX_URL,
        json=payload,
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    return response.json()
```

### 4. Run the conversation

```python
thread = client.beta.threads.create()

client.beta.threads.messages.create(
    thread_id=thread.id,
    role="user",
    content="I need a refund for order #1234, it was damaged."
)

run = client.beta.threads.runs.create_and_poll(
    thread_id=thread.id,
    assistant_id=assistant.id
)

if run.status == "requires_action":
    tool_outputs = []
    for call in run.required_action.submit_tool_outputs.tool_calls:
        import json
        args = json.loads(call.function.arguments)
        result = handle_inbox_function(call.function.name, args, "customer@example.com")
        tool_outputs.append({
            "tool_call_id": call.id,
            "output": json.dumps(result)
        })

    run = client.beta.threads.runs.submit_tool_outputs_and_poll(
        thread_id=thread.id,
        run_id=run.id,
        tool_outputs=tool_outputs
    )

# Get the final response
messages = client.beta.threads.messages.list(thread_id=thread.id)
print(messages.data[0].content[0].text.value)
```

## Custom GPTs

You can expose an agent.json endpoint as a Custom GPT action:

### 1. Create an OpenAPI spec from the discovery document

```yaml
openapi: 3.1.0
info:
  title: Website Inbox
  version: "1.0"
servers:
  - url: https://agent-json.com
paths:
  /.agent/inbox:
    post:
      operationId: sendMessage
      summary: Send a message to the website inbox
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                from:
                  type: object
                  properties:
                    agent:
                      type: string
                  required: [agent]
                action:
                  type: string
                  description: Action name
                parameters:
                  type: object
                  description: Action parameters
                subject:
                  type: string
                body:
                  type: string
              required: [from]
      responses:
        "200":
          description: Message routed
  /.agent/inbox/{id}:
    get:
      operationId: checkMessage
      summary: Check message status and response
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Message status with optional response
```

### 2. Add to your GPT configuration

In the GPT builder:
1. Go to **Configure** > **Actions**
2. Paste the OpenAPI spec
3. Set authentication to **API Key** with the bearer token
4. The GPT can now send messages and check for responses

## Chat Completions (direct)

For simpler use cases without the Assistants API:

```python
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You help customers interact with the website inbox."},
        {"role": "user", "content": "I need a refund for order #1234"}
    ],
    tools=tools,
    tool_choice="auto"
)

if response.choices[0].message.tool_calls:
    call = response.choices[0].message.tool_calls[0]
    result = handle_inbox_function(
        call.function.name,
        json.loads(call.function.arguments)
    )
```
