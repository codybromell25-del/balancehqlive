/**
 * Preflight check.
 *
 *   npx tsx scripts/check-connection.ts --slug balance
 *
 * Run this before deploying. It proves the credentials work, the encryption
 * key round-trips, and Momence answers — all failures that are much cheaper to
 * find locally than in a Vercel function log at 3am.
 *
 * It costs one report generation from the daily budget of 100.
 */

import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";
import { requestReport, REPORT_TYPES } from "../lib/momence/reports";

const slug = (() => {
  const i = process.argv.indexOf("--slug");
  if (i === -1) {
    console.error("Usage: npx tsx scripts/check-connection.ts --slug <studio-slug>");
    process.exit(1);
  }
  return process.argv[i + 1];
})();

function pass(msg: string) {
  console.log(`  ok    ${msg}`);
}
function fail(msg: string, err?: unknown): never {
  console.error(`  FAIL  ${msg}`);
  if (err) console.error(`\n${err}\n`);
  process.exit(1);
}

async function main() {
  console.log(`\nChecking ${slug}\n`);

  // 1. Environment
  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CREDENTIAL_ENCRYPTION_KEY",
  ]) {
    if (!process.env[key]) fail(`${key} is not set`);
  }
  if (Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY!, "base64").length !== 32) {
    fail("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  pass("environment variables present");

  // 2. Database reachable and migrated
  const db = serviceClient();
  const { data: studio, error } = await db
    .from("studios")
    .select("id, name, momence_host_id, timezone")
    .eq("slug", slug)
    .maybeSingle();

  if (error) fail("could not query the database — are the migrations applied?", error);
  if (!studio) fail(`no studio with slug "${slug}" — run scripts/add-studio.ts first`);
  pass(`studio found: ${studio.name} (Momence host ${studio.momence_host_id})`);

  // 3. Credentials decrypt and Momence authenticates
  let client: MomenceClient;
  try {
    client = await MomenceClient.forStudio(studio.id);
  } catch (err) {
    fail(
      "authentication failed — check the client id/secret, the staff login, " +
        "and that CREDENTIAL_ENCRYPTION_KEY matches the one used at onboarding",
      err,
    );
  }
  pass("authenticated with Momence");

  // 4. A real read
  try {
    const profile = await client.request<Record<string, unknown>>("/api/v2/auth/profile");
    pass(`staff account active: ${profile.email ?? profile.name ?? "(no name returned)"}`);
  } catch (err) {
    fail("could not read the logged-in user profile", err);
  }

  // 5. Report generation, the permission most likely to be missing
  try {
    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const { momenceRunId } = await requestReport(studio.id, {
      reportType: REPORT_TYPES.TOTAL_SALES,
      from,
      to,
    });
    pass(`report generation accepted (Momence run ${momenceRunId})`);
  } catch (err) {
    fail(
      "report generation was rejected — the staff account may lack reporting " +
        "permission, or today's budget of 100 runs is already spent",
      err,
    );
  }

  // 6. Budget state
  const { data: budget } = await db
    .from("report_budget")
    .select("runs_used")
    .eq("studio_id", studio.id)
    .eq("budget_date", new Date().toISOString().slice(0, 10))
    .maybeSingle();

  console.log(`\n  ${budget?.runs_used ?? 0}/100 report runs used today.`);
  console.log("\nAll checks passed. Safe to deploy.\n");
  console.log("After deploying, register the webhook URL in Momence and confirm");
  console.log("events are arriving:  select count(*) from webhook_events;\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
