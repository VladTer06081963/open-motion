/**
 * Smoke render: renders a handful of frames of the glb-explode example and
 * writes PNGs plus a contact sheet. Used to verify the pipeline end to end.
 *
 * Usage: node scripts/render-smoke.mjs [startFrame] [count]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderFrames } from '@open-motion/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'out', 'smoke');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let file = path.join(dist, decodeURIComponent(url.pathname));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(5199, '127.0.0.1', resolve));

const startFrame = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 6);
const durationInFrames = startFrame + count;

fs.rmSync(outDir, { recursive: true, force: true });

await renderFrames({
  url: 'http://127.0.0.1:5199',
  config: { width: 1280, height: 720, fps: 30, durationInFrames },
  outputDir: outDir,
  compositionId: 'glb-explode',
  concurrency: 1,
  publicDir: path.join(root, 'public'),
  onProgress: (frame) => console.log(`frame ${frame}`),
});

server.close();
console.log(`frames written to ${outDir}`);
