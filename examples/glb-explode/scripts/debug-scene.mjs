/**
 * Debug helper: opens the built example in headless Chromium and reports
 * console output, WebGL capabilities and the loaded scene graph.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@open-motion/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
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

await new Promise((resolve) => server.listen(5198, '127.0.0.1', resolve));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', (message) => console.log('[console]', message.type(), message.text()));
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

await page.addInitScript(() => {
  window.__OPEN_MOTION_FRAME__ = 60;
  window.__OPEN_MOTION_COMPOSITION_ID__ = 'glb-explode';
  window.__OPEN_MOTION_READY__ = false;
});

await page.goto('http://127.0.0.1:5198');
await page.waitForTimeout(4000);

const info = await page.evaluate(() => {
  const dbg = window.__DEBUG__;
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2');
  return {
    ready: window.__OPEN_MOTION_READY__,
    delayCount: window.__OPEN_MOTION_DELAY_RENDER_COUNT__,
    hasCanvas: Boolean(canvas),
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    renderer: gl
      ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
      : 'no webgl',
    rootChildren: document.getElementById('root')?.innerHTML.slice(0, 200),
    debug: dbg,
  };
});

console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(root, 'out', 'debug.png') });
await browser.close();
server.close();
