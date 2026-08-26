import { serviceClient } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { exchange } from "./oauth";

const API_BASE = process.env.MOMENCE_API_BASE ?? "https://api.momence.com";

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1_000;

/** Worth waiting out: upstream wobble or rate limiting, not a bad request. */
function isTransient(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Momence access tokens expire after a few hours even while in use, so every
 * request path has to be able to refresh. In a serverless runtime there is no
 * long-lived process to hold the token, so it is cached in Postgres and shared
 * across invocations.
 */

/**
 * Shape per AuthTokenDto in the v2 OpenAPI schema. Note there is no
 * `expires_in`: the API returns an absolute `accessTokenExpiresAt` instead.
 * Both camelCase and snake_case spellings are returned for the tokens
 * themselves, and both are declared required.
 */
interface TokenResponse {
  accessToken: string;
  access_token: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refresh_token: string;
  refreshTokenExpiresAt: string;
}

/**
 * Raised when a studio has no refresh token and no staff credentials, so
 * there is no way to reach the API without an owner completing the
 * authorization flow in a browser.
 */
export class NeedsAuthorizationError extends Error {
  constructor(readonly studioId: string) {
    super(
      `Studio ${studioId} is not connected to Momence. Start the authorization ` +
        `flow at /api/momence/authorize?studio=<slug>.`,
    );
    this.name = "NeedsAuthorizationError";
  }
}

export class MomenceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "MomenceError";
  }
}

export class MomenceClient {
  private constructor(
    private readonly studioId: string,
    readonly hostId: number,
    private accessToken: string,
    private expiresAt: Date,
  ) {}

  static async forStudio(studioId: string): Promise<MomenceClient> {
    const db = serviceClient();

    const { data: studio, error: studioError } = await db
      .from("studios")
      .select("momence_host_id")
      .eq("id", studioId)
      .single();

    if (studioError || !studio) {
      throw new Error(`Studio ${studioId} not found`);
    }

    const { data: token } = await db
      .from("studio_tokens")
      .select("access_token_enc, expires_at")
      .eq("studio_id", studioId)
      .maybeSingle();

    // Refresh a minute early rather than racing the expiry.
    const stillValid =
      token && new Date(token.expires_at).getTime() - Date.now() > 60_000;

    if (stillValid) {
      return new MomenceClient(
        studioId,
        studio.momence_host_id,
        decrypt(token.access_token_enc),
        new Date(token.expires_at),
      );
    }

    const fresh = await MomenceClient.renew(studioId);
    return new MomenceClient(
      studioId,
      studio.momence_host_id,
      fresh.accessToken,
      fresh.expiresAt,
    );
  }

  /**
   * Obtain a usable access token with no human present.
   *
   * The refresh token is the normal path: Momence enforces 2FA on host
   * accounts, so the password grant cannot be completed unattended. It is
   * kept as a fallback only for studios onboarded with staff credentials on
   * an account without 2FA.
   */
  private static async renew(studioId: string) {
    const db = serviceClient();

    const { data: token } = await db
      .from("studio_tokens")
      .select("refresh_token_enc")
      .eq("studio_id", studioId)
      .maybeSingle();

    if (token?.refresh_token_enc) {
      return exchange(studioId, {
        type: "refresh_token",
        refreshToken: decrypt(token.refresh_token_enc),
      });
    }

    const { data: creds } = await db
      .from("studio_credentials")
      .select("staff_username")
      .eq("studio_id", studioId)
      .maybeSingle();

    if (!creds?.staff_username) {
      throw new NeedsAuthorizationError(studioId);
    }

    return MomenceClient.authenticate(studioId);
  }

  private static async authenticate(studioId: string) {
    const db = serviceClient();

    const { data: creds, error } = await db
      .from("studio_credentials")
      .select("client_id, client_secret_enc, staff_username, staff_password_enc")
      .eq("studio_id", studioId)
      .single();

    if (error || !creds) {
      throw new Error(`No Momence credentials configured for studio ${studioId}`);
    }

    const basic = Buffer.from(
      `${creds.client_id}:${decrypt(creds.client_secret_enc)}`,
    ).toString("base64");

    const res = await fetch(`${API_BASE}/api/v2/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: creds.staff_username,
        password: decrypt(creds.staff_password_enc),
      }),
    });

    if (!res.ok) {
      throw new MomenceError(
        `Momence authentication failed for studio ${studioId}`,
        res.status,
        await res.text(),
      );
    }

    const token = (await res.json()) as TokenResponse;
    const accessToken = token.access_token ?? token.accessToken;
    const expiresAt = new Date(token.accessTokenExpiresAt);

    if (!accessToken || Number.isNaN(expiresAt.getTime())) {
      throw new MomenceError(
        `Momence returned an unusable token payload for studio ${studioId}`,
        res.status,
        token,
      );
    }

    await db.from("studio_tokens").upsert({
      studio_id: studioId,
      access_token_enc: encrypt(accessToken),
      refresh_token_enc: (token.refresh_token ?? token.refreshToken)
        ? encrypt(token.refresh_token ?? token.refreshToken)
        : null,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });

    return { accessToken, expiresAt };
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

    /**
     * A dropped connection is thrown, not returned as a status, so the
     * status-based retry below never sees it. A long backfill holds the
     * connection open for minutes at a time and ECONNRESET is routine;
     * losing an hour of work to one is not acceptable.
     */
    const send = async (): Promise<Response> => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          return await fetch(url, {
            ...init,
            headers: {
              "Content-Type": "application/json",
              ...init.headers,
              Authorization: `Bearer ${this.accessToken}`,
            },
          });
        } catch (err) {
          lastError = err;
          if (attempt === MAX_RETRIES) break;
          await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * 2 ** attempt));
        }
      }
      throw lastError;
    };

    let res = await send();

    // One retry on 401: the token may have been invalidated server-side
    // before its nominal expiry.
    if (res.status === 401) {
      const fresh = await MomenceClient.renew(this.studioId);
      this.accessToken = fresh.accessToken;
      this.expiresAt = fresh.expiresAt;
      res = await send();
    }

    // Momence returns transient 502s under load, and 429 when a limit is hit.
    // Both are worth waiting out rather than failing: a long backfill makes
    // thousands of calls, and one blip should not discard the run.
    for (let attempt = 0; attempt < MAX_RETRIES && isTransient(res.status); attempt++) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BASE_BACKOFF_MS * 2 ** attempt;

      await new Promise((r) => setTimeout(r, waitMs));
      res = await send();
    }

    if (!res.ok) {
      throw new MomenceError(
        `Momence ${init.method ?? "GET"} ${path} failed`,
        res.status,
        // Error bodies can be a full HTML page. Keep enough to diagnose
        // without dumping 70KB of base64 fonts into a log.
        (await res.text()).slice(0, 500),
      );
    }

    return (await res.json()) as T;
  }
}
