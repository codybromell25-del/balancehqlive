/**
 * Fetch bookings for cancelled classes.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-cancelled.ts --slug balance
 *
 * Momence zeroes bookingCount when a session is cancelled, so the main
 * backfill — which only fetched bookings for sessions reporting bookings —
 * skipped them entirely. The bookings still exist behind
 * includeCancelled=true, each carrying the cancelledAt stamped when the class
 * was pulled. That is what makes "how many people were in the classes we
 * cancelled" answerable.
 */
import { serviceClient } from "../lib/db";
import { MomenceClient } from "../lib/momence/client";

interface Booking {
  id: number;
  member: { id: number } | null;
  checkedIn: boolean;
  cancelledAt: string | null;
  createdAt: string;
}

async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

function arg(flag: string, fallback: string) {
  const i = process.argv.indexOf(`--${flag}`);
  return (i > -1 ? process.argv[i + 1] : undefined) ?? fallback;
}

async function main() {
  const db = serviceClient();
  const { data: studio, error } = await db
    .from("studios").select("id").eq("slug", arg("slug", "balance")).single();
  if (error || !studio) throw new Error("Studio not found");

  const client = await MomenceClient.forStudio(studio.id);

  const { data: sessions } = await db
    .from("sessions")
    .select("momence_session_id, starts_at")
    .eq("studio_id", studio.id)
    .eq("cancelled", true)
    .order("starts_at", { ascending: false });

  const list = sessions ?? [];
  console.log(`\n  ${list.length} cancelled classes to check\n`);

  const now = new Date().toISOString();
  let stored = 0, withBookings = 0, done = 0, failed = 0;

  await pooled(list, 6, async (s) => {
    try {
      const res = await client.request<{ payload: Booking[]; pagination: { totalCount: number } }>(
        `/api/v2/host/sessions/${s.momence_session_id}/bookings?page=0&pageSize=100&includeCancelled=true`,
      );
      const rows = (res.payload ?? [])
        .filter((b) => b.member?.id)
        .map((b) => ({
          studio_id: studio.id,
          momence_booking_id: b.id,
          momence_session_id: s.momence_session_id,
          member_id: b.member!.id,
          // Every booking on a cancelled class is cancelled, but the member
          // did not cancel it — the studio did. Kept as 'cancelled' so it
          // never counts as attendance; the class's own cancelled flag is
          // what distinguishes a studio cancellation from a member one.
          status: "cancelled",
          booked_at: b.createdAt,
          cancelled_at: b.cancelledAt,
          checked_in_at: null,
          updated_at: now,
        }));

      if (rows.length) {
        const { error: e } = await db
          .from("session_bookings")
          .upsert(rows, { onConflict: "studio_id,momence_booking_id" });
        if (e) throw e;
        stored += rows.length;
        withBookings++;
      }
    } catch {
      failed++;
    } finally {
      done++;
      if (done % 25 === 0 || done === list.length) {
        process.stdout.write(`\r  checked ${done}/${list.length}  bookings ${stored}  failed ${failed}`);
      }
    }
  });

  console.log(`\n\n  ${withBookings} of ${list.length} cancelled classes had people booked in`);
  console.log(`  ${stored} bookings recovered\n`);
}

main().catch((e) => { console.error("\n", e); process.exit(1); });
