"""19/10/2026: the consumer opens only diaries that can hold new human context."""
import asyncio
import tempfile
import time
import unittest
from pathlib import Path

from diary_consumer import (
    SEEN_FIELD,
    claim_new_entries,
    collect_candidates,
    human_candidates,
    load_read_state,
    remember_read,
    should_read_diary,
)

A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
C = "cccccccc-cccc-cccc-cccc-cccccccccccc"
T1 = "2026-10-19T10:00:00+00:00"
T2 = "2026-10-19T11:00:00+00:00"


class ReadGateTest(unittest.TestCase):
    def test_older_panel_without_field_reads_everything(self):
        self.assertTrue(should_read_diary({"id": A}, {}, set()))
        self.assertTrue(should_read_diary({"id": A, SEEN_FIELD: T1}, None, None))

    def test_reads_only_when_human_time_changed_or_lease_pending(self):
        seen = {A: T1}
        self.assertFalse(should_read_diary({"id": A, SEEN_FIELD: T1}, seen, set()))
        self.assertTrue(should_read_diary({"id": A, SEEN_FIELD: T2}, seen, set()))
        self.assertTrue(should_read_diary({"id": B, SEEN_FIELD: T1}, seen, set()))
        self.assertFalse(should_read_diary({"id": C, SEEN_FIELD: None}, seen, set()))
        self.assertTrue(should_read_diary({"id": A, SEEN_FIELD: T1}, seen, {A}))

    def test_collect_skips_unchanged_diaries_and_marks_what_it_read(self):
        calls = []

        async def call(name, args):
            calls.append((name, args.get("link_id")))
            if name == "aceleriq_operator_board":
                return {"vinculos": [
                    {"id": A, SEEN_FIELD: T1},
                    {"id": B, SEEN_FIELD: T2},
                    {"id": C, SEEN_FIELD: None},
                ]}
            return {"entradas": [{"id": "e1", "autor_kind": "humano", "texto": "Faça o vídeo"}]}

        marks = {}
        found = asyncio.run(collect_candidates(call, deadline=time.monotonic() + 30,
                                               seen={A: T1, B: T1}, pending=set(), read_marks=marks))
        diaries = [link for name, link in calls if name == "aceleriq_operator_diary"]
        self.assertEqual(diaries, [B])
        self.assertEqual(marks, {B: T2})
        self.assertEqual([f["link_id"] for f in found], [B])

    def test_marks_persist_and_unconfirmed_leases_keep_the_link_open(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "c.sqlite3"
            seen, pending = load_read_state(db)
            self.assertEqual((seen, pending), ({}, set()))
            claim_new_entries(db, [{"link_id": A, "entry_id": "e1", "response_confirmed": False}])
            remember_read(db, {A: T1})
            seen, pending = load_read_state(db)
            self.assertEqual(seen, {A: T1})
            self.assertEqual(pending, {A})
            claim_new_entries(db, [{"link_id": A, "entry_id": "e1", "response_confirmed": True}])
            self.assertEqual(load_read_state(db)[1], set())


class ReplyWithoutUuidTest(unittest.TestCase):
    """The diary tool forbids UUIDs in text, so a later operator entry is the reply."""

    def test_operator_entry_after_the_instruction_confirms_it(self):
        diary = {"entradas": [
            {"id": "h1", "autor_kind": "humano", "tipo": "correcao", "texto": "Corrija o destino", "quando": T1},
            {"id": "o1", "autor_kind": "operador", "texto": "Correção recebida; destino ajustado.", "quando": T2},
        ]}
        self.assertTrue(human_candidates({"id": A}, diary)[0]["response_confirmed"])

    def test_operator_entry_before_the_instruction_does_not(self):
        diary = {"entradas": [
            {"id": "o0", "autor_kind": "operador", "texto": "Status anterior.", "quando": T1},
            {"id": "h1", "autor_kind": "humano", "tipo": "instrucao", "texto": "Faça o vídeo", "quando": T2},
        ]}
        self.assertFalse(human_candidates({"id": A}, diary)[0]["response_confirmed"])


if __name__ == "__main__":
    unittest.main()
