import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseCanonicalMemberDid, WELLBEING_IDENTITY_EIGHT_RING_PROFILE, type OwnerWellbeingIdentityProjection } from "@theinternetofvalue/wellbeing-identity-contracts";
import { PrivateIdentityProfile } from "./PrivateIdentityProfile";

const projection: OwnerWellbeingIdentityProjection = {
  identityDid: parseCanonicalMemberDid("did:iov:member:00000000-0000-0000-0000-000000000001"),
  protocolVersion: "0.6.0",
  projectionSchemaVersion: "wellbeing-identity-projection-v1",
  disclosureVersion: "owner-test-v1",
  purpose: "owner-private-profile",
  audience: "identity-owner",
  displayName: "Identity owner",
  profileVersion: "test",
  provenanceVersion: "test",
  nodes: WELLBEING_IDENTITY_EIGHT_RING_PROFILE.map((node) => ({
    path: node.path,
    label: node.label,
    visible: true,
    facets: node.path === "~~IdentityState" ? [{ path: "~~~WellbeingScore", label: "Wellbeing Score", value: 846.5, disclosure: "private" as const }] : [],
  })),
};

describe("PrivateIdentityProfile", () => {
  it("keeps the live glance separate from the selected facet ledger", () => {
    const html = renderToStaticMarkup(<PrivateIdentityProfile projection={projection} currentW={846.5} performanceCredits={1200} />);
    expect(html).toContain('class="private-ring-glance" aria-live="polite"');
    expect(html).toContain('id="private-facet-ledger"');
    expect(html).toContain("Selected identity reading");
    expect(html).toContain("Wellbeing Score");
    expect((html.match(/aria-live="polite"/g) ?? [])).toHaveLength(1);
  });

  it("keeps Profile ring emphasis geometry constant and top-aligns the portrait", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.private-identity-layout \{[^}]*align-items:start/);
    expect(css).toMatch(/\.private-identity-render \.iov-identity-ring \{[^}]*stroke-width:1\.5px/);
    expect(css).toMatch(/\.private-identity-render \.iov-identity-rings g\.is-current \.iov-identity-ring \{[^}]*stroke-width:1\.5px/);
    expect(css).toMatch(/\.private-identity-render \.iov-identity-rings g\[role="button"\]:focus-visible \.iov-identity-ring \{[^}]*stroke-width:1\.5px/);
  });

  it("does not present missing Performance valuation as an economic zero", () => {
    const html = renderToStaticMarkup(<PrivateIdentityProfile projection={projection} currentW={846.5} performanceCredits={null} />);
    expect(html).toContain("Only valued VCperformance events enter this total");
    expect(html).toContain("Performance value</p><strong>—</strong>");
    expect(html).not.toContain("Performance value</p><strong>0</strong>");
  });
});
