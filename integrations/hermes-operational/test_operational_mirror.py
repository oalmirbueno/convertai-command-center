import asyncio
import tempfile
import unittest
from pathlib import Path
from operational_mirror import Mirror

LINK = "ec458067-44bc-4462-93ea-640374492f1e"


class MirrorTests(unittest.TestCase):
    def test_unbound_and_private_events_do_not_leave_conversation(self):
        with tempfile.TemporaryDirectory() as folder:
            m = Mirror(Path(folder)/"test.sqlite3", start=False)
            self.assertFalse(m.event("s", "message.complete", {"text": "personal"}))
            self.assertFalse(m.event("s", "reasoning.delta", {"text": "private"}))
            self.assertEqual(m.pending.qsize(), 0)

    def test_retry_reads_back_and_does_not_duplicate_or_copy_tool_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            m = Mirror(Path(folder)/"test.sqlite3", start=False)
            m.event("s", "tool.complete", {"name": "mcp_aceleriq_operator_diary", "args": {"link_id": LINK, "api_key": "private"}, "result": "private"})
            m.event("s", "message.complete", {"text": "Resultado confirmado", "reasoning": "private"})
            entries = []
            writes = []
            fail = [True]
            async def call(name, args):
                if name.endswith("board"):
                    return {"vinculos": [{"id": LINK, "client_id": "client", "operador": "registro"}]}
                if args.get("body"):
                    writes.append(args)
                    entries.append({"texto": args["body"]})
                    if fail.pop() if fail else False:
                        raise TimeoutError("response lost after commit")
                return {"entradas": entries}
            with self.assertRaises(TimeoutError):
                asyncio.run(m.deliver(call))
            with m.connect() as con:
                con.execute("UPDATE public_updates SET claimed=0")
            asyncio.run(m.deliver(call))
            self.assertEqual(len(writes), 2)
            self.assertNotIn("private", str(writes))
            self.assertEqual(asyncio.run(m.deliver(call)), 0)

    def test_no_write_if_binding_is_missing_from_panel(self):
        with tempfile.TemporaryDirectory() as folder:
            m = Mirror(Path(folder)/"test.sqlite3", start=False)
            m.event("s", "tool.complete", {"name": "mcp_aceleriq_operator_report", "args": {"link_id": LINK}})
            calls = []
            async def call(name, args):
                calls.append(name)
                return {"vinculos": []}
            self.assertEqual(asyncio.run(m.deliver(call)), 0)
            self.assertEqual(calls, ["aceleriq_operator_board"])


    def test_item_is_discarded_after_max_attempts_and_window_is_small(self):
        with tempfile.TemporaryDirectory() as folder:
            m = Mirror(Path(folder)/"test.sqlite3", start=False)
            m.event("s", "tool.complete", {"name": "mcp_aceleriq_operator_diary", "args": {"link_id": LINK}})
            limits = []
            async def call(name, args):
                if name.endswith("board"):
                    return {"vinculos": [{"id": LINK, "client_id": "client", "operador": "registro"}]}
                if not args.get("body"):
                    limits.append(args.get("limit"))
                return {"entradas": []}  # marker never shows up
            for _ in range(5):
                with m.connect() as con:
                    con.execute("UPDATE public_updates SET claimed=0")
                asyncio.run(m.deliver(call))
            with m.connect() as con:
                state, attempts = con.execute("SELECT state, attempts FROM public_updates").fetchone()
            self.assertEqual((state, attempts), ("discarded", 3))
            self.assertTrue(limits and max(limits) <= 20)

    def test_paperclip_or_done_link_is_discarded_without_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            m = Mirror(Path(folder)/"test.sqlite3", start=False)
            m.event("s", "tool.complete", {"name": "mcp_aceleriq_operator_diary", "args": {"link_id": LINK}})
            writes = []
            async def call(name, args):
                if name.endswith("board"):
                    return {"operadores": [{"slug": "gestor-trafego", "area": "Paperclip"}],
                            "vinculos": [{"id": LINK, "client_id": "client", "operador": "gestor-trafego"}]}
                writes.append(args)
                return {"entradas": []}
            asyncio.run(m.deliver(call))
            self.assertEqual(writes, [])
            with m.connect() as con:
                self.assertEqual(con.execute("SELECT state FROM public_updates").fetchone()[0], "discarded")


if __name__ == "__main__":
    unittest.main()
