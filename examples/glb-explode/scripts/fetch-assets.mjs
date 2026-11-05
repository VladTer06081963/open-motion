/**
 * Downloads every asset declared in public/assets.manifest.json and verifies
 * its sha256.
 *
 * The manifest is the single source of truth: an agent can regenerate the
 * exact same bytes on any machine with `node scripts/fetch-assets.mjs`.
 *
 * Usage: node scripts/fetch-assets.mjs [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'public', 'assets.manifest.json');
const force = process.argv.includes('--force');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

for (const asset of manifest.assets) {
  const target = path.join(root, asset.file);

  if (fs.existsSync(target) && !force) {
    const hash = sha256(fs.readFileSync(target));
    if (hash === asset.sha256) {
      console.log(`cached   ${asset.path}`);
      continue;
    }
    console.warn(`stale    ${asset.path} (sha256 mismatch) — refetching`);
  }

  console.log(`fetching ${asset.path}\n         from ${asset.source}`);
  const response = await fetch(asset.source);
  if (!response.ok) {
    console.error(`failed   ${asset.path}: HTTP ${response.status}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = sha256(bytes);
  if (hash !== asset.sha256) {
    console.error(`failed   ${asset.path}: sha256 mismatch\n  expected ${asset.sha256}\n  actual   ${hash}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  console.log(`ok       ${asset.path}  ${bytes.length} bytes  sha256=${hash.slice(0, 16)}…`);
}

console.log('\nall assets present and verified');
