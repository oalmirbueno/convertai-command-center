-- G-02 (PROPOSTA, NÃO APLICADA): vigia da fila de geração do Estúdio sem painel aberto (14/11/2026)
--
-- ESTE ARQUIVO NÃO É UMA MIGRATION. Fica em docs/ de propósito: não está em supabase/migrations, não entra no
-- manifesto (supabase/migration-manifest.sha256) nem no pacote de produção
-- (supabase/production-migration-baseline.json), e nenhum workflow o aplica. Para virar migration é preciso um
-- lote próprio, com o registro nos dois manifestos, preflight, backup e autorização (AGENTS.md).
--
-- NÃO É PRÉ-REQUISITO do lote "estudio-timeout-watchdog": a função estudio-arte já faz esta mesma limpeza no
-- começo de todo processar_fila (regra em supabase/functions/estudio-arte/fila-de-geracao.ts, decidirPreso), e
-- qualquer painel de equipe aberto chama a função quando vê uma linha presa. Este SQL só cobriria o caso em que
-- NENHUM painel está aberto: um agendamento (pg_cron, a cada 2 minutos) rodaria a mesma regra no banco.
--
-- Conferido em 14/11/2026 num Postgres local em memória (PGlite), junto com a migration G-01 real
-- (20260926050000_fila_de_geracao.sql): 20 casos, entre eles a lâmina 5 da SKC (arte gravada, linha em
-- rodando/gerar, tentativas 0, vai para conferir sem gerar), tentativas esgotadas, abandono, pedido de 12 h e o
-- status do trabalho no fim do lote. Não foi rodado em nenhum banco do Supabase.
--
-- Por que existe: em 14/11 a função morreu por "CPU Time exceeded" um segundo
-- depois de gravar a arte da lâmina 5 da SKC (item 8c7439a3 da fila). A linha
-- ficou "rodando/gerar" com a trava vencida, porque a RPC estudio_fila_pegar só
-- retoma as linhas de quem chamou e ninguém chamou. A regra do G-01 também só
-- cancelava por tempo o que estava em "fila", nunca o que estava em "rodando".
--
-- O que a vigia faz com cada linha "rodando" (nunca gera nada, só muda a linha):
--   - arte nova já gravada neste "gerar" (versões da lâmina > versoes_antes) e a
--     trava venceu, ou a arte tem mais de 60 s: segue para "conferir"; se ninguém
--     vai conferir (abandonada ou passos no teto), fecha como "feito" com aviso;
--   - trava vencida no conferir/corrigir: repete com espera; no teto de tentativas
--     ou no abandono fecha como "feito" com aviso (a arte existe, não vira erro);
--   - trava vencida no gerar/fundo sem arte nova: volta para "fila" com a tentativa
--     contada e espera de 30 s x tentativa; no teto, erro "tentativas_esgotadas";
--     abandonada (trava vencida há mais de 30 min), erro "abandonado".
-- Também tira da fila o pedido esquecido há mais de 12 h (mesma regra da RPC) e,
-- quando o lote do trabalho acaba, tira o status "gerando" do trabalho ("pronto"
-- com todas as lâminas, "dirigido" com lâmina faltando).
--
-- Não muda tabela, coluna, índice, política nem a RPC estudio_fila_pegar.
-- Idempotente. Só service_role (e o agendamento) executa.
--
-- Rollback lógico (nada de dado é perdido):
--   SELECT cron.unschedule('estudio-fila-vigia');
--   DROP FUNCTION IF EXISTS public.estudio_fila_vigiar(integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.estudio_fila_vigiar(
  _graca_segundos integer DEFAULT 60,
  _abandono_segundos integer DEFAULT 1800,
  _espera_segundos integer DEFAULT 30,
  _max_passos integer DEFAULT 24
)
RETURNS TABLE (item_id uuid, trabalho uuid, lamina integer, acao text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f public.estudio_fila;
  _versoes integer;
  _ultima text;
  _corte text;
  _vencida boolean;
  _abandonada boolean;
  _aberto boolean;
  _acao text;
  _fechados uuid[] := ARRAY[]::uuid[];
BEGIN
  -- A mesma trava da pegada: a vigia e a RPC estudio_fila_pegar nunca decidem a mesma linha ao mesmo tempo.
  PERFORM pg_advisory_xact_lock(hashtext('estudio_fila_pegar'));

  -- As versões guardam criado_em em ISO UTC (toISOString): a comparação de texto vale e nenhum cast pode falhar.
  _corte := to_char((now() - make_interval(secs => GREATEST(_graca_segundos, 0))) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  FOR _f IN
    SELECT f.* FROM public.estudio_fila f WHERE f.status = 'rodando' ORDER BY f.atualizado_em FOR UPDATE SKIP LOCKED
  LOOP
    _vencida := _f.trava_ate IS NULL OR _f.trava_ate < now();
    _abandonada := _vencida AND (_f.trava_ate IS NULL OR _f.trava_ate < now() - make_interval(secs => GREATEST(_abandono_segundos, 60)));
    _aberto := _f.etapa = 'gerar' AND _f.versoes_antes IS NOT NULL;
    _acao := NULL;
    _versoes := 0;
    _ultima := NULL;

    IF _aberto THEN
      SELECT count(*)::integer, max(c.versao->>'criado_em')
        INTO _versoes, _ultima
        FROM public.estudio_trabalhos t
        CROSS JOIN LATERAL jsonb_array_elements(t.cards) AS c(versao)
       WHERE t.id = _f.trabalho_id
         AND c.versao->>'ordem' = _f.ordem::text;
    END IF;

    IF _aberto AND _versoes > _f.versoes_antes THEN
      -- A função viva grava a linha logo depois da arte: dentro da folga, espera por ela.
      IF NOT _vencida AND NOT (_ultima IS NOT NULL AND _ultima <= _corte) THEN
        CONTINUE;
      END IF;
      _acao := CASE WHEN _abandonada OR _f.passos + 1 >= _max_passos THEN 'feito_com_arte' ELSE 'conferir' END;
    ELSIF NOT _vencida THEN
      CONTINUE;
    ELSIF _f.etapa IN ('conferir', 'corrigir') THEN
      _acao := CASE WHEN _abandonada OR _f.tentativas + 1 >= _f.max_tentativas THEN 'feito_sem_conferir' ELSE 'repetir' END;
    ELSIF NOT _abandonada AND _f.tentativas + 1 >= _f.max_tentativas THEN
      _acao := 'tentativas_esgotadas';
    ELSIF _abandonada THEN
      _acao := 'abandonado';
    ELSE
      _acao := 'repetir';
    END IF;

    IF _acao = 'conferir' THEN
      UPDATE public.estudio_fila
         SET status = 'fila', etapa = 'conferir', tentativas = 0, passos = _f.passos + 1,
             proxima_em = now(), aviso = NULL, versoes_antes = NULL,
             trava_token = NULL, trava_ate = NULL, atualizado_em = now()
       WHERE id = _f.id;
    ELSIF _acao IN ('feito_com_arte', 'feito_sem_conferir') THEN
      UPDATE public.estudio_fila
         SET status = 'feito',
             aviso = CASE
               WHEN _acao = 'feito_com_arte' THEN 'A arte ficou pronta, mas a função parou antes da conferência (limite do servidor). Confira a lâmina.'
               WHEN _f.etapa = 'conferir' THEN 'Lâmina pronta, mas a conferência parou no servidor. Confira a lâmina.'
               ELSE 'A correção automática parou no servidor. Confira a lâmina.'
             END,
             erro_codigo = NULL, erro_mensagem = NULL, versoes_antes = NULL,
             trava_token = NULL, trava_ate = NULL, concluido_em = now(), atualizado_em = now()
       WHERE id = _f.id;
      _fechados := array_append(_fechados, _f.trabalho_id);
    ELSIF _acao IN ('tentativas_esgotadas', 'abandonado') THEN
      UPDATE public.estudio_fila
         SET status = 'erro',
             erro_codigo = _acao,
             erro_mensagem = CASE
               WHEN _acao = 'tentativas_esgotadas' THEN format('A geração desta lâmina parou %s vezes no servidor (limite de processamento) e nenhuma arte nova foi gravada. Gere de novo.', _f.max_tentativas)
               ELSE 'A geração desta lâmina parou no servidor e ninguém retomou (o painel de quem pediu ficou fechado). Nenhuma arte nova foi gravada. Gere de novo.'
             END,
             trava_token = NULL, trava_ate = NULL, concluido_em = now(), atualizado_em = now()
       WHERE id = _f.id;
      _fechados := array_append(_fechados, _f.trabalho_id);
    ELSE
      UPDATE public.estudio_fila
         SET status = 'fila',
             tentativas = _f.tentativas + 1,
             proxima_em = now() + make_interval(secs => GREATEST(_espera_segundos, 1) * (_f.tentativas + 1)),
             aviso = format('Nova tentativa (%s de %s)', _f.tentativas + 2, _f.max_tentativas),
             trava_token = NULL, trava_ate = NULL, atualizado_em = now()
       WHERE id = _f.id;
    END IF;

    item_id := _f.id;
    trabalho := _f.trabalho_id;
    lamina := _f.ordem;
    acao := _acao;
    RETURN NEXT;
  END LOOP;

  -- Pedido esquecido na fila por mais de 12 h sai dela (mesma regra da RPC estudio_fila_pegar, agora sem painel).
  WITH expirados AS (
    UPDATE public.estudio_fila f
       SET status = 'cancelado', erro_codigo = 'expirou',
           erro_mensagem = 'O pedido ficou na fila tempo demais e saiu dela. Gere de novo.',
           concluido_em = now(), atualizado_em = now()
     WHERE f.status = 'fila' AND f.criado_em < now() - interval '12 hours'
    RETURNING f.trabalho_id
  )
  SELECT _fechados || COALESCE(array_agg(DISTINCT e.trabalho_id), ARRAY[]::uuid[]) INTO _fechados FROM expirados e;

  -- Fim do lote: sem nada na fila, o trabalho não fica "gerando". Com todas as lâminas da direção, "pronto";
  -- com lâmina faltando, "dirigido" (a tela mostra "5 de 7 com arte").
  IF cardinality(_fechados) > 0 THEN
    UPDATE public.estudio_trabalhos t
       SET status = CASE
             WHEN NOT EXISTS (
               SELECT 1
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.direcao->'cards') = 'array' THEN t.direcao->'cards' ELSE '[]'::jsonb END) AS d(card)
                WHERE NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(t.cards) AS c(versao) WHERE c.versao->>'ordem' = d.card->>'ordem'
                )
             ) THEN 'pronto'
             ELSE 'dirigido'
           END
     WHERE t.id = ANY(_fechados)
       AND t.status = 'gerando'
       AND NOT EXISTS (
         SELECT 1 FROM public.estudio_fila f WHERE f.trabalho_id = t.id AND f.status IN ('fila', 'rodando')
       );
  END IF;
  RETURN;
END;
$$;

COMMENT ON FUNCTION public.estudio_fila_vigiar(integer, integer, integer, integer) IS
  'Vigia da fila de geração do Estúdio: resolve linhas presas em "rodando" (função morta por limite de CPU) sem gerar nada. Mesma regra de decidirPreso em estudio-arte/fila-de-geracao.ts. G-02, 14/11/2026.';

REVOKE ALL ON FUNCTION public.estudio_fila_vigiar(integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estudio_fila_vigiar(integer, integer, integer, integer) TO service_role;

-- Agendamento: só é criado quando esta migration for aprovada e aplicada. Sem pg_cron no banco, a função fica
-- disponível e nada é agendado (a estudio-arte segue limpando a fila a cada processar_fila).
DO $migration$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'estudio_fila_vigiar: pg_cron ausente, agendamento nao criado';
    RETURN;
  END IF;
  PERFORM cron.schedule('estudio-fila-vigia', '*/2 * * * *', 'SELECT count(*) FROM public.estudio_fila_vigiar();');
END;
$migration$;
