# ai-brainmap — Claude Code Plugin

Visualize Claude's work live as an interactive 2D/3D mindmap. Every user prompt,
tool call and response becomes a glowing node; the tree grows additively as
Claude works.

## Features

- HDR-style **sun root** with procedural texture, bloom halo, flame protuberances,
  sparks, micro-explosions and solar-storm bursts — all sine-eased
- **Screen-space node picker** (26 px pixel radius, label-aware) — reliable
  clicks even on the tiniest leaves
- **Hover highlight** with camera-facing glow + scale ease
- **"+" marker** inside collapsed structure nodes, square canvas texture
  (white fill, black outline), sine-eased fade
- **Additive tree growth** via position cache — existing nodes stay put
  forever, new nodes flow organically out of their parent
- **Search-to-zoom** — every keystroke re-fits the viewport onto the BBox of
  current hits via `forceGraph3d.zoomToFit`
- **Bucket-colored sub-trees** — Werkzeuge yellow / Web turquoise / Agenten purple
- **Click the sun** to expand the entire tree

## Install

```text
/plugin marketplace add Austro-Intelligence/ai-brainmap
/plugin install ai-brainmap@austro-intelligence
/brainmap start
```

The browser opens automatically at <http://127.0.0.1:4823>.

## Slash commands

| Command            | Effect                                     |
|--------------------|--------------------------------------------|
| `/brainmap start`  | Start the server (port 4823), open browser |
| `/brainmap stop`   | Stop the server                            |
| `/brainmap status` | Is the server running?                     |
| `/brainmap clear`  | Clear the mindmap                          |

## How it works

- A local **Python HTTP server** holds state and serves the frontend.
- Claude Code hooks (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`)
  push events to `POST /api/thought` via a tiny bridge script.
- The browser polls `GET /api/state` every 500 ms (incrementally via
  `since=`) and updates a `three.js` + `3d-force-graph` scene in place.
- Hooks fail silently if the server is not running — Claude Code is never
  blocked by the plugin.

## Layout

```
ai-brainmap/
├── .claude-plugin/plugin.json
├── hooks/hooks.json              # PreToolUse, PostToolUse, UserPromptSubmit, Stop
├── commands/brainmap.md          # /brainmap slash command
├── bin/
│   ├── mindmap-server.py         # HTTP server + state API
│   └── mindmap-hook.py           # Hook bridge (stdin → POST)
└── public/index.html             # Three.js + D3 frontend
```

## Customize

- **Port**: set `MINDMAP_PORT` environment variable.
- **Hook filter**: `hooks/hooks.json` — restrict `matcher` to specific tools
  if you want a quieter map.
- **Layout / colors**: `public/index.html` (Three.js scene + CSS).

## Privacy & security

- Fully local — the Python server binds to `127.0.0.1:4823` only. No outbound
  network calls.
- No telemetry. Your prompts and tool calls never leave your machine.

## Requirements

- Claude Code
- Python 3
- A modern browser with WebGL

## License

MIT — see the top-level [LICENSE](../../LICENSE).
