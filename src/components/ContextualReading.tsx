import type { ReactNode } from "react";

export function ContextualReading({
  children,
  className = "",
  footer,
  label = "Contextual reading",
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  label?: string;
}) {
  return (
    <aside
      aria-label={label}
      aria-live="polite"
      className={`contextual-reading${className ? ` ${className}` : ""}`}
    >
      <div className="contextual-reading-body">{children}</div>
      {footer ? <div className="contextual-reading-footer">{footer}</div> : null}
    </aside>
  );
}
