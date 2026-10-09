"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  // Highlight only the most specific match, so /settings/users does not also light up /settings.
  const matches = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = links
    .map((l) => l.href)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  return (
    <ul className="flex gap-1 overflow-x-auto md:flex-col">
      {links.map((l) => {
        const active = l.href === activeHref;
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "block whitespace-nowrap rounded-md px-3 py-2 text-sm",
                active ? "bg-brand/10 font-semibold text-brand" : "text-foreground hover:bg-background",
              )}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
