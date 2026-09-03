/**
 * Backfill history from the Host API.
 *
 *   npx tsx --env-file=.env.local scripts/backfill.ts --slug balance --days 365
 *
 * Webhooks only deliver events from the moment they are registered, so
 * everything before that is invisible. The reports API cannot fill the gap —
 * it only generates total-sales — but /api/v2/host/sessions and
 * /sessions/{id}/bookings are ordinary paginated endpoints with no documented
 * rate limit, and between them they carry capacity, attendance and membership
 * of every class.
 *
 * Everything here upserts into the same tables the projectors write, so a
 * backfill and a live event that describe the same booking converge on the
 * same row. Safe to re-run, and safe to run while webhooks are flowing.
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

function arg(flag: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${flag}`);
  const v = i > -1 ? process.argv[i + 1] : undefined;
  if (!v && fallback === undefined) {
    console.error(`Missing --${flag}`);
    process.exit(1);
  }
  return v ?? fallback!;
}

/** Bounded concurrency: fast enough to finish, gentle enough not to hammer. */
async function pooled<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i], i);
      }
    }),
  );
}

interface Session {
  id: number; name: string; type: string;
  startsAt: string; endsAt: string;
  durationInMinutes: number | null; capacity: number | null;
  bookingCount: number; isCancelled: boolean;
  teacher: { id: number } | null;
  inPersonLocation: { id: number; name: string } | null;
}

interface Booking {
  id: number;
  member: { id: number; firstName?: string; lastName?: string; email?: string } | null;
  checkedIn: boolean; cancelledAt: string | null; createdAt: string;
}

async function main() {
  const slug = arg("slug", "balance");
  const days = Number(arg("days", "365"));
  const concurrency = Number(arg("concurrency", "6"));
  const skipBookings = process.argv.includes("--sessions-only");

  const db = serviceClient();
  const { data: studio, error } = await db
    .from("studios").select("id, name").eq("slug", slug).single();
  if (error || !studio) throw new Error(`Studio ${slug} not found`);

  const client = await MomenceClient.forStudio(studio.id);

  // Forward window matters: classes are scheduled weeks ahead, and a backfill
  // that stops at "now" misses every already-scheduled future class. Those
  // never arrive by webhook either, because session-created only fires when a
  // class is created — not for ones that already existed.
  const forwardDays = Number(arg("forward", "0"));
  const to = new Date(Date.now() + forwardDays * 86_400_000);
  const from = new Date(Date.now() - days * 86_400_000);

  console.log(`\nBackfilling ${studio.name} — ${days} days from ${from.toISOString().slice(0, 10)}\n`);

  // ---- sessions ---------------------------------------------------------
  const sessions: Session[] = [];
  const pageSize = 200;
  for (let page = 0; ; page++) {
    const res = await client.request<{ payload: Session[]; pagination: { totalCount: number } }>(
      `/api/v2/host/sessions?page=${page}&pageSize=${pageSize}` +
        `&startAfter=${from.toISOString()}&startBefore=${to.toISOString()}` +
        `&includeCancelled=true`,
    );
    sessions.push(...res.payload);
    process.stdout.write(`\r  sessions fetched: ${sessions.length}/${res.pagination.totalCount}`);
    if (sessions.length >= res.pagination.totalCount || res.payload.length === 0) break;
  }
  console.log();

  const locations = new Map<number, string>();
  for (const s of sessions) {
    if (s.inPersonLocation) locations.set(s.inPersonLocation.id, s.inPersonLocation.name);
  }

  if (locations.size) {
    await db.from("locations").upsert(
      [...locations].map(([id, name]) => ({
        studio_id: studio.id, momence_location_id: id, name,
      })),
      { onConflict: "studio_id,momence_location_id" },
    );
    console.log(`  locations: ${locations.size}`);
  }

  const now = new Date().toISOString();
  for (let i = 0; i < sessions.length; i += 500) {
    await db.from("sessions").upsert(
      sessions.slice(i, i + 500).map((s) => ({
        studio_id: studio.id,
        momence_session_id: s.id,
        name: s.name,
        session_type: s.type,
        momence_location_id: s.inPersonLocation?.id ?? null,
        teacher_id: s.teacher?.id ?? null,
        starts_at: s.startsAt,
        ends_at: s.endsAt,
        capacity: s.capacity,
        duration_minutes: s.durationInMinutes,
        cancelled: s.isCancelled,
        updated_at: now,
      })),
      { onConflict: "studio_id,momence_session_id" },
    );
  }
  console.log(`  sessions stored: ${sessions.length}`);

  if (skipBookings) {
    console.log("\n--sessions-only: stopping before bookings.\n");
    return;
  }

  // ---- bookings ---------------------------------------------------------
  // Only sessions that actually had bookings are worth a request.
  const worth = sessions.filter((s) => s.bookingCount > 0);
  console.log(`\n  fetching bookings for ${worth.length} sessions with attendance…`);

  let done = 0, bookingRows = 0, failed = 0;
  const members = new Map<number, Booking["member"]>();
  const firstBooking = new Map<number, string>();

  await pooled(worth, concurrency, async (s) => {
    try {
      const all: Booking[] = [];
      for (let page = 0; ; page++) {
        const res = await client.request<{ payload: Booking[]; pagination: { totalCount: number } }>(
          `/api/v2/host/sessions/${s.id}/bookings?page=${page}&pageSize=100&includeCancelled=true`,
        );
        all.push(...res.payload);
        if (all.length >= res.pagination.totalCount || res.payload.length === 0) break;
      }

      const past = new Date(s.endsAt).getTime() < Date.now();

      const rows = all
        .filter((b) => b.member?.id)
        .map((b) => {
          // The API exposes no no-show flag. A booking on a session that has
          // already finished, never checked in and never cancelled, is one.
          const status = b.cancelledAt
            ? "cancelled"
            : b.checkedIn
              ? "checked-in"
              : past
                ? "no-show"
                : "booked";

          if (b.member) {
            members.set(b.member.id, b.member);
            const seen = firstBooking.get(b.member.id);
            if (!seen || b.createdAt < seen) firstBooking.set(b.member.id, b.createdAt);
          }

          return {
            studio_id: studio.id,
            momence_booking_id: b.id,
            momence_session_id: s.id,
            member_id: b.member!.id,
            status,
            booked_at: b.createdAt,
            cancelled_at: b.cancelledAt,
            checked_in_at: b.checkedIn ? b.createdAt : null,
            updated_at: now,
          };
        });

      if (rows.length) {
        await db.from("session_bookings").upsert(rows, {
          onConflict: "studio_id,momence_booking_id",
        });
        bookingRows += rows.length;
      }
    } catch {
      failed++;
    } finally {
      done++;
      if (done % 25 === 0 || done === worth.length) {
        process.stdout.write(
          `\r  sessions processed: ${done}/${worth.length}  bookings: ${bookingRows}  failed: ${failed}`,
        );
      }
    }
  });
  console.log();

  // ---- members ----------------------------------------------------------
  // Harvested from bookings rather than a separate crawl: anyone who ever
  // booked is someone worth counting, and they arrive here for free.
  // first_seen_at defaults to now(), which would date every backfilled member
  // to the day of the import and make "new members" meaningless. The earliest
  // booking we have seen is the best available proxy for when they arrived.
  const firstSeen = new Map<number, string>();
  for (const [id, at] of firstBooking) firstSeen.set(id, at);

  const memberRows = [...members.values()].filter(Boolean).map((m) => ({
    studio_id: studio.id,
    momence_member_id: m!.id,
    email: m!.email ?? null,
    first_name: m!.firstName ?? null,
    last_name: m!.lastName ?? null,
    first_seen_at: firstSeen.get(m!.id) ?? now,
    updated_at: now,
  }));

  for (let i = 0; i < memberRows.length; i += 500) {
    await db.from("members").upsert(memberRows.slice(i, i + 500), {
      onConflict: "studio_id,momence_member_id",
      ignoreDuplicates: false,
    });
  }
  console.log(`  members stored: ${memberRows.length}`);

  console.log(`\nDone. ${sessions.length} sessions, ${bookingRows} bookings, ${memberRows.length} members.`);
  if (failed) console.log(`${failed} sessions failed and can be recovered by re-running.\n`);
}

main().catch((e) => { console.error("\n", e); process.exit(1); });
