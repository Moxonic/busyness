"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { buttonClass, Field } from "@/components/ui";
import { verifyMfaAction } from "../../actions";

export function MfaForm() {
  const t = useTranslations("mfa");
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [state, action] = useActionState(verifyMfaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="method" value={method} />
      {method === "totp" ? (
        <Field
          key="totp"
          label={t("code")}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          className="text-center text-2xl tracking-[0.4em]"
        />
      ) : (
        <Field key="recovery" label={t("recoveryLabel")} name="code" autoComplete="off" required autoFocus />
      )}
      <SubmitButton className="w-full">{t("submit")}</SubmitButton>
      <button
        type="button"
        className={buttonClass.link}
        onClick={() => setMethod(method === "totp" ? "recovery" : "totp")}
      >
        {method === "totp" ? t("useRecovery") : t("useTotp")}
      </button>
    </form>
  );
}
