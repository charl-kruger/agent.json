---
title: Discovery
description: How agents discover your inbox capabilities via /.well-known/agent.json.
---

## `GET /.well-known/agent.json`

Any AI agent can discover your inbox actions with their parameter and response schemas:

```json
{
  "version": "1.0",
  "name": "Charl's Website",
  "description": "Personal website and business",
  "message_endpoint": "https://charl.dev/.agent/inbox",
  "authentication": {
    "type": "bearer",
    "header": "Authorization"
  },
  "actions": [
    {
      "name": "request_refund",
      "description": "Request a refund for an order",
      "parameters": {
        "type": "object",
        "properties": {
          "order_id": { "type": "string", "description": "The order ID" },
          "reason": { "type": "string", "description": "Reason for refund", "enum": ["damaged", "wrong_item", "other"] }
        },
        "required": ["order_id", "reason"]
      },
      "response_schema": {
        "type": "object",
        "properties": {
          "refund_id": { "type": "string", "description": "The refund tracking ID" },
          "amount": { "type": "number", "description": "Refund amount in USD" },
          "status": { "type": "string", "description": "Refund status" }
        },
        "required": ["refund_id"]
      }
    }
  ],
  "rate_limit": { "requests_per_minute": 60 },
  "response_modes": ["sync", "poll", "callback"]
}
```

## Response modes

| Mode       | Description                                                           |
|------------|-----------------------------------------------------------------------|
| `sync`     | The initial POST returns routing status and auto-reply immediately    |
| `poll`     | Agent polls `GET /.agent/inbox/:id` to check for responses           |
| `callback` | Agent provides a `callback_url` and receives responses via signed POST|

## Actions

Each action describes:

- **`name`** — unique action identifier
- **`description`** — human-readable description (used for AI classification of free-form messages)
- **`parameters`** — JSON Schema object describing accepted input parameters
- **`response_schema`** (optional) — JSON Schema object describing the structured data the response will contain
