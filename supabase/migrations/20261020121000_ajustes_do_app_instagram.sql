-- 20/10/2026 ("perfil perfeito" da aba Redes): o checklist dos ajustes do app (Editar perfil,
-- Configurações, ao postar foto e Reels) marcado pela equipe, por conta, no plano do cliente.
-- A API do Instagram não lê esses ajustes: é o que a equipe conferiu no app.
--
-- Formato: {tipo_de_negocio: {tipo, origem, confianca, probabilidades, quando, por} | null,
--           itens: {<chave>: {feito, quando, por}}}
-- O catálogo dos itens mora no código (supabase/functions/mesa-instagram/modulos/ajustes-do-app.ts).
--
-- Escreve só a função mesa-instagram (service_role), pela função abaixo, que grava um pedaço por
-- vez dentro do mesmo comando (dois cliques seguidos em itens diferentes não se apagam). A leitura
-- segue a política que já existe na tabela (equipe com acesso ao cliente). Idempotente.

ALTER TABLE public.cliente_instagram_planos
  ADD COLUMN IF NOT EXISTS ajustes_do_app jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_instagram_planos_ajustes_do_app_objeto') THEN
    ALTER TABLE public.cliente_instagram_planos
      ADD CONSTRAINT cliente_instagram_planos_ajustes_do_app_objeto CHECK (ajustes_do_app IS NULL OR jsonb_typeof(ajustes_do_app) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.cliente_instagram_planos.ajustes_do_app IS
  'Ajustes do app (checklist do perfil perfeito): {tipo_de_negocio: {tipo, origem jev|equipe, confianca, probabilidades, quando, por}, itens: {chave: {feito, quando, por}}}.';

-- Grava um pedaço do jsonb: ARRAY['tipo_de_negocio'] ou ARRAY['itens', '<chave>'].
-- _so_se_vazio: não troca o que já existe (o Jev nunca passa por cima da escolha da equipe).
CREATE OR REPLACE FUNCTION public.mesa_gravar_ajuste_do_app(
  _client_id uuid,
  _conta_chave text,
  _caminho text[],
  _valor jsonb,
  _por uuid,
  _so_se_vazio boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  resultado jsonb;
BEGIN
  IF NOT (
    (array_length(_caminho, 1) = 1 AND _caminho[1] = 'tipo_de_negocio')
    OR (array_length(_caminho, 1) = 2 AND _caminho[1] = 'itens' AND _caminho[2] ~ '^[a-z0-9_]{2,60}$')
  ) THEN
    RAISE EXCEPTION 'caminho_invalido' USING ERRCODE = '22023';
  END IF;
  IF _valor IS NULL OR jsonb_typeof(_valor) <> 'object' THEN
    RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cliente_instagram_planos AS p (client_id, conta_chave, ajustes_do_app, atualizado_por)
  VALUES (
    _client_id,
    _conta_chave,
    CASE WHEN _caminho[1] = 'tipo_de_negocio'
      THEN jsonb_build_object('tipo_de_negocio', _valor, 'itens', '{}'::jsonb)
      ELSE jsonb_build_object('tipo_de_negocio', NULL, 'itens', jsonb_build_object(_caminho[2], _valor))
    END,
    _por
  )
  ON CONFLICT (client_id, conta_chave) DO UPDATE
    SET ajustes_do_app = CASE
          WHEN _so_se_vazio AND p.ajustes_do_app #> _caminho IS NOT NULL AND jsonb_typeof(p.ajustes_do_app #> _caminho) <> 'null'
            THEN p.ajustes_do_app
          ELSE jsonb_set(
            coalesce(p.ajustes_do_app, '{}'::jsonb)
              || jsonb_build_object('itens', CASE WHEN jsonb_typeof(p.ajustes_do_app -> 'itens') = 'object' THEN p.ajustes_do_app -> 'itens' ELSE '{}'::jsonb END),
            _caminho,
            _valor,
            true
          )
        END,
        atualizado_por = _por
  RETURNING p.ajustes_do_app INTO resultado;

  RETURN resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_gravar_ajuste_do_app(uuid, text, text[], jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_gravar_ajuste_do_app(uuid, text, text[], jsonb, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.mesa_gravar_ajuste_do_app(uuid, text, text[], jsonb, uuid, boolean) IS
  'Ajustes do app da aba Redes: grava o tipo de negócio ou a marca de um item no plano da conta, num comando só. Só service_role (função mesa-instagram).';
