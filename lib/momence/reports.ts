import { serviceClient } from "@/lib/db";
import { MomenceClient } from "./client";

/**
 * Report generation is capped at 100 requests per day. Every run therefore
 * has to earn its slot: claim_report_slot() increments a ledger row inside
 * the transaction and refuses once the budget is spent, so a runaway cron
 * cannot quietly exhaust a studio's quota at 3am.
 */

/** The report types this platform actually consumes. */
export const REPORT_TYPES = {
  INTRO_OFFERS_CONVERSIONS: "intro-offers-conversions",
  MEMBERSHIP_CANCELLATIONS: "membership-cancellations",
  RETENTION: "retention",
  TOTAL_SALES: "total-sales",
  NEW_VISITORS: "new-visitors",
  SESSION_OCCUPANCY: "session-occupancy",
  MEMBERSHIP_STATS: "membership-stats",
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

  const payload = await client.request<unknown>(path);
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

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["rows", "data", "results", "items"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    return [obj];
  }

  return [];
}
