"""Local files only. Never calls Meta, MCP or a model."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

base = Path(__file__).resolve().parent
module_path = base / 'meta_ads_bridge.py'
if not module_path.exists():
    module_path = base / 'painel_bridge.py'
spec = importlib.util.spec_from_file_location('bridge', module_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class ReadableReportTests(unittest.TestCase):
    def test_real_document_verified_against_its_evidence(self):
        with tempfile.TemporaryDirectory(dir=base) as td:
            root = Path(td)
            report = root / 'runs' / 'cut' / 'relatorio.md'
            report.parent.mkdir(parents=True)
            report.write_text('# Relatório\n\nSem alteração Meta.', encoding='utf-8')
            payload = {'event': 'review', 'run_key': 'meta-snapshot-review-test', 'evidence': f'{report}; SHA256 {hashlib.sha256(report.read_bytes()).hexdigest()}'}
            result = bridge.readable_report(root, payload)
            self.assertEqual(result['detail']['work_kind'], 'documental')
            self.assertEqual(result['detail']['summary'], report.read_text(encoding='utf-8'))
            self.assertNotIn('detail', payload)
            report.write_text('changed', encoding='utf-8')
            with self.assertRaises(ValueError):
                bridge.readable_report(root, payload)

    def test_outside_workflow_rejected(self):
        with self.assertRaises(ValueError):
            bridge.readable_report(base, {'event': 'review', 'run_key': 'meta-snapshot-review-test', 'evidence': '/root/other/report.md'})

    def test_non_report_is_not_relabelled(self):
        p = {'event': 'failed', 'run_key': 'meta-snapshot-review-test'}
        self.assertIs(bridge.readable_report(base, p), p)


if __name__ == '__main__':
    unittest.main()
