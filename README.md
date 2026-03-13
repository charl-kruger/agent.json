# agentpop

**DNS for AI messages. Give your website an inbox that any agent can reach — and respond back.**

A simple standard (`/.well-known/agent.json`) that makes every website message-addressable with bidirectional AI agent communication.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `agent-inbox` | [`workers/agent-inbox`](./workers/agent-inbox) | Cloudflare Worker — message routing, responses, callbacks |
| `docs` | [`docs`](./docs) | Protocol documentation (Astro Starlight) |

## Quick start

```bash
pnpm install
pnpm dev          # Run the agent-inbox worker
pnpm dev:docs     # Run the docs site
```

## Deploy

```bash
pnpm deploy       # Deploy the worker
pnpm deploy:docs  # Deploy the docs
```

## How it works

```
AI Agent                          Your Website (agent-inbox)
  |                                        |
  +- GET /.well-known/agent.json --------->|  Discover actions + response schemas
  |<-- actions, response_modes, schemas ---|
  |                                        |
  +- POST /.agent/inbox ------------------>|  Send message (structured or free-form)
  |<-- { status: "routed", id: "msg_123" } |
  |                                        |
  +- GET /.agent/inbox/msg_123 ----------->|  Poll for response
  |<-- { response: { body, data } } -------|
```

See the [full documentation](./docs) for protocol details, API reference, and examples.

## License

MIT
