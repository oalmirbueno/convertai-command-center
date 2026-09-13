import { notificationReadRows, notificationWriteResponse, type NotificationRow } from './notification-write-response.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value {
  if (!value) throw new Error(message);
}
const rows: NotificationRow[] = [{ user_id: 'synthetic-user', message: 'Synthetic notice', notification_type: 'billing', link: '/financeiro' }];
const headers = { 'Access-Control-Allow-Origin': 'https://app.example.invalid' };

Deno.test('notification response succeeds only after the database accepts the insert', async () => {
  let calls = 0;
  let finish!: (value: { error: null }) => void;
  const waiting = new Promise<{ error: null }>(resolve => { finish = resolve; });
  let responded = false;
  const pending = notificationWriteResponse(rows, supplied => {
    calls++;
    assert(supplied === rows);
    return waiting;
  }, headers).then(response => { responded = true; return response; });
  await Promise.resolve();
  assert(!responded && calls === 1);
  finish({ error: null });
  const response = await pending;
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === JSON.stringify({ ok: true, inserted: 1 }));
  assert(response.headers.get('Access-Control-Allow-Origin') === headers['Access-Control-Allow-Origin']);
});

for (const mode of ['returned error', 'rejected insert'] as const) {
  Deno.test(`notification response returns sanitized 500 for ${mode}`, async () => {
    let calls = 0;
    const response = await notificationWriteResponse(rows, () => {
      calls++;
      const error = new Error('Synthetic private DB details must not escape');
      return mode === 'returned error' ? Promise.resolve({ error }) : Promise.reject(error);
    }, headers);
    assert(calls === 1 && response.status === 500);
    assert(JSON.stringify(await response.json()) === JSON.stringify({ error: 'Internal error' }));
    assert(response.headers.get('Access-Control-Allow-Origin') === headers['Access-Control-Allow-Origin']);
  });
}

Deno.test('deduplicated notifications retain ok response without an extra insert', async () => {
  const response = await notificationWriteResponse([], () => { throw new Error('No write expected'); }, headers);
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === JSON.stringify({ ok: true, inserted: 0 }));
});

Deno.test('failed recipient or dedup lookups stop before a write without exposing database details', () => {
  for (const result of [
    { data: null, error: { message: 'Synthetic private lookup details' } },
    { data: [], error: { message: 'Synthetic partial response' } },
    { data: null, error: null },
  ]) {
    let reachedWrite = false;
    let failure: unknown;
    try {
      notificationReadRows(result);
      reachedWrite = true;
    } catch (error) { failure = error; }
    assert(!reachedWrite && failure instanceof Error);
    assert(failure.message === 'Notification lookup unavailable');
  }
});

Deno.test('successful recipient and dedup lookups preserve rows and legitimate empty results', () => {
  const recipient = [{ user_id: 'synthetic-user' }];
  assert(notificationReadRows({ data: recipient, error: null }) === recipient);
  assert(notificationReadRows({ data: [], error: null }).length === 0);
});
