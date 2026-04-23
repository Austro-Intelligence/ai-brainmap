# CLAUDE.md — ai-brainmap

Leitfaden für Claude Code Agents, die in diesem Repo arbeiten.

## Projekt

**ai-brainmap** ist ein Claude-Code-Plugin, das Claudes Arbeit live als
interaktive 2D/3D-Mindmap visualisiert. Jeder User-Prompt, Tool-Call und
Assistant-Text wird ein Knoten im Graphen; der Baum wächst additiv.

- **Marketplace**: Austro-Intelligence Plugin-Marketplace
- **Lizenz**: MIT
- **Version**: siehe `plugins/ai-brainmap/.claude-plugin/plugin.json`
- **Repo**: https://github.com/Austro-Intelligence/ai-brainmap

## Architektur

```
┌──────────────────┐      ┌────────────────────┐      ┌──────────────────┐
│  Claude-Code     │ hook │  mindmap-server.py │ SSE  │ public/index.html│
│  (User-Prompts,  │─────▶│  (Python, 127.0.0.1│─────▶│ (D3 + 3d-force-  │
│   Tool-Calls)    │ POST │   Port 4823)       │ push │  graph + three.js│
└──────────────────┘      └────────────────────┘      └──────────────────┘
         │                          ▲
         │                          │ tail
         ▼                          │
   ~/.claude/projects/…/*.jsonl ────┘  (TranscriptWatcher liest live mit)
```

### Komponenten

| Pfad | Rolle |
|---|---|
| `plugins/ai-brainmap/bin/mindmap-server.py` | HTTP-Server + In-Memory-State + SSE-Push + LLM-Clusterer + TranscriptWatcher |
| `plugins/ai-brainmap/bin/mindmap-hook.py` | Hook-Bridge — wird von Claude Code bei jedem Event aufgerufen, POST-et an den Server (fail-silent) |
| `plugins/ai-brainmap/hooks/hooks.json` | Registriert die 4 Hook-Typen (UserPromptSubmit, PreToolUse, PostToolUse, Stop) |
| `plugins/ai-brainmap/public/index.html` | Komplettes Frontend in einer Datei — HTML + CSS + JS + D3-Graph + WebGL-3D |
| `plugins/ai-brainmap/commands/brainmap.md` | `/brainmap`-Slash-Command |

## Event-Flow (von Prompt bis zum Knoten)

1. **User tippt Prompt** → `UserPromptSubmit`-Hook feuert
2. `mindmap-hook.py user_prompt` liest Payload aus stdin, `POST /api/thought`
3. Server: `add_thought()` → Ringbuffer (max 2000) + O(1)-Index, seq++
4. `_mark_dirty()` → alle SSE-Clients aufgeweckt via `STATE_CONDVAR`
5. Frontend `EventSource('/api/stream')` empfängt Delta → `applyState()` → `rebuild()`

Analog für `PreToolUse`/`PostToolUse` (mit `status: thinking` → `done`-Patch)
und `Stop`. `TranscriptWatcher` tailt zusätzlich das aktuelle
`~/.claude/projects/…/*.jsonl` und pusht `thinking`/`assistant_text`-Blöcke
aus dem Transkript — dedupliziert via stabile IDs.

## Port & Konfiguration

- Default **Port 4823** (override via `MINDMAP_PORT`)
- LLM-Config: `~/.claude/brainmap-llm.json` (für lokales LM-Studio/Ollama-Clustering)
- Settings (Frontend): `localStorage['mindmap-settings-v1']`

## State-Shape (`STATE` im Server)

```python
STATE = {
    "thoughts": deque(maxlen=2000),      # Ringbuffer
    "_thought_index": {id: entry},       # O(1) Lookup
    "seq": int,                           # monotoner Counter, Quelle für SSE-Deltas
    "current_prompt": {session_id: id},  # letzter User-Prompt pro Session
    "llm_cluster": {...},                 # LLM-Output (Mindmap-Ast "Mindmap")
    "llm_next_refresh": timestamp,        # UI-Countdown
    "llm_status": "idle"|"running"|"error:…",
}
```

## Thought-Shape

```python
{
    "id": str,             # stabile ID, für Idempotenz und Dedupe
    "kind": "user_prompt"|"tool"|"thinking"|"assistant_text",
    "parent": str,         # Bucket-Name: "Topics"|"Tools"|"Web"|"Agents"|"Thoughts"|"Mindmap"
    "parent_id": str,      # optional, verweist auf user_prompt
    "text": str,           # Label im Graph (truncated 70-80 chars)
    "status": "thinking"|"done",
    "detail": {…},         # Volltext für Side-Panel
    "seq": int,            # assigned by server
    "ts": float,           # unix timestamp
    "session_id": str,
    "transcript_path": str,
}
```

## API-Endpunkte

| Methode | Pfad | Zweck |
|---|---|---|
| GET  | `/api/ping` | Healthcheck |
| GET  | `/api/stream?since=N` | **SSE** — pusht Deltas bei jeder State-Mutation, Heartbeat alle 10 s |
| GET  | `/api/state?since=N` | Polling-Fallback (für alte Browser ohne EventSource) |
| GET  | `/api/context?id=…` | Rekonstruiert Frage/Antwort-Kontext aus Transkript |
| GET  | `/api/llm/config` · `/models` | LLM-Settings |
| POST | `/api/thought` | Neuen Thought pushen (von `mindmap-hook.py`) |
| POST | `/api/thought/patch` | Thought-Status updaten (`thinking` → `done`) |
| POST | `/api/clear` | State leeren |
| POST | `/api/replay` | Vergangenes Transkript in den State laden |
| POST | `/api/llm/config` · `/refresh` | LLM-Konfig ändern / Re-Cluster sofort |
| POST | `/api/shutdown` | Server terminiert sich |

## Konventionen

- **Sprachen-Mix**: Kommentare meist Deutsch, Code-Identifier Englisch. Bleib
  konsistent mit dem jeweiligen File.
- **Fail-silent-Hooks**: `mindmap-hook.py` blockiert Claude NIEMALS —
  Server offline = Hook schluckt Fehler.
- **ID-Stabilität**: Thought-IDs müssen deterministisch sein (Pattern:
  `{sid}-{kind}-{index}` oder `{sid}-tool-{tool_use_id}`) damit
  `TranscriptWatcher` und `mindmap-hook.py` koexistieren können ohne Duplikate.
- **No-break-UX**: Frontend-Änderungen immer gegen laufende Session testen:
  `/brainmap start`, dann live mit Claude arbeiten.

## Typische Tasks

### Frontend-Änderung (Graph-Verhalten, UI, Styling)
Alles in `plugins/ai-brainmap/public/index.html`. Die Datei ist **groß
(3000+ Zeilen)** — nutze `Grep` für schnelle Navigation:
- Force-Simulation: suche `forceSimulation`, `d3VelocityDecay`, `OrbitControls`
- Rendering: suche `rebuild`, `tick`, `update3D`, `animLoop`
- Settings: suche `settings.`, `SETTINGS_KEY`
- SSE: suche `setupStream`, `applyState`

### Server-Änderung (State, Endpunkt, LLM)
`mindmap-server.py`. Wichtig: alle STATE-Mutationen via `with STATE_LOCK:`
und danach `_mark_dirty()` außerhalb des Locks für SSE-Push.

### Neuer Hook-Typ
1. `plugins/ai-brainmap/hooks/hooks.json` registrieren
2. `mindmap-hook.py` — neuen `kind` in `main()` behandeln
3. Ggf. `bucket_for()` / `summarize_tool_input()` anpassen

### Debug
- Logs: `print(..., flush=True)` im Server (stdout geht an launch.json-Prozess)
- Browser-Konsole: Claude kann diese über `mcp__Claude_Preview__preview_console_logs` auslesen
- State-Dump: `curl http://127.0.0.1:4823/api/state` liefert JSON

## Nicht tun

- **Keine** neuen Dateien ohne expliziten Grund — das Frontend ist absichtlich
  eine einzige `index.html` (kein Build-Step, null Runtime-Dependencies
  außer CDN-Libs).
- **Keine** blockierenden Operations im Hook (Timeout = 0.4 s). Alles, was
  länger dauert, gehört in den Server.
- **Keine** `STATE["thoughts"] = [...]` — das zerstört den `deque`-Ringbuffer.
  Stattdessen `.clear()` + `.append(...)` + Index-Update.
- **Keine** `rebuild()`-Aufrufe in Hot-Paths — `rebuild()` macht d3.hierarchy +
  SVG-Diff + WebGL-Update. Für Micro-Updates (z.B. Selection-Highlight) direkt
  die D3-Selection togglen.

## Shortcuts (im laufenden Brainmap-UI)

| Key | Action |
|---|---|
| `f` | Auto-Fit / Kamerafahrt zentrieren |
| `Cmd/Ctrl+K` | Suche fokussieren |
| `Esc` | Panel schließen, dann Suche leeren |
| `c` | Suche leeren |
