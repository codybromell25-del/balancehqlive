import { serviceClient } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

const API_BASE = process.env.MOMENCE_API_BASE ?? "https://api.momence.com";

/**
 * Momence access tokens expire after a few hours even while in use, so every
 * request path has to be able to refresh. In a serverless runtime there is no
 * long-lived process to hold the token, so it is cached in Postgres and shared
 * across invocations.
 */

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
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

    const fresh = await MomenceClient.authenticate(studioId);
    return new MomenceClient(
      studioId,
      studio.momence_host_id,
      fresh.accessToken,
      fresh.expiresAt,
    );
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
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);

    await db.from("studio_tokens").upsert({
      studio_id: studioId,
      access_token_enc: encrypt(token.access_token),
      refresh_token_enc: token.refresh_token ? encrypt(token.refresh_token) : null,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    });

    return { accessToken: token.access_token, expiresAt };
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

    const send = () =>
      fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

    let res = await send();

    // One retry on 401: the token may have been invalidated server-side
    // before its nominal expiry.
    if (res.status === 401) {
      const fresh = await MomenceClient.authenticate(this.studioId);
      this.accessToken = fresh.accessToken;
      this.expiresAt = fresh.expiresAt;
      res = await send();
    }

    if (!res.ok) {
      throw new MomenceError(
        `Momence ${init.method ?? "GET"} ${path} failed`,
        res.status,
        await res.text(),
      );
    }

    return (await res.json()) as T;
  }
}
