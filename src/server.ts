import { createWorkersAI } from "workers-ai-provider";
import { routeAgentRequest, callable } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";
import { classifyIntent } from "./classify";
import { buildWellKnownAgent } from "./well-known";
import type {
  Dashboard,
  DashboardOverview,
  InboxConfig,
  InboxMessageDetail,
  InboxMessageSummary,
  MessageResponse,
  MessageRow,
  MessageStatus,
  RouteConfig,
  RouteRow
} from "./types";

const AI_MODEL = "@cf/meta/llama-3.1-70b-instruct";
const PRIMARY_AGENT_ID = "primary";
const RECENT_MESSAGES_LIMIT = 50;

const DEFAULT_CONFIG: InboxConfig = {
  domain: "example.com",
  defaultEmail: "hello@example.com",
  siteName: "My Website",
  siteDescription: "A website with an AI-powered agent inbox",
  authToken: "",
  rateLimitPerMinute: 60
};

// --- Zod schemas for incoming API ---

const incomingMessageSchema = z.object({
  from: z.object({
    agent: z.string().min(1).max(200),
    on_behalf_of: z.string().max(320).optional(),
    callback_url: z.string().url().max(2000).optional()
  }),
  intent: z.string().max(100).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50_000),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  thread_id: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

// --- Rate limiter (in-memory per DO instance) ---

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, limit: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (entry === undefined || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count++;
  return true;
}

// --- Helper functions ---

function toIsoString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function rowToSummary(row: MessageRow): InboxMessageSummary {
  return {
    id: row.id,
    receivedAt: toIsoString(row.received_at),
    status: row.status as MessageStatus,
    fromAgent: row.from_agent,
    fromOnBehalfOf: row.from_on_behalf_of,
    declaredIntent: row.declared_intent,
    classifiedIntent: row.classified_intent,
    intentConfidence: row.intent_confidence,
    subject: row.subject,
    body: row.body.length > 300 ? row.body.slice(0, 300) + "..." : row.body,
    priority: row.priority as InboxMessageSummary["priority"],
    routedTo: row.routed_to,
    autoReply: row.auto_reply,
    error: row.error
  };
}

function rowToDetail(row: MessageRow): InboxMessageDetail {
  return {
    ...rowToSummary(row),
    body: row.body,
    callbackUrl: row.callback_url,
    threadId: row.thread_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    emailMessageId: row.email_message_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function rowToRoute(row: RouteRow): RouteConfig {
  return {
    intent: row.intent,
    email: row.email,
    autoReply: row.auto_reply,
    description: row.description
  };
}

// --- Email HTML template ---

function buildEmailHtml(params: {
  fromAgent: string;
  fromOnBehalfOf: string | null;
  classifiedIntent: string;
  confidence: number;
  priority: string;
  subject: string;
  body: string;
  messageId: string;
  receivedAt: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f8f4ed; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 16px; color: #2f241a;">Message from AI Agent</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">From Agent</td><td style="padding: 4px 0;">${params.fromAgent}</td></tr>
      ${params.fromOnBehalfOf ? `<tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">On Behalf Of</td><td style="padding: 4px 0;">${params.fromOnBehalfOf}</td></tr>` : ""}
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">Classified Intent</td><td style="padding: 4px 0;">${params.classifiedIntent} (${Math.round(params.confidence * 100)}% confidence)</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">Priority</td><td style="padding: 4px 0;">${params.priority}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">Received</td><td style="padding: 4px 0;">${params.receivedAt}</td></tr>
    </table>
  </div>
  <h3 style="margin: 0 0 8px; color: #2f241a;">${params.subject}</h3>
  <div style="white-space: pre-wrap; line-height: 1.6; padding: 16px; background: #fff; border: 1px solid #e5e0d8; border-radius: 8px;">${params.body}</div>
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e0d8;">
  <p style="font-size: 12px; color: #6b5a4c;">Routed by agent-inbox | Message ID: ${params.messageId}</p>
</body>
</html>`;
}

// === InboxAgent Durable Object ===

export class InboxAgent extends AIChatAgent<Env> {
  ensureTables(): void {
    this.sql`
      CREATE TABLE IF NOT EXISTS inbox_config (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS inbox_routes (
        intent TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        auto_reply TEXT,
        description TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY NOT NULL,
        received_at INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('received', 'classifying', 'routed', 'failed')),
        from_agent TEXT NOT NULL,
        from_on_behalf_of TEXT,
        callback_url TEXT,
        declared_intent TEXT,
        classified_intent TEXT,
        intent_confidence REAL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        thread_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        routed_to TEXT,
        auto_reply TEXT,
        email_message_id TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_received_at
      ON inbox_messages(received_at DESC)
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_status
      ON inbox_messages(status)
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_classified_intent
      ON inbox_messages(classified_intent)
    `;
  }

  // --- Config helpers ---

  getConfigValue(key: string): string | null {
    const rows = this.sql<{ value: string }>`
      SELECT value FROM inbox_config WHERE key = ${key}
    `;
    const [row] = rows;
    return row?.value ?? null;
  }

  setConfigValue(key: string, value: string): void {
    this.sql`
      INSERT INTO inbox_config (key, value) VALUES (${key}, ${value})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
  }

  getFullConfig(): InboxConfig {
    return {
      domain: this.getConfigValue("domain") ?? DEFAULT_CONFIG.domain,
      defaultEmail:
        this.getConfigValue("defaultEmail") ?? DEFAULT_CONFIG.defaultEmail,
      siteName: this.getConfigValue("siteName") ?? DEFAULT_CONFIG.siteName,
      siteDescription:
        this.getConfigValue("siteDescription") ??
        DEFAULT_CONFIG.siteDescription,
      authToken: this.getConfigValue("authToken") ?? "",
      rateLimitPerMinute: Number(
        this.getConfigValue("rateLimitPerMinute") ??
          DEFAULT_CONFIG.rateLimitPerMinute
      )
    };
  }

  getRoutes(): RouteConfig[] {
    return this.sql<RouteRow>`
      SELECT * FROM inbox_routes ORDER BY intent
    `.map(rowToRoute);
  }

  // --- Callable methods (exposed to React UI via agent.call()) ---

  @callable()
  getDashboard(): Dashboard {
    this.ensureTables();
    const config = this.getFullConfig();
    const routes = this.getRoutes();

    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;

    const [totalRow] = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM inbox_messages
    `;
    const [routedRow] = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM inbox_messages WHERE status = 'routed'
    `;
    const [failedRow] = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM inbox_messages WHERE status = 'failed'
    `;
    const [last24hRow] = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM inbox_messages WHERE received_at >= ${oneDayAgo}
    `;

    const topIntents = this.sql<{ intent: string; count: number }>`
      SELECT classified_intent as intent, COUNT(*) as count
      FROM inbox_messages
      WHERE classified_intent IS NOT NULL
      GROUP BY classified_intent
      ORDER BY count DESC
      LIMIT 5
    `;

    const overview: DashboardOverview = {
      totalMessages: totalRow?.count ?? 0,
      routedMessages: routedRow?.count ?? 0,
      failedMessages: failedRow?.count ?? 0,
      messagesLast24h: last24hRow?.count ?? 0,
      topIntents
    };

    const messageRows = this.sql<MessageRow>`
      SELECT * FROM inbox_messages ORDER BY received_at DESC LIMIT ${RECENT_MESSAGES_LIMIT}
    `;

    return {
      overview,
      recentMessages: messageRows.map(rowToSummary),
      config,
      routes
    };
  }

  @callable()
  getMessage(id: string): InboxMessageDetail | null {
    this.ensureTables();
    const rows = this.sql<MessageRow>`
      SELECT * FROM inbox_messages WHERE id = ${id}
    `;
    const [row] = rows;
    if (row === undefined) {
      return null;
    }
    return rowToDetail(row);
  }

  @callable()
  getConfig(): { config: InboxConfig; routes: RouteConfig[] } {
    this.ensureTables();
    return {
      config: this.getFullConfig(),
      routes: this.getRoutes()
    };
  }

  @callable()
  updateConfig(config: {
    domain: string;
    defaultEmail: string;
    siteName: string;
    siteDescription: string;
    rateLimitPerMinute: number;
  }): InboxConfig {
    this.ensureTables();
    this.setConfigValue("domain", config.domain);
    this.setConfigValue("defaultEmail", config.defaultEmail);
    this.setConfigValue("siteName", config.siteName);
    this.setConfigValue("siteDescription", config.siteDescription);
    this.setConfigValue(
      "rateLimitPerMinute",
      String(config.rateLimitPerMinute)
    );
    return this.getFullConfig();
  }

  @callable()
  regenerateAuthToken(): string {
    this.ensureTables();
    const token = crypto.randomUUID();
    this.setConfigValue("authToken", token);
    return token;
  }

  @callable()
  addRoute(route: {
    intent: string;
    email: string;
    autoReply: string | null;
    description: string;
  }): RouteConfig[] {
    this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    this.sql`
      INSERT INTO inbox_routes (intent, email, auto_reply, description, created_at, updated_at)
      VALUES (${route.intent}, ${route.email}, ${route.autoReply}, ${route.description}, ${now}, ${now})
      ON CONFLICT(intent) DO UPDATE SET
        email = excluded.email,
        auto_reply = excluded.auto_reply,
        description = excluded.description,
        updated_at = excluded.updated_at
    `;
    this.broadcast(
      JSON.stringify({ type: "inbox-updated", event: "route-changed" })
    );
    return this.getRoutes();
  }

  @callable()
  removeRoute(intent: string): RouteConfig[] {
    this.ensureTables();
    this.sql`DELETE FROM inbox_routes WHERE intent = ${intent}`;
    this.broadcast(
      JSON.stringify({ type: "inbox-updated", event: "route-changed" })
    );
    return this.getRoutes();
  }

  // --- Message processing ---

  async handleIncomingMessage(request: Request): Promise<Response> {
    this.ensureTables();
    const config = this.getFullConfig();

    // Auth check
    if (config.authToken.length > 0) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

      if (token !== config.authToken) {
        return Response.json(
          { error: "Unauthorized. Provide a valid Bearer token." },
          { status: 401 }
        );
      }
    }

    // Rate limit
    const clientIp = request.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!checkRateLimit(clientIp, config.rateLimitPerMinute)) {
      return Response.json(
        { error: "Rate limit exceeded. Try again later." },
        { status: 429 }
      );
    }

    // Parse and validate
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = incomingMessageSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid message format.",
          details: parsed.error.issues.map((i) => i.message)
        },
        { status: 400 }
      );
    }

    const msg = parsed.data;
    const now = Math.floor(Date.now() / 1000);
    const messageId = crypto.randomUUID();
    const priority = msg.priority ?? "normal";
    const onBehalfOf = msg.from.on_behalf_of ?? null;
    const callbackUrl = msg.from.callback_url ?? null;
    const declaredIntent = msg.intent ?? null;
    const threadId = msg.thread_id ?? null;
    const metadataJson = JSON.stringify(msg.metadata ?? {});

    // Store as received
    this.sql`
      INSERT INTO inbox_messages (
        id, received_at, status, from_agent, from_on_behalf_of, callback_url,
        declared_intent, subject, body, priority, thread_id, metadata_json,
        created_at, updated_at
      ) VALUES (
        ${messageId}, ${now}, 'received', ${msg.from.agent}, ${onBehalfOf}, ${callbackUrl},
        ${declaredIntent}, ${msg.subject}, ${msg.body}, ${priority}, ${threadId}, ${metadataJson},
        ${now}, ${now}
      )
    `;

    // Classify intent
    this.sql`
      UPDATE inbox_messages SET status = 'classifying', updated_at = ${now} WHERE id = ${messageId}
    `;

    const routes = this.getRoutes();
    let classifiedIntent = "general";
    let intentConfidence = 1.0;

    // If sender declared an intent that matches a route, use it directly
    if (
      msg.intent !== undefined &&
      routes.some((r) => r.intent === msg.intent)
    ) {
      classifiedIntent = msg.intent;
      intentConfidence = 1.0;
    } else if (routes.length > 0) {
      // AI classification
      try {
        const result = await classifyIntent(
          this.env.AI,
          msg.subject,
          msg.body.slice(0, 8000),
          routes.map((r) => ({
            intent: r.intent,
            description: r.description
          }))
        );
        classifiedIntent = result.intent;
        intentConfidence = result.confidence;
      } catch (error) {
        console.error("Classification failed, using general:", error);
        classifiedIntent = "general";
        intentConfidence = 0;
      }
    }

    // Find matching route
    const matchedRoute = routes.find((r) => r.intent === classifiedIntent);
    const targetEmail = matchedRoute?.email ?? config.defaultEmail;
    const autoReply = matchedRoute?.autoReply ?? null;

    // Send email
    let emailMessageId: string | null = null;
    let routeError: string | null = null;

    try {
      const emailResult = await this.env.EMAIL.send({
        to: targetEmail,
        from: `inbox@${config.domain}`,
        subject: `[agent-inbox] ${classifiedIntent}: ${msg.subject}`,
        html: buildEmailHtml({
          fromAgent: msg.from.agent,
          fromOnBehalfOf: onBehalfOf,
          classifiedIntent,
          confidence: intentConfidence,
          priority,
          subject: msg.subject,
          body: msg.body,
          messageId,
          receivedAt: toIsoString(now)
        }),
        text: `Message from agent "${msg.from.agent}"${onBehalfOf ? ` on behalf of ${onBehalfOf}` : ""}\n\nIntent: ${classifiedIntent} (${Math.round(intentConfidence * 100)}%)\nPriority: ${priority}\n\n${msg.subject}\n\n${msg.body}\n\n---\nRouted by agent-inbox | Message ID: ${messageId}`
      });
      emailMessageId = (emailResult as { messageId?: string }).messageId ?? null;
    } catch (error) {
      routeError =
        error instanceof Error ? error.message : "Email sending failed";
      console.error("Email send failed:", routeError);
    }

    // Update message record
    const finalStatus: MessageStatus =
      routeError === null ? "routed" : "failed";
    const updatedAt = Math.floor(Date.now() / 1000);

    this.sql`
      UPDATE inbox_messages SET
        status = ${finalStatus},
        classified_intent = ${classifiedIntent},
        intent_confidence = ${intentConfidence},
        routed_to = ${targetEmail},
        auto_reply = ${autoReply},
        email_message_id = ${emailMessageId},
        error = ${routeError},
        updated_at = ${updatedAt}
      WHERE id = ${messageId}
    `;

    // Broadcast to dashboard
    this.broadcast(
      JSON.stringify({
        type: "inbox-updated",
        event: "message-routed",
        messageId
      })
    );

    const response: MessageResponse = {
      id: messageId,
      status: finalStatus,
      classified_intent: classifiedIntent,
      auto_reply: autoReply,
      message:
        finalStatus === "routed"
          ? `Message classified as "${classifiedIntent}" and routed successfully.`
          : `Message classification succeeded but routing failed: ${routeError}`
    };

    return Response.json(response, {
      status: finalStatus === "routed" ? 200 : 502
    });
  }

  handleGetMessage(id: string): Response {
    this.ensureTables();
    const rows = this.sql<MessageRow>`
      SELECT * FROM inbox_messages WHERE id = ${id}
    `;
    const [row] = rows;
    if (row === undefined) {
      return Response.json({ error: "Message not found." }, { status: 404 });
    }

    return Response.json({
      id: row.id,
      status: row.status,
      classified_intent: row.classified_intent,
      auto_reply: row.auto_reply,
      routed_to: row.routed_to,
      received_at: toIsoString(row.received_at)
    });
  }

  // --- Chat copilot ---

  async onChatMessage(
    _onFinish: unknown,
    options?: OnChatMessageOptions
  ) {
    this.ensureTables();
    const workersAI = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersAI(AI_MODEL),
      system: `You are the agent-inbox copilot. You help the website owner understand and manage messages received from AI agents.
You have tools to query the inbox. Answer questions about message volume, intents, routing, and failures.
Be concise and helpful. Format data in readable tables when appropriate.`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        getInboxOverview: tool({
          description: "Get inbox statistics and overview",
          inputSchema: z.object({}),
          execute: async () => {
            const dashboard = this.getDashboard();
            return dashboard.overview;
          }
        }),
        listMessages: tool({
          description:
            "List recent messages, optionally filtered by status or intent",
          inputSchema: z.object({
            status: z
              .enum(["received", "classifying", "routed", "failed"])
              .nullable(),
            intent: z.string().nullable(),
            limit: z.number().int().min(1).max(25)
          }),
          execute: async ({
            status,
            intent,
            limit
          }: {
            status: string | null;
            intent: string | null;
            limit: number;
          }) => {
            // Build filters using tagged template
            let allRows = this.sql<MessageRow>`
              SELECT * FROM inbox_messages
              ORDER BY received_at DESC
              LIMIT ${RECENT_MESSAGES_LIMIT}
            `;

            if (status !== null) {
              allRows = allRows.filter((r) => r.status === status);
            }
            if (intent !== null) {
              allRows = allRows.filter(
                (r) => r.classified_intent === intent
              );
            }

            return allRows.slice(0, limit).map(rowToSummary);
          }
        }),
        getMessageDetail: tool({
          description: "Get full details of a specific message by ID",
          inputSchema: z.object({
            messageId: z.string()
          }),
          execute: async ({ messageId }: { messageId: string }) => {
            return this.getMessage(messageId);
          }
        }),
        searchMessages: tool({
          description: "Search messages by subject or body text",
          inputSchema: z.object({
            query: z.string().min(1).max(200)
          }),
          execute: async ({ query }: { query: string }) => {
            const pattern = `%${query}%`;
            const rows = this.sql<MessageRow>`
              SELECT * FROM inbox_messages
              WHERE subject LIKE ${pattern} OR body LIKE ${pattern} OR from_agent LIKE ${pattern}
              ORDER BY received_at DESC
              LIMIT 10
            `;
            return rows.map(rowToSummary);
          }
        })
      },
      stopWhen: stepCountIs(6),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  // --- Override fetch to handle API routes within the DO ---

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/message" && request.method === "POST") {
      return this.handleIncomingMessage(request);
    }

    if (
      url.pathname.startsWith("/api/message/") &&
      request.method === "GET"
    ) {
      const id = url.pathname.slice("/api/message/".length);
      return this.handleGetMessage(id);
    }

    if (url.pathname === "/.well-known/agent.json") {
      this.ensureTables();
      const config = this.getFullConfig();
      const routes = this.getRoutes();
      const baseUrl = `${url.protocol}//${url.host}`;
      const doc = buildWellKnownAgent(config, routes, baseUrl);
      return Response.json(doc, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300"
        }
      });
    }

    // Fall through to Agent SDK (WebSocket, chat, etc.)
    return super.fetch(request);
  }
}

// === Worker entry point ===

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight for API routes
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // Route API and well-known requests through the DO
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname === "/.well-known/agent.json"
    ) {
      const id = env.InboxAgent.idFromName(PRIMARY_AGENT_ID);
      const stub = env.InboxAgent.get(id);
      return stub.fetch(request);
    }

    // Everything else: Agent SDK (handles /agents/*, SPA, etc.)
    const agentResponse = await routeAgentRequest(request, env);
    return agentResponse ?? new Response("Not Found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
