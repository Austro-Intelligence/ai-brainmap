---
description: Control the Brainmap live-thinking-mindmap server
allowed-tools: Bash
argument-hint: "[start|stop|status|clear|topictree]"
---

You manage the Brainmap server lifecycle. Pick the action from `$ARGUMENTS` (default: `start`).

### Action: `start` (or empty)

1. Check whether the server is already running:
   `curl -sf http://127.0.0.1:4823/api/ping`
2. If not, start it in the background and detach it from the session:
   ```bash
   nohup python3 "${CLAUDE_PLUGIN_ROOT}/bin/mindmap-server.py" \
     > /tmp/brainmap.log 2>&1 &
   disown
   ```
3. Open the frontend in the user's default browser:
   - macOS: `open http://127.0.0.1:4823`
   - Linux: `xdg-open http://127.0.0.1:4823` (fall back to `python3 -m webbrowser http://127.0.0.1:4823`)
   - Windows (Git Bash / WSL): `cmd.exe /c start http://127.0.0.1:4823`
4. Report the URL back.

### Action: `stop`

```bash
curl -s -X POST http://127.0.0.1:4823/api/shutdown || pkill -f mindmap-server.py
```

### Action: `status`

```bash
curl -sf http://127.0.0.1:4823/api/ping && echo "running" || echo "not running"
```

### Action: `clear`

```bash
curl -s -X POST http://127.0.0.1:4823/api/clear
```

Reset the mindmap to an empty tree.

### Action: `topictree`

Opens the cluster-centric view: LLM-found clusters become the main branches, with their items grouped per category (Topics green, Tools yellow, Web cyan, Agents purple, Thoughts pink). Empty categories/clusters are hidden automatically.

1. Ensure the server is running (same check as `start`); start it in the background if not.
2. Open the frontend with the `view=topictree` URL parameter:
   - macOS: `open "http://127.0.0.1:4823/?view=topictree"`
   - Linux: `xdg-open "http://127.0.0.1:4823/?view=topictree"` (fallback `python3 -m webbrowser "http://127.0.0.1:4823/?view=topictree"`)
   - Windows (Git Bash / WSL): `cmd.exe /c start "http://127.0.0.1:4823/?view=topictree"`
3. Report the URL back.

The default view (`start`) and the `topictree` view can run in separate browser tabs at the same time — both read the same live session.
