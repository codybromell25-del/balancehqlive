import { serviceClient } from "@/lib/db";
import { MomenceClient } from "./client";

/**
 * Report generation is capped at 100 requests per day. Every run therefore
 * has to earn its slot: claim_report_slot() increments a ledger row inside
 * the transaction and refuses once the budget is spent, so a runaway cron
 * cannot quietly exhaust a studio's quota at 3am.
 */

/**
 * The only report types POST /api/v2/host/reports accepts.
 *
 * Verified live on 2026-08-25 — every other type is rejected with
 * "parameters must be a one of total-sales,
 * franchise-gift-card-reconciliation". Do not add speculative entries here:
 * a rejected request still costs a slot from the 100/day budget.
 */
export const REPORT_TYPES = {
  TOTAL_SALES: "total-sales",
  FRANCHISE_GIFT_CARD_RECONCILIATION: "franchise-gift-card-reconciliation",
} as const;

export type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

export interface ReportParams {
  reportType: ReportType;
  from: Date;
  to: Date;
  locationId?: number;
  includeRefunds?: boolean;
  saleTypes?: string[];
}

/** Documented response shape of GET /api/v2/host/reports/{reportRunId}. */
interface ReportRunResponse {
  id: number;
  status: "running" | "completed" | "failed";
  parameters?: Record<string, unknown>;
  data?: { reportType?: string; items?: Record<string, unknown>[] } | null;
}

export class ReportNotReadyError extends Error {
  constructor(runId: string, readonly reportStatus: string) {
    super(`Report run ${runId} is not ready yet (status: ${reportStatus})`);
    this.name = "ReportNotReadyError";
  }
}

export class BudgetExhaustedError extends Error {
  constructor(studioId: string) {
    super(`Daily report budget exhausted for studio ${studioId}`);
    this.name = "BudgetExhaustedError";
  }
}

/**
 * Kick off a report run. Returns our own run id; the data arrives later,
 * either via the host-report-run-completed webhook or the reconcile cron.
 */
export async function requestReport(
  studioId: string,
  params: ReportParams,
): Promise<{ runId: string; momenceRunId: number }> {
  const db = serviceClient();

  const { data: claimed, error: claimError } = await db.rpc("claim_report_slot", {
    p_studio_id: studioId,
  });

  if (claimError) throw claimError;
  if (!claimed) throw new BudgetExhaustedError(studioId);

  const client = await MomenceClient.forStudio(studioId);

  const { data: run, error: insertError } = await db
    .from("report_runs")
    .insert({
      studio_id: studioId,
      report_type: params.reportType,
      date_from: params.from.toISOString(),
      date_to: params.to.toISOString(),
      status: "requested",
    })
    .select("id")
    .single();

  if (insertError || !run) throw insertError ?? new Error("Could not record report run");

  try {
    const response = await client.request<{ id: number }>("/api/v2/host/reports", {
      method: "POST",
      body: JSON.stringify({
        parameters: {
          reportType: params.reportType,
          hostId: client.hostId,
          dateRange: { from: params.from.toISOString(), to: params.to.toISOString() },
          ...(params.locationId !== undefined && { locationId: params.locationId }),
          ...(params.includeRefunds !== undefined && {
            includeRefunds: params.includeRefunds,
          }),
          ...(params.saleTypes && { saleTypes: params.saleTypes }),
        },
      }),
    });

    await db
      .from("report_runs")
      .update({ momence_run_id: response.id })
      .eq("id", run.id);

    return { runId: run.id, momenceRunId: response.id };
  } catch (err) {
    await db
      .from("report_runs")
      .update({ status: "failed", error: String(err) })
      .eq("id", run.id);
    throw err;
  }
}

/**
 * Pull the finished data and store it.
 *
 * Prefer the reportUrlApi handed to us by the completion webhook. The
 * `/api/v2/host/reports/{id}` path below is the fallback for runs whose
 * webhook never arrived — confirm it against the current OpenAPI schema,
 * as the retrieve endpoint's exact shape is not published in the guide.
 */
export async function collectReport(runId: string): Promise<number> {
  const db = serviceClient();

  const { data: run, error } = await db
    .from("report_runs")
    .select("id, studio_id, momence_run_id, report_url_api, status, row_count, report_type")
    .eq("id", runId)
    .single();

  if (error || !run) throw error ?? new Error(`Report run ${runId} not found`);
  if (run.status === "completed") return run.row_count ?? 0;

  const client = await MomenceClient.forStudio(run.studio_id);
  const path = run.report_url_api ?? `/api/v2/host/reports/${run.momence_run_id}`;

  const payload = await client.request<ReportRunResponse>(path);

  // The retrieve endpoint answers 200 for a run that is still generating,
  // with status "running" and data: null. Storing that would mark the run
  // complete and leave the real rows unfetched forever.
  if (payload?.status && payload.status !== "completed") {
    throw new ReportNotReadyError(runId, payload.status);
  }

  const rows = normaliseRows(payload);

  if (rows.length > 0) {
    // Chunked so a large report does not blow the request body limit.
    for (let i = 0; i < rows.length; i += 500) {
      await db.from("report_rows").upsert(
        rows.slice(i, i + 500).map((data, offset) => ({
          report_run_id: run.id,
          row_index: i + offset,
          data,
        })),
      );
    }
  }

  // A total-sales report is the only source of revenue history, so its rows
  // are projected into `sales` rather than left as JSONB. Without this the
  // scheduled runs land in report_rows and the revenue figures never move.
  if (run.report_type === REPORT_TYPES.TOTAL_SALES && rows.length > 0) {
    await projectSales(run.studio_id, rows);
  }

  await db
    .from("report_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      row_count: rows.length,
    })
    .eq("id", run.id);

  return rows.length;
}

/**
 * Report payload shapes vary by report type. Rather than pin a schema per
 * type up front, land the rows as JSONB and shape them in SQL, where they
 * can be corrected without a redeploy.
 */
function normaliseRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;

  // The documented shape: { id, status, parameters, data: { reportType, items } }.
  const data = obj.data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items)) {
    return (data as Record<string, unknown>).items as Record<string, unknown>[];
  }

  // Fallbacks for report types whose payload the schema does not pin down.
  for (const key of ["rows", "data", "results", "items"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }

  // Deliberately not [obj]: wrapping an envelope as a single row silently
  // produces a "successful" report run containing nothing usable.
  return [];
}

/**
 * Upsert total-sales rows into `sales`.
 *
 * Keyed on saleItemId so a re-run of an overlapping date range corrects rows
 * rather than duplicating them — which matters because the scheduler requests
 * a rolling seven-day window four times a day.
 *
 * Location lives on the transaction item, not the sale itself.
 */
async function projectSales(studioId: string, rows: Record<string, unknown>[]) {
  const db = serviceClient();
  const now = new Date().toISOString();

  const mapped = rows
    .filter((r) => r.saleItemId && r.paymentDate)
    .map((r) => {
      const items = (r.transactionItems as { homeLocation?: string }[] | undefined) ?? [];
      return {
        studio_id: studioId,
        sale_item_id: r.saleItemId as number,
        payment_transaction_id: (r.paymentTransactionId as number) ?? null,
        member_id: (r.memberId as number) ?? null,
        paying_member_id: (r.payingMemberId as number) ?? null,
        customer_name: (r.customerName as string) ?? null,
        customer_email: (r.customerEmail as string) ?? null,
        payment_date: r.paymentDate as string,
        service_date: (r.serviceDate as string) ?? null,
        payment_value: (r.paymentValue as number) ?? null,
        payment_vat: (r.paymentVat as number) ?? null,
        paid_in_money_credits: (r.paidInMoneyCredits as number) ?? null,
        refunded: (r.refunded as number) ?? null,
        payment_item: (r.paymentItem as string) ?? null,
        payment_category: (r.paymentCategory as string) ?? null,
        membership_type: (r.membershipType as string) ?? null,
        payment_method: (r.paymentMethod as string) ?? null,
        payment_status: (r.paymentStatus as string) ?? null,
        location_name: items[0]?.homeLocation ?? null,
        currency: (r.currency as string) ?? null,
        raw: r,
        updated_at: now,
      };
    });

  // 150 rather than 500: each row carries the full report payload, and larger
  // batches broke the connection mid-write during the initial backfill.
  for (let i = 0; i < mapped.length; i += 150) {
    const { error } = await db
      .from("sales")
      .upsert(mapped.slice(i, i + 150), { onConflict: "studio_id,sale_item_id" });
    if (error) throw error;
  }
}
