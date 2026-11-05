# glb-explode — agent-driven 3D in OpenMotion

End-to-end example: load a GLB, take it apart into named parts, put it back
together, label the parts — all driven by a JSON recipe, rendered by
OpenMotion into PNG frames / video.

The asset is a real CT segmentation (TotalSegmentator, University Hospital
Basel, CC BY 4.0) converted to GLB: 115 named nodes, meshopt-compressed,
265 KB.

## Run it

```bash
pnpm install
pnpm --filter glb-explode build

# verify the pinned asset bytes
node examples/glb-explode/scripts/verify-assets.mjs

# serve the built app
npx http-server examples/glb-explode/dist -p 5173 -a 127.0.0.1 &

# review loop: render a few frames, get one grid PNG
node packages/cli/dist/bin.js frames -u http://127.0.0.1:5173 --at 0,30,60 \
  -c glb-explode -o preview.png --public-dir examples/glb-explode/public
```

The command prints the SHA-256 of every frame it rendered — the same digests
twice mean the render is reproducible.

## The recipe is the API

`public/recipes/anatomy-explode.json` is what an agent edits:

```json
{
  "model": { "src": "/models/s1045_lod3.glb" },
  "background": "#05070d",
  "effects": [
    { "type": "explode", "field": "radial", "lambda": 1.1, "startFrame": 10, "durationInFrames": 50 },
    { "type": "labels", "parts": ["aorta", "liver", "femur_left"], "startFrame": 30, "durationInFrames": 90 }
  ]
}
```

No JSX changes, no re-export of the GLB, no re-encoding of the mesh.

## Explode fields

| Field | Behaviour |
| --- | --- |
| `radial` | Each part moves away from the centroid. Degenerates for parts sitting exactly on the centroid and for symmetric groups. |
| `hierarchical` | A part moves away from its nearest part ancestor. |
| `symmetric-fan` | Same-sized parts (four chair legs, vertebrae) are spread around their group axis. |
| `manual` | Explicit directions per part name. |

Shared knobs: `lambda` (distance), `window` (time window per part), `delay`
(`none` / `by-depth` / `by-radius`), `easing`, `spin`, `minDistanceFactor`,
`manualDirections`.

## Determinism check

Rendering the same frame twice must produce the same bytes:

```bash
open-motion frames -u http://localhost:5173 --at 20 -c glb-explode | grep sha256
open-motion frames -u http://localhost:5173 --at 20 -c glb-explode | grep sha256
```

Verified identical on the same machine (frame 20 → `6e0ce382…`, contact sheet
→ `b853faed…`). Cross-machine equality additionally requires the same Chromium
build and the same GPU backend.

## Files

| Path | Purpose |
| --- | --- |
| `public/models/s1045_lod3.glb` | The asset (pinned by sha256 in the manifest) |
| `public/assets.manifest.json` | sha256, source, author, license, compression |
| `public/recipes/anatomy-explode.json` | The scene recipe (the agent's API) |
| `src/App.tsx` | Composition + recipe loading (delayed until the recipe is fetched) |
| `src/DebugProbe.tsx` | Dumps scene state into `window.__DEBUG__` for headless inspection |
| `scripts/render-smoke.mjs` | Headless render of a frame range |
| `scripts/debug-scene.mjs` | Opens the page and reports console output, WebGL backend and scene stats |
| `scripts/verify-assets.mjs` | Checks the manifest hashes |
| `scripts/fetch-assets.mjs` | Downloads the assets from the manifest and verifies them |
| `scripts/glb-inventory.mjs` | Scans a Hugging Face dataset of GLB files and reports how many named parts each asset actually has |

## Asset inventory

Before you promise "any object comes apart", check what the asset really
contains. `glb-inventory.mjs` reads only the JSON chunk of each GLB (the binary
buffer is never decoded) and reports the number of named mesh nodes — that is
the number of parts the explode workflow can move.

```bash
node scripts/glb-inventory.mjs --repo codepawl/scanned-objects-glb --manifest --sample 12
node scripts/glb-inventory.mjs --repo codepawl/ct-anatomy-glb --manifest --sample 7
```

Measured on the public catalogs (2026-11-05):

| Dataset | Files | Named mesh nodes per asset | Usable for explode |
| --- | --- | --- | --- |
| `codepawl/scanned-objects-glb` | 1033 | 1 (single mesh) | no — cutaway only |
| `codepawl/abo-glb` | 7953 | 1 (single mesh) | no — cutaway only |
| `codepawl/ct-anatomy-glb` | 27 | 113–115 (semantic organs) | yes |

So "any object can be taken apart" is false for off-the-shelf furniture
catalogs: they ship one merged mesh per file. Two ways out — use `cutaway`
(which needs no parts at all), or run the decomposition step that turns one
mesh into named parts.

The `--manifest` flag reads the dataset's `metadata.jsonl` instead of walking
the tree API, which is rate-limited hard.
