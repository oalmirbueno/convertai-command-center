"""Cheap pre-agent gate for new human entries in the Aceleriq execution diary.

The script reads only operator_board and operator_diary through the existing MCP,
leases each (link_id, entry_id) in a locked SQLite database, and emits a wakeAgent
gate. It never answers the diary or executes the work; the cron agent does that only
when this script reports new human context.

26/10/2026 (correção do laço): até aqui a rotina rodava a cada minuto, lia todos os
vínculos (inclusive concluídos) com limite 100, tratava instrucao/decisao/correcao de
agente como humana e só dava a entrada por respondida quando a resposta citava o
entry_id, que o próprio diário proíbe escrever. A reserva de 15 min vencia e a mesma
instrução acordava o agente de novo (~120 leituras/min e dezenas de respostas iguais).
Agora:
- humano = autor_kind humano (o tipo da entrada não basta quando o autor é agente);
- só vínculos abertos (status diferente de done) e só de operadores do Hermes; vínculos
  de operadores do Paperclip têm dono próprio e não são respondidos aqui;
- resposta = qualquer entrada de operador posterior à humana, reply_to_entry_id ou
  respondida_por do painel; respondida, a entrada fica processada para sempre;
- cada entrada é entregue ao agente no máximo MAX_ATTEMPTS vezes e só enquanto não
  houver resposta (no máximo 1 resposta); depois vira expired;
- leitura incremental: só abre o diário quando ultima_entrada_humana_em mudou ou há
  reserva pendente, com limite pequeno, e usa `desde` quando o MCP aceitar;
- teto de acordadas do agente por dia e de mensagens por acordada;
- entradas anteriores ao corte de implantação não são respondidas (baseline_skipped).
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
ALLOWED_TOOLS = {"aceleriq_operator_board", "aceleriq_operator_diary", "aceleriq_list_clients"}
REQUIRED_TOOLS = {"aceleriq_operator_board", "aceleriq_operator_diary"}
HUMAN_ENTRY_TYPES = {"instrucao", "decisao", "correcao"}
HUMAN_MARKERS = {"human", "humano", "user", "usuario", "usuário", "dono", "owner"}
AUTHOR_KIND_KEYS = ("autor_kind", "author_kind", "author_type", "actor_type", "actor_kind", "autor_tipo", "source_type")
OPEN_EXCLUDED_STATUS = {"done", "cancelled", "canceled", "cancelado", "cancelada", "archived"}
# Operadores do Paperclip quando o board não traz `operadores` (fallback conservador).
PAPERCLIP_FALLBACK = {
    "paperclip", "chefe", "gestor-trafego", "otimizador", "sentinela", "criativos",
    "analista", "estrategista", "desenvolvedor", "revisor",
}
TERMINAL_STATES = {"processed", "completed", "expired", "baseline_skipped", "superseded"}
LEASE_SECONDS = 1800
MAX_ATTEMPTS = 2
DIARY_LIMIT = 30
DAILY_WAKE_CAP = 36
MAX_MESSAGES_PER_WAKE = 5
# Corte de implantação: entradas humanas anteriores a isto não acordam o agente.
# (a rotina antiga foi pausada às 13:09 UTC de 26/10/2026; tudo antes já foi tratado
# pelo laço antigo, até repetidamente.)
DEFAULT_ELIGIBLE_SINCE = "2026-10-26T13:09:00+00:00"
SEEN_FIELD = "ultima_entrada_humana_em"
BRT = dt.timezone(dt.timedelta(hours=-3))

_SECRET_ASSIGNMENT = re.compile(
    r"(?i)(\b(?:access_token|refresh_token|authorization|api_key|password|senha|cookie|secret)\b\s*[:=]\s*)[^\s,;]+"
)
_URL_QUERY = re.compile(r"(https?://[^\s<>\"]+)\?[^\s<>\"]+")
_CLIENT_REFERENCE = re.compile(r"(?im)^Referência do cliente:\s*([^\n\r]+)")
_CLIENT_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def client_target(link: dict[str, Any], body: str) -> dict[str, Any]:
    """Routing context, not permission. Never substitute the coordinating agency."""
    references = {v.strip().lower() for v in _CLIENT_REFERENCE.findall(body)}
    portfolio = 'carteira meta ads' in str(link.get('projeto') or '').lower()
    if references:
        if len(references) != 1 or not _CLIENT_UUID.fullmatch(next(iter(references))):
            return {'target_scope': 'unresolved', 'target_client_id': None, 'needs_client_clarification': True}
        return {'target_scope': 'client', 'target_client_id': next(iter(references)), 'needs_client_clarification': False}
    if portfolio:
        return {'target_scope': 'portfolio', 'target_client_id': None, 'needs_client_clarification': False}
    client_id = str(link.get('client_id') or '')
    return {'target_scope': 'project', 'target_client_id': client_id if _CLIENT_UUID.fullmatch(client_id) else None, 'needs_client_clarification': False}


def _safe_text(value: Any) -> str:
    text = "" if value is None else str(value)
    text = _SECRET_ASSIGNMENT.sub(r"\1[REDACTED]", text)
    return _URL_QUERY.sub(r"\1", text)


def _entry_id(entry: dict[str, Any]) -> str | None:
    value = entry.get("entry_id") or entry.get("id")
    if value is None or not str(value).strip():
        return None
    return str(value)


def _as_utc(value: dt.datetime | None = None) -> dt.datetime:
    value = value or dt.datetime.now(dt.timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)


def _parse_time(raw: Any) -> dt.datetime | None:
    if not raw:
        return None
    try:
        return _as_utc(dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")))
    except ValueError:
        return None


def _entry_time(entry: dict[str, Any]) -> dt.datetime | None:
    return _parse_time(entry.get("created_at") or entry.get("createdAt") or entry.get("quando"))


def _author_kind(entry: dict[str, Any]) -> str | None:
    for key in AUTHOR_KIND_KEYS:
        value = entry.get(key)
        if value is not None and str(value).strip():
            return str(value).strip().lower()
    return None


def _is_human(entry: dict[str, Any]) -> bool:
    """Human = real human author. An agent writing instrucao/decisao/correcao is not human.

    The panel always sends autor_kind ("humano" / "operador"). The entry type is only a
    fallback for payloads that carry no author kind at all (older tool versions/tests).
    """
    kind = _author_kind(entry)
    if kind is not None:
        return kind in HUMAN_MARKERS
    entry_type = str(entry.get("entry_type") or entry.get("tipo") or "").strip().lower()
    return entry_type in HUMAN_ENTRY_TYPES


def _has_operator_response(raw_entries: Iterable[Any], entry: dict[str, Any] | str,
                           after: dt.datetime | None = None) -> bool:
    """True when the human entry already has an operator reply.

    Counts: respondida_por on the human entry (new panel contract), an operator entry
    with reply_to_entry_id (or similar) pointing at it, an operator entry citing the id,
    or any operator entry written after it (the diary forbids ids in visible text).
    """
    if isinstance(entry, dict):
        entry_id = _entry_id(entry) or ""
        answered = entry.get("respondida_por") or entry.get("answered_by") or entry.get("respostas")
        if answered:
            return True
        if after is None:
            after = _entry_time(entry)
    else:
        entry_id = str(entry)
    reference_keys = ("reply_to_entry_id", "parent_entry_id", "source_entry_id", "in_reply_to", "responde_a")
    for other in raw_entries:
        if not isinstance(other, dict) or _is_human(other):
            continue
        if entry_id and any(str(other.get(key) or "") == entry_id for key in reference_keys):
            return True
        title = other.get("title") or other.get("titulo") or ""
        body = other.get("body") or other.get("texto") or ""
        if entry_id and entry_id in f"{title}\n{body}":
            return True
        quando = _entry_time(other)
        if after is not None and quando is not None and quando > after:
            return True
    return False


def paperclip_operators(board: dict[str, Any] | None) -> set[str]:
    """Operators owned by the Paperclip team (they answer their own links)."""
    operators = board.get("operadores") if isinstance(board, dict) else None
    if not isinstance(operators, list) or not operators:
        return set(PAPERCLIP_FALLBACK)
    owned = {"paperclip"}
    for op in operators:
        if not isinstance(op, dict):
            continue
        slug = str(op.get("slug") or "").strip().lower()
        area = str(op.get("area") or "").strip().lower()
        parent = str(op.get("responde_a") or "").strip().lower()
        if slug and (area == "paperclip" or parent == "paperclip"):
            owned.add(slug)
    return owned


def link_is_open(link: dict[str, Any]) -> bool:
    return str(link.get("status") or "").strip().lower() not in OPEN_EXCLUDED_STATUS


def link_is_hermes(link: dict[str, Any], paperclip: set[str]) -> bool:
    operator = str(link.get("operador") or "").strip().lower()
    return bool(operator) and operator not in paperclip


def human_candidates(link: dict[str, Any], diary: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize only human diary entries; the original entry_id is preserved.

    The reply is always signed by the link's operator, never by the entry author or by
    an operator of another team.
    """
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
        operator = link.get("operador")
        candidates.append({
            **client_target(link, str(entry.get("body") or entry.get("texto") or "")),
            "entry_id": entry_id,
            "link_id": str(link_id),
            "operator": str(operator) if operator else None,
            "task_title": _safe_text(link.get("tarefa") or ""),
            "project_name": _safe_text(link.get("projeto") or ""),
            "project_client": _safe_text(link.get("cliente") or ""),
            "project_client_id": link.get("client_id"),
            "link_status": link.get("status"),
            "communication": (
                "Identifique o cliente do pedido antes de agir. O cliente do projeto pode ser "
                "a agência coordenadora de uma carteira; use a referência explícita na mensagem "
                "para localizar o cliente atendido e confira no painel. target_client_id identifica "
                "o destino solicitado, não concede permissão: confirme que existe antes de agir. "
                "target_scope=portfolio permite conversar e analisar a carteira, nunca substituir "
                "o destino pelo project_client_id. Para agir num cliente, resolva seu ID no MCP. "
                "Responda em português claro: Cliente e tarefa; O que conferi; O que fiz; "
                "Próximo passo; Preciso de você (somente se necessário). Separe análise de execução "
                "comprovada. Para criativos, consulte contexto, materiais e Mesas do cliente pelos "
                "recursos já disponíveis; não invente acesso nem repita perguntas já respondidas. "
                "Registre o retorno nesta conversa. Conversa não substitui aprovação de campanha."
            ),
            "kanban_task_id": entry.get("kanban_task_id") or link.get("kanban_task_id"),
            "painel_task_id": entry.get("painel_task_id") or link.get("painel_task_id"),
            "entry_type": str(entry.get("entry_type") or entry.get("tipo") or "comentario"),
            "title": _safe_text(entry.get("title") or entry.get("titulo") or ""),
            "body": _safe_text(entry.get("body") or entry.get("texto") or ""),
            "created_at": _safe_text(entry.get("created_at") or entry.get("createdAt") or entry.get("quando") or ""),
            "response_confirmed": _has_operator_response(raw_entries, entry),
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
    if "attempts" not in columns:
        con.execute("ALTER TABLE processed_entries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
    if "note" not in columns:
        con.execute("ALTER TABLE processed_entries ADD COLUMN note TEXT")
    con.execute("CREATE TABLE IF NOT EXISTS link_seen (link_id TEXT PRIMARY KEY, human_at TEXT NOT NULL)")
    con.execute("CREATE TABLE IF NOT EXISTS wakes (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)")
    con.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    con.execute("INSERT OR IGNORE INTO meta(key, value) VALUES ('eligible_since', ?)", (DEFAULT_ELIGIBLE_SINCE,))
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


def _lease_until(now: dt.datetime, lease_seconds: int = LEASE_SECONDS) -> str:
    return (now + dt.timedelta(seconds=max(1, int(lease_seconds)))).isoformat()


def _lease_deadline_is_active(value: str | None, now: dt.datetime) -> bool:
    if not value:
        return False
    try:
        return _as_utc(dt.datetime.fromisoformat(value)) > now
    except ValueError:
        return False


def _brt_day(now: dt.datetime) -> str:
    return now.astimezone(BRT).date().isoformat()


def wakes_today(db_path: Path | str, now: dt.datetime | None = None) -> int:
    db_path = Path(db_path)
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        try:
            _init_db(con)
            con.commit()
            row = con.execute("SELECT n FROM wakes WHERE day = ?", (_brt_day(_as_utc(now)),)).fetchone()
            return int(row[0]) if row else 0
        finally:
            con.close()


def claim_new_entries(
    db_path: Path | str,
    entries: Iterable[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
    lease_seconds: int = LEASE_SECONDS,
    max_attempts: int = MAX_ATTEMPTS,
    max_messages: int = MAX_MESSAGES_PER_WAKE,
    daily_cap: int = DAILY_WAKE_CAP,
    read_links: dict[str, set[str]] | None = None,
    deferred_links: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Reconcile replies and atomically lease unanswered human entries.

    - answered entries become processed (terminal) and are never dispatched again;
    - entries older than eligible_since are recorded as baseline_skipped;
    - an entry is dispatched at most `max_attempts` times and only while unanswered;
    - at most `max_messages` per wake and `daily_cap` wakes per day (BRT);
    - read_links maps link_id -> entry ids returned by that read; pending rows of a
      read link that fell out of the window become superseded.
    Links that still hold unclaimed work are added to `deferred_links`.
    """
    db_path = Path(db_path)
    claimed: list[dict[str, Any]] = []
    deferred = deferred_links if deferred_links is not None else set()
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        con.execute("PRAGMA synchronous=FULL")
        try:
            _init_db(con)
            now_dt = _as_utc(now)
            now_text = now_dt.isoformat()
            eligible_since = _parse_time(
                (con.execute("SELECT value FROM meta WHERE key='eligible_since'").fetchone() or [None])[0]
            )
            day = _brt_day(now_dt)
            used = con.execute("SELECT n FROM wakes WHERE day = ?", (day,)).fetchone()
            cap_reached = bool(used and int(used[0]) >= daily_cap)
            with con:
                for entry in entries:
                    entry_id = _entry_id(entry)
                    link_id = entry.get("link_id")
                    if entry_id is None or not link_id:
                        continue
                    link_id = str(link_id)
                    row = con.execute(
                        "SELECT state, lease_until, attempts FROM processed_entries "
                        "WHERE link_id = ? AND entry_id = ?",
                        (link_id, entry_id),
                    ).fetchone()
                    if entry.get("response_confirmed"):
                        if not row or row[0] not in TERMINAL_STATES or row[0] == "expired":
                            con.execute(
                                """
                                INSERT INTO processed_entries
                                    (link_id, entry_id, state, claimed_at, lease_until, lease_token, completed_at, attempts)
                                VALUES (?, ?, 'processed', ?, NULL, NULL, ?, 0)
                                ON CONFLICT(link_id, entry_id) DO UPDATE SET
                                    state='processed', lease_until=NULL, lease_token=NULL,
                                    completed_at=excluded.completed_at
                                """,
                                (link_id, entry_id, now_text, now_text),
                            )
                        continue
                    if row and row[0] in TERMINAL_STATES:
                        continue
                    created = _parse_time(entry.get("created_at"))
                    if not row and eligible_since and created and created < eligible_since:
                        con.execute(
                            "INSERT OR IGNORE INTO processed_entries "
                            "(link_id, entry_id, state, claimed_at, completed_at, attempts, note) "
                            "VALUES (?, ?, 'baseline_skipped', ?, ?, 0, 'anterior ao corte de 26/10')",
                            (link_id, entry_id, now_text, now_text),
                        )
                        continue
                    if row and _lease_deadline_is_active(row[1], now_dt):
                        continue  # in flight
                    attempts = int(row[2] or 0) if row else 0
                    if attempts >= max_attempts:
                        con.execute(
                            "UPDATE processed_entries SET state='expired', lease_until=NULL, lease_token=NULL, "
                            "completed_at=?, note='sem resposta após tentativas' WHERE link_id=? AND entry_id=?",
                            (now_text, link_id, entry_id),
                        )
                        continue
                    if cap_reached or len(claimed) >= max_messages:
                        deferred.add(link_id)
                        continue
                    lease_token = uuid.uuid4().hex
                    deadline = _lease_until(now_dt, lease_seconds)
                    con.execute(
                        """
                        INSERT INTO processed_entries
                            (link_id, entry_id, state, claimed_at, lease_until, lease_token, completed_at, attempts)
                        VALUES (?, ?, 'leased', ?, ?, ?, NULL, 1)
                        ON CONFLICT(link_id, entry_id) DO UPDATE SET
                            state='leased', claimed_at=excluded.claimed_at,
                            lease_until=excluded.lease_until, lease_token=excluded.lease_token,
                            completed_at=NULL, attempts=processed_entries.attempts + 1
                        """,
                        (link_id, entry_id, now_text, deadline, lease_token),
                    )
                    claimed_entry = {key: value for key, value in entry.items() if key != "response_confirmed"}
                    claimed_entry.update({
                        "lease_token": lease_token,
                        "lease_until": deadline,
                        "lease_deadline": deadline,
                        "attempt": attempts + 1,
                    })
                    claimed.append(claimed_entry)
                for link_id, seen_ids in (read_links or {}).items():
                    pending = con.execute(
                        "SELECT entry_id FROM processed_entries WHERE link_id = ? AND state = 'leased' "
                        "AND (lease_until IS NULL OR lease_until <= ?)",
                        (link_id, now_text),
                    ).fetchall()
                    for (pending_id,) in pending:
                        if pending_id not in seen_ids:
                            con.execute(
                                "UPDATE processed_entries SET state='superseded', lease_until=NULL, lease_token=NULL, "
                                "completed_at=?, note='fora da janela de leitura' WHERE link_id=? AND entry_id=?",
                                (now_text, link_id, pending_id),
                            )
                if claimed:
                    con.execute(
                        "INSERT INTO wakes(day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1",
                        (day,),
                    )
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
    """Renew only unexpired leases owned by the supplied lease token (compare-and-set)."""
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


def expire_stuck_leases(db_path: Path | str, *, now: dt.datetime | None = None) -> int:
    """One-off cleanup: every 'leased' row becomes expired, without answering it."""
    db_path = Path(db_path)
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        try:
            _init_db(con)
            now_text = _as_utc(now).isoformat()
            with con:
                cur = con.execute(
                    "UPDATE processed_entries SET state='expired', lease_until=NULL, lease_token=NULL, "
                    "completed_at=?, note='reserva presa do laço antigo, expirada em 26/10 sem resposta' "
                    "WHERE state='leased'",
                    (now_text,),
                )
                return cur.rowcount
        finally:
            con.close()


def gate_payload(messages: list[dict[str, Any]], *, reply_field: bool = False) -> dict[str, Any]:
    if not messages:
        return {"wakeAgent": False}
    safe_messages = []
    for message in messages:
        value = dict(message)
        if value.get('needs_client_clarification'):
            # The original remains in the diary. Do not dispatch ambiguous work.
            value['title'] = 'Confirmar o cliente deste pedido'
            value['body'] = 'Há referências de cliente inválidas ou conflitantes. Responda nesta conversa pedindo o cliente correto. Não execute o pedido original.'
            value['dispatch_kind'] = 'clarification_only'
        else:
            value['dispatch_kind'] = 'portfolio_coordination' if value.get('target_scope') == 'portfolio' else 'scoped_request'
        if reply_field:
            value['reply_to_entry_id'] = value.get('entry_id')
        safe_messages.append(value)
    return {
        "wakeAgent": True,
        "reply_to_supported": bool(reply_field),
        "regra": (
            "Uma única resposta por vínculo nesta rodada, assinada pelo operator indicado na mensagem. "
            "Não chame aceleriq_operator_board; o contexto do vínculo já está aqui."
        ),
        "messages": safe_messages,
    }


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


def should_read_diary(link: dict[str, Any], seen: dict[str, str] | None, pending: set[str] | None) -> bool:
    """Read a link diary only when it can hold new human context."""
    link_id = str(link.get("id") or link.get("link_id") or "")
    if seen is None or SEEN_FIELD not in link:
        return True
    if pending and link_id in pending:
        return True
    human_at = link.get(SEEN_FIELD)
    if not human_at:
        return False
    return seen.get(link_id) != str(human_at)


async def collect_candidates(call, *, deadline, board_limit=500, diary_limit=DIARY_LIMIT, max_links=500,
                             seen: dict[str, str] | None = None, pending: set[str] | None = None,
                             read_marks: dict[str, str] | None = None,
                             read_links: dict[str, set[str]] | None = None,
                             diary_supports_since: bool = False):
    async def bounded(name, args):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("diary read deadline")
        return await asyncio.wait_for(call(name, args), timeout=min(remaining, 15))
    board = await bounded("aceleriq_operator_board", {"limit": board_limit})
    links = board.get("vinculos", []) if isinstance(board, dict) else []
    paperclip = paperclip_operators(board if isinstance(board, dict) else None)
    semaphore = asyncio.Semaphore(4)

    async def read(link):
        link_id = str(link.get("id") or link.get("link_id"))
        args: dict[str, Any] = {"link_id": link_id, "limit": diary_limit}
        if diary_supports_since and seen and link_id in seen and not (pending and link_id in pending):
            args["desde"] = seen[link_id]
        async with semaphore:
            try:
                diary = await bounded("aceleriq_operator_diary", args)
            except Exception:
                return []
        if not isinstance(diary, dict):
            return []
        entries = diary.get("entradas") or diary.get("entries") or []
        if read_links is not None and "desde" not in args:
            read_links[link_id] = {e for e in (_entry_id(x) for x in entries if isinstance(x, dict)) if e}
        if read_marks is not None and link.get(SEEN_FIELD):
            read_marks[link_id] = str(link.get(SEEN_FIELD))
        return human_candidates(link, diary)

    eligible = [
        link for link in links[:max_links]
        if isinstance(link, dict) and (link.get("id") or link.get("link_id"))
        and link_is_open(link) and link_is_hermes(link, paperclip)
        and should_read_diary(link, seen, pending)
    ]
    rows = await asyncio.gather(*(read(link) for link in eligible))
    unique = {(r["link_id"], r["entry_id"]): r for group in rows for r in group}
    pending_targets = [r for r in unique.values() if r.get('target_client_id') and not r.get('response_confirmed')]
    if pending_targets:
        roster = await bounded('aceleriq_list_clients', {'limit': 500, 'offset': 0})
        verify_client_targets(pending_targets, roster)
    return sorted(unique.values(), key=lambda r: (r.get("created_at") or "", r["link_id"], r["entry_id"]))


def verify_client_targets(messages, roster):
    """Confirm the client role against the existing MCP before leasing work."""
    items = roster.get('items', []) if isinstance(roster, dict) else []
    if not isinstance(roster, dict) or roster.get('has_more') or roster.get('total') != len(items):
        raise RuntimeError('Não foi possível conferir o cadastro completo de clientes.')
    known = {str(c.get('id')): c for c in items}
    if len(known) != len(items):
        raise RuntimeError('Cadastro duplicado na leitura de clientes.')
    for message in messages:
        target = message.get('target_client_id')
        if not target:
            continue
        client = known.get(target)
        message['target_client_verified'] = bool(client)
        if client:
            message['target_client_name'] = _safe_text(client.get('company_name') or client.get('full_name') or '')
        else:
            message['needs_client_clarification'] = True
            message['target_scope'] = 'unresolved'


def load_read_state(db_path: Path | str) -> tuple[dict[str, str], set[str]]:
    """Last human-entry time already read per link, and links with unconfirmed leases."""
    db_path = Path(db_path)
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        try:
            _init_db(con)
            seen = {str(r[0]): str(r[1]) for r in con.execute("SELECT link_id, human_at FROM link_seen")}
            pending = {str(r[0]) for r in con.execute(
                "SELECT DISTINCT link_id FROM processed_entries WHERE state = 'leased'")}
            con.commit()
        finally:
            con.close()
    return seen, pending


def remember_read(db_path: Path | str, marks: dict[str, str]) -> None:
    """Persist read marks only after the claims of that read were stored."""
    if not marks:
        return
    db_path = Path(db_path)
    with _database_lock(db_path):
        con = sqlite3.connect(db_path, timeout=5)
        try:
            _init_db(con)
            with con:
                con.executemany(
                    "INSERT INTO link_seen(link_id, human_at) VALUES (?, ?) "
                    "ON CONFLICT(link_id) DO UPDATE SET human_at=excluded.human_at",
                    list(marks.items()),
                )
        finally:
            con.close()


def tool_features(tools: Iterable[Any]) -> dict[str, bool]:
    """Detect the new panel contract from the MCP tool list (no call needed)."""
    features = {"reply_to": False, "since": False}
    for tool in tools:
        if getattr(tool, "name", None) != "aceleriq_operator_diary":
            continue
        schema = getattr(tool, "input_schema", None) or getattr(tool, "inputSchema", None) or {}
        props = schema.get("properties", {}) if isinstance(schema, dict) else {}
        features["reply_to"] = "reply_to_entry_id" in props
        features["since"] = "desde" in props
    return features


async def _collect_candidates(seen: dict[str, str] | None = None, pending: set[str] | None = None,
                              read_marks: dict[str, str] | None = None,
                              read_links: dict[str, set[str]] | None = None,
                              features_out: dict[str, bool] | None = None) -> list[dict[str, Any]]:
    sys.path.insert(0, HERMES_ROOT)
    from tools.mcp_tool_config import _load_mcp_config
    from tools.mcp_tool_discovery import _connect_server

    config = _load_mcp_config()
    if "aceleriq" not in config:
        raise RuntimeError("Aceleriq MCP is not configured")
    server = await _connect_server("aceleriq", config["aceleriq"])
    try:
        tools = (await server.session.list_tools()).tools
        available = {tool.name for tool in tools}
        if not REQUIRED_TOOLS.issubset(available):
            raise RuntimeError("Required Aceleriq diary tools are unavailable")
        features = tool_features(tools)
        if features_out is not None:
            features_out.update(features)

        async def call(name: str, args: dict[str, Any]) -> Any:
            if name not in ALLOWED_TOOLS:
                raise ValueError("Tool outside allowlist")
            return _decode_tool_result(await asyncio.wait_for(server.session.call_tool(name, args), timeout=20))

        return await collect_candidates(call, deadline=time.monotonic() + 40,
                                        seen=seen, pending=pending, read_marks=read_marks,
                                        read_links=read_links, diary_supports_since=features["since"])
    finally:
        await server.shutdown()


async def run(db_path: Path) -> dict[str, Any]:
    with consumer_run_lock(db_path) as acquired:
        if not acquired:
            return {"wakeAgent": False}
        seen, pending = load_read_state(db_path)
        marks: dict[str, str] = {}
        read_links: dict[str, set[str]] = {}
        features: dict[str, bool] = {}
        candidates = await asyncio.wait_for(
            _collect_candidates(seen, pending, marks, read_links, features), timeout=50)
        deferred: set[str] = set()
        claimed = claim_new_entries(db_path, candidates, read_links=read_links, deferred_links=deferred)
        # Links with work left for a later run keep their old mark so they are read again.
        remember_read(db_path, {k: v for k, v in marks.items() if k not in deferred})
        return gate_payload(claimed, reply_field=features.get("reply_to", False))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--expire-stuck-leases", action="store_true",
                        help="Marca todas as reservas 'leased' como expired, sem responder, e sai.")
    args = parser.parse_args()
    if args.expire_stuck_leases:
        print(json.dumps({"expired": expire_stuck_leases(args.db)}))
        return 0
    try:
        payload = asyncio.run(run(args.db))
    except Exception as exc:
        # Fail closed for the LLM: the cron log still records a safe class-only signal.
        payload = {"wakeAgent": False, "consumer_error": type(exc).__name__}
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
