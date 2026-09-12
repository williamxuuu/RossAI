"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; match: (path: string) => boolean }[] = [
  { href: "/", label: "Queue", match: (p) => p === "/" || p.startsWith("/cases") },
  { href: "/#in-progress", label: "In progress", match: () => false },
  { href: "/#settings", label: "Settings", match: () => false },
];

/** Pill-shaped tab nav (spec §5). Active state follows the current pathname. */
export function PillNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Console sections" className="pill-nav">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.label}
            href={item.href}
            data-active={active ? "true" : "false"}
            aria-current={active ? "page" : undefined}
            className="transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
