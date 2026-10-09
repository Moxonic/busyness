"use server";

import { getTranslations } from "next-intl/server";
import type { FormState } from "@/components/form-bits";
import { recordEvent, verifyAuditChain } from "@/lib/audit";
import { db } from "@/db";
import { requirePermission } from "@/server/auth/dal";
import { auditContextFor } from "@/server/request";

export async function verifyChainAction(): Promise<FormState & { bad?: string }> {
  const user = await requirePermission("audit:read");
  const result = await verifyAuditChain();
  await recordEvent(db(), await auditContextFor(user), {
    action: "audit.verified",
    details: { ok: result.ok, checked: result.checked, firstBadSeq: result.firstBadSeq, headHash: result.headHash },
  });
  const t = await getTranslations("audit");
  return result.ok
    ? { success: t("verifyOk", { count: result.checked }) }
    : { bad: t("verifyBad", { seq: result.firstBadSeq ?? 0 }) };
}
