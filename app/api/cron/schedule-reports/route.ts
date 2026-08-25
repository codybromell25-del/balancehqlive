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
 * roughly 26, which leaves ample room for manual refreshes and backfills.
 */

interface ScheduleEntry {
  reportType: ReportType;
  /** UTC hours at which this report runs. */
  hours: number[];
  /** How far back the date range reaches. */
  lookbackDays: number;
}

const SCHEDULE: ScheduleEntry[] = [
  // Sales reconciliation four times a day: catches anything the payment
  // webhooks missed, without pretending we need it hourly.
  { reportType: REPORT_TYPES.TOTAL_SALES, hours: [1, 7, 13, 19], lookbackDays: 7 },

  // Intro conversion is the number that actually moves the business, and it
  // has no webhook equivalent.
  { reportType: REPORT_TYPES.INTRO_OFFERS_CONVERSIONS, hours: [2, 8, 14, 20], lookbackDays: 90 },

  // Cancellations arrive by webhook, but the report carries reason codes.
  { reportType: REPORT_TYPES.MEMBERSHIP_CANCELLATIONS, hours: [3, 15], lookbackDays: 90 },

  // Cohort retention is expensive and slow-moving. Nightly is plenty.
  { reportType: REPORT_TYPES.RETENTION, hours: [4], lookbackDays: 365 },

  // First-visit definitions are fiddly; let Momence be the source of truth
  // and reconcile our own count against it twice a day.
  { reportType: REPORT_TYPES.NEW_VISITORS, hours: [5, 17], lookbackDays: 30 },
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
