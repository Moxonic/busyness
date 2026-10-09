import { generateHOTP } from "@oslojs/otp";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, randomToken } from "@/lib/crypto";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/password";
import { can } from "@/lib/permissions";
import { generateRecoveryCodes, hashRecoveryCode, matchTotpStep, newTotpKey } from "@/lib/totp";
import { isValidOrgNumber } from "@/server/company/service";

describe("secret encryption", () => {
  it("round-trips and detects tampering", () => {
    const secret = new Uint8Array([1, 2, 3, 4, 5]);
    const enc = encryptSecret(secret);
    expect(Array.from(decryptSecret(enc))).toEqual([1, 2, 3, 4, 5]);
    const parts = enc.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 0xff;
    parts[3] = ct.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("uses a fresh IV each time", () => {
    const s = new Uint8Array([9]);
    expect(encryptSecret(s)).not.toBe(encryptSecret(s));
  });

  it("generates 160-bit tokens", () => {
    expect(randomToken()).toMatch(/^[a-z2-7]{32}$/);
  });
});

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("a-long-enough-password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "a-long-enough-password")).toBe(true);
    expect(await verifyPassword(hash, "wrong-password-here")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
  });

  it("enforces the policy", async () => {
    expect(await checkPasswordPolicy("short")).toBe("tooShort");
    expect(await checkPasswordPolicy("x".repeat(129))).toBe("tooLong");
    expect(await checkPasswordPolicy("kari.nordmann-secret", "kari.nordmann@firma.no")).toBe("containsEmail");
    expect(await checkPasswordPolicy("a-long-enough-password")).toBeNull();
  });
});

describe("TOTP", () => {
  const key = newTotpKey();
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  const code = (s: number) => generateHOTP(key, BigInt(s), 6);

  it("accepts the current step and one step of drift", () => {
    expect(matchTotpStep(key, code(step), null, now)).toBe(step);
    expect(matchTotpStep(key, code(step - 1), null, now)).toBe(step - 1);
    expect(matchTotpStep(key, code(step + 1), null, now)).toBe(step + 1);
    expect(matchTotpStep(key, code(step - 2), null, now)).toBeNull();
  });

  it("rejects replayed and malformed codes", () => {
    expect(matchTotpStep(key, code(step), step, now)).toBeNull();
    expect(matchTotpStep(key, "12345", null, now)).toBeNull();
    expect(matchTotpStep(key, "abcdef", null, now)).toBeNull();
  });

  it("makes ten distinct recovery codes, normalised for typing", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0].toUpperCase().replace("-", " "))).toBe(hashRecoveryCode(codes[0]));
  });
});

describe("permissions", () => {
  it("matches the agreed role matrix", () => {
    expect(can("owner", "users:manage")).toBe(true);
    expect(can("employee", "users:manage")).toBe(false);
    expect(can("employee", "data:write")).toBe(true);
    expect(can("accountant", "data:write")).toBe(false);
    expect(can("accountant", "audit:read")).toBe(true);
    for (const r of ["owner", "employee", "accountant"] as const) expect(can(r, "export:download")).toBe(true);
  });
});

describe("organisation number", () => {
  it("validates MOD11", () => {
    expect(isValidOrgNumber("974760673")).toBe(true); // Brønnøysundregistrene
    expect(isValidOrgNumber("974 760 673")).toBe(true);
    expect(isValidOrgNumber("974760674")).toBe(false);
    expect(isValidOrgNumber("12345")).toBe(false);
  });
});
