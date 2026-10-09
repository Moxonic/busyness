"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Field } from "@/components/ui";
import { acceptInviteAction } from "../../actions";

export function InviteForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("invite");
  const [state, action] = useActionState(acceptInviteAction.bind(null, token), undefined);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      {/* Lets password managers save the right username. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field label={t("name")} name="name" autoComplete="name" defaultValue={state?.values?.name} required maxLength={100} />
      <Field
        label={t("password")}
        hint={t("passwordHint")}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
      />
      <Field label={t("confirm")} name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      <SubmitButton className="w-full">{t("submit")}</SubmitButton>
    </form>
  );
}
