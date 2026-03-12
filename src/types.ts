// === Configuration (stored in SQLite, editable via UI) ===

export interface InboxConfig {
  domain: string;
  defaultEmail: string;
  siteName: string;
  siteDescription: string;
  authToken: string;
  rateLimitPerMinute: number;
}

export interface RouteConfig {
  intent: string;
  email: string;
  autoReply: string | null;
  description: string;
}

// === Messages (stored in SQLite) ===

export type MessageStatus = "received" | "classifying" | "routed" | "failed";

export type MessagePriority = "low" | "normal" | "high" | "urgent";

export interface InboxMessageSummary {
  id: string;
  receivedAt: string;
  status: MessageStatus;
  fromAgent: string;
  fromOnBehalfOf: string | null;
  declaredIntent: string | null;
  classifiedIntent: string | null;
  intentConfidence: number | null;
  subject: string;
  body: string;
  priority: MessagePriority;
  routedTo: string | null;
  autoReply: string | null;
  error: string | null;
}

export interface InboxMessageDetail extends InboxMessageSummary {
  callbackUrl: string | null;
  threadId: string | null;
  metadata: Record<string, unknown>;
  emailMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

// === API types (what sending agents use) ===

export interface IncomingMessage {
  from: {
    agent: string;
    on_behalf_of?: string;
    callback_url?: string;
  };
  intent?: string;
  subject: string;
  body: string;
  priority?: MessagePriority;
  thread_id?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageResponse {
  id: string;
  status: MessageStatus;
  classified_intent: string;
  auto_reply: string | null;
  message: string;
}

// === Well-known discovery document ===

export interface WellKnownAgent {
  version: "1.0";
  name: string;
  description: string;
  message_endpoint: string;
  authentication: {
    type: "bearer";
    header: "Authorization";
  };
  capabilities: string[];
  intents: Array<{
    name: string;
    description: string;
  }>;
  rate_limit: {
    requests_per_minute: number;
  };
  response_modes: ["sync"];
}

// === Dashboard ===

export interface DashboardOverview {
  totalMessages: number;
  routedMessages: number;
  failedMessages: number;
  messagesLast24h: number;
  topIntents: Array<{ intent: string; count: number }>;
}

export interface Dashboard {
  overview: DashboardOverview;
  recentMessages: InboxMessageSummary[];
  config: InboxConfig;
  routes: RouteConfig[];
}

// === DB row types ===

export type MessageRow = {
  id: string;
  received_at: number;
  status: string;
  from_agent: string;
  from_on_behalf_of: string | null;
  callback_url: string | null;
  declared_intent: string | null;
  classified_intent: string | null;
  intent_confidence: number | null;
  subject: string;
  body: string;
  priority: string;
  thread_id: string | null;
  metadata_json: string;
  routed_to: string | null;
  auto_reply: string | null;
  email_message_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type RouteRow = {
  intent: string;
  email: string;
  auto_reply: string | null;
  description: string;
  created_at: number;
  updated_at: number;
};

export type ConfigRow = {
  key: string;
  value: string;
};
