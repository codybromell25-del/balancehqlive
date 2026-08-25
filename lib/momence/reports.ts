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
    .select("id, studio_id, momence_run_id, report_url_api, status, row_count")
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
