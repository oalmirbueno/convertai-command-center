"""Cheap pre-agent gate for new human entries in the Aceleriq execution diary.

The script reads only operator_board and operator_diary through the existing MCP,
leases each (link_id, entry_id) in a locked SQLite database, and emits a wakeAgent
gate. A lease is completed only after a later diary read confirms an operator entry
contains the original entry_id; expired leases are retried. It never answers the
diary or executes the work; the cron agent does that only when this script reports
new human context.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import fcntl
import json
import re
import sqlite3
import sys
import uuid
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

HERMES_ROOT = "/usr/local/lib/hermes-agent"
DEFAULT_DB = Path("/root/.hermes/workflows/panel-diary-consumer-v1/diary-consumer.sqlite3")
ALLOWED_TOOLS = {"aceleriq_operator_board", "aceleriq_operator_diary"}
HUMAN_ENTRY_TYPES = {"instrucao", "decisao", "correcao"}
HUMAN_MARKERS = {"human", "humano", "user", "almir", "almir de barros bueno"}
LEASE_SECONDS = 900
DIARY_LIMIT = 100
_SECRET_ASSIGNMENT = re.compile(
    r"(?i)(\b(?:access_token|refresh_token|authorization|api_key|password|senha|cookie|secret)\b\s*[:=]\s*)[^\s,;]+"
)
_URL_QUERY = re.compile(r"(https?://[^\s<>\"]+)\?[^\s<>\"]+")


def _safe_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = _SECRET_ASSIGNMENT.sub(r"\1[REDACTED]", text)
    return _URL_QUERY.sub(r"\1", text)


def _entry_id(entry: dict[str, Any]) -> str | None:
    value = entry.get("entry_id") or entry.get("id")
    if value is None or not str(value).strip():
        return None
    return str(value)


def _is_human(entry: dict[str, Any]) -> bool:
    entry_type = str(entry.get("entry_type") or entry.get("tipo") or "").strip().lower()
    if entry_type in HUMAN_ENTRY_TYPES:
        return True
    for key in ("author_type", "author_kind", "actor_type", "actor_kind", "autor_tipo", "autor_kind", "source_type"):
        marker = str(entry.get(key) or "").strip().lower()
        if marker in HUMAN_MARKERS:
            return True
    for key in ("author", "actor", "created_by_name", "autor"):
        marker = str(entry.get(key) or "").strip().lower()
        if marker in HUMAN_MARKERS:
            return True
    return False


def _has_operator_response(raw_entries: Iterable[Any], entry_id: str) -> bool:
    """Return true only for a non-human diary entry that cites the source entry_id."""
    reference_keys = (
        "reply_to_entry_id", "parent_entry_id", "source_entry_id", "in_reply_to",
    )
    for entry in raw_entries:
        if not isinstance(entry, dict) or _is_human(entry):
            continue
        if any(str(entry.get(key) or "") == entry_id for key in reference_keys):
            return True
        title = entry.get("title") or entry.get("titulo") or ""
        body = entry.get("body") or entry.get("texto") or ""
        if entry_id in f"{title}\n{body}":
            return True
    return False


def human_candidates(link: dict[str, Any], diary: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize only human diary entries; the original entry_id is preserved."""
    link_id = link.get("id") or link.get("link_id")
    if not link_id:
        return []
    raw_entries = diary.get("entradas") or diary.get("entries") or []
    candidates: list[dict[str, Any]] = []
    for entry in raw_entries:
        if not isinstance(entry, dict) or not _is_human(entry):
            continue
        entry_id = _entry_id(entry)
        if entry_id is None:
            continue
        operator = entry.get("operator") or entry.get("operador") or link.get("operador")
        candidates.append({
            "entry_id": entry_id,
            "link_id": str(link_id),
            "operator": str(operator) if operator else None,
            "kanban_task_id": entry.get("kanban_task_id") or link.get("kanban_task_id"),
            "painel_task_id": entry.get("painel_task_id") or link.get("painel_task_id"),
            "entry_type": str(entry.get("entry_type") or entry.get("tipo") or "comentario"),
            "title": _safe_text(entry.get("title") or entry.get("titulo") or ""),
            "body": _safe_text(entry.get("body") or entry.get("texto") or ""),
            "created_at": _safe_text(entry.get("created_at") or entry.get("createdAt") or entry.get("quando") or ""),
            "response_confirmed": _has_operator_response(raw_entries, entry_id),
        })
    return candidates


@contextmanager
def _database_lock(db_path: Path):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = db_path.with_name(db_path.name + ".lock")
    with lock_path.open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _init_db(con: sqlite3.Connection) -> None:
    columns = {
        row[1]: row[5]
        for row in con.execute("PRAGMA table_info(processed_entries)")
    }
    if columns and columns.get("entry_id") == 1 and columns.get("link_id") != 1:
        # Migrate the first-generation entry_id-only table. Old claims are leases,
        # not confirmed responses, so they are eligible for a safe retry.
        con.execute("ALTER TABLE processed_entries RENAME TO processed_entries_legacy")
        columns = {}
    con.execute("""
        CREATE TABLE IF NOT EXISTS processed_entries (
            link_id TEXT NOT NULL,
            entry_id TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'leased',
            claimed_at TEXT NOT NULL,
            lease_until TEXT,
            lease_token TEXT,
            completed_at TEXT,
            PRIMARY KEY (link_id, entry_id)
        )
    """)
    columns = {
        row[1]: row[5]
        for row in con.execute("PRAGMA table_info(processed_entries)")
    }
    if "lease_token" not in columns:
        con.execute("ALTER TABLE processed_entries ADD COLUMN lease_token TEXT")
    if con.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='processed_entries_legacy'"
    ).fetchone():
        con.execute("""
            INSERT OR IGNORE INTO processed_entries
                (link_id, entry_id, state, claimed_at, lease_until, completed_at)
            SELECT link_id, entry_id, 'leased', claimed_at, NULL, NULL
            FROM processed_entries_legacy
        """)
        con.execute("DROP TABLE processed_entries_legacy")


def _as_utc(value: dt.datetime | None = None) -> dt.datetime:
    value = value or dt.datetime.now(dt.timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _lease_until(now: dt.datetime, lease_seconds: int = LEASE_SECONDS) -> str:
    return (now + dt.timedelta(seconds=max(1, int(lease_seconds)))).isoformat()


def _lease_deadline_is_active(value: str | None, now: dt.datetime) -> bool:
    if not value:
        return False
    try:
        return _as_utc(dt.datetime.fromisoformat(value)) > now
    except ValueError:
        return False


def claim_new_entries(
    db_path: Path | str,
    entries: Iterable[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
    lease_seconds: int = LEASE_SECONDS,
) -> list[dict[str, Any]]:
    """Reconcile replies and atomically lease unacknowledged human entries.

    The lease prevents duplicate concurrent cron fires without losing an entry when
    the agent fails before writing the response. Only a later read-back confirmation
    changes state to processed.
    """
    db_path = Path(db_path)
    claimed: list[dict[str, Any]] = []
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        con.execute("PRAGMA synchronous=FULL")
        try:
            _init_db(con)
            now_dt = _as_utc(now)
            now = now_dt.isoformat()
            with con:
                for entry in entries:
                    entry_id = _entry_id(entry)
                    link_id = entry.get("link_id")
                    if entry_id is None or not link_id:
                        continue
                    link_id = str(link_id)
                    if entry.get("response_confirmed"):
                        con.execute(
                            """
                            INSERT INTO processed_entries
                                (link_id, entry_id, state, claimed_at, lease_until, lease_token, completed_at)
                            VALUES (?, ?, 'processed', ?, NULL, NULL, ?)
                            ON CONFLICT(link_id, entry_id) DO UPDATE SET
                                state='processed', lease_until=NULL, lease_token=NULL, completed_at=excluded.completed_at
                            """,
                            (link_id, entry_id, now, now),
                        )
                        continue
                    row = con.execute(
                        "SELECT state, lease_until FROM processed_entries "
                        "WHERE link_id = ? AND entry_id = ?",
                        (link_id, entry_id),
                    ).fetchone()
                    if row and row[0] == "processed":
                        continue
                    lease_until = row[1] if row else None
                    if lease_until:
                        if _lease_deadline_is_active(lease_until, now_dt):
                            continue
                    lease_token = uuid.uuid4().hex
                    deadline = _lease_until(now_dt, lease_seconds)
                    cursor = con.execute(
                        """
                        INSERT INTO processed_entries
                            (link_id, entry_id, state, claimed_at, lease_until, lease_token, completed_at)
                        VALUES (?, ?, 'leased', ?, ?, ?, NULL)
                        ON CONFLICT(link_id, entry_id) DO UPDATE SET
                            state='leased', claimed_at=excluded.claimed_at,
                            lease_until=excluded.lease_until, lease_token=excluded.lease_token,
                            completed_at=NULL
                        """,
                        (link_id, entry_id, now, deadline, lease_token),
                    )
                    if cursor.rowcount == 1:
                        claimed_entry = {key: value for key, value in entry.items()
                                         if key != "response_confirmed"}
                        claimed_entry.update({
                            "lease_token": lease_token,
                            "lease_until": deadline,
                            "lease_deadline": deadline,
                        })
                        claimed.append(claimed_entry)
        finally:
            con.close()
    return claimed


def renew_leases(
    db_path: Path | str,
    leases: Iterable[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
    lease_seconds: int = LEASE_SECONDS,
) -> list[dict[str, Any]]:
    """Renew only unexpired leases owned by the supplied lease token.

    Renewal is deliberately compare-and-set: a worker that missed its deadline cannot
    resurrect an entry after another worker has reclaimed it. The returned deadline is
    carried by the caller as the next heartbeat/deadline for this execution.
    """
    db_path = Path(db_path)
    renewed: list[dict[str, Any]] = []
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        con.execute("PRAGMA synchronous=FULL")
        try:
            _init_db(con)
            now_dt = _as_utc(now)
            now_text = now_dt.isoformat()
            with con:
                for lease in leases:
                    link_id = str(lease.get("link_id") or "")
                    entry_id = str(lease.get("entry_id") or "")
                    token = str(lease.get("lease_token") or "")
                    if not link_id or not entry_id or not token:
                        continue
                    row = con.execute(
                        "SELECT state, lease_until FROM processed_entries "
                        "WHERE link_id = ? AND entry_id = ? AND lease_token = ?",
                        (link_id, entry_id, token),
                    ).fetchone()
                    if not row or row[0] != "leased" or not _lease_deadline_is_active(row[1], now_dt):
                        continue
                    deadline = _lease_until(now_dt, lease_seconds)
                    cursor = con.execute(
                        """
                        UPDATE processed_entries
                        SET lease_until = ?, claimed_at = ?
                        WHERE link_id = ? AND entry_id = ? AND lease_token = ?
                          AND state = 'leased' AND lease_until > ?
                        """,
                        (deadline, now_text, link_id, entry_id, token, now_text),
                    )
                    if cursor.rowcount == 1:
                        renewed_lease = dict(lease)
                        renewed_lease.update({"lease_until": deadline, "lease_deadline": deadline})
                        renewed.append(renewed_lease)
        finally:
            con.close()
    return renewed


def gate_payload(messages: list[dict[str, Any]]) -> dict[str, Any]:
    if not messages:
        return {"wakeAgent": False}
    return {"wakeAgent": True, "messages": messages}


def _decode_tool_result(result: Any) -> Any:
    if getattr(result, "isError", False) or getattr(result, "is_error", False):
        raise RuntimeError("MCP tool returned an error")
    text = "\n".join(getattr(content, "text", "") for content in getattr(result, "content", []))
    value: Any = json.loads(text)
    if isinstance(value, dict) and isinstance(value.get("result"), str):
        value = json.loads(value["result"])
    if isinstance(value, dict) and value.get("error"):
        raise RuntimeError("MCP error envelope")
    return value


@contextmanager
def consumer_run_lock(db_path: Path, blocking=False):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with db_path.with_name(db_path.name + ".run.lock").open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)

async def collect_candidates(call, *, deadline, board_limit=500, diary_limit=DIARY_LIMIT, max_links=500):
    async def bounded(name, args):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("diary read deadline")
        return await asyncio.wait_for(call(name, args), timeout=min(remaining, 15))
    board = await bounded("aceleriq_operator_board", {"limit": board_limit})
    links = board.get("vinculos", []) if isinstance(board, dict) else []
    semaphore = asyncio.Semaphore(4)
    async def read(link):
        async with semaphore:
            try:
                diary = await bounded("aceleriq_operator_diary", {"link_id": str(link.get("id") or link.get("link_id")), "limit": diary_limit})
                return human_candidates(link, diary) if isinstance(diary, dict) else []
            except Exception:
                return []
    rows = await asyncio.gather(*(read(link) for link in links[:max_links] if isinstance(link, dict) and (link.get("id") or link.get("link_id"))))
    unique = {(r["link_id"], r["entry_id"]): r for group in rows for r in group}
    return sorted(unique.values(), key=lambda r: (r.get("created_at") or "", r["link_id"], r["entry_id"]))


async def _collect_candidates() -> list[dict[str, Any]]:
    sys.path.insert(0, HERMES_ROOT)
    from tools.mcp_tool_config import _load_mcp_config
    from tools.mcp_tool_discovery import _connect_server

    config = _load_mcp_config()
    if "aceleriq" not in config:
        raise RuntimeError("Aceleriq MCP is not configured")
    server = await _connect_server("aceleriq", config["aceleriq"])
    try:
        available = {tool.name for tool in (await server.session.list_tools()).tools}
        if not ALLOWED_TOOLS.issubset(available):
            raise RuntimeError("Required Aceleriq diary tools are unavailable")

        async def call(name: str, args: dict[str, Any]) -> Any:
            if name not in ALLOWED_TOOLS:
                raise ValueError("Tool outside allowlist")
            return _decode_tool_result(await asyncio.wait_for(server.session.call_tool(name, args), timeout=20))

        return await collect_candidates(call, deadline=time.monotonic() + 40)

    finally:
        await server.shutdown()


async def run(db_path: Path) -> dict[str, Any]:
    with consumer_run_lock(db_path) as acquired:
        if not acquired:
            return {"wakeAgent": False}
        candidates = await asyncio.wait_for(_collect_candidates(), timeout=50)
        return gate_payload(claim_new_entries(db_path, candidates))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    try:
        payload = asyncio.run(run(args.db))
    except Exception as exc:
        # Fail closed for the LLM: the cron log still records a safe class-only signal.
        payload = {"wakeAgent": False, "consumer_error": type(exc).__name__}
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
