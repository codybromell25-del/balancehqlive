/**
 * Onboard a studio.
 *
 *   npx tsx scripts/add-studio.ts \
 *     --name "balance Clane" \
 *     --slug balance \
 *     --host-id 745 \
 *     --client-id xxx --client-secret yyy \
 *     --username reports@balance.ie --password zzz \
 *     --webhook-secret www \
 *     --timezone Europe/Dublin --currency EUR
 *
 * Credentials are encrypted before they touch the database. Run this from a
 * trusted machine, and clear your shell history afterwards — these are staff
 * logins with full access to the studio's Momence account.
 */

import { serviceClient } from "../lib/db";
import { encrypt } from "../lib/crypto";

function arg(flag: string, required = true): string {
  const i = process.argv.indexOf(`--${flag}`);
  const value = i > -1 ? process.argv[i + 1] : undefined;
  if (!value && required) {
    console.error(`Missing required argument: --${flag}`);
    process.exit(1);
  }
  return value ?? "";
}

async function main() {
  const db = serviceClient();

  const slug = arg("slug");
  const hostId = Number(arg("host-id"));

  const { data: studio, error } = await db
    .from("studios")
    .upsert(
      {
        name: arg("name"),
        slug,
        momence_host_id: hostId,
        timezone: arg("timezone", false) || "Europe/Dublin",
        currency: arg("currency", false) || "EUR",
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (error) throw error;

  const webhookSecret = arg("webhook-secret", false);

  // Staff credentials are optional. Momence enforces 2FA on host accounts,
  // which the password grant cannot satisfy, so the normal path is the
  // authorization code flow — see /api/momence/authorize.
  const staffUser = arg("username", false);
  const staffPass = arg("password", false);

  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const redirectUri = arg("redirect-uri", false) || `${base}/api/momence/callback`;

  const { error: credError } = await db.from("studio_credentials").upsert({
    studio_id: studio.id,
    client_id: arg("client-id"),
    client_secret_enc: encrypt(arg("client-secret")),
    staff_username: staffUser || null,
    staff_password_enc: staffPass ? encrypt(staffPass) : null,
    webhook_secret_enc: webhookSecret ? encrypt(webhookSecret) : null,
    redirect_uri: redirectUri,
    updated_at: new Date().toISOString(),
  });

  if (credError) throw credError;

  console.log(`\nAdded ${slug} (studio ${studio.id}, Momence host ${hostId}).\n`);
  console.log("Register this redirect URI on the Momence OAuth client");
  console.log("(Apps & Integrations \u2192 Developer API \u2192 OAuth Clients):\n");
  console.log(`  ${redirectUri}\n`);
  if (!staffUser) {
    console.log("Then connect the studio by opening the authorization flow:\n");
    console.log(`  curl -H "Authorization: Bearer $CRON_SECRET" \\`);
    console.log(`    "${base}/api/momence/authorize?studio=${slug}"\n`);
  }
  console.log("Next: register this webhook URL in the studio's Momence dashboard");
  console.log("under Apps & Integrations → Developer API:\n");
  console.log(`  ${base}/api/webhooks/momence?studio=${slug}\n`);
  console.log("Subscribe to these events:\n");
  for (const e of [
    "session-created",
    "session-updated",
    "session-booked",
    "session-booking-cancelled",
    "session-booking-checked-in",
    "session-booking-no-show",
    "member-assigned",
    "member-updated",
    "bought-membership-activated",
    "bought-membership-frozen",
    "bought-membership-unfrozen",
    "bought-membership-renewal-cancelled",
    "bought-membership-renewal-uncancelled",
    "bought-membership-renewal-failed",
    "bought-membership-cancelled-after-failed-renewal",
    "payment-transaction-succeeded",
    "payment-transaction-pending",
    "payment-transaction-failed",
    "host-report-run-completed",
  ]) {
    console.log(`  - ${e}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
