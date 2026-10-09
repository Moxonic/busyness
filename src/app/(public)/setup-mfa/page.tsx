import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import { Card } from "@/components/ui";
import { getAuth } from "@/server/auth/dal";
import { startTotpEnrollment } from "@/server/auth/service";
import { getCompany } from "@/server/company/service";
import { SetupForm } from "./setup-form";

export default async function SetupMfaPage() {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  const { user, session } = auth;
  if (user.totpEnabledAt && !session.mfaVerifiedAt) redirect("/login/mfa");
  const t = await getTranslations("setup");

  // Already enrolled and verified: the form shows the recovery codes it just received, or a link onwards.
  let qr: string | null = null;
  let manualKey: string | null = null;
  if (!user.totpEnabledAt) {
    const company = await getCompany();
    const issuer = company?.name ? `Busyness (${company.name})` : "Busyness";
    const started = await startTotpEnrollment(user.id, issuer);
    if (started.ok) {
      qr = await QRCode.toDataURL(started.uri, { margin: 1, width: 220 });
      manualKey = started.manualKey;
    }
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">{t("title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("intro")}</p>
      <SetupForm qr={qr} manualKey={manualKey} />
    </Card>
  );
}
