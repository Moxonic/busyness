import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";
import { env } from "@/env";

/** Unguessable token for cookies and links (default 160 bits). */
export function randomToken(bytes = 20): string {
  return encodeBase32LowerCaseNoPadding(randomBytes(bytes));
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Format: v1.<iv>.<tag>.<ciphertext>, all base64url. The version prefix allows key rotation later.
export function encryptSecret(plaintext: Uint8Array, key = env().ENCRYPTION_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), ct].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(payload: string, key = env().ENCRYPTION_KEY): Uint8Array {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported secret format");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]));
}
