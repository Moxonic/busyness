import type { ComponentProps, ReactNode } from "react";

/** Small set of shared building blocks so every screen looks and behaves the same. */

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export const buttonClass = {
  primary:
    "inline-flex items-center justify-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60",
  secondary:
    "inline-flex items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-background disabled:opacity-60",
  danger:
    "inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-surface px-3 py-1.5 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-60",
  link: "text-sm font-medium text-brand underline-offset-2 hover:underline",
};

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-lg border border-border bg-surface p-5 shadow-sm", className)}>{children}</section>;
}

export function PageHeader({ title, intro, action }: { title: string; intro?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-sm text-muted">{intro}</p>}
      </div>
      {action}
    </header>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <input
        {...input}
        className={cx(
          "block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm",
          "focus:border-brand focus:outline-none disabled:bg-background",
          input.className,
        )}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select({ label, children, ...props }: { label: string } & ComponentProps<"select">) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <select
        {...props}
        className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-brand focus:outline-none"
      >
        {children}
      </select>
    </label>
  );
}

export function Alert({ kind, children }: { kind: "error" | "success" | "info" | "warning"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800",
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", styles)}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" }) {
  const styles = {
    neutral: "bg-gray-100 text-gray-700",
    good: "bg-green-100 text-green-800",
    bad: "bg-amber-100 text-amber-900",
  }[tone];
  return <span className={cx("inline-block rounded px-2 py-0.5 text-xs font-medium", styles)}>{children}</span>;
}
