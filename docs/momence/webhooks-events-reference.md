---
updatedAt: 2026-08-06T13:22:30.000Z
---

Fetch the complete documentation index at: https://api.docs.momence.com/llms.txt. Use this file to discover all available pages before exploring further. Append .md to any documentation page URL to get its markdown version.

# Webhooks Events Reference

# Overview

The webhook request has following structure:

```json
{
  "payload": "JSON ENCODED PAYLOAD",
}
```

You should first validate that the payload value signature matches the value provided in the `x-webhook-signature` header.

The encoded payload body has always this basic structure, with the `payload` field varying depending on the webhook event:

```json
{
  "timestamp": "2024-01-01T20:00:00.000Z",
  "event": "event.name.here",
  "payload": { /* event-specific payload */ },
}
```

# Events reference

### `session-booked`

Triggered when any host session is booked by any way, including automatic or child bookings.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "integer",
      "description": "The ID of the booked session"
    },
    "sessionBookingId": {
      "type": "integer",
      "description": "The ID of the created session booking"
    },
    "payingMemberId": {
      "type": "integer",
      "description": "The ID of the member who paid for the session"
    },
    "targetMemberId": {
      "type": "integer",
      "description": "The ID of the member for whom the session was booked"
    }
  },
  "required": [
    "sessionId",
    "sessionBookingId",
    "payingMemberId",
    "targetMemberId"
  ]
}

```

### `session-booking-cancelled`

Triggered when a session booking is cancelled by either the member or the host.

```json
{
  "type": "object",
  "properties": {
    "sessionBookingId": {
      "type": "integer",
      "description": "The ID of the cancelled session booking"
    },
    "sessionId": {
      "type": "integer",
      "description": "The ID of the session"
    },
    "payingMemberId": {
      "type": "integer",
      "description": "The ID of the member who paid for the session"
    },
    "targetMemberId": {
      "type": "integer",
      "description": "The ID of the member for whom the session was booked"
    },
    "isLateCancellation": {
      "type": "boolean",
      "description": "Whether this was a late cancellation"
    },
    "cancelledAt": {
      "type": "string",
      "description": "The timestamp when the booking was cancelled"
    }
  },
  "required": [
    "sessionBookingId",
    "sessionId",
    "payingMemberId",
    "targetMemberId",
    "isLateCancellation",
    "cancelledAt"
  ]
}

```

### `member-assigned`

Triggered when a new member is assigned to a host.

```json
{
  "type": "object",
  "properties": {
    "memberId": {
      "type": "integer"
    },
    "email": {
      "type": "string"
    },
    "firstName": {
      "type": "string"
    },
    "lastName": {
      "type": "string"
    }
  },
  "required": [
    "memberId",
    "email",
    "firstName",
    "lastName"
  ]
}

```

### `member-updated`

Triggered when member attributes change.

```json
{
  "type": "object",
  "properties": {
    "memberId": {
      "type": "integer"
    },
    "email": {
      "type": "string"
    },
    "firstName": {
      "type": "string"
    },
    "lastName": {
      "type": "string"
    }
  },
  "required": [
    "memberId",
    "email",
    "firstName",
    "lastName"
  ]
}

```

### `member-address-created`

Triggered when a member address is created.

```json
{
  "type": "object",
  "properties": {
    "memberAddressId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "address": {
      "type": "string"
    },
    "zipcode": {
      "type": "string"
    },
    "city": {
      "type": "string"
    },
    "country": {
      "type": "string"
    }
  },
  "required": [
    "memberAddressId",
    "memberId",
    "address",
    "zipcode",
    "city",
    "country"
  ]
}

```

### `member-address-updated`

Triggered when a member address is updated.

```json
{
  "type": "object",
  "properties": {
    "memberAddressId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "address": {
      "type": "string"
    },
    "zipcode": {
      "type": "string"
    },
    "city": {
      "type": "string"
    },
    "country": {
      "type": "string"
    }
  },
  "required": [
    "memberAddressId",
    "memberId",
    "address",
    "zipcode",
    "city",
    "country"
  ]
}

```

### `member-address-deleted`

Triggered when a member address is deleted.

```json
{
  "type": "object",
  "properties": {
    "memberAddressId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    }
  },
  "required": [
    "memberAddressId",
    "memberId"
  ]
}

```

### `session-created`

Triggered when any host session is created, including automatic or child sessions.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "integer",
      "description": "The ID of the created session"
    },
    "type": {
      "type": "string",
      "enum": [
        "private",
        "special-event",
        "special-event-new",
        "retreat",
        "fitness",
        "course",
        "course-class",
        "semester",
        "recital"
      ],
      "x-enumNames": [
        "PRIVATE",
        "SPECIAL_EVENT",
        "SPECIAL_EVENT_NEW",
        "RETREAT",
        "FITNESS",
        "COURSE",
        "COURSE_CLASS",
        "SEMESTER",
        "RECITAL"
      ]
    },
    "roomId": {
      "type": "integer",
      "nullable": true
    },
    "teacherId": {
      "type": "integer",
      "nullable": true
    },
    "payrateId": {
      "type": "integer",
      "nullable": true
    },
    "locationId": {
      "type": "integer",
      "nullable": true
    },
    "sessionTemplateId": {
      "type": "integer",
      "nullable": true,
      "description": "The ID of the session template from which the session was created, "
    },
    "sessionSemesterOccurrenceId": {
      "type": "integer",
      "nullable": true,
      "description": "The ID of the session semester occurrence, if this value is set it means that the session is part of a semester"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "startsAt": {
      "type": "string"
    },
    "endsAt": {
      "type": "string"
    },
    "capacity": {
      "type": "number",
      "nullable": true
    },
    "durationMinutes": {
      "type": "number",
      "nullable": true
    },
    "description": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "sessionId",
    "type",
    "roomId",
    "teacherId",
    "payrateId",
    "locationId",
    "sessionTemplateId",
    "sessionSemesterOccurrenceId",
    "name",
    "startsAt",
    "endsAt",
    "capacity",
    "durationMinutes",
    "description"
  ]
}

```

### `session-updated`

Triggered when any host session is updated.

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "integer",
      "description": "The ID of the updated session"
    },
    "type": {
      "type": "string",
      "enum": [
        "private",
        "special-event",
        "special-event-new",
        "retreat",
        "fitness",
        "course",
        "course-class",
        "semester",
        "recital"
      ],
      "x-enumNames": [
        "PRIVATE",
        "SPECIAL_EVENT",
        "SPECIAL_EVENT_NEW",
        "RETREAT",
        "FITNESS",
        "COURSE",
        "COURSE_CLASS",
        "SEMESTER",
        "RECITAL"
      ]
    },
    "roomId": {
      "type": "integer",
      "nullable": true
    },
    "teacherId": {
      "type": "integer",
      "nullable": true
    },
    "payrateId": {
      "type": "integer",
      "nullable": true
    },
    "locationId": {
      "type": "integer",
      "nullable": true
    },
    "sessionTemplateId": {
      "type": "integer",
      "nullable": true,
      "description": "The ID of the session template from which the session was created, "
    },
    "sessionSemesterOccurrenceId": {
      "type": "integer",
      "nullable": true,
      "description": "The ID of the session semester occurrence, if this value is set it means that the session is part of a semester"
    },
    "name": {
      "type": "string",
      "nullable": true
    },
    "startsAt": {
      "type": "string"
    },
    "endsAt": {
      "type": "string"
    },
    "capacity": {
      "type": "number",
      "nullable": true
    },
    "durationMinutes": {
      "type": "number",
      "nullable": true
    },
    "description": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "sessionId",
    "type",
    "roomId",
    "teacherId",
    "payrateId",
    "locationId",
    "sessionTemplateId",
    "sessionSemesterOccurrenceId",
    "name",
    "startsAt",
    "endsAt",
    "capacity",
    "durationMinutes",
    "description"
  ]
}

```

### `host-report-run-completed`

Triggered when a host report run is completed.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "integer"
    },
    "reportUrlWeb": {
      "type": "string"
    },
    "reportUrlApi": {
      "type": "string"
    }
  },
  "required": [
    "id",
    "reportUrlWeb",
    "reportUrlApi"
  ]
}

```

### `session-booking-checked-in`

Triggered when a member is checked in to a session booking.

```json
{
  "type": "object",
  "properties": {
    "sessionBookingId": {
      "type": "integer",
      "description": "The ID of the session booking that was checked in"
    },
    "sessionId": {
      "type": "integer",
      "description": "The ID of the session"
    },
    "memberId": {
      "type": "integer",
      "description": "The ID of the member who was checked in"
    },
    "checkedInAt": {
      "type": "string",
      "description": "The ISO 8601 timestamp when the member was checked in"
    }
  },
  "required": [
    "sessionBookingId",
    "sessionId",
    "memberId",
    "checkedInAt"
  ]
}

```

### `session-booking-no-show`

Triggered when a member does not check in to a session they booked. Fires approximately 2 hours after the session ends.

```json
{
  "type": "object",
  "properties": {
    "sessionBookingId": {
      "type": "integer",
      "description": "The ID of the session booking marked as no-show"
    },
    "sessionId": {
      "type": "integer",
      "description": "The ID of the session"
    },
    "memberId": {
      "type": "integer",
      "description": "The ID of the member who did not show up"
    }
  },
  "required": [
    "sessionBookingId",
    "sessionId",
    "memberId"
  ]
}

```

### `bought-membership-activated`

Triggered when a membership is activated.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate"
  ]
}

```

### `bought-membership-cancelled-after-failed-renewal`

Triggered when a membership is cancelled after failed retries.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate"
  ]
}

```

### `bought-membership-frozen`

Triggered when a membership is frozen.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    },
    "freezeAt": {
      "type": "string"
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate",
    "freezeAt"
  ]
}

```

### `bought-membership-renewal-cancelled`

Triggered when a membership renewal is cancelled.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate"
  ]
}

```

### `bought-membership-renewal-failed`

Triggered when a membership renewal has failed.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate"
  ]
}

```

### `bought-membership-renewal-uncancelled`

Triggered when a membership is no longer cancelled.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate"
  ]
}

```

### `bought-membership-unfrozen`

Triggered when a membership is unfrozen.

```json
{
  "type": "object",
  "properties": {
    "hostId": {
      "type": "integer"
    },
    "boughtMembershipId": {
      "type": "integer"
    },
    "membershipId": {
      "type": "integer"
    },
    "memberId": {
      "type": "integer"
    },
    "subscriptionSeriesId": {
      "type": "integer",
      "nullable": true
    },
    "seriesIndex": {
      "type": "integer",
      "nullable": true
    },
    "type": {
      "type": "string",
      "enum": [
        "subscription",
        "on-demand-subscription",
        "package-events",
        "package-money",
        "patron"
      ],
      "x-enumNames": [
        "Subscription",
        "OnDemandSubscription",
        "PackageEvents",
        "PackageMoney",
        "Patron"
      ]
    },
    "startDate": {
      "type": "string",
      "nullable": true
    },
    "endDate": {
      "type": "string",
      "nullable": true
    },
    "unfreezeAt": {
      "type": "string"
    }
  },
  "required": [
    "hostId",
    "boughtMembershipId",
    "membershipId",
    "memberId",
    "subscriptionSeriesId",
    "seriesIndex",
    "type",
    "startDate",
    "endDate",
    "unfreezeAt"
  ]
}

```

### `payment-transaction-succeeded`

Triggered when payment transaction succeeds.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "integer"
    }
  },
  "required": [
    "id"
  ]
}

```

### `payment-transaction-pending`

Triggered when payment transaction is pending.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "integer"
    }
  },
  "required": [
    "id"
  ]
}

```

### `payment-transaction-failed`

Triggered when payment transaction fails.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "integer"
    }
  },
  "required": [
    "id"
  ]
}

```