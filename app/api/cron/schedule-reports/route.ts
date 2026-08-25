import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import {
  BudgetExhaustedError,
  REPORT_TYPES,
  requestReport,
  type ReportType,
} from "@/lib/momence/reports";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Scheduled report runs.
 *
 * Webhooks already cover bookings, attendance, occupancy, membership state
 * and payments in near real time. Reports are reserved for the things the
 * event stream cannot produce: cohort retention, intro-offer conversion, and
 * a periodic sales reconciliation to catch anything the stream dropped.
 *
 * Budget: 100 report generations per studio per day. The schedule below uses
 * 4, leaving the rest for manual refreshes and backfills.
 *
 * Everything else this platform reports on is derived from webhooks rather
 * than reports — occupancy, attendance, churn and revenue all project from
 * the event stream. The one genuine gap is intro-offer conversion, which has
 * no webhook equivalent and no API report; it has to come from a CSV export
 * until Momence exposes more report types.
 */

interface ScheduleEntry {
  reportType: ReportType;
  /** UTC hours at which this report runs. */
  hours: number[];
  /** How far back the date range reaches. */
  lookbackDays: number;
}

const SCHEDULE: ScheduleEntry[] = [
  // total-sales is the only report this platform can actually generate.
  //
  // Probed live against the API on 2026-08-25: POST /api/v2/host/reports
  // rejects every other type with "parameters must be a one of total-sales,
  // franchise-gift-card-reconciliation". The OpenAPI oneOf was accurate, not
  // merely incomplete — the 80-entry x-enumNames list is an internal enum that
  // is not exposed through this endpoint.
  //
  // Four times a day reconciles revenue against what the payment webhooks
  // projected, which is the one thing a report adds over the event stream.
  { reportType: REPORT_TYPES.TOTAL_SALES, hours: [1, 7, 13, 19], lookbackDays: 7 },
];

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hour = new Date().getUTCHours();
  const due = SCHEDULE.filter((entry) => entry.hours.includes(hour));

  if (due.length === 0) {
    return NextResponse.json({ ok: true, hour, scheduled: 0 });
  }

  const db = serviceClient();
  const { data: studios } = await db
    .from("studios")
    .select("id, slug")
    .eq("is_active", true);

  const results: Record<string, unknown>[] = [];

  for (const studio of studios ?? []) {
    for (const entry of due) {
      const to = new Date();
      const from = new Date(to.getTime() - entry.lookbackDays * 86_400_000);

      try {
        const { runId } = await requestReport(studio.id, {
          reportType: entry.reportType,
          from,
          to,
        });
        results.push({ studio: studio.slug, report: entry.reportType, runId });
      } catch (err) {
        if (err instanceof BudgetExhaustedError) {
          // Expected under load. Skip the rest of this studio's queue rather
          // than hammering a closed door.
          results.push({ studio: studio.slug, skipped: "budget exhausted" });
          break;
        }
        results.push({ studio: studio.slug, report: entry.reportType, error: String(err) });
      }
    }
  }

  return NextResponse.json({ ok: true, hour, results });
}
