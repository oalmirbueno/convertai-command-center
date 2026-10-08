import unittest
from portfolio_scope import read_selection, select_clients, START, END

A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'


class PortfolioTest(unittest.TestCase):
    def test_default_keeps_existing_eligibility_and_exclusions(self):
        clients = [{'id': A, 'plan_status': 'active'}, {'id': B, 'plan_status': 'cancelled'}]
        self.assertEqual(select_clients(clients, None, set()), clients[:1])
        self.assertEqual(select_clients(clients, None, {A}), [])

    def test_empty_is_not_all(self):
        scope = START + '{"version":1,"client_ids":[]}' + END
        self.assertEqual(select_clients([{'id': A, 'plan_status': 'active'}], scope, set()), [])

    def test_explicit_inactive_is_monitored_without_changing_status(self):
        c = {'id': A, 'plan_status': 'inactive'}
        scope = START + '{"version":1,"client_ids":["' + A + '"]}' + END
        self.assertEqual(select_clients([c], scope, set()), [c])
        self.assertEqual(c['plan_status'], 'inactive')

    def test_explicit_never_overrides_exclusion(self):
        scope = START + '{"version":1,"client_ids":["' + A + '"]}' + END
        self.assertEqual(select_clients([{'id': A, 'plan_status': 'active'}], scope, {A}), [])
        self.assertEqual(read_selection(scope), {A})

    def test_corrupt_fails_closed(self):
        for value in [START + '{}'+END, START+'no'+END, START+'{}', START+'{}'+END+END]:
            with self.assertRaises((ValueError, TypeError)):
                read_selection(value)

if __name__ == '__main__':
    unittest.main()
