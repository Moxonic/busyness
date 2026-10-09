import { randomBytes } from "node:crypto";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { createTOTPKeyURI, generateHOTP } from "@oslojs/otp";
import { safeEqual, sha256Hex } from "./crypto";

export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

export function newTotpKey(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

export function totpUri(issuer: string, account: string, key: Uint8Array): string {
  return createTOTPKeyURI(issuer, account, key, TOTP_PERIOD, TOTP_DIGITS);
}

/** Secret in the format authenticator apps accept for manual entry. */
export function totpManualKey(key: Uint8Array): string {
  return encodeBase32UpperCaseNoPadding(key).replace(/(.{4})/g, "$1 ").trim();
}

/**
 * Returns the time step the code belongs to, or null. Accepts one step of clock drift either
 * way. Steps at or before `lastStep` are rejected, so an observed code cannot be replayed.
 */
export function matchTotpStep(
  key: Uint8Array,
  code: string,
  lastStep: number | null,
  nowMs: number = Date.now(),
): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = Math.floor(nowMs / 1000 / TOTP_PERIOD);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (safeEqual(generateHOTP(key, BigInt(step), TOTP_DIGITS), normalized)) return step;
  }
  return null;
}

// Recovery codes: 10 single-use codes like "k7mq2-x9fda" (50 bits each).
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o, 1/l confusion

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(normalizeRecoveryCode(code));
}
