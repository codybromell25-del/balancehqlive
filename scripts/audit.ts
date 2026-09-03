/**
 * Compare what we hold against what Momence holds.
 *
 *   npx tsx --env-file=.env.local scripts/audit.ts --slug balance
 *
 * Every number the dashboard shows is derived from sessions, bookings, members
 * or sales. If those match Momence, the dashboard is sound; if they drift, it
 * is confidently wrong in a way nobody notices. This walks month by month and
 * says which is which.
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

function arg(flag: string, fallback: string) {
  const i = process.argv.indexOf(`--${flag}`);
  return (i > -1 ? process.argv[i + 1] : undefined) ?? fallback;
}

async function main() {
  const db = serviceClient();
  const { data: studio, error } = await db
    .from("studios").select("id, name").eq("slug", arg("slug", "balance")).single();
  if (error || !studio) throw new Error("Studio not found");
  const client = await MomenceClient.forStudio(studio.id);

  const months = Number(arg("months", "13"));
  const gaps: { month: string; theirs: number; ours: number }[] = [];

  console.log("\n  SESSIONS — ours against Momence, month by month\n");
  console.log(`  ${"month".padEnd(10)}${"Momence".padStart(9)}${"ours".padStart(8)}${"diff".padStart(8)}`);

  for (let m = months - 1; m >= -2; m--) {
    const end = new Date();
    end.setUTCMonth(end.getUTCMonth() - m + 1, 1);
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCMonth(start.getUTCMonth() - 1);
    const label = start.toISOString().slice(0, 7);

    const res = await client.request<{ pagination: { totalCount: number } }>(
      `/api/v2/host/sessions?page=0&pageSize=1` +
        `&startAfter=${start.toISOString()}&startBefore=${end.toISOString()}&includeCancelled=true`,
    );
    const theirs = res.pagination.totalCount;

    const { count } = await db
      .from("sessions")
      .select("momence_session_id", { count: "exact", head: true })
      .eq("studio_id", studio.id)
      .gte("starts_at", start.toISOString())
      .lt("starts_at", end.toISOString());

    const ours = count ?? 0;
    const diff = ours - theirs;
    const flag = diff === 0 ? "" : "  <-- GAP";
    console.log(`  ${label.padEnd(10)}${String(theirs).padStart(9)}${String(ours).padStart(8)}${String(diff > 0 ? "+" + diff : diff).padStart(8)}${flag}`);
    if (diff !== 0) gaps.push({ month: label, theirs, ours });
  }

  console.log("\n  MEMBERS");
  const mem = await client.request<{ pagination: { totalCount: number } }>(
    "/api/v2/host/members?page=0&pageSize=1",
  );
  const { count: ourMembers } = await db
    .from("members").select("momence_member_id", { count: "exact", head: true })
    .eq("studio_id", studio.id);
  console.log(`    Momence ${mem.pagination.totalCount}, ours ${ourMembers} (${(ourMembers ?? 0) - mem.pagination.totalCount >= 0 ? "+" : ""}${(ourMembers ?? 0) - mem.pagination.totalCount})`);

  console.log(
    gaps.length
      ? `\n  ${gaps.length} month(s) out of step — see GAP above\n`
      : "\n  Everything matches.\n",
  );
}

main().catch((e) => { console.error("\n", e); process.exit(1); });
