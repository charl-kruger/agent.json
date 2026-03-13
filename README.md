# agent.json

**The open protocol that makes every website reachable by AI agents.**

`robots.txt` told crawlers what to read. `agent.json` tells agents how to talk.

A single discovery document at `/.well-known/agent.json` turns any website from a destination humans visit into a service agents can transact with — and get answers from.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `agent-json` | [`workers/agent-json`](./workers/agent-json) | Cloudflare Worker — reference implementation |
| `docs` | [`docs`](./docs) | Protocol documentation (Astro Starlight) |

## Quick start

```bash
pnpm install
pnpm dev          # Run the agent.json worker
pnpm dev:docs     # Run the docs site
```

## Deploy

```bash
pnpm deploy       # Deploy the worker
pnpm deploy:docs  # Deploy the docs
```

## How it works

```
AI Agent                          Your Website (agent.json)
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

See the [full documentation](./docs) for the protocol proposal, API reference, integration guides, and examples.

## License

MIT
