#!/usr/bin/env python3
"""Hook-Script: liest Hook-Payload von stdin und pusht ein Gedanken-Event an den Mindmap-Server.

Aufruf: mindmap-hook.py <kind>
  kind ∈ { user_prompt | pre_tool | post_tool | stop }

Fails silent — der Hook blockiert Claude nie, selbst wenn der Server nicht läuft.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

PORT = int(os.environ.get("MINDMAP_PORT", "4823"))
BASE = f"http://127.0.0.1:{PORT}"
TIMEOUT = 0.4


def post(path: str, payload: dict) -> None:
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            BASE + path, data=data,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except (urllib.error.URLError, TimeoutError, OSError):
        pass


def truncate(s: str, n: int = 80) -> str:
    s = (s or "").strip().replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


def summarize_tool_input(tool: str, tinput: dict) -> str:
    if not isinstance(tinput, dict):
        return tool
    if tool == "Bash":
        return truncate(tinput.get("description") or tinput.get("command") or "Bash")
    if tool in ("Read", "Write", "Edit"):
        p = tinput.get("file_path") or ""
        return f"{tool} · {truncate(p.split('/')[-1], 40)}"
    if tool == "Grep":
        return f"Grep · {truncate(tinput.get('pattern') or '', 40)}"
    if tool == "Glob":
        return f"Glob · {truncate(tinput.get('pattern') or '', 40)}"
    if tool == "WebSearch":
        return f"WebSearch · {truncate(tinput.get('query') or '', 50)}"
    if tool == "WebFetch":
        return f"WebFetch · {truncate(tinput.get('url') or '', 50)}"
    if tool == "Agent" or tool == "Task":
        return f"Agent · {truncate(tinput.get('description') or '', 40)}"
    return tool


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    session_full = payload.get("session_id", "s")
    session = session_full[:8]
    transcript = payload.get("transcript_path") or ""
    ts = time.time()
    meta = {"session_id": session_full, "transcript_path": transcript}

    if kind == "user_prompt":
        prompt = payload.get("prompt") or ""
        post("/api/thought", {
            "id": f"{session}-user-{int(ts*1000)}",
            "kind": "user_prompt",
            "parent": "Nutzer",
            "text": truncate(prompt, 70) or "(Nutzer-Input)",
            "status": "done",
            "detail": {"prompt": prompt},
            **meta,
        })
        return

    if kind == "pre_tool":
        tool = payload.get("tool_name") or "Tool"
        tool_use_id = payload.get("tool_use_id") or str(int(ts * 1000))
        tid = f"{session}-tool-{tool_use_id}"
        post("/api/thought", {
            "id": tid,
            "kind": "tool",
            "parent": bucket_for(tool),
            "text": summarize_tool_input(tool, payload.get("tool_input") or {}),
            "status": "thinking",
            "tool_name": tool,
            "tool_use_id": tool_use_id,
            "detail": {"tool_input": payload.get("tool_input") or {}},
            **meta,
        })
        return

    if kind == "post_tool":
        tool = payload.get("tool_name") or "Tool"
        tool_use_id = payload.get("tool_use_id") or str(int(ts * 1000))
        tid = f"{session}-tool-{tool_use_id}"
        out = payload.get("tool_response") or payload.get("tool_output") or ""
        if isinstance(out, dict):
            out = json.dumps(out)[:600]
        post("/api/thought/patch", {
            "id": tid,
            "status": "done",
            "detail": {"tool_input": payload.get("tool_input") or {}, "tool_output": truncate(str(out), 600)},
        })
        return

    if kind == "stop":
        # Keine eigenen "Antwort abgeschlossen"-Knoten mehr —
        # die letzte Antwort wird via Transkript-Lookup am Nutzer-Prompt-Knoten sichtbar.
        return


def bucket_for(tool: str) -> str:
    if tool in ("WebSearch", "WebFetch"):
        return "Web"
    if tool in ("Agent", "Task"):
        return "Agenten"
    return "Werkzeuge"


if __name__ == "__main__":
    main()
