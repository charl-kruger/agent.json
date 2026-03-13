---
title: API Reference
description: Complete API reference for agent.json endpoints.
---

## Endpoints

### `GET /.well-known/agent.json`

Returns the discovery document describing available actions, authentication, and response modes.

**Authentication:** None required

**Response:** `200 OK`

---

### `POST /.agent/inbox`

Send a message to the inbox.

**Authentication:** Bearer token

**Request body:**

```typescript
{
  from: {
    agent: string;           // Required — agent identifier
    on_behalf_of?: string;   // End-user the agent acts for
    callback_url?: string;   // URL for async response delivery
  };
  action?: string;           // Action name (structured mode)
  parameters?: object;       // Action parameters (structured mode)
  subject?: string;          // Subject line (free-form mode)
  body?: string;             // Message body (free-form mode, max 50,000 chars)
  priority?: "low" | "normal" | "high" | "urgent";
  thread_id?: string;        // Conversation tracking
  metadata?: object;         // Arbitrary key-value data
}
```

**Response:** `200 OK` (routed) or `400`/`401`/`429`/`502` (error)

```typescript
{
  id: string;
  status: "routed" | "failed";
  action: string;
  auto_reply: string | null;
  message: string;
}
```

---

### `GET /.agent/inbox/:id`

Check message status and poll for responses.

**Authentication:** Bearer token

**Response:** `200 OK` or `404`

```typescript
{
  id: string;
  status: "received" | "classifying" | "routed" | "failed" | "responded";
  action: string | null;
  auto_reply: string | null;
  routed_to: string | null;
  received_at: string;
  response: {
    id: string;
    body: string | null;
    structured_data: object;
    responded_at: string;
  } | null;
}
```

---

### `POST /.agent/inbox/:id/respond`

Respond to a message.

**Authentication:** Bearer token

**Request body:**

```typescript
{
  body?: string;              // Human-readable response text
  structured_data?: object;   // Structured response data
  responded_by?: string;      // Who responded (default: "api")
}
```

At least one of `body` or `structured_data` must be provided.

**Response:** `201 Created` or `400`/`401`/`404`

```typescript
{
  id: string;
  messageId: string;
  status: "pending" | "delivered" | "failed";
  body: string | null;
  structuredData: object;
  respondedBy: string;
  createdAt: string;
  updatedAt: string;
}
```

## Status values

### Message status

| Status        | Description                           |
|---------------|---------------------------------------|
| `received`    | Message received, not yet processed   |
| `classifying` | AI is classifying the message         |
| `routed`      | Successfully routed to email          |
| `failed`      | Routing failed                        |
| `responded`   | A response has been sent              |

### Response status

| Status      | Description                                    |
|-------------|------------------------------------------------|
| `pending`   | Response created, not yet delivered to agent    |
| `delivered` | Delivered via callback or picked up via polling |
| `failed`    | Callback delivery failed                        |
