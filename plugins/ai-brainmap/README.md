# ai-brainmap — Claude Code Plugin

Visualizes Claude's work live as an interactive mindmap: every user prompt, tool call,
and completion appears as a node. Active actions pulse yellow; completed ones settle.

## How it works

- A local Python HTTP server (port 4823) holds the state and serves the D3.js frontend.
- A `PreToolUse` hook adds a pulsing node for every tool call; `PostToolUse` marks it done.
- `UserPromptSubmit` adds the user input; `Stop` marks the end of a response.
- The frontend polls `/api/state` every 500 ms (incrementally via `since=`) and updates
  the force graph in place.

## Install

```text
/plugin marketplace add Austro-Intelligence/ai-brainmap
/plugin install ai-brainmap@austro-intelligence
/brainmap start
```

The browser opens automatically at <http://127.0.0.1:4823>.

### Layout

```
ai-brainmap/
├── .claude-plugin/plugin.json
├── hooks/hooks.json                 # PreToolUse, PostToolUse, UserPromptSubmit, Stop
├── commands/brainmap.md             # Slash command /brainmap
├── bin/
│   ├── mindmap-server.py            # HTTP server + state API
│   └── mindmap-hook.py              # Hook bridge (stdin → POST)
└── public/index.html                # D3.js frontend
```

## Slash commands

| Command            | Effect                                     |
|--------------------|--------------------------------------------|
| `/brainmap start`  | Start the server (port 4823), open browser |
| `/brainmap stop`   | Stop the server                            |
| `/brainmap status` | Is the server running?                     |
| `/brainmap clear`  | Clear the mindmap                          |

## Customize

- **Port**: set the `MINDMAP_PORT` environment variable.
- **Hook filter**: `hooks/hooks.json` — restrict `matcher` to specific tools.
- **Layout / colors**: `public/index.html` (D3 force parameters and CSS).

## Notes

- Hooks fail silently if the server is not running — Claude is never blocked.
- Existing node positions are preserved when new nodes are added.
- Dependencies: `python3` (standard on macOS/Linux), modern browser.

## License

MIT — see the top-level [LICENSE](../../LICENSE).
