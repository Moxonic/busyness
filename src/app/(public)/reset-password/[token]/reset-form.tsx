"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { buttonClass, Field } from "@/components/ui";
import { resetPasswordAction } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations();
  const [state, action] = useActionState(resetPasswordAction.bind(null, token), undefined);
  if (state?.success) {
    return (
      <div className="space-y-4">
        <FormMessage state={state} />
        <Link href="/login" className={buttonClass.primary}>
          {t("login.title")}
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field
        label={t("account.new")}
        hint={t("invite.passwordHint")}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <Field label={t("invite.confirm")} name="confirm" type="password" autoComplete="new-password" required />
      <SubmitButton className="w-full">{t("reset.submit")}</SubmitButton>
    </form>
  );
}
