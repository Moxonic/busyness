import { getTranslations } from "next-intl/server";
import { buttonClass, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/dal";
import { countUnusedRecoveryCodes } from "@/server/auth/service";
import { PasswordForm, RecoveryForm } from "./account-forms";

export default async function AccountPage() {
  const user = await requireUser();
  const t = await getTranslations();
  const unused = await countUnusedRecoveryCodes(user.id);
  return (
    <>
      <PageHeader title={t("account.title")} intro={`${user.name} · ${user.email} · ${t(`roles.${user.role}`)}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">
            {user.hasPassword ? t("account.changePassword") : t("account.setPassword")}
          </h2>
          <PasswordForm hasPassword={user.hasPassword} email={user.email} />
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">{t("account.recovery")}</h2>
          <p className="mb-3 text-sm text-muted">{t("account.recoveryIntro", { count: unused })}</p>
          <RecoveryForm />
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">{t("account.google")}</h2>
          <p className="text-sm text-muted">
            {user.googleLinked ? t("account.googleLinked") : t("account.googleNotLinked")}
          </p>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">{t("account.myData")}</h2>
          <p className="mb-3 text-sm text-muted">{t("account.myDataIntro")}</p>
          <a href="/api/account/export" className={buttonClass.secondary}>
            {t("account.download")}
          </a>
        </Card>
      </div>
    </>
  );
}
