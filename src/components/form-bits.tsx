"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Alert, buttonClass } from "./ui";

/** What every Server Action returns to its form. `error` is a key under "errors" in the messages. */
export type FormState =
  | {
      error?: string;
      retryAfterSec?: number;
      success?: string;
      /** Submitted values (never passwords) so the form can be refilled after an error; React resets forms after an action. */
      values?: Record<string, string>;
    }
  | undefined;

export function SubmitButton({
  children,
  variant = "primary",
  className,
  confirm,
}: {
  children: ReactNode;
  variant?: keyof typeof buttonClass;
  className?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${buttonClass[variant]} ${className ?? ""}`}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  const t = useTranslations("errors");
  if (!state) return null;
  if (state.error) {
    const key = t.has(state.error) ? state.error : "generic";
    return <Alert kind="error">{t(key, { minutes: Math.ceil((state.retryAfterSec ?? 60) / 60) })}</Alert>;
  }
  if (state.success) return <Alert kind="success">{state.success}</Alert>;
  return null;
}
