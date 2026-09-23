import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import { collectReport } from "@/lib/momence/reports";
import { project, type MomenceEvent } from "@/lib/momence/projectors";
import { syncCancellations } from "@/lib/momence/sync-cancellations";

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

/**
 * Vercel kills the function at 60s. Stopping at 45 leaves room to finish the
 * work in flight and return a useful response — a timeout returns nothing at
 * all, so the scheduler cannot tell a slow run from a broken one.
 */
const TIME_BUDGET_MS = 45_000;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = serviceClient();
  const now = Date.now();

  // ---- 1. Replay failed projections -------------------------------------

  const { data: unprocessed } = await db
    .from("webhook_events")
    .select("id, studio_id, event_name, occurred_at, payload")
    .is("processed_at", null)
    .order("occurred_at", { ascending: true })
    // Payment events each fetch the transaction from Momence, so a backlog of
    // them is slow. Take a large slice and stop on the clock rather than on a
    // count — the mix of event types varies too much to pick a safe number.
    .limit(400);

  let replayed = 0;
  let stillFailing = 0;
  let ranOutOfTime = false;

  for (const row of unprocessed ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      ranOutOfTime = true;
      break;
    }

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

  // ---- 3. Refresh cancelled classes --------------------------------------
  //
  // No webhook reports a class cancellation, so the flag only moves when we
  // poll for it. Sweeping 48 days of sessions takes long enough that doing it
  // on every 15-minute run pushed the whole route past Vercel's 60-second
  // ceiling, which failed the job and stopped reconciliation entirely.
  //
  // Hourly is ample: a class cancelled on the day still lands within the hour,
  // and the other work in this route — replaying failed projections — keeps
  // running every 15 minutes regardless.
  const cancellations: Record<string, unknown>[] = [];
  // Skip the sweep entirely when the replay has already used the budget;
  // draining a backlog matters more than refreshing the schedule this hour.
  const dueForSessionSweep =
    new Date().getMinutes() < 15 && Date.now() - startedAt < TIME_BUDGET_MS;

  if (dueForSessionSweep) {
    const { data: studios } = await db.from("studios").select("id, slug").eq("is_active", true);
    for (const studio of studios ?? []) {
      try {
        cancellations.push({ studio: studio.slug, ...(await syncCancellations(studio.id)) });
      } catch (err) {
        cancellations.push({ studio: studio.slug, error: String(err).slice(0, 160) });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    events: { replayed, stillFailing, ranOutOfTime },
    reports: { collected, abandoned },
    cancellations: dueForSessionSweep ? cancellations : "skipped this run",
  });
}
