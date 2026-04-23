#!/usr/bin/env python3
"""Live-Thinking-Mindmap HTTP-Server.

Serviert das statische Frontend aus ../public und verwaltet einen In-Memory-State
der aktuellen Gedanken-Events. Hook-Scripts pushen via POST /api/thought.
Der Browser pollt GET /api/state.
"""
from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import urllib.error
import urllib.request

PORT = int(os.environ.get("MINDMAP_PORT", "4823"))
PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

# Ringbuffer-Obergrenze fuer Thoughts im State. Verhindert unbegrenztes
# Memory-Wachstum in Marathon-Sessions. Die UI zeigt ohnehin Aging-Opacity,
# aeltere Knoten fallen visuell raus — ein hoher Cap reicht.
MAX_THOUGHTS = 2000

STATE_LOCK = threading.RLock()
# Condition-Variable fuer SSE-Clients: jede State-Mutation signalisiert allen
# wartenden Clients, die dann den Delta pushen koennen. Seq-Counter ist die
# Quelle der Wahrheit fuer "hat sich was geaendert" — verhindert spurious
# wakeups und busy-loops.
STATE_CONDVAR = threading.Condition(STATE_LOCK)
STATE = {
    "started_at": time.time(),
    "thoughts": deque(maxlen=MAX_THOUGHTS),  # Ringbuffer: aeltester fliegt automatisch raus
    "_thought_index": {},  # id -> entry (O(1) Lookup; synchron zu "thoughts")
    "seq": 0,
    "current_prompt": {},  # session_id -> latest user_prompt thought id
    "llm_cluster": None,   # {updated_at, model, clusters:[{name,color,item_ids,subclusters}]}
    "llm_next_refresh": 0, # unix ts des nächsten geplanten Cluster-Runs
    "llm_status": "idle",  # idle | running | error:<msg>
    "_thoughts_since_cluster": 0,  # M4: Zaehler fuer adaptives Re-Clustern
}

# Persistenz (M2): State alle 30 s auf Disk, beim Start wiederherstellen.
# Atomic-write (tmp + os.replace) verhindert Corruption bei Crash.
STATE_FILE = Path.home() / ".claude" / "brainmap-state.json"
PERSIST_INTERVAL = 30
PERSIST_MAX_AGE = 24 * 3600  # aeltere Snapshots werden nicht mehr geladen


def _mark_dirty():
    """State hat sich geaendert — alle SSE-Clients aufwecken."""
    with STATE_CONDVAR:
        STATE_CONDVAR.notify_all()


def _atomic_write_json(path: Path, obj) -> None:
    """Atomares Schreiben: tmp-Datei, dann os.replace. Keine korrupten Snapshots."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def snapshot_state() -> dict:
    """Erzeugt einen JSON-serialisierbaren Snapshot des aktuellen States."""
    with STATE_LOCK:
        return {
            "thoughts": list(STATE["thoughts"]),
            "seq": STATE["seq"],
            "current_prompt": dict(STATE["current_prompt"]),
            "llm_cluster": STATE.get("llm_cluster"),
            "saved_at": time.time(),
        }


def persist_state_now() -> bool:
    """Sofortiger Snapshot auf Disk — nutzt atomic-write. Nur fuer manuelle
    Trigger (z.B. /api/persist) oder im StatePersister-Thread."""
    snap = snapshot_state()
    _atomic_write_json(STATE_FILE, snap)
    return True


def load_persisted_state() -> int:
    """Laedt persistierten State zurueck in das STATE-Dict. Gibt die Anzahl
    wiederhergestellter Thoughts zurueck (0 wenn keine/zu alt/fehlerhaft)."""
    if not STATE_FILE.is_file():
        return 0
    try:
        raw = STATE_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return 0
    saved_at = data.get("saved_at", 0)
    if not saved_at or time.time() - saved_at > PERSIST_MAX_AGE:
        return 0
    thoughts = data.get("thoughts") or []
    if not isinstance(thoughts, list):
        return 0
    # Nur die juengsten MAX_THOUGHTS laden (deque cappt, aber besser explizit).
    if len(thoughts) > MAX_THOUGHTS:
        thoughts = thoughts[-MAX_THOUGHTS:]
    with STATE_LOCK:
        STATE["thoughts"].clear()
        STATE["_thought_index"].clear()
        for t in thoughts:
            if not isinstance(t, dict):
                continue
            STATE["thoughts"].append(t)
            tid = t.get("id")
            if tid:
                STATE["_thought_index"][tid] = t
        STATE["seq"] = int(data.get("seq") or 0)
        cp = data.get("current_prompt") or {}
        if isinstance(cp, dict):
            STATE["current_prompt"] = dict(cp)
        STATE["llm_cluster"] = data.get("llm_cluster")
    return len(thoughts)

LLM_CONFIG_PATH = Path.home() / ".claude" / "brainmap-llm.json"
LLM_CONFIG_LOCK = threading.Lock()
LLM_CONFIG_DEFAULTS = {"url": "localhost", "port": 1234, "model": "qwen3.5-9b", "interval": 60}


def load_llm_config() -> dict:
    with LLM_CONFIG_LOCK:
        cfg = dict(LLM_CONFIG_DEFAULTS)
        try:
            if LLM_CONFIG_PATH.is_file():
                cfg.update(json.loads(LLM_CONFIG_PATH.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            pass
        return cfg


def save_llm_config(cfg: dict) -> dict:
    with LLM_CONFIG_LOCK:
        merged = dict(LLM_CONFIG_DEFAULTS)
        merged.update(cfg or {})
        try:
            LLM_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            LLM_CONFIG_PATH.write_text(json.dumps(merged, indent=2), encoding="utf-8")
        except OSError:
            pass
        return merged


def _llm_base() -> str:
    cfg = load_llm_config()
    host = str(cfg.get("url") or "localhost").strip()
    # Falls der User eine komplette URL eingibt, respektieren; sonst http:// + host:port
    if host.startswith("http://") or host.startswith("https://"):
        return host.rstrip("/")
    port = int(cfg.get("port") or 1234)
    return f"http://{host}:{port}"


def _json(body, status=200):
    return status, "application/json", json.dumps(body).encode("utf-8")


def _read_body(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if not length:
        return {}
    raw = handler.rfile.read(length)
    try:
        return json.loads(raw.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return {}


THOUGHT_KINDS = ("thinking", "assistant_text")
THOUGHT_BUCKET = "Thoughts"


def add_thought(entry: dict) -> dict:
    with STATE_LOCK:
        # Idempotenz: gleiche ID nicht doppelt einfuegen (Watcher + Hook koexistieren)
        # O(1) Lookup via _thought_index statt linearem Scan.
        eid = entry.get("id")
        if eid and eid in STATE["_thought_index"]:
            return STATE["_thought_index"][eid]
        STATE["seq"] += 1
        entry["seq"] = STATE["seq"]
        entry.setdefault("ts", time.time())
        entry.setdefault("status", "thinking")
        sid = entry.get("session_id", "")
        kind = entry.get("kind", "")
        # Themen-Verknuepfung: Tool-Thoughts & Gedanken unter dem zuletzt aktiven User-Prompt
        if kind == "user_prompt":
            STATE["current_prompt"][sid] = entry.get("id")
        elif (kind.startswith("tool") or kind in THOUGHT_KINDS) and "parent_id" not in entry:
            pid = STATE["current_prompt"].get(sid)
            if pid:
                entry["parent_id"] = pid
        # Retention: bevor append, pruefen ob Ringbuffer voll ist. Wenn ja,
        # aeltesten Thought auch aus dem Index raeumen, damit der konsistent bleibt.
        if len(STATE["thoughts"]) >= MAX_THOUGHTS:
            oldest = STATE["thoughts"].popleft()
            old_id = oldest.get("id")
            if old_id and STATE["_thought_index"].get(old_id) is oldest:
                del STATE["_thought_index"][old_id]
        STATE["thoughts"].append(entry)
        if eid:
            STATE["_thought_index"][eid] = entry
        # M4: jeder neu hinzugefuegte Thought zaehlt fuer adaptive Cluster-Triggerung
        STATE["_thoughts_since_cluster"] = STATE.get("_thoughts_since_cluster", 0) + 1
    _mark_dirty()
    return entry


def patch_thought(thought_id: str, updates: dict) -> dict | None:
    with STATE_LOCK:
        t = STATE["_thought_index"].get(thought_id)
        if t is None:
            return None
        # Merge detail dicts rather than overwrite
        if "detail" in updates and isinstance(t.get("detail"), dict):
            merged = dict(t["detail"])
            merged.update(updates["detail"])
            updates = dict(updates, detail=merged)
        t.update(updates)
        STATE["seq"] += 1
        t["seq"] = STATE["seq"]
    _mark_dirty()
    return t


def find_thought(thought_id: str) -> dict | None:
    with STATE_LOCK:
        t = STATE["_thought_index"].get(thought_id)
        return dict(t) if t else None


def _read_transcript(tp: str) -> list:
    if not tp or not os.path.isfile(tp):
        return []
    try:
        out = []
        with open(tp, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
        return out
    except OSError:
        return []


def _user_text(content) -> str | None:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for c in content:
            if isinstance(c, dict) and c.get("type") == "text":
                return c.get("text")
    return None


def _assistant_text_blocks(content) -> str:
    if not isinstance(content, list):
        return ""
    texts = []
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            texts.append(c.get("text", ""))
    return "\n".join(texts).strip()


def build_context(thought: dict) -> dict:
    """Leite Frage/Antwort-Kontext aus dem Claude-Transkript ab."""
    ctx = {"question": None, "assistant": None, "tool": None, "tool_result": None}
    tp = thought.get("transcript_path")

    # Gedanken-Knoten (thinking/assistant_text): Volltext steckt bereits im detail
    kind = thought.get("kind")
    if kind in ("thinking", "assistant_text"):
        body = (thought.get("detail") or {}).get("body") or thought.get("text") or ""
        ctx["assistant"] = body[:4000]
        return ctx

    lines = _read_transcript(tp)

    if thought.get("kind") == "user_prompt":
        # Frage aus dem gespeicherten Detail
        stored_prompt = (thought.get("detail") or {}).get("prompt") or thought.get("text")
        ctx["question"] = stored_prompt
        # Antwort aus dem Transkript: finde die User-Message mit genau matching Text,
        # sammle alle Assistant-Text-Blöcke bis zur nächsten echten User-Nachricht.
        if lines and stored_prompt:
            needle = (stored_prompt or "").strip()
            match_idx = None
            # 1) exakte Übereinstimmung (getrimmt)
            for i, ev in enumerate(lines):
                role = (ev.get("message") or {}).get("role") or ev.get("type")
                if role != "user":
                    continue
                text = _user_text((ev.get("message") or {}).get("content")) or ""
                if text.strip() == needle:
                    match_idx = i
                    break
            # 2) Fallback: Text startet mit dem Prompt
            if match_idx is None:
                for i, ev in enumerate(lines):
                    role = (ev.get("message") or {}).get("role") or ev.get("type")
                    if role != "user":
                        continue
                    text = (_user_text((ev.get("message") or {}).get("content")) or "").strip()
                    if text.startswith(needle):
                        match_idx = i
                        break
            if match_idx is not None:
                answer_chunks = []
                for j in range(match_idx + 1, len(lines)):
                    ev = lines[j]
                    role = (ev.get("message") or {}).get("role") or ev.get("type")
                    content = (ev.get("message") or {}).get("content")
                    # Stop beim nächsten Nutzer-Text (kein tool_result)
                    if role == "user":
                        if isinstance(content, list) and all(
                            isinstance(c, dict) and c.get("type") == "tool_result"
                            for c in content
                        ):
                            continue
                        break
                    if role == "assistant":
                        t = _assistant_text_blocks(content)
                        if t:
                            answer_chunks.append(t)
                if answer_chunks:
                    ctx["assistant"] = "\n\n".join(answer_chunks)[:1500]
        return ctx

    # Tool-Kontext
    tool_use_id = thought.get("tool_use_id")
    if not lines:
        det = thought.get("detail") or {}
        ctx["tool"] = {"name": thought.get("tool_name"), "input": det.get("tool_input")}
        ctx["tool_result"] = det.get("tool_output")
        return ctx

    last_user_text = None
    for i, ev in enumerate(lines):
        msg = ev.get("message") or {}
        role = msg.get("role") or ev.get("type")
        content = msg.get("content")
        if role == "user":
            t = _user_text(content)
            if t:
                last_user_text = t
        if role == "assistant" and isinstance(content, list):
            texts = []
            for c in content:
                if c.get("type") == "text":
                    texts.append(c.get("text", ""))
                if c.get("type") == "tool_use" and c.get("id") == tool_use_id:
                    ctx["question"] = (last_user_text or "")[:800]
                    ctx["assistant"] = "\n".join(texts).strip()[:1500]
                    ctx["tool"] = {"name": c.get("name"), "input": c.get("input")}
                    for j in range(i + 1, min(i + 4, len(lines))):
                        nxt = lines[j].get("message") or {}
                        nc = nxt.get("content")
                        if isinstance(nc, list):
                            for cc in nc:
                                if cc.get("type") == "tool_result" and cc.get("tool_use_id") == tool_use_id:
                                    r = cc.get("content")
                                    if isinstance(r, list):
                                        r = " ".join((x.get("text") or "") for x in r if isinstance(x, dict))
                                    ctx["tool_result"] = (r or "")[:800]
                                    break
                    return ctx
    return ctx


def clear_state():
    with STATE_LOCK:
        STATE["thoughts"].clear()
        STATE["_thought_index"].clear()
        STATE["current_prompt"] = {}
        STATE["seq"] += 1
        STATE["_thoughts_since_cluster"] = 0
    # M2: persistierten Snapshot auch loeschen, sonst springt der Stand beim
    # Server-Restart zurueck.
    try:
        if STATE_FILE.is_file():
            STATE_FILE.unlink()
    except OSError:
        pass
    _mark_dirty()


def latest_transcript() -> str | None:
    """Jüngste Claude-Code-Session-Datei finden."""
    # 1. Falls ein Thought transcript_path gespeichert hat, verwenden
    with STATE_LOCK:
        for t in reversed(STATE["thoughts"]):
            tp = t.get("transcript_path")
            if tp and os.path.isfile(tp):
                return tp
    # 2. Filesystem-Scan
    root = Path.home() / ".claude" / "projects"
    if not root.exists():
        return None
    files = list(root.glob("**/*.jsonl"))
    if not files:
        return None
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return str(files[0])


TOOL_BUCKETS = {
    "Bash": "Tools", "Read": "Tools", "Write": "Tools", "Edit": "Tools",
    "Glob": "Tools", "Grep": "Tools", "NotebookEdit": "Tools", "TodoWrite": "Tools",
    "WebSearch": "Web", "WebFetch": "Web",
    "Agent": "Agents", "Task": "Agents",
}


def _summarize_tool(name: str, tinput) -> str:
    if not isinstance(tinput, dict):
        return name
    if name == "Bash":
        v = tinput.get("description") or tinput.get("command") or "Bash"
    elif name in ("Read", "Write", "Edit"):
        p = tinput.get("file_path") or ""
        v = f"{name} · {(p.split('/')[-1] or p)[:40]}"
    elif name == "Grep":
        v = f"Grep · {(tinput.get('pattern') or '')[:40]}"
    elif name == "Glob":
        v = f"Glob · {(tinput.get('pattern') or '')[:40]}"
    elif name == "WebSearch":
        v = f"WebSearch · {(tinput.get('query') or '')[:50]}"
    elif name == "WebFetch":
        v = f"WebFetch · {(tinput.get('url') or '')[:50]}"
    elif name in ("Agent", "Task"):
        v = f"Agent · {(tinput.get('description') or '')[:40]}"
    else:
        v = name
    return v.strip().replace("\n", " ")[:80]


def replay_transcript(transcript_path: str | None = None, session_id: str = "", depth: float = 1.0) -> dict:
    """Liest Transkript und füllt den State mit historischen Ereignissen.
    `depth` (0..1) = Anteil der jüngsten Einträge, der berücksichtigt wird.
    """
    tp = transcript_path or latest_transcript()
    if not tp or not os.path.isfile(tp):
        return {"ok": False, "error": "no transcript"}

    lines = _read_transcript(tp)
    if not lines:
        return {"ok": False, "error": "empty transcript"}

    try:
        depth = float(depth)
    except (TypeError, ValueError):
        depth = 1.0
    depth = max(0.0, min(1.0, depth))
    if depth < 1.0:
        keep = max(1, int(len(lines) * depth))
        lines = lines[-keep:]

    sid = session_id or Path(tp).stem[:8]
    added = 0
    clear_state()  # leert thoughts + index + current_prompt
    current_prompt_id = None
    with STATE_LOCK:
        seq = 0
        for i, ev in enumerate(lines):
            msg = ev.get("message") or {}
            role = msg.get("role") or ev.get("type")
            content = msg.get("content")
            ts = ev.get("timestamp") or time.time()
            try:
                if isinstance(ts, str):
                    # ISO8601
                    from datetime import datetime
                    ts = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            except Exception:
                ts = time.time()

            if role == "user":
                text = _user_text(content)
                # Tool-Results ignorieren
                if not text:
                    continue
                # System/Command-Text herausfiltern (launch-selected-element, system-reminder)
                if text.strip().startswith("<") and ("</" in text or "/>" in text):
                    continue
                if "<system-reminder>" in text or "<command-message>" in text or "<launch-selected-element>" in text:
                    continue
                seq += 1
                prompt_id = f"{sid}-u{i}"
                current_prompt_id = prompt_id
                prompt_entry = {
                    "id": prompt_id,
                    "kind": "user_prompt",
                    "parent": "Nutzer",
                    "text": text.strip().replace("\n", " ")[:70] or "(Prompt)",
                    "status": "done",
                    "detail": {"prompt": text},
                    "session_id": sid,
                    "transcript_path": tp,
                    "seq": seq,
                    "ts": ts,
                }
                STATE["thoughts"].append(prompt_entry)
                STATE["_thought_index"][prompt_id] = prompt_entry
                added += 1
            elif role == "assistant" and isinstance(content, list):
                for c in content:
                    if c.get("type") != "tool_use":
                        continue
                    tname = c.get("name") or "Tool"
                    tid_raw = c.get("id") or f"auto-{i}"
                    bucket = TOOL_BUCKETS.get(tname, "Tools")
                    seq += 1
                    tool_id = f"{sid}-t-{tid_raw}"
                    tool_entry = {
                        "id": tool_id,
                        "kind": "tool",
                        "parent": bucket,
                        "parent_id": current_prompt_id,
                        "text": _summarize_tool(tname, c.get("input") or {}),
                        "status": "done",
                        "tool_name": tname,
                        "tool_use_id": tid_raw,
                        "detail": {"tool_input": c.get("input") or {}},
                        "session_id": sid,
                        "transcript_path": tp,
                        "seq": seq,
                        "ts": ts,
                    }
                    STATE["thoughts"].append(tool_entry)
                    STATE["_thought_index"][tool_id] = tool_entry
                    added += 1
        STATE["seq"] = seq
    _mark_dirty()
    return {"ok": True, "added": added, "transcript_path": tp}


def llm_list_models() -> dict:
    """Proxyt GET {base}/v1/models — liefert {ok, models: [id, ...]} oder Fehler."""
    base = _llm_base()
    try:
        req = urllib.request.Request(base + "/v1/models", method="GET")
        with urllib.request.urlopen(req, timeout=2.5) as r:
            raw = r.read().decode("utf-8")
        data = json.loads(raw)
        items = data.get("data") or data.get("models") or []
        ids = []
        for it in items:
            if isinstance(it, dict):
                ids.append(it.get("id") or it.get("name"))
            elif isinstance(it, str):
                ids.append(it)
        return {"ok": True, "base": base, "models": [m for m in ids if m]}
    except Exception as e:
        return {"ok": False, "base": base, "error": str(e)[:200]}


# Kompakter System-Prompt: ~80 Tokens statt 400+. Das LLM arbeitet NICHT mehr
# mit langen UUID-Strings, sondern mit numerischen Indizes → spart Tokens
# sowohl im Input (Prompt) als auch im Output (jede ID nur 1-3 Zeichen).
# Der Server mappt nach dem Run Indizes zurueck auf echte Thought-IDs.
LLM_SYS_PROMPT = (
    "Cluster coding-session events into 6-9 BALANCED themes. "
    "Each item is [idx, kind, text]. kind: u=prompt t=tool th=think a=answer. "
    "Reply JSON: {\"clusters\":[{\"name\":\"...\",\"color\":\"#hex\",\"items\":[idx,...]}]}. "
    "RULES: "
    "(1) Every idx in exactly one cluster. "
    "(2) Cluster sizes roughly balanced — NO cluster may hold more than 25% of all items. "
    "(3) If unsure, split into subtopics rather than one large catch-all. "
    "(4) Names: 2-4 English words, concrete (not Misc/General/Other). "
    "Colors from: #ef4444 #f97316 #eab308 #84cc16 #10b981 #06b6d4 #3b82f6 #8b5cf6 #d946ef #ec4899."
)

# Short kind-codes → Token-Ersparnis pro Item
_KIND_SHORT = {"user_prompt": "u", "tool": "t", "thinking": "th", "assistant_text": "a"}


def llm_chat(prompt: str, model: str, timeout: float = 240.0) -> dict:
    """POST {base}/v1/chat/completions — OpenAI-kompatibel (LM-Studio/Ollama).
    Wir senden KEIN response_format: json_schema-Constrained-Decoding bricht
    auf lokalen Models die Performance um 5-20x; und LM-Studio akzeptiert
    kein json_object. Der System-Prompt macht das JSON-Format klar, das
    Markdown-Fence-Stripping + JSON-Rescue unten faengt alle Faelle ab."""
    base = _llm_base()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": LLM_SYS_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,       # deterministisch
        "max_tokens": 1024,       # 8 Cluster × ~100 Tokens passen locker
        "stream": False,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        base + "/v1/chat/completions",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")[:400]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code}: {body}") from e
    resp = json.loads(raw)
    choices = resp.get("choices") or []
    if not choices:
        raise RuntimeError("empty choices")
    msg = choices[0].get("message") or {}
    # qwen-3.5 u.ä. schreiben das JSON manchmal in reasoning_content statt content
    content = msg.get("content") or msg.get("reasoning_content") or ""
    s = content.strip()
    # Reasoning-Models (Qwen3-think, DeepSeek-R1 usw.) schreiben <think>...</think>
    # vor dem eigentlichen JSON. Raus damit.
    if "<think>" in s and "</think>" in s:
        s = s.split("</think>", 1)[1].strip()
    # Markdown-Fences strippen falls vorhanden
    if s.startswith("```"):
        s = s.strip("`").lstrip()
        if s.startswith("json"):
            s = s[4:].lstrip()
        if s.endswith("```"):
            s = s[:-3]
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # Rescue 1: balanced-brace-search nach dem groessten validen JSON-Objekt
    # im Text (gut bei Free-Form-Output mit Prosa-Prolog).
    best = None
    depth = 0
    start = -1
    for i, ch in enumerate(s):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    try:
                        cand = json.loads(s[start:i+1])
                    except json.JSONDecodeError:
                        continue
                    # Wir wollen das Objekt mit "clusters"-Key bevorzugen
                    if isinstance(cand, dict) and "clusters" in cand:
                        return cand
                    if best is None:
                        best = cand
    if best is not None:
        return best
    # Rescue 2 (Fallback): grosser von { bis letztem }
    l, r = s.find("{"), s.rfind("}")
    if l >= 0 and r > l:
        return json.loads(s[l:r+1])
    raise RuntimeError(f"no JSON in response (first 200 chars): {s[:200]!r}")


MAX_ITEMS_PER_CLUSTER_RUN = 150  # LLM sieht mehr Thoughts direkt → weniger
                                  # Timeline-Fallback noetig, feinere Cluster.
                                  # Nemotron-4B macht das in ~25-35s.
MAX_TEXT_LEN_PER_ITEM = 60        # Zeichen pro Item-Text


def llm_build_cluster_prompt(thoughts: list) -> tuple[str, list]:
    """Baut einen kompakten Prompt + gibt die Index→Thought-ID-Mapping-Liste
    zurueck. Format pro Item: [idx, kind_short, text] — minimales JSON, keine
    Keys, keine langen UUID-Strings. Spart ca. 70 % Input-Tokens."""
    recent = thoughts[-MAX_ITEMS_PER_CLUSTER_RUN:]
    items = []
    id_map = []  # index → original id
    for i, t in enumerate(recent):
        txt = (t.get("text") or "").replace("\n", " ")[:MAX_TEXT_LEN_PER_ITEM]
        kind = _KIND_SHORT.get(t.get("kind", ""), "x")
        items.append([i, kind, txt])
        id_map.append(t.get("id", ""))
    # Kompaktes JSON: keine Leerzeichen, keine Einrueckung
    return json.dumps(items, ensure_ascii=False, separators=(",", ":")), id_map


# Obergrenze fuer einen einzelnen Cluster. Kleinere Models (<7B) neigen dazu,
# alles in einen Catch-All-Cluster zu werfen. Wir splitten dann manuell auf.
MAX_CLUSTER_SHARE = 0.30


def _rebalance_clusters(clusters: list) -> list:
    """Wenn ein Cluster > MAX_CLUSTER_SHARE aller Items haelt, splitte ihn
    chronologisch in gleich grosse Teil-Cluster. Der Cluster-Name bekommt
    dann eine Part-Nummer."""
    total = sum(len(c.get("items", [])) for c in clusters)
    if total == 0:
        return clusters
    out = []
    for c in clusters:
        items = c.get("items", [])
        if len(items) / total <= MAX_CLUSTER_SHARE or len(items) < 10:
            out.append(c)
            continue
        # Split: z.B. bei 80 items und 25% → 4 parts
        n_parts = max(2, int(len(items) / (total * MAX_CLUSTER_SHARE)) + 1)
        part_size = (len(items) + n_parts - 1) // n_parts
        for i in range(n_parts):
            chunk = items[i * part_size : (i + 1) * part_size]
            if not chunk:
                continue
            out.append({
                "name": f"{c.get('name', 'Cluster')} ({i+1}/{n_parts})",
                "color": c.get("color"),
                "items": chunk,
                "subclusters": [],
            })
    return out


def llm_normalize_cluster(obj: dict) -> dict:
    """Akzeptiere {clusters:[...]} oder {name,clusters,...} — normalisiere auf flache Form."""
    clusters = obj.get("clusters")
    if clusters is None and isinstance(obj, list):
        clusters = obj
    if not isinstance(clusters, list):
        clusters = []

    def norm(c: dict) -> dict:
        # items: Integer-Indizes bleiben int (werden in llm_run_cluster_once
        # per id_map zurueckuebersetzt). Strings bleiben strings (Backcompat,
        # falls Model doch mal UUIDs statt Indizes zurueckgibt).
        raw_items = c.get("items") or []
        items = []
        for x in raw_items:
            if isinstance(x, int):
                items.append(x)
            elif isinstance(x, str) and x:
                items.append(x)
        return {
            "name": str(c.get("name") or "Cluster")[:60],
            "color": c.get("color") if isinstance(c.get("color"), str) and c.get("color","").startswith("#") else None,
            "items": items,
            "subclusters": [norm(x) for x in (c.get("subclusters") or []) if isinstance(x, dict)],
        }

    return {"clusters": [norm(c) for c in clusters if isinstance(c, dict)]}


def llm_run_cluster_once() -> dict:
    cfg = load_llm_config()
    model = str(cfg.get("model") or LLM_CONFIG_DEFAULTS["model"])
    with STATE_LOCK:
        STATE["llm_status"] = "running"
        thoughts = [
            {"id": t.get("id"), "kind": t.get("kind"), "text": t.get("text")}
            for t in STATE["thoughts"]
            if t.get("kind") in ("user_prompt", "tool", "thinking", "assistant_text")
        ]
    if not thoughts:
        with STATE_LOCK:
            STATE["llm_status"] = "idle"
        return {"ok": False, "error": "no thoughts"}
    try:
        prompt, id_map = llm_build_cluster_prompt(thoughts)
        raw = llm_chat(prompt, model)
        norm = llm_normalize_cluster(raw)
        # Indizes aus dem LLM-Output zurueck auf echte Thought-IDs mappen.
        # Das LLM arbeitet mit kurzen Integers, der Client braucht echte IDs.
        def remap(clusters):
            for c in clusters:
                new_items = []
                for v in c.get("items", []):
                    try:
                        idx = int(v)
                        if 0 <= idx < len(id_map) and id_map[idx]:
                            new_items.append(id_map[idx])
                    except (TypeError, ValueError):
                        # Falls das LLM doch einen String-ID liefert — durchreichen
                        if isinstance(v, str) and v:
                            new_items.append(v)
                c["items"] = new_items
                if c.get("subclusters"):
                    remap(c["subclusters"])
        remap(norm["clusters"])
        # Rebalance: falls LLM trotz Prompt-Hinweis einen Catch-All produziert,
        # splitten wir ihn chronologisch auf. Das ist die Safety-Netz fuer
        # kleinere Models (<7B), die gerne 80% in einen Cluster werfen.
        norm["clusters"] = _rebalance_clusters(norm["clusters"])
    except Exception as e:
        with STATE_LOCK:
            STATE["llm_status"] = f"error:{str(e)[:120]}"
        return {"ok": False, "error": str(e)[:200]}
    payload = {
        "updated_at": time.time(),
        "model": model,
        "clusters": norm["clusters"],
    }
    with STATE_LOCK:
        STATE["llm_cluster"] = payload
        STATE["seq"] += 1
        STATE["llm_status"] = "idle"
        # M4: nach einem erfolgreichen Cluster-Run ist die "Burst seit letztem
        # Cluster"-Buchhaltung zurueckgesetzt. So funktionieren auch manuelle
        # /api/llm/refresh-Runs als Trigger-Reset.
        STATE["_thoughts_since_cluster"] = 0
    _mark_dirty()
    return {"ok": True, "clusters_count": len(norm["clusters"])}


class ClusterScheduler(threading.Thread):
    """Alle `interval` Sekunden einen Cluster-Run durchfuehren, oder frueher
    wenn >= THRESHOLD neue Thoughts seit dem letzten Run eingetroffen sind
    (M4 — adaptive Triggerung). Aktualisiert STATE['llm_next_refresh'].
    """
    THRESHOLD = 20   # ab dieser Anzahl neuer Thoughts sofort re-clustern
    POLL = 2.0       # Prueffrequenz in Sekunden

    def __init__(self):
        super().__init__(daemon=True)

    def run(self):
        while True:
            cfg = load_llm_config()
            interval = max(15, int(cfg.get("interval") or 60))
            next_run = time.time() + interval
            with STATE_LOCK:
                STATE["llm_next_refresh"] = next_run
                STATE["_thoughts_since_cluster"] = 0
            try:
                llm_run_cluster_once()
            except Exception:
                pass
            # Adaptives Warten: alle POLL Sekunden pruefen, ob wir vorzeitig
            # re-clustern sollen. Sonst ganz normal bis zum naechsten Slot warten.
            while time.time() < next_run:
                time.sleep(self.POLL)
                with STATE_LOCK:
                    cnt = STATE.get("_thoughts_since_cluster", 0)
                if cnt >= self.THRESHOLD:
                    break  # → next outer iteration triggert Cluster-Run


class StatePersister(threading.Thread):
    """M2 — persistiert STATE alle PERSIST_INTERVAL Sekunden auf Disk.
    Schreibt nur, wenn sich seq seit dem letzten Snapshot geaendert hat."""
    def __init__(self, interval: int = PERSIST_INTERVAL):
        super().__init__(daemon=True)
        self.interval = interval

    def run(self):
        last_seq = -1
        while True:
            time.sleep(self.interval)
            with STATE_LOCK:
                cur_seq = STATE["seq"]
            if cur_seq == last_seq:
                continue
            persist_state_now()
            last_seq = cur_seq


def list_sessions(limit: int = 30) -> dict:
    """M1 — listet die juengsten Claude-Code-Session-Transkripte mit Metadata
    fuer den History-Picker. Liest pro Datei nur die ersten ~30 Zeilen fuer
    Preview/Count — kein Full-Scan."""
    root = Path.home() / ".claude" / "projects"
    if not root.exists():
        return {"sessions": []}
    try:
        files = list(root.glob("**/*.jsonl"))
    except OSError:
        return {"sessions": []}
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for p in files[:limit]:
        try:
            st = p.stat()
        except OSError:
            continue
        preview = ""
        entries = 0
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                for i, line in enumerate(f):
                    if not line.strip():
                        continue
                    entries += 1
                    if preview:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    msg = ev.get("message") or {}
                    if (msg.get("role") or ev.get("type")) == "user":
                        txt = _user_text(msg.get("content")) or ""
                        t = txt.strip().replace("\n", " ")
                        # Systemreminder / command-tags raus — wie im Watcher
                        if t and not (t.startswith("<") and ("</" in t or "/>" in t)) \
                                and "<system-reminder>" not in t \
                                and "<command-message>" not in t \
                                and "<launch-selected-element>" not in t:
                            preview = t[:120]
        except OSError:
            continue
        out.append({
            "path": str(p),
            "sid": p.stem[:8],
            "mtime": st.st_mtime,
            "size": st.st_size,
            "entries": entries,
            "preview": preview or "(no user prompt)",
        })
    return {"sessions": out}


class TranscriptWatcher(threading.Thread):
    """Tail-t live das jüngste Transkript und pusht neue thinking/text-Blöcke
    als Gedanken-Thoughts. Dedupliziert via stabile IDs in add_thought().
    """
    def __init__(self, interval: float = 0.4):
        super().__init__(daemon=True)
        self.interval = interval
        self.last_path: str | None = None
        self.last_size: int = 0

    def run(self):
        while True:
            try:
                self._tick()
            except Exception:
                pass
            time.sleep(self.interval)

    def _tick(self):
        tp = latest_transcript()
        if not tp:
            return
        try:
            size = os.path.getsize(tp)
        except OSError:
            return
        if tp != self.last_path:
            self.last_path = tp
            self.last_size = 0
        if size == self.last_size:
            return
        self.last_size = size

        lines = _read_transcript(tp)
        if not lines:
            return

        # Volle Session-UUID aus Dateinamen-Stem, kurzes Pendant für ID-Prefix
        full_sid = Path(tp).stem
        sid = full_sid[:8]

        # Bestimme pro assistant-Event den zuletzt aktiven user_prompt-Index,
        # damit parent_id symmetrisch zu replay_transcript (f"{sid}-u{i}") wird.
        cur_prompt_idx = None
        for i, ev in enumerate(lines):
            msg = ev.get("message") or {}
            role = msg.get("role") or ev.get("type")
            content = msg.get("content")
            if role == "user":
                text = _user_text(content) or ""
                t = text.strip()
                # Filter identisch zu replay_transcript: System/Command-Text raus
                if (t and not (t.startswith("<") and ("</" in t or "/>" in t))
                        and "<system-reminder>" not in t
                        and "<command-message>" not in t
                        and "<launch-selected-element>" not in t):
                    cur_prompt_idx = i
                continue
            if role != "assistant" or not isinstance(content, list):
                continue
            parent_id = f"{sid}-u{cur_prompt_idx}" if cur_prompt_idx is not None else None
            for j, c in enumerate(content):
                t = c.get("type")
                if t not in ("thinking", "text"):
                    continue
                body = (c.get("thinking") or c.get("text") or "").strip()
                if not body:
                    continue
                kind = "thinking" if t == "thinking" else "assistant_text"
                entry = {
                    "id": f"{sid}-th-{i}-{j}",
                    "kind": kind,
                    "parent": THOUGHT_BUCKET,
                    "text": body.replace("\n", " ")[:80],
                    "status": "done",
                    "detail": {"body": body[:4000]},
                    "session_id": full_sid,
                    "transcript_path": tp,
                }
                if parent_id:
                    entry["parent_id"] = parent_id
                add_thought(entry)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args, **kwargs):
        return

    def _send(self, status, ctype, body):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream_state(self, since: int) -> None:
        """Server-Sent-Events: pusht State-Deltas sobald sich etwas aendert.
        Ersetzt das 500 ms-Polling. Client waechst per seq-Counter mit —
        kein busy-loop, kein spurious-wakeup-Problem. Heartbeat alle 10 s
        haelt Proxies/Firewalls warm und laesst den Client Server-Tod erkennen.
        """
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache, no-transform")
            self.send_header("Connection", "keep-alive")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("X-Accel-Buffering", "no")  # nginx/proxy hint
            self.end_headers()
            # Initial frame: sofort den Stand ab `since` rausschicken.
            since = self._sse_send_delta(since)
            last_heartbeat = time.time()
            while True:
                with STATE_CONDVAR:
                    # Warte bis sich seq aendert (oder timeout fuer heartbeat).
                    if STATE["seq"] == since:
                        STATE_CONDVAR.wait(timeout=2.0)
                    cur_seq = STATE["seq"]
                if cur_seq != since:
                    since = self._sse_send_delta(since)
                    last_heartbeat = time.time()
                elif time.time() - last_heartbeat >= 10.0:
                    # Named SSE-Event 'heartbeat'. Kein data-Delta, aber der
                    # Client registriert das via addEventListener('heartbeat')
                    # und setzt seinen Watchdog-Timer zurueck.
                    self.wfile.write(b"event: heartbeat\ndata: 1\n\n")
                    self.wfile.flush()
                    last_heartbeat = time.time()
        except (BrokenPipeError, ConnectionResetError, OSError):
            # Client disconnected — threading-server cleanup erledigt den Rest
            return

    def _sse_send_delta(self, since: int) -> int:
        """Serialisiert den Delta seit `since` als SSE-Frame und gibt die
        neue seq zurueck, die der Client als Baseline verwenden soll."""
        with STATE_LOCK:
            thoughts = [t for t in STATE["thoughts"] if t.get("seq", 0) > since]
            cur_seq = STATE["seq"]
            payload = {
                "seq": cur_seq,
                "thoughts": thoughts,
                "llm_cluster": STATE.get("llm_cluster"),
                "llm_next_refresh": STATE.get("llm_next_refresh", 0),
                "llm_status": STATE.get("llm_status", "idle"),
            }
        body = ("data: " + json.dumps(payload) + "\n\n").encode("utf-8")
        self.wfile.write(body)
        self.wfile.flush()
        return cur_seq

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/ping":
            return self._send(*_json({"ok": True, "started_at": STATE["started_at"]}))
        if path == "/api/stream":
            # Long-lived SSE-Connection. Browser's EventSource reconnected
            # automatisch mit Last-Event-ID, wir respektieren hier den
            # `since`-Query-Parameter analog zu /api/state.
            since = 0
            for part in urlparse(self.path).query.split("&"):
                if part.startswith("since="):
                    try:
                        since = int(part.split("=", 1)[1])
                    except ValueError:
                        pass
            return self._stream_state(since)
        if path == "/api/state":
            since = 0
            q = urlparse(self.path).query
            for part in q.split("&"):
                if part.startswith("since="):
                    try:
                        since = int(part.split("=", 1)[1])
                    except ValueError:
                        pass
            with STATE_LOCK:
                thoughts = [t for t in STATE["thoughts"] if t.get("seq", 0) > since]
                seq = STATE["seq"]
                llm_cluster = STATE.get("llm_cluster")
                llm_next = STATE.get("llm_next_refresh", 0)
                llm_status = STATE.get("llm_status", "idle")
            return self._send(*_json({
                "seq": seq, "thoughts": thoughts,
                "llm_cluster": llm_cluster,
                "llm_next_refresh": llm_next,
                "llm_status": llm_status,
            }))
        if path == "/api/llm/config":
            return self._send(*_json(load_llm_config()))
        if path == "/api/llm/models":
            return self._send(*_json(llm_list_models()))
        if path == "/api/sessions":
            # M1 — Session-History-Picker
            return self._send(*_json(list_sessions()))
        if path == "/api/context":
            q = parse_qs(urlparse(self.path).query)
            tid = (q.get("id") or [""])[0]
            t = find_thought(tid)
            if not t:
                return self._send(*_json({"ok": False, "error": "unknown id"}, 404))
            ctx = build_context(t)
            return self._send(*_json({"ok": True, "thought": t, "context": ctx}))
        # Static files
        rel = path.lstrip("/") or "index.html"
        full = (PUBLIC_DIR / rel).resolve()
        if not str(full).startswith(str(PUBLIC_DIR.resolve())) or not full.is_file():
            return self._send(404, "text/plain", b"not found")
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
        }.get(full.suffix, "application/octet-stream")
        return self._send(200, ctype, full.read_bytes())

    def do_POST(self):
        path = urlparse(self.path).path
        body = _read_body(self)
        if path == "/api/thought":
            entry = add_thought(body)
            return self._send(*_json({"ok": True, "entry": entry}))
        if path == "/api/thought/patch":
            tid = body.pop("id", None)
            if not tid:
                return self._send(*_json({"ok": False, "error": "id required"}, 400))
            updated = patch_thought(tid, body)
            return self._send(*_json({"ok": bool(updated), "entry": updated}))
        if path == "/api/clear":
            clear_state()
            return self._send(*_json({"ok": True}))
        if path == "/api/persist":
            # M2 — sofortigen State-Snapshot anstossen (fuer Tests / manueller Trigger)
            persist_state_now()
            return self._send(*_json({"ok": True, "path": str(STATE_FILE)}))
        if path == "/api/llm/config":
            cfg = save_llm_config(body or {})
            return self._send(*_json({"ok": True, "config": cfg}))
        if path == "/api/llm/refresh":
            # Manueller Trigger — führt sofort einen Cluster-Run durch und
            # setzt den next_refresh-Timer anhand des aktuellen Intervalls.
            cfg = load_llm_config()
            interval = max(15, int(cfg.get("interval") or 60))
            with STATE_LOCK:
                STATE["llm_next_refresh"] = time.time() + interval
            result = llm_run_cluster_once()
            return self._send(*_json(result))
        if path == "/api/replay":
            result = replay_transcript(body.get("transcript_path"), body.get("session_id") or "", body.get("depth", 1.0))
            return self._send(*_json(result))
        if path == "/api/open":
            p = body.get("path")
            if p and os.path.exists(p):
                try:
                    subprocess.Popen(["open", p])
                except OSError:
                    pass
                return self._send(*_json({"ok": True}))
            return self._send(*_json({"ok": False, "error": "path not found"}, 404))
        if path == "/api/shutdown":
            self._send(*_json({"ok": True}))
            threading.Thread(target=lambda: (time.sleep(0.2), os._exit(0)), daemon=True).start()
            return
        return self._send(404, "text/plain", b"not found")


def main():
    # M2 — persistierten State vor dem ersten Listen-Call laden, damit der
    # allererste GET /api/state bereits die restaurierten Thoughts zeigt.
    restored = load_persisted_state()
    if restored:
        print(f"[mindmap] restored {restored} thoughts from {STATE_FILE}", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[mindmap] listening on http://127.0.0.1:{PORT}", flush=True)
    TranscriptWatcher().start()
    ClusterScheduler().start()
    StatePersister().start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
