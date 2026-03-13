import type {
  ActionConfig,
  InboxConfig,
  WellKnownAction,
  WellKnownAgent,
  WellKnownJsonSchemaProperty
} from "./types";

function paramsToJsonSchema(params: ActionConfig["parameters"]): {
  type: "object";
  properties: Record<string, WellKnownJsonSchemaProperty>;
  required: string[];
} {
  const properties: Record<string, WellKnownJsonSchemaProperty> = {};
  const required: string[] = [];

  for (const param of params) {
    const prop: WellKnownJsonSchemaProperty = {
      type: param.type,
      description: param.description
    };

    if (param.enum !== undefined && param.enum.length > 0) {
      prop.enum = param.enum;
    }

    properties[param.name] = prop;

    if (param.required) {
      required.push(param.name);
    }
  }

  return { type: "object", properties, required };
}

function actionToWellKnown(action: ActionConfig): WellKnownAction {
  const result: WellKnownAction = {
    name: action.name,
    description: action.description,
    parameters: paramsToJsonSchema(action.parameters)
  };

  if (action.responseSchema.length > 0) {
    result.response_schema = paramsToJsonSchema(action.responseSchema);
  }

  return result;
}

export function buildWellKnownAgent(
  config: InboxConfig,
  actions: ActionConfig[],
  baseUrl: string
): WellKnownAgent {
  return {
    version: "1.0",
    name: config.siteName,
    description: config.siteDescription,
    message_endpoint: `${baseUrl}/.agent/inbox`,
    authentication: {
      type: "bearer",
      header: "Authorization"
    },
    actions: actions.map(actionToWellKnown),
    rate_limit: {
      requests_per_minute: config.rateLimitPerMinute
    },
    response_modes: ["sync", "poll", "callback"]
  };
}
