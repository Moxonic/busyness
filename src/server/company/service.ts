import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { company, settings } from "@/db/schema";
import { withAudit, type AuditContext } from "@/lib/audit";

/** Norwegian organisation numbers are 9 digits with a MOD11 check digit. */
export function isValidOrgNumber(value: string): boolean {
  const digits = value.replace(/\s/g, "");
  if (!/^\d{9}$/.test(digits)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  return check !== 10 && check === Number(digits[8]);
}

export const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  orgNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => v === "" || isValidOrgNumber(v), "invalidOrgNumber"),
  legalForm: z.enum(["ENK", "AS", ""]).transform((v) => (v === "" ? null : v)),
  addressLine: z.string().trim().max(200),
  postalCode: z.string().trim().max(10),
  city: z.string().trim().max(100),
  email: z.union([z.literal(""), z.email().max(200)]),
  phone: z.string().trim().max(30),
});
export type CompanyInput = z.input<typeof companySchema>;

export async function getCompany() {
  return db().query.company.findFirst({ where: eq(company.id, 1) });
}

export async function updateCompany(ctx: AuditContext, input: z.output<typeof companySchema>) {
  await withAudit(ctx, (tx) =>
    tx
      .update(company)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(company.id, 1)),
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db().query.settings.findFirst({ where: eq(settings.key, key) });
  return row ? (row.value as T) : fallback;
}
