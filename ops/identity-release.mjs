import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const canonicalReleaseUrl = 'https://theinternetofvalue.org/.well-known/iov-identity-release.json';
const read = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const digest = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

/** Product release coordination only; canonical protocol truth remains in Spec. */
export function checkLocal(root = process.cwd()) {
  const release = read(root, 'iov-identity-release.json');
  const product = read(root, 'iov-product.json');
  const pkg = read(root, 'package.json'), lock = read(root, 'package-lock.json');
  assert.equal(release.schemaVersion, 'iov-identity-release-v1');
  assert.equal(createHash('sha256').update(readFileSync(join(root, 'ops/identity-release.mjs'))).digest('hex'), release.guardSha256, 'The release validator differs from the coordinated copy');
  const expected = release.products[product.id];
  assert.ok(expected, 'Product must be listed in the coordinated release');
  assert.equal(pkg.version, expected.version, 'Application version differs from the release');
  assert.equal(lock.version, pkg.version, 'Lockfile application version differs');
  assert.equal(lock.packages[''].version, pkg.version);
  if (['foundation', 'word-wallet'].includes(product.id)) {
    const source = readFileSync(join(root, product.id === 'word-wallet' ? 'src/identityContext.ts' : 'lib/public-identity-context.ts'), 'utf8');
    assert.equal(source.match(/IDENTITY_CONTEXT_SCHEMA = "([^"]+)"/)?.[1], release.contextSchemaVersion, 'Actual API context schema differs from release metadata');
    if (product.id === 'word-wallet') assert.equal(source.match(/IDENTITY_FLOW_CONTRACT = "([^"]+)"/)?.[1], release.identityFlow);
  }
  for (const [kind, entry] of Object.entries(release.packages)) {
    const name = `@theinternetofvalue/wellbeing-identity-${kind}`;
    if (!expected.renderer) {
      assert.ok(!pkg.dependencies?.[name], 'Native Identity UI must not acquire a renderer dependency');
      continue;
    }
    const specifier = `file:${entry.artifact}`;
    assert.equal(pkg.dependencies[name], specifier, `${name} must use the reviewed immutable artifact`);
    assert.equal(lock.packages[''].dependencies[name], specifier);
    const locked = lock.packages[`node_modules/${name}`];
    assert.equal(locked.version, entry.version);
    assert.equal(locked.resolved, specifier);
    assert.equal(locked.integrity, entry.integrity);
    assert.equal(digest(readFileSync(join(root, entry.artifact))), entry.integrity, `${name} artifact differs from its published digest`);
    const installed = read(root, `node_modules/${name}/package.json`);
    assert.equal(installed.version, entry.version, `${name} installed version differs`);
  }
  return { release, product, expected };
}

export function metadata(root = process.cwd()) {
  const { release, product, expected } = checkLocal(root);
  let commit = process.env.COMMIT_REF || process.env.GITHUB_SHA;
  if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { commit = null; } }
  return { schemaVersion: 'iov-product-v1', product: product.id, version: expected.version, release: release.release, identityFlow: release.identityFlow, contextSchemaVersion: ['foundation', 'word-wallet'].includes(product.id) ? release.contextSchemaVersion : null, renderer: expected.renderer ? release.packages.renderer.version : null, contracts: expected.renderer ? release.packages.contracts.version : null, commit };
}

export async function readRemote(url) {
  const address = new URL(url);
  assert.equal(address.protocol, 'https:', 'Release checks require HTTPS');
  const response = await fetch(address, { cache: 'no-store', signal: AbortSignal.timeout(15000), redirect: 'error' });
  assert.equal(response.status, 200, `${url} is unavailable (${response.status})`);
  assert.match(response.headers.get('content-type') || '', /application\/json/, 'Release endpoint must return JSON');
  return response.json();
}

export function checkRuntime(release, id, actual) {
  const expected = release.products[id];
  assert.equal(actual.schemaVersion, 'iov-product-v1');
  assert.equal(actual.product, id);
  assert.equal(actual.release, release.release, `${id} is running a different coordinated release`);
  assert.equal(actual.version, expected.version, `${id} application version differs`);
  assert.equal(actual.identityFlow, release.identityFlow);
  assert.equal(actual.renderer, expected.renderer ? release.packages.renderer.version : null);
  assert.equal(actual.contracts, expected.renderer ? release.packages.contracts.version : null);
  assert.equal(actual.contextSchemaVersion, ['foundation', 'word-wallet'].includes(id) ? release.contextSchemaVersion : null);
  assert.match(actual.commit || '', /^[a-f0-9]{40}$/i, `${id} must identify the actual build commit`);
}

export async function checkWordWalletCapability(release) {
  const url = new URL('/v1/identity-capabilities', release.products['word-wallet'].metadataUrl);
  const capability = await readRemote(url);
  assert.equal(capability.schemaVersion, 'iov-identity-capabilities-v1');
  assert.equal(capability.identityFlow, release.identityFlow);
  assert.equal(capability.contextSchemaVersion, release.contextSchemaVersion);
  assert.equal(capability.contextAvailable, true, 'Word Wallet context migration/RPCs are not ready');
}

async function main() {
  const root = process.cwd(), { release, product } = checkLocal(root);
  if (process.argv.includes('--canonical') || process.env.CONTEXT && product.id !== 'foundation') {
    const canonical = await readRemote(canonicalReleaseUrl);
    assert.deepEqual(release, canonical, 'Local release manifest differs from the Foundation release authority; update the coordinated release rather than an individual pin');
  }
  if (process.argv.includes('--write')) {
    const directory = join(root, product.id === 'docs-site' ? 'docs/public/.well-known' : 'public/.well-known');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'iov-product.json'), JSON.stringify(metadata(root), null, 2) + '\n');
    if (product.id === 'foundation') writeFileSync(join(directory, 'iov-identity-release.json'), JSON.stringify(release, null, 2) + '\n');
  }
  if (process.argv.includes('--live')) {
    const failures = [];
    for (const [id, expected] of Object.entries(release.products)) {
      try { checkRuntime(release, id, await readRemote(expected.metadataUrl)); console.log(`${id}: release and build metadata agree`); }
      catch (error) { failures.push(`${id}: ${error.message}`); }
    }
    assert.deepEqual(failures, [], 'Deployed identity applications disagree with the release manifest');
    await checkWordWalletCapability(release);
  }
  console.log(`${product.id}: coordinated identity release ${release.release} verified`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
