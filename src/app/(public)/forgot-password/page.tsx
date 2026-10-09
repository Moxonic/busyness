"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { buttonClass, Card, Field } from "@/components/ui";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [state, action] = useActionState(forgotPasswordAction, undefined);
  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">{t("forgot.title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("forgot.intro")}</p>
      <form action={action} className="space-y-4">
        <FormMessage state={state} />
        {!state?.success && (
          <>
            <Field label={t("common.email")} name="email" type="email" autoComplete="email" required autoFocus />
            <SubmitButton className="w-full">{t("forgot.submit")}</SubmitButton>
          </>
        )}
      </form>
      <Link href="/login" className={`${buttonClass.link} mt-4 inline-block`}>
        {t("common.back")}
      </Link>
    </Card>
  );
}
