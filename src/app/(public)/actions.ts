"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { FormState } from "@/components/form-bits";
import { LOCALE_COOKIE, toLocale } from "@/i18n/request";
import { deleteSessionCookie, setSessionCookie } from "@/server/auth/cookies";
import { getAuth } from "@/server/auth/dal";
import {
  acceptInvitationWithPassword,
  confirmTotpEnrollment,
  requestPasswordReset,
  resetPassword,
  verifySecondFactor,
} from "@/server/auth/service";
import { loginWithPassword } from "@/server/auth/service";
import { invalidateSession } from "@/server/auth/session";
import { requestMeta } from "@/server/request";
import { auditContextFor } from "@/server/request";
import { setLocale } from "@/server/users/service";

const str = (max = 200) => z.string().max(max);

async function rememberLocale(locale: string) {
  (await cookies()).set(LOCALE_COOKIE, toLocale(locale), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: 365 * 24 * 3600,
  });
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email: str(), password: str() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput" };
  const r = await loginWithPassword(parsed.data.email, parsed.data.password, await requestMeta());
  if (!r.ok) return { error: r.error, retryAfterSec: r.retryAfterSec, values: { email: parsed.data.email } };
  await setSessionCookie(r.session.token, r.session.expiresAt);
  redirect(r.next === "mfa" ? "/login/mfa" : "/setup-mfa");
}

export async function verifyMfaAction(_: FormState, form: FormData): Promise<FormState> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const parsed = z.object({ code: str(40), method: z.enum(["totp", "recovery"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput" };
  const r = await verifySecondFactor(auth.session.id, auth.user.id, parsed.data.code, parsed.data.method, await requestMeta());
  if (!r.ok) return { error: r.error, retryAfterSec: r.retryAfterSec };
  await setSessionCookie(r.session.token, r.session.expiresAt);
  await rememberLocale(auth.user.locale);
  redirect("/");
}

export type SetupState = { error?: string; retryAfterSec?: number; codes?: string[] } | undefined;

export async function confirmSetupAction(_: SetupState, form: FormData): Promise<SetupState> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const code = String(form.get("code") ?? "").slice(0, 20);
  const r = await confirmTotpEnrollment(auth.session.id, auth.user.id, code, await requestMeta());
  if (!r.ok) return { error: r.error, retryAfterSec: r.retryAfterSec };
  await setSessionCookie(r.session.token, r.session.expiresAt);
  await rememberLocale(auth.user.locale);
  return { codes: r.recoveryCodes };
}

export async function cancelLoginAction(): Promise<void> {
  const auth = await getAuth();
  if (auth) await invalidateSession(auth.session.id);
  await deleteSessionCookie();
  redirect("/login");
}

export async function acceptInviteAction(token: string, _: FormState, form: FormData): Promise<FormState> {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(100), password: str(), confirm: str() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput", values: { name: String(form.get("name") ?? "") } };
  const values = { name: parsed.data.name };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch", values };
  const r = await acceptInvitationWithPassword(
    token,
    { name: parsed.data.name, password: parsed.data.password },
    await requestMeta(),
  );
  if (!r.ok) return { error: r.error, retryAfterSec: r.retryAfterSec, values };
  await setSessionCookie(r.session.token, r.session.expiresAt);
  redirect("/setup-mfa");
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ email: z.string().trim().max(200) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput" };
  const r = await requestPasswordReset(parsed.data.email, await requestMeta());
  if (!r.ok) return { error: r.error, retryAfterSec: r.retryAfterSec };
  const t = await getTranslations("forgot");
  return { success: t("sent") };
}

export async function resetPasswordAction(token: string, _: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({ password: str(), confirm: str() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const r = await resetPassword(token, parsed.data.password, await requestMeta());
  if (!r.ok) return { error: r.error };
  const t = await getTranslations("reset");
  return { success: t("done") };
}

/** Language switch. Logged-in users also get it saved on their profile. */
export async function setLocaleAction(form: FormData): Promise<void> {
  const locale = toLocale(String(form.get("locale")));
  await rememberLocale(locale);
  const auth = await getAuth();
  if (auth?.session.mfaVerifiedAt && auth.user.locale !== locale) {
    await setLocale(await auditContextFor(auth.user), auth.user.id, locale);
  }
}
