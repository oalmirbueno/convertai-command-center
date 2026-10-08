import unittest
from diary_consumer import human_candidates, client_target, gate_payload

A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'


class ContextTest(unittest.TestCase):
    def test_human_message_preserves_client_request_and_parent_context(self):
        link = {'id': 'link', 'tarefa': 'Coordenação', 'projeto': 'Carteira', 'cliente': 'Agência', 'client_id': 'agency'}
        diary = {'entries': [{'id': 'entry', 'author_kind': 'humano', 'body': 'Cliente: Cliente A\nReferência do cliente: client-a\nFaça vídeo.'}]}
        result = human_candidates(link, diary)[0]
        self.assertEqual(result['project_client'], 'Agência')
        self.assertEqual(result['task_title'], 'Coordenação')
        self.assertIn('Cliente A', result['body'])
        self.assertIn('cliente atendido', result['communication'])
        self.assertFalse(result['response_confirmed'])

    def test_no_fake_client_or_claimed_response(self):
        result = human_candidates({'id': 'link'}, {'entries': [{'id': 'e', 'entry_type': 'instrucao', 'body': 'Oi'}]})[0]
        self.assertEqual(result['project_client'], '')
        self.assertIsNone(result['project_client_id'])
        self.assertFalse(result['response_confirmed'])

    def test_portfolio_never_infers_coordinating_agency_as_target(self):
        link = {'projeto': 'Carteira Meta Ads — Gestão', 'client_id': A}
        self.assertEqual(client_target(link, 'Analise a carteira')['target_scope'], 'portfolio')
        self.assertIsNone(client_target(link, 'Analise a carteira')['target_client_id'])
        self.assertEqual(client_target(link, f'Referência do cliente: {B}')['target_client_id'], B)

    def test_conflicting_target_dispatches_only_clarification(self):
        body = f'Referência do cliente: {A}\nReferência do cliente: {B}\nAltere tudo.'
        target = client_target({}, body)
        result = gate_payload([{'entry_id': 'entry', 'link_id': 'link', 'body': body, **target}])['messages'][0]
        self.assertTrue(result['needs_client_clarification'])
        self.assertEqual(result['dispatch_kind'], 'clarification_only')
        self.assertNotIn('Altere tudo', result['body'])
        self.assertEqual(result['entry_id'], 'entry')

    def test_missing_target_does_not_invent_client(self):
        self.assertIsNone(client_target({}, 'Oi')['target_client_id'])
        self.assertTrue(client_target({}, 'Referência do cliente: inventado')['needs_client_clarification'])

    def test_normal_project_keeps_known_client_and_empty_gate_stays_cheap(self):
        self.assertEqual(client_target({'client_id': A}, 'Confira o briefing')['target_client_id'], A)
        self.assertEqual(gate_payload([]), {'wakeAgent': False})

if __name__ == '__main__':
    unittest.main()
