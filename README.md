![AI Logo](https://ai.peab.at/images/austro_intelligence_fb-titelbild.png)

# ai-brainmap

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blueviolet)](https://docs.anthropic.com/claude-code)
[![Made in Austria](https://img.shields.io/badge/Made%20in-Austria-red)](https://austro-intelligence.at)

## Live Context Visualizer for Claude

**See what Claude is thinking — in real time, in 2D or 3D.**

`ai-brainmap` turns Claude Code's invisible reasoning into a living mindmap. Every user prompt, tool call, and response is rendered on the fly, so you can *watch* your AI work instead of guessing what it's doing.

## Why it matters

- **Transparent thinking** — visualize Claude's context as it evolves
- **Live updates** — the map grows with every step, no refresh needed
- **2D or 3D** — force-directed graph, toggle on the fly
- **Zero cloud** — everything runs locally (Python + D3)

Open source. Lightweight. Built for developers who want clarity, not black boxes.

---

## Install (as a Claude Code plugin)

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

## How it works

- A local **Python HTTP server** keeps state and serves the D3.js frontend.
- Claude Code **hooks** (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) push events to the server.
- The browser **polls `/api/state`** every 500 ms and updates the force graph in place.
- Active nodes pulse yellow; finished nodes settle down.

## Repository layout

```
ai-brainmap/
├── .claude-plugin/
│   └── marketplace.json          # Marketplace manifest
├── plugins/
│   └── ai-brainmap/
│       ├── .claude-plugin/plugin.json
│       ├── bin/                  # Python server + hook bridge
│       ├── commands/             # /brainmap slash command
│       ├── hooks/hooks.json      # Claude Code hooks
│       └── public/index.html     # D3.js frontend
├── LICENSE
└── README.md
```

## Requirements

- Claude Code
- Python 3 (preinstalled on macOS/Linux)
- A modern browser

## Contributing

Issues and PRs welcome. To hack on it locally, clone the repo and register it as a local marketplace:

```text
/plugin marketplace add /path/to/ai-brainmap
```

## License

MIT — see [LICENSE](./LICENSE).

---

Made with ❤️ in 🇦🇹 by [Austro Intelligence](https://austro-intelligence.at).
