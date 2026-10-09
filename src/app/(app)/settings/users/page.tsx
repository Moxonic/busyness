import { and, asc, gt, isNull } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge, Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { invitations, users } from "@/db/schema";
import { requirePermission } from "@/server/auth/dal";
import { InviteForm, UserRowControls } from "./user-forms";

export default async function UsersPage() {
  const me = await requirePermission("users:manage");
  const t = await getTranslations();
  const format = await getFormatter();
  const [allUsers, pending] = await Promise.all([
    db().select().from(users).orderBy(asc(users.status), asc(users.name)),
    db()
      .select()
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(asc(invitations.createdAt)),
  ]);

  return (
    <>
      <PageHeader title={t("users.title")} />
      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 font-semibold">{t("users.invite")}</h2>
          <InviteForm />
        </Card>

        <Card className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted">
              <tr>
                <th className="py-2 pr-3">{t("common.name")}</th>
                <th className="py-2 pr-3">{t("common.role")}</th>
                <th className="py-2 pr-3">{t("common.status")}</th>
                <th className="py-2 pr-3">{t("users.twoFactor")}</th>
                <th className="py-2">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allUsers.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium">
                      {u.name} {u.id === me.id && <span className="text-muted">({t("users.you")})</span>}
                    </div>
                    <div className="text-xs text-muted">{u.email}</div>
                  </td>
                  <td className="py-3 pr-3">{t(`roles.${u.role}`)}</td>
                  <td className="py-3 pr-3">
                    <Badge tone={u.status === "active" ? "good" : "neutral"}>{t(`statuses.${u.status}`)}</Badge>
                  </td>
                  <td className="py-3 pr-3">
                    <Badge tone={u.totpEnabledAt ? "good" : "bad"}>
                      {u.totpEnabledAt ? t("users.on") : t("users.off")}
                    </Badge>
                  </td>
                  <td className="py-3">
                    {u.id !== me.id && u.status !== "anonymized" && (
                      <UserRowControls id={u.id} role={u.role} status={u.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t("users.pending")}</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-muted">{t("users.none")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {pending.map((inv) => (
                <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {inv.email} · {t(`roles.${inv.role}`)} · {t("users.expires")}{" "}
                    {format.dateTime(inv.expiresAt, { dateStyle: "medium" })}
                  </span>
                  <UserRowControls id={inv.id} invite />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
