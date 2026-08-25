import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/db";
import { beginAuthorization } from "@/lib/momence/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start a Momence authorization for one studio.
 *
 *   /api/momence/authorize?studio=balance
 *
 * Guarded by CRON_SECRET rather than left open: anyone who could reach this
 * unauthenticated could start an authorization against a studio they do not
 * own and, if they also controlled the callback, attach their own tokens.
 * This is run by hand during onboarding, so a bearer token is no hardship.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get("studio");
  if (!slug) {
    return NextResponse.json({ error: "Missing studio parameter" }, { status: 400 });
  }

  const db = serviceClient();
  const { data: studio } = await db
    .from("studios")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (!studio) {
    return NextResponse.json({ error: "Unknown studio" }, { status: 404 });
  }

  const url = await beginAuthorization(studio.id);

  // Returned rather than redirected: this is driven from a terminal during
  // onboarding, and the operator needs the URL to open in a real browser
  // where they can complete 2FA.
  return NextResponse.json({ authorizeUrl: url });
}
