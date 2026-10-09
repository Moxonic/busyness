"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import type { FormState } from "@/components/form-bits";
import { ROLES } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/dal";
import { createInvitation, revokeInvitation } from "@/server/auth/service";
import { auditContextFor } from "@/server/request";
import {
  anonymizeUser,
  changeRole,
  deactivateUser,
  reactivateUser,
  resetUserMfa,
  type AdminResult,
} from "@/server/users/service";

export async function inviteAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requirePermission("users:manage");
  const parsed = z
    .object({ email: z.email().max(200), role: z.enum(ROLES) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidInput" };
  const r = await createInvitation(await auditContextFor(user), { ...parsed.data, inviterName: user.name });
  if (!r.ok) return { error: "userExists" };
  revalidatePath("/settings/users");
  return { success: (await getTranslations("users"))("invited", { email: parsed.data.email }) };
}

const idSchema = z.uuid();

/** One action for the row buttons; `op` says which. Each operation re-checks its own rules. */
export async function userRowAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requirePermission("users:manage");
  const ctx = await auditContextFor(user);
  const op = String(form.get("op"));
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { error: "invalidInput" };

  let r: AdminResult;
  switch (op) {
    case "role": {
      const role = z.enum(ROLES).safeParse(form.get("role"));
      if (!role.success) return { error: "invalidInput" };
      r = await changeRole(ctx, id.data, role.data);
      break;
    }
    case "deactivate":
      r = await deactivateUser(ctx, id.data);
      break;
    case "reactivate":
      r = await reactivateUser(ctx, id.data);
      break;
    case "resetMfa":
      r = await resetUserMfa(ctx, id.data);
      break;
    case "anonymize":
      r = await anonymizeUser(ctx, id.data);
      break;
    case "revokeInvite":
      await revokeInvitation(ctx, id.data);
      r = { ok: true };
      break;
    default:
      return { error: "invalidInput" };
  }
  if (!r.ok) return { error: r.error };
  revalidatePath("/settings/users");
  return { success: (await getTranslations("common"))("saved") };
}
