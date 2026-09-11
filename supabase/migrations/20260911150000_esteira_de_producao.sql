-- Esteira de producao do Ciclo: o painel deriva os itens do estado real
-- (post no seu estagio, tarefa, campanha, item de checklist, marco, passo de
-- onboarding). Nada disso e inventado; o que se grava aqui e SO o que a
-- pessoa fez por cima do item derivado (feito / adiado / ignorado), os rituais
-- da semana e as preferencias por cliente (quem entra, o que ja tem).

-- 1) Marcacao humana sobre um item derivado. A chave e estavel e nasce do
--    fato (post:<id>:arte, onb:logo, task:<id>, camp:<id>:verba, ...). Quando
--    o fato some, o item some; a marcacao fica como historico da semana.
CREATE TABLE IF NOT EXISTS public.cycle_item_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  week_start date NOT NULL,
  item_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('done', 'snoozed', 'ignored')),
  note text,
  done_by uuid,
  done_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_start, item_key)
);
CREATE INDEX IF NOT EXISTS cycle_item_state_week_idx
  ON public.cycle_item_state (week_start, client_id);

-- 2) Rituais da semana por cliente (segunda / quarta / sexta). Uma linha por
--    ritual marcado; a semana seguinte comeca em branco por construcao.
CREATE TABLE IF NOT EXISTS public.cycle_rituals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  week_start date NOT NULL,
  ritual_key text NOT NULL CHECK (ritual_key IN ('segunda', 'quarta', 'sexta')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'central')),
  done_by uuid,
  done_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_start, ritual_key)
);
CREATE INDEX IF NOT EXISTS cycle_rituals_week_idx
  ON public.cycle_rituals (week_start, client_id);

-- 3) Preferencias por cliente: frentes ocultas (esta semana ou sempre) e o
--    que o cliente JA TEM no onboarding quando o painel nao consegue
--    detectar sozinho (nome, logo, portfolio, grupo...).
CREATE TABLE IF NOT EXISTS public.cycle_client_prefs (
  client_id uuid PRIMARY KEY,
  hidden_areas jsonb NOT NULL DEFAULT '[]'::jsonb,
  hidden_until date,
  onboarding_has jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: leitura para equipe com acesso ao cliente; escrita admin/manager.
ALTER TABLE public.cycle_item_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_rituals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_client_prefs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cycle_item_state', 'cycle_rituals', 'cycle_client_prefs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_staff_read ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_staff_read ON public.%I
        FOR SELECT TO authenticated
        USING (public.is_staff(auth.uid()) AND public.can_access_client(client_id))
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_admin_insert ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_admin_insert ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (
          (public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'manager'::public.app_role))
          AND public.can_access_client(client_id)
        )
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_admin_update ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_admin_update ON public.%I
        FOR UPDATE TO authenticated
        USING (
          (public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'manager'::public.app_role))
          AND public.can_access_client(client_id)
        )
        WITH CHECK (
          (public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'manager'::public.app_role))
          AND public.can_access_client(client_id)
        )
    $p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_admin_delete ON public.%I', t, t);
    EXECUTE format($p$
      CREATE POLICY %I_admin_delete ON public.%I
        FOR DELETE TO authenticated
        USING (
          (public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'manager'::public.app_role))
          AND public.can_access_client(client_id)
        )
    $p$, t, t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;
