# ai-brainmap

**Live Context Visualizer for Claude.**

ai-brainmap is an open-source plugin for [Claude Code](https://claude.com/claude-code) that turns Claude's reasoning process into a live, interactive mindmap. Instead of reading linear logs, you watch context unfold visually — thoughts, decisions, and branches rendered on the fly as Claude works.

---

## Why ai-brainmap

Modern AI agents juggle large, evolving contexts. Understanding *what* the model is focusing on — and *when* it drifts — is hard from a scrollback buffer alone.

ai-brainmap surfaces that context as a structured map:

- **Transparent reasoning** — see the shape of Claude's current context at a glance.
- **Live updates** — the map evolves with every tool call and thought, no manual refresh.
- **Faster course correction** — spot detours early and steer the session before time is wasted.
- **Low friction** — install the plugin, run the command, open the preview.

## Features

- Real-time visualization of Claude's context and reasoning flow
- Local web preview — nothing leaves your machine
- Hook-based integration with Claude Code (no wrapper, no proxy)
- Lightweight Python server, zero heavy dependencies
- Fully open source under a permissive license

## Installation

```bash
git clone https://github.com/Austro-Intelligence/ai-brainmap.git
```

Register the plugin with Claude Code, then invoke it in any session:

```
/brainmap
```

Open the preview URL printed in the terminal to watch the mindmap update live.

## Project Structure

```
plugin/
├── .claude-plugin/    Plugin manifest
├── bin/               Hook and server (Python)
├── commands/          Slash command definitions
├── hooks/             Hook configuration
└── public/            Web preview UI
```

## Status

Early release. APIs and visuals may change. Feedback, issues, and pull requests are welcome.

## License

Open source. See [LICENSE](LICENSE) for details.

---

Built by [Austro Intelligence](https://github.com/Austro-Intelligence).
