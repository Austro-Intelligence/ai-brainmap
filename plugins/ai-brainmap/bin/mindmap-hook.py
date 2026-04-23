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


def flush_thoughts_from_transcript(transcript_path: str, session_full: str) -> None:
    """Liest das Transkript und postet alle thinking/text-Blöcke als Gedanken-Thoughts.
    Stabile IDs sorgen für Idempotenz gegenüber dem Server-Watcher.
    """
    if not transcript_path or not os.path.isfile(transcript_path):
        return
    sid = session_full[:8] if session_full else ""
    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = ev.get("message") or {}
                if (msg.get("role") or ev.get("type")) != "assistant":
                    continue
                content = msg.get("content")
                if not isinstance(content, list):
                    continue
                for j, c in enumerate(content):
                    t = c.get("type")
                    if t not in ("thinking", "text"):
                        continue
                    body = (c.get("thinking") or c.get("text") or "").strip()
                    if not body:
                        continue
                    kind = "thinking" if t == "thinking" else "assistant_text"
                    post("/api/thought", {
                        "id": f"{sid}-th-{i}-{j}",
                        "kind": kind,
                        "parent": "Thoughts",
                        "text": body.replace("\n", " ")[:80],
                        "status": "done",
                        "detail": {"body": body[:4000]},
                        "session_id": session_full,
                        "transcript_path": transcript_path,
                    })
    except OSError:
        return


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
            "parent": "Topics",
            "text": truncate(prompt, 70) or "(user input)",
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
        flush_thoughts_from_transcript(transcript, session_full)
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
        # Finale Gedanken-Blöcke nach dem letzten Tool noch sicher pushen,
        # falls der Server-Watcher sie noch nicht gesehen hat.
        flush_thoughts_from_transcript(transcript, session_full)
        return


def bucket_for(tool: str) -> str:
    if tool in ("WebSearch", "WebFetch"):
        return "Web"
    if tool in ("Agent", "Task"):
        return "Agents"
    return "Tools"


if __name__ == "__main__":
    main()
