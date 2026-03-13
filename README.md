# agent-inbox

**DNS for AI messages. Give your website an inbox that any agent can reach — and respond back.**

In a world of AI agents, contacting a website shouldn't require knowing the right email address or navigating a contact form. With `agent-inbox`, any AI agent can send a message to your website — your site's AI classifies the intent, routes it to the correct email, and you can respond back to the agent with structured data.

Think of it as `robots.txt` for the agentic web: a simple standard (`/.well-known/agent.json`) that makes every website message-addressable with bidirectional communication.

## How It Works

```
AI Agent                          Your Website (agent-inbox)
  |                                        |
  +- GET /.well-known/agent.json ---------->|  "What actions can I call?"
  |<-- actions, response_modes, schemas ----|
  |                                        |
  |  Structured (direct action call):      |
  +- POST /.agent/inbox ------------------>|  { action: "request_refund", parameters: { order_id: "123" } }
  |                                        |
  |                                   +----|
  |                                   | 1. Authenticate (bearer token)
  |                                   | 2. Validate parameters
  |                                   | 3. Route -> refund@yoursite.com
  |                                   | 4. Send email (Cloudflare Email)
  |                                   +----|
  |                                        |
  |<-- { status: "routed", id: "msg_123" } |
  |                                        |
  |  Poll for response:                    |
  +- GET /.agent/inbox/msg_123 ----------->|
  |<-- { response: { body, data } } -------|
  |                                        |
  |  Or receive callback:                  |
  |<-- POST callback_url (HMAC signed) ----|
```

## Quick Start

### Prerequisites

- A [Cloudflare](https://cloudflare.com) account with a domain
- The domain's email sending configured in Cloudflare Dashboard (Compute & AI > Email Service > Email Sending) — Cloudflare will add SPF and DKIM records automatically

### Deploy

```bash
git clone <this-repo>
cd agent-inbox
npm install
npm run deploy
```

### Configure

1. Open your deployed worker URL in a browser
2. Go to the **Configuration** tab
3. Set your **domain** (e.g. `charl.dev`) and **default email** (e.g. `hello@charl.dev`)
4. **Generate an auth token** — agents use this to authenticate
5. **Add actions** — define callable actions with parameter schemas and optional response schemas:

| Action          | Email                     | Description                         | Parameters | Response Schema |
|-----------------|---------------------------|-------------------------------------|------------|-----------------|
| `request_refund`| `refund@charl.dev`        | Request a refund for an order       | `order_id` (string, required), `reason` (string, required) | `refund_id` (string), `amount` (number), `status` (string) |
| `get_support`   | `support@charl.dev`       | Technical support and help          | `topic` (string), `severity` (string) | |
| `partnership`   | `partnerships@charl.dev`  | Business partnership inquiries      | | |
| `bug_report`    | `engineering@charl.dev`   | Bug reports and issues              | `component` (string, required) | `ticket_id` (string), `assigned_to` (string) |

Messages that don't match any action route to your default email.

## The Protocol

### Discovery: `GET /.well-known/agent.json`

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
    },
    {
      "name": "get_support",
      "description": "Technical support and help",
      "parameters": {
        "type": "object",
        "properties": {
          "topic": { "type": "string", "description": "Support topic" }
        },
        "required": []
      }
    }
  ],
  "rate_limit": { "requests_per_minute": 60 },
  "response_modes": ["sync", "poll", "callback"]
}
```

**Response modes:**
- `sync` — the initial POST returns routing status and auto-reply immediately
- `poll` — agent polls `GET /.agent/inbox/:id` to check for responses
- `callback` — agent provides a `callback_url` and receives responses via signed POST

### Send a Message: `POST /.agent/inbox`

**Two modes of messaging:**

#### Structured (action call — no AI needed)

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

Routes directly — parameters are validated against the action's schema. Returns 400 if the action doesn't exist or required parameters are missing.

#### Free-form (AI classifies)

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

AI classifies the message against your configured actions and routes to the best match.

#### Message Fields

| Field              | Required | Description                                           |
|--------------------|----------|-------------------------------------------------------|
| `from.agent`       | yes      | Identifier for the sending agent                      |
| `from.on_behalf_of`| no       | The end-user the agent is acting for                  |
| `from.callback_url`| no       | URL for async response delivery (HMAC-signed POST)    |
| `action`           | no*      | Action to call (structured mode) — validated against configured actions |
| `parameters`       | no       | Parameters for the action (structured mode)           |
| `subject`          | no*      | Message subject line (free-form mode)                 |
| `body`             | no       | Message content, up to 50,000 chars (free-form mode)  |
| `priority`         | no       | `low`, `normal` (default), `high`, or `urgent`        |
| `thread_id`        | no       | Thread identifier for conversation tracking           |
| `metadata`         | no       | Arbitrary key-value data attached to the message      |

\* At least one of `action` or `subject` must be provided.

#### Response

```json
{
  "id": "msg_abc123",
  "status": "routed",
  "action": "request_refund",
  "auto_reply": "We've received your refund request and will process it within 48 hours.",
  "message": "Message routed via action \"request_refund\" to refund@charl.dev."
}
```

### Respond to a Message: `POST /.agent/inbox/:id/respond`

The website owner (or an automated system) can respond back to the agent:

```bash
curl -X POST https://charl.dev/.agent/inbox/msg_abc123/respond \
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

### Poll for Response: `GET /.agent/inbox/:id`

```bash
curl https://charl.dev/.agent/inbox/msg_abc123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```json
{
  "id": "msg_abc123",
  "status": "responded",
  "action": "request_refund",
  "auto_reply": "We've received your refund request and will process it within 48 hours.",
  "routed_to": "refund@charl.dev",
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

### Callback Delivery

If the agent provides a `callback_url` when sending a message, responses are automatically delivered via POST with HMAC-SHA256 signing:

**Headers:**
- `X-AgentInbox-Signature` — HMAC-SHA256 hex digest of `{timestamp}.{body}`
- `X-AgentInbox-Timestamp` — Unix timestamp of signature creation

**Verification (Node.js example):**

```javascript
const crypto = require('crypto');

function verifySignature(body, signature, timestamp, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}
```

The signing key is the inbox's auth token. If callback delivery fails, it retries once after 5 minutes via Durable Object alarms.

### E-commerce Example Flow

A complete purchase-and-refund flow using agent-inbox:

```
1. Agent discovers actions:
   GET /.well-known/agent.json
   -> sees "request_refund" action with response_schema { refund_id, amount, status }

2. Agent sends refund request:
   POST /.agent/inbox
   {
     "from": { "agent": "shopping-bot", "callback_url": "https://bot.example/hooks" },
     "action": "request_refund",
     "parameters": { "order_id": "ORD-789", "reason": "damaged" }
   }
   -> 200: { "id": "msg_001", "status": "routed", "auto_reply": "We'll process your refund." }

3. Support team processes refund and responds via dashboard (or API):
   POST /.agent/inbox/msg_001/respond
   {
     "body": "Refund approved and processed.",
     "structured_data": { "refund_id": "REF-456", "amount": 49.99, "status": "completed" }
   }

4. Agent receives callback (or polls):
   POST https://bot.example/hooks  (HMAC signed)
   {
     "message_id": "msg_001",
     "response_id": "resp_002",
     "body": "Refund approved and processed.",
     "structured_data": { "refund_id": "REF-456", "amount": 49.99, "status": "completed" },
     "responded_by": "support-team",
     "responded_at": "2025-01-15T11:00:00.000Z"
   }

5. Agent confirms to customer: "Your refund of $49.99 (REF-456) has been processed."
```

## Dashboard

The built-in web UI provides three views:

- **Dashboard** — message stats (total, routed, failed, last 24h), top actions, message list with detail panel showing routing decisions, metadata, response history, and a respond form
- **Configuration** — set domain, default email, auth token, and actions with parameter schemas and response schemas — all stored in SQLite, no config files needed
- **Chat Copilot** — AI assistant that can query your inbox ("Show me failed deliveries", "What are the most common actions this week?")

## Architecture

Built on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with the [Agents SDK](https://developers.cloudflare.com/agents/):

- **Durable Object** (`InboxAgent`) with SQLite for config, actions, messages, and responses
- **Workers AI** for free-form message classification
- **Cloudflare Email Service** for outbound email routing
- **HMAC-SHA256 signed callbacks** for secure response delivery
- **Durable Object Alarms** for callback retry on failure
- **React + Kumo** dashboard with real-time WebSocket updates

```
agent-inbox/
  src/
    server.ts       # Worker entry + InboxAgent DO (routing, responses, callbacks)
    classify.ts     # AI intent classification (free-form fallback)
    well-known.ts   # Discovery document builder
    types.ts        # TypeScript types
    app.tsx         # React dashboard UI
    client.tsx      # React entry point
    styles.css      # Styles
  wrangler.jsonc    # Worker configuration
```

## Development

```bash
npm install
npm run dev       # Start local dev server (uses remote AI + Email bindings)
npm run deploy    # Build and deploy to Cloudflare
npm run types     # Regenerate TypeScript types from wrangler config
```

## How Routing Works

1. An agent `POST`s a message to `/.agent/inbox`
2. **Structured mode**: If the agent provides an `action` name, parameters are validated against the action's schema and the message routes directly (confidence: 100%)
3. **Free-form mode**: If the agent sends `subject` + `body`, Workers AI classifies the message against your configured actions
4. The message is forwarded as a formatted email to the matched action's email address (or the default email if no match)
5. If the action has an auto-reply configured, it's returned in the response
6. The full audit trail (classification, confidence, routing decision) is stored in SQLite and visible in the dashboard
7. **Respond**: The website owner responds via the dashboard UI or `POST /.agent/inbox/:id/respond`
8. **Delivery**: If the agent provided a `callback_url`, the response is delivered via HMAC-signed POST. Otherwise, the agent polls `GET /.agent/inbox/:id` to retrieve it.

## License

MIT
