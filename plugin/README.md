# Live-Thinking-Mindmap — Claude Code Plugin

Visualisiert Claudes Arbeit live als interaktive Mindmap: jeder Nutzer-Prompt, jeder Tool-Call
und jeder Abschluss erscheint als Knoten. Aktive Aktionen pulsieren gelb, abgeschlossene
werden ruhig.

## Funktionsweise

- Lokaler Python-HTTP-Server (Port 4823) verwaltet den Zustand und serviert das D3.js-Frontend.
- Ein `PreToolUse`-Hook fügt für jeden Tool-Aufruf einen pulsierenden Knoten hinzu,
  `PostToolUse` markiert ihn als fertig.
- `UserPromptSubmit` trägt den Nutzer-Input ein, `Stop` markiert das Ende einer Antwort.
- Das Frontend pollt `/api/state` alle 500 ms (inkrementell via `since=`) und aktualisiert
  den Kraftgraphen in-place.

## Installation

1. Plugin-Verzeichnis in deinen Claude-Code-Plugins-Ordner kopieren oder verlinken.
2. Plugin in den Settings aktivieren.
3. In Claude Code eingeben: `/mindmap start`
4. Browser öffnet automatisch <http://127.0.0.1:4823>.

### Struktur

```
plugin/
├── .claude-plugin/plugin.json
├── hooks/hooks.json                 # PreToolUse, PostToolUse, UserPromptSubmit, Stop
├── commands/mindmap.md              # Slash-Command /mindmap
├── bin/
│   ├── mindmap-server.py            # HTTP-Server + State-API
│   └── mindmap-hook.py              # Hook-Brücke (stdin → POST)
└── public/index.html                # D3.js Frontend
```

## Slash-Commands

| Command          | Wirkung                                 |
|------------------|-----------------------------------------|
| `/mindmap start` | Server starten (Port 4823), Browser öffnen |
| `/mindmap stop`  | Server beenden                          |
| `/mindmap status`| Läuft der Server?                       |
| `/mindmap clear` | Mindmap leeren                          |

## Anpassen

- **Port**: Umgebungsvariable `MINDMAP_PORT` setzen.
- **Hook-Filter**: `hooks/hooks.json` — `matcher` auf einzelne Tools einschränken.
- **Layout / Farben**: `public/index.html` (D3-Force-Parameter und CSS).

## Hinweise

- Hooks schlagen still fehl, wenn der Server nicht läuft — Claude wird nie blockiert.
- Positionen bestehender Knoten bleiben beim Hinzufügen neuer erhalten.
- Abhängigkeiten: `python3` (Standard auf macOS/Linux), moderner Browser.
