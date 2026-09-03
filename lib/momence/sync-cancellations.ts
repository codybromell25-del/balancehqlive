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
const LOOK_AHEAD_DAYS = 45;

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
  for (let page = 0; page < 10; page++) {
    const res = await client.request<{
      payload: Session[];
      pagination: { totalCount: number };
    }>(
      `/api/v2/host/sessions?page=${page}&pageSize=200` +
        `&startAfter=${from.toISOString()}&startBefore=${to.toISOString()}` +
        `&includeCancelled=true`,
    );
    live.push(...res.payload);
    if (live.length >= res.pagination.totalCount || res.payload.length === 0) break;
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
