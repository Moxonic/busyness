import { createHash, randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { env } from "@/env";

// OWASP recommended argon2id baseline: m=19 MiB, t=2, p=1.
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ ...PARAMS, password, salt: randomBytes(16), outputType: "encoded" });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Verifies against a throwaway hash so "unknown email" takes as long as "wrong password". */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(await dummyHash, password);
}

export type PasswordProblem = "tooShort" | "tooLong" | "containsEmail" | "breached";

export async function checkPasswordPolicy(password: string, email?: string): Promise<PasswordProblem | null> {
  if (password.length < PASSWORD_MIN) return "tooShort";
  if (password.length > PASSWORD_MAX) return "tooLong";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return "containsEmail";
  if (env().HIBP_ENABLED && (await isBreached(password))) return "breached";
  return null;
}

/**
 * HaveIBeenPwned range API (k-anonymity): only the first 5 hex chars of the SHA-1 leave the server.
 * If the service is unreachable we allow the password rather than locking people out.
 */
async function isBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "busyness-app" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch (err) {
    console.warn("HIBP check failed, allowing password:", (err as Error).message);
    return false;
  }
}
