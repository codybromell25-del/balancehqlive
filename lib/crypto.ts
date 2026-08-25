import crypto from "node:crypto";

/**
 * AES-256-GCM envelope encryption for studio credentials.
 *
 * The key lives in CREDENTIAL_ENCRYPTION_KEY (32 bytes, base64) and never
 * touches the database. A Postgres backup on its own is therefore useless
 * to an attacker — which matters a lot once you are holding staff logins
 * for studios that are not yours.
 */

const KEY = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY ?? "", "base64");

if (KEY.length !== 32 && process.env.NODE_ENV === "production") {
  throw new Error(
    "CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, base64 encoded. " +
      "Generate one with: openssl rand -base64 32",
  );
}

export function encrypt(plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  // iv | authTag | ciphertext
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(blob: Buffer | Uint8Array | string): string {
  const buf =
    typeof blob === "string"
      ? Buffer.from(blob.replace(/^\\x/, ""), "hex") // Postgres bytea hex form
      : Buffer.from(blob);

  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
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
