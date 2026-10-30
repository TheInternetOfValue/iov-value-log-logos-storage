import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("standalone replay worker module graph", () => {
  it("does not transitively import the Next.js-only server guard", () => {
    const sourceRoot = dirname(fileURLToPath(import.meta.url));
    const entry = resolve(sourceRoot, "replay.ts");
    const visited = new Set<string>();
    const offenders: string[] = [];

    const resolveLocalImport = (from: string, specifier: string) => {
      const base = specifier.startsWith("@/")
        ? resolve(dirname(sourceRoot), specifier.slice(2))
        : specifier.startsWith(".")
          ? resolve(dirname(from), specifier)
          : null;
      if (!base) return null;
      return [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, resolve(base, "index.ts"), resolve(base, "index.tsx")]
        .find((candidate) => existsSync(candidate)) ?? null;
    };

    const visit = (file: string) => {
      if (visited.has(file)) return;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      if (/import\s+["']server-only["']/.test(source)) offenders.push(relative(sourceRoot, file));
      const imports = source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g);
      for (const match of imports) {
        const dependency = resolveLocalImport(file, match[1]);
        if (dependency) visit(dependency);
      }
    };

    visit(entry);
    visit(resolve(sourceRoot, "native-log/structure-worker.ts"));
    expect([...visited].map((file) => relative(sourceRoot, file))).toContain("founder-replay-server.ts");
    expect(offenders).toEqual([]);
  });

  it("runs the scheduled projection publisher as a background function", () => {
    const publisher = readFileSync(
      resolve(process.cwd(), "netlify/functions/publish-pilot-w.mts"),
      "utf8",
    );
    expect(publisher).toContain('schedule: "45 18 * * *"');
    expect(publisher).toContain("background: true");
  });
});
