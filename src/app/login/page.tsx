import { memberAdmissionsOpen } from "@/lib/members/admission";
import { sendMagicLink } from "@/app/actions";

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const query = await searchParams;
  const invite = query.invite && /^[A-Za-z0-9_-]{32,100}$/.test(query.invite) ? `&invite=${encodeURIComponent(query.invite)}` : "";
  const identityMessage = query.identity === "admission-paused"
    ? "New Value Logs are temporarily paused. Existing members can still sign in."
    : ["account-changed", "account-mismatch"].includes(query.identity)
      ? "Your signed-in account changed. Sign out of Value Log before choosing a different Wellbeing Identity."
      : query.identity ? "Sign-in could not finish, or the secure return expired. Please start again." : null;
  return <section className="signin-page">
    <div className="signin-card">
      <div className="signin-mark" aria-hidden="true">~</div>
      <p className="signin-kicker">YOUR PRIVATE SPACE</p>
      <h1>A little space<br />for your day<span>.</span></h1>
      <p className="signin-intro">Sign in to record your day and return to what matters to you.</p>
      {identityMessage ? <p className="warning">{identityMessage}{["account-changed", "account-mismatch"].includes(query.identity) ? <> <a href="/profile">Open your current profile to sign out</a>.</> : null}</p> : null}
      {!memberAdmissionsOpen() ? <p className="signin-notice">New Value Logs are temporarily paused. Existing members can still sign in.</p> : null}
      <a href={`/auth/identity/start?provider=google${invite}`} className="signin-google"><svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.6 12.2c0-.7-.1-1.4-.2-2.1H12v3.9h5.9a5 5 0 0 1-2.2 3.2v2.5h3.5c2-1.9 3.4-4.5 3.4-7.5Z"/><path fill="#34A853" d="M12 23c2.9 0 5.3-1 7.1-2.7l-3.5-2.5c-1 .7-2.2 1.1-3.6 1.1-2.8 0-5.2-1.9-6.1-4.5H2.3V17A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.9 14.4a6.6 6.6 0 0 1 0-4.8V7H2.3a11 11 0 0 0 0 10l3.6-2.6Z"/><path fill="#EA4335" d="M12 5.1c1.6 0 3 .6 4.1 1.6l3.1-3.1A10.7 10.7 0 0 0 12 1a11 11 0 0 0-9.7 6l3.6 2.6C6.8 7 9.2 5.1 12 5.1Z"/></svg>Continue with Google</a>
      <a className="signin-identity" href="/auth/identity/start">Continue with Wellbeing Identity <span aria-hidden="true">↗</span></a>
      <p className="signin-privacy">Your Value Log stays private. Sign-in uses your verified identity reference.</p>
      <details className="signin-pilot" open={Boolean(query.sent || query.error)}><summary>Existing pilot email access</summary>
        {query.sent ? <p className="success">Secure link sent. Check the configured inbox.</p> : null}
        {query.error ? <p className="warning">That address is not allowed.</p> : null}
        <form action={sendMagicLink} className="signin-email"><label>Email<input name="email" type="email" autoComplete="email" required /></label><button>Send secure link</button></form>
      </details>
    </div>
  </section>;
}
