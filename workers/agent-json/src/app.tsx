import {
  Fragment,
  Suspense,
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { getToolName, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import {
  Badge,
  Button,
  Empty,
  InputArea,
  Surface,
  Text
} from "@cloudflare/kumo";
import { Toasty, useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { Streamdown } from "streamdown";
import {
  BrainIcon,
  ChatCircleDotsIcon,
  CircleIcon,
  GearIcon,
  EnvelopeSimpleIcon,
  PaperPlaneRightIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
  ArrowClockwiseIcon,
  CopyIcon
} from "@phosphor-icons/react";
import type {
  ActionConfig,
  ActionParameter,
  Dashboard,
  InboxConfig,
  InboxMessageDetail,
  InboxMessageSummary
} from "./types";

type InboxEvent = {
  type: "inbox-updated";
  event: "message-routed" | "action-changed" | "message-responded";
  messageId?: string;
};

type ActiveTab = "dashboard" | "config" | "chat";

const STARTER_PROMPTS = [
  "How many messages were routed today?",
  "Show me any failed deliveries.",
  "What are the most common actions?",
  "Which agents are messaging me most?"
];

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusColor(
  status: InboxMessageSummary["status"]
): string {
  return status;
}

function statusTone(
  status: InboxMessageSummary["status"]
): "primary" | "secondary" | "destructive" {
  if (status === "routed" || status === "responded") return "primary";
  if (status === "failed") return "destructive";
  return "secondary";
}

// --- Message list item ---

function MessageListItem({
  message,
  selected,
  onSelect
}: {
  message: InboxMessageSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`inbox-list-item ${selected ? "inbox-list-item-selected" : ""}`}
      onClick={() => onSelect(message.id)}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="inbox-label">{message.fromAgent}</p>
          {message.fromOnBehalfOf && (
            <p className="inbox-muted">on behalf of {message.fromOnBehalfOf}</p>
          )}
        </div>
        <span
          className={`inbox-status-dot inbox-status-${statusColor(message.status)}`}
        />
      </div>
      <p className="inbox-title" style={{ fontSize: "0.92rem" }}>
        {message.action ? `Action: ${message.action}` : message.subject}
      </p>
      <p className="inbox-muted" style={{ marginTop: "0.35rem" }}>
        {message.action && message.parameters
          ? Object.entries(message.parameters).map(([k, v]) => `${k}: ${String(v)}`).join(", ")
          : message.body}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant={statusTone(message.status)}>{message.status}</Badge>
        {message.classifiedAction && (
          <Badge variant="secondary">{message.classifiedAction}</Badge>
        )}
        {message.priority !== "normal" && (
          <Badge variant="secondary">{message.priority}</Badge>
        )}
      </div>
    </button>
  );
}

// --- Respond form ---

function RespondForm({
  onRespond,
  busy
}: {
  onRespond: (body: string, structuredData?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [responseBody, setResponseBody] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [jsonData, setJsonData] = useState("");

  return (
    <div
      style={{
        display: "grid",
        gap: "0.6rem",
        padding: "1rem",
        borderRadius: "1rem",
        background: "rgba(240, 244, 248, 0.6)",
        border: `1px solid var(--inbox-border)`
      }}
    >
      <Text size="sm" bold>Respond to Message</Text>
      <textarea
        className="inbox-input"
        value={responseBody}
        onChange={(e) => setResponseBody(e.target.value)}
        placeholder="Type your response..."
        rows={3}
        style={{ resize: "vertical" }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem" }}>
        <input
          type="checkbox"
          checked={showJson}
          onChange={(e) => setShowJson(e.target.checked)}
        />
        Include structured data (JSON)
      </label>
      {showJson && (
        <textarea
          className="inbox-input"
          value={jsonData}
          onChange={(e) => setJsonData(e.target.value)}
          placeholder='{"refund_id": "ref_123", "amount": 29.99}'
          rows={3}
          style={{ resize: "vertical", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.82rem" }}
        />
      )}
      <Button
        variant="primary"
        size="sm"
        disabled={busy || (responseBody.trim().length === 0 && jsonData.trim().length === 0)}
        onClick={async () => {
          let structured: Record<string, unknown> | undefined;
          if (showJson && jsonData.trim().length > 0) {
            try {
              structured = JSON.parse(jsonData) as Record<string, unknown>;
            } catch {
              return; // Invalid JSON, don't submit
            }
          }
          await onRespond(responseBody.trim(), structured);
          setResponseBody("");
          setJsonData("");
        }}
      >
        <PaperPlaneRightIcon size={14} className="mr-1" />
        Send Response
      </Button>
    </div>
  );
}

// --- Message detail ---

function DetailView({
  message,
  onRespond,
  busy
}: {
  message: InboxMessageDetail | null;
  onRespond: (messageId: string, body: string, structuredData?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  if (message === null) {
    return (
      <Surface className="inbox-panel inbox-detail-panel">
        <div className="inbox-empty-state">
          <EnvelopeSimpleIcon size={40} />
          <p className="inbox-title" style={{ marginTop: "1rem" }}>
            No message selected
          </p>
          <p className="inbox-muted">
            Choose a message from the list to view its details, routing, and
            metadata.
          </p>
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="inbox-panel inbox-detail-panel">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inbox-title">{message.subject}</p>
          <p className="inbox-muted">
            From <strong>{message.fromAgent}</strong>
            {message.fromOnBehalfOf
              ? ` on behalf of ${message.fromOnBehalfOf}`
              : ""}
          </p>
          <p className="inbox-muted">{formatTimestamp(message.receivedAt)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge variant={statusTone(message.status)}>{message.status}</Badge>
        </div>
      </div>

      <section className="inbox-section">
        <h3 className="inbox-section-title">Routing</h3>
        <div className="inbox-meta-grid">
          <span className="inbox-meta-key">Classified Action</span>
          <span className="inbox-meta-value">
            {message.classifiedAction ?? "pending"}
            {message.actionConfidence !== null &&
              ` (${Math.round(message.actionConfidence * 100)}%)`}
          </span>
          {message.action && (
            <>
              <span className="inbox-meta-key">Action (structured)</span>
              <span className="inbox-meta-value">
                {message.action}
              </span>
            </>
          )}
          <span className="inbox-meta-key">Routed To</span>
          <span className="inbox-meta-value">
            {message.routedTo ?? "not yet routed"}
          </span>
          <span className="inbox-meta-key">Priority</span>
          <span className="inbox-meta-value">{message.priority}</span>
          {message.emailMessageId && (
            <>
              <span className="inbox-meta-key">Email ID</span>
              <span className="inbox-meta-value">
                {message.emailMessageId}
              </span>
            </>
          )}
        </div>
      </section>

      {message.autoReply && (
        <section className="inbox-section">
          <h3 className="inbox-section-title">Auto Reply Sent</h3>
          <div className="inbox-chip inbox-chip-accent">
            {message.autoReply}
          </div>
        </section>
      )}

      {message.error && (
        <section className="inbox-section">
          <h3 className="inbox-section-title">Error</h3>
          <div className="inbox-chip inbox-chip-danger">{message.error}</div>
        </section>
      )}

      {message.action && message.parameters && Object.keys(message.parameters).length > 0 ? (
        <section className="inbox-section">
          <h3 className="inbox-section-title">Parameters</h3>
          <div className="inbox-meta-grid">
            {Object.entries(message.parameters).map(([key, value]) => (
              <Fragment key={key}>
                <span className="inbox-meta-key">{key}</span>
                <span className="inbox-meta-value">{String(value)}</span>
              </Fragment>
            ))}
          </div>
        </section>
      ) : (
        <section className="inbox-section">
          <h3 className="inbox-section-title">Message Body</h3>
          <pre className="inbox-body-preview">{message.body}</pre>
        </section>
      )}

      {Object.keys(message.metadata).length > 0 && (
        <section className="inbox-section">
          <h3 className="inbox-section-title">Metadata</h3>
          <pre className="inbox-body-preview" style={{ fontSize: "0.82rem" }}>
            {JSON.stringify(message.metadata, null, 2)}
          </pre>
        </section>
      )}

      {/* Response history */}
      {message.responses.length > 0 && (
        <section className="inbox-section">
          <h3 className="inbox-section-title">Responses</h3>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {message.responses.map((resp) => (
              <div key={resp.id} className="inbox-response-card">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    {resp.respondedBy}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant={
                        resp.status === "delivered"
                          ? "primary"
                          : resp.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {resp.status}
                    </Badge>
                    <span className="inbox-muted" style={{ fontSize: "0.75rem" }}>
                      {formatTimestamp(resp.createdAt)}
                    </span>
                  </div>
                </div>
                {resp.body && (
                  <p style={{ margin: "0.3rem 0", fontSize: "0.88rem", lineHeight: 1.5 }}>
                    {resp.body}
                  </p>
                )}
                {Object.keys(resp.structuredData).length > 0 && (
                  <pre
                    style={{
                      margin: "0.3rem 0 0",
                      fontSize: "0.78rem",
                      fontFamily: "'JetBrains Mono', monospace",
                      background: "rgba(240, 244, 248, 0.7)",
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.5rem",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere"
                    }}
                  >
                    {JSON.stringify(resp.structuredData, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Respond form — show when message is routed or already responded */}
      {(message.status === "routed" || message.status === "responded") && (
        <section className="inbox-section">
          <RespondForm
            onRespond={(body, structured) =>
              onRespond(message.id, body, structured)
            }
            busy={busy}
          />
        </section>
      )}
    </Surface>
  );
}

// --- Config panel ---

const EMPTY_PARAM: ActionParameter = {
  name: "",
  type: "string",
  description: "",
  required: false
};

function ConfigPanel({
  config,
  actions,
  onSaveConfig,
  onAddAction,
  onRemoveAction,
  onRegenerateToken,
  busy
}: {
  config: InboxConfig;
  actions: ActionConfig[];
  onSaveConfig: (config: Omit<InboxConfig, "authToken">) => Promise<void>;
  onAddAction: (action: ActionConfig) => Promise<void>;
  onRemoveAction: (name: string) => Promise<void>;
  onRegenerateToken: () => Promise<void>;
  busy: boolean;
}) {
  const [domain, setDomain] = useState(config.domain);
  const [defaultEmail, setDefaultEmail] = useState(config.defaultEmail);
  const [siteName, setSiteName] = useState(config.siteName);
  const [siteDescription, setSiteDescription] = useState(
    config.siteDescription
  );
  const [rateLimit, setRateLimit] = useState(
    String(config.rateLimitPerMinute)
  );

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAutoReply, setNewAutoReply] = useState("");
  const [newParams, setNewParams] = useState<ActionParameter[]>([]);
  const [newRespSchema, setNewRespSchema] = useState<ActionParameter[]>([]);

  useEffect(() => {
    setDomain(config.domain);
    setDefaultEmail(config.defaultEmail);
    setSiteName(config.siteName);
    setSiteDescription(config.siteDescription);
    setRateLimit(String(config.rateLimitPerMinute));
  }, [config]);

  function updateParam(index: number, patch: Partial<ActionParameter>) {
    setNewParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    );
  }

  function removeParam(index: number) {
    setNewParams((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRespField(index: number, patch: Partial<ActionParameter>) {
    setNewRespSchema((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    );
  }

  function removeRespField(index: number) {
    setNewRespSchema((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: "50rem" }}>
      <Surface className="inbox-panel" style={{ padding: "1.5rem" }}>
        <h2 className="inbox-title" style={{ marginBottom: "1rem" }}>
          <GearIcon size={18} className="mr-2 inline" />
          Site Configuration
        </h2>
        <div className="inbox-config-form">
          <div className="inbox-field">
            <label className="inbox-field-label">Domain</label>
            <input
              className="inbox-input"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="charl.dev"
            />
          </div>
          <div className="inbox-field">
            <label className="inbox-field-label">Default Email</label>
            <input
              className="inbox-input"
              value={defaultEmail}
              onChange={(e) => setDefaultEmail(e.target.value)}
              placeholder="hello@charl.dev"
            />
          </div>
          <div className="inbox-field">
            <label className="inbox-field-label">Site Name</label>
            <input
              className="inbox-input"
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              placeholder="My Website"
            />
          </div>
          <div className="inbox-field">
            <label className="inbox-field-label">Site Description</label>
            <input
              className="inbox-input"
              value={siteDescription}
              onChange={(e) => setSiteDescription(e.target.value)}
              placeholder="A short description of your website"
            />
          </div>
          <div className="inbox-field">
            <label className="inbox-field-label">
              Rate Limit (requests/min)
            </label>
            <input
              className="inbox-input"
              type="number"
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() =>
              void onSaveConfig({
                domain,
                defaultEmail,
                siteName,
                siteDescription,
                rateLimitPerMinute: Number(rateLimit) || 60
              })
            }
          >
            Save Configuration
          </Button>
        </div>
      </Surface>

      <Surface className="inbox-panel" style={{ padding: "1.5rem" }}>
        <h2 className="inbox-title" style={{ marginBottom: "0.5rem" }}>
          Auth Token
        </h2>
        <p className="inbox-muted" style={{ marginBottom: "0.75rem" }}>
          Agents include this as a Bearer token to authenticate with your inbox.
        </p>
        <div className="inbox-token-display" style={{ marginBottom: "0.75rem" }}>
          {config.authToken || "(no token set — inbox is open)"}
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void onRegenerateToken()}
          >
            <ArrowClockwiseIcon size={14} className="mr-1" />
            {config.authToken ? "Regenerate" : "Generate Token"}
          </Button>
          {config.authToken && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void navigator.clipboard.writeText(config.authToken)
              }
            >
              <CopyIcon size={14} className="mr-1" />
              Copy
            </Button>
          )}
        </div>
      </Surface>

      <Surface className="inbox-panel" style={{ padding: "1.5rem" }}>
        <h2 className="inbox-title" style={{ marginBottom: "0.5rem" }}>
          Actions
        </h2>
        <p className="inbox-muted" style={{ marginBottom: "1rem" }}>
          Define callable actions with parameter schemas. Agents can call actions
          directly with structured parameters, or send free-form messages that
          the AI classifies.
        </p>

        <div className="inbox-route-list" style={{ marginBottom: "1.5rem" }}>
          {actions.length === 0 && (
            <p className="inbox-muted">
              No actions configured. Add your first action below.
            </p>
          )}
          {actions.map((action) => (
            <div key={action.name} className="inbox-route-card">
              <div className="inbox-route-info">
                <p className="inbox-label">{action.name}</p>
                <p className="inbox-muted">
                  {action.email} — {action.description}
                </p>
                {action.autoReply && (
                  <p className="inbox-muted" style={{ fontStyle: "italic" }}>
                    Auto-reply: {action.autoReply}
                  </p>
                )}
                {action.parameters.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {action.parameters.map((p) => (
                      <span key={p.name} className="inbox-chip inbox-chip-accent">
                        {p.name}: {p.type}{p.required ? " *" : ""}
                      </span>
                    ))}
                  </div>
                )}
                {action.responseSchema.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    <span style={{ fontSize: "0.72rem", color: "var(--inbox-muted)", fontWeight: 600 }}>Response:</span>
                    {action.responseSchema.map((p) => (
                      <span key={p.name} className="inbox-chip inbox-chip-success">
                        {p.name}: {p.type}{p.required ? " *" : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                shape="square"
                icon={<TrashIcon size={16} />}
                disabled={busy}
                onClick={() => void onRemoveAction(action.name)}
                aria-label={`Remove ${action.name} action`}
              />
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gap: "0.75rem",
            padding: "1rem",
            borderRadius: "1rem",
            background: "rgba(240, 244, 248, 0.6)",
            border: `1px solid var(--inbox-border)`
          }}
        >
          <Text size="sm" bold>
            Add Action
          </Text>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
            <input
              className="inbox-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Action name (e.g. request_refund)"
            />
            <input
              className="inbox-input"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Email (e.g. refund@charl.dev)"
            />
          </div>
          <input
            className="inbox-input"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (e.g. Request a refund for an order)"
          />
          <input
            className="inbox-input"
            value={newAutoReply}
            onChange={(e) => setNewAutoReply(e.target.value)}
            placeholder="Auto-reply (optional)"
          />

          {newParams.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <Text size="xs" bold>Parameters</Text>
              {newParams.map((param, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr auto auto",
                    gap: "0.4rem",
                    alignItems: "center"
                  }}
                >
                  <input
                    className="inbox-input"
                    value={param.name}
                    onChange={(e) => updateParam(index, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <select
                    className="inbox-input"
                    value={param.type}
                    onChange={(e) =>
                      updateParam(index, {
                        type: e.target.value as ActionParameter["type"]
                      })
                    }
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                  <input
                    className="inbox-input"
                    value={param.description}
                    onChange={(e) =>
                      updateParam(index, { description: e.target.value })
                    }
                    placeholder="Description"
                  />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      fontSize: "0.8rem"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={param.required}
                      onChange={(e) =>
                        updateParam(index, { required: e.target.checked })
                      }
                    />
                    Req
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    shape="square"
                    icon={<TrashIcon size={14} />}
                    onClick={() => removeParam(index)}
                    aria-label="Remove parameter"
                  />
                </div>
              ))}
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setNewParams((prev) => [...prev, { ...EMPTY_PARAM }])}
          >
            <PlusIcon size={14} className="mr-1" />
            Add Parameter
          </Button>

          {newRespSchema.length > 0 && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <Text size="xs" bold>Response Schema</Text>
              {newRespSchema.map((field, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr auto auto",
                    gap: "0.4rem",
                    alignItems: "center"
                  }}
                >
                  <input
                    className="inbox-input"
                    value={field.name}
                    onChange={(e) => updateRespField(index, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <select
                    className="inbox-input"
                    value={field.type}
                    onChange={(e) =>
                      updateRespField(index, {
                        type: e.target.value as ActionParameter["type"]
                      })
                    }
                  >
                    <option value="string">string</option>
                    <option value="number">number</option>
                    <option value="boolean">boolean</option>
                  </select>
                  <input
                    className="inbox-input"
                    value={field.description}
                    onChange={(e) =>
                      updateRespField(index, { description: e.target.value })
                    }
                    placeholder="Description"
                  />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      fontSize: "0.8rem"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateRespField(index, { required: e.target.checked })
                      }
                    />
                    Req
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    shape="square"
                    icon={<TrashIcon size={14} />}
                    onClick={() => removeRespField(index)}
                    aria-label="Remove response field"
                  />
                </div>
              ))}
            </div>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setNewRespSchema((prev) => [...prev, { ...EMPTY_PARAM }])}
          >
            <PlusIcon size={14} className="mr-1" />
            Add Response Field
          </Button>

          <Button
            variant="primary"
            size="sm"
            disabled={
              busy ||
              newName.trim().length === 0 ||
              newEmail.trim().length === 0 ||
              newDescription.trim().length === 0
            }
            onClick={async () => {
              await onAddAction({
                name: newName.trim(),
                email: newEmail.trim(),
                autoReply: newAutoReply.trim() || null,
                description: newDescription.trim(),
                parameters: newParams.filter((p) => p.name.trim().length > 0),
                responseSchema: newRespSchema.filter((p) => p.name.trim().length > 0)
              });
              setNewName("");
              setNewEmail("");
              setNewDescription("");
              setNewAutoReply("");
              setNewParams([]);
              setNewRespSchema([]);
            }}
          >
            <PlusIcon size={14} className="mr-1" />
            Add Action
          </Button>
        </div>
      </Surface>
    </div>
  );
}

// --- Chat panel ---

function ChatPanel({
  messages,
  input,
  setInput,
  isStreaming,
  connected,
  sendMessage,
  stop
}: {
  messages: UIMessage[];
  input: string;
  setInput: (value: string) => void;
  isStreaming: boolean;
  connected: boolean;
  sendMessage: (prompt: string) => void;
  stop: () => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

  return (
    <div style={{ maxWidth: "50rem" }}>
      <Surface className="inbox-panel inbox-chat-panel">
        <div style={{ padding: "1rem 1rem 0.75rem" }}>
          <div className="flex items-center gap-2">
            <ChatCircleDotsIcon size={18} />
            <Text size="sm" bold>
              Inbox Copilot
            </Text>
          </div>
          <p className="inbox-muted">
            Ask questions about your inbox — message volume, actions, routing
            status, and more.
          </p>
        </div>

        <div className="inbox-chat-scroll">
          {messages.length === 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.4rem",
                padding: "0.25rem 0 1rem"
              }}
            >
              {STARTER_PROMPTS.map((prompt) => (
                <Button
                  key={prompt}
                  variant="secondary"
                  size="sm"
                  disabled={!connected}
                  onClick={() => sendMessage(prompt)}
                >
                  {prompt}
                </Button>
              ))}
            </div>
          )}

          {messages.map((message) => {
            const assistant = message.role === "assistant";

            return (
              <div key={message.id} className="inbox-chat-block">
                {message.parts.filter(isToolUIPart).map((part) => {
                  if (part.state !== "output-available") return null;
                  return (
                    <Surface
                      key={part.toolCallId}
                      className="rounded-xl border border-kumo-line px-3 py-2"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <BrainIcon size={12} />
                        <Text size="xs" variant="secondary" bold>
                          {getToolName(part)}
                        </Text>
                        <Badge variant="secondary">Tool</Badge>
                      </div>
                      <pre className="inbox-tool-output">
                        {JSON.stringify(part.output, null, 2)}
                      </pre>
                    </Surface>
                  );
                })}

                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part, index) => {
                    const textPart = part as { text: string };
                    return (
                      <div
                        key={index}
                        className={`inbox-chat-bubble ${
                          assistant
                            ? "inbox-chat-bubble-assistant"
                            : "inbox-chat-bubble-user"
                        }`}
                      >
                        {assistant ? (
                          <Streamdown controls={false}>
                            {textPart.text}
                          </Streamdown>
                        ) : (
                          textPart.text
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <form
          className="inbox-chat-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = input.trim();
            if (trimmed.length === 0 || isStreaming) return;
            sendMessage(trimmed);
            setInput("");
            if (textareaRef.current) textareaRef.current.style.height = "auto";
          }}
        >
          <InputArea
            ref={textareaRef}
            value={input}
            onValueChange={setInput}
            rows={1}
            disabled={!connected || isStreaming}
            placeholder="Ask about your inbox..."
            className="inbox-chat-input"
            onInput={(event) => {
              const el = event.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const trimmed = input.trim();
                if (trimmed.length === 0 || isStreaming) return;
                sendMessage(trimmed);
                setInput("");
                if (textareaRef.current)
                  textareaRef.current.style.height = "auto";
              }
            }}
          />
          {isStreaming ? (
            <Button
              type="button"
              shape="square"
              variant="secondary"
              aria-label="Stop"
              icon={<StopIcon size={18} />}
              onClick={stop}
            />
          ) : (
            <Button
              type="submit"
              shape="square"
              variant="primary"
              aria-label="Send"
              icon={<PaperPlaneRightIcon size={18} />}
              disabled={!connected || input.trim().length === 0}
            />
          )}
        </form>
      </Surface>
    </div>
  );
}

// === Main App ===

function InboxApp() {
  const [connected, setConnected] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null
  );
  const [selectedMessage, setSelectedMessage] =
    useState<InboxMessageDetail | null>(null);
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard");
  const [busy, setBusy] = useState(false);
  const toasts = useKumoToastManager();

  const refreshDashboard = useEffectEvent(async () => {
    try {
      const data = await agent.call<Dashboard>("getDashboard");
      startTransition(() => {
        setDashboard(data);
        if (
          selectedMessageId === null &&
          data.recentMessages.length > 0
        ) {
          setSelectedMessageId(data.recentMessages[0]!.id);
        }
      });
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Dashboard refresh failed";
      toasts.add({ title: "Refresh failed", description: desc });
    }
  });

  const loadMessage = useEffectEvent(async (id: string) => {
    try {
      const detail = await agent.call<InboxMessageDetail | null>(
        "getMessage",
        [id]
      );
      startTransition(() => setSelectedMessage(detail));
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Message fetch failed";
      toasts.add({ title: "Could not load message", description: desc });
    }
  });

  const handleInboxEvent = useEffectEvent((event: InboxEvent) => {
    const titles: Record<string, string> = {
      "message-routed": "New message routed",
      "message-responded": "Response sent",
      "action-changed": "Actions updated"
    };
    toasts.add({
      title: titles[event.event] ?? "Inbox updated",
      description: event.messageId ?? "Inbox state changed"
    });
    void refreshDashboard();
    if (event.messageId && event.messageId === selectedMessageId) {
      void loadMessage(event.messageId);
    }
  });

  const agent = useAgent({
    agent: "InboxAgent",
    name: "primary",
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
    onError: (error: Event) => console.error("Agent connection error", error),
    onMessage: (message: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(message.data)) as InboxEvent;
        if (parsed.type === "inbox-updated") {
          handleInboxEvent(parsed);
        }
      } catch {
        // Ignore non-JSON frames
      }
    }
  });

  const { messages, sendMessage, status, stop } = useAgentChat({ agent });
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (connected) void refreshDashboard();
  }, [connected]);

  useEffect(() => {
    if (connected && selectedMessageId !== null) {
      void loadMessage(selectedMessageId);
    }
  }, [connected, selectedMessageId]);

  async function handleSaveConfig(
    config: Omit<InboxConfig, "authToken">
  ): Promise<void> {
    setBusy(true);
    try {
      await agent.call("updateConfig", [config]);
      await refreshDashboard();
      toasts.add({
        title: "Configuration saved",
        description: "Your inbox settings have been updated."
      });
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Save failed";
      toasts.add({ title: "Save failed", description: desc });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddAction(action: ActionConfig): Promise<void> {
    setBusy(true);
    try {
      await agent.call("addAction", [action]);
      await refreshDashboard();
      toasts.add({
        title: "Action added",
        description: `"${action.name}" → ${action.email}`
      });
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Add action failed";
      toasts.add({ title: "Add action failed", description: desc });
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAction(name: string): Promise<void> {
    setBusy(true);
    try {
      await agent.call("removeAction", [name]);
      await refreshDashboard();
      toasts.add({
        title: "Action removed",
        description: `Removed action "${name}"`
      });
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Remove action failed";
      toasts.add({ title: "Remove action failed", description: desc });
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerateToken(): Promise<void> {
    setBusy(true);
    try {
      const token = await agent.call<string>("regenerateAuthToken");
      await refreshDashboard();
      toasts.add({
        title: "Token regenerated",
        description: `New token: ${token.slice(0, 8)}...`
      });
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Token generation failed";
      toasts.add({ title: "Token failed", description: desc });
    } finally {
      setBusy(false);
    }
  }

  async function handleRespondToMessage(
    messageId: string,
    body: string,
    structuredData?: Record<string, unknown>
  ): Promise<void> {
    setBusy(true);
    try {
      await agent.call("respondToMessage", [{ messageId, body: body || undefined, structuredData }]);
      await loadMessage(messageId);
      await refreshDashboard();
      toasts.add({
        title: "Response sent",
        description: "Your response has been recorded."
      });
    } catch (error) {
      const desc =
        error instanceof Error ? error.message : "Respond failed";
      toasts.add({ title: "Respond failed", description: desc });
    } finally {
      setBusy(false);
    }
  }

  function submitChatPrompt(prompt: string): void {
    sendMessage({
      role: "user",
      parts: [{ type: "text", text: prompt }]
    });
  }

  const overview = dashboard?.overview;

  return (
    <div className="inbox-shell">
      <header className="inbox-header">
        <div>
          <p className="inbox-eyebrow">agent.json</p>
          <h1 className="inbox-heading">Message Router</h1>
          <p className="inbox-subheading">
            AI-powered inbox for your website. Any agent can message you — the
            AI classifies intent and routes to the right email.
          </p>
        </div>
        <div className="inbox-header-status">
          <div className="inbox-connection-pill">
            <CircleIcon
              size={10}
              weight="fill"
              className={connected ? "text-kumo-success" : "text-kumo-danger"}
            />
            <span>{connected ? "connected" : "disconnected"}</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!connected}
            onClick={() => void refreshDashboard()}
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="inbox-tab-bar">
        <button
          type="button"
          className={`inbox-tab ${activeTab === "dashboard" ? "inbox-tab-active" : ""}`}
          onClick={() => setActiveTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={`inbox-tab ${activeTab === "config" ? "inbox-tab-active" : ""}`}
          onClick={() => setActiveTab("config")}
        >
          Configuration
        </button>
        <button
          type="button"
          className={`inbox-tab ${activeTab === "chat" ? "inbox-tab-active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          Chat Copilot
        </button>
      </div>

      {activeTab === "dashboard" && (
        <>
          <section className="inbox-overview-grid">
            <Surface className="inbox-stat-card">
              <p className="inbox-stat-label">Total Messages</p>
              <p className="inbox-stat-value">
                {overview?.totalMessages ?? 0}
              </p>
            </Surface>
            <Surface className="inbox-stat-card">
              <p className="inbox-stat-label">Routed</p>
              <p className="inbox-stat-value">
                {overview?.routedMessages ?? 0}
              </p>
            </Surface>
            <Surface className="inbox-stat-card">
              <p className="inbox-stat-label">Failed</p>
              <p className="inbox-stat-value">
                {overview?.failedMessages ?? 0}
              </p>
            </Surface>
            <Surface className="inbox-stat-card">
              <p className="inbox-stat-label">Last 24h</p>
              <p className="inbox-stat-value">
                {overview?.messagesLast24h ?? 0}
              </p>
            </Surface>
          </section>

          {overview && overview.topActions.length > 0 && (
            <div
              className="mb-4 flex flex-wrap gap-2"
              style={{ marginBottom: "1rem" }}
            >
              <Text size="xs" variant="secondary" bold>
                Top actions:
              </Text>
              {overview.topActions.map((ta) => (
                <span key={ta.action} className="inbox-chip inbox-chip-accent">
                  {ta.action} ({ta.count})
                </span>
              ))}
            </div>
          )}

          <main className="inbox-main-grid">
            <Surface className="inbox-panel inbox-list-panel">
              <div className="inbox-list-toolbar">
                <div>
                  <p className="inbox-label">Messages</p>
                  <p className="inbox-muted">
                    {dashboard?.recentMessages.length ?? 0} recent
                  </p>
                </div>
              </div>
              <div className="inbox-list-scroll">
                {(dashboard?.recentMessages.length ?? 0) === 0 ? (
                  <Empty
                    icon={<EnvelopeSimpleIcon size={28} />}
                    title="No messages yet"
                    contents="Messages from AI agents will appear here once routed."
                  />
                ) : (
                  dashboard?.recentMessages.map((msg) => (
                    <MessageListItem
                      key={msg.id}
                      message={msg}
                      selected={msg.id === selectedMessageId}
                      onSelect={setSelectedMessageId}
                    />
                  ))
                )}
              </div>
            </Surface>

            <DetailView
              message={selectedMessage}
              onRespond={handleRespondToMessage}
              busy={busy}
            />
          </main>
        </>
      )}

      {activeTab === "config" && dashboard && (
        <ConfigPanel
          config={dashboard.config}
          actions={dashboard.actions}
          onSaveConfig={handleSaveConfig}
          onAddAction={handleAddAction}
          onRemoveAction={handleRemoveAction}
          onRegenerateToken={handleRegenerateToken}
          busy={busy}
        />
      )}

      {activeTab === "chat" && (
        <ChatPanel
          messages={messages}
          input={input}
          setInput={setInput}
          isStreaming={isStreaming}
          connected={connected}
          sendMessage={submitChatPrompt}
          stop={stop}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <Toasty>
      <Suspense
        fallback={
          <div className="inbox-loading">
            <Text>Loading agent.json...</Text>
          </div>
        }
      >
        <InboxApp />
      </Suspense>
    </Toasty>
  );
}
