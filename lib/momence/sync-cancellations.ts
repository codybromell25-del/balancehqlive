import { serviceClient } from "@/lib/db";
import { MomenceClient } from "./client";

/**
 * Keep the cancelled flag current.
 *
 * No webhook reports a cancelled class: there is no session-cancelled event,
 * and session-updated carries no cancelled field. The flag therefore only
 * moves when we ask the API, so the reconcile job polls a narrow window
 * around today — which is where a studio cancelling on the day actually
 * operates.
 *
 * Bookings on a newly cancelled class are fetched too, because Momence zeroes
 * bookingCount on cancellation and the count of who was turned away is the
 * point of the report.
 */

const LOOK_BACK_DAYS = 3;
// The daily prune covers the wide window; this only needs to catch
// same-week churn, and a narrower sweep keeps the route inside its budget.
const LOOK_AHEAD_DAYS = 21;

interface Session {
  id: number;
  isCancelled: boolean;
  name: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string | null;
  capacity: number | null;
  durationInMinutes: number | null;
  teacher: { id: number; firstName?: string; lastName?: string } | null;
  inPersonLocation: { id: number; name: string } | null;
}

interface Booking {
  id: number;
  member: { id: number } | null;
  cancelledAt: string | null;
  createdAt: string;
}

export async function syncCancellations(studioId: string): Promise<{
  checked: number;
  newlyCancelled: number;
  bookingsRecovered: number;
}> {
  const db = serviceClient();
  const client = await MomenceClient.forStudio(studioId);

  const from = new Date(Date.now() - LOOK_BACK_DAYS * 86_400_000);
  const to = new Date(Date.now() + LOOK_AHEAD_DAYS * 86_400_000);

  const live: Session[] = [];
  let expected = 0;
  for (let page = 0; page < 20; page++) {
    const res = await client.request<{
      payload: Session[];
      pagination: { totalCount: number };
    }>(
      `/api/v2/host/sessions?page=${page}&pageSize=200` +
        `&startAfter=${from.toISOString()}&startBefore=${to.toISOString()}` +
        `&includeCancelled=true`,
    );
    expected = res.pagination.totalCount;
    live.push(...res.payload);
    if (live.length >= expected || res.payload.length === 0) break;
  }

  // Upsert every session in the window, not just the cancelled ones.
  //
  // session-created only fires for classes created after the integration was
  // connected, so classes already on the timetable never arrive by webhook.
  // The original backfill also stopped at the day it ran, missing everything
  // already scheduled ahead of it — 251 classes in 28 days, which read as a
  // 31% collapse in the numbers. Refreshing the window on every reconcile
  // means that gap closes itself rather than needing a manual backfill.
  const now2 = new Date().toISOString();
  for (let i = 0; i < live.length; i += 200) {
    const batch = live.slice(i, i + 200).map((s) => ({
      studio_id: studioId,
      momence_session_id: s.id,
      name: s.name,
      session_type: s.type,
      momence_location_id: s.inPersonLocation?.id ?? null,
      teacher_id: s.teacher?.id ?? null,
      teacher_name: [s.teacher?.firstName, s.teacher?.lastName].filter(Boolean).join(" ") || null,
      starts_at: s.startsAt,
      ends_at: s.endsAt,
      capacity: s.capacity,
      duration_minutes: s.durationInMinutes,
      cancelled: s.isCancelled,
      updated_at: now2,
    }));
    await db.from("sessions").upsert(batch, { onConflict: "studio_id,momence_session_id" });
  }

  const cancelledIds = live.filter((s) => s.isCancelled).map((s) => s.id);

  // What we already knew, so only genuinely new cancellations cost a
  // bookings call.
  const { data: known } = await db
    .from("sessions")
    .select("momence_session_id")
    .eq("studio_id", studioId)
    .eq("cancelled", true)
    .in("momence_session_id", cancelledIds.length ? cancelledIds : [-1]);

  const alreadyKnown = new Set((known ?? []).map((r) => r.momence_session_id));
  const fresh = cancelledIds.filter((id) => !alreadyKnown.has(id));

  // The upsert above already carries the current cancelled flag both ways,
  // including reinstatements.
  const now = now2;

  let bookingsRecovered = 0;
  for (const id of fresh) {
    try {
      const res = await client.request<{ payload: Booking[] }>(
        `/api/v2/host/sessions/${id}/bookings?page=0&pageSize=100&includeCancelled=true`,
      );
      const rows = (res.payload ?? [])
        .filter((b) => b.member?.id)
        .map((b) => ({
          studio_id: studioId,
          momence_booking_id: b.id,
          momence_session_id: id,
          member_id: b.member!.id,
          status: "cancelled",
          booked_at: b.createdAt,
          cancelled_at: b.cancelledAt,
          updated_at: now,
        }));
      if (rows.length) {
        await db
          .from("session_bookings")
          .upsert(rows, { onConflict: "studio_id,momence_booking_id" });
        bookingsRecovered += rows.length;
      }
    } catch {
      // Leave it for the next pass rather than failing the whole reconcile.
    }
  }

  return { checked: live.length, newlyCancelled: fresh.length, bookingsRecovered };
}


/**
 * Delete classes Momence no longer has.
 *
 * A class leaves Momence two ways. Cancelled keeps the record with
 * isCancelled set, which syncCancellations handles. Deleted removes it
 * outright, and no webhook reports that — so the row sits here forever,
 * inflating class counts and diluting fill rate with capacity nobody could
 * book.
 *
 * Run daily rather than every quarter hour: deletions are rare, and the wide
 * window this needs is far too many API pages to fetch continuously.
 */
export async function pruneDeletedSessions(
  studioId: string,
  backDays = 35,
  forwardDays = 45,
): Promise<{ held: number; live: number; removed: number; skipped?: string }> {
  const db = serviceClient();
  const client = await MomenceClient.forStudio(studioId);

  const from = new Date(Date.now() - backDays * 86_400_000);
  const to = new Date(Date.now() + forwardDays * 86_400_000);

  const liveIds = new Set<number>();
  let expected = 0;
  for (let page = 0; page < 40; page++) {
    const res = await client.request<{
      payload: { id: number }[];
      pagination: { totalCount: number };
    }>(
      `/api/v2/host/sessions?page=${page}&pageSize=200` +
        `&startAfter=${from.toISOString()}&startBefore=${to.toISOString()}` +
        `&includeCancelled=true`,
    );
    expected = res.pagination.totalCount;
    res.payload.forEach((s) => liveIds.add(s.id));
    if (liveIds.size >= expected || res.payload.length === 0) break;
  }

  // A partial fetch would make every unfetched class look deleted.
  if (!expected || liveIds.size < expected) {
    return { held: 0, live: liveIds.size, removed: 0, skipped: "incomplete fetch from Momence" };
  }

  // PostgREST caps a response at 1000 rows. Reading our own side without
  // paging is exactly how a previous version of this silently compared a
  // fraction of the window and concluded nothing had changed.
  const held: number[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("sessions")
      .select("momence_session_id")
      .eq("studio_id", studioId)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("momence_session_id")
      .range(offset, offset + 999);
    if (error) throw error;
    held.push(...(data ?? []).map((r) => r.momence_session_id as number));
    if (!data || data.length < 1000) break;
  }

  const gone = held.filter((id) => !liveIds.has(id));

  // If a large share of the window suddenly looks deleted, that is far more
  // likely to be an API or query fault than a studio removing its timetable —
  // and a wrong deletion is unrecoverable.
  if (gone.length > Math.max(60, held.length * 0.2)) {
    return {
      held: held.length,
      live: liveIds.size,
      removed: 0,
      skipped: `${gone.length} of ${held.length} looked deleted — refusing`,
    };
  }

  let removed = 0;
  for (let i = 0; i < gone.length; i += 200) {
    const batch = gone.slice(i, i + 200);
    // Bookings first: session_bookings has no foreign key to sessions, so
    // nothing else would clean them up and they would keep counting.
    await db.from("session_bookings").delete()
      .eq("studio_id", studioId).in("momence_session_id", batch);
    const { error } = await db.from("sessions").delete()
      .eq("studio_id", studioId).in("momence_session_id", batch);
    if (!error) removed += batch.length;
  }

  return { held: held.length, live: liveIds.size, removed };
}
