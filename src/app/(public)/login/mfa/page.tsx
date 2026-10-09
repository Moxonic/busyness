import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui";
import { requirePendingAuth } from "@/server/auth/dal";
import { cancelLoginAction } from "../../actions";
import { MfaForm } from "./mfa-form";

export default async function MfaPage() {
  const { user } = await requirePendingAuth();
  if (!user.totpEnabledAt) redirect("/setup-mfa");
  const t = await getTranslations("mfa");
  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">{t("title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("intro")}</p>
      <MfaForm />
      <form action={cancelLoginAction} className="mt-4">
        <button className="text-sm text-muted hover:underline">{t("cancel")}</button>
      </form>
    </Card>
  );
}
