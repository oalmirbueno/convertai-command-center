# Synthetic E2E seed

`node scripts/seed-ci-e2e.mjs --seed` creates five separate users through the real local `auth.admin.createUser` API. The real `handle_new_user` trigger creates each profile and its initial client role. The seed updates the single synthetic role row for admin and the two design users; it never deletes role rows or fabricates a browser session.

The fixture has admin, assignedStaff, unassignedStaff, clientA and clientB accounts. Only assignedStaff is linked to clientA. Each client gets one active social_media project and one design/static task; task A is assigned to assignedStaff, while B is unassigned. Profiles have the onboarding tour acknowledged and synthetic active plans. There are no files, social connections, publications, orders, executions or provider credentials.

The only accepted endpoints are `http://127.0.0.1:54321` for Auth and PostgreSQL `127.0.0.1:54322`, database/user `postgres`. Execution requires `CI=true` and `GITHUB_ACTIONS=true`, plus the existing isolated bootstrap attestation. `ACELERIQ_E2E_SERVICE_ROLE_KEY` and `ACELERIQ_E2E_ANON_KEY` come only from the ephemeral stack status; neither is written to a file or printed. `PGPASSWORD` and optional `PSQL_PATH` configure the local SQL client. Alternate URLs, ports, hosts and databases are refused.

Preflight requires empty Auth/profile/work tables, empty operator/publication queues and an empty Vault. It reads no secret values. Reached triggers have an explicit function allowlist. Only the outbound `notify_ops_sync` hooks on profiles/projects/tasks are temporarily disabled; real auth, RLS and business guards remain enabled. Hook OIDs and original modes are saved in the private CI schema and restored in `finally`, including a failure during account creation. No migration or production ledger is changed.

The generated `e2e/.auth/ci-fixture.json` is private and ignored by Git. It contains only public IDs and credentials generated for these synthetic users, with no access, refresh, service or anonymous tokens. Playwright reads this fixture and performs a real password login through the application UI. Do not upload the fixture or record token-bearing traces/HAR.

Commands:

- `--self-test`: pure guardrail checks; no database or network calls, usable outside CI.
- `--seed`: seed, restore hooks, verify zero HTTP and intact synthetic relations, then write the private fixture.
- `--restore`: restore exact hook modes; safe to repeat from the wrapper's `finally` and workflow's `always` step.
- `--verify`: read-only check after Playwright and restoration. It compares complete project/task rows and exact role/assignment relations, confirms five Auth users/profiles and empty execution/publication queues, and checks the pg_net sequence against its pre-seed state. This detects requests even after the queue worker consumed them. Legitimate Auth login timestamps and local login notifications may change.

Use the stack's egress firewall throughout setup and tests as well as the browser's exact-origin guard. Missing integration credentials and disabled seed hooks complement that network boundary; they do not replace it. A failed or partial seed leaves its synthetic records for diagnosis. It refuses to overwrite credentials or silently reuse a populated database; a new ephemeral CI run provides the next clean attempt.

Local validation covers the script's CI/endpoint/identity guardrails and lint. The notebook has no Docker/GoTrue stack, so creation through Auth and the full browser flow are validated by GitHub CI, not by fabricated local Auth responses.
