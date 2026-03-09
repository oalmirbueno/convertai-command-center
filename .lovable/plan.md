

## Plan: Universal API/Webhook Gateway for External Integrations

### Problem
The current webhook system is limited -- hardcoded endpoints, fire-and-forget only (no inbound), no authentication for external callers, and no way for tools like n8n or OpenClaw to **manage** the system (create clients, tasks, projects, update statuses, etc.).

### Solution
Create a single, powerful **Edge Function** (`api-gateway`) that acts as a universal REST API, authenticated via a shared API key (secret). External tools send requests to this gateway specifying an `action` and `payload`, and the gateway executes it using the service role client -- giving full CRUD access to the entire system.

### Architecture

```text
n8n / OpenClaw / Zapier / Make / etc.
            │
            ▼  POST with X-API-Key header
┌──────────────────────────────┐
│   Edge Function: api-gateway │
│   - Validates API key        │
│   - Routes by "action"       │
│   - Full CRUD on all tables  │
│   - Returns structured JSON  │
└──────────────────────────────┘
            │
            ▼
      Supabase DB (service role)
```

### Supported Actions (comprehensive list)

**Clients**: `list_clients`, `get_client`, `create_client`, `update_client`
**Projects**: `list_projects`, `get_project`, `create_project`, `update_project`
**Tasks**: `list_tasks`, `get_task`, `create_task`, `update_task`, `delete_task`
**Milestones**: `list_milestones`, `create_milestone`, `update_milestone`
**Files**: `list_files`, `update_file` (approval status, feedback)
**Reports**: `list_reports`, `create_report`, `update_report`
**Billing**: `list_billing`, `create_billing`, `update_billing`
**Notifications**: `send_notification`
**Client Requests**: `list_requests`, `update_request`
**Briefings**: `list_briefings`, `get_briefing`
**Updates Feed**: `create_update`
**Ads Wallet**: `get_wallet`, `update_wallet`
**System**: `health`, `get_schema` (returns available actions + their params)

### Implementation Steps

1. **Create `EXTERNAL_API_KEY` secret** -- a shared key that external tools use to authenticate. Requested via `add_secret` tool.

2. **Create Edge Function `supabase/functions/api-gateway/index.ts`**:
   - Validates `X-API-Key` header against the stored secret
   - Parses `{ action, ...params }` from request body
   - Routes to handler functions for each action
   - Uses service role client for full DB access
   - Returns consistent `{ success, data, error }` responses
   - Comprehensive error handling with descriptive messages

3. **Update `supabase/config.toml`** to add:
   ```toml
   [functions.api-gateway]
   verify_jwt = false
   ```

4. **Update `src/lib/webhooks.ts`** to also export the gateway URL for reference, and add any new outbound webhook events.

5. **Create documentation page `src/pages/ApiDocs.tsx`** (admin-only) showing:
   - Gateway URL
   - All available actions with example payloads
   - Authentication instructions
   - Copy-paste examples for n8n HTTP nodes

6. **Add route** in `App.tsx` for `/api-docs` (admin only).

### Security
- Authentication via `X-API-Key` header checked against a stored secret
- Service role used only inside the edge function (never exposed)
- Rate limiting awareness via descriptive error responses
- Input validation on all actions (required fields checked)

### Technical Details

The edge function will be ~400-500 lines, organized as a router pattern:

```typescript
const handlers: Record<string, (client, params) => Promise<Response>> = {
  health: async () => json({ status: "ok", version: "1.0" }),
  list_clients: async (db) => { ... },
  create_task: async (db, { project_id, title, ... }) => { ... },
  // ... all actions
};
```

Each handler validates required params, executes the query, and returns structured responses. The documentation page will be a clean reference for integration setup.

