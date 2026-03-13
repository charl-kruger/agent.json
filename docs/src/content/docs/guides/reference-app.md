---
title: Reference Application
description: A production-ready agent.json implementation built on Cloudflare Workers — fork it or use it as a blueprint for your own.
---

agent.json is a platform-agnostic protocol. You can implement it on Vercel, AWS, a Rails app, a Go binary — anything that serves HTTP. The protocol is the standard; the infrastructure is your choice.

This page documents the **reference implementation** in `workers/agent-json`, which happens to use Cloudflare Workers. It's the same application running at [agent-json.com](https://agent-json.com). Fork it to get started fast, or read it as a blueprint for building your own implementation on whatever stack you prefer.

## Architecture

This implementation uses Cloudflare Workers with a single [Durable Object](https://developers.cloudflare.com/durable-objects/) for state. The architecture choices here are specific to this implementation — the protocol itself has no opinion on your database, runtime, or hosting.

```
Agent HTTP request
      ↓
[Cloudflare Worker] → auth + rate limit
      ↓
[Durable Object: InboxAgent]
      ├── SQLite (messages, actions, responses, config)
      ├── Workers AI (intent classification)
      ├── Email Service (delivery)
      └── WebSocket (dashboard updates)
```

**Key bindings** (from `wrangler.jsonc`):

| Binding        | Purpose                                         |
|----------------|--------------------------------------------------|
| `AI`           | Cloudflare Workers AI for intent classification  |
| `EMAIL`        | Cloudflare Email Service for delivery            |
| `InboxAgent`   | Durable Object namespace for state               |

## Two ways to receive messages

### Structured actions

When an agent knows what it wants, it sends a named action with parameters:

```json
{
  "from": { "agent": "refund-bot" },
  "action": "request_refund",
  "parameters": { "order_id": "ORD-123", "reason": "damaged" }
}
```

The app validates parameters against the action's JSON Schema, routes to the configured email, and responds immediately. No AI involved — it's deterministic.

### Free-form messages

When an agent sends a subject and body instead of a named action, the app classifies intent using AI:

```json
{
  "from": { "agent": "customer-agent" },
  "subject": "Help with my order",
  "body": "Order #1234 arrived damaged, I'd like a refund."
}
```

The message status moves from `"received"` → `"classifying"` → `"routed"`. The AI picks the best-matching action and assigns a confidence score.

## AI classification

Intent classification uses **Llama 3.1 70B** via [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/). The classifier receives:

- The list of configured actions with descriptions
- A `"general"` fallback category
- The message subject and body

It returns a structured object with `intent`, `confidence` (0–1), and `reasoning`. If confidence drops below 0.4, the message routes to the default email as `"general"`.

```
// classify.ts — the full classification prompt
"You are a message classification system. Classify the following
message into one of the available intents.

Available intents:
- "request_refund": Request a refund for an order
- "get_support": Technical support and help
- "general": Any message that doesn't clearly fit the above categories

Message subject: Help with my order
Message body: Order #1234 arrived damaged...

Classify this message. Pick the single best matching intent.
If confidence is below 0.4, use "general"."
```

The AI model is called via the [Vercel AI SDK](https://sdk.vercel.ai/) with the `workers-ai-provider`, using `generateObject` for structured output with a Zod schema.

## Email routing

Every routed message generates a formatted email sent via Cloudflare's Email Service. The email includes:

- Source agent name and delegation info (`on_behalf_of`)
- Action name and confidence score
- Priority level
- Full parameters (structured) or message body (free-form)
- The message ID for reference

Each action maps to a specific email address. Unmatched messages go to the default email. If you configure `refund@yoursite.com` for the `request_refund` action, that's exactly where it lands.

## Responding to messages

The app supports three response modes, advertised in the discovery document:

### Sync
The initial `POST /.agent/inbox` returns a message ID and status immediately. If an auto-reply is configured for the action, it's included in the response.

### Polling
Agents call `GET /.agent/inbox/:id` to check for responses. When a human responds via the dashboard (or via the API), the response appears:

```json
{
  "id": "msg_abc",
  "status": "responded",
  "response": {
    "id": "res_xyz",
    "body": "Refund processed",
    "structured_data": { "refund_id": "ref_123", "amount": 29.99 },
    "responded_at": "2025-01-15T10:30:00Z"
  }
}
```

### Callbacks
Agents can provide a `callback_url` in the `from` object. When a response is sent, the app delivers it via POST with HMAC-SHA256 signing:

```
POST https://agent-callback.example.com/webhooks/inbox
X-AgentInbox-Signature: <hex-encoded HMAC>
X-AgentInbox-Timestamp: <unix timestamp>

{
  "message_id": "msg_abc",
  "response_id": "res_xyz",
  "body": "Refund processed",
  "structured_data": { "refund_id": "ref_123", "amount": 29.99 },
  "responded_by": "dashboard",
  "responded_at": "2025-01-15T10:30:00Z"
}
```

The signature covers `${timestamp}.${body}` using the auth token as the HMAC key. Failed deliveries are retried once via Durable Object alarms.

## Dashboard

The worker serves a full React dashboard at the root URL with three tabs:

### Messages

A two-panel view: message list on the left, detail on the right. Each message shows its source agent, action, status, confidence score, and routing info. Click a message to see full parameters, metadata, and response history.

The respond form lets you type a text response and optionally attach structured JSON data. Responses are delivered to agents via their chosen response mode.

### Configuration

Set up your site:
- **Domain** and **default email** for routing
- **Site name** and **description** (shown in the discovery document)
- **Auth token** generation for API access
- **Rate limit** per minute
- **Actions** with parameter schemas, descriptions, auto-replies, and response schemas

### Chat copilot

A built-in AI assistant that can query your inbox data. Ask questions like:

- *"How many messages were routed today?"*
- *"Show me failed deliveries from the last week"*
- *"What are the most common actions?"*
- *"Which agents are messaging me most?"*

The copilot has tool access to search messages, view statistics, and inspect individual message details. It uses Cloudflare Workers AI with streaming responses.

## Real-time updates

The dashboard connects to the Durable Object via WebSocket (using the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)). When a new message arrives or a response is sent, the dashboard updates instantly — no polling or refresh needed.

Events broadcast to connected clients:
- `message-routed` — new message processed
- `message-responded` — response sent
- `action-changed` — action configuration modified

## Project structure

```
workers/agent-json/
├── src/
│   ├── server.ts       # Durable Object, API routes, email templates
│   ├── app.tsx          # React dashboard (messages, config, copilot)
│   ├── types.ts         # TypeScript interfaces and DB row types
│   ├── well-known.ts    # Discovery document builder
│   ├── classify.ts      # AI intent classification
│   ├── client.tsx       # React entry point
│   └── styles.css       # Dashboard styles
├── wrangler.jsonc       # Cloudflare Worker configuration
└── package.json         # Dependencies
```

## Extending it

The reference app is designed to be forked. Common extensions:

- **Add new actions** via the dashboard UI or by editing the Durable Object directly
- **Custom email templates** — modify the `buildHtmlEmail()` and `buildTextEmail()` functions in `server.ts`
- **Different AI models** — change `AI_MODEL` in `classify.ts` to any model
- **Additional response channels** — the respond endpoint accepts any `responded_by` value, so you can build automation that responds programmatically
- **Webhook integrations** — use the callback mechanism to push responses to Slack, Discord, or any other service

## Building your own implementation

You don't need to use this reference app — or Cloudflare — to adopt agent.json. The protocol is three HTTP endpoints that any web server can implement:

| Endpoint | Purpose |
|----------|---------|
| `GET /.well-known/agent.json` | Serve a JSON discovery document describing your actions |
| `POST /.agent/inbox` | Accept incoming messages from agents |
| `GET /.agent/inbox/:id` | Return message status and responses |

The rest — how you store messages, classify intent, send emails, render a dashboard — is entirely up to you. A minimal implementation could be a single Express route, a Next.js API handler, a Django view, or a Go HTTP handler. See the [Protocol](/protocol/discovery/) docs for the complete spec.
