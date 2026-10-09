"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Alert } from "@/components/ui";
import { verifyChainAction } from "./actions";

export function VerifyButton() {
  const t = useTranslations("audit");
  const [state, action] = useActionState(verifyChainAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <SubmitButton variant="secondary">{t("verify")}</SubmitButton>
      <FormMessage state={state} />
      {state?.bad && <Alert kind="warning">{state.bad}</Alert>}
    </form>
  );
}
