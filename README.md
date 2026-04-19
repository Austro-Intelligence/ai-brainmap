![AI Logo](https://ai.peab.at/images/austro_intelligence_fb-titelbild.png)

# ai-brainmap

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blueviolet)](https://docs.anthropic.com/claude-code)
[![Made in Austria](https://img.shields.io/badge/Made%20in-Austria-red)](https://austro-intelligence.at)
[![Version](https://img.shields.io/badge/version-0.5.0-green)](./plugins/ai-brainmap/.claude-plugin/plugin.json)

## Live Context Visualizer for Claude Code

**See what Claude is thinking — in real time, in 2D or 3D.**

`ai-brainmap` turns Claude Code's invisible reasoning into a living mindmap. Every
user prompt, tool call and response is rendered on the fly, so you can *watch*
your AI work instead of guessing what it's doing.

Open source. Lightweight. 100 % local. Built for developers who want clarity, not
black boxes.

---

## Install

```text
/plugin marketplace add Austro-Intelligence/ai-brainmap
/plugin install ai-brainmap@austro-intelligence
```

Then in any Claude Code session:

```text
/brainmap start   # start server + open browser
/brainmap stop    # stop server
/brainmap status  # is it running?
/brainmap clear   # reset the map
```

The server listens on <http://127.0.0.1:4823>. Set `MINDMAP_PORT` to change the port.

---

## How it works

```
┌─────────────────┐   hook payload     ┌────────────────────┐
│ Claude Code     │ ─────────────────> │ mindmap-hook.py    │
│ (your session)  │                    │ (tiny HTTP client) │
└─────────────────┘                    └─────────┬──────────┘
                                                 │ POST /api/thought
                                                 ▼
                                       ┌────────────────────┐
                                       │ mindmap-server.py  │
                                       │ (localhost:4823)   │
                                       │ in-memory state    │
                                       └─────────┬──────────┘
                                                 │ GET /api/state (polling)
                                                 ▼
                                       ┌────────────────────┐
                                       │ public/index.html  │
                                       │ Three.js + D3      │
                                       │ force-graph in the │
                                       │ browser            │
                                       └────────────────────┘
```

- A local **Python HTTP server** keeps state and serves the Three.js + D3 frontend.
- Claude Code **hooks** (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`)
  push events to the server.
- The browser **polls `/api/state`** every 500 ms and updates the force graph
  in place.
- Active nodes pulse yellow; finished nodes settle into place.

---

## Repository layout

```
ai-brainmap/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace manifest
├── plugins/
│   └── ai-brainmap/
│       ├── .claude-plugin/plugin.json
│       ├── bin/
│       │   ├── mindmap-server.py # HTTP server + state API
│       │   └── mindmap-hook.py   # Hook bridge (stdin → POST)
│       ├── commands/brainmap.md  # /brainmap slash command
│       ├── hooks/hooks.json      # Claude Code hooks
│       ├── public/index.html     # Three.js + D3 frontend
│       └── README.md
├── LICENSE
└── README.md
```

---

## Requirements

- Claude Code
- Python 3 (preinstalled on macOS/Linux; use the official installer or WSL on Windows)
- A modern browser with WebGL (Chrome, Safari, Firefox, Edge)

---

## Privacy & security

- **Fully local.** The Python server binds to `127.0.0.1:4823` only. There are
  no outbound network calls from the server or the frontend.
- **No telemetry.** Your prompts and tool calls never leave your machine.
- **Hook failure is silent.** If the server is not running the hook bridge
  returns immediately — Claude Code is never blocked by the plugin.
- **Read-only of your own transcript.** An optional replay endpoint
  (`POST /api/replay`) reads a Claude transcript file you pass in and
  visualizes its history; it does not access arbitrary files.

---

## Customize

- **Port**: set `MINDMAP_PORT` in the environment.
- **Hook filter**: edit `plugins/ai-brainmap/hooks/hooks.json` — narrow the
  `matcher` to specific tools if you want a quieter map.
- **Look & feel**: everything lives in `plugins/ai-brainmap/public/index.html`
  (Three.js scene graph, D3 force parameters, CSS).

---

## Contributing

Issues and PRs welcome. To hack locally, clone the repo and register it as a
local marketplace:

```text
/plugin marketplace add /path/to/ai-brainmap
/plugin install ai-brainmap@austro-intelligence
```

Then edit files under `plugins/ai-brainmap/` and reload the browser — changes
in `public/index.html` are picked up on refresh.

---

## License

MIT — see [LICENSE](./LICENSE).

---

Made with ❤️ in 🇦🇹 by [Austro Intelligence](https://austro-intelligence.at).
