"""26/10/2026: um boletim = um registro no painel (nunca 4 runs review)."""
import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

base = Path(__file__).resolve().parent
module_path = base / 'meta_ads_bridge.py'
if not module_path.exists():
    module_path = base / 'painel_bridge.py'
spec = importlib.util.spec_from_file_location('bridge_boletim', module_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

CLIENT = '11111111-1111-1111-1111-111111111111'


def make_run(root):
    run = root / 'runs' / '20261026T090035000000'
    run.mkdir(parents=True)
    summary = {'observed_at': '2026-10-26T09:00:35-03:00', 'expected': 1, 'collected': 1, 'failures': [],
               'clients': [{'client_id': CLIENT, 'name': 'Casa', 'state': 'diários disponíveis',
                            'windows': {'ontem': {'spend': '23.42', 'conversations': '13'}},
                            'comparisons': {}, 'ends_today': [{'id': 'c1', 'name': 'Campanha X', 'end_brt': '2026-10-26T23:59:00-03:00'}]}]}
    (run / 'resumo.json').write_text(json.dumps(summary), encoding='utf-8')
    (run / 'relatorio.md').write_text('# Relatório', encoding='utf-8')
    out = root / 'outputs' / 'augusto' / run.name
    out.mkdir(parents=True)
    (out / 'boletim.txt').write_text('26/10/2026, 09h BRT. Resumo curto.\n\nDetalhe por cliente.', encoding='utf-8')
    return run


class BoletimTests(unittest.TestCase):
    def test_snapshot_and_reviews_make_a_single_record(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run = make_run(root)
            self.assertEqual(bridge.enqueue_snapshot(root, run), [])
            k1 = bridge.enqueue_review(root, run, 'helena')
            k2 = bridge.enqueue_review(root, run, 'augusto')
            k3 = bridge.enqueue_boletim(root, run)
            self.assertEqual(len({k1, k2, k3}), 1)
            self.assertEqual(len(bridge.read_outbox(root)), 1)

    def test_boletim_contract(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            args, _ = bridge.boletim_args(root, make_run(root))
            self.assertEqual(args['periodo'], '2026-10-26 09h')
            self.assertEqual(args['resumo'], '26/10/2026, 09h BRT. Resumo curto.')
            self.assertEqual(args['por_cliente'][0], {'client_id': CLIENT, 'observacao': 'Casa: diários disponíveis', 'gasto': 23.42, 'resultado': 13.0})
            self.assertEqual(args['alertas'][0]['client_id'], CLIENT)
            self.assertIn('Detalhe', args['texto_completo'])

    def test_drain_uses_boletim_tool_when_available(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bridge.enqueue_boletim(root, make_run(root))
            calls = []

            async def call(name, args):
                calls.append(name)
                return {'id': 'aviso-1'}
            state = asyncio.run(bridge.drain(root, call, has_boletim=True))
            self.assertEqual(calls, ['aceleriq_ads_boletim'])
            self.assertEqual(state['states'][0]['state'], 'sent')

    def test_drain_fallback_is_one_documental_done_report(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            key = bridge.enqueue_boletim(root, make_run(root))
            sent = []

            async def call(name, args):
                if name == 'aceleriq_operator_report':
                    sent.append(args)
                    return {}
                return {'runs_recentes': [{'id': 'r1', 'run_key': key, 'operador': 'augusto', 'status': 'done'}]}
            state = asyncio.run(bridge.drain(root, call, has_boletim=False))
            self.assertEqual(len(sent), 1)
            self.assertEqual(sent[0]['event'], 'done')
            self.assertEqual(sent[0]['detail']['work_kind'], 'documental')
            self.assertEqual([s['state'] for s in state['states']], ['sent'])

    def test_failed_boletim_creates_no_extra_records(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            bridge.enqueue_boletim(root, make_run(root))

            async def call(name, args):
                raise RuntimeError('down')
            asyncio.run(bridge.drain(root, call, has_boletim=True))
            self.assertEqual(len(bridge.read_outbox(root)), 1)


if __name__ == '__main__':
    unittest.main()
