---
'@open-motion/cli': minor
'@open-motion/renderer': minor
---

Add `open-motion frames`: render a chosen list of frames and write them back
as a single contact-sheet PNG, plus the SHA-256 digest of every frame.

This closes the review loop for scenes authored by data: render a few frames,
look at one image, change the recipe, repeat. The digests make the render
verifiable — two runs of the same command print the same hashes, so a
regression in a recipe or in the engine is caught as a changed digest rather
than as "it looks different".

The sheet is composed by the same browser that rendered the frames, so the
command needs no image library.

`renderFrames` in `@open-motion/renderer` accepts a new `frames` option: an
explicit list of frame numbers to capture instead of the whole range.
