"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/day", "Today"],
  ["/review", "Review"],
  ["/trends", "Insights"],
] as const;

export function PrimaryNav({ reviewCount = 0, reviewBlocked = false, reviewUnavailable = false, personal = false }: { personal?: boolean; reviewCount?: number; reviewBlocked?: boolean; reviewUnavailable?: boolean }) {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav aria-label="Primary navigation">
      {(personal ? [["/day", "Today"], ["/review", "Insights"], ["/profile", "Profile"]] : links).map(([href, label]) => {
        const active = href === "/review"
          ? ["/review", "/inbox", "/observer", "/validator"].some((path) => pathname === path || pathname.startsWith(`${path}/`))
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "active" : undefined} href={href} key={href}>
            <span>{label}</span>
            {href === "/review" && (reviewUnavailable || reviewBlocked || reviewCount > 0) ? <span
              aria-label={reviewUnavailable ? "Review decision count is temporarily unavailable" : reviewBlocked ? "Review has an urgent blocker" : `${reviewCount} review ${reviewCount === 1 ? "decision" : "decisions"}`}
              className={`nav-attention ${reviewBlocked ? "blocked" : ""}${reviewUnavailable ? " unavailable" : ""}`}
            >{reviewUnavailable ? "…" : reviewBlocked ? "!" : reviewCount}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
