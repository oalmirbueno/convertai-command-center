import unittest
from diary_consumer import human_candidates


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

if __name__ == '__main__':
    unittest.main()
