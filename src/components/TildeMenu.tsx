"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  ["/profile", "Profile"],
  ["/privacy", "Privacy & data"],
  ["/protocol", "Provenance"],
  ["/method", "Method"],
  ["/changelog", "Changelog"],
] as const;

export function TildeMenu({ personal = false, nativeLogging = false }: { personal?: boolean; nativeLogging?: boolean }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = menuRef.current?.querySelectorAll<HTMLElement>("a, button:not([disabled])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && event.target !== triggerRef.current) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return <div className="tilde-menu" ref={menuRef}>
    <button
      aria-controls="value-log-menu"
      aria-expanded={open}
      aria-haspopup="menu"
      className="tilde-trigger"
      onClick={() => setOpen((current) => !current)}
      ref={triggerRef}
      type="button"
    >
      <span aria-hidden="true">~</span><span className="sr-only">Open Value Log menu</span>
    </button>
    {open ? <div aria-label="Value Log menu" className="tilde-popover" id="value-log-menu" role="menu">
      {nativeLogging ? <Link href="/log" onClick={() => setOpen(false)} role="menuitem">Log by voice</Link> : null}
      {links.filter(([href]) => !personal || href !== "/protocol").map(([href, label]) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return <Link aria-current={active ? "page" : undefined} className={active ? "active" : ""} href={href} key={href} onClick={() => setOpen(false)} role="menuitem">{label}</Link>;
      })}
      <a href="https://spec.theinternetofvalue.org" onClick={() => setOpen(false)} rel="noopener noreferrer" role="menuitem" target="_blank">
        Canonical IoV Spec ↗
        <small>Public technical documentation</small>
      </a>
    </div> : null}
  </div>;
}
