-- Read-only, fail-closed production attestation for the normalized Lovable
-- baseline. It validates two absorbed migrations and five ledger markers; it
-- never repairs schema objects or writes migration history.

WITH
ledger_markers(marker) AS (
  VALUES
    ('email_infra'),
    ('restore_files_column_permissions'),
    ('create_editorial_calendar'),
    ('add_task_delivery_type'),
    ('meta_oauth_foundation')
),
workstream_domain(value) AS (
  VALUES
    ('general'), ('design'), ('content'), ('video'),
    ('traffic'), ('development'), ('operations')
),
delivery_type_domain(value) AS (
  VALUES
    ('unspecified'), ('design'), ('branding'), ('static'), ('carousel'),
    ('reel'), ('story'), ('video'), ('short'), ('article'),
    ('google_post'), ('planning'), ('copywriting'), ('website'),
    ('landing_page'), ('automation'), ('traffic'), ('seo'), ('document'),
    ('report'), ('other')
),
expected_file_column_privileges(privilege_type, column_name) AS (
  VALUES
    ('SELECT', 'id'),
    ('SELECT', 'client_id'),
    ('SELECT', 'project_id'),
    ('SELECT', 'uploaded_by'),
    ('SELECT', 'file_name'),
    ('SELECT', 'file_url'),
    ('SELECT', 'file_type'),
    ('SELECT', 'folder'),
    ('SELECT', 'description'),
    ('SELECT', 'caption'),
    ('SELECT', 'carousel_text'),
    ('SELECT', 'approval_status'),
    ('SELECT', 'feedback'),
    ('SELECT', 'client_decided_by'),
    ('SELECT', 'client_decided_at'),
    ('SELECT', 'approval_requested_at'),
    ('SELECT', 'visibility'),
    ('SELECT', 'requires_approval'),
    ('SELECT', 'status'),
    ('SELECT', 'archived_at'),
    ('SELECT', 'created_at'),
    ('SELECT', 'updated_at'),
    ('SELECT', 'parent_file_id'),
    ('SELECT', 'revision_of_file_id'),
    ('SELECT', 'locked_at'),
    ('SELECT', 'version'),
    ('SELECT', 'storage_bucket'),
    ('SELECT', 'storage_path'),
    ('SELECT', 'mime_type'),
    ('SELECT', 'extension'),
    ('SELECT', 'size_bytes'),
    ('SELECT', 'page_count'),
    ('SELECT', 'sheet_count'),
    ('SELECT', 'slide_count'),
    ('UPDATE', 'file_name'),
    ('UPDATE', 'file_type'),
    ('UPDATE', 'folder'),
    ('UPDATE', 'project_id'),
    ('UPDATE', 'description'),
    ('UPDATE', 'caption'),
    ('UPDATE', 'carousel_text'),
    ('UPDATE', 'tags'),
    ('UPDATE', 'sensitivity'),
    ('UPDATE', 'status'),
    ('UPDATE', 'archived_at'),
    ('UPDATE', 'updated_at')
),
actual_file_column_privileges AS (
  SELECT DISTINCT privilege_type, column_name
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'files'
    AND grantee = 'authenticated'
    AND privilege_type IN ('SELECT', 'UPDATE')
),
expected_rls_tables(marker, relation_name) AS (
  VALUES
    ('email_infra', 'public.email_send_log'),
    ('email_infra', 'public.email_send_state'),
    ('email_infra', 'public.suppressed_emails'),
    ('email_infra', 'public.email_unsubscribe_tokens'),
    ('create_editorial_calendar', 'public.editorial_posts'),
    ('create_editorial_calendar', 'public.editorial_post_internal'),
    ('create_editorial_calendar', 'public.editorial_publications'),
    ('create_editorial_calendar', 'public.editorial_publication_internal'),
    ('create_editorial_calendar', 'public.editorial_events'),
    ('meta_oauth_foundation', 'public.external_account_connections'),
    ('meta_oauth_foundation', 'social_private.oauth_sessions'),
    ('meta_oauth_foundation', 'social_private.oauth_grants'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates'),
    ('meta_oauth_foundation', 'social_private.external_account_grants'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_delivery_requests')
),
expected_constraints(marker, relation_name, constraint_name, definition_fragment) AS (
  VALUES
    ('email_infra', 'public.email_send_log', 'email_send_log_status_check', 'status'),
    ('email_infra', 'public.email_send_state', 'email_send_state_id_check', 'id'),
    ('email_infra', 'public.suppressed_emails', 'suppressed_emails_reason_check', 'reason'),
    ('email_infra', 'public.suppressed_emails', 'suppressed_emails_email_key', 'email'),
    ('email_infra', 'public.email_unsubscribe_tokens', 'email_unsubscribe_tokens_token_key', 'token'),
    ('email_infra', 'public.email_unsubscribe_tokens', 'email_unsubscribe_tokens_email_key', 'email'),

    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_project_fk', 'project_id'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_scope_key', 'client_id'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_id_client_key', 'client_id'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_title_nonempty', 'title'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_content_type_check', 'content_type'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_production_status_check', 'production_status'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_version_positive', 'version'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_archive_state_check', 'archived_at'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_post_fk', 'post_id'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_idempotency_key', 'idempotency_key'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_fingerprint_check', 'request_fingerprint'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_last_mutation_pair_check', 'last_mutation_id'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_last_mutation_fingerprint_check', 'last_mutation_fingerprint'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_approval_fingerprint_check', 'approval_fingerprint'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_revision_not_self', 'revision_of_post_id'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_post_fk', 'post_id'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_account_fk', 'external_account_id'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_id_client_key', 'client_id'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_post_account_key', 'external_account_id'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_platform_check', 'platform'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_status_check', 'status'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_version_positive', 'version'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_scheduled_fields_check', 'scheduled_at'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_published_fields_check', 'published_at'),
    ('create_editorial_calendar', 'public.editorial_publication_internal', 'editorial_publication_internal_publication_fk', 'publication_id'),
    ('create_editorial_calendar', 'public.editorial_publication_internal', 'editorial_publication_internal_idempotency_key', 'idempotency_key'),
    ('create_editorial_calendar', 'public.editorial_publication_internal', 'editorial_publication_internal_fingerprint_check', 'request_fingerprint'),
    ('create_editorial_calendar', 'public.editorial_publication_internal', 'editorial_publication_internal_attempts_nonnegative', 'attempt_count'),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_type_nonempty', 'event_type'),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_metadata_object', 'metadata'),

    ('meta_oauth_foundation', 'public.external_account_connections', 'external_account_connections_account_fk', 'external_account_id'),
    ('meta_oauth_foundation', 'public.external_account_connections', 'external_account_connections_provider_check', 'provider'),
    ('meta_oauth_foundation', 'public.external_account_connections', 'external_account_connections_status_check', 'connection_status'),
    ('meta_oauth_foundation', 'public.external_account_connections', 'external_account_connections_automation_check', 'automation_enabled'),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_project_fk', 'project_id'),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_provider_check', 'provider'),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_state_hash_check', 'state_hash'),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_status_check', 'status'),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_expiry_check', 'expires_at'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_provider_check', 'provider'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_subject_nonempty', 'provider_subject'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_graph_version_check', 'graph_version'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_status_check', 'status'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_generation_positive', 'generation'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_generation_key', 'generation'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_project_fk', 'project_id'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_platform_check', 'platform'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_resource_type_check', 'resource_type'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_provider_id_nonempty', 'provider_resource_id'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_display_name_nonempty', 'display_name'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_metadata_object', 'metadata'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_session_resource_key', 'oauth_session_id'),
    ('meta_oauth_foundation', 'social_private.external_account_grants', 'social_external_account_grants_account_fk', 'external_account_id'),
    ('meta_oauth_foundation', 'social_private.external_account_grants', 'social_external_account_grants_provider_check', 'provider'),
    ('meta_oauth_foundation', 'social_private.external_account_grants', 'social_external_account_grants_platform_check', 'platform'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_publication_fk', 'publication_id'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_position_check', 'position'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_sha_check', 'sha256'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_size_check', 'size_bytes'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_position_key', 'position'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_file_key', 'file_id'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_delivery_requests', 'social_editorial_delivery_request_publication_fk', 'publication_id'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_delivery_requests', 'social_editorial_delivery_request_fingerprint_check', 'request_fingerprint'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_delivery_requests', 'social_editorial_delivery_request_mode_check', 'delivery_mode'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_delivery_requests', 'social_editorial_delivery_request_asset_count_check', 'asset_count')
),
expected_indexes(marker, relation_name, index_name, is_unique, definition_fragment, predicate_fragment) AS (
  VALUES
    ('email_infra', 'public.email_send_log', 'idx_email_send_log_created', false, 'created_at desc', NULL),
    ('email_infra', 'public.email_send_log', 'idx_email_send_log_recipient', false, 'recipient_email', NULL),
    ('email_infra', 'public.email_send_log', 'idx_email_send_log_message', false, 'message_id', NULL),
    ('email_infra', 'public.email_send_log', 'idx_email_send_log_message_sent_unique', true, 'message_id', 'status'),
    ('email_infra', 'public.suppressed_emails', 'idx_suppressed_emails_email', false, 'email', NULL),
    ('email_infra', 'public.email_unsubscribe_tokens', 'idx_unsubscribe_tokens_token', false, 'token', NULL),

    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_revision_idx', false, 'revision_of_post_id', 'revision_of_post_id'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_client_status_created_idx', false, 'client_id', NULL),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_project_status_idx', false, 'project_id', NULL),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_primary_file_unique_idx', true, 'primary_file_id', 'primary_file_id'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_task_idx', false, 'task_id', NULL),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_responsible_idx', false, 'responsible_id', NULL),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publication_external_post_idx', true, 'external_post_id', 'external_post_id'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_post_idx', false, 'post_id', NULL),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_client_calendar_idx', false, 'client_id', NULL),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_project_calendar_idx', false, 'project_id', NULL),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_account_calendar_idx', false, 'external_account_id', NULL),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_scheduled_queue_idx', false, 'scheduled_at', 'status'),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_client_created_idx', false, 'client_id', NULL),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_post_created_idx', false, 'post_id', NULL),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_publication_created_idx', false, 'publication_id', NULL),

    ('meta_oauth_foundation', 'public.external_account_connections', 'external_account_connections_client_idx', false, 'client_id', NULL),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_actor_idx', false, 'actor_id', NULL),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_scope_idx', false, 'client_id', NULL),
    ('meta_oauth_foundation', 'social_private.oauth_sessions', 'social_oauth_sessions_cleanup_idx', false, 'expires_at', 'cleaned_at'),
    ('meta_oauth_foundation', 'social_private.oauth_grants', 'social_oauth_grants_active_idx', false, 'provider_subject', 'status'),
    ('meta_oauth_foundation', 'social_private.oauth_resource_candidates', 'social_resource_candidates_session_idx', false, 'oauth_session_id', NULL),
    ('meta_oauth_foundation', 'social_private.external_account_grants', 'social_external_account_grants_resource_idx', true, 'provider_resource_id', 'revoked_at'),
    ('meta_oauth_foundation', 'social_private.editorial_publication_assets', 'social_editorial_publication_assets_file_idx', false, 'file_id', NULL)
),
expected_policies(marker, relation_name, policy_name, command) AS (
  VALUES
    ('email_infra', 'public.email_send_log', 'Service role can read send log', 'SELECT'),
    ('email_infra', 'public.email_send_log', 'Service role can insert send log', 'INSERT'),
    ('email_infra', 'public.email_send_log', 'Service role can update send log', 'UPDATE'),
    ('email_infra', 'public.email_send_state', 'Service role can manage send state', 'ALL'),
    ('email_infra', 'public.suppressed_emails', 'Service role can read suppressed emails', 'SELECT'),
    ('email_infra', 'public.suppressed_emails', 'Service role can insert suppressed emails', 'INSERT'),
    ('email_infra', 'public.email_unsubscribe_tokens', 'Service role can read tokens', 'SELECT'),
    ('email_infra', 'public.email_unsubscribe_tokens', 'Service role can insert tokens', 'INSERT'),
    ('email_infra', 'public.email_unsubscribe_tokens', 'Service role can mark tokens as used', 'UPDATE'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_staff_select', 'SELECT'),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_client_select', 'SELECT'),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_staff_select', 'SELECT'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_staff_select', 'SELECT'),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_client_select', 'SELECT'),
    ('create_editorial_calendar', 'public.editorial_publication_internal', 'editorial_publication_internal_staff_select', 'SELECT'),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_staff_select', 'SELECT'),
    ('meta_oauth_foundation', 'public.external_account_connections', 'external_account_connections_select', 'SELECT')
),
expected_functions(marker, signature, security_definer, search_path_setting, anon_execute, authenticated_execute, service_execute) AS (
  VALUES
    ('email_infra', 'public.enqueue_email(text,jsonb)', true, 'search_path=public, pgmq', false, false, true),
    ('email_infra', 'public.read_email_batch(text,integer,integer)', true, 'search_path=public, pgmq', false, false, true),
    ('email_infra', 'public.delete_email(text,bigint)', true, 'search_path=public, pgmq', false, false, true),
    ('email_infra', 'public.move_to_dlq(text,text,bigint,jsonb)', true, 'search_path=public, pgmq', false, false, true),

    ('create_editorial_calendar', 'public.editorial_compute_approval_fingerprint(uuid)', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_staff_can_access_client(uuid)', true, 'search_path=""', false, true, true),
    ('create_editorial_calendar', 'public.editorial_can_publish_client(uuid)', true, 'search_path=""', false, true, true),
    ('create_editorial_calendar', 'public.editorial_client_can_read_post(uuid)', true, 'search_path=""', false, true, true),
    ('create_editorial_calendar', 'public.editorial_file_is_publishable(uuid,uuid,uuid)', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_client_can_read_publication(uuid)', true, 'search_path=""', false, true, true),
    ('create_editorial_calendar', 'public.get_editorial_approval_preview(uuid)', true, 'search_path=""', false, true, false),
    ('create_editorial_calendar', 'public.editorial_events_immutable()', false, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_events_scope_guard()', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_record_file_decision()', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_posts_guard()', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_post_internal_guard()', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_publications_guard()', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.editorial_publication_internal_guard()', true, 'search_path=""', false, false, false),
    ('create_editorial_calendar', 'public.save_editorial_post(jsonb,integer)', true, 'search_path=""', false, true, false),
    ('create_editorial_calendar', 'public.transition_editorial_publication(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)', true, 'search_path=""', false, true, false),
    ('create_editorial_calendar', 'public.archive_editorial_post(uuid,integer)', true, 'search_path=""', false, true, false),

    ('absorbed_task_sync', 'public.editorial_current_post_id_for_task(uuid)', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_production_status_for_task(text)', false, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_task_status_for_post(uuid)', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_sync_task_for_post(uuid)', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_sync_task_from_post_trigger()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_sync_task_from_link_trigger()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_sync_task_from_publication_trigger()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_task_link_guard()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_prevent_premature_task_completion()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_sync_post_from_task_trigger()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_lock_task_sync()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.editorial_lock_task_sync_trigger()', true, 'search_path=""', false, false, false),
    ('add_task_delivery_type', 'public.editorial_delivery_type_is_publishable(text)', false, 'search_path=""', false, false, false),
    ('add_task_delivery_type', 'public.editorial_content_type_for_delivery_type(text)', false, 'search_path=""', false, false, false),
    ('add_task_delivery_type', 'public.editorial_delivery_type_for_content_type(text)', false, 'search_path=""', false, false, false),
    ('add_task_delivery_type', 'public.editorial_reconcile_task_delivery_types()', true, 'search_path=""', false, false, false),
    ('add_task_delivery_type', 'public.editorial_task_delivery_type_guard()', true, 'search_path=""', false, false, false),
    ('add_task_delivery_type', 'public.editorial_post_delivery_type_guard()', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.save_editorial_post_unlocked(jsonb,integer)', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)', true, 'search_path=""', false, false, false),
    ('absorbed_task_sync', 'public.archive_editorial_post_unlocked(uuid,integer)', true, 'search_path=""', false, false, false),

    ('meta_oauth_foundation', 'social_private.lock_meta_oauth_lifecycle()', true, 'search_path=""', false, false, false),
    ('meta_oauth_foundation', 'social_private.revoke_meta_secret(uuid,text)', true, 'search_path=""', false, false, false),
    ('meta_oauth_foundation', 'social_private.cleanup_meta_grant(uuid,text,text)', true, 'search_path=""', false, false, false),
    ('meta_oauth_foundation', 'social_private.cleanup_meta_oauth_session(uuid,text)', true, 'search_path=""', false, false, false),
    ('meta_oauth_foundation', 'social_private.cleanup_expired_meta_oauth()', true, 'search_path=""', false, false, false),
    ('meta_oauth_foundation', 'public.social_meta_oauth_create_session(uuid,uuid,text)', true, 'search_path=""', false, true, false),
    ('meta_oauth_foundation', 'public.social_meta_oauth_consume_session(text)', true, 'search_path=""', false, true, false),
    ('meta_oauth_foundation', 'public.social_meta_oauth_store_resources(uuid,uuid,text,text,timestamptz,timestamptz,text[],text[],jsonb,text)', true, 'search_path=""', false, false, true),
    ('meta_oauth_foundation', 'public.social_meta_oauth_finish_session(uuid,uuid,uuid)', true, 'search_path=""', false, true, false),
    ('meta_oauth_foundation', 'public.social_meta_connect_resource(uuid,uuid,uuid,uuid)', true, 'search_path=""', false, true, false),
    ('meta_oauth_foundation', 'public.social_meta_disconnect_account(uuid)', true, 'search_path=""', false, true, false)
),
expected_triggers(marker, relation_name, trigger_name, function_signature, trigger_type) AS (
  VALUES
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_no_update_delete', 'public.editorial_events_immutable()', 27),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_no_truncate', 'public.editorial_events_immutable()', 34),
    ('create_editorial_calendar', 'public.editorial_events', 'editorial_events_scope_guard_trg', 'public.editorial_events_scope_guard()', 7),
    ('create_editorial_calendar', 'public.file_approval_events', 'file_approval_events_editorial_snapshot_trg', 'public.editorial_record_file_decision()', 5),
    ('create_editorial_calendar', 'public.editorial_posts', 'editorial_posts_guard_trg', 'public.editorial_posts_guard()', 31),
    ('create_editorial_calendar', 'public.editorial_post_internal', 'editorial_post_internal_guard_trg', 'public.editorial_post_internal_guard()', 31),
    ('create_editorial_calendar', 'public.editorial_publications', 'editorial_publications_guard_trg', 'public.editorial_publications_guard()', 31),
    ('create_editorial_calendar', 'public.editorial_publication_internal', 'editorial_publication_internal_guard_trg', 'public.editorial_publication_internal_guard()', 31),
    ('absorbed_task_sync', 'public.editorial_posts', 'editorial_posts_sync_task_trg', 'public.editorial_sync_task_from_post_trigger()', 17),
    ('absorbed_task_sync', 'public.editorial_post_internal', 'editorial_post_internal_task_link_guard_trg', 'public.editorial_task_link_guard()', 23),
    ('absorbed_task_sync', 'public.editorial_post_internal', 'editorial_post_internal_sync_task_trg', 'public.editorial_sync_task_from_link_trigger()', 21),
    ('absorbed_task_sync', 'public.editorial_publications', 'editorial_publications_sync_task_trg', 'public.editorial_sync_task_from_publication_trigger()', 21),
    ('absorbed_task_sync', 'public.tasks', 'tasks_editorial_completion_guard_trg', 'public.editorial_prevent_premature_task_completion()', 19),
    ('absorbed_task_sync', 'public.tasks', 'tasks_sync_editorial_post_trg', 'public.editorial_sync_post_from_task_trigger()', 17),
    ('absorbed_task_sync', 'public.editorial_posts', 'editorial_posts_sync_lock_insert_trg', 'public.editorial_lock_task_sync_trigger()', 6),
    ('absorbed_task_sync', 'public.editorial_posts', 'editorial_posts_sync_lock_update_trg', 'public.editorial_lock_task_sync_trigger()', 18),
    ('absorbed_task_sync', 'public.editorial_post_internal', 'editorial_post_internal_sync_lock_insert_trg', 'public.editorial_lock_task_sync_trigger()', 6),
    ('absorbed_task_sync', 'public.editorial_post_internal', 'editorial_post_internal_sync_lock_update_trg', 'public.editorial_lock_task_sync_trigger()', 18),
    ('absorbed_task_sync', 'public.editorial_publications', 'editorial_publications_sync_lock_insert_trg', 'public.editorial_lock_task_sync_trigger()', 6),
    ('absorbed_task_sync', 'public.editorial_publications', 'editorial_publications_sync_lock_update_trg', 'public.editorial_lock_task_sync_trigger()', 18),
    ('add_task_delivery_type', 'public.tasks', 'tasks_editorial_sync_lock_update_trg', 'public.editorial_lock_task_sync_trigger()', 18),
    ('add_task_delivery_type', 'public.tasks', 'tasks_editorial_delivery_type_guard_trg', 'public.editorial_task_delivery_type_guard()', 19),
    ('add_task_delivery_type', 'public.editorial_posts', 'editorial_post_delivery_type_guard_trg', 'public.editorial_post_delivery_type_guard()', 17)
),
rls_status AS (
  SELECT expected.marker,
    count(*) = count(relation.oid)
      AND COALESCE(bool_and(relation.relrowsecurity), false) AS ready
  FROM expected_rls_tables AS expected
  LEFT JOIN pg_class AS relation
    ON relation.oid = to_regclass(expected.relation_name)
  GROUP BY expected.marker
),
constraint_status AS (
  SELECT expected.marker,
    count(*) = count(constraint_row.oid)
      AND COALESCE(bool_and(
        constraint_row.convalidated
        AND position(
          expected.definition_fragment
          IN lower(pg_get_constraintdef(constraint_row.oid, true))
        ) > 0
      ), false) AS ready
  FROM expected_constraints AS expected
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conrelid = to_regclass(expected.relation_name)
   AND constraint_row.conname = expected.constraint_name
  GROUP BY expected.marker
),
index_status AS (
  SELECT expected.marker,
    count(*) = count(index_row.indexrelid)
      AND COALESCE(bool_and(
        index_row.indisvalid
        AND index_row.indisready
        AND index_row.indisunique = expected.is_unique
        AND position(
          expected.definition_fragment
          IN lower(pg_get_indexdef(index_row.indexrelid))
        ) > 0
        AND (
          expected.predicate_fragment IS NULL
          OR position(
            expected.predicate_fragment
            IN lower(pg_get_indexdef(index_row.indexrelid))
          ) > 0
        )
      ), false) AS ready
  FROM expected_indexes AS expected
  LEFT JOIN pg_class AS index_relation
    ON index_relation.relname = expected.index_name
   AND index_relation.relnamespace = (
     SELECT relation.relnamespace
     FROM pg_class AS relation
     WHERE relation.oid = to_regclass(expected.relation_name)
   )
  LEFT JOIN pg_index AS index_row
    ON index_row.indexrelid = index_relation.oid
   AND index_row.indrelid = to_regclass(expected.relation_name)
  GROUP BY expected.marker
),
policy_status AS (
  SELECT expected.marker,
    count(*) = count(policy_row.policyname)
      AND COALESCE(bool_and(policy_row.cmd = expected.command), false) AS ready
  FROM expected_policies AS expected
  LEFT JOIN pg_policies AS policy_row
    ON format('%I.%I', policy_row.schemaname, policy_row.tablename) =
       expected.relation_name
   AND policy_row.policyname = expected.policy_name
  GROUP BY expected.marker
),
function_status AS (
  SELECT expected.marker,
    count(*) = count(procedure_row.oid)
      AND COALESCE(bool_and(
        procedure_row.prosecdef = expected.security_definer
        AND procedure_row.proconfig @> ARRAY[expected.search_path_setting]::text[]
        AND has_function_privilege('anon', procedure_row.oid, 'EXECUTE') =
            expected.anon_execute
        AND has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE') =
            expected.authenticated_execute
        AND has_function_privilege('service_role', procedure_row.oid, 'EXECUTE') =
            expected.service_execute
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              procedure_row.proacl,
              acldefault('f', procedure_row.proowner)
            )
          ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
      ), false) AS ready
  FROM expected_functions AS expected
  LEFT JOIN pg_proc AS procedure_row
    ON procedure_row.oid = to_regprocedure(expected.signature)
  GROUP BY expected.marker
),
trigger_status AS (
  SELECT expected.marker,
    count(*) = count(trigger_row.oid)
      AND COALESCE(bool_and(
        trigger_row.tgenabled = 'O'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgfoid = to_regprocedure(expected.function_signature)
        AND trigger_row.tgtype::integer = expected.trigger_type
      ), false) AS ready
  FROM expected_triggers AS expected
  LEFT JOIN pg_trigger AS trigger_row
    ON trigger_row.tgrelid = to_regclass(expected.relation_name)
   AND trigger_row.tgname = expected.trigger_name
  GROUP BY expected.marker
),
workstream_check AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tasks'
        AND column_name = 'workstream'
        AND data_type = 'text'
        AND is_nullable = 'NO'
        AND column_default = '''general''::text'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.tasks')
        AND constraint_row.conname = 'tasks_workstream_check'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND NOT EXISTS (
          SELECT 1
          FROM workstream_domain AS allowed
          WHERE position(
            quote_literal(allowed.value)
            IN lower(pg_get_constraintdef(constraint_row.oid, true))
          ) = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM regexp_matches(
            lower(pg_get_constraintdef(constraint_row.oid, true)),
            '''([^'']+)''::text',
            'g'
          ) AS captured(value)
          WHERE captured.value[1] NOT IN (
            SELECT allowed.value FROM workstream_domain AS allowed
          )
        )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_class AS index_relation
      JOIN pg_index AS index_row
        ON index_row.indexrelid = index_relation.oid
      WHERE index_relation.oid = to_regclass('public.tasks_workstream_status_idx')
        AND index_row.indrelid = to_regclass('public.tasks')
        AND index_row.indisvalid
        AND index_row.indisready
        AND lower(pg_get_indexdef(index_relation.oid)) LIKE
            '%using btree (workstream, status)%'
        AND lower(pg_get_indexdef(index_relation.oid)) LIKE
            '%where (deleted_at is null)%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.tasks
      WHERE workstream IS NULL
         OR workstream NOT IN (
           'general', 'design', 'content', 'video',
           'traffic', 'development', 'operations'
         )
    ) AS ready
),
delivery_type_check AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tasks'
        AND column_name = 'delivery_type'
        AND data_type = 'text'
        AND is_nullable = 'NO'
        AND column_default = '''unspecified''::text'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.tasks')
        AND constraint_row.conname = 'tasks_delivery_type_check'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND NOT EXISTS (
          SELECT 1
          FROM delivery_type_domain AS allowed
          WHERE position(
            quote_literal(allowed.value)
            IN lower(pg_get_constraintdef(constraint_row.oid, true))
          ) = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM regexp_matches(
            lower(pg_get_constraintdef(constraint_row.oid, true)),
            '''([^'']+)''::text',
            'g'
          ) AS captured(value)
          WHERE captured.value[1] NOT IN (
            SELECT allowed.value FROM delivery_type_domain AS allowed
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.tasks
      WHERE delivery_type IS NULL
         OR delivery_type NOT IN (
           'unspecified', 'design', 'branding', 'static', 'carousel',
           'reel', 'story', 'video', 'short', 'article', 'google_post',
           'planning', 'copywriting', 'website', 'landing_page',
           'automation', 'traffic', 'seo', 'document', 'report', 'other'
         )
    ) AS ready
),
files_check AS (
  SELECT
    to_regclass('public.files') IS NOT NULL
    AND NOT has_table_privilege('authenticated', 'public.files', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.files', 'UPDATE')
    AND NOT EXISTS (
      SELECT privilege_type, column_name
      FROM expected_file_column_privileges
      EXCEPT
      SELECT privilege_type, column_name
      FROM actual_file_column_privileges
    )
    AND NOT EXISTS (
      SELECT privilege_type, column_name
      FROM actual_file_column_privileges
      EXCEPT
      SELECT privilege_type, column_name
      FROM expected_file_column_privileges
    ) AS ready
),
editorial_grants_check AS (
  SELECT COALESCE(bool_and(
    has_table_privilege('authenticated', relation.oid, 'SELECT')
    AND NOT has_table_privilege('authenticated', relation.oid, 'INSERT')
    AND NOT has_table_privilege('authenticated', relation.oid, 'UPDATE')
    AND NOT has_table_privilege('authenticated', relation.oid, 'DELETE')
    AND has_table_privilege('service_role', relation.oid, 'SELECT')
    AND NOT has_table_privilege('service_role', relation.oid, 'INSERT')
    AND NOT has_table_privilege('service_role', relation.oid, 'UPDATE')
    AND NOT has_table_privilege('service_role', relation.oid, 'DELETE')
    AND NOT has_table_privilege('anon', relation.oid, 'SELECT')
    AND NOT EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl
      WHERE acl.grantee = 0
    )
  ), false) AS ready
  FROM expected_rls_tables AS expected
  JOIN pg_class AS relation
    ON relation.oid = to_regclass(expected.relation_name)
  WHERE expected.marker = 'create_editorial_calendar'
),
meta_security_check AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_namespace AS namespace_row
      WHERE namespace_row.nspname = 'social_private'
        AND NOT has_schema_privilege('anon', namespace_row.oid, 'USAGE')
        AND NOT has_schema_privilege('authenticated', namespace_row.oid, 'USAGE')
        AND NOT has_schema_privilege('service_role', namespace_row.oid, 'USAGE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(namespace_row.nspacl, acldefault('n', namespace_row.nspowner))
          ) AS acl
          WHERE acl.grantee = 0
        )
    )
    AND (
      SELECT count(*) = 6
        AND COALESCE(bool_and(
          NOT has_table_privilege('anon', relation.oid, 'SELECT')
          AND NOT has_table_privilege('authenticated', relation.oid, 'SELECT')
          AND NOT has_table_privilege('service_role', relation.oid, 'SELECT')
          AND NOT has_table_privilege('anon', relation.oid, 'INSERT')
          AND NOT has_table_privilege('authenticated', relation.oid, 'INSERT')
          AND NOT has_table_privilege('service_role', relation.oid, 'INSERT')
          AND NOT has_table_privilege('anon', relation.oid, 'UPDATE')
          AND NOT has_table_privilege('authenticated', relation.oid, 'UPDATE')
          AND NOT has_table_privilege('service_role', relation.oid, 'UPDATE')
          AND NOT has_table_privilege('anon', relation.oid, 'DELETE')
          AND NOT has_table_privilege('authenticated', relation.oid, 'DELETE')
          AND NOT has_table_privilege('service_role', relation.oid, 'DELETE')
          AND NOT EXISTS (
            SELECT 1
            FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl
            WHERE acl.grantee = 0
          )
        ), false)
      FROM expected_rls_tables AS expected
      JOIN pg_class AS relation
        ON relation.oid = to_regclass(expected.relation_name)
      WHERE expected.marker = 'meta_oauth_foundation'
        AND expected.relation_name LIKE 'social_private.%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_class AS relation
      WHERE relation.oid = to_regclass('public.external_account_connections')
        AND has_table_privilege('authenticated', relation.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', relation.oid, 'INSERT')
        AND NOT has_table_privilege('authenticated', relation.oid, 'UPDATE')
        AND NOT has_table_privilege('authenticated', relation.oid, 'DELETE')
        AND NOT has_table_privilege('anon', relation.oid, 'SELECT')
        AND NOT has_table_privilege('service_role', relation.oid, 'SELECT')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) AS acl
          WHERE acl.grantee = 0
        )
    ) AS ready
),
email_state_check AS (
  SELECT
    has_table_privilege('service_role', 'public.email_send_log', 'SELECT')
    AND has_table_privilege('service_role', 'public.email_send_log', 'INSERT')
    AND has_table_privilege('service_role', 'public.email_send_log', 'UPDATE')
    AND has_table_privilege('service_role', 'public.email_send_state', 'SELECT')
    AND has_table_privilege('service_role', 'public.email_send_state', 'UPDATE')
    AND has_table_privilege('service_role', 'public.suppressed_emails', 'SELECT')
    AND has_table_privilege('service_role', 'public.suppressed_emails', 'INSERT')
    AND has_table_privilege('service_role', 'public.email_unsubscribe_tokens', 'SELECT')
    AND has_table_privilege('service_role', 'public.email_unsubscribe_tokens', 'UPDATE')
    AND NOT EXISTS (
      SELECT expected.column_name
      FROM (
        VALUES
          ('batch_size', '10'),
          ('send_delay_ms', '200'),
          ('auth_email_ttl_minutes', '15'),
          ('transactional_email_ttl_minutes', '60')
      ) AS expected(column_name, column_default)
      LEFT JOIN information_schema.columns AS column_row
        ON column_row.table_schema = 'public'
       AND column_row.table_name = 'email_send_state'
       AND column_row.column_name = expected.column_name
       AND column_row.is_nullable = 'NO'
       AND position(expected.column_default IN column_row.column_default) > 0
      WHERE column_row.column_name IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.email_send_state
      WHERE id = 1
    ) AS ready
),
revision_data_check AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.editorial_post_internal AS child
      LEFT JOIN public.editorial_post_internal AS parent
        ON parent.post_id = child.revision_of_post_id
      WHERE child.revision_of_post_id IS NOT NULL
        AND parent.post_id IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.editorial_post_internal AS child
      JOIN public.editorial_post_internal AS parent
        ON parent.post_id = child.revision_of_post_id
      WHERE child.revision_of_post_id IS NOT NULL
        AND child.task_id IS DISTINCT FROM parent.task_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        SELECT internal.task_id
        FROM public.editorial_post_internal AS internal
        JOIN public.editorial_posts AS post
          ON post.id = internal.post_id
        WHERE internal.task_id IS NOT NULL
          AND post.archived_at IS NULL
          AND post.production_status IN ('draft', 'production', 'ready')
          AND NOT EXISTS (
            SELECT 1
            FROM public.editorial_post_internal AS child_internal
            WHERE child_internal.revision_of_post_id = post.id
              AND child_internal.task_id = internal.task_id
          )
        GROUP BY internal.task_id
        HAVING count(*) > 1
      ) AS ambiguous_active_chains
    ) AS ready
),
readiness AS (
  SELECT
    (SELECT count(*) = 5 FROM ledger_markers) AS markers_ready,
    (SELECT ready FROM workstream_check) AS workstream_ready,
    (SELECT ready FROM delivery_type_check) AS delivery_type_ready,
    (SELECT ready FROM files_check) AS files_ready,
    (SELECT ready FROM editorial_grants_check) AS editorial_grants_ready,
    (SELECT ready FROM meta_security_check) AS meta_security_ready,
    (SELECT ready FROM email_state_check) AS email_state_ready,
    (SELECT ready FROM revision_data_check) AS revision_data_ready,
    COALESCE((SELECT ready FROM rls_status WHERE marker = 'email_infra'), false) AS email_rls_ready,
    COALESCE((SELECT ready FROM constraint_status WHERE marker = 'email_infra'), false) AS email_constraints_ready,
    COALESCE((SELECT ready FROM index_status WHERE marker = 'email_infra'), false) AS email_indexes_ready,
    COALESCE((SELECT ready FROM policy_status WHERE marker = 'email_infra'), false) AS email_policies_ready,
    COALESCE((SELECT ready FROM function_status WHERE marker = 'email_infra'), false) AS email_functions_ready,
    COALESCE((SELECT ready FROM rls_status WHERE marker = 'create_editorial_calendar'), false) AS editorial_rls_ready,
    COALESCE((SELECT ready FROM constraint_status WHERE marker = 'create_editorial_calendar'), false) AS editorial_constraints_ready,
    COALESCE((SELECT ready FROM index_status WHERE marker = 'create_editorial_calendar'), false) AS editorial_indexes_ready,
    COALESCE((SELECT ready FROM policy_status WHERE marker = 'create_editorial_calendar'), false) AS editorial_policies_ready,
    COALESCE((SELECT ready FROM function_status WHERE marker = 'create_editorial_calendar'), false) AS editorial_functions_ready,
    COALESCE((SELECT ready FROM rls_status WHERE marker = 'meta_oauth_foundation'), false) AS meta_rls_ready,
    COALESCE((SELECT ready FROM constraint_status WHERE marker = 'meta_oauth_foundation'), false) AS meta_constraints_ready,
    COALESCE((SELECT ready FROM index_status WHERE marker = 'meta_oauth_foundation'), false) AS meta_indexes_ready,
    COALESCE((SELECT ready FROM policy_status WHERE marker = 'meta_oauth_foundation'), false) AS meta_policies_ready,
    COALESCE((SELECT ready FROM function_status WHERE marker = 'meta_oauth_foundation'), false) AS meta_functions_ready,
    COALESCE((SELECT ready FROM function_status WHERE marker = 'absorbed_task_sync'), false) AS task_sync_functions_ready,
    COALESCE((SELECT ready FROM function_status WHERE marker = 'add_task_delivery_type'), false) AS delivery_functions_ready,
    COALESCE((SELECT ready FROM trigger_status WHERE marker = 'create_editorial_calendar'), false) AS editorial_triggers_ready,
    COALESCE((SELECT ready FROM trigger_status WHERE marker = 'absorbed_task_sync'), false) AS task_sync_triggers_ready,
    COALESCE((SELECT ready FROM trigger_status WHERE marker = 'add_task_delivery_type'), false) AS delivery_triggers_ready
)
SELECT CASE
  WHEN readiness.markers_ready
   AND readiness.workstream_ready
   AND readiness.delivery_type_ready
   AND readiness.files_ready
   AND readiness.editorial_grants_ready
   AND readiness.meta_security_ready
   AND readiness.email_state_ready
   AND readiness.revision_data_ready
   AND readiness.email_rls_ready
   AND readiness.email_constraints_ready
   AND readiness.email_indexes_ready
   AND readiness.email_policies_ready
   AND readiness.email_functions_ready
   AND readiness.editorial_rls_ready
   AND readiness.editorial_constraints_ready
   AND readiness.editorial_indexes_ready
   AND readiness.editorial_policies_ready
   AND readiness.editorial_functions_ready
   AND readiness.meta_rls_ready
   AND readiness.meta_constraints_ready
   AND readiness.meta_indexes_ready
   AND readiness.meta_policies_ready
   AND readiness.meta_functions_ready
   AND readiness.task_sync_functions_ready
   AND readiness.delivery_functions_ready
   AND readiness.editorial_triggers_ready
   AND readiness.task_sync_triggers_ready
   AND readiness.delivery_triggers_ready
  THEN 'PRODUCTION_BASELINE_SCHEMA_READY'
  ELSE 'PRODUCTION_BASELINE_SCHEMA_FAILED'
END AS production_baseline_status
FROM readiness;
