import crypto from "node:crypto";
import { serviceClient } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

const API_BASE = process.env.MOMENCE_API_BASE ?? "https://api.momence.com";

/** The only scope the public API exposes. */
export const SCOPE = "public-api-v2";

/**
 * Authorization code flow.
 *
 * Momence enforces 2FA on host accounts, which the password grant cannot
 * satisfy. Here the owner authenticates on Momence's own login screen and we
 * receive a code, so no staff password ever reaches this server. The refresh
 * token we store is then the long-lived credential — access tokens expire
 * within hours even while in use.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

/** Per AuthTokenDto: absolute expiry timestamps, no expires_in. */
interface AuthTokenDto {
  accessToken?: string;
  access_token?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refresh_token?: string;
  refreshTokenExpiresAt?: string;
}

export function redirectUriFor(): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/momence/callback`;
}

/**
 * Begin an authorization. The state is random and stored server-side rather
 * than encoded into the URL, so a tampered or replayed callback has nothing
 * to match against.
 */
export async function beginAuthorization(studioId: string): Promise<string> {
  const db = serviceClient();

  const { data: creds, error } = await db
    .from("studio_credentials")
    .select("client_id, redirect_uri")
    .eq("studio_id", studioId)
    .single();

  if (error || !creds) {
    throw new Error(`No Momence client configured for studio ${studioId}`);
  }

  const state = crypto.randomBytes(32).toString("base64url");

  const { error: stateError } = await db
    .from("oauth_states")
    .insert({ state, studio_id: studioId });

  if (stateError) throw stateError;

  const redirectUri = creds.redirect_uri ?? redirectUriFor();

  const url = new URL(`${API_BASE}/api/v2/auth/authorize`);
  url.searchParams.set("client_id", creds.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);

  return url.toString();
}

/** Consume a state exactly once, returning the studio it belongs to. */
export async function consumeState(state: string): Promise<string | null> {
  const db = serviceClient();

  const { data } = await db
    .from("oauth_states")
    .delete()
    .eq("state", state)
    .select("studio_id, created_at")
    .maybeSingle();

  if (!data) return null;

  // An authorization left open for an hour is abandoned, not resumed.
  if (Date.now() - new Date(data.created_at).getTime() > 3_600_000) return null;

  return data.studio_id;
}

/** Exchange an authorization code, or a refresh token, for a fresh token set. */
export async function exchange(
  studioId: string,
  grant:
    | { type: "authorization_code"; code: string }
    | { type: "refresh_token"; refreshToken: string },
): Promise<TokenSet> {
  const db = serviceClient();

  const { data: creds, error } = await db
    .from("studio_credentials")
    .select("client_id, client_secret_enc, redirect_uri")
    .eq("studio_id", studioId)
    .single();

  if (error || !creds) {
    throw new Error(`No Momence client configured for studio ${studioId}`);
  }

  const basic = Buffer.from(
    `${creds.client_id}:${decrypt(creds.client_secret_enc)}`,
  ).toString("base64");

  const body = new URLSearchParams(
    grant.type === "authorization_code"
      ? {
          grant_type: "authorization_code",
          code: grant.code,
          redirect_uri: creds.redirect_uri ?? redirectUriFor(),
        }
      : { grant_type: "refresh_token", refresh_token: grant.refreshToken },
  );

  const res = await fetch(`${API_BASE}/api/v2/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(
      `Momence ${grant.type} exchange failed (${res.status}): ${await res.text()}`,
    );
  }

  const dto = (await res.json()) as AuthTokenDto;
  const accessToken = dto.access_token ?? dto.accessToken;
  const refreshToken = dto.refresh_token ?? dto.refreshToken ?? null;
  const expiresAt = new Date(dto.accessTokenExpiresAt ?? "");

  if (!accessToken || Number.isNaN(expiresAt.getTime())) {
    throw new Error(`Momence returned an unusable token payload for studio ${studioId}`);
  }

  await db.from("studio_tokens").upsert({
    studio_id: studioId,
    access_token_enc: encrypt(accessToken),
    // A refresh response may omit a new refresh token; keeping the old one is
    // correct, so only overwrite when one actually came back.
    ...(refreshToken && { refresh_token_enc: encrypt(refreshToken) }),
    expires_at: expiresAt.toISOString(),
    obtained_via: grant.type,
    updated_at: new Date().toISOString(),
  });

  return { accessToken, refreshToken, expiresAt };
}
