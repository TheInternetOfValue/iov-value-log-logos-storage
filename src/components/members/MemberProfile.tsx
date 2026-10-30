import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/actions";
import { MemberSetup } from "./MemberSetup";

export function MemberProfile({ name, timezone, binding, writing, assessed = false, children }: { name: string; timezone: string; binding: string; writing: boolean; assessed?: boolean; children?: ReactNode }) {
  return <section className="member-profile-overview simple-profile">
    <header className="member-page-heading"><p className="member-kicker">YOUR SPACE</p><h1>Profile<span className="heading-dot">.</span></h1></header>
    {children}
    {!assessed ? <p className="simple-profile-privacy">Your activities are private and unassessed.</p> : null}
    <h2 className="simple-profile-heading">Your account</h2>
    <div className="profile-action-list">
      <a href="https://identity.theinternetofvalue.org/me"><span className="profile-action-icon" aria-hidden="true">~</span><span><strong>Wellbeing Identity</strong><small>Manage your identity and sharing</small></span><b aria-hidden="true">↗</b></a>
      <Link href="/privacy"><span className="profile-action-icon" aria-hidden="true">◇</span><span><strong>Privacy &amp; data</strong><small>Privacy options and export</small></span><b aria-hidden="true">›</b></Link>
    </div>
    <details className="member-profile-settings"><summary><span><strong>Edit name &amp; timezone</strong></span><b aria-hidden="true">+</b></summary><MemberSetup name={name} timezone={timezone} binding={binding} writing={writing} /></details>
    <form action={signOut} className="member-profile-signout"><button className="secondary">Sign out <span aria-hidden="true">↗</span></button></form>
  </section>;
}
