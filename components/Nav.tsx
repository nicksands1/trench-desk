"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "DESK" },
  { href: "/watchlist", label: "WATCHLIST" },
  { href: "/gate", label: "GATE" },
  { href: "/journal", label: "JOURNAL" },
  { href: "/wallets", label: "WALLETS" },
  { href: "/scoreboard", label: "SCOREBOARD" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
