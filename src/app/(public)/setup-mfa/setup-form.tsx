"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { buttonClass, Field } from "@/components/ui";
import { confirmSetupAction } from "../actions";

export function SetupForm({ qr, manualKey }: { qr: string | null; manualKey: string | null }) {
  const t = useTranslations("setup");
  const [state, action] = useActionState(confirmSetupAction, undefined);

  if (state?.codes) {
    return <RecoveryCodes codes={state.codes} />;
  }
  if (!qr) {
    return (
      <Link href="/" className={buttonClass.primary}>
        {t("codesSaved")}
      </Link>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div>
        <p className="mb-2 text-sm font-medium">{t("step1")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated on the server */}
        <img src={qr} alt="QR" width={220} height={220} className="rounded border border-border" />
        <p className="mt-2 text-xs text-muted">{t("manual")}</p>
        <code className="mt-1 block rounded bg-background px-2 py-1 font-mono text-sm break-all">{manualKey}</code>
      </div>
      <Field
        label={t("step2")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
        className="text-center text-2xl tracking-[0.4em]"
      />
      <SubmitButton className="w-full">{t("submit")}</SubmitButton>
    </form>
  );
}

export function RecoveryCodes({ codes, doneHref = "/" }: { codes: string[]; doneHref?: string }) {
  const t = useTranslations("setup");
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("codesTitle")}</h2>
      <p className="text-sm text-muted">{t("codesIntro")}</p>
      <ol className="grid grid-cols-2 gap-2 rounded-md bg-background p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <Link href={doneHref} className={`${buttonClass.primary} w-full`}>
        {t("codesSaved")}
      </Link>
    </div>
  );
}
