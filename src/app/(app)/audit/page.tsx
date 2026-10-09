import Link from "next/link";
import { and, desc, ilike, lt, type SQL } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { requirePermission } from "@/server/auth/dal";
import { VerifyButton } from "./verify-button";

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePermission("audit:read");
  const t = await getTranslations("audit");
  const format = await getFormatter();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 50) : "";
  const before = typeof sp.before === "string" && /^\d+$/.test(sp.before) ? Number(sp.before) : null;

  const conditions: SQL[] = [];
  if (q) conditions.push(ilike(auditLog.action, `%${q.replace(/[%_\\]/g, "\\$&")}%`));
  if (before) conditions.push(lt(auditLog.seq, before));
  const rows = await db()
    .select()
    .from(auditLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.seq))
    .limit(PAGE_SIZE + 1);
  const hasMore = rows.length > PAGE_SIZE;
  const shown = rows.slice(0, PAGE_SIZE);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(q ? { q } : {}), ...extra }).toString();

  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} action={<VerifyButton />} />
      <form className="mb-4 flex gap-2" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder={t("filterAction")}
          aria-label={t("filterAction")}
          className="w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <button className={buttonClass.secondary}>{t("filter")}</button>
      </form>
      <Card className="overflow-x-auto p-0">
        {shown.length === 0 ? (
          <p className="p-5 text-sm text-muted">{t("empty")}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">{t("when")}</th>
                <th className="px-4 py-2">{t("who")}</th>
                <th className="px-4 py-2">{t("what")}</th>
                <th className="px-4 py-2">{t("object")}</th>
                <th className="px-4 py-2">{t("details")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.seq} className="align-top">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{r.seq}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {format.dateTime(r.occurredAt, { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td className="px-4 py-2">
                    {r.actorLabel}
                    {r.ip && <div className="text-xs text-muted">{r.ip}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-4 py-2 text-xs">
                    {r.entityType}
                    {r.entityId && <div className="font-mono text-muted">{r.entityId.slice(0, 13)}</div>}
                  </td>
                  <td className="px-4 py-2">
                    {(r.before !== null || r.after !== null) && (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand">{t("details")}</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto rounded bg-background p-2 text-xs">
                          {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                        </pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <nav className="mt-4 flex justify-between text-sm">
        {before ? (
          <Link href={`/audit?${qs({})}`} className={buttonClass.link}>
            {t("newer")}
          </Link>
        ) : (
          <span />
        )}
        {hasMore && (
          <Link href={`/audit?${qs({ before: String(shown[shown.length - 1].seq) })}`} className={buttonClass.link}>
            {t("older")}
          </Link>
        )}
      </nav>
    </>
  );
}
