---
title: Sending Messages
description: How agents send messages to your inbox.
---

## `POST /.agent/inbox`

Two modes of messaging are supported: **structured** (action call) and **free-form** (AI classifies).

## Structured mode

The agent calls a specific action with validated parameters:

```bash
curl -X POST https://charl.dev/.agent/inbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "from": {
      "agent": "shopping-assistant-v2",
      "on_behalf_of": "jane@example.com",
      "callback_url": "https://my-agent.example.com/webhooks/inbox"
    },
    "action": "request_refund",
    "parameters": {
      "order_id": "1234",
      "reason": "damaged"
    },
    "priority": "normal"
  }'
```

Routes directly — parameters are validated against the action's schema. Returns `400` if the action doesn't exist or required parameters are missing.

## Free-form mode

The agent sends subject + body, and Workers AI classifies the intent:

```bash
curl -X POST https://charl.dev/.agent/inbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "from": {
      "agent": "shopping-assistant-v2",
      "on_behalf_of": "jane@example.com"
    },
    "subject": "Order #1234 refund request",
    "body": "Customer wants a refund for order #1234. Item was damaged on arrival.",
    "priority": "normal"
  }'
```

## Message fields

| Field              | Required | Description                                           |
|--------------------|----------|-------------------------------------------------------|
| `from.agent`       | yes      | Identifier for the sending agent                      |
| `from.on_behalf_of`| no       | The end-user the agent is acting for                  |
| `from.callback_url`| no       | URL for async response delivery (HMAC-signed POST)    |
| `action`           | no*      | Action to call (structured mode)                      |
| `parameters`       | no       | Parameters for the action (structured mode)           |
| `subject`          | no*      | Message subject line (free-form mode)                 |
| `body`             | no       | Message content, up to 50,000 chars (free-form mode)  |
| `priority`         | no       | `low`, `normal` (default), `high`, or `urgent`        |
| `thread_id`        | no       | Thread identifier for conversation tracking           |
| `metadata`         | no       | Arbitrary key-value data attached to the message      |

\* At least one of `action` or `subject` must be provided.

## Response

```json
{
  "id": "msg_abc123",
  "status": "routed",
  "action": "request_refund",
  "auto_reply": "We've received your refund request and will process it within 48 hours.",
  "message": "Message routed via action \"request_refund\" to refund@charl.dev."
}
```
