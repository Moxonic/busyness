import { getTranslations } from "next-intl/server";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/dal";

const SECTIONS = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;

export default async function HelpPage() {
  await requireUser();
  const t = await getTranslations("help");
  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <div className="space-y-4">
        {SECTIONS.map((s) => (
          <Card key={s}>
            <h2 className="mb-1 font-semibold">{t(`${s}t`)}</h2>
            <p className="text-sm leading-relaxed">{t(s)}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
