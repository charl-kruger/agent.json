# agent-inbox

**DNS for AI messages. Give your website an inbox that any agent can reach.**

In a world of AI agents, contacting a website shouldn't require knowing the right email address or navigating a contact form. With `agent-inbox`, any AI agent can send a message to your website — your site's AI classifies the intent and routes it to the correct email automatically.

Think of it as `robots.txt` for the agentic web: a simple standard (`/.well-known/agent.json`) that makes every website message-addressable.

## How It Works

```
AI Agent                          Your Website (agent-inbox)
  │                                        │
  ├─ GET /.well-known/agent.json ─────────►│  "What can I message you about?"
  │◄── capabilities, intents, auth ────────┤
  │                                        │
  ├─ POST /api/message ───────────────────►│  "Customer wants a refund for order #1234"
  │                                        │
  │                                   ┌────┤
  │                                   │ 1. Authenticate (bearer token)
  │                                   │ 2. Classify intent (Workers AI)
  │                                   │ 3. Route → refund@yoursite.com
  │                                   │ 4. Send email (Cloudflare Email)
  │                                   └────┤
  │                                        │
  │◄── { status: "routed",  ───────────────┤
  │      classified_intent: "refund",      │
  │      auto_reply: "We'll process..." }  │
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
5. **Add intent routes** — map intents to email addresses:

| Intent        | Email                     | Description                        |
|---------------|---------------------------|------------------------------------|
| `refund`      | `refund@charl.dev`        | Product returns and refund requests|
| `support`     | `support@charl.dev`       | Technical support and help         |
| `partnership` | `partnerships@charl.dev`  | Business partnership inquiries     |
| `bug_report`  | `engineering@charl.dev`   | Bug reports and issues             |

Messages that don't match any intent route to your default email.

## The Protocol

### Discovery: `GET /.well-known/agent.json`

Any AI agent can discover your inbox capabilities:

```json
{
  "version": "1.0",
  "name": "Charl's Website",
  "description": "Personal website and business",
  "message_endpoint": "https://charl.dev/api/message",
  "authentication": {
    "type": "bearer",
    "header": "Authorization"
  },
  "capabilities": ["refund", "support", "partnership", "bug_report"],
  "intents": [
    { "name": "refund", "description": "Product returns and refund requests" },
    { "name": "support", "description": "Technical support and help" },
    { "name": "partnership", "description": "Business partnership inquiries" },
    { "name": "bug_report", "description": "Bug reports and issues" }
  ],
  "rate_limit": { "requests_per_minute": 60 },
  "response_modes": ["sync"]
}
```

### Send a Message: `POST /api/message`

```bash
curl -X POST https://charl.dev/api/message \
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

#### Message Fields

| Field              | Required | Description                                           |
|--------------------|----------|-------------------------------------------------------|
| `from.agent`       | yes      | Identifier for the sending agent                      |
| `from.on_behalf_of`| no       | The end-user the agent is acting for                  |
| `from.callback_url`| no       | URL for async responses (reserved for v2)             |
| `intent`           | no       | Declared intent — skips AI classification if it matches a configured route |
| `subject`          | yes      | Message subject line                                  |
| `body`             | yes      | Message content (up to 50,000 chars)                  |
| `priority`         | no       | `low`, `normal` (default), `high`, or `urgent`        |
| `thread_id`        | no       | Thread identifier for conversation tracking (reserved for v2) |
| `metadata`         | no       | Arbitrary key-value data attached to the message      |

#### Response

```json
{
  "id": "msg_abc123",
  "status": "routed",
  "classified_intent": "refund",
  "auto_reply": "We've received your refund request and will process it within 48 hours.",
  "message": "Message classified as \"refund\" and routed successfully."
}
```

### Check Message Status: `GET /api/message/:id`

```bash
curl https://charl.dev/api/message/msg_abc123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Dashboard

The built-in web UI provides three views:

- **Dashboard** — message stats (total, routed, failed, last 24h), top intents, message list with detail panel showing routing decisions and metadata
- **Configuration** — set domain, default email, auth token, and intent routes — all stored in SQLite, no config files needed
- **Chat Copilot** — AI assistant that can query your inbox ("Show me failed deliveries", "What are the most common intents this week?")

## Architecture

Built on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with the [Agents SDK](https://developers.cloudflare.com/agents/):

- **Durable Object** (`InboxAgent`) with SQLite for config, routes, and message history
- **Workers AI** for intent classification
- **Cloudflare Email Service** for outbound email routing
- **React + Kumo** dashboard with real-time WebSocket updates

```
agent-inbox/
  src/
    server.ts       # Worker entry + InboxAgent DO
    classify.ts     # AI intent classification
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

1. An agent `POST`s a message to `/api/message`
2. If the agent declares an `intent` that matches a configured route, it's used directly (confidence: 100%)
3. Otherwise, Workers AI classifies the message against your configured intents
4. The message is forwarded as a formatted email to the matched route's email address (or the default email if no match)
5. If the route has an auto-reply configured, it's returned in the response
6. The full audit trail (classification, confidence, routing decision) is stored in SQLite and visible in the dashboard

## License

MIT
