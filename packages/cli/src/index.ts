import { renderFrames, getCompositions } from '@open-motion/renderer';
import { chromium } from 'playwright';
import { encodeVideo, encodeGif, encodeWebP } from '@open-motion/encoder';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { Command } from 'commander';
import cliProgress from 'cli-progress';
import { execSync } from 'child_process';

const getPackageManager = () => {
  try {
    execSync('pnpm -v', { stdio: 'ignore' });
    return 'pnpm';
  } catch (e) {
    return 'npm';
  }
};

export const runInit = async (projectName: string) => {
  const targetDir = path.join(process.cwd(), projectName);
  if (fs.existsSync(targetDir)) {
    console.error(`Directory ${projectName} already exists.`);
    process.exit(1);
  }

  const pm = getPackageManager();
  console.log(`Initializing OpenMotion project: ${projectName} using ${pm}...`);

  // Basic template structure
  const dirs = ['', 'src'];
  for (const dir of dirs) {
    fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
  }

  // Template files
  const files = {
    'package.json': JSON.stringify({
      name: projectName,
      private: true,
      version: '0.0.1-alpha.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
        render: `${pm} run build && npx http-server dist -p 5173 -a 127.0.0.1 > /dev/null 2>&1 & sleep 2 && open-motion render -u http://127.0.0.1:5173 --composition main -o ./out.mp4 --concurrency 4; pkill -f http-server`
      },
      dependencies: {
        'react': '^18.2.0',
        'react-dom': '^18.2.0',
        '@open-motion/core': 'latest'
      },
      devDependencies: {
        '@vitejs/plugin-react': '^4.0.0',
        'vite': '^4.4.0',
        'typescript': '^5.0.0'
      }
    }, null, 2),
    'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
    'vite.config.ts': `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
});`,
    'src/main.tsx': `import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { CompositionProvider, Composition, Player } from '@open-motion/core';

const Root = () => {
  const config = { width: 1920, height: 1080, fps: 30, durationInFrames: 120 };
  const isRendering = typeof (window as any).__OPEN_MOTION_FRAME__ === 'number';

  React.useEffect(() => {
    if (isRendering) {
      (window as any).__OPEN_MOTION_READY__ = true;
    }
  }, [isRendering]);

  if (isRendering) {
    return (
      <CompositionProvider config={config} frame={(window as any).__OPEN_MOTION_FRAME__}>
        <App />
      </CompositionProvider>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <Player component={App} config={config} />
      <div style={{ display: 'none' }}>
        <Composition id="main" component={App} {...config} />
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);`,
    'src/App.tsx': `import React from 'react';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate
} from '@open-motion/core';

export const App = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const opacity = interpolate(frame, [0, 30], [0, 1]);

  return (
    <div style={{
      flex: 1,
      backgroundColor: 'white',
      width,
      height,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      fontSize: 80,
      opacity
    }}>
      Hello OpenMotion
    </div>
  );
};`
  };

  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(targetDir, name), content);
  }

  console.log(`Success! Project ${projectName} initialized.`);
  console.log(`Next steps:`);
  console.log(`  cd ${projectName}`);
  console.log(`  ${pm} install`);
  console.log(`  ${pm} run dev`);
};

export const runRender = async (options: {
  url: string;
  out: string;
  compositionId?: string;
  width?: number;
  height?: number;
  fps?: number;
  duration?: number;
  props?: string;
  concurrency?: number;
  publicDir?: string;
  format?: 'mp4' | 'gif' | 'webp' | 'webm' | 'auto';
  chromiumPath?: string;
  timeout?: number;
}) => {
  const timeout = options.timeout || parseInt(process.env.OPEN_MOTION_RENDER_TIMEOUT || '300000', 10);

  if (options.chromiumPath) {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = options.chromiumPath;
  }
  const tmpDir = path.join(process.cwd(), '.open-motion-tmp');
  const inputProps = options.props ? JSON.parse(options.props) : {};
  const startTime = Date.now();

  // Check for browser installation before starting
  try {
    chromium.executablePath();
  } catch (error) {
    console.error('\n❌ Browser not found!');
    console.error('\nPlaywright browsers need to be installed before rendering.');
    console.error('\nPlease run one of the following commands:');
    console.error('\n  # If using global installation:');
    console.error('  npx playwright install');
    console.error('\n  # If using local installation:');
    console.error('  cd /path/to/your/project && npx playwright install');
    console.error('\n  # Or install only the required browser:');
    console.error('  npx playwright install chromium\n');
    process.exit(1);
  }

  console.log(`Fetching compositions from ${options.url}...`);
  let selectedComp: any = null;

  if (options.compositionId) {
    // If ID is provided, we can skip the heavy discovery if we want,
    // but for now let's just make it non-fatal if discovery fails but ID is present
    const compositions = await getCompositions(options.url, { inputProps, timeout }).catch(() => []);
    selectedComp = compositions.find((c: any) => c.id === options.compositionId);

    if (!selectedComp) {
      console.warn(`Composition "${options.compositionId}" not found via discovery, using default config.`);
      selectedComp = {
        id: options.compositionId,
        width: options.width || 1280,
        height: options.height || 720,
        fps: options.fps || 30,
        durationInFrames: options.duration || 100
      };
    }
  } else {
    const compositions = await getCompositions(options.url, { inputProps, timeout });
    if (compositions.length === 0) {
      console.error('No compositions found in the provided URL.');
      process.exit(1);
    }
    selectedComp = compositions[0];
  }

  const config = {
    width: options.width || selectedComp.width,
    height: options.height || selectedComp.height,
    fps: options.fps || selectedComp.fps,
    durationInFrames: options.duration || selectedComp.durationInFrames
  };

  console.log(`Rendering composition: ${selectedComp.id} (${config.width}x${config.height}, ${config.fps}fps, ${config.durationInFrames} frames)`);

  const multibar = new cliProgress.MultiBar({
    clearOnComplete: false,
    hideCursor: true,
    format: ' {bar} | {percentage}% | {value}/{total} | {task}',
  }, cliProgress.Presets.shades_grey);

  const renderBar = multibar.create(config.durationInFrames, 0, { task: 'Rendering' });

  const { audioAssets } = await renderFrames({
    url: options.url,
    config,
    outputDir: tmpDir,
    compositionId: selectedComp.id,
    inputProps,
    concurrency: options.concurrency || 1,
    publicDir: options.publicDir ? path.join(process.cwd(), options.publicDir) : undefined,
    onProgress: (frame) => renderBar.update(frame),
    timeout
  });

  renderBar.update(config.durationInFrames);

  // Helper to resolve audio paths to absolute file paths
  const resolveAssetPath = (src: string): string => {
    if (!src.startsWith('/') || src.startsWith('//')) {
      return src;
    }

    // Look for public folder based on user input or common locations
    const possiblePaths: string[] = [];

    if (options.publicDir) {
      possiblePaths.push(path.join(process.cwd(), options.publicDir, src.substring(1)));
    }

    // Common fallback paths
    const commonPaths = [
      path.join(process.cwd(), 'public', src.substring(1)),
      path.join(process.cwd(), 'static', src.substring(1)),
      path.join(process.cwd(), 'assets', src.substring(1)),
    ];

    for (const p of commonPaths) {
      if (!possiblePaths.includes(p)) {
        possiblePaths.push(p);
      }
    }

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return src;
  };

  // Resolve audio paths to absolute file paths if they are relative URLs
  const resolvedAudioAssets = audioAssets.map(asset => {
    if (asset.src.startsWith('/') && !asset.src.startsWith('//')) {
      const resolvedPath = resolveAssetPath(asset.src);
      return { ...asset, src: resolvedPath };
    }
    return asset;
  });

  const encodeBar = multibar.create(100, 0, { task: 'Encoding ' });

  // Determine output format
  let format = options.format || 'auto';
  if (format === 'auto') {
    const ext = path.extname(options.out).toLowerCase();
    if (ext === '.gif') format = 'gif';
    else if (ext === '.webp') format = 'webp';
    else if (ext === '.webm') format = 'webm';
    else format = 'mp4';
  }

  if (format === 'gif') {
    await encodeGif({
      framesDir: tmpDir,
      fps: config.fps,
      outputFile: options.out,
      width: config.width,
      height: config.height,
      onProgress: (percent) => encodeBar.update(Math.round(percent))
    });
  } else if (format === 'webp') {
    await encodeWebP({
      framesDir: tmpDir,
      fps: config.fps,
      outputFile: options.out,
      width: config.width,
      height: config.height,
      onProgress: (percent) => encodeBar.update(Math.round(percent))
    });
  } else {
    // Both MP4 and WebM use encodeVideo, the output format is determined by file extension
    await encodeVideo({
      framesDir: tmpDir,
      fps: config.fps,
      outputFile: options.out,
      audioAssets: resolvedAudioAssets,
      onProgress: (percent) => encodeBar.update(Math.round(percent))
    });
  }

  encodeBar.update(100);
  multibar.stop();

  const endTime = Date.now();
  const durationSec = ((endTime - startTime) / 1000).toFixed(1);

  console.log(`\nSuccess! Video rendered to ${options.out}`);
  console.log(`Total time: ${durationSec}s`);
};

/**
 * Renders a contact sheet: a grid of the given frames, laid out on one PNG.
 *
 * This is the feedback loop for an agent that authors scenes by data: render a
 * handful of frames, look at one image, change the recipe, repeat. Building
 * the sheet with the same browser that rendered the frames keeps the tool
 * dependency-free — no image library required.
 */
export const runFrames = async (options: {
  url: string;
  out: string;
  compositionId?: string;
  frames: number[];
  columns?: number;
  width?: number;
  height?: number;
  fps?: number;
  props?: string;
  publicDir?: string;
  chromiumPath?: string;
  timeout?: number;
}) => {
  const timeout = options.timeout || parseInt(process.env.OPEN_MOTION_RENDER_TIMEOUT || '300000', 10);

  if (options.chromiumPath) {
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = options.chromiumPath;
  }

  const inputProps = options.props ? JSON.parse(options.props) : {};
  const compositions = await getCompositions(options.url, { inputProps, timeout }).catch(() => []);

  let selectedComp: any = null;
  if (options.compositionId) {
    selectedComp = compositions.find((c: any) => c.id === options.compositionId);
  } else {
    selectedComp = compositions[0];
  }

  const config = {
    width: options.width || selectedComp?.width || 1280,
    height: options.height || selectedComp?.height || 720,
    fps: options.fps || selectedComp?.fps || 30,
    durationInFrames: selectedComp?.durationInFrames || 100
  };

  const frames = options.frames
    .filter((f) => f >= 0 && f < config.durationInFrames)
    .sort((a, b) => a - b);

  if (frames.length === 0) {
    console.error('No frames to render. Check --at and the composition duration.');
    process.exit(1);
  }

  const tmpDir = path.join(process.cwd(), '.open-motion-tmp', 'frames');
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`Rendering ${frames.length} frame(s) of "${selectedComp?.id || 'default'}" (${config.width}x${config.height})...`);

  await renderFrames({
    url: options.url,
    config,
    outputDir: tmpDir,
    compositionId: selectedComp?.id,
    inputProps,
    concurrency: 1,
    publicDir: options.publicDir ? path.join(process.cwd(), options.publicDir) : undefined,
    timeout,
    frames
  });

  const cells = frames.map((frame) => {
    const file = path.join(tmpDir, `frame-${frame.toString().padStart(5, '0')}.png`);
    if (!fs.existsSync(file)) {
      return null;
    }
    const bytes = fs.readFileSync(file);
    return {
      frame,
      dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
  }).filter(Boolean) as { frame: number; dataUri: string; sha256: string }[];

  console.log('\nFrame digests:');
  for (const cell of cells) {
    console.log(`  frame ${String(cell.frame).padStart(5)}  sha256 ${cell.sha256}`);
  }

  const columns = Math.max(1, options.columns || Math.min(3, cells.length));
  const cellWidth = 480;
  const cellHeight = Math.round((cellWidth * config.height) / config.width);
  const labelHeight = 28;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #11131a; font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #cbd5e1; }
  .grid { display: grid; grid-template-columns: repeat(${columns}, ${cellWidth}px); gap: 12px; padding: 12px; }
  figure { margin: 0; }
  img { display: block; width: ${cellWidth}px; height: ${cellHeight}px; border: 1px solid #2b3245; }
  figcaption { padding-top: 6px; color: #94a3b8; }
</style></head><body>
<div class="grid">
${cells.map((cell) => `  <figure><img src="${cell.dataUri}" /><figcaption>frame ${cell.frame}</figcaption></figure>`).join('\n')}
</div>
</body></html>`;

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--disable-dev-shm-usage', '--disable-setuid-sandbox', '--no-sandbox']
  });
  const page = await browser.newPage({
    viewport: { width: columns * cellWidth + (columns + 1) * 12, height: 800 }
  });
  await page.setContent(html);
  await page.waitForLoadState('networkidle');
  fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
  await page.screenshot({ path: path.resolve(options.out), type: 'png', fullPage: true });
  await browser.close();

  console.log(`\nContact sheet written to ${options.out}`);
};

// Read package.json version
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

export const main = () => {
  const program = new Command();

  program
    .name('open-motion')
    .description('CLI for OpenMotion')
    .version(pkg.version)
    .addHelpText('after', `
Quick Start:
  1. Initialize project:  $ open-motion init my-video
  2. Enter directory:     $ cd my-video
  3. Install deps:        $ pnpm install
  4. Start dev server:    $ pnpm dev
  5. Render video:        $ pnpm render

Example Usage:
  $ open-motion init my-project
  $ open-motion render -u http://localhost:5173 -o output.mp4 --composition main
`);

  program
    .command('init <name>')
    .description('Initialize a new OpenMotion project')
    .action(async (name) => {
      try {
        await runInit(name);
      } catch (err) {
        console.error('Init failed:', err);
        process.exit(1);
      }
    });

  const renderCommand = program
    .command('render')
    .description('Render a video')
    .requiredOption('-u, --url <url>', 'URL of the OpenMotion app')
    .requiredOption('-o, --out <path>', 'Output video file path')
    .option('-c, --composition <id>', 'ID of the composition to render')
    .option('-p, --props <json>', 'JSON string of props to pass to the composition')
    .option('-j, --concurrency <number>', 'Number of parallel browser instances', parseInt)
    .option('--width <number>', 'Override width', parseInt)
    .option('--height <number>', 'Override height', parseInt)
    .option('--fps <number>', 'Override FPS', parseInt)
    .option('--duration <number>', 'Override duration in frames', parseInt)
    .option('--public-dir <path>', 'Public directory path for static assets (default: "./public")')
    .option('--format <format>', 'Output format (mp4, webm, gif, webp, auto)', 'auto')
    .option('--chromium-path <path>', 'Custom path to Chromium executable')
    .option('--timeout <number>', 'Timeout for browser operations in milliseconds', parseInt)
    .action(async (options) => {
      try {
        await runRender({
          url: options.url,
          out: options.out,
          compositionId: options.composition,
          props: options.props,
          concurrency: options.concurrency,
          width: options.width,
          height: options.height,
          fps: options.fps,
          duration: options.duration,
          publicDir: options.publicDir,
          format: options.format,
          chromiumPath: options.chromiumPath,
          timeout: options.timeout
        });
      } catch (err) {
        console.error('Render failed:', err);
        process.exit(1);
      }
    });

  renderCommand.addHelpText('after', `
Examples:
  $ open-motion render -u http://localhost:5173 -o out.mp4
  $ open-motion render -u http://localhost:5173 -o out.mp4 --composition main --concurrency 4
  $ open-motion render -u http://localhost:3000 -o banner.gif --format gif --width 1200 --height 630
`);

  const framesCommand = program
    .command('frames')
    .description('Render selected frames and write them as one contact sheet PNG')
    .requiredOption('-u, --url <url>', 'URL of the OpenMotion app')
    .requiredOption('--at <frames>', 'Comma-separated frame numbers, e.g. 0,30,60')
    .option('-o, --out <path>', 'Output PNG path', './preview.png')
    .option('-c, --composition <id>', 'ID of the composition')
    .option('-p, --props <json>', 'JSON string of props to pass to the composition')
    .option('--columns <number>', 'Number of columns in the sheet', parseInt)
    .option('--width <number>', 'Override width', parseInt)
    .option('--height <number>', 'Override height', parseInt)
    .option('--fps <number>', 'Override FPS', parseInt)
    .option('--public-dir <path>', 'Public directory path for static assets (default: "./public")')
    .option('--chromium-path <path>', 'Custom path to Chromium executable')
    .option('--timeout <number>', 'Timeout for browser operations in milliseconds', parseInt)
    .action(async (options) => {
      try {
        const frames = options.at
          .split(',')
          .map((f: string) => parseInt(f.trim(), 10))
          .filter((f: number) => !isNaN(f));
        await runFrames({
          url: options.url,
          out: options.out,
          compositionId: options.composition,
          frames,
          columns: options.columns,
          width: options.width,
          height: options.height,
          fps: options.fps,
          props: options.props,
          publicDir: options.publicDir,
          chromiumPath: options.chromiumPath,
          timeout: options.timeout
        });
      } catch (err) {
        console.error('Frames failed:', err);
        process.exit(1);
      }
    });

  framesCommand.addHelpText('after', `
Examples:
  $ open-motion frames -u http://localhost:5173 --at 0,30,60 -o preview.png
  $ open-motion frames -u http://localhost:5173 --at 0,15,30,45 -c glb-explode --columns 4
`);

  program.parse(process.argv);
};
