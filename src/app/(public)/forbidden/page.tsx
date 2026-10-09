import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClass, Card } from "@/components/ui";

export default async function ForbiddenPage() {
  const t = await getTranslations();
  return (
    <Card>
      <h1 className="mb-2 text-xl font-semibold">{t("forbidden.title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("forbidden.body")}</p>
      <Link href="/" className={buttonClass.secondary}>
        {t("nav.dashboard")}
      </Link>
    </Card>
  );
}
