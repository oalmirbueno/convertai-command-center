-- Conferência do cérebro e do dossiê bidirecional SEM alterar nada.
-- Rodar DEPOIS de 01 e 02. Tudo entre BEGIN e ROLLBACK: o SQL Editor não
-- mostra NOTICE, então o resultado sai como SELECT da tabela temporária.
-- Troque o id abaixo por um cliente real com dossiê geral atual.

BEGIN;

CREATE TEMP TABLE _conferencia (passo text, ok boolean, detalhe text) ON COMMIT DROP;

DO $$
DECLARE
  _cliente uuid := '00000000-0000-0000-0000-000000000000'; -- troque
  _id uuid;
  _n integer;
BEGIN
  -- 1) Colunas novas e agente 'geral'
  INSERT INTO public.agente_memoria (client_id, agente, tipo, texto, origem, area, categoria, chave, fonte, reforcos)
  VALUES (_cliente, 'geral', 'preferencia', 'Teste do cérebro: fundo claro', 'manual', 'geral', 'preferencia', 'teste do cerebro fundo claro', 'conferencia', 1)
  RETURNING id INTO _id;
  INSERT INTO _conferencia VALUES ('agente geral e colunas novas aceitos', _id IS NOT NULL, _id::text);

  -- 2) Chave ativa única: a mesma frase não entra duas vezes
  BEGIN
    INSERT INTO public.agente_memoria (client_id, agente, tipo, texto, origem, chave)
    VALUES (_cliente, 'geral', 'preferencia', 'Teste do cérebro: fundo claro!', 'manual', 'teste do cerebro fundo claro');
    INSERT INTO _conferencia VALUES ('chave ativa única', false, 'a duplicata entrou');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _conferencia VALUES ('chave ativa única', true, 'duplicata recusada');
  END;

  -- 3) Validade: vencido é desligado
  UPDATE public.agente_memoria SET valido_ate = now() - interval '1 minute' WHERE id = _id;
  _n := public.cerebro_desligar_vencidos();
  INSERT INTO _conferencia VALUES ('vencido desligado', NOT (SELECT ativa FROM public.agente_memoria WHERE id = _id), _n || ' linha(s)');

  -- 4) O gatilho do aprendizado só enfileirou (não reescreveu o dossiê)
  INSERT INTO _conferencia
  SELECT 'aprendizado enfileirou o dossiê', EXISTS (SELECT 1 FROM app_private.dossie_fila WHERE client_id = _cliente), coalesce(max(motivo), 'sem fila')
    FROM app_private.dossie_fila WHERE client_id = _cliente;

  -- 5) Movimentos das mesas aparecem para a equipe e nunca para o cliente
  INSERT INTO _conferencia
  SELECT 'movimentos das mesas na leitura interna', count(*) > 0, count(*) || ' linha(s) das mesas em 14 dias'
    FROM public.movimentos_do_cliente(_cliente, now() - interval '14 days', now(), false)
   WHERE origem IN ('mesa_campanhas', 'calendario_propostas', 'ads_briefings', 'ads_ofertas', 'ads_planos', 'ads_criativos', 'ads_aprendizados', 'cliente_imagens', 'agente_memoria');
  INSERT INTO _conferencia
  SELECT 'nada das mesas na leitura do cliente', count(*) = 0, count(*) || ' linha(s)'
    FROM public.movimentos_do_cliente(_cliente, now() - interval '14 days', now(), true)
   WHERE origem IN ('mesa_campanhas', 'calendario_propostas', 'ads_briefings', 'ads_ofertas', 'ads_planos', 'ads_criativos', 'ads_aprendizados', 'cliente_imagens', 'agente_memoria');

  -- 6) O texto do dossiê monta com as linhas novas (sem gravar)
  INSERT INTO _conferencia
  SELECT 'texto dos avanços monta', length(t) > 0, left(t, 300)
    FROM (SELECT public.dossie_avancos_texto(_cliente, 14) AS t) x;
END $$;

SELECT * FROM _conferencia;

ROLLBACK;
