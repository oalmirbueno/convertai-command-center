-- TESTE DE PONTA A PONTA DO DOSSIE - NAO ALTERA NADA.
--
-- Cole inteiro no SQL Editor do Lovable Cloud (Backend -> SQL) e execute.
-- Tudo roda dentro de uma transacao que termina em ROLLBACK: ao final o
-- banco fica EXATAMENTE como estava. Nenhum dossie e alterado de verdade.
--
-- O resultado sai como uma TABELA no final (coluna "resultado"), com
-- PASSOU ou FALHOU em cada verificacao:
--   1. gravar com a versao correta cria a versao seguinte
--   2. a versao anterior vira historico (superseded), nao e apagada
--   3. gravar com uma versao ANTIGA e BLOQUEADO  <- o coracao do pedido
--   4. a mesma idempotency_key nao grava duas vezes

BEGIN;

CREATE TEMP TABLE _resultado_teste (
  ordem integer,
  verificacao text,
  detalhe text,
  resultado text
) ON COMMIT DROP;

DO $$
DECLARE
  _cliente uuid;
  _nome text;
  _v_inicial integer;
  _v_depois integer;
  _historico integer;
  _bloqueou boolean := false;
  _erro text := '';
  _replay_id uuid;
  _primeiro_id uuid;
  _reg public.client_dossiers%rowtype;
BEGIN
  -- Escolhe um cliente que ja tenha dossie. Preferencia para a Verzelo.
  SELECT d.client_id, coalesce(p.company_name, p.full_name, 'sem nome')
    INTO _cliente, _nome
  FROM public.client_dossiers d
  JOIN public.profiles p ON p.id = d.client_id
  WHERE d.is_current AND d.project_id IS NULL AND d.dossier_type = 'contexto'
  ORDER BY (coalesce(p.company_name, p.full_name) ILIKE '%verzelo%') DESC,
           d.updated_at DESC
  LIMIT 1;

  IF _cliente IS NULL THEN
    INSERT INTO _resultado_teste VALUES
      (0, 'pre-requisito', 'nenhum dossie atual encontrado',
       'FALHOU - a migration foi aplicada?');
    RETURN;
  END IF;

  SELECT version INTO _v_inicial
  FROM public.client_dossiers
  WHERE client_id = _cliente AND is_current AND project_id IS NULL
    AND dossier_type = 'contexto';

  INSERT INTO _resultado_teste VALUES
    (0, 'cliente do teste', _nome || ' (versao atual: ' || _v_inicial || ')', 'ok');

  -- (1) Gravar com a versao correta deve criar a versao seguinte.
  _reg := public.upsert_current_dossier(
    _cliente,
    'TESTE AUTOMATICO - desfeito pelo rollback.',
    'contexto', NULL,
    'teste de nao regressao',
    'validacao do ciclo completo apos deploy 1.18.0',
    'teste-sql', 'teste', '{}'::text[], '{}'::jsonb,
    'teste-correlation', 'teste-idem-001',
    _v_inicial
  );
  _v_depois := _reg.version;
  _primeiro_id := _reg.id;

  INSERT INTO _resultado_teste VALUES
    (1, 'versao avanca ao gravar',
     'de v' || _v_inicial || ' para v' || _v_depois,
     CASE WHEN _v_depois = _v_inicial + 1 THEN 'PASSOU' ELSE 'FALHOU' END);

  -- (2) A versao anterior virou historico, e continua no banco.
  SELECT count(*) INTO _historico
  FROM public.client_dossiers
  WHERE client_id = _cliente AND dossier_type = 'contexto' AND project_id IS NULL;

  INSERT INTO _resultado_teste VALUES
    (2, 'historico preservado',
     _historico || ' versoes no total, a anterior marcada como superseded',
     CASE WHEN _historico >= 2 THEN 'PASSOU' ELSE 'FALHOU' END);

  -- (3) O TESTE PRINCIPAL: gravar com a versao ANTIGA deve ser bloqueado.
  BEGIN
    PERFORM public.upsert_current_dossier(
      _cliente,
      'ESTA GRAVACAO NAO PODE PASSAR - usa uma versao velha.',
      'contexto', NULL, NULL,
      'tentativa de regressao',
      'teste-sql', 'teste', '{}'::text[], '{}'::jsonb,
      'teste-correlation-2', 'teste-idem-002',
      _v_inicial          -- <-- versao ANTIGA de proposito
    );
  EXCEPTION WHEN others THEN
    _erro := SQLERRM;
    IF SQLERRM LIKE '%version_conflict%' THEN
      _bloqueou := true;
    END IF;
  END;

  INSERT INTO _resultado_teste VALUES
    (3, 'gravacao com versao antiga e BLOQUEADA',
     CASE WHEN _bloqueou THEN 'recusada com version_conflict'
          ELSE coalesce(nullif(_erro, ''), 'a gravacao PASSOU - regressao possivel') END,
     CASE WHEN _bloqueou THEN 'PASSOU' ELSE 'FALHOU' END);

  -- (4) Mesma idempotency_key devolve o registro ja gravado.
  SELECT id INTO _replay_id FROM public.upsert_current_dossier(
    _cliente, 'texto diferente, mesma chave', 'contexto', NULL, NULL,
    'teste de idempotencia', 'teste-sql', 'teste', '{}'::text[], '{}'::jsonb,
    'teste-correlation-3', 'teste-idem-001',   -- <-- chave repetida
    NULL
  );

  INSERT INTO _resultado_teste VALUES
    (4, 'idempotency_key repetida nao grava de novo',
     CASE WHEN _replay_id = _primeiro_id THEN 'devolveu o mesmo registro'
          ELSE 'criou um registro NOVO' END,
     CASE WHEN _replay_id = _primeiro_id THEN 'PASSOU' ELSE 'FALHOU' END);
END $$;

SELECT ordem, verificacao, detalhe, resultado
FROM _resultado_teste
ORDER BY ordem;

ROLLBACK;
