---
title: Callbacks
description: HMAC-signed callback delivery for async responses.
---

## How callbacks work

If the agent provides a `callback_url` when sending a message, responses are automatically delivered via POST with HMAC-SHA256 signing.

```
Agent sends message with callback_url
  -> Website owner responds
    -> agent.json POSTs to callback_url with signed payload
```

## Callback payload

```json
{
  "message_id": "msg_001",
  "response_id": "resp_002",
  "body": "Refund approved and processed.",
  "structured_data": {
    "refund_id": "REF-456",
    "amount": 49.99,
    "status": "completed"
  },
  "responded_by": "support-team",
  "responded_at": "2025-01-15T11:00:00.000Z"
}
```

## Signature headers

| Header                      | Description                                        |
|-----------------------------|----------------------------------------------------|
| `X-AgentInbox-Signature`    | HMAC-SHA256 hex digest of `{timestamp}.{body}`     |
| `X-AgentInbox-Timestamp`    | Unix timestamp of signature creation               |

The signing key is the inbox's auth token.

## Verifying signatures

### Node.js

```javascript
const crypto = require('crypto');

function verifySignature(body, signature, timestamp, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

// Usage in an Express handler:
app.post('/webhooks/inbox', (req, res) => {
  const signature = req.headers['x-agentinbox-signature'];
  const timestamp = req.headers['x-agentinbox-timestamp'];
  const body = JSON.stringify(req.body);

  if (!verifySignature(body, signature, timestamp, process.env.INBOX_TOKEN)) {
    return res.status(401).send('Invalid signature');
  }

  // Process the response...
  const { message_id, structured_data } = req.body;
  console.log(`Response for ${message_id}:`, structured_data);
  res.status(200).send('OK');
});
```

### Python

```python
import hmac
import hashlib

def verify_signature(body: str, signature: str, timestamp: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        f"{timestamp}.{body}".encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

## Retry behavior

If callback delivery fails (non-2xx response or network error):

1. The response is marked as `"failed"`
2. A Durable Object alarm is scheduled for 5 minutes later
3. The callback is retried once
4. If the retry succeeds, the response is marked as `"delivered"`

Agents should implement idempotency on their callback endpoints using the `response_id` field.
