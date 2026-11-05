# @open-motion/components

React components for OpenMotion, including a GLB/three.js pipeline built for
**agent-driven 3D authoring**.

## What is here

| Export | Purpose |
| --- | --- |
| `ThreeCanvas` | three.js canvas bound to the OpenMotion frame clock. Publishes scene/camera/renderer through context. `pixelRatio` defaults to `1` so renders are byte-identical across machines. |
| `useThree()` | Access to the live scene, camera, renderer and `invalidate()`. |
| `useGltf(src)` / `Glb` | Loads a `.glb` (glTF 2.0 binary). Meshopt-compressed assets work out of the box: the loader is set up with `MeshoptDecoder`. |
| `Explode` | Disassembles a model into its named parts and reassembles it. Pure function of the frame. |
| `Cutaway` | Clips the model with three.js clipping planes — "disassembly" without needing semantic parts. |
| `Labels` | HTML labels pinned to parts, projected from live world positions. |
| `Recipe` | Renders a JSON scene recipe: model + camera + effects. This is the agent-facing API. |
| `Lights` | Default three-point lighting (a GLB carries no lights). |
| `collectParts`, `computeExplode`, `computeDirections` | The pure geometry math behind the choreography — usable outside React. |

## The idea

The engine does not know about your scene. It knows about **recipes**: JSON
documents that describe a model, a camera and a list of timed effects. An
agent edits the JSON, never the JSX and never the binary asset. Every change
is diffable, reviewable and reproducible.

```json
{
  "model": { "src": "/models/s1045_lod3.glb" },
  "camera": { "fov": 35, "orbit": { "degrees": 40, "durationInFrames": 60 } },
  "effects": [
    { "type": "explode", "field": "radial", "lambda": 1.1, "startFrame": 10, "durationInFrames": 50 }
  ]
}
```

## Determinism rules (please keep them)

* No `Date.now()`, no `Math.random()`, no `performance.now()`, no `mixer.update(dt)`.
* Everything is a function of the current frame.
* `mixer.setTime(frame / fps)` — never `update(delta)`.
* `pixelRatio = 1` unless you deliberately want a Retina-resolution render.
* Assets are pinned by sha256 in a manifest.

## GLB contract

For an asset to be usable by an agent it must be:

* Y-up, metres, ground at Y = 0;
* every part a **named** node (`femur_left`, `seat_cushion`, …);
* one file per asset, no external textures;
* meshopt-compressed if you care about size (one extra decoder line in the loader).

See `examples/glb-explode` for a complete, runnable pipeline.
