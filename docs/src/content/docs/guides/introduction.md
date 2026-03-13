---
title: Introduction
description: What agent-inbox is and why it exists.
---

In a world of AI agents, contacting a website shouldn't require knowing the right email address or navigating a contact form. **agent-inbox** gives your website an inbox that any agent can reach — and respond back to.

Think of it as `robots.txt` for the agentic web: a simple standard (`/.well-known/agent.json`) that makes every website message-addressable with bidirectional communication.

## The problem

AI agents need to interact with websites on behalf of users — requesting refunds, filing support tickets, making inquiries. Today there's no standard way for an agent to:

1. **Discover** what a website accepts (what actions, what parameters)
2. **Send** a structured message with validated data
3. **Receive** a response back with structured results

## The solution

agent-inbox provides:

- **A discovery document** at `/.well-known/agent.json` that describes available actions with JSON Schema parameters and response schemas
- **A message endpoint** at `/.agent/inbox` that accepts structured or free-form messages, validates parameters, and routes to email
- **A response system** that lets website owners respond back via dashboard, API, or automated callbacks
- **Three response modes**: sync (immediate auto-reply), poll (agent checks back), callback (signed webhook delivery)

## Architecture

Built on [Cloudflare Workers](https://developers.cloudflare.com/workers/) with the [Agents SDK](https://developers.cloudflare.com/agents/):

- **Durable Object** (`InboxAgent`) with SQLite for config, actions, messages, and responses
- **Workers AI** for free-form message classification
- **Cloudflare Email Service** for outbound email routing
- **HMAC-SHA256 signed callbacks** for secure response delivery
- **React + Kumo** dashboard with real-time WebSocket updates
