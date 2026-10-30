"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function ResumeCapture({
  id,
  revision,
  binding,
}: {
  id: string;
  revision: number;
  binding: string;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <>
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            const r = await fetch("/api/native-log/reopen", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-value-log-session": binding,
              },
              body: JSON.stringify({ id, revision, consent: true }),
            });
            const b = await r.json();
            if (!r.ok || !b.document)
              throw new Error(b.error ?? "This conversation could not open.");
            router.push(`/day?date=${b.document.date}&draft=${b.id}`);
          } catch (error) {
            setMessage((error as Error).message);
            setBusy(false);
          }
        }}
      >
        Continue by voice
      </button>
      <p role="status">{message}</p>
    </>
  );
}
