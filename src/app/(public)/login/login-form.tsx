"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Field } from "@/components/ui";
import { loginAction } from "../actions";

export function LoginForm() {
  const t = useTranslations();
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field
        label={t("common.email")}
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={state?.values?.email}
        required
        autoFocus
      />
      <Field label={t("common.password")} name="password" type="password" autoComplete="current-password" required />
      <SubmitButton className="w-full">{t("login.submit")}</SubmitButton>
    </form>
  );
}
