"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { FormState } from "@/components/form-bits";
import { requirePermission } from "@/server/auth/dal";
import { companySchema, updateCompany } from "@/server/company/service";
import { auditContextFor } from "@/server/request";

export async function updateCompanyAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requirePermission("settings:manage");
  const raw = Object.fromEntries(form);
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success) {
    const orgIssue = parsed.error.issues.some((i) => i.message === "invalidOrgNumber");
    const values = Object.fromEntries(Object.entries(raw).filter(([k, v]) => !k.startsWith("$") && typeof v === "string"));
    return { error: orgIssue ? "invalidOrgNumber" : "invalidInput", values: values as Record<string, string> };
  }
  await updateCompany(await auditContextFor(user), parsed.data);
  revalidatePath("/settings");
  return { success: (await getTranslations("common"))("saved") };
}
