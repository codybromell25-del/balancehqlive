/**
 * Does the API accept the report types the scheduler depends on?
 *
 * The OpenAPI schema's oneOf only admits total-sales and
 * franchise-gift-card-reconciliation, but its internal enum names 80+ types.
 * One live request each settles which reading is right. Costs one report slot
 * per type, out of 100 per day.
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

const TYPES = [
  "total-sales",
  "intro-offers-conversions",
  "retention",
  "membership-cancellations",
  "new-visitors",
  "session-occupancy",
  "membership-stats",
];

async function main() {
  const db = serviceClient();
  const { data: studio } = await db
    .from("studios").select("id").eq("slug", "balance").single();

  const client = await MomenceClient.forStudio(studio!.id);
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);

  for (const reportType of TYPES) {
    try {
      const res = await client.request<{ id: number }>("/api/v2/host/reports", {
        method: "POST",
        body: JSON.stringify({
          parameters: {
            reportType,
            hostId: client.hostId,
            dateRange: { from: from.toISOString(), to: to.toISOString() },
          },
        }),
      });
      console.log(`  ACCEPTED  ${reportType.padEnd(26)} run ${res.id}`);
    } catch (err: any) {
      const body = String(err?.body ?? err?.message ?? err).slice(0, 110);
      console.log(`  REJECTED  ${reportType.padEnd(26)} ${body}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
