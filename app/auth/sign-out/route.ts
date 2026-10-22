import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/db";

/**
 * Signs out and returns to the login page. POST only, so a link preview or
 * a prefetch can't end someone's session.
 */
export async function POST(request: NextRequest) {
  const supabase = await userClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
