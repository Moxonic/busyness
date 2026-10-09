"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-bits";
import { Field, Select } from "@/components/ui";
import { ROLES } from "@/lib/permissions";
import { inviteAction, userRowAction } from "./actions";

export function InviteForm() {
  const t = useTranslations();
  const [state, action] = useActionState(inviteAction, undefined);
  const [role, setRole] = useState<(typeof ROLES)[number]>("employee");
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <Field label={t("common.email")} name="email" type="email" required maxLength={200} />
        <Select label={t("common.role")} name="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </Select>
        <SubmitButton>{t("users.inviteSubmit")}</SubmitButton>
      </div>
      <p className="text-xs text-muted">{t(`roleHelp.${role}`)}</p>
    </form>
  );
}

type RowProps =
  | { id: string; invite: true; role?: undefined; status?: undefined }
  | { id: string; invite?: false; role: string; status: string };

export function UserRowControls({ id, invite, role, status }: RowProps) {
  const t = useTranslations();
  const [state, action] = useActionState(userRowAction, undefined);

  if (invite) {
    return (
      <div className="space-y-2">
        <FormMessage state={state} />
        <OpButton action={action} id={id} op="revokeInvite" label={t("users.revoke")} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <FormMessage state={state} />
      {status === "active" && (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="op" value="role" />
          <select
            name="role"
            defaultValue={role}
            aria-label={t("users.changeRole")}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          <SubmitButton variant="secondary" className="px-3! py-1!">
            {t("common.save")}
          </SubmitButton>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "active" && (
          <>
            <OpButton action={action} id={id} op="resetMfa" label={t("users.resetMfa")} confirm={t("users.confirmResetMfa")} />
            <OpButton action={action} id={id} op="deactivate" label={t("users.deactivate")} confirm={t("users.confirmDeactivate")} />
          </>
        )}
        {status === "deactivated" && (
          <>
            <OpButton action={action} id={id} op="reactivate" label={t("users.reactivate")} />
            <OpButton action={action} id={id} op="anonymize" label={t("users.anonymize")} confirm={t("users.confirmAnonymize")} />
          </>
        )}
        <a href={`/api/users/${id}/export`} className="rounded-md px-3 py-1.5 text-sm text-brand hover:underline">
          {t("users.exportData")}
        </a>
      </div>
    </div>
  );
}

function OpButton({
  action,
  id,
  op,
  label,
  confirm,
}: {
  action: (form: FormData) => void;
  id: string;
  op: string;
  label: string;
  confirm?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant="danger" confirm={confirm}>
        {label}
      </SubmitButton>
    </form>
  );
}
