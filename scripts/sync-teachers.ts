/**
 * Fill in sessions.teacher_name from the Host API.
 *
 *   npx tsx --env-file=.env.local scripts/sync-teachers.ts --slug balance --days 365
 *
 * Sessions store a teacher id but no name, so a teacher breakdown would read
 * as a list of integers. This sweeps the session list — no per-session calls,
 * so it is roughly fifty requests rather than nine thousand — builds an id to
 * name map, and writes the name onto every session that has that teacher.
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

interface Session {
  id: number;
  teacher: { id: number; firstName?: string; lastName?: string } | null;
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(`--${flag}`);
  return (i > -1 ? process.argv[i + 1] : undefined) ?? fallback;
}

async function main() {
  const slug = arg("slug", "balance");
  const days = Number(arg("days", "365"));

  const db = serviceClient();
  const { data: studio, error } = await db
    .from("studios").select("id, name").eq("slug", slug).single();
  if (error || !studio) throw new Error(`Studio ${slug} not found`);

  const client = await MomenceClient.forStudio(studio.id);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  const names = new Map<number, string>();
  let scanned = 0;

  for (let page = 0; ; page++) {
    const res = await client.request<{
      payload: Session[];
      pagination: { totalCount: number };
    }>(
      `/api/v2/host/sessions?page=${page}&pageSize=200` +
        `&startAfter=${from.toISOString()}&startBefore=${to.toISOString()}` +
        `&includeCancelled=true`,
    );

    for (const s of res.payload) {
      if (!s.teacher?.id) continue;
      const name = [s.teacher.firstName, s.teacher.lastName]
        .filter(Boolean).join(" ").trim();
      if (name) names.set(s.teacher.id, name);
    }

    scanned += res.payload.length;
    process.stdout.write(`\r  scanned ${scanned}/${res.pagination.totalCount} sessions — ${names.size} teachers`);
    if (scanned >= res.pagination.totalCount || res.payload.length === 0) break;
  }
  console.log();

  // One update per teacher rather than per session: 38 statements instead of
  // several thousand.
  let updated = 0;
  for (const [id, name] of names) {
    const { error: e, count } = await db
      .from("sessions")
      .update({ teacher_name: name }, { count: "exact" })
      .eq("studio_id", studio.id)
      .eq("teacher_id", id);
    if (e) throw e;
    updated += count ?? 0;
  }

  console.log(`  named ${names.size} teachers across ${updated} sessions`);
}

main().catch((e) => { console.error("\n", e); process.exit(1); });
