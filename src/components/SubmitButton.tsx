"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ idle, pending = "Working…", className, name, value, confirmMessage, disabled = false }: {
  idle: string;
  pending?: string;
  className?: string;
  name?: string;
  value?: string;
  confirmMessage?: string;
  disabled?: boolean;
}) {
  const status = useFormStatus();
  return <button className={className} type="submit" name={name} value={value} disabled={disabled || status.pending} aria-busy={status.pending}
    data-pending-label={pending}
    onClick={(event) => { if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault(); }}>
    {status.pending ? pending : idle}
  </button>;
}
