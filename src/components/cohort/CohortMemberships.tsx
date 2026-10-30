"use client";
import { useState } from "react";
import "./cohort.css";
export function CohortMemberships({
  binding,
  token,
  communities = [],
}: {
  binding: string;
  token?: string;
  communities?: Array<{ id: string; name: string; kind: string }>;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(input: unknown) {
    setBusy(true);
    try {
      const r = await fetch("/api/cohort", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-value-log-session": binding,
          },
          body: JSON.stringify(input),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setMessage(
        "Saved. Moses can review community requests; accepted memberships are available to new proposals.",
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cohort-panel">
      <h2>
        {token ? "Your community invitation" : "Request another community"}
      </h2>
      {token ? (
        <form
          data-inline-feedback="true"
          onSubmit={(e) => {
            e.preventDefault();
            void submit({
              action: "accept_memberships",
              token,
              communities: new FormData(e.currentTarget).getAll("communities"),
              consent: true,
            });
          }}
        >
          <p>
            Accept relevant communities. Accepting your existing Wellbecoming
            community also resumes review under the same starting assumptions.
            Your existing baseline and records stay the same.
          </p>
          {communities.map((c) => (
            <label className="cohort-check" key={c.id}>
              <input name="communities" type="checkbox" value={c.id} />
              {c.name}
            </label>
          ))}
          <button disabled={busy}>Accept selected memberships</button>
        </form>
      ) : null}
      <details open={!token}>
        <summary>Ask Moses for a community</summary>
        <form
          data-inline-feedback="true"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit({
              action: "request_community",
              name: f.get("name"),
              reason: f.get("reason"),
            });
          }}
        >
          <label>
            Community name or description
            <input required name="name" maxLength={120} />
          </label>
          <label>
            What would you like to join?
            <textarea required name="reason" maxLength={2000} />
          </label>
          <button className="secondary" disabled={busy}>
            Send community request
          </button>
        </form>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
