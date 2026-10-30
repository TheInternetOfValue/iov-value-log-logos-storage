import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { wellbeingIdentitySvg } from "@theinternetofvalue/wellbeing-identity-renderer/static";
import { WellbeingIdentityRenderer } from "@theinternetofvalue/wellbeing-identity-renderer";
import { ownerReplayProjection } from "@/lib/identity-replay-projection";

describe("shared identity renderer release contract", () => {
  it("pins the same renderer and contracts in the manifest, lockfile and installed release", () => {
    const read = (file: string) => JSON.parse(readFileSync(join(process.cwd(), file), "utf8"));
    const manifest = read("package.json"), lock = read("package-lock.json");
    for (const [name, version] of [["contracts", "0.1.4"], ["renderer", "0.2.5"]]) {
      const pkg = `@theinternetofvalue/wellbeing-identity-${name}`;
      expect(manifest.dependencies[pkg]).toBe(`file:vendor/theinternetofvalue-wellbeing-identity-${name}-${version}.tgz`);
      expect(lock.packages[""].dependencies[pkg]).toBe(manifest.dependencies[pkg]);
      expect(lock.packages[`node_modules/${pkg}`].version).toBe(version);
      expect(read(`node_modules/${pkg}/package.json`).version).toBe(version);
    }
  });
  it("keeps seven quiet traces, one active bulb, and non-overlapping annular targets", () => {
    const svg = wellbeingIdentitySvg("~~IdentityState");
    expect((svg.match(/stroke-opacity="\.24"/g) ?? [])).toHaveLength(7);
    expect((svg.match(/stroke-width="14"/g) ?? [])).toHaveLength(8);
    expect((svg.match(/fill="#8E24AA"/g) ?? [])).toHaveLength(1); // exactly one bulb
    expect((svg.match(/stroke="#8E24AA"/g) ?? [])).toHaveLength(3); // active ring, body form, axis
  });

  it("emits Ember only when a W arrival settles on IdentityState", () => {
    const transition = { appliedPilotW: .2, postPilotW: 800.2, canonicalSliceId: "slice" };
    const identity = renderToStaticMarkup(<WellbeingIdentityRenderer projection={ownerReplayProjection()} profile="replay" activeNode="~~IdentityState" transition={transition} />);
    const inspected = renderToStaticMarkup(<WellbeingIdentityRenderer projection={ownerReplayProjection()} profile="replay" activeNode="~~Skills" transition={transition} />);
    expect(identity).toContain("iov-identity-ember-arrival");
    expect(inspected).not.toContain("iov-identity-ember-arrival");
  });

  it("keeps all eight ring targets above non-interactive decorative overlays", () => {
    const portrait = renderToStaticMarkup(<WellbeingIdentityRenderer projection={ownerReplayProjection()} profile="replay" activeNode="~~GivenIdentity" onNodeSelect={() => undefined} />);
    const css = readFileSync(join(process.cwd(), "node_modules/@theinternetofvalue/wellbeing-identity-renderer/src/styles.css"), "utf8");
    expect((portrait.match(/data-iov-node=/g) ?? [])).toHaveLength(8);
    expect((portrait.match(/iov-identity-ring-hit/g) ?? [])).toHaveLength(8);
    expect(css).toMatch(/\.iov-identity-person \{[^}]*pointer-events:none/);
    expect(css).toMatch(/\.iov-identity-caption \{[^}]*pointer-events:none/);
    expect(css).toMatch(/\.iov-identity-ember-arrival \{[^}]*pointer-events:none/);
  });
});
