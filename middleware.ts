import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session on every request so Server Components see a
 * valid user.
 *
 * The matcher deliberately excludes /api/webhooks, /api/cron and /api/momence.
 * None of them is a signed-in user: Momence posts webhooks, the scheduler
 * presents a bearer token, and the OAuth callback arrives as a redirect from
 * Momence carrying a code rather than a session. Running session refresh over
 * them adds latency to the endpoint that must answer fastest, and — worse —
 * makes a middleware failure take down the OAuth flow that would let you
 * recover.
 */
export async function middleware(request: NextRequest) {
  // Supabase sends a sign-in link back to the site URL when the link's own
  // redirect isn't on its allow list, so the code can arrive at "/". Hand
  // it to the callback that turns it into a session, rather than bouncing
  // the person to /login with the code thrown away.
  const params = request.nextUrl.searchParams;
  if (request.nextUrl.pathname === "/" && (params.has("code") || params.has("token_hash"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items: { name: string; value: string; options: CookieOptions }[]) => {
          items.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          items.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const signedInOnly =
    path === "/" || path.startsWith("/dashboard") || path.startsWith("/instructors");

  if (!user && signedInOnly) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api/webhooks|api/cron|api/momence|_next/static|_next/image|favicon.ico).*)",
  ],
};
