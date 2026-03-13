---
title: Any HTTP client
description: Integrate with agent-inbox from any language or framework.
---

agent-inbox is a plain HTTP protocol. Any language that can make HTTP requests can integrate. This guide covers the pattern that works everywhere.

## The integration pattern

Every integration follows the same three steps:

1. **Discover** — `GET /.well-known/agent.json` to learn what actions are available
2. **Send** — `POST /.agent/inbox` with action + parameters (or subject + body)
3. **Receive** — `GET /.agent/inbox/:id` to poll, or receive a callback webhook

## cURL

The simplest integration — useful for testing and shell scripts.

### Discover

```bash
curl -s https://example.com/.well-known/agent.json | jq '.actions[].name'
```

### Send a structured message

```bash
curl -X POST https://example.com/.agent/inbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "from": { "agent": "my-script" },
    "action": "request_refund",
    "parameters": { "order_id": "ORD-123", "reason": "damaged" }
  }'
```

### Poll for response

```bash
curl -s https://example.com/.agent/inbox/MSG_ID \
  -H "Authorization: Bearer YOUR_TOKEN" | jq '.response'
```

## Python (requests)

```python
import requests

BASE = "https://example.com"
TOKEN = "your-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Discover
discovery = requests.get(f"{BASE}/.well-known/agent.json").json()
print(f"Available actions: {[a['name'] for a in discovery['actions']]}")

# Send
result = requests.post(
    discovery["message_endpoint"],
    json={
        "from": {"agent": "python-script"},
        "action": "request_refund",
        "parameters": {"order_id": "ORD-123", "reason": "damaged"}
    },
    headers=HEADERS
).json()

print(f"Message ID: {result['id']}, Status: {result['status']}")

# Poll
import time
for _ in range(10):
    status = requests.get(
        f"{discovery['message_endpoint']}/{result['id']}",
        headers=HEADERS
    ).json()
    if status.get("response"):
        print(f"Response: {status['response']}")
        break
    time.sleep(5)
```

## JavaScript / TypeScript (fetch)

```typescript
const BASE = "https://example.com";
const TOKEN = "your-token";

// Discover
const discovery = await fetch(`${BASE}/.well-known/agent.json`).then(r => r.json());

// Send
const result = await fetch(discovery.message_endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${TOKEN}`
  },
  body: JSON.stringify({
    from: { agent: "js-agent" },
    action: "request_refund",
    parameters: { order_id: "ORD-123", reason: "damaged" }
  })
}).then(r => r.json());

console.log(`Sent: ${result.id} — ${result.status}`);

// Poll for response
const check = await fetch(`${discovery.message_endpoint}/${result.id}`, {
  headers: { "Authorization": `Bearer ${TOKEN}` }
}).then(r => r.json());

if (check.response) {
  console.log("Response:", check.response.structured_data);
}
```

## Go

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

func main() {
    base := "https://example.com"
    token := "your-token"

    // Send a message
    payload, _ := json.Marshal(map[string]any{
        "from":       map[string]string{"agent": "go-agent"},
        "action":     "request_refund",
        "parameters": map[string]string{"order_id": "ORD-123", "reason": "damaged"},
    })

    req, _ := http.NewRequest("POST", base+"/.agent/inbox", bytes.NewReader(payload))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("Authorization", "Bearer "+token)

    resp, _ := http.DefaultClient.Do(req)
    defer resp.Body.Close()

    var result map[string]any
    json.NewDecoder(resp.Body).Decode(&result)
    fmt.Printf("Sent: %s — %s\n", result["id"], result["status"])
}
```

## Ruby

```ruby
require "net/http"
require "json"
require "uri"

base = "https://example.com"
token = "your-token"

# Discover
uri = URI("#{base}/.well-known/agent.json")
discovery = JSON.parse(Net::HTTP.get(uri))

# Send
uri = URI(discovery["message_endpoint"])
http = Net::HTTP.new(uri.host, uri.port)
http.use_ssl = true

request = Net::HTTP::Post.new(uri)
request["Content-Type"] = "application/json"
request["Authorization"] = "Bearer #{token}"
request.body = {
  from: { agent: "ruby-agent" },
  action: "request_refund",
  parameters: { order_id: "ORD-123", reason: "damaged" }
}.to_json

response = http.request(request)
result = JSON.parse(response.body)
puts "Sent: #{result['id']} — #{result['status']}"
```

## Receiving callbacks

If your agent can receive webhooks, provide a `callback_url` in the `from` object:

```json
{
  "from": {
    "agent": "my-agent",
    "callback_url": "https://my-server.com/webhooks/inbox"
  }
}
```

Your webhook endpoint will receive a POST with an HMAC-SHA256 signature. See [Callbacks](/protocol/callbacks/) for verification examples in multiple languages.

## Building a client library

If you're building a reusable client, the pattern is:

1. Accept a base URL and auth token
2. Fetch and cache `/.well-known/agent.json`
3. Expose methods for each discovered action
4. Handle send, poll, and callback registration

The discovery document is designed to be cacheable (`Cache-Control: public, max-age=300`), so you only need to fetch it once per session.
