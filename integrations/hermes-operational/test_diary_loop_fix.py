"""26/10/2026: o consumidor do diário não pode voltar a ser um laço.

Simula o painel (board + diário) e roda várias rodadas seguidas do gate,
contando leituras, acordadas do agente e respostas.
"""
import asyncio
import datetime as dt
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from diary_consumer import (
    SEEN_FIELD,
    _is_human,
    claim_new_entries,
    collect_candidates,
    expire_stuck_leases,
    gate_payload,
    load_read_state,
    paperclip_operators,
    remember_read,
    tool_features,
    wakes_today,
)

H = "hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh"   # vínculo do Hermes (helena)
P = "pppppppp-pppp-pppp-pppp-pppppppppppp"   # vínculo do Paperclip (gestor-trafego)
D = "dddddddd-dddd-dddd-dddd-dddddddddddd"   # vínculo concluído
T0 = dt.datetime(2026, 10, 26, 14, 0, tzinfo=dt.timezone.utc)

OPERADORES = [
    {"slug": "default", "area": "Core", "responde_a": None},
    {"slug": "helena", "area": "Marketing", "responde_a": "augusto"},
    {"slug": "paperclip", "area": "Paperclip", "responde_a": None},
    {"slug": "gestor-trafego", "area": "Paperclip", "responde_a": "paperclip"},
]


def iso(t):
    return t.isoformat()


class FakePanel:
    def __init__(self):
        self.diaries = {H: [], P: [], D: []}
        self.status = {H: "queued", P: "queued", D: "done"}
        self.operator = {H: "helena", P: "gestor-trafego", D: "helena"}
        self.reads = 0
        self.board_reads = 0

    def human(self, link, eid, t, tipo="instrucao"):
        self.diaries[link].append({"id": eid, "quando": iso(t), "tipo": tipo, "autor": "Almir Bueno",
                                   "autor_kind": "humano", "titulo": "Pedido", "texto": "Faça X"})

    def agent(self, link, eid, t, tipo="comentario"):
        self.diaries[link].append({"id": eid, "quando": iso(t), "tipo": tipo, "autor": "Helena",
                                   "autor_kind": "operador", "titulo": "Feito", "texto": "FEITO: X"})

    def last_human(self, link):
        times = [e["quando"] for e in self.diaries[link] if e["autor_kind"] == "humano"]
        return max(times) if times else None

    async def call(self, name, args):
        if name == "aceleriq_operator_board":
            self.board_reads += 1
            return {"operadores": OPERADORES, "vinculos": [
                {"id": l, "status": self.status[l], "operador": self.operator[l], "client_id": None,
                 SEEN_FIELD: self.last_human(l)} for l in self.diaries]}
        if name == "aceleriq_operator_diary":
            self.reads += 1
            return {"entradas": self.diaries[args["link_id"]][-args.get("limit", 100):]}
        raise AssertionError(name)


def one_round(db, panel, now):
    seen, pending = load_read_state(db)
    marks, read_links, deferred = {}, {}, set()
    found = asyncio.run(collect_candidates(panel.call, deadline=time.monotonic() + 30, seen=seen,
                                           pending=pending, read_marks=marks, read_links=read_links))
    claimed = claim_new_entries(db, found, now=now, read_links=read_links, deferred_links=deferred)
    remember_read(db, {k: v for k, v in marks.items() if k not in deferred})
    return claimed


class LoopFixTest(unittest.TestCase):
    def test_agent_instruction_is_not_human(self):
        self.assertFalse(_is_human({"tipo": "instrucao", "autor_kind": "operador"}))
        self.assertFalse(_is_human({"tipo": "correcao", "autor_kind": "operador", "autor": "almir"}))
        self.assertTrue(_is_human({"tipo": "comentario", "autor_kind": "humano"}))

    def test_paperclip_operators_from_board(self):
        self.assertEqual(paperclip_operators({"operadores": OPERADORES}), {"paperclip", "gestor-trafego"})
        self.assertIn("chefe", paperclip_operators({}))

    def test_one_reply_per_human_entry_over_many_rounds(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "c.sqlite3"
            panel = FakePanel()
            panel.human(H, "h1", T0)
            panel.human(P, "p1", T0)       # Paperclip: não é do Hermes
            panel.human(D, "d1", T0)       # concluído: não é lido
            wakes = 0
            replies = 0
            for minute in range(0, 120, 5):
                now = T0 + dt.timedelta(minutes=minute + 1)
                claimed = one_round(db, panel, now)
                if claimed:
                    wakes += 1
                    for c in claimed:
                        self.assertEqual(c["operator"], "helena")
                        self.assertEqual(c["link_id"], H)
                        panel.agent(H, f"r{minute}", now + dt.timedelta(minutes=2))
                        replies += 1
            self.assertEqual((wakes, replies), (1, 1))
            # 1 leitura de diário para a entrada nova + 1 para confirmar a resposta (reserva pendente).
            self.assertLessEqual(panel.reads, 3)
            con = sqlite3.connect(db)
            self.assertEqual(con.execute("select state from processed_entries where entry_id='h1'").fetchone()[0], "processed")

    def test_unanswered_entry_is_retried_once_then_expires(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "c.sqlite3"
            panel = FakePanel()
            panel.human(H, "h1", T0)
            dispatches = 0
            for minute in range(0, 24 * 60, 5):
                dispatches += len(one_round(db, panel, T0 + dt.timedelta(minutes=minute + 1)))
            self.assertEqual(dispatches, 2)
            con = sqlite3.connect(db)
            self.assertEqual(con.execute("select state from processed_entries where entry_id='h1'").fetchone()[0], "expired")
            self.assertEqual(load_read_state(db)[1], set())

    def test_entries_before_cutoff_are_not_answered(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "c.sqlite3"
            panel = FakePanel()
            panel.human(H, "old", T0 - dt.timedelta(days=1))
            self.assertEqual(one_round(db, panel, T0), [])
            con = sqlite3.connect(db)
            self.assertEqual(con.execute("select state from processed_entries").fetchone()[0], "baseline_skipped")

    def test_daily_cap_and_per_wake_cap(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "c.sqlite3"
            entries = [{"link_id": H, "entry_id": f"e{i}", "created_at": iso(T0), "response_confirmed": False}
                       for i in range(9)]
            deferred = set()
            first = claim_new_entries(db, entries, now=T0, max_messages=5, deferred_links=deferred)
            self.assertEqual(len(first), 5)
            self.assertEqual(deferred, {H})
            second = claim_new_entries(db, entries, now=T0 + dt.timedelta(minutes=5), max_messages=5, daily_cap=1)
            self.assertEqual(second, [])
            self.assertEqual(wakes_today(db, T0), 1)

    def test_respondida_por_counts_as_answered(self):
        panel_diary = {"entradas": [{"id": "h1", "autor_kind": "humano", "tipo": "instrucao",
                                     "quando": iso(T0), "respondida_por": "x"}]}
        from diary_consumer import human_candidates
        self.assertTrue(human_candidates({"id": H, "operador": "helena"}, panel_diary)[0]["response_confirmed"])

    def test_expire_stuck_leases(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "c.sqlite3"
            claim_new_entries(db, [{"link_id": H, "entry_id": "e1", "created_at": iso(T0)}], now=T0)
            self.assertEqual(expire_stuck_leases(db), 1)
            self.assertEqual(load_read_state(db)[1], set())

    def test_feature_detection_and_reply_field(self):
        class Tool:
            def __init__(self, props):
                self.name = "aceleriq_operator_diary"
                self.input_schema = {"properties": props}
        self.assertEqual(tool_features([Tool({"link_id": {}})]), {"reply_to": False, "since": False})
        self.assertEqual(tool_features([Tool({"reply_to_entry_id": {}, "desde": {}})]), {"reply_to": True, "since": True})
        payload = gate_payload([{"entry_id": "e1", "link_id": H}], reply_field=True)
        self.assertEqual(payload["messages"][0]["reply_to_entry_id"], "e1")
        self.assertNotIn("reply_to_entry_id", gate_payload([{"entry_id": "e1", "link_id": H}])["messages"][0])


if __name__ == "__main__":
    unittest.main()
