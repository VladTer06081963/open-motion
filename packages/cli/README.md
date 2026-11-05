# @open-motion/cli

The Command Line Interface for **OpenMotion** — the open-source programmatic video engine.

## 🚀 Features

- 🏗️ **Quick Init**: Scaffold new OpenMotion projects instantly.
- 🎥 **High-Speed Rendering**: Capture and encode videos directly from your React code.
- 🚀 **Parallel Execution**: Leverage multi-core CPUs for faster frame capturing.
- 🎛️ **Dynamic Props**: Inject external data into your videos via JSON.
- 🖼️ **Contact Sheets**: Render a few frames and get them back as one grid PNG — the review loop for an agent that authors scenes by data.

## 🛠 Installation

```bash
npm install -g @open-motion/cli
# or use via npx
npx @open-motion/cli --help
```

## 📖 Usage

### Initialize a project
```bash
open-motion init my-video
```

### Render a video
```bash
open-motion render --url http://localhost:5173 --out out.mp4 --concurrency 4
```

### Render a contact sheet
```bash
open-motion frames --url http://localhost:5173 --at 0,30,60 --out preview.png
```

Renders only the listed frames, prints their SHA-256 digests and writes one
grid PNG. This is the loop for authoring scenes from a JSON recipe: render a
few frames, look at one image, change the recipe, repeat. The digests also
make the render verifiable — two runs of the same command must print the same
hashes.

```bash
# deterministic check
open-motion frames -u http://localhost:5173 --at 0,30,60 -o a.png | grep sha256
open-motion frames -u http://localhost:5173 --at 0,30,60 -o b.png | grep sha256
```

Learn more at the [main OpenMotion repository](https://github.com/jsongo/open-motion).
