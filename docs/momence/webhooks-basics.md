---
updatedAt: 2026-03-06T14:05:13.000Z
---

Fetch the complete documentation index at: https://api.docs.momence.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Webhooks Basics

<Callout icon="🚧" theme="warn">
  Webhooks are an experimental feature that's not enabled by default, please ask support to enable it for you if you don't see it in your Dashboard
</Callout>

To start receiving events through webooks, you first have to define a webhook endpoint in your dashboard.

## Adding new webhook through dashboard

1. Go to Webhooks Configuration in your Dashboard: <Anchor label="https://momence.com/dashboard/profile?host-redirect=public-api-outgoing-webhooks" target="_blank" href="https://momence.com/dashboard/profile?host-redirect=public-api-outgoing-webhooks"><https://momence.com/dashboard/profile?host-redirect=public-api-outgoing-webhooks></Anchor>

   <Image align="center" src="https://files.readme.io/ae079797203900525940c071159342d1fe84effe6963d57671de67c01f5060bf-Screenshot_2026-01-15_120734.png" />
2. Click on Add new Webhook button and fill out your webhook processing URL
3. **Make sure to save the secret values somewhere since you won't be able to access them again**

   <Image align="center" src="https://files.readme.io/3f66ee31349f8f76675e4f2ea8746170d9e6a1767c27ebd209853aa993aad3f7-Screenshot_2026-01-15_120754.png" />

## Webhook request format

Webhook will be called with POST request with JSON body for every event.

Body will be a JSON with single `payload` property which is just a JSON string. It's delivered in this format to make signature validation easier.

```json
{
  "payload": "{\"event\": \"session.booked\"..."
}
```

The JSON inside `payload` has following format:

```json
{
  "timestamp": "2025-10-03T10:11:00.462Z",
  "event": "session.booked",
  "payload": {
    "sessionId": 1,
    "sessionBookingId": 1
  }
}
```

* `timestamp` is a date when the event occurred in ISO 8601 format.
* `event` is event type identifier
* `payload` is the event contents, the exact shape depends on the event type

The webhook will include following headers:

* `x-webhook-secret` - secret visible in your dashboard, you should use verify that it matches your value when receiving the data
* `x-webhook-signature` - HMAC-SHA256 checksum of the `payload` string, you should validate that it matches the data
* `x-webhook-reqeuest-id` - ID unique to every event, will be the same when retrying the request, you can use it to detect duplicate requests