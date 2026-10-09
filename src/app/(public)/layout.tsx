import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/language-switch";

export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations();
  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10">
      <div className="mb-8 flex w-full max-w-md items-center justify-between">
        <span className="text-lg font-semibold">{t("common.appName")}</span>
        <LanguageSwitch />
      </div>
      <main className="w-full max-w-md">{children}</main>
      <footer className="mt-10 text-xs text-muted">
        <Link href="/privacy" className="hover:underline">
          {t("nav.privacy")}
        </Link>
      </footer>
    </div>
  );
}
