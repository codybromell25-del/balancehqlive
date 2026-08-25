# Deploying to Vercel

The app must be publicly reachable before Momence can be connected: webhooks
need a delivery URL, and the OAuth client needs a redirect URI. Neither can
point at localhost.

## 1. Deploy

From the project root:

```bash
npx vercel
```

Log in when prompted, then accept the defaults — Vercel detects Next.js on its
own. It prints a preview URL when it finishes.

To promote it to the production URL (the stable one to register with Momence):

```bash
npx vercel --prod
```

Alternatively, push the repo to GitHub and import it at vercel.com/new. Same
result; use whichever you'll maintain.

## 2. Environment variables

Vercel needs every value from `.env.local`. In the dashboard:

**Project → Settings → Environment Variables → paste a `.env` block**, then
paste the contents of your local `.env.local` file. Set them for **Production**
(and Preview, if you want preview deploys to work).

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design — ships to browsers |
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses RLS.** Server-only, never `NEXT_PUBLIC_` |
| `MOMENCE_API_BASE` | `https://api.momence.com` |
| `CREDENTIAL_ENCRYPTION_KEY` | Must match the key used at onboarding, or stored credentials cannot be decrypted |
| `CRON_SECRET` | Vercel sends this as a bearer token to cron routes |
| `WEBHOOK_VERIFICATION_STRICT` | Keep `true` |
| `APP_URL` | **Change this** to the deployed URL, e.g. `https://your-app.vercel.app` |

`APP_URL` is the one value that differs from local. It builds the OAuth
redirect URI, so if it is wrong the token exchange fails — Momence checks that
the redirect URI on the exchange matches the one on the authorize call.

Redeploy after changing environment variables; Vercel does not apply them to an
existing build.

## 3. Register the redirect URI with Momence

Apps & Integrations → Developer API → OAuth Clients → **Add new client**.

Redirect URI must be exactly:

```
https://YOUR-APP.vercel.app/api/momence/callback
```

The redirect URI cannot be edited after the client is created, so get this
right the first time. Copy the client secret immediately — it is shown once.

Then re-onboard the studio against the new client:

```bash
npx tsx --env-file=.env.local scripts/add-studio.ts \
  --name "balance" --slug balance --host-id 62930 \
  --client-id <NEW_ID> --client-secret <NEW_SECRET> \
  --redirect-uri https://YOUR-APP.vercel.app/api/momence/callback \
  --timezone Europe/Dublin --currency EUR
```

## 4. Connect the studio

Start the authorization flow and open the URL it returns in a browser:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR-APP.vercel.app/api/momence/authorize?studio=balance"
```

Sign in as the studio owner, complete 2FA, and you will be redirected back with
the tokens stored. From then on the platform renews itself using the refresh
token and no human is needed again.

## 5. Register the webhook

Apps & Integrations → Developer API → Outgoing Webhooks → Add new webhook.

```
https://YOUR-APP.vercel.app/api/webhooks/momence?studio=balance
```

Subscribe to all 19 events listed by `add-studio.ts`. Copy the generated
webhook secret and store it:

```bash
npx tsx --env-file=.env.local scripts/add-studio.ts \
  --name "balance" --slug balance --host-id 62930 \
  --client-id <ID> --client-secret <SECRET> \
  --webhook-secret <WEBHOOK_SECRET> \
  --redirect-uri https://YOUR-APP.vercel.app/api/momence/callback \
  --timezone Europe/Dublin --currency EUR
```

Webhooks only deliver events from the moment they are registered. Nothing
historical arrives, so register early — every day of delay is a day of history
that has to be backfilled from reports instead.

## A note on the cron schedule

`vercel.json` registers two crons:

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/schedule-reports` | hourly | Requests the scheduled reports |
| `/api/cron/reconcile-reports` | every 15 min | Replays failed projections, collects stranded report runs |

**Vercel's Hobby plan allows one cron invocation per day.** Both schedules above
need Pro. Hobby is still fine to start: webhooks carry bookings, attendance,
memberships and revenue in near real time, and only the scheduled reports
degrade. Reconciliation can also be triggered manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://YOUR-APP.vercel.app/api/cron/reconcile-reports
```

## Verifying the deployment

```bash
# should redirect to /login
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP.vercel.app/dashboard

# should be 401 without the secret
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-APP.vercel.app/api/cron/reconcile-reports

# should be 400 (missing studio), proving the route is live
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://YOUR-APP.vercel.app/api/webhooks/momence
```
