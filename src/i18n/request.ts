import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["nb", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "locale";

export function toLocale(value: string | undefined | null): Locale {
  return value === "en" ? "en" : "nb";
}

export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: "Europe/Oslo",
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
