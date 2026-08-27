import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import { renderDigest, type Digest } from "@/lib/digest/render";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The weekly digest.
 *
 *   GET /api/cron/weekly-digest              send it
 *   GET /api/cron/weekly-digest?preview=1    render it without sending
 *
 * Preview exists so the thing can be looked at before it reaches anyone,
 * and so a broken template is obvious rather than discovered by the
 * recipient. Both require the cron secret: the digest contains revenue.
 *
 * Sending needs RESEND_API_KEY and DIGEST_TO. Without them the route still
 * renders and reports what is missing, rather than failing silently.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const db = serviceClient();

  const { data: studios, error: studioError } = await db
    .from("studios")
    .select("id, name, slug, currency")
    .eq("is_active", true);

  if (studioError) {
    return NextResponse.json({ error: String(studioError) }, { status: 500 });
  }

  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const results: Record<string, unknown>[] = [];

  for (const studio of studios ?? []) {
    const { data, error } = await db.rpc("dashboard_weekly_digest", {});

    if (error || !data) {
      results.push({ studio: studio.slug, error: String(error ?? "no data") });
      continue;
    }

    const digest = data as Digest;
    const html = renderDigest(digest, {
      studio: studio.name,
      currency: studio.currency ?? "EUR",
      url: appUrl,
    });

    if (preview) {
      return new NextResponse(html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const to = process.env.DIGEST_TO;
    const key = process.env.RESEND_API_KEY;

    if (!key || !to) {
      results.push({
        studio: studio.slug,
        skipped: "email not configured",
        missing: [!key && "RESEND_API_KEY", !to && "DIGEST_TO"].filter(Boolean),
      });
      continue;
    }

    const subject = `${studio.name} - week to ${new Date(digest.week_to).toLocaleDateString("en-IE", { day: "numeric", month: "long" })}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.DIGEST_FROM ?? "onboarding@resend.dev",
        to: to.split(",").map((s) => s.trim()),
        subject,
        html,
      }),
    });

    results.push(
      res.ok
        ? { studio: studio.slug, sent: to }
        : { studio: studio.slug, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` },
    );
  }

  return NextResponse.json({ ok: true, results });
}
