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
  ActionConfig,
  ActionParameter,
  ActionRow,
  Dashboard,
  DashboardOverview,
  InboxConfig,
  InboxMessageDetail,
  InboxMessageSummary,
  InboxResponse,
  MessageResponse,
  MessageRow,
  MessageStatus,
  ResponseRow
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

// Structured mode: agent calls a specific action with parameters
// Free-form mode: agent sends subject + body, AI classifies
const incomingMessageSchema = z
  .object({
    from: z.object({
      agent: z.string().min(1).max(200),
      on_behalf_of: z.string().max(320).optional(),
      callback_url: z.string().url().max(2000).optional()
    }),
    action: z.string().max(100).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    subject: z.string().min(1).max(500).optional(),
    body: z.string().min(1).max(50_000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    thread_id: z.string().max(200).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .refine((data) => data.action !== undefined || data.subject !== undefined, {
    message:
      "Either 'action' (structured) or 'subject' (free-form) must be provided"
  });

// --- Parameter validation ---

function validateParameters(
  params: Record<string, unknown>,
  schema: ActionParameter[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const param of schema) {
    const value = params[param.name];

    if (param.required && (value === undefined || value === null)) {
      errors.push(`Missing required parameter: ${param.name}`);
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (param.type === "string" && typeof value !== "string") {
      errors.push(
        `Parameter "${param.name}" must be a string, got ${typeof value}`
      );
    } else if (param.type === "number" && typeof value !== "number") {
      errors.push(
        `Parameter "${param.name}" must be a number, got ${typeof value}`
      );
    } else if (param.type === "boolean" && typeof value !== "boolean") {
      errors.push(
        `Parameter "${param.name}" must be a boolean, got ${typeof value}`
      );
    }

    if (
      param.enum !== undefined &&
      param.enum.length > 0 &&
      typeof value === "string" &&
      !param.enum.includes(value)
    ) {
      errors.push(
        `Parameter "${param.name}" must be one of: ${param.enum.join(", ")}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

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
    action: row.action,
    classifiedAction: row.classified_action,
    actionConfidence: row.action_confidence,
    subject: row.subject,
    body:
      row.body !== null && row.body.length > 300
        ? row.body.slice(0, 300) + "..."
        : row.body,
    parameters: JSON.parse(row.parameters_json) as Record<
      string,
      unknown
    > | null,
    priority: row.priority as InboxMessageSummary["priority"],
    routedTo: row.routed_to,
    autoReply: row.auto_reply,
    error: row.error
  };
}

function rowToDetail(row: MessageRow, responses: InboxResponse[]): InboxMessageDetail {
  return {
    ...rowToSummary(row),
    body: row.body,
    callbackUrl: row.callback_url,
    threadId: row.thread_id,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    emailMessageId: row.email_message_id,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    responses
  };
}

function rowToAction(row: ActionRow): ActionConfig {
  return {
    name: row.name,
    email: row.email,
    autoReply: row.auto_reply,
    description: row.description,
    parameters: JSON.parse(row.parameters_json) as ActionParameter[],
    responseSchema: JSON.parse(row.response_schema_json) as ActionParameter[]
  };
}

function rowToResponse(row: ResponseRow): InboxResponse {
  return {
    id: row.id,
    messageId: row.message_id,
    status: row.status as InboxResponse["status"],
    body: row.body,
    structuredData: JSON.parse(row.structured_data_json) as Record<string, unknown>,
    respondedBy: row.responded_by,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

// --- Email HTML template ---

function buildEmailHtml(params: {
  fromAgent: string;
  fromOnBehalfOf: string | null;
  action: string;
  confidence: number;
  priority: string;
  subject: string | null;
  body: string | null;
  structuredParams: Record<string, unknown> | null;
  messageId: string;
  receivedAt: string;
}): string {
  let contentHtml: string;

  if (
    params.structuredParams !== null &&
    Object.keys(params.structuredParams).length > 0
  ) {
    // Structured: render parameters as key-value table
    const paramRows = Object.entries(params.structuredParams)
      .map(
        ([key, value]) =>
          `<tr><td style="padding: 6px 12px 6px 0; color: #6b5a4c; font-weight: 600; vertical-align: top;">${key}</td><td style="padding: 6px 0;">${String(value)}</td></tr>`
      )
      .join("");
    contentHtml = `
    <h3 style="margin: 0 0 12px; color: #2f241a;">Action: ${params.action}</h3>
    <table style="width: 100%; border-collapse: collapse; padding: 16px; background: #fff; border: 1px solid #e5e0d8; border-radius: 8px;">${paramRows}</table>`;
  } else {
    // Free-form: show subject + body
    contentHtml = `
    <h3 style="margin: 0 0 8px; color: #2f241a;">${params.subject ?? "(no subject)"}</h3>
    <div style="white-space: pre-wrap; line-height: 1.6; padding: 16px; background: #fff; border: 1px solid #e5e0d8; border-radius: 8px;">${params.body ?? ""}</div>`;
  }

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="background: #f8f4ed; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
    <h2 style="margin: 0 0 16px; color: #2f241a;">Message from AI Agent</h2>
    <table style="width: 100%; border-collapse: collapse;">
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">From Agent</td><td style="padding: 4px 0;">${params.fromAgent}</td></tr>
      ${params.fromOnBehalfOf ? `<tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">On Behalf Of</td><td style="padding: 4px 0;">${params.fromOnBehalfOf}</td></tr>` : ""}
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">Action</td><td style="padding: 4px 0;">${params.action} (${Math.round(params.confidence * 100)}% confidence)</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">Priority</td><td style="padding: 4px 0;">${params.priority}</td></tr>
      <tr><td style="padding: 4px 12px 4px 0; color: #6b5a4c; font-weight: 600;">Received</td><td style="padding: 4px 0;">${params.receivedAt}</td></tr>
    </table>
  </div>
  ${contentHtml}
  <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e0d8;">
  <p style="font-size: 12px; color: #6b5a4c;">Routed by agent-inbox | Message ID: ${params.messageId}</p>
</body>
</html>`;
}

function buildEmailText(params: {
  fromAgent: string;
  fromOnBehalfOf: string | null;
  action: string;
  confidence: number;
  priority: string;
  subject: string | null;
  body: string | null;
  structuredParams: Record<string, unknown> | null;
  messageId: string;
}): string {
  const header = `Message from agent "${params.fromAgent}"${params.fromOnBehalfOf ? ` on behalf of ${params.fromOnBehalfOf}` : ""}\n\nAction: ${params.action} (${Math.round(params.confidence * 100)}%)\nPriority: ${params.priority}\n\n`;

  if (
    params.structuredParams !== null &&
    Object.keys(params.structuredParams).length > 0
  ) {
    const paramLines = Object.entries(params.structuredParams)
      .map(([key, value]) => `  ${key}: ${String(value)}`)
      .join("\n");
    return `${header}Parameters:\n${paramLines}\n\n---\nRouted by agent-inbox | Message ID: ${params.messageId}`;
  }

  return `${header}${params.subject ?? ""}\n\n${params.body ?? ""}\n\n---\nRouted by agent-inbox | Message ID: ${params.messageId}`;
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
      CREATE TABLE IF NOT EXISTS inbox_actions (
        name TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL,
        auto_reply TEXT,
        description TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;

    // Migration: add response_schema_json column to inbox_actions if missing
    try {
      this.sql`SELECT response_schema_json FROM inbox_actions LIMIT 0`;
    } catch {
      this.sql`ALTER TABLE inbox_actions ADD COLUMN response_schema_json TEXT NOT NULL DEFAULT '[]'`;
    }

    // Migration: recreate inbox_messages without CHECK constraint on status
    // (to allow 'responded' status). Only needed if the old table exists with a CHECK.
    const [tableInfo] = this.sql<{ sql: string }>`
      SELECT sql FROM sqlite_master WHERE type='table' AND name='inbox_messages'
    `;
    if (tableInfo && tableInfo.sql.includes("CHECK")) {
      this.sql`ALTER TABLE inbox_messages RENAME TO inbox_messages_old`;
      this.sql`
        CREATE TABLE inbox_messages (
          id TEXT PRIMARY KEY NOT NULL,
          received_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          from_agent TEXT NOT NULL,
          from_on_behalf_of TEXT,
          callback_url TEXT,
          action TEXT,
          classified_action TEXT,
          action_confidence REAL,
          subject TEXT,
          body TEXT,
          parameters_json TEXT NOT NULL DEFAULT '{}',
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
      this.sql`INSERT INTO inbox_messages SELECT * FROM inbox_messages_old`;
      this.sql`DROP TABLE inbox_messages_old`;
    } else if (!tableInfo) {
      this.sql`
        CREATE TABLE IF NOT EXISTS inbox_messages (
          id TEXT PRIMARY KEY NOT NULL,
          received_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          from_agent TEXT NOT NULL,
          from_on_behalf_of TEXT,
          callback_url TEXT,
          action TEXT,
          classified_action TEXT,
          action_confidence REAL,
          subject TEXT,
          body TEXT,
          parameters_json TEXT NOT NULL DEFAULT '{}',
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
    }

    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_received_at
      ON inbox_messages(received_at DESC)
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_status
      ON inbox_messages(status)
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_action
      ON inbox_messages(classified_action)
    `;

    // Responses table
    this.sql`
      CREATE TABLE IF NOT EXISTS inbox_responses (
        id TEXT PRIMARY KEY NOT NULL,
        message_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        body TEXT,
        structured_data_json TEXT NOT NULL DEFAULT '{}',
        responded_by TEXT NOT NULL DEFAULT 'dashboard',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_inbox_responses_message_id
      ON inbox_responses(message_id)
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

  getActions(): ActionConfig[] {
    return this.sql<ActionRow>`
      SELECT * FROM inbox_actions ORDER BY name
    `.map(rowToAction);
  }

  // --- Callable methods (exposed to React UI via agent.call()) ---

  @callable()
  getDashboard(): Dashboard {
    this.ensureTables();
    const config = this.getFullConfig();
    const actions = this.getActions();

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

    const topActions = this.sql<{ action: string; count: number }>`
      SELECT classified_action as action, COUNT(*) as count
      FROM inbox_messages
      WHERE classified_action IS NOT NULL
      GROUP BY classified_action
      ORDER BY count DESC
      LIMIT 5
    `;

    const overview: DashboardOverview = {
      totalMessages: totalRow?.count ?? 0,
      routedMessages: routedRow?.count ?? 0,
      failedMessages: failedRow?.count ?? 0,
      messagesLast24h: last24hRow?.count ?? 0,
      topActions
    };

    const messageRows = this.sql<MessageRow>`
      SELECT * FROM inbox_messages ORDER BY received_at DESC LIMIT ${RECENT_MESSAGES_LIMIT}
    `;

    return {
      overview,
      recentMessages: messageRows.map(rowToSummary),
      config,
      actions
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
    const responseRows = this.sql<ResponseRow>`
      SELECT * FROM inbox_responses WHERE message_id = ${id} ORDER BY created_at DESC
    `;
    return rowToDetail(row, responseRows.map(rowToResponse));
  }

  @callable()
  getConfig(): { config: InboxConfig; actions: ActionConfig[] } {
    this.ensureTables();
    return {
      config: this.getFullConfig(),
      actions: this.getActions()
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
  addAction(action: {
    name: string;
    email: string;
    autoReply: string | null;
    description: string;
    parameters: ActionParameter[];
    responseSchema?: ActionParameter[];
  }): ActionConfig[] {
    this.ensureTables();
    const now = Math.floor(Date.now() / 1000);
    const parametersJson = JSON.stringify(action.parameters);
    const responseSchemaJson = JSON.stringify(action.responseSchema ?? []);
    this.sql`
      INSERT INTO inbox_actions (name, email, auto_reply, description, parameters_json, response_schema_json, created_at, updated_at)
      VALUES (${action.name}, ${action.email}, ${action.autoReply}, ${action.description}, ${parametersJson}, ${responseSchemaJson}, ${now}, ${now})
      ON CONFLICT(name) DO UPDATE SET
        email = excluded.email,
        auto_reply = excluded.auto_reply,
        description = excluded.description,
        parameters_json = excluded.parameters_json,
        response_schema_json = excluded.response_schema_json,
        updated_at = excluded.updated_at
    `;
    this.broadcast(
      JSON.stringify({ type: "inbox-updated", event: "action-changed" })
    );
    return this.getActions();
  }

  @callable()
  removeAction(name: string): ActionConfig[] {
    this.ensureTables();
    this.sql`DELETE FROM inbox_actions WHERE name = ${name}`;
    this.broadcast(
      JSON.stringify({ type: "inbox-updated", event: "action-changed" })
    );
    return this.getActions();
  }

  // --- Response & callback ---

  @callable()
  async respondToMessage(args: {
    messageId: string;
    body?: string;
    structuredData?: Record<string, unknown>;
    respondedBy?: string;
  }): Promise<InboxResponse> {
    this.ensureTables();
    const { messageId, body, structuredData, respondedBy } = args;

    const messageRows = this.sql<MessageRow>`
      SELECT * FROM inbox_messages WHERE id = ${messageId}
    `;
    const [msgRow] = messageRows;
    if (msgRow === undefined) {
      throw new Error("Message not found");
    }

    const now = Math.floor(Date.now() / 1000);
    const responseId = crypto.randomUUID();
    const structuredDataJson = JSON.stringify(structuredData ?? {});
    const responder = respondedBy ?? "dashboard";

    this.sql`
      INSERT INTO inbox_responses (id, message_id, status, body, structured_data_json, responded_by, created_at, updated_at)
      VALUES (${responseId}, ${messageId}, 'pending', ${body ?? null}, ${structuredDataJson}, ${responder}, ${now}, ${now})
    `;

    this.sql`
      UPDATE inbox_messages SET status = 'responded', updated_at = ${now} WHERE id = ${messageId}
    `;

    // Deliver callback if configured
    if (msgRow.callback_url) {
      const config = this.getFullConfig();
      const payload = {
        message_id: messageId,
        response_id: responseId,
        body: body ?? null,
        structured_data: structuredData ?? {},
        responded_by: responder,
        responded_at: toIsoString(now)
      };
      const delivered = await this.deliverCallback(
        msgRow.callback_url,
        payload,
        config.authToken
      );
      const newStatus = delivered ? "delivered" : "failed";
      this.sql`
        UPDATE inbox_responses SET status = ${newStatus}, updated_at = ${Math.floor(Date.now() / 1000)}
        WHERE id = ${responseId}
      `;
      if (!delivered) {
        // Schedule retry via alarm (5 minutes from now)
        this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000);
      }
    } else {
      // No callback — mark as delivered immediately (will be polled)
      this.sql`
        UPDATE inbox_responses SET status = 'delivered', updated_at = ${now}
        WHERE id = ${responseId}
      `;
    }

    this.broadcast(
      JSON.stringify({
        type: "inbox-updated",
        event: "message-responded",
        messageId
      })
    );

    const [respRow] = this.sql<ResponseRow>`
      SELECT * FROM inbox_responses WHERE id = ${responseId}
    `;
    return rowToResponse(respRow!);
  }

  async deliverCallback(
    callbackUrl: string,
    payload: Record<string, unknown>,
    signingKey: string
  ): Promise<boolean> {
    try {
      const bodyStr = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signatureInput = `${timestamp}.${bodyStr}`;

      // HMAC-SHA256 signature
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(signingKey || "unsigned"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const sig = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signatureInput)
      );
      const sigHex = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const resp = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AgentInbox-Signature": sigHex,
          "X-AgentInbox-Timestamp": timestamp
        },
        body: bodyStr
      });

      return resp.ok;
    } catch (error) {
      console.error("Callback delivery failed:", error);
      return false;
    }
  }

  async alarm(): Promise<void> {
    this.ensureTables();
    const config = this.getFullConfig();
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;

    // Find failed responses with callback URLs from the last hour
    const failedResponses = this.sql<ResponseRow & { callback_url: string }>`
      SELECT r.*, m.callback_url
      FROM inbox_responses r
      JOIN inbox_messages m ON r.message_id = m.id
      WHERE r.status = 'failed'
        AND r.created_at >= ${oneHourAgo}
        AND m.callback_url IS NOT NULL
    `;

    for (const row of failedResponses) {
      const payload = {
        message_id: row.message_id,
        response_id: row.id,
        body: row.body,
        structured_data: JSON.parse(row.structured_data_json),
        responded_by: row.responded_by,
        responded_at: toIsoString(row.created_at)
      };

      const delivered = await this.deliverCallback(
        row.callback_url,
        payload,
        config.authToken
      );
      const now = Math.floor(Date.now() / 1000);
      const newStatus = delivered ? "delivered" : "failed";
      this.sql`
        UPDATE inbox_responses SET status = ${newStatus}, updated_at = ${now}
        WHERE id = ${row.id}
      `;
    }
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
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = incomingMessageSchema.safeParse(rawBody);
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
    const threadId = msg.thread_id ?? null;
    const metadataJson = JSON.stringify(msg.metadata ?? {});
    const isStructured = msg.action !== undefined;
    const actionName = msg.action ?? null;
    const subject = msg.subject ?? null;
    const body = msg.body ?? null;
    const parametersJson = JSON.stringify(msg.parameters ?? null);

    // Store as received
    this.sql`
      INSERT INTO inbox_messages (
        id, received_at, status, from_agent, from_on_behalf_of, callback_url,
        action, subject, body, parameters_json, priority, thread_id, metadata_json,
        created_at, updated_at
      ) VALUES (
        ${messageId}, ${now}, 'received', ${msg.from.agent}, ${onBehalfOf}, ${callbackUrl},
        ${actionName}, ${subject}, ${body}, ${parametersJson}, ${priority}, ${threadId}, ${metadataJson},
        ${now}, ${now}
      )
    `;

    const actions = this.getActions();
    let resolvedAction = "general";
    let actionConfidence = 1.0;
    let structuredParams: Record<string, unknown> | null = null;

    if (isStructured) {
      // --- Structured mode: agent called a specific action ---
      const matchedAction = actions.find((a) => a.name === msg.action);

      if (matchedAction === undefined) {
        // Action not found
        const updatedAt = Math.floor(Date.now() / 1000);
        const errorMsg = `Unknown action: "${msg.action}". Available actions: ${actions.map((a) => a.name).join(", ") || "(none configured)"}`;
        this.sql`
          UPDATE inbox_messages SET status = 'failed', error = ${errorMsg}, updated_at = ${updatedAt}
          WHERE id = ${messageId}
        `;
        return Response.json(
          { error: errorMsg, available_actions: actions.map((a) => a.name) },
          { status: 400 }
        );
      }

      // Validate parameters
      const params = (msg.parameters ?? {}) as Record<string, unknown>;
      const validation = validateParameters(params, matchedAction.parameters);

      if (!validation.valid) {
        const updatedAt = Math.floor(Date.now() / 1000);
        const errorMsg = validation.errors.join("; ");
        this.sql`
          UPDATE inbox_messages SET status = 'failed', error = ${errorMsg}, updated_at = ${updatedAt}
          WHERE id = ${messageId}
        `;
        return Response.json(
          { error: "Parameter validation failed.", details: validation.errors },
          { status: 400 }
        );
      }

      resolvedAction = matchedAction.name;
      actionConfidence = 1.0;
      structuredParams = params;
    } else {
      // --- Free-form mode: AI classifies ---
      this.sql`
        UPDATE inbox_messages SET status = 'classifying', updated_at = ${now} WHERE id = ${messageId}
      `;

      if (actions.length > 0) {
        try {
          const result = await classifyIntent(
            this.env.AI,
            subject ?? "",
            (body ?? "").slice(0, 8000),
            actions.map((a) => ({
              intent: a.name,
              description: a.description
            }))
          );
          resolvedAction = result.intent;
          actionConfidence = result.confidence;
        } catch (error) {
          console.error("Classification failed, using general:", error);
          resolvedAction = "general";
          actionConfidence = 0;
        }
      }
    }

    // Find matching action for routing
    const matchedAction = actions.find((a) => a.name === resolvedAction);
    const targetEmail = matchedAction?.email ?? config.defaultEmail;
    const autoReply = matchedAction?.autoReply ?? null;

    // Send email
    let emailMessageId: string | null = null;
    let routeError: string | null = null;

    try {
      const emailSubject = isStructured
        ? `[agent-inbox] ${resolvedAction}: Action from ${msg.from.agent}`
        : `[agent-inbox] ${resolvedAction}: ${subject ?? "(no subject)"}`;

      const emailResult = await this.env.EMAIL.send({
        to: targetEmail,
        from: `inbox@${config.domain}`,
        subject: emailSubject,
        html: buildEmailHtml({
          fromAgent: msg.from.agent,
          fromOnBehalfOf: onBehalfOf,
          action: resolvedAction,
          confidence: actionConfidence,
          priority,
          subject,
          body,
          structuredParams,
          messageId,
          receivedAt: toIsoString(now)
        }),
        text: buildEmailText({
          fromAgent: msg.from.agent,
          fromOnBehalfOf: onBehalfOf,
          action: resolvedAction,
          confidence: actionConfidence,
          priority,
          subject,
          body,
          structuredParams,
          messageId
        })
      });
      emailMessageId =
        (emailResult as { messageId?: string }).messageId ?? null;
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
        classified_action = ${resolvedAction},
        action_confidence = ${actionConfidence},
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
      action: resolvedAction,
      auto_reply: autoReply,
      message:
        finalStatus === "routed"
          ? `Message routed via action "${resolvedAction}" to ${targetEmail}.`
          : `Routing failed: ${routeError}`
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

    // Get the latest response
    const responseRows = this.sql<ResponseRow>`
      SELECT * FROM inbox_responses WHERE message_id = ${id} ORDER BY created_at DESC LIMIT 1
    `;
    const [latestResponse] = responseRows;

    let response: {
      id: string;
      body: string | null;
      structured_data: Record<string, unknown>;
      responded_at: string;
    } | null = null;

    if (latestResponse) {
      response = {
        id: latestResponse.id,
        body: latestResponse.body,
        structured_data: JSON.parse(latestResponse.structured_data_json) as Record<string, unknown>,
        responded_at: toIsoString(latestResponse.created_at)
      };

      // Mark pending responses as delivered when polled
      if (latestResponse.status === "pending") {
        const now = Math.floor(Date.now() / 1000);
        this.sql`
          UPDATE inbox_responses SET status = 'delivered', updated_at = ${now}
          WHERE id = ${latestResponse.id}
        `;
      }
    }

    return Response.json({
      id: row.id,
      status: row.status,
      action: row.classified_action,
      auto_reply: row.auto_reply,
      routed_to: row.routed_to,
      received_at: toIsoString(row.received_at),
      response
    });
  }

  async handleRespondHttp(request: Request, messageId: string): Promise<Response> {
    this.ensureTables();
    const config = this.getFullConfig();

    // Auth check
    if (config.authToken.length > 0) {
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (token !== config.authToken) {
        return Response.json(
          { error: "Unauthorized. Provide a valid Bearer token." },
          { status: 401 }
        );
      }
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const parsed = rawBody as Record<string, unknown>;
    if (!parsed.body && !parsed.structured_data) {
      return Response.json(
        { error: "Must provide 'body' and/or 'structured_data'." },
        { status: 400 }
      );
    }

    try {
      const response = await this.respondToMessage({
        messageId,
        body: typeof parsed.body === "string" ? parsed.body : undefined,
        structuredData: parsed.structured_data as Record<string, unknown> | undefined,
        respondedBy: typeof parsed.responded_by === "string" ? parsed.responded_by : "api"
      });
      return Response.json(response, { status: 201 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Respond failed";
      return Response.json({ error: msg }, { status: 404 });
    }
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
You have tools to query the inbox. Answer questions about message volume, actions, routing, and failures.
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
            "List recent messages, optionally filtered by status or action",
          inputSchema: z.object({
            status: z
              .enum(["received", "classifying", "routed", "failed"])
              .nullable(),
            action: z.string().nullable(),
            limit: z.number().int().min(1).max(25)
          }),
          execute: async ({
            status,
            action,
            limit
          }: {
            status: string | null;
            action: string | null;
            limit: number;
          }) => {
            let allRows = this.sql<MessageRow>`
              SELECT * FROM inbox_messages
              ORDER BY received_at DESC
              LIMIT ${RECENT_MESSAGES_LIMIT}
            `;

            if (status !== null) {
              allRows = allRows.filter((r) => r.status === status);
            }
            if (action !== null) {
              allRows = allRows.filter(
                (r) => r.classified_action === action
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
          description: "Search messages by subject, body, or agent name",
          inputSchema: z.object({
            query: z.string().min(1).max(200)
          }),
          execute: async ({ query }: { query: string }) => {
            const pattern = `%${query}%`;
            const rows = this.sql<MessageRow>`
              SELECT * FROM inbox_messages
              WHERE subject LIKE ${pattern} OR body LIKE ${pattern} OR from_agent LIKE ${pattern} OR action LIKE ${pattern}
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

    if (url.pathname === "/.agent/inbox" && request.method === "POST") {
      return this.handleIncomingMessage(request);
    }

    // POST /.agent/inbox/:id/respond
    if (
      url.pathname.match(/^\/\.agent\/inbox\/[^/]+\/respond$/) &&
      request.method === "POST"
    ) {
      const parts = url.pathname.split("/");
      const id = parts[parts.length - 2]!;
      return this.handleRespondHttp(request, id);
    }

    if (
      url.pathname.startsWith("/.agent/inbox/") &&
      request.method === "GET"
    ) {
      const id = url.pathname.slice("/.agent/inbox/".length);
      return this.handleGetMessage(id);
    }

    if (url.pathname === "/.well-known/agent.json") {
      this.ensureTables();
      const config = this.getFullConfig();
      const actions = this.getActions();
      const baseUrl = `${url.protocol}//${url.host}`;
      const doc = buildWellKnownAgent(config, actions, baseUrl);
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

    // CORS preflight for agent routes
    if (request.method === "OPTIONS" && url.pathname.startsWith("/.agent/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // Route agent and well-known requests through the DO
    if (
      url.pathname.startsWith("/.agent/") ||
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
