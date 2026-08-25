import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/db";

/** Exchanges the emailed code for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (code) {
    const supabase = await userClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=link_expired", request.url));
}
