"use client";
import { useEffect, useState } from "react";
import type { CohortActivity } from "@/lib/cohort/policy";
import "./cohort.css";
import { DATED_POLICY, DATED_QA_POLICY } from "@/lib/field-station/ids";
import { PrepareDayIndex } from "./PrepareDayIndex";
type AdminData = {
  page: number;
  more: boolean;
  roster: Array<{
    owner_id: string;
    did: string;
    active: boolean;
    communities: string[];
  }>;
  communities: Array<{ id: string; name: string; kind: string }>;
  invitations: Array<{
    id: string;
    expires_at: string;
    redeemed_at: string | null;
    revoked_at: string | null;
  }>;
  exceptions: Array<{
    id: string;
    owner: string;
    name: string;
    digest: string;
    status: string;
    timezone: string;
    activity: CohortActivity;
    review: { rationale: string; question?: string } | null;
  }>;
  requests: Array<{
    id: string;
    owner: string;
    name: string;
    reason: string;
    requestedBy: string;
    did: string;
  }>;
  agent: {
    active: boolean;
    operator_did: string | null;
    accepted_at: string | null;
  };
};
export function CohortAdmin({ binding }: { binding: string }) {
  const [data, setData] = useState<AdminData | null>(null),
    [message, setMessage] = useState(""),
    [invitation, setInvitation] = useState(""),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(0);
  async function refresh() {
    const r = await fetch(`/api/cohort/admin?page=${page}`, {
        cache: "no-store",
      }),
      b = await r.json();
    if (!r.ok) throw new Error(b.error);
    setData(b);
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/cohort/admin?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        setData(body);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [page]);
  async function submit(input: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/cohort/admin", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-value-log-session": binding,
          },
          body: JSON.stringify(input),
        }),
        b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (b.path) setInvitation(new URL(b.path, location.origin).href);
      await refresh();
      setMessage("Saved.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="cohort-panel">
      <p className="meta">Field Station · authorised management</p>
      <h1>Communities and review</h1>
      <p>
        Manage accepted communities and review permissions. The dated October
        group has no ten-person ceiling. The earlier pilot retains its original
        limit. Invitations do not expose members’ private days.
      </p>
      <PrepareDayIndex binding={binding} />
      <details>
        <summary>Assign a dated group or test account</summary>
        <p>
          Use the verified Wellbeing Identity DID. Account names and email
          guesses cannot establish a community assignment. A test assignment
          never enrolls the person in the real scored group.
        </p>
        <form
          data-inline-feedback="true"
          onSubmit={(e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            void submit({
              action: "designate_dated_account",
              did: values.get("did"),
              policy: values.get("policy"),
              house: values.get("house"),
              reference: values.get("reference"),
            });
          }}
        >
          <label>
            Verified DID
            <input
              name="did"
              required
              pattern="did:iov:member:[0-9a-f-]{36}"
              autoComplete="off"
            />
          </label>
          <label>
            Group
            <select name="policy" defaultValue={DATED_QA_POLICY}>
              <option value={DATED_QA_POLICY}>
                QA — fictional test records only
              </option>
              <option value={DATED_POLICY}>26–28 October group</option>
            </select>
          </label>
          <label>
            Confirmed community
            <select name="house" defaultValue="house_of_bros">
              <option value="house_of_bros">HouseOfBros</option>
              <option value="house_of_sis">HouseOfSis</option>
            </select>
          </label>
          <label>
            Private assignment reference
            <input
              name="reference"
              required
              maxLength={160}
              pattern="[A-Za-z0-9:/._-]+"
              autoComplete="off"
            />
          </label>
          <p>
            Use an internal reference only; do not put salary, email or
            narrative in this field. The person must still accept the community
            and starting assumptions.
          </p>
          <button disabled={busy}>Save assignment</button>
        </form>
      </details>
      <details>
        <summary>Create a community</summary>
        <form
          data-inline-feedback="true"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit({
              action: "create_community",
              id: f.get("id"),
              name: f.get("name"),
              kind: f.get("kind"),
            });
          }}
        >
          <label>
            Community name
            <input name="name" required maxLength={120} />
          </label>
          <label>
            Reference
            <input
              name="id"
              pattern="[a-z][a-z0-9_-]{1,63}"
              required
              placeholder="example-community"
            />
          </label>
          <label>
            Purpose
            <select name="kind">
              <option value="work">Learning, Earning and OrgBuilding</option>
              <option value="wellbecoming">Wellbecoming</option>
            </select>
          </label>
          <button disabled={busy}>Create community</button>
        </form>
      </details>
      <details>
        <summary>Create a participant invitation</summary>
        <form
          data-inline-feedback="true"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void submit({
              action: "invite",
              communities: f.getAll("communities"),
              ...(f.get("did") ? { did: f.get("did") } : {}),
            });
          }}
        >
          <label>
            Bind to a participant DID (optional)
            <input name="did" placeholder="did:iov:member:…" />
          </label>
          <fieldset>
            <legend>Invite to relevant communities</legend>
            {data?.communities.map((c) => (
              <label className="cohort-check" key={c.id}>
                <input type="checkbox" name="communities" value={c.id} />
                {c.name}
              </label>
            ))}
          </fieldset>
          <button disabled={busy}>Create seven-day invitation</button>
        </form>
      </details>
      {invitation ? (
        <div className="cohort-start">
          <label>
            Share this one-use invitation with the intended participant
            <input
              value={invitation}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p>
            This link appears only here. Creating it does not send a message.
          </p>
        </div>
      ) : null}
      <details>
        <summary>Manage invitations</summary>
        <ul>
          {data?.invitations.map((i) => (
            <li key={i.id}>
              {i.redeemed_at
                ? "Accepted"
                : i.revoked_at
                  ? "Revoked"
                  : `Expires ${new Date(i.expires_at).toLocaleDateString()}`}
              {!i.redeemed_at && !i.revoked_at ? (
                <button
                  className="quiet"
                  disabled={busy}
                  onClick={() =>
                    void submit({ action: "revoke_invite", id: i.id })
                  }
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Manage accepted memberships</summary>
        <ul>
          {data?.roster.map((person) => (
            <li key={person.owner_id}>
              <p>
                {person.did} · {person.active ? "Active" : "Paused"}
              </p>
              <ul>
                {person.communities.map((id) => (
                  <li key={id}>
                    {data.communities.find((c) => c.id === id)?.name ?? id}{" "}
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() =>
                        void submit({
                          action: "revoke_membership",
                          owner: person.owner_id,
                          community: id,
                        })
                      }
                    >
                      Revoke membership
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p>
          Revoking a Wellbecoming membership pauses that person’s pilot. Their
          existing records remain saved.
        </p>
      </details>
      <details>
        <summary>Connect the reviewer’s operator account</summary>
        <p>
          {data?.agent.active
            ? "Agent enabled"
            : data?.agent.operator_did
              ? "Waiting for operator acceptance"
              : "Operator account not connected yet"}
        </p>
        <p>
          Sign in with Google as review-operator@example.invalid first, then
          use that account’s verified Identity DID. Email is a label; permission
          is bound to the verified DID.
        </p>
        <form
          data-inline-feedback="true"
          onSubmit={(e) => {
            e.preventDefault();
            void submit({
              action: "assign_operator",
              did: new FormData(e.currentTarget).get("did"),
            });
          }}
        >
          <label>
            Operator Identity DID
            <input name="did" required placeholder="did:iov:member:…" />
          </label>
          <button disabled={busy}>Assign operator</button>
        </form>
        <p>
          The designated account then accepts its role at{" "}
          <a href="/agent">Reviewer operation</a>. Reassignment pauses the agent
          until accepted.
        </p>
      </details>
      <details>
        <summary>Community requests</summary>
        <ul>
          {data?.requests.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong>
              <p>{r.reason}</p>
              <p className="meta">
                Requester {r.requestedBy} · {r.did || r.owner}
              </p>
            </li>
          ))}
        </ul>
      </details>
      <h2>Questions and appeals</h2>
      {data && !data.exceptions.length ? <p>No unresolved cases.</p> : null}
      <ol className="cohort-records">
        {data?.exceptions.map((r) => (
          <li key={r.id}>
            <p className="meta">
              {r.name} · {r.activity.node}
            </p>
            <h3>{r.activity.activity}</h3>
            <p>
              {new Date(r.activity.start).toLocaleString(undefined, {
                timeZone: r.timezone,
              })}{" "}
              →{" "}
              {new Date(r.activity.end).toLocaleString(undefined, {
                timeZone: r.timezone,
              })}{" "}
              ({r.timezone})
            </p>
            <p>
              {r.activity.workCommunity
                ? `${data?.communities.find((c) => c.id === r.activity.workCommunity)?.name ?? r.activity.workCommunity} · ${r.activity.lane}`
                : "Wellbecoming activity"}
            </p>
            <blockquote>{r.activity.quote}</blockquote>
            {r.activity.followUpAnswers?.length ? (
              <details>
                <summary>Participant clarifications</summary>
                {r.activity.followUpAnswers.map((reply) => (
                  <p key={reply.id}>{reply.text}</p>
                ))}
              </details>
            ) : null}
            <p>
              {r.activity.context} {r.activity.proof}
            </p>
            {r.review ? (
              <p>
                {r.review.rationale} {r.review.question}
              </p>
            ) : null}
            <p>
              Effect: {r.activity.direction ?? "needs confirmation"} ·{" "}
              {r.activity.intensity ?? "not supplied"}
            </p>
            <p>
              Changed facts must go back to the participant for fresh approval.
              Confirm only the unchanged record shown here.
            </p>
            <form
              data-inline-feedback="true"
              onSubmit={(e) => {
                e.preventDefault();
                void submit({
                  action: "human_review",
                  recordId: r.id,
                  digest: r.digest,
                  rationale: new FormData(e.currentTarget).get("rationale"),
                });
              }}
            >
              <label>
                Review rationale
                <textarea
                  name="rationale"
                  required
                  minLength={10}
                  maxLength={2000}
                />
              </label>
              <button disabled={busy}>Confirm this reviewed record</button>
            </form>
          </li>
        ))}
      </ol>
      <nav aria-label="Management history pages">
        <button
          className="secondary"
          disabled={page === 0 || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous page
        </button>
        <span>Page {page + 1}</span>
        <button
          className="secondary"
          disabled={!data?.more || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          Next page
        </button>
      </nav>
      <p role="status">{message}</p>
    </section>
  );
}
