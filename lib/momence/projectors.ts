import { serviceClient } from "@/lib/db";
import { collectReport } from "./reports";

/**
 * Projectors turn raw webhook events into the normalised tables the KPI
 * views read from.
 *
 * Two rules hold everywhere in here:
 *   1. Every projector is idempotent. Momence may redeliver, and replaying
 *      the whole event log must land on the same state.
 *   2. Projectors never fail the HTTP response. A projector error is
 *      recorded on the event row and retried by the reconcile cron; the
 *      webhook itself is already durably stored.
 */

type Payload = Record<string, any>;

export interface MomenceEvent {
  timestamp: string;
  event: string;
  payload: Payload;
}

/** A stable identity for each event, so redelivery is a no-op. */
export function dedupeKey(evt: MomenceEvent): string {
  const p = evt.payload;
  const subject =
    p.sessionBookingId ??
    p.sessionId ??
    p.boughtMembershipId ??
    p.memberId ??
    p.memberAddressId ??
    p.id ??
    "unknown";
  return `${evt.event}:${subject}:${evt.timestamp}`;
}

export async function project(studioId: string, evt: MomenceEvent): Promise<void> {
  const db = serviceClient();
  const p = evt.payload;
  const now = new Date().toISOString();

  switch (evt.event) {
    case "member-assigned":
    case "member-updated": {
      await db.from("members").upsert(
        {
          studio_id: studioId,
          momence_member_id: p.memberId,
          email: p.email,
          first_name: p.firstName,
          last_name: p.lastName,
          updated_at: now,
        },
        { onConflict: "studio_id,momence_member_id", ignoreDuplicates: false },
      );
      break;
    }

    case "session-created":
    case "session-updated": {
      await db.from("sessions").upsert(
        {
          studio_id: studioId,
          momence_session_id: p.sessionId,
          name: p.name,
          session_type: p.type,
          momence_location_id: p.locationId,
          teacher_id: p.teacherId,
          room_id: p.roomId,
          starts_at: p.startsAt,
          ends_at: p.endsAt,
          capacity: p.capacity,
          duration_minutes: p.durationMinutes,
          updated_at: now,
        },
        { onConflict: "studio_id,momence_session_id" },
      );

      if (p.locationId) {
        await db
          .from("locations")
          .upsert(
            { studio_id: studioId, momence_location_id: p.locationId },
            { onConflict: "studio_id,momence_location_id", ignoreDuplicates: true },
          );
      }
      break;
    }

    case "session-booked": {
      await db.from("session_bookings").upsert(
        {
          studio_id: studioId,
          momence_booking_id: p.sessionBookingId,
          momence_session_id: p.sessionId,
          member_id: p.targetMemberId,
          paying_member_id: p.payingMemberId,
          status: "booked",
          booked_at: evt.timestamp,
          updated_at: now,
        },
        { onConflict: "studio_id,momence_booking_id" },
      );
      break;
    }

    case "session-booking-cancelled": {
      // booked_at is deliberately absent from this patch. Writing the
      // cancellation time into it would move the booking to the wrong day
      // in kpi_daily, and a replay would do it again.
      const patch = {
        status: "cancelled",
        cancelled_at: p.cancelledAt ?? evt.timestamp,
        is_late_cancellation: Boolean(p.isLateCancellation),
        updated_at: now,
      };

      const { data: touched } = await db
        .from("session_bookings")
        .update(patch)
        .eq("studio_id", studioId)
        .eq("momence_booking_id", p.sessionBookingId)
        .select("momence_booking_id");

      // A cancellation can outrun the session-booked event it refers to.
      // Insert what this event knows rather than dropping it; booked_at is
      // a placeholder until the booking event lands and corrects it.
      if (!touched?.length) {
        await db.from("session_bookings").upsert(
          {
            studio_id: studioId,
            momence_booking_id: p.sessionBookingId,
            momence_session_id: p.sessionId,
            member_id: p.targetMemberId,
            paying_member_id: p.payingMemberId,
            booked_at: p.bookedAt ?? evt.timestamp,
            ...patch,
          },
          { onConflict: "studio_id,momence_booking_id" },
        );
      }
      break;
    }

    case "session-booking-checked-in": {
      const patch = {
        status: "checked-in",
        checked_in_at: p.checkedInAt ?? evt.timestamp,
        updated_at: now,
      };

      const { data: touched } = await db
        .from("session_bookings")
        .update(patch)
        .eq("studio_id", studioId)
        .eq("momence_booking_id", p.sessionBookingId)
        .select("momence_booking_id");

      // An update alone would silently do nothing if the booking event has
      // not arrived yet, and the attendance would never be counted.
      if (!touched?.length) {
        await db.from("session_bookings").upsert(
          {
            studio_id: studioId,
            momence_booking_id: p.sessionBookingId,
            momence_session_id: p.sessionId,
            member_id: p.targetMemberId,
            paying_member_id: p.payingMemberId,
            booked_at: p.bookedAt ?? evt.timestamp,
            ...patch,
          },
          { onConflict: "studio_id,momence_booking_id" },
        );
      }
      break;
    }

    case "session-booking-no-show": {
      // Fires roughly two hours after the session ends. Don't overwrite a
      // check-in that landed late.
      await db
        .from("session_bookings")
        .update({ status: "no-show", updated_at: now })
        .eq("studio_id", studioId)
        .eq("momence_booking_id", p.sessionBookingId)
        .eq("status", "booked");
      break;
    }

    case "bought-membership-activated": {
      await db.from("bought_memberships").upsert(
        {
          studio_id: studioId,
          bought_membership_id: p.boughtMembershipId,
          membership_id: p.membershipId,
          member_id: p.memberId,
          membership_type: p.type,
          start_date: p.startDate,
          end_date: p.endDate,
          status: "active",
          cancelled_at: null,
          updated_at: now,
        },
        { onConflict: "studio_id,bought_membership_id" },
      );
      break;
    }

    case "bought-membership-frozen":
    case "bought-membership-unfrozen":
    case "bought-membership-renewal-cancelled":
    case "bought-membership-renewal-uncancelled":
    case "bought-membership-renewal-failed":
    case "bought-membership-cancelled-after-failed-renewal": {
      const status = {
        "bought-membership-frozen": "frozen",
        "bought-membership-unfrozen": "active",
        "bought-membership-renewal-cancelled": "renewal-cancelled",
        "bought-membership-renewal-uncancelled": "active",
        "bought-membership-renewal-failed": "active",
        "bought-membership-cancelled-after-failed-renewal": "cancelled",
      }[evt.event]!;

      await db.from("bought_memberships").upsert(
        {
          studio_id: studioId,
          bought_membership_id: p.boughtMembershipId,
          membership_id: p.membershipId,
          member_id: p.memberId,
          membership_type: p.type,
          start_date: p.startDate,
          end_date: p.endDate,
          status,
          updated_at: now,
          ...(status === "cancelled" && { cancelled_at: evt.timestamp }),
          ...(evt.event === "bought-membership-renewal-failed" && {
            renewal_failed_at: evt.timestamp,
          }),
        },
        { onConflict: "studio_id,bought_membership_id" },
      );
      break;
    }

    case "payment-transaction-succeeded":
    case "payment-transaction-pending":
    case "payment-transaction-failed": {
      // The webhook carries only a transaction id, so the amount has to be
      // fetched. Deliberately kept as a second call rather than inferred:
      // guessed revenue is worse than late revenue.
      const { MomenceClient } = await import("./client");
      const client = await MomenceClient.forStudio(studioId);
      const tx = await client.request<Payload>(
        `/api/v2/host/payment-transactions/${p.id}`,
      );

      await db.from("payment_transactions").upsert(
        {
          studio_id: studioId,
          transaction_id: p.id,
          status: evt.event.replace("payment-transaction-", ""),
          amount: tx.amount ?? tx.total ?? null,
          currency: tx.currency ?? null,
          member_id: tx.memberId ?? null,
          occurred_at: evt.timestamp,
          raw: tx,
        },
        { onConflict: "studio_id,transaction_id" },
      );
      break;
    }

    case "host-report-run-completed": {
      const { data: run } = await db
        .from("report_runs")
        .select("id")
        .eq("momence_run_id", p.id)
        .maybeSingle();

      if (run) {
        await db
          .from("report_runs")
          .update({ report_url_api: p.reportUrlApi })
          .eq("id", run.id);
        await collectReport(run.id);
      }
      break;
    }

    default:
      // Unknown events stay in webhook_events and are replayable once a
      // projector exists for them.
      break;
  }
}
