import { NextRequest, NextResponse } from "next/server";
import { consumeState, exchange } from "@/lib/momence/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Momence sends the owner back after they sign in.
 *
 * The state proves this callback belongs to an authorization we started, and
 * is consumed on first use so a replayed URL cannot mint a second token set.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get("error");

  if (error) {
    return html(`Momence declined the authorization: ${escapeHtml(error)}`, 400);
  }

  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) {
    return html("Missing code or state.", 400);
  }

  const studioId = await consumeState(state);
  if (!studioId) {
    return html("That authorization link has expired or was already used.", 400);
  }

  try {
    const tokens = await exchange(studioId, { type: "authorization_code", code });

    if (!tokens.refreshToken) {
      return html(
        "Momence returned an access token but no refresh token. The connection " +
          "will stop working within hours. Check the client's configured scope.",
        502,
      );
    }

    return html("Connected. Momence tokens stored — you can close this tab.", 200);
  } catch (err) {
    return html(`Token exchange failed: ${escapeHtml(String(err))}`, 502);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function html(message: string, status: number) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Momence</title>` +
      `<body style="font:16px/1.5 system-ui;max-width:34rem;margin:20vh auto;padding:0 1.5rem">` +
      `<p>${message}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
