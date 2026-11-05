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
