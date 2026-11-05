/**
 * Verifies every asset declared in public/assets.manifest.json:
 * the file exists and its sha256 matches.
 *
 * This is the reproducibility gate: a render is only reproducible if the
 * bytes of the asset are pinned.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, 'public', 'assets.manifest.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let failed = 0;

for (const asset of manifest.assets) {
  const file = path.join(root, asset.file);
  if (!fs.existsSync(file)) {
    console.error(`MISSING  ${asset.path} (${asset.file})`);
    failed++;
    continue;
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (hash !== asset.sha256) {
    console.error(`MISMATCH ${asset.path}\n  expected ${asset.sha256}\n  actual   ${hash}`);
    failed++;
    continue;
  }
  console.log(`ok       ${asset.path}  sha256=${hash.slice(0, 16)}…  license=${asset.license}`);
}

if (failed > 0) {
  console.error(`\n${failed} asset(s) failed verification`);
  process.exit(1);
}
console.log('\nall assets verified');
