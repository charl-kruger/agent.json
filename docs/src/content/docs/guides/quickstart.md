---
title: Quick Start
description: Deploy agent.json in minutes.
---

## Prerequisites

- A [Cloudflare](https://cloudflare.com) account with a domain
- The domain's email sending configured in Cloudflare Dashboard (Compute & AI > Email Service > Email Sending) — Cloudflare will add SPF and DKIM records automatically

## Deploy

```bash
git clone https://github.com/charl-kruger/agent.json.git
cd agent.json/workers/agent-json
pnpm install
pnpm run deploy
```

## Configure

1. Open your deployed worker URL in a browser
2. Go to the **Configuration** tab
3. Set your **domain** (e.g. `agent-json.com`) and **default email** (e.g. `hello@agent-json.com`)
4. **Generate an auth token** — agents use this to authenticate
5. **Add actions** — define callable actions with parameter schemas and optional response schemas

Example actions:

| Action          | Email                     | Description                         |
|-----------------|---------------------------|-------------------------------------|
| `request_refund`| `refund@agent-json.com`        | Request a refund for an order       |
| `get_support`   | `support@agent-json.com`       | Technical support and help          |
| `partnership`   | `partnerships@agent-json.com`  | Business partnership inquiries      |
| `bug_report`    | `engineering@agent-json.com`   | Bug reports and issues              |

Messages that don't match any action route to your default email.

## Test it

Send a structured message:

```bash
curl -X POST https://your-domain.com/.agent/inbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "from": { "agent": "test-agent" },
    "action": "get_support",
    "parameters": { "topic": "setup help" }
  }'
```

## Development

```bash
pnpm install
pnpm run dev       # Start local dev server
pnpm run deploy    # Build and deploy to Cloudflare
```
