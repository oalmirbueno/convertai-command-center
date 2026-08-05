-- ============================================================================
-- Aceleriq OS — Bloco 6 / Analytics, Conversões e UTMs (V1)
--
-- Escopo:
--   * operação analítica manual-first, sem depender de APIs externas;
--   * campanhas e links UTM por cliente/projeto;
--   * definições de conversão + eventos append-only e idempotentes;
--   * métricas observadas no contrato metric_key/value/captured_at;
--   * isolamento por cliente via RLS e FKs compostas.
--
-- Rollback lógico:
--   * campanhas/links/definições são arquivados/desativados;
--   * eventos são arquivados e substituídos, nunca apagados;
--   * nenhuma tabela existente é alterada e não há backfill.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_can_write_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        (
          public.has_role(auth.uid(), 'manager'::public.app_role)
          OR public.has_role(auth.uid(), 'traffic'::public.app_role)
        )
        AND EXISTS (
          SELECT 1
          FROM public.team_client_assignments AS assignment
          WHERE assignment.user_id = auth.uid()
            AND assignment.client_id = _client_id
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION public.analytics_can_write_client(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_can_write_client(uuid)
  TO authenticated, service_role;

CREATE TABLE public.analytics_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  name text NOT NULL,
  objective text NOT NULL DEFAULT 'lead_generation',
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  budget numeric(14, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  utm_campaign text NOT NULL,
  start_date date,
  end_date date,
  created_by uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT analytics_campaigns_project_client_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_campaigns_id_scope_key
    UNIQUE (id, client_id, project_id),
  CONSTRAINT analytics_campaigns_project_utm_key
    UNIQUE (project_id, utm_campaign),
  CONSTRAINT analytics_campaigns_name_nonempty
    CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT analytics_campaigns_objective_nonempty
    CHECK (length(btrim(objective)) BETWEEN 1 AND 500),
  CONSTRAINT analytics_campaigns_channel_slug
    CHECK (channel ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  CONSTRAINT analytics_campaigns_status_valid
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  CONSTRAINT analytics_campaigns_budget_valid
    CHECK (budget >= 0),
  CONSTRAINT analytics_campaigns_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT analytics_campaigns_utm_slug
    CHECK (utm_campaign ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  CONSTRAINT analytics_campaigns_dates_valid
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT analytics_campaigns_archive_status
    CHECK (
      (archived_at IS NULL AND status <> 'archived')
      OR (archived_at IS NOT NULL AND status = 'archived')
    )
);

CREATE TABLE public.analytics_utm_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  name text NOT NULL,
  destination_url text NOT NULL,
  utm_source text NOT NULL,
  utm_medium text NOT NULL,
  utm_campaign text NOT NULL,
  utm_content text,
  utm_term text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT analytics_utm_links_project_client_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_utm_links_campaign_scope_fk
    FOREIGN KEY (campaign_id, client_id, project_id)
    REFERENCES public.analytics_campaigns(id, client_id, project_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_utm_links_id_scope_key
    UNIQUE (id, client_id, project_id, campaign_id),
  CONSTRAINT analytics_utm_links_name_nonempty
    CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT analytics_utm_links_destination_http
    CHECK (destination_url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT analytics_utm_links_source_slug
    CHECK (utm_source ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  CONSTRAINT analytics_utm_links_medium_slug
    CHECK (utm_medium ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  CONSTRAINT analytics_utm_links_campaign_slug
    CHECK (utm_campaign ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  CONSTRAINT analytics_utm_links_content_slug
    CHECK (
      utm_content IS NULL
      OR utm_content ~ '^[a-z0-9][a-z0-9_-]{0,119}$'
    ),
  CONSTRAINT analytics_utm_links_term_slug
    CHECK (
      utm_term IS NULL
      OR utm_term ~ '^[a-z0-9][a-z0-9_-]{0,119}$'
    ),
  CONSTRAINT analytics_utm_links_archive_state
    CHECK (archived_at IS NULL OR active = false)
);

CREATE TABLE public.analytics_conversion_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  name text NOT NULL,
  event_key text NOT NULL,
  conversion_type text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  counts_as_revenue boolean NOT NULL DEFAULT false,
  default_value numeric(16, 2),
  currency text NOT NULL DEFAULT 'BRL',
  funnel_order smallint NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,

  CONSTRAINT analytics_conversion_defs_project_client_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_conversion_defs_id_scope_key
    UNIQUE (id, client_id, project_id),
  CONSTRAINT analytics_conversion_defs_project_event_key
    UNIQUE (project_id, event_key),
  CONSTRAINT analytics_conversion_defs_name_nonempty
    CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT analytics_conversion_defs_event_slug
    CHECK (event_key ~ '^[a-z0-9][a-z0-9_-]{0,99}$'),
  CONSTRAINT analytics_conversion_defs_type_valid
    CHECK (
      conversion_type IN (
        'lead',
        'message',
        'appointment',
        'purchase',
        'signup',
        'custom'
      )
    ),
  CONSTRAINT analytics_conversion_defs_value_valid
    CHECK (default_value IS NULL OR default_value >= 0),
  CONSTRAINT analytics_conversion_defs_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT analytics_conversion_defs_order_valid
    CHECK (funnel_order BETWEEN 1 AND 99),
  CONSTRAINT analytics_conversion_defs_archive_state
    CHECK (archived_at IS NULL OR active = false)
);

CREATE TABLE public.analytics_conversion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  campaign_id uuid,
  utm_link_id uuid,
  source text NOT NULL DEFAULT 'manual',
  external_id text NOT NULL,
  value numeric(16, 2),
  currency text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL,
  definition_name text NOT NULL DEFAULT '',
  event_key text NOT NULL DEFAULT '',
  conversion_type text NOT NULL DEFAULT 'custom',
  is_primary boolean NOT NULL DEFAULT false,
  counts_as_revenue boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid
    REFERENCES public.profiles(id) ON DELETE RESTRICT,

  CONSTRAINT analytics_conversion_events_project_client_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_conversion_events_definition_scope_fk
    FOREIGN KEY (definition_id, client_id, project_id)
    REFERENCES public.analytics_conversion_definitions(id, client_id, project_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_conversion_events_campaign_scope_fk
    FOREIGN KEY (campaign_id, client_id, project_id)
    REFERENCES public.analytics_campaigns(id, client_id, project_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_conversion_events_link_scope_fk
    FOREIGN KEY (utm_link_id, client_id, project_id, campaign_id)
    REFERENCES public.analytics_utm_links(id, client_id, project_id, campaign_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_conversion_events_source_slug
    CHECK (source ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  CONSTRAINT analytics_conversion_events_external_nonempty
    CHECK (length(btrim(external_id)) BETWEEN 1 AND 200),
  CONSTRAINT analytics_conversion_events_value_valid
    CHECK (value IS NULL OR value >= 0),
  CONSTRAINT analytics_conversion_events_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT analytics_conversion_events_link_requires_campaign
    CHECK (utm_link_id IS NULL OR campaign_id IS NOT NULL),
  CONSTRAINT analytics_conversion_events_archive_actor
    CHECK (
      (archived_at IS NULL AND archived_by IS NULL)
      OR (archived_at IS NOT NULL AND archived_by IS NOT NULL)
    ),
  CONSTRAINT analytics_conversion_events_source_external_key
    UNIQUE (client_id, source, external_id)
);

CREATE TABLE public.analytics_metric_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  campaign_id uuid,
  utm_link_id uuid,
  metric_key text NOT NULL,
  metric_value numeric(18, 4) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  external_id text NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  period_start date NOT NULL,
  period_end date NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT analytics_metric_entries_project_client_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects(id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_metric_entries_campaign_scope_fk
    FOREIGN KEY (campaign_id, client_id, project_id)
    REFERENCES public.analytics_campaigns(id, client_id, project_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_metric_entries_link_scope_fk
    FOREIGN KEY (utm_link_id, client_id, project_id, campaign_id)
    REFERENCES public.analytics_utm_links(id, client_id, project_id, campaign_id)
    ON DELETE RESTRICT,
  CONSTRAINT analytics_metric_entries_metric_slug
    CHECK (metric_key ~ '^[a-z0-9][a-z0-9_]{0,79}$'),
  CONSTRAINT analytics_metric_entries_value_valid
    CHECK (metric_value >= 0),
  CONSTRAINT analytics_metric_entries_source_slug
    CHECK (source ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  CONSTRAINT analytics_metric_entries_external_nonempty
    CHECK (length(btrim(external_id)) BETWEEN 1 AND 200),
  CONSTRAINT analytics_metric_entries_currency_valid
    CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT analytics_metric_entries_period_valid
    CHECK (period_end >= period_start),
  CONSTRAINT analytics_metric_entries_link_requires_campaign
    CHECK (utm_link_id IS NULL OR campaign_id IS NOT NULL),
  CONSTRAINT analytics_metric_entries_source_external_key
    UNIQUE (client_id, project_id, source, external_id, metric_key)
);

CREATE INDEX analytics_campaigns_scope_status_idx
  ON public.analytics_campaigns(client_id, project_id, status)
  WHERE archived_at IS NULL;

CREATE INDEX analytics_utm_links_scope_active_idx
  ON public.analytics_utm_links(client_id, project_id, active)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX analytics_utm_links_tracking_key
  ON public.analytics_utm_links(
    project_id,
    campaign_id,
    destination_url,
    utm_source,
    utm_medium,
    utm_campaign,
    COALESCE(utm_content, ''),
    COALESCE(utm_term, '')
  )
  WHERE archived_at IS NULL;

CREATE INDEX analytics_conversion_defs_scope_order_idx
  ON public.analytics_conversion_definitions(
    client_id,
    project_id,
    active,
    funnel_order
  )
  WHERE archived_at IS NULL;

CREATE INDEX analytics_conversion_events_scope_time_idx
  ON public.analytics_conversion_events(
    client_id,
    project_id,
    occurred_at DESC
  )
  WHERE archived_at IS NULL;

CREATE INDEX analytics_conversion_events_campaign_time_idx
  ON public.analytics_conversion_events(campaign_id, occurred_at DESC)
  WHERE campaign_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX analytics_conversion_events_definition_time_idx
  ON public.analytics_conversion_events(definition_id, occurred_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX analytics_metric_entries_scope_period_idx
  ON public.analytics_metric_entries(
    client_id,
    project_id,
    period_start,
    period_end,
    metric_key
  );

CREATE INDEX analytics_metric_entries_campaign_period_idx
  ON public.analytics_metric_entries(campaign_id, period_start, period_end)
  WHERE campaign_id IS NOT NULL;

CREATE UNIQUE INDEX analytics_metric_entries_semantic_key
  ON public.analytics_metric_entries(
    project_id,
    COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(utm_link_id, '00000000-0000-0000-0000-000000000000'::uuid),
    source,
    metric_key,
    period_start,
    period_end
  );

CREATE OR REPLACE FUNCTION public.analytics_record_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'analytics tenant and creation fields are immutable';
  END IF;

  IF TG_TABLE_NAME = 'analytics_campaigns'
     AND NEW.utm_campaign IS DISTINCT FROM OLD.utm_campaign THEN
    RAISE EXCEPTION
      'campaign UTM identity is immutable; create a new campaign instead';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_record_guard()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.analytics_utm_link_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  campaign_utm text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT campaign.utm_campaign
    INTO campaign_utm
    FROM public.analytics_campaigns AS campaign
    WHERE campaign.id = NEW.campaign_id
      AND campaign.client_id = NEW.client_id
      AND campaign.project_id = NEW.project_id
      AND campaign.archived_at IS NULL
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'active analytics campaign not found in this scope'
        USING ERRCODE = '23503';
    END IF;

    NEW.utm_campaign := campaign_utm;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.destination_url IS DISTINCT FROM OLD.destination_url
    OR NEW.utm_source IS DISTINCT FROM OLD.utm_source
    OR NEW.utm_medium IS DISTINCT FROM OLD.utm_medium
    OR NEW.utm_campaign IS DISTINCT FROM OLD.utm_campaign
    OR NEW.utm_content IS DISTINCT FROM OLD.utm_content
    OR NEW.utm_term IS DISTINCT FROM OLD.utm_term
  ) THEN
    RAISE EXCEPTION
      'used tracking fields are immutable; create a new UTM link instead';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_utm_link_immutable_guard()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.analytics_conversion_event_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  definition_row public.analytics_conversion_definitions%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT *
    INTO definition_row
    FROM public.analytics_conversion_definitions
    WHERE id = NEW.definition_id
      AND client_id = NEW.client_id
      AND project_id = NEW.project_id
      AND active = true
      AND archived_at IS NULL
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'active conversion definition not found in this scope'
        USING ERRCODE = '23503';
    END IF;

    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;

    NEW.definition_name := definition_row.name;
    NEW.event_key := definition_row.event_key;
    NEW.conversion_type := definition_row.conversion_type;
    NEW.is_primary := definition_row.is_primary;
    NEW.counts_as_revenue := definition_row.counts_as_revenue;
    NEW.value := COALESCE(NEW.value, definition_row.default_value);
    NEW.currency := COALESCE(NULLIF(NEW.currency, ''), definition_row.currency);
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.definition_id IS DISTINCT FROM OLD.definition_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.utm_link_id IS DISTINCT FROM OLD.utm_link_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.definition_name IS DISTINCT FROM OLD.definition_name
     OR NEW.event_key IS DISTINCT FROM OLD.event_key
     OR NEW.conversion_type IS DISTINCT FROM OLD.conversion_type
     OR NEW.is_primary IS DISTINCT FROM OLD.is_primary
     OR NEW.counts_as_revenue IS DISTINCT FROM OLD.counts_as_revenue
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'conversion events are append-only; archive and create a replacement';
  END IF;

  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    IF NEW.archived_at IS NULL THEN
      NEW.archived_by := NULL;
    ELSE
      NEW.archived_by := auth.uid();
      IF NEW.archived_by IS NULL THEN
        RAISE EXCEPTION 'archiving requires an authenticated actor';
      END IF;
    END IF;
  ELSIF NEW.archived_by IS DISTINCT FROM OLD.archived_by THEN
    RAISE EXCEPTION 'archived_by is managed automatically';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_conversion_event_guard()
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.analytics_metric_entry_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  conflicting_entry uuid;
  semantic_lock_key text;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.utm_link_id IS DISTINCT FROM OLD.utm_link_id
    OR NEW.metric_key IS DISTINCT FROM OLD.metric_key
    OR NEW.source IS DISTINCT FROM OLD.source
    OR NEW.external_id IS DISTINCT FROM OLD.external_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
  ) THEN
    RAISE EXCEPTION
      'metric identity fields are immutable; update only its observed value';
  END IF;

  semantic_lock_key :=
    NEW.project_id::text || '|' ||
    COALESCE(NEW.campaign_id::text, 'project') || '|' ||
    COALESCE(NEW.utm_link_id::text, 'campaign') || '|' ||
    NEW.source || '|' ||
    NEW.metric_key;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(semantic_lock_key, 0)
  );

  SELECT entry.id
  INTO conflicting_entry
  FROM public.analytics_metric_entries AS entry
  WHERE entry.id IS DISTINCT FROM NEW.id
    AND entry.project_id = NEW.project_id
    AND entry.campaign_id IS NOT DISTINCT FROM NEW.campaign_id
    AND entry.utm_link_id IS NOT DISTINCT FROM NEW.utm_link_id
    AND entry.source = NEW.source
    AND entry.metric_key = NEW.metric_key
    AND pg_catalog.daterange(
      entry.period_start,
      entry.period_end,
      '[]'
    ) && pg_catalog.daterange(
      NEW.period_start,
      NEW.period_end,
      '[]'
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'metric period overlaps an existing observation in this scope'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_metric_entry_immutable_guard()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER analytics_campaigns_record_guard
BEFORE INSERT OR UPDATE ON public.analytics_campaigns
FOR EACH ROW EXECUTE FUNCTION public.analytics_record_guard();

CREATE TRIGGER analytics_utm_links_record_guard
BEFORE INSERT OR UPDATE ON public.analytics_utm_links
FOR EACH ROW EXECUTE FUNCTION public.analytics_record_guard();

CREATE TRIGGER analytics_utm_links_immutable_guard
BEFORE INSERT OR UPDATE ON public.analytics_utm_links
FOR EACH ROW EXECUTE FUNCTION public.analytics_utm_link_immutable_guard();

CREATE TRIGGER analytics_conversion_defs_record_guard
BEFORE INSERT OR UPDATE ON public.analytics_conversion_definitions
FOR EACH ROW EXECUTE FUNCTION public.analytics_record_guard();

CREATE TRIGGER analytics_conversion_events_guard
BEFORE INSERT OR UPDATE ON public.analytics_conversion_events
FOR EACH ROW EXECUTE FUNCTION public.analytics_conversion_event_guard();

CREATE TRIGGER analytics_metric_entries_record_guard
BEFORE INSERT OR UPDATE ON public.analytics_metric_entries
FOR EACH ROW EXECUTE FUNCTION public.analytics_record_guard();

CREATE TRIGGER analytics_metric_entries_immutable_guard
BEFORE INSERT OR UPDATE ON public.analytics_metric_entries
FOR EACH ROW EXECUTE FUNCTION public.analytics_metric_entry_immutable_guard();

ALTER TABLE public.analytics_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_utm_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_conversion_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_conversion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_metric_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.analytics_campaigns
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.analytics_utm_links
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.analytics_conversion_definitions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.analytics_conversion_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.analytics_metric_entries
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON public.analytics_campaigns
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.analytics_utm_links
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.analytics_conversion_definitions
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.analytics_conversion_events
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.analytics_metric_entries
  TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.analytics_campaigns
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.analytics_utm_links
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.analytics_conversion_definitions
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.analytics_conversion_events
  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.analytics_metric_entries
  TO service_role;

CREATE POLICY analytics_campaigns_select
ON public.analytics_campaigns
FOR SELECT TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY analytics_campaigns_insert
ON public.analytics_campaigns
FOR INSERT TO authenticated
WITH CHECK (
  public.analytics_can_write_client(client_id)
  AND created_by = auth.uid()
);

CREATE POLICY analytics_campaigns_update
ON public.analytics_campaigns
FOR UPDATE TO authenticated
USING (public.analytics_can_write_client(client_id))
WITH CHECK (
  public.analytics_can_write_client(client_id)
  AND created_by IS NOT NULL
);

CREATE POLICY analytics_utm_links_select
ON public.analytics_utm_links
FOR SELECT TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY analytics_utm_links_insert
ON public.analytics_utm_links
FOR INSERT TO authenticated
WITH CHECK (
  public.analytics_can_write_client(client_id)
  AND created_by = auth.uid()
);

CREATE POLICY analytics_utm_links_update
ON public.analytics_utm_links
FOR UPDATE TO authenticated
USING (public.analytics_can_write_client(client_id))
WITH CHECK (public.analytics_can_write_client(client_id));

CREATE POLICY analytics_conversion_defs_select
ON public.analytics_conversion_definitions
FOR SELECT TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY analytics_conversion_defs_insert
ON public.analytics_conversion_definitions
FOR INSERT TO authenticated
WITH CHECK (
  public.analytics_can_write_client(client_id)
  AND created_by = auth.uid()
);

CREATE POLICY analytics_conversion_defs_update
ON public.analytics_conversion_definitions
FOR UPDATE TO authenticated
USING (public.analytics_can_write_client(client_id))
WITH CHECK (public.analytics_can_write_client(client_id));

CREATE POLICY analytics_conversion_events_select
ON public.analytics_conversion_events
FOR SELECT TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY analytics_conversion_events_insert
ON public.analytics_conversion_events
FOR INSERT TO authenticated
WITH CHECK (
  public.analytics_can_write_client(client_id)
  AND created_by = auth.uid()
);

CREATE POLICY analytics_conversion_events_update
ON public.analytics_conversion_events
FOR UPDATE TO authenticated
USING (public.analytics_can_write_client(client_id))
WITH CHECK (public.analytics_can_write_client(client_id));

CREATE POLICY analytics_metric_entries_select
ON public.analytics_metric_entries
FOR SELECT TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY analytics_metric_entries_insert
ON public.analytics_metric_entries
FOR INSERT TO authenticated
WITH CHECK (
  public.analytics_can_write_client(client_id)
  AND created_by = auth.uid()
);

CREATE POLICY analytics_metric_entries_update
ON public.analytics_metric_entries
FOR UPDATE TO authenticated
USING (public.analytics_can_write_client(client_id))
WITH CHECK (public.analytics_can_write_client(client_id));

-- Todas as telas abertas recebem mudanças entre sessões sem polling exclusivo.
DO $$
DECLARE
  analytics_table text;
BEGIN
  FOREACH analytics_table IN ARRAY ARRAY[
    'analytics_campaigns',
    'analytics_utm_links',
    'analytics_conversion_definitions',
    'analytics_conversion_events',
    'analytics_metric_entries'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = analytics_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        analytics_table
      );
    END IF;
  END LOOP;
END
$$;
