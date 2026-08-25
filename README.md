# Momence reporting platform

Automated KPI reporting for studios running on Momence. Multi-tenant from the
first commit, so the same codebase serves balance's locations today and paying
studios later without a rewrite.

## Why this isn't an hourly poller

The obvious build is a cron that pulls five reports every hour. It doesn't
work: Momence caps report generation at **100 requests per day**. Five reports
hourly is 120 — you'd exhaust the quota before lunch, with nothing left for
retries or backfills.

Webhooks solve it, and give you better than hourly freshness as a side effect:

| Data | Source | Lag |
| --- | --- | --- |
| Bookings, cancellations, check-ins, no-shows | `session-*` webhooks | seconds |
| Class capacity and fill rate | `session-created` carries capacity | seconds |
| New members | `member-assigned` | seconds |
| Membership churn, freezes, failed renewals | `bought-membership-*` webhooks | seconds |
| Revenue | `payment-transaction-*` webhooks | seconds |
| Sales reconciliation | scheduled report, 4×/day | ~6 hours |
| Intro-offer conversion | **no API report exists** — CSV export only | manual |

That schedule spends 4 of the 100 daily runs per studio.

The report layer is far thinner than it looks, because `POST
/api/v2/host/reports` accepts exactly two report types — `total-sales` and
`franchise-gift-card-reconciliation`. Everything else was verified rejected
against the live API. Cohort retention, intro-offer conversion, new visitors
and membership stats all exist as report types inside Momence, but are not
reachable through the public API.

That matters less than it sounds, because the webhook stream already carries
occupancy, attendance, churn and revenue. The single genuine gap is
**intro-offer conversion**, which has no webhook equivalent and no API report.
For now that number comes from a CSV export.

## Architecture

```
Momence ──webhook──▶ /api/webhooks/momence ──▶ webhook_events (raw, append-only)
                                                     │
                                                     ▼
                                              projectors ──▶ sessions, bookings,
                                                             members, memberships,
                                                             payments
                                                     │
Vercel cron ──▶ /api/cron/schedule-reports ──▶ report_runs ──▶ report_rows
             ──▶ /api/cron/reconcile-reports  (replay + stranded run collection)
                                                     │
                                                     ▼
                                              kpi_* views ──▶ dashboard
```

`webhook_events` is append-only and every projector is idempotent, so a
projector bug is a replay rather than lost data. That property is worth
protecting as the schema grows.

## Setup

1. **Create the database.** Run both migrations in
   `supabase/migrations/` against a fresh Supabase project.

2. **Set environment variables.** Copy `.env.example` to `.env.local` and fill
   it in. Generate the two secrets:

   ```bash
   openssl rand -base64 32   # CREDENTIAL_ENCRYPTION_KEY
   openssl rand -hex 32      # CRON_SECRET
   ```

3. **Onboard a studio.**

   ```bash
   npx tsx scripts/add-studio.ts \
     --name "balance" --slug balance --host-id <HOST_ID> \
     --client-id <ID> --client-secret <SECRET> \
     --username <STAFF_EMAIL> --password <STAFF_PASSWORD> \
     --webhook-secret <WEBHOOK_SECRET> \
     --timezone Europe/Dublin --currency EUR
   ```

   The script prints the webhook URL and the event list to register in the
   studio's Momence dashboard under **Apps & Integrations → Developer API**.

4. **Deploy.** `vercel.json` registers both crons. Vercel sends `CRON_SECRET`
   as a bearer token; both routes reject anything else.

5. **Backfill.** Webhooks only cover events from the moment they're
   registered. For history, call `requestReport()` directly with a wide date
   range — mind the daily budget, and prefer doing it on a day when the
   scheduled runs are light.

## Two things to confirm with Momence before going live

**Is the 100/day report limit per API client or per host?** Each studio
creates its own client in its own dashboard, which suggests per-studio. If
it's per-client and you're funnelling many studios through one, the schedule
above needs rethinking. Ask support directly.

**What exactly is the webhook signature scheme?** The docs say to verify the
payload against `x-webhook-signature` but don't publish the construction.
`lib/crypto.ts` implements HMAC-SHA256 over the raw payload string, accepting
hex or base64, compared in constant time. Verify this against a real delivery.
`WEBHOOK_VERIFICATION_STRICT=true` rejects anything that fails — keep it that
way, because the alternative is accepting writes from anyone who guesses a
studio slug.

## Where this goes next

The scaffold covers ingestion, storage and a baseline overview. Still to build:

- **Per-location slicing.** The data model supports it; the dashboard shows
  studio-wide totals only.
- **Report row shaping.** Report data lands in `report_rows` as JSONB. Each
  report type needs a view that shapes it into columns — start with
  intro-offer conversions, since that's the number with no webhook equivalent.
- **Weekly email digest.** Same KPIs, pushed rather than pulled. For most
  studio owners this is the actual product.
- **Alerting.** `kpi_data_freshness` already exposes stalled streams and
  budget pressure; nothing acts on it yet.
