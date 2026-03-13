---
title: Vercel AI SDK
description: Use agent.json with the Vercel AI SDK's tool system.
---

The Vercel AI SDK's `tool()` function works perfectly with agent.json actions. The parameter schemas are already JSON Schema objects — the same format the AI SDK expects.

## Setup

### 1. Create tools from the discovery document

```typescript
import { generateText, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const INBOX_URL = "https://example.com/.agent/inbox";
const TOKEN = "your-bearer-token";

// Fetch discovery document
const discovery = await fetch("https://example.com/.well-known/agent.json")
  .then(r => r.json());

// Helper to convert JSON Schema types to Zod
function jsonSchemaToZod(props: Record<string, any>, required: string[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, schema] of Object.entries(props)) {
    let field: z.ZodTypeAny;
    switch (schema.type) {
      case "number": field = z.number().describe(schema.description ?? ""); break;
      case "boolean": field = z.boolean().describe(schema.description ?? ""); break;
      default: field = z.string().describe(schema.description ?? "");
    }
    if (schema.enum) field = z.enum(schema.enum).describe(schema.description ?? "");
    if (!required.includes(name)) field = field.optional();
    shape[name] = field;
  }
  return z.object(shape);
}
```

### 2. Build the tools object

```typescript
const inboxTools: Record<string, ReturnType<typeof tool>> = {};

for (const action of discovery.actions) {
  const schema = jsonSchemaToZod(
    action.parameters.properties,
    action.parameters.required
  );

  inboxTools[action.name] = tool({
    description: action.description,
    parameters: schema,
    execute: async (params) => {
      const response = await fetch(INBOX_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          from: { agent: "vercel-ai-agent" },
          action: action.name,
          parameters: params
        })
      });
      return response.json();
    }
  });
}
```

### 3. Use with generateText

```typescript
const result = await generateText({
  model: openai("gpt-4o"),
  tools: inboxTools,
  maxSteps: 3,
  system: "You help customers interact with the website.",
  prompt: "I need a refund for order #1234, the item arrived damaged."
});

console.log(result.text);

// Check what tools were called
for (const step of result.steps) {
  for (const call of step.toolCalls) {
    console.log(`Called ${call.toolName} with`, call.args);
  }
}
```

### 4. Use with streamText (for UI)

```typescript
import { streamText } from "ai";

const result = streamText({
  model: openai("gpt-4o"),
  tools: inboxTools,
  maxSteps: 3,
  system: "You help customers interact with the website.",
  messages: [{ role: "user", content: "I need a refund for order #1234" }]
});

// Stream to a React UI via useChat
return result.toDataStreamResponse();
```

## With response polling

Add a tool that checks for responses:

```typescript
inboxTools["check_response"] = tool({
  description: "Check if the website has responded to a message",
  parameters: z.object({
    message_id: z.string().describe("The message ID to check")
  }),
  execute: async ({ message_id }) => {
    const response = await fetch(`${INBOX_URL}/${message_id}`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }
    });
    return response.json();
  }
});
```

## Next.js route handler

A complete Next.js API route that creates an agent.json-connected chat:

```typescript
// app/api/chat/route.ts
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Tools would be created from discovery doc (cached)
  const result = streamText({
    model: openai("gpt-4o"),
    tools: inboxTools,
    maxSteps: 5,
    system: `You are a customer service agent. Use the available tools
    to send requests to the website's inbox on behalf of customers.
    Always confirm what you're about to do before sending.`,
    messages
  });

  return result.toDataStreamResponse();
}
```

```typescript
// app/page.tsx
"use client";
import { useChat } from "@ai-sdk/react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>{m.role}: {m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
      </form>
    </div>
  );
}
```
