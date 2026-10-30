"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import "./cohort.css";
import { CohortMemberships } from "./CohortMemberships";
type Community = { id: string; name: string; kind: string };
export function CohortEnrollment({
  token,
  binding,
  communities,
  enabled,
}: {
  token: string;
  binding: string;
  communities: Community[];
  enabled: boolean;
}) {
  const router = useRouter(),
    [house, setHouse] = useState(""),
    [work, setWork] = useState<string[]>([]),
    [salary, setSalary] = useState(""),
    [currency, setCurrency] = useState("INR"),
    [consent, setConsent] = useState(false),
    [starting, setStarting] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="cohort-panel">
      <p className="meta">Field Station · private pilot</p>
      <h1>Your day, understood.</h1>
      <p className="lede">
        Talk about what happened. Check our understanding. Follow the changes
        over time.
      </p>
      <form
        data-inline-feedback="true"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/cohort", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-value-log-session": binding,
              },
              body: JSON.stringify({
                action: "enroll",
                token,
                house,
                communities: work,
                consent,
                startingValuesConfirmed: starting,
                salary: salary ? { annualGross: salary, currency } : null,
              }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error);
            router.replace("/day");
            router.refresh();
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend>Your Wellbecoming community</legend>
          <p>
            HouseOfSis is for women; HouseOfBros is for men. Confirm the
            community appropriate for you. We do not infer your gender.
          </p>
          <div className="cohort-choices">
            {communities
              .filter((c) => c.kind === "wellbecoming")
              .map((c) => (
                <label key={c.id}>
                  <input
                    required
                    type="radio"
                    name="house"
                    value={c.id}
                    checked={house === c.id}
                    onChange={() => setHouse(c.id)}
                  />
                  {c.name}
                </label>
              ))}
          </div>
          <p className="meta">
            Need another community? Ask Moses before joining. Your existing
            private logging remains available.
          </p>
        </fieldset>
        {communities.some((c) => c.kind === "work") ? (
          <fieldset>
            <legend>Your work communities</legend>
            <p>
              Accept only invitations relevant to your work. This pilot does not
              claim verification by your employer.
            </p>
            {communities
              .filter((c) => c.kind === "work")
              .map((c) => (
                <label className="cohort-check" key={c.id}>
                  <input
                    type="checkbox"
                    checked={work.includes(c.id)}
                    onChange={(e) =>
                      setWork((current) =>
                        e.target.checked
                          ? [...current, c.id]
                          : current.filter((x) => x !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
          </fieldset>
        ) : null}
        <details>
          <summary>Add an optional salary-based hourly rate</summary>
          <p>
            Gross annual cash salary ÷ 2,080 gives your starting rate for
            reviewed Learning, Earning and OrgBuilding. It changes valuation,
            not wellbeing. Amounts are non-payable and private.
          </p>
          <div className="cohort-fields">
            <label>
              Gross annual cash salary
              <input
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                pattern="[0-9]+(\.[0-9]{1,2})?"
                placeholder="Optional"
              />
            </label>
            <label>
              Currency
              <input
                value={currency}
                maxLength={3}
                pattern="[A-Z]{3}"
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </label>
          </div>
          <p className="meta">
            No salary? You can still log and follow wellbeing movement.
            Valuation will say unavailable.
          </p>
        </details>
        <div className="cohort-start">
          <strong>Starting score: 700 · provisional</strong>
          <p>
            Physiology, Emotion, Feeling, Thought, Habit and Performance each
            start at an assumed 700. This is an experimental starting point, not
            an assessment or ratified Genesis baseline.
          </p>
        </div>
        <label className="cohort-check">
          <input
            type="checkbox"
            checked={starting}
            onChange={(e) => setStarting(e.target.checked)}
            required
          />
          I confirm these six assumed starting values for this pilot.
        </label>
        <label className="cohort-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
          />
          I allow Sarvam to process the records I explicitly approve for
          automated policy review, with Moses handling unresolved questions and
          appeals.
        </label>
        <p className="meta">
          Your score starts at the beginning of your enrollment day in your
          confirmed timezone. Raw salary, writing and scores stay private.
          Confirmed records and review decisions form a retained audit history.
          You can export your records or pause further review.
        </p>
        <button disabled={!enabled || busy || !house || !starting || !consent}>
          {busy ? "Joining…" : "Join the Field Station pilot"}
        </button>
        <p role="status">{message}</p>
      </form>
      <details>
        <summary>Need another community?</summary>
        <CohortMemberships binding={binding} />
      </details>
    </section>
  );
}
