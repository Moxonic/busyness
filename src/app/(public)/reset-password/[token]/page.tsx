import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { ResetForm } from "./reset-form";

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  const t = await getTranslations("reset");
  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
      <ResetForm token={token} />
    </Card>
  );
}
