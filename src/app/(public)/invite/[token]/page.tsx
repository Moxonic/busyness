import { getTranslations } from "next-intl/server";
import { Alert, buttonClass, Card } from "@/components/ui";
import { googleLoginEnabled } from "@/env";
import { getValidInvitation } from "@/server/auth/service";
import { InviteForm } from "./invite-form";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const t = await getTranslations();
  const invite = await getValidInvitation(token);

  if (!invite) {
    return (
      <Card>
        <Alert kind="error">{t("invite.invalid")}</Alert>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">{t("invite.title")}</h1>
      <p className="mb-4 text-sm text-muted">
        {t("invite.intro", { role: t(`roles.${invite.role}`), email: invite.email })}
      </p>
      <InviteForm token={token} email={invite.email} />
      {googleLoginEnabled() && (
        <>
          <div className="my-4 text-center text-xs uppercase text-muted">{t("common.or")}</div>
          <a href={`/api/auth/google?invite=${encodeURIComponent(token)}`} className={`${buttonClass.secondary} w-full`}>
            {t("invite.google")}
          </a>
        </>
      )}
    </Card>
  );
}
