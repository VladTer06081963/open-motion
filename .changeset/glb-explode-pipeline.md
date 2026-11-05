---
'@open-motion/components': minor
---

Add an agent-driven 3D pipeline: `useGltf`/`Glb` (meshopt-ready GLB loading),
`Explode` (disassemble/reassemble a model into its named parts as a pure
function of the frame), `Cutaway` (clipping-plane disassembly without semantic
parts), `Labels`, `Lights` and `Recipe` (a JSON scene recipe that is the
agent-facing API).

`ThreeCanvas` now accepts children, publishes scene/camera/renderer through
`useThree()`, and defaults `pixelRatio` to `1` so renders are byte-identical
across machines. An `invalidate()` hook lets children request a redraw when
they change the scene outside a frame change (for example when a GLB finishes
loading) — without it the first captured frame of a headless render was blank.

`@open-motion/components` is now a real workspace package with its own
`package.json` and `tsconfig.json`.
