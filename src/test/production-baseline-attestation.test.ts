// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const attestationPath = resolve(
  process.cwd(),
  "supabase/production-baseline-attestation.sql",
);
const attestation = readFileSync(attestationPath, "utf8");

function executableSql(sql: string) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/gs, "''");
}

describe("production baseline attestation", () => {
  it("is one SELECT-only, fail-closed statement with a unique success sentinel", () => {
    const executable = executableSql(attestation).trim();

    expect(executable).toMatch(/^WITH\b/i);
    expect(executable).toMatch(/\bSELECT\s+CASE\b/i);
    expect(executable.endsWith(";")).toBe(true);
    expect(executable.slice(0, -1)).not.toContain(";");
    expect(executable).not.toMatch(
      /\b(?:ALTER|CALL|COMMENT|COPY|CREATE|DELETE|DO|DROP|GRANT|INSERT|MERGE|REFRESH|REINDEX|REVOKE|TRUNCATE|UPDATE|VACUUM)\b/i,
    );
    expect(attestation.match(/PRODUCTION_BASELINE_SCHEMA_READY/g)).toHaveLength(1);
    expect(attestation).toContain("ELSE 'PRODUCTION_BASELINE_SCHEMA_FAILED'");
  });

  it("covers every ledger marker and both absorbed migration contracts", () => {
    for (const marker of [
      "email_infra",
      "restore_files_column_permissions",
      "create_editorial_calendar",
      "add_task_delivery_type",
      "meta_oauth_foundation",
      "absorbed_task_sync",
    ]) {
      expect(attestation).toContain(`'${marker}'`);
    }

    expect(attestation).toContain("tasks_workstream_check");
    expect(attestation).toContain("public.tasks_workstream_status_idx");
    expect(attestation).toContain("public.editorial_current_post_id_for_task(uuid)");
    expect(attestation).toContain("revision_data_check");
  });

  it("uses catalog definitions, final function properties and trigger event bits", () => {
    for (const catalogProbe of [
      "pg_get_constraintdef",
      "pg_get_indexdef",
      "tgtype::integer",
      "prosecdef",
      "proconfig",
      "has_function_privilege",
      "aclexplode",
      "relrowsecurity",
    ]) {
      expect(attestation).toContain(catalogProbe);
    }

    expect(attestation).not.toContain("pg_get_functiondef");
    expect(attestation).toMatch(
      /'editorial_events_no_update_delete',[^\n]+27\)/,
    );
    expect(attestation).toMatch(
      /'tasks_editorial_delivery_type_guard_trg',[^\n]+19\)/,
    );
    expect(attestation).toMatch(
      /'editorial_post_delivery_type_guard_trg',[^\n]+17\)/,
    );
  });

  it("pins the files column grants without table-level SELECT or UPDATE", () => {
    const selectColumns = [
      "id", "client_id", "project_id", "uploaded_by", "file_name",
      "file_url", "file_type", "folder", "description", "caption",
      "carousel_text", "approval_status", "feedback", "client_decided_by",
      "client_decided_at", "approval_requested_at", "visibility",
      "requires_approval", "status", "archived_at", "created_at",
      "updated_at", "parent_file_id", "revision_of_file_id", "locked_at",
      "version", "storage_bucket", "storage_path", "mime_type", "extension",
      "size_bytes", "page_count", "sheet_count", "slide_count",
    ];
    const updateColumns = [
      "file_name", "file_type", "folder", "project_id", "description",
      "caption", "carousel_text", "tags", "sensitivity", "status",
      "archived_at", "updated_at",
    ];

    for (const column of selectColumns) {
      expect(attestation).toContain(`('SELECT', '${column}')`);
    }
    for (const column of updateColumns) {
      expect(attestation).toContain(`('UPDATE', '${column}')`);
    }

    expect(attestation).toContain(
      "NOT has_table_privilege('authenticated', 'public.files', 'SELECT')",
    );
    expect(attestation).toContain(
      "NOT has_table_privilege('authenticated', 'public.files', 'UPDATE')",
    );
    expect(attestation.match(/\bEXCEPT\b/g)).toHaveLength(2);
  });

  it("attests the critical objects of email, calendar, delivery and Meta OAuth", () => {
    for (const objectName of [
      "email_send_log_status_check",
      "idx_email_send_log_message_sent_unique",
      "public.move_to_dlq(text,text,bigint,jsonb)",
      "editorial_posts_primary_file_unique_idx",
      "editorial_events_no_truncate",
      "public.save_editorial_post(jsonb,integer)",
      "tasks_delivery_type_check",
      "public.editorial_reconcile_task_delivery_types()",
      "social_private.oauth_sessions",
      "social_external_account_grants_resource_idx",
      "public.social_meta_oauth_store_resources(uuid,uuid,text,text,timestamptz,timestamptz,text[],text[],jsonb,text)",
    ]) {
      expect(attestation).toContain(objectName);
    }

    expect(attestation).toContain("has_schema_privilege");
    expect(attestation).toContain("count(*) = 6");
  });
});
