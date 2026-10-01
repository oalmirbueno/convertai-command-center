-- Frente CUS (01/10/2026): o navegador do agente com qualquer modelo de computer use e mais ações.
--
-- Pedido do dono: "Eu posso usar o computer use com qualquer modelo? Em qualquer ação? Deixa bem completinho."
-- Desenho: docs/motores/COMPUTADOR-DO-AGENTE.md, seção 9. Base: 20260930320200_navegador_do_agente.sql.
--
-- 1. Quatro ações novas, todas SÓ DE LEITURA de páginas públicas, com as mesmas travas das de antes:
--    conferir_site (Mesa Site › Publicação), capturar_referencia (Mesa Site › Referências),
--    perfil_publico (Mesa Ads › Referências) e concorrentes_visuais (Mesa Identidade › Pesquisa).
-- 2. urls: os sites de uma pesquisa de concorrentes visuais (no máximo 5; todos também na lista de domínios).
-- 3. O worker diz quais provedores de computer use tem chave (anthropic, openai) e só pega a tarefa cujo
--    modelo é de um deles. Worker antigo (sem a lista) continua pegando só o que é da Anthropic.
-- 4. Último erro do worker (fila, chave, Chromium) para o Estado dos motores.
-- 5. ia_modelos.recursos.computer_use = true nos modelos diretos que fazem computer use (conferido ao vivo
--    em 01/10/2026): Claude Sonnet 5.5 e Opus 5.5 (computer_toolset_20260801) e GPT-6.1 Sol e GPT-6 Astra
--    (ferramenta "computer" da Responses API). Nenhum modelo é ligado nem desligado aqui.
--
-- Idempotente e só amplia. RLS de antes: a equipe lê, só a service_role escreve.

-- ─── 1) Casos novos ────────────────────────────────────────────────────────────────
ALTER TABLE public.agente_computador_tarefas DROP CONSTRAINT IF EXISTS agente_computador_tarefas_caso_check;
ALTER TABLE public.agente_computador_tarefas
  ADD CONSTRAINT agente_computador_tarefas_caso_check
  CHECK (caso IS NULL OR caso IN ('captura_site', 'conferir_post', 'coleta_publica', 'conferir_site', 'capturar_referencia', 'perfil_publico', 'concorrentes_visuais'));

-- ─── 2) Sites da pesquisa ───────────────────────────────────────────────────────────
ALTER TABLE public.agente_computador_tarefas
  ADD COLUMN IF NOT EXISTS urls text[] NOT NULL DEFAULT '{}'::text[];
-- Cada endereço já vem conferido pela função (site público, fora de login) e de novo pelo worker; aqui, o tamanho.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_computador_tarefas_urls_check') THEN
    ALTER TABLE public.agente_computador_tarefas
      ADD CONSTRAINT agente_computador_tarefas_urls_check
      CHECK (cardinality(urls) <= 5 AND char_length(array_to_string(urls, ' ')) <= 10500);
  END IF;
END $$;

-- ─── 3 e 4) Executor: provedores com chave e último erro ─────────────────────────────
ALTER TABLE public.computador_executores
  ADD COLUMN IF NOT EXISTS provedores text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ultimo_erro text,
  ADD COLUMN IF NOT EXISTS ultimo_erro_em timestamptz;

-- A pegada ganha a lista de provedores (5º argumento, opcional). A assinatura antiga sai para o PostgREST
-- não ficar com duas funções do mesmo nome: a chamada de 4 argumentos do worker antigo cai nesta.
DROP FUNCTION IF EXISTS public.computador_tarefa_pegar(uuid, text, text[], text);

CREATE OR REPLACE FUNCTION public.computador_tarefa_pegar(_token uuid, _executor text, _casos text[], _versao text DEFAULT NULL, _provedores text[] DEFAULT NULL)
RETURNS SETOF public.agente_computador_tarefas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.agente_computador_tarefas;
  -- Worker antigo (sem a lista) só fala com a Anthropic.
  _prov text[] := COALESCE(_provedores, ARRAY['anthropic']::text[]);
BEGIN
  IF _token IS NULL OR _executor IS NULL OR char_length(_executor) NOT BETWEEN 1 AND 80 THEN
    RETURN;
  END IF;

  INSERT INTO public.computador_executores (nome, visto_em, versao, casos, provedores)
  VALUES (_executor, now(), left(_versao, 40), COALESCE(_casos, '{}'::text[]), COALESCE(_provedores, '{}'::text[]))
  ON CONFLICT (nome) DO UPDATE
    SET visto_em = now(),
        versao = COALESCE(left(EXCLUDED.versao, 40), public.computador_executores.versao),
        casos = EXCLUDED.casos,
        provedores = CASE WHEN _provedores IS NULL THEN public.computador_executores.provedores ELSE EXCLUDED.provedores END;

  -- Trava vencida (worker caiu no meio): falha com motivo, sem repetir sozinha.
  UPDATE public.agente_computador_tarefas
     SET estado = 'falhou', motivo = 'O navegador do agente parou no meio (máquina desligada?). Peça de novo.',
         trava_token = NULL, trava_ate = NULL, terminado_em = now(), atualizado_em = now()
   WHERE estado = 'executando' AND caso IS NOT NULL AND trava_ate < now();

  -- Aprovada e esquecida por mais de 24 h sai da fila.
  UPDATE public.agente_computador_tarefas
     SET estado = 'cancelada', motivo = 'Ficou aprovada mais de um dia sem executor ligado. Peça de novo.',
         terminado_em = now(), atualizado_em = now()
   WHERE estado = 'aprovada' AND caso IS NOT NULL AND aprovado_em < now() - interval '24 hours';

  SELECT t.* INTO _r
    FROM public.agente_computador_tarefas AS t
   WHERE t.estado = 'aprovada'
     AND t.caso IS NOT NULL
     AND t.caso = ANY (COALESCE(_casos, '{}'::text[]))
     AND t.aprovado_por IS NOT NULL
     AND t.aprovado_em IS NOT NULL
     -- Tarefa com modelo só vai para o worker que tem a chave daquele provedor.
     AND (t.modelo_id IS NULL OR split_part(t.modelo_id, ':', 1) = ANY (_prov))
   ORDER BY t.aprovado_em
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.agente_computador_tarefas
     SET estado = 'executando', executor = _executor, trava_token = _token,
         trava_ate = now() + interval '10 minutes', iniciado_em = now(), atualizado_em = now()
   WHERE id = _r.id
  RETURNING * INTO _r;
  RETURN NEXT _r;
END;
$$;

-- Erro do worker fora de uma tarefa (fila fora do ar, Chromium que não abre, chave recusada): o Estado dos
-- motores mostra. _erro nulo limpa. Nunca leva chave: o worker corta o texto e tira o que parece segredo.
CREATE OR REPLACE FUNCTION public.computador_executor_erro(_executor text, _erro text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _executor IS NULL OR char_length(_executor) NOT BETWEEN 1 AND 80 THEN
    RETURN false;
  END IF;
  UPDATE public.computador_executores
     SET ultimo_erro = left(_erro, 400),
         ultimo_erro_em = CASE WHEN _erro IS NULL THEN ultimo_erro_em ELSE now() END,
         visto_em = now()
   WHERE nome = _executor;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.computador_tarefa_pegar(uuid, text, text[], text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.computador_executor_erro(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.computador_tarefa_pegar(uuid, text, text[], text, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.computador_executor_erro(text, text) TO service_role;

-- ─── 5) Quem faz computer use no catálogo ────────────────────────────────────────────
-- Só os diretos: o computer use é ferramenta de cada provedor e não passa pelo OpenRouter.
DO $$
BEGIN
  IF to_regclass('public.ia_modelos') IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.ia_modelos
     SET recursos = COALESCE(recursos, '{}'::jsonb) || '{"computer_use": true}'::jsonb
   WHERE id IN ('anthropic:claude-sonnet-5-5', 'anthropic:claude-opus-5-5', 'openai:gpt-6.1-sol', 'openai:gpt-6-astra')
     AND (recursos IS NULL OR NOT (recursos ? 'computer_use') OR recursos->>'computer_use' <> 'true');
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select id, recursos->>'computer_use' from public.ia_modelos where recursos ? 'computer_use';
-- select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'computador_tarefa_pegar';
-- select nome, visto_em, versao, casos, provedores, ultimo_erro from public.computador_executores;
