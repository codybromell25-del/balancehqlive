import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import { MomenceClient } from "@/lib/momence/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Does the dashboard still agree with reality?
 *
 * Three times this platform has shown a confidently wrong number rather than
 * an error — revenue multiplied by a bad join, totals silently truncated at
 * PostgREST's 1000-row cap, and a session import that stopped at the day it
 * ran. Each looked entirely plausible and each was caught by a human noticing.
 *
 * This runs the checks a human would: our counts against Momence's, and our
 * own figures against each other. It is deliberately loud — a failure here is
 * a reason to distrust the dashboard until someone looks.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Anything under this is rounding or timing; above it wants a human. */
const TOLERANCE = 0.02;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = serviceClient();
  const checks: Check[] = [];

  const { data: studios } = await db
    .from("studios").select("id, slug").eq("is_active", true);

  for (const studio of studios ?? []) {
    const client = await MomenceClient.forStudio(studio.id);

    // --- 1. Do we hold the same classes Momence does? --------------------
    // Checked across a recent window and a forward one, because the two
    // failure modes differ: history stops being imported, or the schedule
    // ahead never arrives.
    for (const [label, backDays, forwardDays] of [
      ["classes, last 30 days", 30, 0],
      ["classes, next 30 days", 0, 30],
    ] as [string, number, number][]) {
      const from = new Date(Date.now() - backDays * 86_400_000);
      const to = new Date(Date.now() + forwardDays * 86_400_000);

      const res = await client.request<{ pagination: { totalCount: number } }>(
        `/api/v2/host/sessions?page=0&pageSize=1` +
          `&startAfter=${from.toISOString()}&startBefore=${to.toISOString()}&includeCancelled=true`,
      );
      const theirs = res.pagination.totalCount;

      const { count } = await db
        .from("sessions")
        .select("momence_session_id", { count: "exact", head: true })
        .eq("studio_id", studio.id)
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString());

      const ours = count ?? 0;
      const drift = theirs ? Math.abs(ours - theirs) / theirs : 0;
      checks.push({
        name: `${studio.slug}: ${label}`,
        ok: drift <= TOLERANCE,
        detail: `Momence ${theirs}, ours ${ours} (${ours - theirs >= 0 ? "+" : ""}${ours - theirs})`,
      });
    }

    // --- 2. Members ------------------------------------------------------
    const mem = await client.request<{ pagination: { totalCount: number } }>(
      "/api/v2/host/members?page=0&pageSize=1",
    );
    const { count: ourMembers } = await db
      .from("members").select("momence_member_id", { count: "exact", head: true })
      .eq("studio_id", studio.id);
    const memDrift = mem.pagination.totalCount
      ? Math.abs((ourMembers ?? 0) - mem.pagination.totalCount) / mem.pagination.totalCount
      : 0;
    checks.push({
      name: `${studio.slug}: members`,
      ok: memDrift <= TOLERANCE,
      detail: `Momence ${mem.pagination.totalCount}, ours ${ourMembers}`,
    });

    // --- 3. Do our own numbers agree with each other? --------------------
    // The revenue tile and the revenue panel read different functions. They
    // disagreed by 80x once, and nothing noticed.
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 27 * 86_400_000).toISOString().slice(0, 10);

    const [{ data: summary }, { data: revenue }] = await Promise.all([
      db.rpc("dashboard_summary", { p_from: from, p_to: to, p_location: null }),
      db.rpc("dashboard_revenue", { p_from: from, p_to: to, p_location: null }),
    ]);

    const a = Number((summary as { revenue?: number } | null)?.revenue ?? 0);
    const b = Number((revenue as { revenue?: number } | null)?.revenue ?? 0);
    checks.push({
      name: `${studio.slug}: revenue tile matches revenue panel`,
      ok: Math.abs(a - b) < 1,
      detail: `tile ${a.toFixed(2)}, panel ${b.toFixed(2)}`,
    });

    // --- 4. Is anything stuck? -------------------------------------------
    const { data: fresh } = await db
      .from("kpi_data_freshness").select("*").eq("studio_id", studio.id).maybeSingle();

    const lastWebhook = fresh?.last_webhook_at ? new Date(fresh.last_webhook_at) : null;
    const hoursQuiet = lastWebhook
      ? (Date.now() - lastWebhook.getTime()) / 3_600_000
      : Infinity;

    checks.push({
      name: `${studio.slug}: event stream alive`,
      // Studios are quiet overnight; a full day of silence is not.
      ok: hoursQuiet < 24,
      detail: lastWebhook ? `last event ${hoursQuiet.toFixed(1)}h ago` : "no events ever received",
    });

    checks.push({
      name: `${studio.slug}: no stuck events`,
      ok: (fresh?.unprocessed_events ?? 0) < 50,
      detail: `${fresh?.unprocessed_events ?? 0} unprocessed`,
    });
  }

  const failed = checks.filter((c) => !c.ok);

  // Record it, so the dashboard can say whether it still trusts itself
  // rather than that only living in a CI log the owner never opens.
  for (const studio of studios ?? []) {
    const mine = checks.filter((c) => c.name.startsWith(`${studio.slug}:`));
    await db.from("verification_runs").insert({
      studio_id: studio.id,
      passed: mine.every((c) => c.ok),
      failed_count: mine.filter((c) => !c.ok).length,
      checks: mine,
    });
  }

  return NextResponse.json(
    {
      ok: failed.length === 0,
      checked: checks.length,
      failed: failed.length,
      checks,
    },
    // A non-200 so the scheduler fails loudly rather than logging a green tick
    // over a broken dashboard.
    { status: failed.length ? 409 : 200 },
  );
}
