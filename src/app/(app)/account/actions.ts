"use server";

import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { FormState } from "@/components/form-bits";
import { requireUser } from "@/server/auth/dal";
import { changePassword, regenerateRecoveryCodes } from "@/server/auth/service";
import { requestMeta } from "@/server/request";

export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ current: z.string().max(200).default(""), password: z.string().max(200), confirm: z.string().max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput" };
  if (parsed.data.password !== parsed.data.confirm) return { error: "mismatch" };
  const r = await changePassword(user, user.sessionId, parsed.data.current, parsed.data.password, await requestMeta());
  if (!r.ok) return { error: r.error };
  return { success: (await getTranslations("account"))("changed") };
}

export type CodesState = { error?: string; retryAfterSec?: number; codes?: string[] } | undefined;

export async function regenerateCodesAction(_: CodesState, form: FormData): Promise<CodesState> {
  const user = await requireUser();
  const code = String(form.get("code") ?? "").slice(0, 20);
  const r = await regenerateRecoveryCodes(user, code, await requestMeta());
  if (!r.ok) return { error: r.error, retryAfterSec: r.retryAfterSec };
  return { codes: r.codes };
}
