import crypto from "node:crypto";

/**
 * AES-256-GCM envelope encryption for studio credentials.
 *
 * The key lives in CREDENTIAL_ENCRYPTION_KEY (32 bytes, base64) and never
 * touches the database. A Postgres backup on its own is therefore useless
 * to an attacker — which matters a lot once you are holding staff logins
 * for studios that are not yours.
 */

/**
 * Resolved on first use, not at import.
 *
 * A module-level throw runs during `next build` page-data collection, which
 * fails the build on any machine that does not hold production secrets. The
 * key is only ever needed to serve a request, so check it when a request
 * actually asks for it — and check it in every environment, not just
 * production, so a missing key surfaces in dev rather than at deploy.
 */
let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY ?? "", "base64");

  if (raw.length !== 32) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  cachedKey = raw;
  return cachedKey;
}

/**
 * Returns the Postgres bytea hex literal, not a Buffer.
 *
 * supabase-js talks JSON over PostgREST, and a Node Buffer serialises to
 * {"type":"Buffer","data":[...]} — so a Buffer return lands in the column as
 * the text of that object and decryption fails with an auth tag error. The
 * "\\x<hex>" form is what Postgres accepts as bytea input, and is the same
 * shape PostgREST hands back on read, so encrypt and decrypt stay symmetric.
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // iv | authTag | ciphertext
  return "\\x" + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("hex");
}

export function decrypt(blob: Buffer | Uint8Array | string): string {
  const buf =
    typeof blob === "string"
      ? Buffer.from(blob.replace(/^\\x/, ""), "hex") // Postgres bytea hex form
      : Buffer.from(blob);

  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/**
 * Verify an incoming Momence webhook signature.
 *
 * NOTE: the public docs say to check the payload signature against the
 * `x-webhook-signature` header but do not publish the exact construction.
 * This implements HMAC-SHA256 over the raw payload string, compared in
 * constant time, and accepts either hex or base64 encoding. Confirm the
 * scheme with Momence support before going live, and keep
 * WEBHOOK_VERIFICATION_STRICT=true so unverified events are rejected
 * rather than silently trusted.
 */
export function verifyWebhookSignature(
  rawPayload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawPayload, "utf8").digest();
  const candidates = [Buffer.from(signature, "hex"), Buffer.from(signature, "base64")];

  return candidates.some(
    (c) => c.length === expected.length && crypto.timingSafeEqual(c, expected),
  );
}
