import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";

export const E2E_PASSWORD = "e2e-long-test-password-1";
export const E2E_USERS = {
  owner: { email: "owner@e2e.test", name: "Ola Eier", role: "owner" as const },
  employee: { email: "employee@e2e.test", name: "Kari Ansatt", role: "employee" as const },
  accountant: { email: "accountant@e2e.test", name: "Rita Regnskap", role: "accountant" as const },
};

/** Code for the next unused time step (codes cannot be reused, so repeated logins may need to wait). */
export async function codeForKey(key: Uint8Array, lastStep: number | null): Promise<string> {
  let current = Math.floor(Date.now() / 30_000);
  let step = Math.max(current, (lastStep ?? -1) + 1);
  while (step > current + 1) {
    await new Promise((r) => setTimeout(r, 1000));
    current = Math.floor(Date.now() / 30_000);
    step = Math.max(current, (lastStep ?? -1) + 1);
  }
  return generateHOTP(key, BigInt(step), 6);
}

export async function totpCodeFor(email: string): Promise<string> {
  // Imported lazily so the decryption key from the environment is read at call time.
  const { decryptSecret } = await import("@/lib/crypto");
  const sql = postgres(process.env.DATABASE_MIGRATION_URL!, { max: 1 });
  const [u] = await sql`select totp_secret_enc, totp_last_step from users where email = ${email}`;
  await sql.end();
  return codeForKey(decryptSecret(u.totp_secret_enc), u.totp_last_step === null ? null : Number(u.totp_last_step));
}

export function keyFromManualEntry(manual: string): Uint8Array {
  return decodeBase32IgnorePadding(manual.replace(/\s/g, ""));
}

/** Latest email to `to` in Mailpit, returns the first link in it. */
export async function latestMailLink(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`http://localhost:8025/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const link = msg.Text.match(/https?:\/\/\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to}`);
}

export async function login(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-post").fill(email);
  await page.getByLabel("Passord", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await page.waitForURL("**/login/mfa");
  await page.getByLabel("Kode").fill(await totpCodeFor(email));
  await page.getByRole("button", { name: "Bekreft" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Logg ut" }).click();
  await page.waitForURL("**/login");
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
}
