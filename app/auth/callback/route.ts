import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/db";

/**
 * Turns an email sign-in link into a session cookie.
 *
 * Two shapes arrive here and they are not interchangeable:
 *
 *   ?code=...        PKCE. Only works for a login the browser itself started,
 *                    because exchangeCodeForSession needs the code verifier
 *                    cookie that signInWithOtp set.
 *
 *   ?token_hash=...  A plain verification token. Carries no verifier, so it
 *   &type=magiclink  works for links minted out of band — an admin-generated
 *                    link, or an invite sent to a new studio owner.
 *
 * Supporting only the first meant any link not started in this browser
 * silently bounced back to /login, which reads as a broken link rather than
 * an unsupported one.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");

  const supabase = await userClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/dashboard", request.url));
    return fail(request, "exchange_failed");
  }

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: (type as "magiclink" | "email" | "invite" | "recovery") ?? "magiclink",
    });
    if (!error) return NextResponse.redirect(new URL("/dashboard", request.url));
    return fail(request, "invalid_or_expired");
  }

  return fail(request, "missing_token");
}

function fail(request: NextRequest, reason: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}
