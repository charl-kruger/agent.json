---
title: "Why agent.json exists"
description: A proposal for making every website message-addressable by AI agents.
---

## The trillion-dollar friction problem

Here is a truth about the internet that is easy to overlook: **the web was designed for humans to browse, not for software to transact.**

When a person wants to contact a business, they find a contact page, fill in a form, and wait. When an API client wants to transact, it uses a documented endpoint with structured data. But when an AI agent — acting on behalf of a person — wants to do something as simple as request a refund, book an appointment, or ask a question, it falls into a gap between these two worlds.

The agent is too sophisticated for a contact form. But there is no API for it to call, because the website never expected software to show up at the front door with a structured request.

This gap is not a technology problem. It is a *convention* problem. And convention problems have convention solutions.

## What `robots.txt` teaches us

In 1994, the web had a crawler problem. Search engines were indexing everything — private directories, staging servers, pages that weren't ready. Website owners had no way to say "you can look here, but not there."

The solution was a 25-line text file at a well-known path: `/robots.txt`. No committee. No complex standard. Just a convention that said: *if you're a bot, read this file first.*

It worked not because it was technically impressive, but because it was **simple enough that everyone adopted it**. The cost of participation was near zero — add a text file to your root directory and you've opted in to a global protocol.

`robots.txt` solved crawlability. **`agent.json` solves contactability.**

## The protocol

agent.json proposes three things:

### 1. A discovery document

A JSON file at `/.well-known/agent.json` that tells any agent:
- What actions this website accepts (with JSON Schema parameter validation)
- How to authenticate
- What response modes are supported (sync, polling, callbacks)
- What structured data the response will contain

This is the equivalent of a restaurant putting its menu in the window. You don't need to walk in and ask what they serve — you can read it from the street.

### 2. A message endpoint

`POST /.agent/inbox` — a single endpoint that accepts both:
- **Structured messages**: "Call the `request_refund` action with `order_id: 123`" — validated against the schema, routed instantly
- **Free-form messages**: "Hi, I'd like a refund for my order" — classified by AI, routed to the best match

This dual mode is important. It means agents at *any level of sophistication* can participate. A simple script can call a named action. A language model can compose a free-form message. Both reach the same destination.

### 3. Bidirectional responses

The agent sends a message. The website responds — with structured data, through the dashboard, or via HMAC-signed webhook callbacks. The agent gets a machine-readable answer it can act on.

This closes the loop. Without responses, agent.json would be a fancy contact form. *With* responses, it becomes a transaction protocol.

## Why this matters more than it seems

The economics of agent interaction follow a power law of friction. When it's easy for agents to interact with your website, the number of possible transactions explodes. When it's hard, agents route around you to competitors who made it easy, or to aggregator platforms that intermediate (and capture value from) the interaction.

Consider what happened with APIs:
- Businesses that exposed APIs early (Stripe, Twilio, SendGrid) became infrastructure.
- Businesses that didn't got disintermediated by those that did.

The same dynamic is playing out with agents, but faster. An AI agent choosing between two equivalent services will always prefer the one it can interact with programmatically. **The question is not whether your website will need to be agent-addressable, but whether the protocol for that will be an open standard or a proprietary platform.**

## Design principles

### Minimum viable convention

The smallest useful protocol that solves the problem. One discovery document. One message endpoint. One response mechanism. No orchestration layer, no complex handshakes, no mandatory dependencies.

### Progressive sophistication

A static website can participate by serving a JSON file with a single action. A large e-commerce platform can participate with dozens of actions, response schemas, callback webhooks, and automated responses. Same protocol, different scale.

### Email as the routing layer

Rather than requiring websites to build new infrastructure, agent.json routes messages to email — something every business already has. This means adoption cost is near zero. You're not replacing your support system; you're adding an agent-accessible front door to it.

### Bidirectional by default

One-way messaging is a notification system. Two-way messaging is a transaction protocol. By including responses from day one — with structured data, polling, and signed callbacks — agent.json supports the complete lifecycle of an agent interaction.

## What this enables

**E-commerce**: An agent requests a refund with order details. The support team responds with a refund ID and amount. The agent confirms to the customer. No human touched a keyboard on the customer's side.

**Professional services**: An agent books a consultation by calling a `book_meeting` action with preferred times. The business responds with a confirmed slot. Done.

**Support**: An agent files a bug report with structured data (component, severity, reproduction steps). Engineering gets a clean ticket. The agent polls for a response and updates the user when there's a fix.

**B2B**: An agent sends a partnership inquiry on behalf of its company. The response includes a meeting link and a PDF proposal. The agent summarizes it for its operator.

None of these require the website to build a custom API. They just need a discovery document and an inbox.

## The path forward

agent.json is a protocol, not a platform. The discovery document at `/.well-known/agent.json`, the message endpoint at `/.agent/inbox`, the response mechanism — all of it is designed to be implemented on any stack. Express, Next.js, Django, Rails, Go, Cloudflare Workers, AWS Lambda, a static file server with a simple backend — if it serves HTTP, it can speak agent.json.

We provide a [reference implementation](/guides/reference-app/) built on Cloudflare Workers to get started fast, but it's one implementation of the protocol, not the protocol itself.

The value of this protocol is proportional to the number of websites that adopt it. Like `robots.txt`, like `sitemap.xml`, like `/.well-known/openid-configuration` — the power comes from the convention, not the implementation.

We are at the beginning of the agentic web. The choices we make now about how agents and websites communicate will shape the next decade of the internet. An open, simple, decentralized protocol gives everyone a seat at the table.

**That's what agent.json is for.**
