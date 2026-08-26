/**
 * Backfill revenue from the total-sales report.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-sales.ts --slug balance --months 12
 *
 * The payment webhook carries only a transaction id, and the transaction
 * record has no location, so neither can reconstruct revenue history. The
 * total-sales report has the amount, the item, the category and the location.
 *
 * Requested a month at a time: one report per month keeps each run small
 * enough to finish quickly, and costs 12 of the 100 daily report generations.
 * Retrieval is a separate, far higher limit (1000/day).
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SaleRow {
  saleItemId: number;
  paymentTransactionId?: number;
  memberId?: number;
  payingMemberId?: number;
  customerName?: string;
  customerEmail?: string;
  paymentDate: string;
  serviceDate?: string;
  paymentValue?: number;
  paymentVat?: number;
  paidInMoneyCredits?: number;
  refunded?: number;
  paymentItem?: string;
  paymentCategory?: string;
  membershipType?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  currency?: string;
  transactionItems?: { homeLocation?: string }[];
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(`--${flag}`);
  return (i > -1 ? process.argv[i + 1] : undefined) ?? fallback;
}

async function main() {
  const slug = arg("slug", "balance");
  const months = Number(arg("months", "12"));

  const db = serviceClient();
  const { data: studio, error } = await db
    .from("studios").select("id, name").eq("slug", slug).single();
  if (error || !studio) throw new Error(`Studio ${slug} not found`);

  const client = await MomenceClient.forStudio(studio.id);
  let stored = 0;

  for (let m = months - 1; m >= 0; m--) {
    const end = new Date();
    end.setUTCMonth(end.getUTCMonth() - m + 1, 1);
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);

    const label = start.toISOString().slice(0, 7);
    process.stdout.write(`  ${label}: requesting…`);

    const run = await client.request<{ id: number }>("/api/v2/host/reports", {
      method: "POST",
      body: JSON.stringify({
        parameters: {
          reportType: "total-sales",
          hostId: client.hostId,
          dateRange: { from: start.toISOString(), to: end.toISOString() },
          includeRefunds: true,
        },
      }),
    });

    let items: SaleRow[] | null = null;
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const res = await client.request<{ status: string; data?: { items?: SaleRow[] } }>(
        `/api/v2/host/reports/${run.id}`,
      );
      if (res.status === "completed") { items = res.data?.items ?? []; break; }
      if (res.status === "failed") break;
      process.stdout.write(".");
    }

    if (items === null) {
      console.log(` timed out (run ${run.id}) — re-run to retry this month`);
      continue;
    }

    const rows = items
      .filter((r) => r.saleItemId && r.paymentDate)
      .map((r) => ({
        studio_id: studio.id,
        sale_item_id: r.saleItemId,
        payment_transaction_id: r.paymentTransactionId ?? null,
        member_id: r.memberId ?? null,
        paying_member_id: r.payingMemberId ?? null,
        customer_name: r.customerName ?? null,
        customer_email: r.customerEmail ?? null,
        payment_date: r.paymentDate,
        service_date: r.serviceDate ?? null,
        payment_value: r.paymentValue ?? null,
        payment_vat: r.paymentVat ?? null,
        paid_in_money_credits: r.paidInMoneyCredits ?? null,
        refunded: r.refunded ?? null,
        payment_item: r.paymentItem ?? null,
        payment_category: r.paymentCategory ?? null,
        membership_type: r.membershipType ?? null,
        payment_method: r.paymentMethod ?? null,
        payment_status: r.paymentStatus ?? null,
        // Location lives on the transaction item, not the sale.
        location_name: r.transactionItems?.[0]?.homeLocation ?? null,
        currency: r.currency ?? null,
        raw: r,
        updated_at: new Date().toISOString(),
      }));

    // Each row carries the full report payload in `raw`, so batches are large
    // in bytes even when small in rows. 500 was enough to break the connection
    // mid-write; 150 is comfortably under it.
    for (let i = 0; i < rows.length; i += 150) {
      const { error: e } = await db
        .from("sales")
        .upsert(rows.slice(i, i + 150), { onConflict: "studio_id,sale_item_id" });
      if (e) throw e;
    }

    stored += rows.length;
    console.log(` ${rows.length} sales`);
  }

  console.log(`\nDone. ${stored} sales stored.`);
}

main().catch((e) => { console.error("\n", e); process.exit(1); });
