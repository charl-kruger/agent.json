---
title: Responses
description: How to respond to agents and how they retrieve responses.
---

## Respond to a message

### `POST /.agent/inbox/:id/respond`

The website owner (or an automated system) can respond back to the agent:

```bash
curl -X POST https://agent-json.com/.agent/inbox/msg_abc123/respond \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "body": "Refund processed successfully.",
    "structured_data": {
      "refund_id": "ref_456",
      "amount": 29.99,
      "status": "completed"
    },
    "responded_by": "support-team"
  }'
```

Returns `201` with the response object:

```json
{
  "id": "resp_xyz789",
  "messageId": "msg_abc123",
  "status": "delivered",
  "body": "Refund processed successfully.",
  "structuredData": { "refund_id": "ref_456", "amount": 29.99, "status": "completed" },
  "respondedBy": "support-team",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z"
}
```

### Response fields

| Field             | Required | Description                                    |
|-------------------|----------|------------------------------------------------|
| `body`            | no*      | Human-readable response text                   |
| `structured_data` | no*      | Structured response data (JSON object)         |
| `responded_by`    | no       | Who responded (defaults to `"api"` or `"dashboard"`) |

\* At least one of `body` or `structured_data` must be provided.

## Poll for response

### `GET /.agent/inbox/:id`

Agents poll this endpoint to check for responses:

```bash
curl https://agent-json.com/.agent/inbox/msg_abc123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```json
{
  "id": "msg_abc123",
  "status": "responded",
  "action": "request_refund",
  "auto_reply": "We've received your refund request.",
  "routed_to": "refund@agent-json.com",
  "received_at": "2025-01-15T10:00:00.000Z",
  "response": {
    "id": "resp_xyz789",
    "body": "Refund processed successfully.",
    "structured_data": { "refund_id": "ref_456", "amount": 29.99, "status": "completed" },
    "responded_at": "2025-01-15T10:30:00.000Z"
  }
}
```

When polled, pending responses are automatically marked as `delivered`.

## E-commerce example

A complete purchase-and-refund flow:

```
1. Agent discovers actions:
   GET /.well-known/agent.json
   -> sees "request_refund" with response_schema { refund_id, amount, status }

2. Agent sends refund request:
   POST /.agent/inbox
   {
     "from": { "agent": "shopping-bot", "callback_url": "https://bot.example/hooks" },
     "action": "request_refund",
     "parameters": { "order_id": "ORD-789", "reason": "damaged" }
   }
   -> { "id": "msg_001", "status": "routed" }

3. Support team responds:
   POST /.agent/inbox/msg_001/respond
   {
     "body": "Refund approved.",
     "structured_data": { "refund_id": "REF-456", "amount": 49.99, "status": "completed" }
   }

4. Agent receives callback (or polls):
   -> { "refund_id": "REF-456", "amount": 49.99, "status": "completed" }

5. Agent confirms to customer: "Your refund of $49.99 (REF-456) has been processed."
```
