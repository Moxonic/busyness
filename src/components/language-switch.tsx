import { getLocale } from "next-intl/server";
import { setLocaleAction } from "@/app/(public)/actions";
import { cx } from "./ui";

export async function LanguageSwitch() {
  const current = await getLocale();
  return (
    <form action={setLocaleAction} className="flex gap-1 text-xs">
      {(["nb", "en"] as const).map((l) => (
        <button
          key={l}
          name="locale"
          value={l}
          aria-pressed={current === l}
          className={cx(
            "rounded px-2 py-1 font-medium",
            current === l ? "bg-foreground text-white" : "text-muted hover:bg-gray-200",
          )}
        >
          {l === "nb" ? "Norsk" : "English"}
        </button>
      ))}
    </form>
  );
}
