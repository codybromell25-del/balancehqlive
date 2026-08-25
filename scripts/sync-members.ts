/**
 * Sync the member roster from /api/v2/host/members.
 *
 *   npx tsx --env-file=.env.local scripts/sync-members.ts --slug balance
 *
 * The backfill harvests members from bookings, which only finds people who
 * booked inside the window and dates them by their first booking. This
 * endpoint returns the whole roster with a real `firstSeen`, which is what
 * the new-members metric actually needs.
 *
 * Idempotent: re-running refreshes names, emails and join dates in place.
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

interface HostMember {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  firstSeen?: string | null;
}

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(`--${flag}`);
  return (i > -1 ? process.argv[i + 1] : undefined) ?? fallback;
}

async function main() {
  const slug = arg("slug", "balance");
  const db = serviceClient();

  const { data: studio, error } = await db
    .from("studios").select("id, name").eq("slug", slug).single();
  if (error || !studio) throw new Error(`Studio ${slug} not found`);

  const client = await MomenceClient.forStudio(studio.id);

  const roster: HostMember[] = [];
  for (let page = 0; ; page++) {
    const res = await client.request<{
      payload: HostMember[];
      pagination: { totalCount: number };
    }>(`/api/v2/host/members?page=${page}&pageSize=100`);

    roster.push(...res.payload);
    process.stdout.write(`\r  fetched ${roster.length}/${res.pagination.totalCount}`);
    if (roster.length >= res.pagination.totalCount || res.payload.length === 0) break;
  }
  console.log();

  const now = new Date().toISOString();
  let dated = 0;

  for (let i = 0; i < roster.length; i += 500) {
    const rows = roster.slice(i, i + 500).map((m) => {
      if (m.firstSeen) dated++;
      return {
        studio_id: studio.id,
        momence_member_id: m.id,
        email: m.email ?? null,
        first_name: m.firstName ?? null,
        last_name: m.lastName ?? null,
        // Without this the column defaults to now() and every member looks
        // like they joined on import day.
        first_seen_at: m.firstSeen ?? now,
        updated_at: now,
      };
    });

    const { error: upsertError } = await db
      .from("members")
      .upsert(rows, { onConflict: "studio_id,momence_member_id", ignoreDuplicates: false });
    if (upsertError) throw upsertError;
  }

  console.log(`  stored ${roster.length} members (${dated} with a real join date)`);
}

main().catch((e) => { console.error("\n", e); process.exit(1); });
