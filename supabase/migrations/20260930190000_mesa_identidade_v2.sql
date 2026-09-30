-- Frente IDV2 (30/09/2026): evolução da Mesa Identidade (/mesa-identidade). Pedido do dono: "deixe mais
-- completo, e todos eles para preencher rápido com IA e escolha de modelos; reforce e melhore com ferramentas
-- e estrutura".
--
-- Só amplia e é idempotente. Nada de mexer em RLS existente nem em can_access_client.
--
-- 1. Etapas novas no projeto: 'estrategia' (depois da Pesquisa) e 'apresentacao' (depois do Guideline).
--    O CHECK de idv_projetos.etapa ganha os dois valores (lista lida em 30/09 por SELECT; só amplia).
-- 2. Eventos novos para o documento de entrega: estratégia montada e votação aberta/fechada.
-- 3. Votação dos nomes (equipe e cliente):
--    - idv_naming_rodadas ganha o link público da votação (token de 32, revogável) e o retrato publicado
--      (só nome, justificativa e pronúncia dos finalistas: sem nota, sem domínio, sem cliente);
--    - idv_naming_votos: um voto (nota de 1 a 5 e comentário) por pessoa e por nome. A equipe vota pela
--      função mesa-identidade (service_role, com can_access_client); o cliente vota pelo link, pela RPC
--      idv_naming_votar_publico (security definer, que confere o token, a votação aberta e o finalista).
--    RLS: a equipe lê (is_staff + can_access_client); ninguém grava direto.

-- ─── 1) Etapas novas ──────────────────────────────────────────────────────────
DO $migration$
BEGIN
  IF to_regclass('public.idv_projetos') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.idv_projetos DROP CONSTRAINT IF EXISTS idv_projetos_etapa_check;
  ALTER TABLE public.idv_projetos
    ADD CONSTRAINT idv_projetos_etapa_check
    CHECK (etapa IN ('inicio', 'briefing', 'pesquisa', 'estrategia', 'naming', 'conceito', 'sistema', 'mockups', 'guideline', 'apresentacao', 'entrega'));
END
$migration$;

-- ─── 2) Eventos novos ─────────────────────────────────────────────────────────
DO $migration$
BEGIN
  IF to_regclass('public.idv_eventos') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.idv_eventos DROP CONSTRAINT IF EXISTS idv_eventos_tipo_check;
  ALTER TABLE public.idv_eventos
    ADD CONSTRAINT idv_eventos_tipo_check
    CHECK (tipo IN ('naming_enviado', 'naming_grupo', 'naming_escolhido', 'brandbook_enviado', 'brandbook_publicado', 'brandbook_revogado', 'kit_aplicado', 'projeto_entregue',
                    'estrategia_montada', 'votacao_aberta', 'votacao_fechada'));
END
$migration$;

-- ─── 3) Votação dos nomes ─────────────────────────────────────────────────────
ALTER TABLE public.idv_naming_rodadas ADD COLUMN IF NOT EXISTS votacao_token text;
ALTER TABLE public.idv_naming_rodadas ADD COLUMN IF NOT EXISTS votacao_retrato jsonb;
ALTER TABLE public.idv_naming_rodadas ADD COLUMN IF NOT EXISTS votacao_aberta_em timestamptz;
ALTER TABLE public.idv_naming_rodadas ADD COLUMN IF NOT EXISTS votacao_fechada_em timestamptz;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'idv_naming_rodadas_votacao_token_formato') THEN
    ALTER TABLE public.idv_naming_rodadas
      ADD CONSTRAINT idv_naming_rodadas_votacao_token_formato CHECK (votacao_token IS NULL OR votacao_token ~ '^[A-Za-z0-9_-]{32}$');
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS idv_naming_rodadas_votacao_token_idx ON public.idv_naming_rodadas (votacao_token) WHERE votacao_token IS NOT NULL;

COMMENT ON COLUMN public.idv_naming_rodadas.votacao_retrato IS
  'Retrato da votação pública (IDV2): marca, alvo e finalistas (id, nome, justificativa, pronúncia). Sem nota, domínio ou cliente.';

CREATE TABLE IF NOT EXISTS public.idv_naming_votos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rodada_id uuid NOT NULL REFERENCES public.idv_naming_rodadas(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Id do candidato dentro da rodada (n1..n40).
  candidato_id text NOT NULL CHECK (candidato_id ~ '^n[0-9]{1,2}$'),
  origem text NOT NULL CHECK (origem IN ('equipe', 'cliente')),
  -- Quem votou: o nome que a pessoa escreveu (cliente) ou o nome da equipe.
  votante text NOT NULL CHECK (char_length(btrim(votante)) BETWEEN 2 AND 60),
  -- Chave do voto: o id do usuário (equipe) ou o nome em minúsculas (cliente). Um voto por pessoa e por nome.
  votante_chave text NOT NULL CHECK (char_length(votante_chave) BETWEEN 2 AND 80),
  user_id uuid,
  nota smallint NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario text CHECK (comentario IS NULL OR char_length(comentario) <= 500),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idv_naming_votos_unico ON public.idv_naming_votos (rodada_id, origem, votante_chave, candidato_id);
CREATE INDEX IF NOT EXISTS idv_naming_votos_cliente_idx ON public.idv_naming_votos (client_id, criado_em DESC);

COMMENT ON TABLE public.idv_naming_votos IS
  'Votação dos nomes (IDV2): nota de 1 a 5 por pessoa e por finalista, da equipe (pela função mesa-identidade) e do cliente (pelo link, RPC idv_naming_votar_publico).';

ALTER TABLE public.idv_naming_votos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS idv_naming_votos_staff_read ON public.idv_naming_votos;
CREATE POLICY idv_naming_votos_staff_read ON public.idv_naming_votos
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.idv_naming_votos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.idv_naming_votos FROM authenticated;
GRANT SELECT ON public.idv_naming_votos TO authenticated;
GRANT ALL ON public.idv_naming_votos TO service_role;

-- ─── 4) Página pública da votação ────────────────────────────────────────────
-- Lê só o retrato publicado, por token, com a votação aberta e a rodada não arquivada.
CREATE OR REPLACE FUNCTION public.idv_naming_votacao_publica(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _saida jsonb;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object('votacao', r.votacao_retrato, 'aberta', r.votacao_fechada_em IS NULL, 'aberta_em', r.votacao_aberta_em)
    INTO _saida
  FROM public.idv_naming_rodadas r
  WHERE r.votacao_token = _token
    AND r.votacao_retrato IS NOT NULL
    AND r.status <> 'arquivado'
  LIMIT 1;
  RETURN _saida;
END;
$$;

REVOKE ALL ON FUNCTION public.idv_naming_votacao_publica(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.idv_naming_votacao_publica(text) TO anon, authenticated, service_role;

-- Grava os votos do cliente (uma nota por finalista). Confere tudo aqui dentro: token, votação aberta,
-- finalista do retrato, nota de 1 a 5, nome de 2 a 60 letras e no máximo 40 pessoas por rodada.
CREATE OR REPLACE FUNCTION public.idv_naming_votar_publico(_token text, _votante text, _votos jsonb, _comentario text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _r record;
  _nome text := btrim(coalesce(_votante, ''));
  _chave text;
  _item jsonb;
  _cand text;
  _nota int;
  _gravados int := 0;
  _pessoas int;
BEGIN
  IF _token IS NULL OR _token !~ '^[A-Za-z0-9_-]{32}$' THEN
    RAISE EXCEPTION 'votacao_invalida' USING ERRCODE = 'P0001';
  END IF;
  SELECT r.id, r.client_id, r.votacao_retrato, r.votacao_fechada_em, r.status
    INTO _r
  FROM public.idv_naming_rodadas r
  WHERE r.votacao_token = _token AND r.votacao_retrato IS NOT NULL
  LIMIT 1;
  IF NOT FOUND OR _r.status = 'arquivado' THEN
    RAISE EXCEPTION 'votacao_invalida' USING ERRCODE = 'P0001';
  END IF;
  IF _r.votacao_fechada_em IS NOT NULL THEN
    RAISE EXCEPTION 'votacao_fechada' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(_nome) < 2 OR char_length(_nome) > 60 THEN
    RAISE EXCEPTION 'nome_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(_votos) <> 'array' OR jsonb_array_length(_votos) < 1 OR jsonb_array_length(_votos) > 5 THEN
    RAISE EXCEPTION 'votos_invalidos' USING ERRCODE = 'P0001';
  END IF;
  _chave := lower(_nome);
  SELECT count(DISTINCT v.votante_chave) INTO _pessoas FROM public.idv_naming_votos v WHERE v.rodada_id = _r.id AND v.origem = 'cliente';
  IF _pessoas >= 40 AND NOT EXISTS (SELECT 1 FROM public.idv_naming_votos v WHERE v.rodada_id = _r.id AND v.origem = 'cliente' AND v.votante_chave = _chave) THEN
    RAISE EXCEPTION 'votacao_cheia' USING ERRCODE = 'P0001';
  END IF;
  FOR _item IN SELECT * FROM jsonb_array_elements(_votos) LOOP
    _cand := _item ->> 'candidato_id';
    BEGIN
      _nota := (_item ->> 'nota')::int;
    EXCEPTION WHEN others THEN
      _nota := NULL;
    END;
    IF _cand IS NULL OR _nota IS NULL OR _nota < 1 OR _nota > 5 THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_r.votacao_retrato -> 'finalistas', '[]'::jsonb)) f WHERE f ->> 'id' = _cand) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.idv_naming_votos (rodada_id, client_id, candidato_id, origem, votante, votante_chave, nota, comentario)
    VALUES (_r.id, _r.client_id, _cand, 'cliente', _nome, _chave, _nota, nullif(left(btrim(coalesce(_comentario, '')), 500), ''))
    ON CONFLICT (rodada_id, origem, votante_chave, candidato_id)
    DO UPDATE SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, atualizado_em = now();
    _gravados := _gravados + 1;
  END LOOP;
  RETURN jsonb_build_object('gravados', _gravados);
END;
$$;

REVOKE ALL ON FUNCTION public.idv_naming_votar_publico(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.idv_naming_votar_publico(text, text, jsonb, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select conname, pg_get_constraintdef(oid) from pg_constraint where conname in ('idv_projetos_etapa_check', 'idv_eventos_tipo_check');
-- select policyname, cmd from pg_policies where tablename = 'idv_naming_votos';
-- Teste sem gravar: begin; select public.idv_naming_votar_publico(repeat('a', 32), 'Ana', '[{"candidato_id":"n1","nota":5}]'::jsonb); rollback;
