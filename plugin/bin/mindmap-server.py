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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("MINDMAP_PORT", "4823"))
PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
STATE_LOCK = threading.Lock()
STATE = {
    "started_at": time.time(),
    "thoughts": [],
    "seq": 0,
    "current_prompt": {},  # session_id -> latest user_prompt thought id
}


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


def add_thought(entry: dict) -> dict:
    with STATE_LOCK:
        STATE["seq"] += 1
        entry["seq"] = STATE["seq"]
        entry.setdefault("ts", time.time())
        entry.setdefault("status", "thinking")
        sid = entry.get("session_id", "")
        kind = entry.get("kind", "")
        # Themen-Verknüpfung: Tool-Thoughts unter dem zuletzt aktiven User-Prompt eingliedern
        if kind == "user_prompt":
            STATE["current_prompt"][sid] = entry.get("id")
        elif kind.startswith("tool") and "parent_id" not in entry:
            pid = STATE["current_prompt"].get(sid)
            if pid:
                entry["parent_id"] = pid
        STATE["thoughts"].append(entry)
        return entry


def patch_thought(thought_id: str, updates: dict) -> dict | None:
    with STATE_LOCK:
        for t in STATE["thoughts"]:
            if t.get("id") == thought_id:
                # Merge detail dicts rather than overwrite
                if "detail" in updates and isinstance(t.get("detail"), dict):
                    merged = dict(t["detail"])
                    merged.update(updates["detail"])
                    updates = dict(updates, detail=merged)
                t.update(updates)
                STATE["seq"] += 1
                t["seq"] = STATE["seq"]
                return t
        return None


def find_thought(thought_id: str) -> dict | None:
    with STATE_LOCK:
        for t in STATE["thoughts"]:
            if t.get("id") == thought_id:
                return dict(t)
        return None


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
        STATE["thoughts"] = []
        STATE["seq"] += 1


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
    "Bash": "Werkzeuge", "Read": "Werkzeuge", "Write": "Werkzeuge", "Edit": "Werkzeuge",
    "Glob": "Werkzeuge", "Grep": "Werkzeuge", "NotebookEdit": "Werkzeuge", "TodoWrite": "Werkzeuge",
    "WebSearch": "Web", "WebFetch": "Web",
    "Agent": "Agenten", "Task": "Agenten",
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
    clear_state()
    current_prompt_id = None
    with STATE_LOCK:
        STATE["thoughts"] = []
        STATE["current_prompt"] = {}
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
                STATE["thoughts"].append({
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
                })
                added += 1
            elif role == "assistant" and isinstance(content, list):
                for c in content:
                    if c.get("type") != "tool_use":
                        continue
                    tname = c.get("name") or "Tool"
                    tid_raw = c.get("id") or f"auto-{i}"
                    bucket = TOOL_BUCKETS.get(tname, "Werkzeuge")
                    seq += 1
                    STATE["thoughts"].append({
                        "id": f"{sid}-t-{tid_raw}",
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
                    })
                    added += 1
        STATE["seq"] = seq
    return {"ok": True, "added": added, "transcript_path": tp}


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

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/ping":
            return self._send(*_json({"ok": True, "started_at": STATE["started_at"]}))
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
            return self._send(*_json({"seq": seq, "thoughts": thoughts}))
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
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"[mindmap] listening on http://127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
