"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Alert, Field, Select } from "@/components/ui";
import { updateCompanyAction } from "./actions";

type Initial = {
  name: string;
  orgNumber: string;
  legalForm: string;
  addressLine: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
};

export function CompanyForm({ initial, readOnly }: { initial: Initial; readOnly: boolean }) {
  const t = useTranslations();
  const [state, action] = useActionState(updateCompanyAction, undefined);
  // After a failed save, show what the user typed rather than the stored values.
  const v = (k: keyof Initial) => state?.values?.[k] ?? initial[k];
  return (
    <form action={action} className="space-y-4">
      {readOnly && <Alert kind="info">{t("company.readOnly")}</Alert>}
      <FormMessage state={state} />
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t("company.name")} name="name" defaultValue={v("name")} required maxLength={200} />
        </div>
        <Field
          label={t("company.orgNumber")}
          name="orgNumber"
          defaultValue={v("orgNumber")}
          inputMode="numeric"
          maxLength={11}
        />
        <Select label={t("company.legalForm")} name="legalForm" defaultValue={v("legalForm")}>
          <option value="">{t("company.notSet")}</option>
          <option value="ENK">{t("company.enk")}</option>
          <option value="AS">{t("company.as")}</option>
        </Select>
        <div className="sm:col-span-2">
          <Field label={t("company.address")} name="addressLine" defaultValue={v("addressLine")} maxLength={200} />
        </div>
        <Field label={t("company.postalCode")} name="postalCode" defaultValue={v("postalCode")} maxLength={10} />
        <Field label={t("company.city")} name="city" defaultValue={v("city")} maxLength={100} />
        <Field label={t("common.email")} name="email" type="email" defaultValue={v("email")} maxLength={200} />
        <Field label={t("company.phone")} name="phone" type="tel" defaultValue={v("phone")} maxLength={30} />
      </fieldset>
      {!readOnly && <SubmitButton>{t("common.save")}</SubmitButton>}
    </form>
  );
}
