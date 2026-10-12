-- Memória da conta de tráfego em 8 camadas (12/10/2026).
--
-- Só amplia e é idempotente. Guarda o que a equipe preenche (comportamento, finanças, confiabilidade
-- dos dados, mercado e calendário, fonte que prevalece). As outras camadas são montadas pela função
-- mesa-ads a partir das tabelas que já existem. Não usa client_dossiers de propósito: vários leitores
-- do dossiê pegam "o atual" sem filtrar o tipo e passariam a ler a memória de tráfego como contexto.
-- Cada salvamento é uma versão nova; a anterior fica com atual = false (histórico, nunca apagado).
-- Leitura: equipe. Escrita: só a função (service_role).

CREATE TABLE IF NOT EXISTS public.ads_memoria_da_conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  versao integer NOT NULL,
  atual boolean NOT NULL DEFAULT true,
  camadas jsonb NOT NULL DEFAULT '{}'::jsonb,
  motivo text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ads_memoria_da_conta_versao_unica UNIQUE (client_id, versao)
);

CREATE UNIQUE INDEX IF NOT EXISTS ads_memoria_da_conta_uma_atual ON public.ads_memoria_da_conta (client_id) WHERE atual;

ALTER TABLE public.ads_memoria_da_conta ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_memoria_da_conta_equipe_le ON public.ads_memoria_da_conta;
CREATE POLICY ads_memoria_da_conta_equipe_le ON public.ads_memoria_da_conta FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'traffic'::public.app_role)
  );

DROP POLICY IF EXISTS ads_memoria_da_conta_servico ON public.ads_memoria_da_conta;
CREATE POLICY ads_memoria_da_conta_servico ON public.ads_memoria_da_conta FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON public.ads_memoria_da_conta FROM authenticated, anon;

-- Salvar uma versão nova numa transação só (a atual vira histórico e a nova entra como atual).
CREATE OR REPLACE FUNCTION public.ads_memoria_salvar(_client_id uuid, _camadas jsonb, _motivo text, _autor uuid, _versao_esperada integer)
RETURNS public.ads_memoria_da_conta
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _atual public.ads_memoria_da_conta%rowtype;
  _nova public.ads_memoria_da_conta%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'not_allowed: só a função mesa-ads grava a memória da conta';
  END IF;
  SELECT * INTO _atual FROM public.ads_memoria_da_conta WHERE client_id = _client_id AND atual FOR UPDATE;
  IF _versao_esperada IS NOT NULL AND COALESCE(_atual.versao, 0) <> _versao_esperada THEN
    RAISE EXCEPTION 'conflict: a memória mudou desde que foi aberta (versão %)', COALESCE(_atual.versao, 0);
  END IF;
  IF _atual.id IS NOT NULL THEN
    UPDATE public.ads_memoria_da_conta SET atual = false WHERE id = _atual.id;
  END IF;
  INSERT INTO public.ads_memoria_da_conta (client_id, versao, atual, camadas, motivo, criado_por)
  VALUES (_client_id, COALESCE(_atual.versao, 0) + 1, true, COALESCE(_camadas, '{}'::jsonb), _motivo, _autor)
  RETURNING * INTO _nova;
  RETURN _nova;
END;
$$;

REVOKE ALL ON FUNCTION public.ads_memoria_salvar(uuid, jsonb, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ads_memoria_salvar(uuid, jsonb, text, uuid, integer) TO service_role;
