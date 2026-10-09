import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/language-switch";
import { can } from "@/lib/permissions";
import { requireUser } from "@/server/auth/dal";
import { logoutAction } from "./actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const t = await getTranslations();

  const links = [
    { href: "/", label: t("nav.dashboard") },
    { href: "/settings", label: t("nav.company") },
    ...(can(user.role, "users:manage") ? [{ href: "/settings/users", label: t("nav.users") }] : []),
    ...(can(user.role, "audit:read") ? [{ href: "/audit", label: t("nav.audit") }] : []),
    { href: "/account", label: t("nav.account") },
    { href: "/help", label: t("nav.help") },
  ];

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-border bg-surface md:min-h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="px-4 py-4 text-lg font-semibold">{t("common.appName")}</div>
        <nav aria-label={t("nav.menu")} className="px-2 pb-3">
          <NavLinks links={links} />
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-4 border-b border-border bg-surface px-6 py-3">
          <span className="text-sm text-muted">
            {user.name} · {t(`roles.${user.role}`)}
          </span>
          <LanguageSwitch />
          <form action={logoutAction}>
            <button className="text-sm font-medium text-brand hover:underline">{t("nav.logout")}</button>
          </form>
        </header>
        <main className="w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted">{t("common.reviewNote")}</footer>
      </div>
    </div>
  );
}
