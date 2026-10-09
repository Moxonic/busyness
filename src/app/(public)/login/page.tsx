import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Alert, buttonClass, Card } from "@/components/ui";
import { googleLoginEnabled } from "@/env";
import { getAuth } from "@/server/auth/dal";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const auth = await getAuth();
  if (auth?.session.mfaVerifiedAt) redirect("/");
  const t = await getTranslations();
  const { error } = await searchParams;
  const errorKey = typeof error === "string" && t.has(`errors.${error}`) ? error : null;

  return (
    <Card>
      <h1 className="mb-4 text-xl font-semibold">{t("login.title")}</h1>
      <div className="space-y-4">
        {errorKey && <Alert kind="error">{t(`errors.${errorKey}`, { minutes: 15 })}</Alert>}
        <LoginForm />
        {googleLoginEnabled() && (
          <>
            <div className="text-center text-xs uppercase text-muted">{t("common.or")}</div>
            {/* A plain link (GET), so the redirect to Google is not a form submission. */}
            <a href="/api/auth/google" className={`${buttonClass.secondary} w-full`}>
              {t("login.google")}
            </a>
          </>
        )}
        <div className="flex justify-between text-sm">
          <Link href="/forgot-password" className={buttonClass.link}>
            {t("login.forgot")}
          </Link>
        </div>
        <p className="text-xs text-muted">{t("login.noSignup")}</p>
      </div>
    </Card>
  );
}
