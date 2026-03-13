// === Configuration (stored in SQLite, editable via UI) ===

export interface InboxConfig {
  domain: string;
  defaultEmail: string;
  siteName: string;
  siteDescription: string;
  authToken: string;
  rateLimitPerMinute: number;
}

export interface ActionParameter {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ActionConfig {
  name: string;
  description: string;
  email: string;
  autoReply: string | null;
  parameters: ActionParameter[];
  responseSchema: ActionParameter[];
}

// === Responses (bidirectional messaging) ===

export type ResponseStatus = "pending" | "delivered" | "failed";

export interface InboxResponse {
  id: string;
  messageId: string;
  status: ResponseStatus;
  body: string | null;
  structuredData: Record<string, unknown>;
  respondedBy: string;
  createdAt: string;
  updatedAt: string;
}

// === Messages (stored in SQLite) ===

export type MessageStatus = "received" | "classifying" | "routed" | "failed" | "responded";

export type MessagePriority = "low" | "normal" | "high" | "urgent";

export interface InboxMessageSummary {
  id: string;
  receivedAt: string;
  status: MessageStatus;
  fromAgent: string;
  fromOnBehalfOf: string | null;
  action: string | null;
  classifiedAction: string | null;
  actionConfidence: number | null;
  subject: string | null;
  body: string | null;
  parameters: Record<string, unknown> | null;
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
  responses: InboxResponse[];
}

// === API types (what sending agents use) ===

export interface MessageResponse {
  id: string;
  status: MessageStatus;
  action: string;
  auto_reply: string | null;
  message: string;
}

// === Well-known discovery document ===

export interface WellKnownJsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
}

export interface WellKnownAction {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, WellKnownJsonSchemaProperty>;
    required: string[];
  };
  response_schema?: {
    type: "object";
    properties: Record<string, WellKnownJsonSchemaProperty>;
    required: string[];
  };
}

export interface WellKnownAgent {
  version: "1.0";
  name: string;
  description: string;
  message_endpoint: string;
  authentication: {
    type: "bearer";
    header: "Authorization";
  };
  actions: WellKnownAction[];
  rate_limit: {
    requests_per_minute: number;
  };
  response_modes: ("sync" | "poll" | "callback")[];
}

// === Dashboard ===

export interface DashboardOverview {
  totalMessages: number;
  routedMessages: number;
  failedMessages: number;
  messagesLast24h: number;
  topActions: Array<{ action: string; count: number }>;
}

export interface Dashboard {
  overview: DashboardOverview;
  recentMessages: InboxMessageSummary[];
  config: InboxConfig;
  actions: ActionConfig[];
}

// === DB row types ===

export type MessageRow = {
  id: string;
  received_at: number;
  status: string;
  from_agent: string;
  from_on_behalf_of: string | null;
  callback_url: string | null;
  action: string | null;
  classified_action: string | null;
  action_confidence: number | null;
  subject: string | null;
  body: string | null;
  parameters_json: string;
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

export type ActionRow = {
  name: string;
  email: string;
  auto_reply: string | null;
  description: string;
  parameters_json: string;
  response_schema_json: string;
  created_at: number;
  updated_at: number;
};

export type ResponseRow = {
  id: string;
  message_id: string;
  status: string;
  body: string | null;
  structured_data_json: string;
  responded_by: string;
  created_at: number;
  updated_at: number;
};

export type ConfigRow = {
  key: string;
  value: string;
};
