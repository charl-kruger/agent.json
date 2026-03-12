import type { InboxConfig, RouteConfig, WellKnownAgent } from "./types";

export function buildWellKnownAgent(
  config: InboxConfig,
  routes: RouteConfig[],
  baseUrl: string
): WellKnownAgent {
  return {
    version: "1.0",
    name: config.siteName,
    description: config.siteDescription,
    message_endpoint: `${baseUrl}/api/message`,
    authentication: {
      type: "bearer",
      header: "Authorization"
    },
    capabilities: routes.map((route) => route.intent),
    intents: routes.map((route) => ({
      name: route.intent,
      description: route.description
    })),
    rate_limit: {
      requests_per_minute: config.rateLimitPerMinute
    },
    response_modes: ["sync"]
  };
}
