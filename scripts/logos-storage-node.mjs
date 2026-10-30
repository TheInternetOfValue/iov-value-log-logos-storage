// Runs a normal local Logos Storage node for the native-log mirror.
// Downloads the pinned release once into .logos-storage/, verifies its SHA-256, then starts
// the node with its REST API on loopback. Data persists in .logos-storage/data between runs.
//   npm run logos:node            # API on http://127.0.0.1:8080/api/storage/v1
//   LOGOS_API_PORT=8081 npm run logos:node
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const version = "v0.5.3";
const assets = {
  "darwin-arm64": "7f32f62a14e555399ee003f11d1e29bba9b6ff842d973f38b5b280f018c2f6ab",
  "linux-amd64": "1086fae4f283cab882f133abe4d5a88cfae8d61edba9f0094c7f75b368ec9d56",
  "linux-arm64": "ecbc32536565096b75b2330dab4ff47a993714a1f3ce345099396968bc69796b",
};
const platform = `${process.platform}-${process.arch === "x64" ? "amd64" : process.arch}`;
const sha256 = assets[platform];
if (!sha256) {
  console.error(`No pinned Logos Storage ${version} build for ${platform}. Supported: ${Object.keys(assets).join(", ")}.`);
  process.exit(1);
}

const root = resolve(".logos-storage"), binDir = join(root, "bin"), dataDir = join(root, "data");
const name = `logos-storage-${platform}-${version}`, binary = join(binDir, name);
const port = Number(process.env.LOGOS_API_PORT ?? 8080);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("LOGOS_API_PORT must be 1024-65535");

if (!existsSync(binary)) {
  mkdirSync(binDir, { recursive: true });
  const url = `https://github.com/logos-storage/logos-storage-nim/releases/download/${version}/${name}.zip`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const zip = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(zip).digest("hex");
  if (actual !== sha256) throw new Error(`Checksum mismatch for ${name}.zip: ${actual}`);
  const zipPath = join(binDir, `${name}.zip`);
  writeFileSync(zipPath, zip);
  const unzip = spawnSync("unzip", ["-o", "-q", zipPath, "-d", binDir], { stdio: "inherit" });
  rmSync(zipPath);
  if (unzip.status !== 0 || !existsSync(binary)) throw new Error("Could not unpack the release (is `unzip` installed?)");
  chmodSync(binary, 0o755);
  if (process.platform === "darwin") spawnSync("xattr", ["-d", "com.apple.quarantine", binary], { stdio: "ignore" });
}
mkdirSync(dataDir, { recursive: true });

const args = [
  `--data-dir=${dataDir}`,
  "--api-bindaddr=127.0.0.1", `--api-port=${port}`,
  // Keep mirrored blocks for ~10 years and do not announce them, so this node is the only provider.
  // Not --block-ttl=0: in v0.5.3 it marks blocks expired and startup maintenance deletes them all.
  "--block-ttl=315360000", "--advertise-content=false",
  `--storage-quota=${process.env.LOGOS_STORAGE_QUOTA ?? 10 * 1024 ** 3}`,
  "--log-format=nocolors", `--log-level=${process.env.LOGOS_LOG_LEVEL ?? "info"}`,
];
console.log(`Starting Logos Storage ${version}; API http://127.0.0.1:${port}/api/storage/v1 (data in ${dataDir})`);
const node = spawn(binary, args, { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => node.kill(signal));
node.on("exit", code => process.exit(code ?? 0));
