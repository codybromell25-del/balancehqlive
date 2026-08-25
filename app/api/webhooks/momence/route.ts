import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import { decrypt, verifyWebhookSignature } from "@/lib/crypto";
import { dedupeKey, project, type MomenceEvent } from "@/lib/momence/projectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Momence webhook receiver.
 *
 * URL shape: /api/webhooks/momence?studio=<slug>
 *
 * The studio slug identifies which tenant this delivery belongs to; the
 * signature proves it. Both are required — a slug alone would let anyone
 * who guesses it write into a studio's numbers.
 *
 * This handler does two things and nothing else: verify, and durably store.
 * Projection is attempted inline but its failure never fails the response,
 * because a 500 to Momence costs a redelivery while the event is already
 * safe in our log.
 */
export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("studio");
  if (!slug) {
    return NextResponse.json({ error: "Missing studio parameter" }, { status: 400 });
  }

  const db = serviceClient();

  const { data: studio } = await db
    .from("studios")
    .select("id, is_active")
    .eq("slug", slug)
    .maybeSingle();

  if (!studio?.is_active) {
    return NextResponse.json({ error: "Unknown studio" }, { status: 404 });
  }

  const body = await req.text();

  let envelope: { payload: string };
  try {
    envelope = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const { data: creds } = await db
    .from("studio_credentials")
    .select("webhook_secret_enc")
    .eq("studio_id", studio.id)
    .maybeSingle();

  const strict = process.env.WEBHOOK_VERIFICATION_STRICT !== "false";

  if (creds?.webhook_secret_enc) {
    const valid = verifyWebhookSignature(
      envelope.payload,
      req.headers.get("x-webhook-signature"),
      decrypt(creds.webhook_secret_enc),
    );

    if (!valid && strict) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else if (strict) {
    return NextResponse.json(
      { error: "No webhook secret configured for this studio" },
      { status: 401 },
    );
  }

  let evt: MomenceEvent;
  try {
    evt = JSON.parse(envelope.payload);
  } catch {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  const { data: stored, error: storeError } = await db
    .from("webhook_events")
    .upsert(
      {
        studio_id: studio.id,
        event_name: evt.event,
        dedupe_key: dedupeKey(evt),
        occurred_at: evt.timestamp,
        payload: evt.payload,
      },
      { onConflict: "studio_id,dedupe_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (storeError) {
    // Storage failed, so a redelivery is genuinely wanted here.
    return NextResponse.json({ error: "Could not store event" }, { status: 500 });
  }

  // Already seen — nothing more to do.
  if (!stored) return NextResponse.json({ ok: true, duplicate: true });

  try {
    await project(studio.id, evt);
    await db
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", stored.id);
  } catch (err) {
    await db
      .from("webhook_events")
      .update({ process_error: String(err) })
      .eq("id", stored.id);
    // Still a 200: the reconcile cron will pick this up.
  }

  return NextResponse.json({ ok: true });
}
