import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import { collectReport } from "@/lib/momence/reports";
import { project, type MomenceEvent } from "@/lib/momence/projectors";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The safety net, run every 15 minutes.
 *
 * Two jobs:
 *   1. Replay webhook events whose projection failed. Because the raw log is
 *      append-only and projectors are idempotent, this is always safe.
 *   2. Collect report runs whose completion webhook never arrived. Retrieval
 *      is limited to 1000 requests a day, so it is cheap relative to
 *      generation — but still bounded here.
 */

const STALE_AFTER_MINUTES = 20;
const ABANDON_AFTER_HOURS = 6;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = serviceClient();
  const now = Date.now();

  // ---- 1. Replay failed projections -------------------------------------

  const { data: unprocessed } = await db
    .from("webhook_events")
    .select("id, studio_id, event_name, occurred_at, payload")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    .limit(200);

  let replayed = 0;
  let stillFailing = 0;

  for (const row of unprocessed ?? []) {
    const evt: MomenceEvent = {
      event: row.event_name,
      timestamp: row.occurred_at,
      payload: row.payload,
    };

    try {
      await project(row.studio_id, evt);
      await db
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString(), process_error: null })
        .eq("id", row.id);
      replayed++;
    } catch (err) {
      await db
        .from("webhook_events")
        .update({ process_error: String(err) })
        .eq("id", row.id);
      stillFailing++;
    }
  }

  // ---- 2. Collect stranded report runs -----------------------------------

  const staleBefore = new Date(now - STALE_AFTER_MINUTES * 60_000).toISOString();

  const { data: pending } = await db
    .from("report_runs")
    .select("id, requested_at")
    .eq("status", "requested")
    .not("momence_run_id", "is", null)
    .lt("requested_at", staleBefore)
    .limit(50);

  let collected = 0;
  let abandoned = 0;

  for (const run of pending ?? []) {
    const ageHours = (now - new Date(run.requested_at).getTime()) / 3_600_000;

    if (ageHours > ABANDON_AFTER_HOURS) {
      await db
        .from("report_runs")
        .update({ status: "abandoned", error: "No result after 6 hours" })
        .eq("id", run.id);
      abandoned++;
      continue;
    }

    try {
      await collectReport(run.id);
      collected++;
    } catch {
      // Report is probably still generating. Leave it for the next pass.
    }
  }

  return NextResponse.json({
    ok: true,
    events: { replayed, stillFailing },
    reports: { collected, abandoned },
  });
}
