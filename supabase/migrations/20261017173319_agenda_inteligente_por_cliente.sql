-- 17/10/2026: agenda inteligente por cliente (dono: "nunca agendar uma arte de um padrão que já tem no mesmo dia,
-- não sendo hype; dividir na semana; o hype pode ficar no mesmo dia, em horários diferentes"; escolha do dono:
-- "configurar por cliente"). Padrão: 1 post comum por dia, 1 de hype a mais, 3 horas entre os posts do dia.
-- As regras puras moram em supabase/functions/_shared/agenda-inteligente.ts. Só acrescenta: idempotente.

ALTER TABLE public.mesa_cliente_config
  ADD COLUMN IF NOT EXISTS posts_por_dia integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS hypes_por_dia integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS horas_entre_posts integer NOT NULL DEFAULT 3;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_cliente_config_agenda_limites') THEN
    ALTER TABLE public.mesa_cliente_config
      ADD CONSTRAINT mesa_cliente_config_agenda_limites
      CHECK (posts_por_dia BETWEEN 1 AND 5 AND hypes_por_dia BETWEEN 0 AND 3 AND horas_entre_posts BETWEEN 1 AND 12);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mesa_config_agenda(_client_id uuid, _posts_por_dia integer, _hypes_por_dia integer, _horas_entre_posts integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL
    OR NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role))
    OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'só admin ou gestor com acesso ao cliente muda este ajuste' USING ERRCODE = '42501';
  END IF;
  IF _posts_por_dia NOT BETWEEN 1 AND 5 OR _hypes_por_dia NOT BETWEEN 0 AND 3 OR _horas_entre_posts NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'limites fora do permitido (posts 1 a 5, hypes 0 a 3, horas 1 a 12)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mesa_cliente_config (client_id, posts_por_dia, hypes_por_dia, horas_entre_posts, atualizado_em, atualizado_por)
  VALUES (_client_id, _posts_por_dia, _hypes_por_dia, _horas_entre_posts, now(), _uid)
  ON CONFLICT (client_id) DO UPDATE SET
    posts_por_dia = EXCLUDED.posts_por_dia,
    hypes_por_dia = EXCLUDED.hypes_por_dia,
    horas_entre_posts = EXCLUDED.horas_entre_posts,
    atualizado_em = now(),
    atualizado_por = _uid;
  RETURN jsonb_build_object('posts_por_dia', _posts_por_dia, 'hypes_por_dia', _hypes_por_dia, 'horas_entre_posts', _horas_entre_posts);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_config_agenda(uuid, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_config_agenda(uuid, integer, integer, integer) TO authenticated;
