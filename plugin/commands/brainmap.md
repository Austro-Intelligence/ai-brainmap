---
description: Brainmap — Live-Thinking-Mindmap steuern
allowed-tools: Bash
argument-hint: "[start|stop|status|clear]"
---

Verwalte den Brainmap-Server.

Action: $ARGUMENTS

Wenn `start` oder leer:
- Prüfe ob Server schon läuft (`curl -sf http://127.0.0.1:4823/api/ping`).
- Wenn nicht: Starte im Hintergrund `python3 "${CLAUDE_PLUGIN_ROOT}/bin/mindmap-server.py" &` mit `disown` und logge nach `/tmp/brainmap.log`.
- Öffne http://127.0.0.1:4823 im Standardbrowser (`open http://127.0.0.1:4823` auf macOS).
- Melde die URL zurück.

Wenn `stop`:
- `curl -s -X POST http://127.0.0.1:4823/api/shutdown` (oder pkill -f mindmap-server.py)

Wenn `status`:
- `curl -sf http://127.0.0.1:4823/api/ping` und melde laufend/nicht laufend.

Wenn `clear`:
- `curl -s -X POST http://127.0.0.1:4823/api/clear` zum Leeren der Mindmap.
