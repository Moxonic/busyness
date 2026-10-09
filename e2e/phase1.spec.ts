import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, E2E_USERS, codeForKey, keyFromManualEntry, latestMailLink, login, logout } from "./helpers";

test("anonymous visitors are sent to login, with security headers set", async ({ page }) => {
  const res = await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  const headers = res!.headers();
  expect(headers["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-powered-by"]).toBeUndefined();
});

test("a wrong password and a wrong code are both rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-post").fill(E2E_USERS.owner.email);
  await page.getByLabel("Passord", { exact: true }).fill("not-the-right-password");
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Feil e-post eller passord.");

  await page.getByLabel("Passord", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Logg inn", exact: true }).click();
  await page.waitForURL("**/login/mfa");
  await page.getByLabel("Kode").fill("000000");
  await page.getByRole("button", { name: "Bekreft" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Feil kode. Prøv igjen.");
  // Without the second factor, nothing else is reachable.
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\/mfa$/);
});

test("owner logs in with password + authenticator and can verify the audit log", async ({ page }) => {
  await login(page, E2E_USERS.owner.email);
  await expect(page.getByRole("heading", { name: "Hei, Ola!" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Brukere" })).toBeVisible();
  await page.getByRole("link", { name: "Revisjonslogg" }).click();
  await expect(page.getByText("auth.login").first()).toBeVisible();
  await page.getByRole("button", { name: "Kontroller loggen" }).click();
  await expect(page.getByText(/Loggen er intakt: \d+ hendelser kontrollert\./)).toBeVisible();
  await logout(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("employee cannot open user administration", async ({ page }) => {
  await login(page, E2E_USERS.employee.email);
  await expect(page.getByRole("link", { name: "Brukere" })).toHaveCount(0);
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/forbidden$/);
  await page.goto("/audit");
  await expect(page).toHaveURL(/\/forbidden$/);
});

test("accountant sees company details read-only", async ({ page }) => {
  await login(page, E2E_USERS.accountant.email);
  await page.goto("/settings");
  await expect(page.getByText("Bare eieren kan endre firmaopplysningene.")).toBeVisible();
  await expect(page.getByLabel("Firmanavn")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Lagre" })).toHaveCount(0);
});

test("invite → create user → set up authenticator → recovery codes → dashboard", async ({ page }) => {
  const email = `nina-${Date.now()}@e2e.test`;
  await login(page, E2E_USERS.owner.email);
  await page.goto("/settings/users");
  const inviteForm = page.locator("form", { has: page.getByRole("button", { name: "Send invitasjon" }) });
  await inviteForm.getByLabel("E-post").fill(email);
  await inviteForm.getByRole("combobox").selectOption("employee");
  await page.getByRole("button", { name: "Send invitasjon" }).click();
  await expect(page.getByText(`Invitasjon sendt til ${email}.`)).toBeVisible();
  await logout(page);

  await page.goto(await latestMailLink(email));
  await expect(page.getByText(`Du er invitert som Ansatt med e-post ${email}.`)).toBeVisible();
  await page.getByLabel("Fullt navn").fill("Nina Ny");
  await page.getByLabel("Velg passord").fill("nina-sitt-lange-passord-7");
  await page.getByLabel("Gjenta passord").fill("nina-sitt-lange-passord-7");
  await page.getByRole("button", { name: "Opprett bruker" }).click();

  await page.waitForURL("**/setup-mfa");
  const manualKey = (await page.locator("code").textContent())!;
  await page.getByLabel("2. Skriv inn koden appen viser").fill(await codeForKey(keyFromManualEntry(manualKey), null));
  await page.getByRole("button", { name: "Aktiver" }).click();
  await expect(page.getByRole("heading", { name: "Lagre gjenopprettingskodene" })).toBeVisible();
  await expect(page.locator("ol li")).toHaveCount(10);
  await page.getByRole("link", { name: "Jeg har lagret kodene" }).click();
  await expect(page.getByRole("heading", { name: "Hei, Nina!" })).toBeVisible();

  // The invitation link is spent.
  await logout(page);
});

test("language can be switched to English", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await page.getByRole("button", { name: "Norsk" }).click();
  await expect(page.getByRole("heading", { name: "Logg inn" })).toBeVisible();
});
