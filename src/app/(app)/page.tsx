import Link from "next/link";
import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { requireUser } from "@/server/auth/dal";
import { getCompany } from "@/server/company/service";

export default async function DashboardPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const company = await getCompany();
  const [{ n: userCount }] = await db().execute<{ n: number }>(
    sql`select count(*)::int as n from users where status = 'active'`,
  );

  const steps = [
    { label: t("dashboard.companyInfo"), done: Boolean(company?.name && company.orgNumber), href: "/settings" },
    { label: t("dashboard.inviteUsers"), done: userCount > 1, href: "/settings/users" },
    { label: t("dashboard.backups"), done: null, href: "/help" },
  ];

  return (
    <>
      <PageHeader title={t("dashboard.welcome", { name: user.name.split(" ")[0] })} intro={t("dashboard.phase")} />
      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 font-semibold">{t("dashboard.checklist")}</h2>
          <ul className="divide-y divide-border">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center justify-between py-2 text-sm">
                <Link href={s.href} className="hover:underline">
                  {s.label}
                </Link>
                {s.done !== null && (
                  <Badge tone={s.done ? "good" : "bad"}>{s.done ? t("dashboard.done") : t("dashboard.todo")}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Alert kind="info">{t("common.reviewNote")}</Alert>
      </div>
    </>
  );
}
