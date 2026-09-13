# Disposable CI browser checks

These eight Chromium tests run only in the existing GitHub CI Supabase stack.
The Vite E2E configuration keeps the real application and password login, with
fixed origins `http://127.0.0.1:4173` and `http://127.0.0.1:54321`. It never imports
the production connection pin. The seed script supplies five disposable users,
two projects and two tasks through ignored `e2e/.auth/ci-fixture.json`.

The suite covers admin, assigned design staff, unassigned design staff, clients
A/B and an unauthenticated visitor. It exercises successful and rejected real
password login, protected routes, project filters, client detail tabs, cancelling
an unsaved admin form and logout. It does not save or dispatch work.

The actual UI's unfiltered task REST responses verify row isolation. Client
A/B project requests are also asserted to contain no client/project ID filter.
Staff project cards alone would not prove authorization because their UI
queries contain an ID filter.

To verify the backend for all five authenticated roles, each scenario also
reuses the application's Supabase singleton inside the browser after normal UI
login and performs a real project GET selecting only IDs and ownership. Its only
predicate excludes deleted projects; the request query keys are asserted.
Expected rows are both projects for admin, A for assigned staff, none for
unassigned staff, and the respective project for each client. No session,
token, auth response or request headers are extracted. This exercises the
incremental SEC01 project policy through PostgREST; database tests separately
cover the policy's SQL permission contract.

Every context installs HTTP and WebSocket guards before its first page exists.
Only the two exact loopback origins are forwarded. HTTP upstream reads use
`route.fetch({maxRedirects: 0})`; server redirects are rejected in these flows.
WebSockets have no upstream unless the exact loopback URL is accepted.
Service workers are blocked. Expected negative probes use reserved `.invalid`
hosts and a rejected loopback port; any other blocked attempt fails the test.
REST/RPC/storage writes and worker invocations are rejected, except the real
Auth token/logout requests and the app's usual local login notification.
The separate CI Docker firewall contains backend egress.

No API login shortcut, injected session, auth bypass, stored browser state or
business response mock is used. Traces, videos and HAR are off; failure
screenshots contain only disposable fixture data. Never publish `.auth` or
include it in CI artifacts.

Static verification:

```sh
npx tsc -p e2e/tsconfig.json
CI=true GITHUB_ACTIONS=true npx playwright test --list
```

Actual execution requires the guarded CI seed/configuration/firewall steps in
the workflow and `npx playwright test`. Test discovery/typechecking are not a
browser pass.

API references:
[context network routing](https://playwright.dev/docs/api/class-browsercontext#browser-context-route),
[redirect handling](https://playwright.dev/docs/api/class-route#route-fetch),
[WebSocket forwarding](https://playwright.dev/docs/api/class-websocketroute#web-socket-route-connect-to-server).
