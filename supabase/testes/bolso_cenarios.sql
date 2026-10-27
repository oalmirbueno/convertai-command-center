-- Cenários do Aceleriq de Bolso no banco, SEMPRE dentro de uma transação
-- desfeita no fim (ROLLBACK). Usuários sintéticos A, B e ADMIN só existem
-- aqui. Rodar com: node scripts/bolso-testar-banco.mjs (monta migration +
-- este arquivo + ROLLBACK e manda pelo supabase db query).
--
-- Cada verificação grava uma linha em pg_temp.r; o SELECT final mostra tudo.
-- Uma linha com ok=false é falha.

CREATE TEMP TABLE r (n serial, teste text, ok boolean, detalhe text);
GRANT ALL ON r TO PUBLIC;
GRANT ALL ON SEQUENCE r_n_seq TO PUBLIC;

-- Identidades sintéticas.
INSERT INTO auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bolso-teste-a@exemplo.invalid', now(), 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bolso-teste-b@exemplo.invalid', now(), 'authenticated', 'authenticated', '{}', '{}', now(), now()),
  ('cccccccc-0000-4000-8000-000000000003', 'bolso-teste-admin@exemplo.invalid', now(), 'authenticated', 'authenticated', '{}', '{}', now(), now());
DELETE FROM public.user_roles WHERE user_id IN ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'client'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'client'),
  ('cccccccc-0000-4000-8000-000000000003', 'admin');

CREATE FUNCTION pg_temp.ok(_teste text, _ok boolean, _detalhe text DEFAULT NULL) RETURNS void LANGUAGE sql AS
$$ INSERT INTO pg_temp.r (teste, ok, detalhe) VALUES (_teste, COALESCE(_ok, false), _detalhe) $$;

-- Espera erro: roda o SQL e confere que falhou com a mensagem esperada.
CREATE FUNCTION pg_temp.falha(_teste text, _sql text, _trecho text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  PERFORM pg_temp.ok(_teste, false, 'passou sem erro');
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.ok(_teste, position(lower(_trecho) IN lower(SQLERRM)) > 0, SQLERRM);
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;
SELECT set_config('bolso.licencas_antes', (SELECT count(*) FROM public.membros_licencas)::text, true);

-- ─── ADMIN: chaves, política de teste, créditos de teste para A ───────
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT pg_temp.ok('config nasce desligada', (SELECT (c ->> 'modulo_exposto')::boolean = false AND (c ->> 'geracao_real')::boolean = false
  AND (c ->> 'pagamentos')::boolean = false AND (c ->> 'modo_simulado')::boolean = false AND (c -> 'limites') = 'null'::jsonb
  FROM (SELECT public.bolso_admin_visao() -> 'config' c) x));
SELECT pg_temp.falha('geração real sem política aprovada é recusada', $$SELECT public.bolso_admin_config('{"geracao_real":true}')$$, 'política comercial aprovada');
SELECT pg_temp.falha('política incompleta é recusada', $$SELECT public.bolso_admin_politica_criar('{"creditos_iniciais":5}', true)$$, 'Política sem');
SELECT public.bolso_admin_config('{"modo_simulado":true}');

DO $$ DECLARE pol uuid; BEGIN
  pol := public.bolso_admin_politica_criar('{"creditos_iniciais":5,"tarifa_texto":1,"tarifa_imagem":2,"validade_meses":12,"formatos":["feed_1x1","feed_4x5"]}', true, 'TESTE');
  PERFORM set_config('bolso.pol_teste', pol::text, true);
END $$;
SELECT pg_temp.falha('acesso real com política de teste é recusado',
  format($$SELECT public.bolso_admin_conceder('aaaaaaaa-0000-4000-8000-000000000001', 'anual', %L, 'manual-1')$$, current_setting('bolso.pol_teste')), 'política comercial aprovada');
SELECT public.bolso_admin_conceder('aaaaaaaa-0000-4000-8000-000000000001', 'teste', current_setting('bolso.pol_teste')::uuid, 'teste-a');
SELECT pg_temp.falha('mesma referência não concede duas vezes',
  format($$SELECT public.bolso_admin_conceder('aaaaaaaa-0000-4000-8000-000000000001', 'teste', %L, 'teste-a')$$, current_setting('bolso.pol_teste')), 'já foi usada');

-- ─── A: sem limites configurados, nada é pedido ────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.ok('A vê o estúdio em modo simulado com 5 créditos de teste',
  (SELECT e ->> 'modo' = 'simulado' AND e ->> 'carteira' = 'teste' AND (e -> 'saldo' ->> 'disponivel')::int = 5 FROM (SELECT public.bolso_estado() e) x));
SELECT pg_temp.falha('campanha exige marca', $$SELECT public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Bolo"}}')$$, 'Cadastre a marca');
SELECT pg_temp.falha('marca exige confirmação de direitos', $$SELECT public.bolso_marca_salvar('{"nome":"Doceria A"}')$$, 'Confirme');
SELECT public.bolso_marca_salvar('{"nome":"Doceria A","descricao":"Bolos caseiros","cores":["#0F172A","nao-cor"],"direitos_confirmados":true}');
SELECT pg_temp.ok('cor inválida descartada', (SELECT public.bolso_marca_ler() -> 'cores' = '["#0F172A"]'::jsonb));
SELECT pg_temp.falha('briefing sem produto pede complemento', $$SELECT public.bolso_campanha_salvar('{"briefing":{"tipo":"venda"}}')$$, 'produto ou serviço');
DO $$ BEGIN PERFORM set_config('bolso.camp_a', public.bolso_campanha_salvar('{"briefing":{"tipo":"venda","produto":"Bolo de pote","cta":"Peça no direct"}}')::text, true); END $$;
SELECT pg_temp.ok('briefing não inventa preço', (SELECT public.bolso_campanha_ler(current_setting('bolso.camp_a')::uuid) -> 'briefing' ->> 'condicoes' = ''));
SELECT pg_temp.falha('sem limites configurados o pedido é bloqueado',
  format($$SELECT public.bolso_pedir(%L, 'texto', NULL, 'chave-0001', 1)$$, current_setting('bolso.camp_a')), 'limites');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT public.bolso_admin_config('{"limites":{"paralelo_por_usuario":1,"pedidos_por_dia_usuario":20,"teto_global_dia":100}}');

-- ─── A: pedido de texto, idempotência e custo visto ────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.falha('custo diferente do mostrado é recusado',
  format($$SELECT public.bolso_pedir(%L, 'texto', NULL, 'chave-0001', 3)$$, current_setting('bolso.camp_a')), 'custo mudou');
DO $$ DECLARE r1 jsonb; r2 jsonb; BEGIN
  r1 := public.bolso_pedir(current_setting('bolso.camp_a')::uuid, 'texto', NULL, 'chave-0001', 1);
  r2 := public.bolso_pedir(current_setting('bolso.camp_a')::uuid, 'texto', NULL, 'chave-0001', 1);
  PERFORM set_config('bolso.job1', r1 ->> 'job_id', true);
  PERFORM pg_temp.ok('repetir a mesma chave devolve o mesmo job', r1 ->> 'job_id' = r2 ->> 'job_id' AND (r2 ->> 'repetido')::boolean, r2::text);
  PERFORM pg_temp.ok('pedido simulado identificado', r1 ->> 'provedor' = 'simulado');
END $$;
SELECT pg_temp.falha('mesma chave com outro pedido é recusada',
  format($$SELECT public.bolso_pedir(%L, 'imagem', 'feed_1x1', 'chave-0001', 2)$$, current_setting('bolso.camp_a')), 'já foi usada');
SELECT pg_temp.ok('reserva separa disponível e reservado', (SELECT (s ->> 'disponivel')::int = 4 AND (s ->> 'reservado')::int = 1
  FROM (SELECT public.bolso_estado() -> 'saldo' s) x));
SELECT pg_temp.falha('limite de pedidos em paralelo', format($$SELECT public.bolso_pedir(%L, 'texto', NULL, 'chave-0002', 1)$$, current_setting('bolso.camp_a')), 'Espere');
SELECT pg_temp.falha('membro não chama o trabalhador', $$SELECT public.bolso_trabalho_pegar()$$, 'permission denied');
SELECT pg_temp.falha('membro não altera a configuração', $$SELECT public.bolso_admin_config('{"kill_switch":false}')$$, 'Somente administração');
SELECT pg_temp.falha('membro não lê tabela direto', $$SELECT * FROM public.bolso_jobs$$, 'permission denied');
SELECT pg_temp.falha('membro não lê o extrato direto', $$SELECT * FROM public.bolso_creditos$$, 'permission denied');

-- ─── B: isolamento ─────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT pg_temp.ok('B sem acesso não vê o estúdio fechado... mas o modo simulado está ligado só para admin e teste',
  (SELECT e ->> 'exposto' = 'false' FROM (SELECT public.bolso_estado() e) x));
SELECT pg_temp.falha('B não lê a campanha de A', format($$SELECT public.bolso_campanha_ler(%L)$$, current_setting('bolso.camp_a')), 'não encontrada');
SELECT pg_temp.falha('B não cria versão na campanha de A', format($$SELECT public.bolso_versao_salvar(%L, '{"texto":"x"}')$$, current_setting('bolso.camp_a')), 'não encontrada');
SELECT pg_temp.falha('B não cancela o job de A', format($$SELECT public.bolso_cancelar(%L)$$, current_setting('bolso.job1')), 'não encontrado');
SELECT pg_temp.ok('B não vê arquivos de A no storage', (SELECT count(*) = 0 FROM storage.objects WHERE bucket_id = 'bolso'));
SELECT public.bolso_marca_salvar('{"nome":"Loja B","direitos_confirmados":true}');
DO $$ BEGIN PERFORM set_config('bolso.camp_b', public.bolso_campanha_salvar('{"briefing":{"tipo":"orcamento","produto":"Reforma"}}')::text, true); END $$;
SELECT pg_temp.falha('B sem direito não pede', format($$SELECT public.bolso_pedir(%L, 'texto', NULL, 'chave-b-001', 1)$$, current_setting('bolso.camp_b')), 'ainda não está disponível');
SELECT pg_temp.ok('B não vê campanhas de A na lista', (SELECT jsonb_array_length(public.bolso_campanhas_listar()) = 1));

-- ─── Trabalhador: concluir uma vez, resposta atrasada ignorada ────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
DO $$ DECLARE t jsonb; c1 jsonb; c2 jsonb; BEGIN
  t := public.bolso_trabalho_pegar(current_setting('bolso.job1')::uuid);
  PERFORM pg_temp.ok('trabalhador pega o job com a marca e o briefing do dono', t -> 'marca' ->> 'nome' = 'Doceria A' AND t -> 'briefing' ->> 'produto' = 'Bolo de pote', t::text);
  c1 := public.bolso_trabalho_concluir(current_setting('bolso.job1')::uuid, (t -> 'job' ->> 'tentativa')::int,
    '{"mensagem":"[SIMULADO] m","texto":"[SIMULADO] t","cta":"Peça no direct"}');
  c2 := public.bolso_trabalho_concluir(current_setting('bolso.job1')::uuid, (t -> 'job' ->> 'tentativa')::int,
    '{"mensagem":"de novo","texto":"de novo"}');
  PERFORM pg_temp.ok('concluir aceita uma vez e recusa a resposta repetida', (c1 ->> 'aceito')::boolean AND NOT (c2 ->> 'aceito')::boolean);
END $$;
RESET ROLE;
SELECT pg_temp.ok('captura uma vez só', (SELECT count(*) = 1 FROM public.bolso_creditos WHERE job_id = current_setting('bolso.job1')::uuid AND tipo = 'captura'));
SELECT pg_temp.ok('versão simulada criada e escolhida', (SELECT count(*) = 1 FROM public.bolso_campanha_versoes WHERE campanha_id = current_setting('bolso.camp_a')::uuid AND origem = 'simulada')
  AND (SELECT versao_escolhida = 1 FROM public.bolso_campanhas WHERE id = current_setting('bolso.camp_a')::uuid));
SELECT pg_temp.falha('extrato não se altera', format($$UPDATE public.bolso_creditos SET quantidade = 99 WHERE job_id = %L$$, current_setting('bolso.job1')), 'não muda');
SELECT pg_temp.falha('extrato não se apaga', format($$DELETE FROM public.bolso_creditos WHERE job_id = %L$$, current_setting('bolso.job1')), 'não muda');

-- ─── A: arte que falha devolve os créditos uma vez ─────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.falha('formato fora do acesso', format($$SELECT public.bolso_pedir(%L, 'imagem', 'stories_9x16', 'chave-0003', 2)$$, current_setting('bolso.camp_a')), 'Formato não incluído');
DO $$ BEGIN PERFORM set_config('bolso.job2', public.bolso_pedir(current_setting('bolso.camp_a')::uuid, 'imagem', 'feed_1x1', 'chave-0004', 2) ->> 'job_id', true); END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
DO $$ DECLARE t jsonb; f1 jsonb; f2 jsonb; BEGIN
  t := public.bolso_trabalho_pegar(current_setting('bolso.job2')::uuid);
  PERFORM pg_temp.falha('arquivo fora da pasta do dono é recusado',
    format($q$SELECT public.bolso_trabalho_concluir(%L, %s, '{}', '{"caminho":"bbbbbbbb-0000-4000-8000-000000000002/x/y.png","mime":"image/png","bytes":10}')$q$,
      current_setting('bolso.job2'), t -> 'job' ->> 'tentativa'), 'fora da pasta');
  f1 := public.bolso_trabalho_falhar(current_setting('bolso.job2')::uuid, (t -> 'job' ->> 'tentativa')::int, 'fornecedor recusou', true);
  f2 := public.bolso_trabalho_falhar(current_setting('bolso.job2')::uuid, (t -> 'job' ->> 'tentativa')::int, 'de novo', true);
  PERFORM pg_temp.ok('falha definitiva fecha uma vez', f1 ->> 'estado' = 'falhou' AND NOT (f2 ->> 'aceito')::boolean);
END $$;
RESET ROLE;
SELECT pg_temp.ok('falha libera a reserva uma vez e não captura', (SELECT count(*) FILTER (WHERE tipo = 'liberacao') = 1 AND count(*) FILTER (WHERE tipo = 'captura') = 0
  FROM public.bolso_creditos WHERE job_id = current_setting('bolso.job2')::uuid));

SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('saldo depois de 1 texto usado e 1 arte devolvida', (SELECT (s ->> 'disponivel')::int = 4 AND (s ->> 'reservado')::int = 0
  FROM (SELECT public.bolso_estado() -> 'saldo' s) x));
SELECT pg_temp.ok('edição manual não cobra crédito', public.bolso_versao_salvar(current_setting('bolso.camp_a')::uuid, '{"texto":"Texto revisado à mão","mensagem":"m"}') = 2
  AND (SELECT (public.bolso_estado() -> 'saldo' ->> 'disponivel')::int = 4));
-- Cancelar antes de começar devolve; cancelado não volta.
DO $$ DECLARE j uuid; BEGIN
  j := (public.bolso_pedir(current_setting('bolso.camp_a')::uuid, 'imagem', 'feed_4x5', 'chave-0005', 2) ->> 'job_id')::uuid;
  PERFORM public.bolso_cancelar(j);
  PERFORM set_config('bolso.job3', j::text, true);
END $$;
SELECT pg_temp.falha('cancelado não cancela de novo', format($$SELECT public.bolso_cancelar(%L)$$, current_setting('bolso.job3')), 'já começou');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('trabalhador não pega job cancelado', public.bolso_trabalho_pegar(current_setting('bolso.job3')::uuid) IS NULL);
RESET ROLE;

-- Saldo insuficiente: gasta tudo e o próximo é recusado.
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.bolso_admin_config('{"limites":{"paralelo_por_usuario":5,"pedidos_por_dia_usuario":20,"teto_global_dia":100}}');
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.bolso_pedir(current_setting('bolso.camp_a')::uuid, 'imagem', 'feed_1x1', 'chave-0006', 2);
SELECT public.bolso_pedir(current_setting('bolso.camp_a')::uuid, 'imagem', 'feed_4x5', 'chave-0007', 2);
SELECT pg_temp.falha('saldo insuficiente bloqueia sem ficar negativo', format($$SELECT public.bolso_pedir(%L, 'texto', NULL, 'chave-0008', 1)$$, current_setting('bolso.camp_a')), 'Saldo insuficiente');
SELECT pg_temp.ok('saldo nunca negativo', (SELECT (s ->> 'disponivel')::int = 0 AND (s ->> 'reservado')::int = 4 FROM (SELECT public.bolso_estado() -> 'saldo' s) x));
SELECT pg_temp.ok('sem saldo a consulta continua', (SELECT jsonb_array_length(public.bolso_campanha_ler(current_setting('bolso.camp_a')::uuid) -> 'versoes') = 2));

-- Pausa geral: bloqueia pedidos novos, a leitura continua.
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT public.bolso_admin_config('{"kill_switch":true}');
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT pg_temp.falha('pausa bloqueia pedido novo', format($$SELECT public.bolso_pedir(%L, 'texto', NULL, 'chave-0009', 1)$$, current_setting('bolso.camp_a')), 'pausado');
SELECT pg_temp.ok('pausa mantém a consulta', (SELECT public.bolso_estado() ->> 'modo' = 'pausado') AND jsonb_array_length(public.bolso_campanhas_listar()) = 1);
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('pausa: trabalhador não pega nada novo', public.bolso_trabalho_pegar() IS NULL);
RESET ROLE;

-- Vencimento: créditos de direito vencido expiram uma vez.
INSERT INTO public.bolso_direitos (id, user_id, tipo, carteira, origem, referencia, politica_id, inicio, fim)
VALUES ('dddddddd-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000002', 'teste', 'teste', 'teste', 'vencido-b',
  current_setting('bolso.pol_teste')::uuid, now() - interval '13 months', now() - interval '1 month');
INSERT INTO public.bolso_creditos (user_id, direito_id, carteira, tipo, quantidade, delta_disponivel, delta_reservado, descricao)
VALUES ('bbbbbbbb-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000004', 'teste', 'concessao', 3, 3, 0, 'TESTE vencido');
SELECT set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.bolso_extrato(); SELECT public.bolso_extrato();
RESET ROLE;
SELECT pg_temp.ok('vencido expira uma vez', (SELECT count(*) = 1 AND sum(quantidade) = 3 FROM public.bolso_creditos WHERE direito_id = 'dddddddd-0000-4000-8000-000000000004' AND tipo = 'expiracao'));

-- ─── Eventos de pagamento (sintéticos) ─────────────────────────────────
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('pagamentos desligados: só guarda', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e0","tipo":"aprovado","produto":"anual","referencia":"P0","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:00:00Z"}') LIKE 'guardado%');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.bolso_admin_config('{"pagamentos":true,"kill_switch":false}');
DO $$ DECLARE pol uuid; BEGIN
  pol := public.bolso_admin_politica_criar('{"creditos_iniciais":10,"tarifa_texto":1,"tarifa_imagem":3,"validade_meses":12,"formatos":["feed_1x1"]}', false, 'TESTE de cenário');
  PERFORM public.bolso_admin_politica_aprovar(pol);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('aprovado concede uma vez', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e1","tipo":"aprovado","produto":"anual","referencia":"P1","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:00:00Z"}') = 'concedido');
SELECT pg_temp.ok('evento repetido não concede de novo', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e1","tipo":"aprovado","produto":"anual","referencia":"P1","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:00:00Z"}') = 'repetido');
SELECT pg_temp.falha('mesmo evento com conteúdo diferente é recusado', $$SELECT public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e1","tipo":"aprovado","produto":"anual","referencia":"P9","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:00:00Z"}')$$, 'conteúdo diferente');
SELECT pg_temp.ok('outro evento da mesma compra não duplica o direito', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e1b","tipo":"aprovado","produto":"anual","referencia":"P1","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:01:00Z"}') LIKE 'repetido%');
SELECT pg_temp.ok('mensal concedido à parte', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e2","tipo":"aprovado","produto":"mensal","referencia":"M1","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:00:00Z"}') = 'concedido');
SELECT pg_temp.ok('cancelar o mensal não mexe no anual', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e3","tipo":"assinatura_cancelada","produto":"mensal","referencia":"M1","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-27T12:00:00Z"}') LIKE 'registrado%');
SELECT pg_temp.ok('reembolso fora de ordem chega antes', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e4","tipo":"reembolsado","produto":"anual","referencia":"P2","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T13:00:00Z"}') LIKE 'guardado%');
SELECT pg_temp.ok('aprovação tardia de compra reembolsada não ativa', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e5","tipo":"aprovado","produto":"anual","referencia":"P2","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-26T12:00:00Z"}') LIKE 'ignorado%');
SELECT pg_temp.ok('chargeback revoga e estorna o que sobrou', public.bolso_evento_pagamento('{"provedor":"teste","evento_id":"e6","tipo":"chargeback","produto":"anual","referencia":"P1","user_id":"bbbbbbbb-0000-4000-8000-000000000002","ocorrido_em":"2026-10-28T12:00:00Z"}') = 'revogado');
RESET ROLE;
SELECT pg_temp.ok('estorno do chargeback = créditos do anual', (SELECT sum(c.quantidade) = 10 FROM public.bolso_creditos c JOIN public.bolso_direitos d ON d.id = c.direito_id
  WHERE d.referencia = 'P1' AND c.tipo = 'estorno'));
SELECT pg_temp.ok('mensal continua ativo depois do chargeback do anual', (SELECT count(*) = 1 FROM public.bolso_direitos WHERE referencia = 'M1' AND revogado_em IS NULL));
SELECT pg_temp.ok('licenças antigas do CRM intactas', (SELECT count(*) FROM public.membros_licencas)::text = current_setting('bolso.licencas_antes'));
SELECT pg_temp.falha('membro não envia evento de pagamento', $$SET LOCAL ROLE authenticated; SELECT public.bolso_evento_pagamento('{}')$$, 'permission denied');
RESET ROLE;

SELECT n, ok, teste, left(detalhe, 160) AS detalhe FROM pg_temp.r ORDER BY n;
