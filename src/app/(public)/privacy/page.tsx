import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
      <div className="space-y-3 text-sm leading-relaxed">
        <p>{t("p1")}</p>
        <p>{t("p2")}</p>
        <p>{t("p3")}</p>
        <p>{t("p4")}</p>
      </div>
    </Card>
  );
}
