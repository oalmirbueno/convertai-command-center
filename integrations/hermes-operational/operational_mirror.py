"""Mirror public task updates only after an explicit Aceleriq MCP task call.

No prompts, reasoning, tool arguments or raw tool output are persisted. Task and
operator are verified again against the panel before delivery. No status changes.
"""
import asyncio
import hashlib
import json
import queue
import re
import sqlite3
import threading
import time
from pathlib import Path
from contextlib import contextmanager

UUID = re.compile(r"^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$", re.I)
SECRET = re.compile(r"(?i)(\b(?:access_token|refresh_token|authorization|api_key|password|senha|cookie|secret)\b\s*[:=]\s*)[^\s,;]+")


def public_text(text):
    if not isinstance(text, str):
        return ""
    text = SECRET.sub(r"\1[oculto]", text)
    text = re.sub(r"(?i)\bbearer\s+\S+", "Bearer [oculto]", text)
    text = re.sub(r"(https?://[^\s<>\"]+)\?[^\s<>\"]+", r"\1", text)
    return text[:10000]


class Mirror:
    def __init__(self, path, start=True):
        self.path = Path(path)
        self.bindings = {}
        self.turn_links = {}
        self.pending = queue.Queue(maxsize=1000)
        self.lock = threading.Lock()
        self.last = {}
        if start:
            threading.Thread(target=self.worker, name="aceleriq-public-mirror", daemon=True).start()

    def event(self, sid, event, payload):
        payload = payload or {}
        with self.lock:
            if event == "message.start":
                self.bindings.pop(sid, None)
                self.turn_links.pop(sid, None)
                return False
            if event == "tool.complete":
                name = str(payload.get("name", ""))
                args = payload.get("args") or {}
                link = args.get("link_id") if isinstance(args, dict) else None
                # These calls explicitly name a real task; the worker still verifies it.
                if "aceleriq_operator_" in name and UUID.fullmatch(str(link or "")):
                    self.bindings[sid] = str(link)
                    self.turn_links.setdefault(sid, set()).add(str(link))
            link = self.bindings.get(sid)
            if not link:
                return False
            if event == "message.complete":
                if len(self.turn_links.get(sid, set())) != 1:
                    return False  # Do not attach a multi-client final answer to just the last client.
                text = public_text(payload.get("text"))
                title = "Resposta do Hermes" if payload.get("status") != "error" else "Hermes encontrou uma falha"
            elif event == "tool.complete":
                # Tool output may contain secrets/private reasoning. Publish only a label.
                if time.monotonic() - self.last.get(sid, 0) < 30:
                    return False
                name = str(payload.get("name", ""))
                title = "Hermes em atividade"
                text = "Consultou ou atualizou os registros desta tarefa no painel." if "aceleriq" in name else "Executou uma etapa da tarefa. O resultado detalhado será registrado ao finalizar."
                self.last[sid] = time.monotonic()
            else:
                return False
            if not text.strip():
                return False
            key = hashlib.sha256(f"{sid}|{link}|{event}|{payload.get('tool_id', '')}|{text}".encode()).hexdigest()
            try:
                self.pending.put_nowait((key, link, title, text))
                return True
            except queue.Full:
                return False

    @contextmanager
    def connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.path, timeout=5)
        con.execute("CREATE TABLE IF NOT EXISTS public_updates (key TEXT PRIMARY KEY, link_id TEXT, title TEXT, body TEXT, state TEXT DEFAULT 'pending', claimed REAL DEFAULT 0)")
        try:
            with con:
                yield con
        finally:
            con.close()

    def flush(self):
        with self.connect() as con:
            while True:
                try:
                    item = self.pending.get_nowait()
                except queue.Empty:
                    break
                con.execute("INSERT OR IGNORE INTO public_updates(key,link_id,title,body) VALUES (?,?,?,?)", item)

    async def deliver(self, call):
        self.flush()
        with self.connect() as con:
            con.execute("BEGIN IMMEDIATE")
            rows = con.execute("SELECT key,link_id,title,body FROM public_updates WHERE state!='sent' AND claimed<? LIMIT 8", (time.time()-120,)).fetchall()
            con.executemany("UPDATE public_updates SET claimed=? WHERE key=?", [(time.time(), r[0]) for r in rows])
        if not rows:
            return 0
        board = await call("aceleriq_operator_board", {"limit": 500})
        links = {str(v.get("id")): v for v in board.get("vinculos", [])}
        sent = 0
        for key, link, title, body in rows:
            context = links.get(link)
            if not context or not context.get("operador") or not context.get("client_id"):
                continue
            marker = f"sha256: {key}"
            diary = await call("aceleriq_operator_diary", {"link_id": link, "limit": 100})
            if not any(marker in str(e.get("texto", "")) for e in diary.get("entradas", [])):
                refs = list(dict.fromkeys(re.findall(r"aceleriq-file://[a-f0-9-]{36}", body, re.I)))[:12]
                await call("aceleriq_operator_diary", {
                    "link_id": link, "operator": context["operador"], "entry_type": "comentario",
                    "title": title, "body": body + "\n\nRegistro de continuidade — " + marker,
                    "attachments": [{"name": "Arquivo do trabalho", "url": u} for u in refs],
                })
                # Confirm the write before declaring delivery. Retry first checks this marker.
                readback = await call("aceleriq_operator_diary", {"link_id": link, "limit": 100})
                if not any(marker in str(e.get("texto", "")) for e in readback.get("entradas", [])):
                    continue
            with self.connect() as con:
                con.execute("UPDATE public_updates SET state='sent' WHERE key=?", (key,))
            sent += 1
        return sent

    async def network_delivery(self):
        from tools.mcp_tool_config import _load_mcp_config
        from tools.mcp_tool_discovery import _connect_server
        server = await asyncio.wait_for(_connect_server("aceleriq", _load_mcp_config()["aceleriq"]), 10)
        try:
            async def call(name, args):
                if name not in {"aceleriq_operator_board", "aceleriq_operator_diary"}:
                    raise ValueError("unsupported mirror operation")
                r = await asyncio.wait_for(server.session.call_tool(name, args), 15)
                if getattr(r, "isError", False):
                    raise RuntimeError("panel rejected update")
                value = json.loads("\n".join(getattr(c, "text", "") for c in r.content))
                if isinstance(value.get("result"), str):
                    value = json.loads(value["result"])
                if value.get("error"):
                    raise RuntimeError("panel rejected update")
                return value
            return await asyncio.wait_for(self.deliver(call), 60)
        finally:
            await server.shutdown()

    def worker(self):
        while True:
            try:
                self.flush()
                with self.connect() as con:
                    pending = con.execute("SELECT 1 FROM public_updates WHERE state!='sent' LIMIT 1").fetchone()
                if pending:
                    asyncio.run(self.network_delivery())
            except Exception as exc:
                # Keep pending rows; a status file reports failure without payloads/credentials.
                try:
                    self.path.with_suffix(".status.json").write_text(json.dumps({"state": "pending", "error_type": type(exc).__name__, "checked_at": time.time()}))
                except OSError:
                    pass
            time.sleep(10)


_mirror = None
_init_lock = threading.Lock()


def handle_event(sid, event, payload):
    global _mirror
    if event not in {"message.start", "message.complete", "tool.complete"}:
        return False
    with _init_lock:
        if _mirror is None:
            from hermes_constants import get_hermes_home
            _mirror = Mirror(Path(get_hermes_home()) / "workflows/aceleriq-operational-mirror/public.sqlite3")
    return _mirror.event(sid, event, payload)
