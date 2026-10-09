"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Field } from "@/components/ui";
import { RecoveryCodes } from "@/app/(public)/setup-mfa/setup-form";
import { changePasswordAction, regenerateCodesAction } from "./actions";

export function PasswordForm({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const t = useTranslations();
  const [state, action] = useActionState(changePasswordAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      {hasPassword && (
        <Field label={t("account.current")} name="current" type="password" autoComplete="current-password" required />
      )}
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
      <SubmitButton>{t("common.save")}</SubmitButton>
    </form>
  );
}

export function RecoveryForm() {
  const t = useTranslations("account");
  const [state, action] = useActionState(regenerateCodesAction, undefined);
  if (state?.codes) return <RecoveryCodes codes={state.codes} doneHref="/account" />;
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <Field
        label={t("totpCode")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
      />
      <SubmitButton variant="secondary">{t("regenerate")}</SubmitButton>
    </form>
  );
}
