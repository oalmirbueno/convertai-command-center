-- Laboratório v2 (20/10/2026, pedido do dono): projeto completo, filme da marca e "pôr no ar".
--
-- Contrato: Aceleriq-Laboratorio/ESPEC-LABORATORIO-v2.md. Função: supabase/functions/laboratorio.
--
-- 1) lab_execucoes.tipo aceita os 5 nós novos: pesquisa, oferta, funil, filme, por_no_ar.
-- 2) Semente: os 4 templates oficiais novos (supabase/functions/laboratorio/modulos/templates.ts,
--    TEMPLATES_OFICIAIS_V2), já organizados em colunas por etapa.
-- 3) Pôr no ar pelo mecanismo de aprovações dos operadores (operator_approvals, "ordem autorizada"):
--    o nó por_no_ar só cria o pedido (status 'pendente', payload.origem = 'laboratorio', a tarefa do
--    Kanban SEM vínculo com o agente). Quando o dono aprova pelo operator_approval_decidir de sempre,
--    este gatilho entrega a tarefa ao operador escolhido (operator_assign_task: entra na fila dele) e
--    põe a instrução no diário; a ordem aparece em operator_ordens_abertas e só fecha com prova
--    (operator_ordem_executada). O gatilho também mantém o estado do nó em lab_execucoes
--    (aguardando aprovação → com o agente → feito, ou recusado), que a tela vê ao vivo.
--    Falha na entrega nunca trava a decisão do dono: vira aviso no nó (o no_acompanhar tenta de novo).
--    Nenhuma ação no mundo nasce aqui: publicar, subir anúncio (sempre PAUSADO) ou ligar página é
--    trabalho do agente depois do sim, com evidência.
--
-- Idempotente e só amplia. Nada é apagado.

-- ─── 1) Tipos de nó das execuções ───────────────────────────────────────────
ALTER TABLE public.lab_execucoes DROP CONSTRAINT IF EXISTS lab_execucoes_tipo_check;
ALTER TABLE public.lab_execucoes
  ADD CONSTRAINT lab_execucoes_tipo_check CHECK (tipo IN ('contexto', 'midia', 'config', 'gravity', 'agente', 'copy', 'imagem', 'carrossel', 'logo', 'landing', 'anuncio', 'agente_externo', 'pesquisa', 'oferta', 'funil', 'filme', 'por_no_ar'));

-- Acompanhar o pedido do nó pelo payload (pedido aberto por projeto e nó).
CREATE INDEX IF NOT EXISTS operator_approvals_laboratorio_idx
  ON public.operator_approvals ((payload ->> 'projeto_id'), (payload ->> 'no_id'), created_at DESC)
  WHERE payload ->> 'origem' = 'laboratorio';

-- ─── 2) Pôr no ar: aprovado, a tarefa vai ao operador ───────────────────────
CREATE OR REPLACE FUNCTION public.lab_no_ar_decisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _exec uuid;
  _slug text;
  _nome text;
  _r jsonb;
  _link uuid;
  _erro text;
  _estado text;
  _status text;
  _texto text;
BEGIN
  IF COALESCE(NEW.payload ->> 'origem', '') <> 'laboratorio' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload ->> 'execucao_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    _exec := (NEW.payload ->> 'execucao_id')::uuid;
  END IF;
  SELECT o.slug, o.display_name INTO _slug, _nome FROM public.internal_operators o WHERE o.id = NEW.operator_id;

  -- Aprovado agora: a tarefa entra na fila do operador e a instrução no diário dela.
  IF NEW.status = 'aprovado' AND OLD.status IS DISTINCT FROM 'aprovado'
     AND NEW.task_link_id IS NULL AND NEW.kanban_task_id IS NOT NULL AND NEW.executed_at IS NULL THEN
    BEGIN
      _r := public.operator_assign_task(_slug, NEW.kanban_task_id, 'laboratorio:aprovado', left(NEW.o_que, 500));
      IF COALESCE(_r ->> 'link_id', '') <> '' THEN
        _link := (_r ->> 'link_id')::uuid;
        NEW.task_link_id := _link;
        IF NEW.decided_by IS NOT NULL THEN
          INSERT INTO public.operator_participations
            (task_link_id, kanban_task_id, author_kind, author_id, entry_type, title, body, attachments)
          VALUES
            (_link, NEW.kanban_task_id, 'humano', NEW.decided_by, 'instrucao', 'Pôr no ar (aprovado pelo dono)',
             left(COALESCE(NULLIF(NEW.payload ->> 'instrucao', ''), NEW.o_que), 8000), '[]'::jsonb);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- A decisão do dono vale mesmo assim; o nó mostra o motivo e o no_acompanhar tenta entregar de novo.
      _erro := SQLERRM;
    END;
  END IF;

  -- Estado do nó (a tela vê pelo realtime de lab_execucoes).
  IF _exec IS NOT NULL AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.executed_at IS DISTINCT FROM OLD.executed_at
       OR NEW.task_link_id IS DISTINCT FROM OLD.task_link_id) THEN
    IF NEW.executed_at IS NOT NULL THEN
      _estado := 'feito';
      _status := 'pronto';
      _texto := 'Feito pelo ' || COALESCE(_nome, 'agente') || ', com prova.';
    ELSIF NEW.status IN ('rejeitado', 'alteracoes_pedidas', 'expirado') THEN
      _estado := 'recusado';
      _status := 'erro';
      _texto := 'O dono não aprovou (' || replace(NEW.status, '_', ' ') || ')'
        || COALESCE(': ' || NULLIF(btrim(NEW.decision_note), ''), '') || '. Ajuste e rode o nó de novo.';
    ELSIF NEW.status = 'aprovado' THEN
      _estado := 'com_agente';
      _status := 'aguardando';
      _texto := CASE
        WHEN _erro IS NULL THEN 'Aprovado. Está com o ' || COALESCE(_nome, 'agente') || '; o feito chega com prova.'
        ELSE 'Aprovado, mas a fila do agente recusou a entrega (' || left(_erro, 200) || '). Abra o nó para tentar de novo.'
      END;
    ELSE
      _estado := 'aguardando_aprovacao';
      _status := 'aguardando';
      _texto := 'Aguardando a sua aprovação em Execução (Precisa de você). Nada foi ao ar.';
    END IF;
    UPDATE public.lab_execucoes
       SET status = _status,
           saida = COALESCE(saida, '{}'::jsonb) || jsonb_build_object(
             'estado', _estado,
             'aprovacao_status', NEW.status,
             'texto', _texto,
             'link_id', NEW.task_link_id,
             'prova', COALESCE(NEW.execution_evidence, ''),
             'link_no_ar', COALESCE(substring(NEW.execution_evidence FROM 'https?://[^[:space:])"<>]+'), '')),
           erro = CASE WHEN _status = 'erro' THEN _texto ELSE NULL END,
           finished_at = CASE WHEN _status = 'aguardando' THEN NULL ELSE now() END
     WHERE id = _exec AND tipo = 'por_no_ar';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.lab_no_ar_decisao() FROM PUBLIC, anon, authenticated;

-- "zz_": roda depois das travas do pedido (payload imutável, revisão central).
DROP TRIGGER IF EXISTS zz_lab_no_ar_decisao ON public.operator_approvals;
CREATE TRIGGER zz_lab_no_ar_decisao
  BEFORE UPDATE ON public.operator_approvals
  FOR EACH ROW
  WHEN (NEW.payload ->> 'origem' = 'laboratorio')
  EXECUTE FUNCTION public.lab_no_ar_decisao();

-- ─── 3) Semente: os 4 templates oficiais da v2 ──────────────────────────────
INSERT INTO public.lab_templates (id, nome, descricao, icone, canvas, oficial)
VALUES
  ('6c0a1b10-0000-4000-8000-000000000007'::uuid, 'Produto low ticket do zero', 'Pesquisa na internet, oferta, funil, copy, página de vendas, 3 criativos e anúncio; no fim, o pedido para pôr a página e o anúncio (pausado) no ar com a sua aprovação.', 'shopping-bag', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":120,"dados":{"titulo":"Pedido","texto":"Produto, para quem é, faixa de preço pensada (low ticket, até 97 reais) e o que a pessoa ganha."}},{"id":"pesquisa_1","tipo":"pesquisa","x":80,"y":310,"dados":{"titulo":"Pesquisa de mercado","tema":"Concorrentes, preços praticados, público e ângulos para este produto low ticket."}},{"id":"oferta_1","tipo":"oferta","x":440,"y":120,"dados":{"titulo":"Oferta","instrucao":"Oferta low ticket: preço de entrada, ancoragem, bônus e garantia."}},{"id":"funil_1","tipo":"funil","x":440,"y":310,"dados":{"titulo":"Funil","objetivo":"Venda direta: anúncio, página de vendas e checkout, com upsell."}},{"id":"copy_1","tipo":"copy","x":800,"y":120,"dados":{"titulo":"Copy da página","formato":"landing"}},{"id":"copy_2","tipo":"copy","x":800,"y":310,"dados":{"titulo":"Copy do anúncio","formato":"anuncio"}},{"id":"landing_1","tipo":"landing","x":1160,"y":120,"dados":{"titulo":"Página de vendas","objetivo":"vender o produto low ticket"}},{"id":"gravity_1","tipo":"gravity","x":1520,"y":120,"dados":{"titulo":"Base comum dos criativos","prompt_base":"Criativos de anúncio da mesma família: produto em destaque, uma mensagem curta por arte, cores da marca."}},{"id":"imagem_1","tipo":"imagem","x":1520,"y":310,"dados":{"titulo":"Criativo 1","proporcao":"4:5","quantidade":1}},{"id":"imagem_2","tipo":"imagem","x":1520,"y":500,"dados":{"titulo":"Criativo 2","proporcao":"9:16","quantidade":1}},{"id":"imagem_3","tipo":"imagem","x":1520,"y":690,"dados":{"titulo":"Criativo 3","proporcao":"1:1","quantidade":1}},{"id":"anuncio_1","tipo":"anuncio","x":1880,"y":120,"dados":{"titulo":"Anúncio","objetivo":"vendas"}},{"id":"por_no_ar_1","tipo":"por_no_ar","x":2240,"y":120,"dados":{"titulo":"Publicar a página","alvo":"publicar_site"}},{"id":"por_no_ar_2","tipo":"por_no_ar","x":2240,"y":310,"dados":{"titulo":"Subir o anúncio pausado","alvo":"subir_anuncio_pausado"}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"pesquisa_1"},{"id":"lig_2","de":"contexto_1","para":"oferta_1"},{"id":"lig_3","de":"pesquisa_1","para":"oferta_1"},{"id":"lig_4","de":"pesquisa_1","para":"funil_1"},{"id":"lig_5","de":"oferta_1","para":"funil_1"},{"id":"lig_6","de":"oferta_1","para":"copy_1"},{"id":"lig_7","de":"funil_1","para":"copy_1"},{"id":"lig_8","de":"oferta_1","para":"copy_2"},{"id":"lig_9","de":"copy_1","para":"landing_1"},{"id":"lig_10","de":"oferta_1","para":"landing_1"},{"id":"lig_11","de":"funil_1","para":"landing_1"},{"id":"lig_12","de":"oferta_1","para":"imagem_1"},{"id":"lig_13","de":"oferta_1","para":"imagem_2"},{"id":"lig_14","de":"oferta_1","para":"imagem_3"},{"id":"lig_15","de":"gravity_1","para":"imagem_1"},{"id":"lig_16","de":"gravity_1","para":"imagem_2"},{"id":"lig_17","de":"gravity_1","para":"imagem_3"},{"id":"lig_18","de":"copy_2","para":"anuncio_1"},{"id":"lig_19","de":"oferta_1","para":"anuncio_1"},{"id":"lig_20","de":"imagem_1","para":"anuncio_1"},{"id":"lig_21","de":"imagem_2","para":"anuncio_1"},{"id":"lig_22","de":"imagem_3","para":"anuncio_1"},{"id":"lig_23","de":"landing_1","para":"por_no_ar_1"},{"id":"lig_24","de":"anuncio_1","para":"por_no_ar_2"},{"id":"lig_25","de":"landing_1","para":"por_no_ar_2"},{"id":"lig_26","de":"imagem_1","para":"por_no_ar_2"},{"id":"lig_27","de":"imagem_2","para":"por_no_ar_2"},{"id":"lig_28","de":"imagem_3","para":"por_no_ar_2"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000008'::uuid, 'Funil de vendas completo', 'Pesquisa, oferta e funil guiam a página de captura, a página de vendas, os e-mails, as mensagens de WhatsApp, os criativos e o anúncio; no fim, o pedido para pôr no ar com a sua aprovação.', 'filter', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":120,"dados":{"titulo":"Pedido","texto":"Produto ou serviço, público, preço e o objetivo do funil."}},{"id":"pesquisa_1","tipo":"pesquisa","x":80,"y":310,"dados":{"titulo":"Pesquisa de mercado","tema":"Concorrentes, preços, público, objeções e ângulos deste mercado."}},{"id":"oferta_1","tipo":"oferta","x":440,"y":120,"dados":{"titulo":"Oferta"}},{"id":"funil_1","tipo":"funil","x":440,"y":310,"dados":{"titulo":"Funil","objetivo":"Captura de contato, nutrição por e-mail e WhatsApp, página de vendas e upsell."}},{"id":"copy_1","tipo":"copy","x":800,"y":120,"dados":{"titulo":"Copy da página de captura","formato":"landing","instrucao":"Página curta de captura: promessa, isca, formulário."}},{"id":"copy_2","tipo":"copy","x":800,"y":310,"dados":{"titulo":"Copy da página de vendas","formato":"landing"}},{"id":"copy_3","tipo":"copy","x":800,"y":500,"dados":{"titulo":"Sequência de e-mails","formato":"email","instrucao":"Sequência de 5 e-mails de nutrição até a oferta."}},{"id":"agente_1","tipo":"agente","x":800,"y":690,"dados":{"titulo":"Mensagens de WhatsApp","instrucao":"Escreva 5 mensagens curtas de WhatsApp para quem se cadastrou, da boas-vindas até a oferta, com saída fácil e sem spam."}},{"id":"copy_4","tipo":"copy","x":800,"y":880,"dados":{"titulo":"Copy do anúncio","formato":"anuncio"}},{"id":"landing_1","tipo":"landing","x":1160,"y":120,"dados":{"titulo":"Página de captura","objetivo":"captar contato"}},{"id":"landing_2","tipo":"landing","x":1160,"y":310,"dados":{"titulo":"Página de vendas","objetivo":"vender a oferta"}},{"id":"gravity_1","tipo":"gravity","x":1520,"y":120,"dados":{"titulo":"Base comum dos criativos","prompt_base":"Criativos da mesma família: uma mensagem curta por arte, cores da marca."}},{"id":"imagem_1","tipo":"imagem","x":1520,"y":310,"dados":{"titulo":"Criativo 1","proporcao":"4:5","quantidade":1}},{"id":"imagem_2","tipo":"imagem","x":1520,"y":500,"dados":{"titulo":"Criativo 2","proporcao":"9:16","quantidade":1}},{"id":"anuncio_1","tipo":"anuncio","x":1880,"y":120,"dados":{"titulo":"Anúncio","objetivo":"cadastros"}},{"id":"por_no_ar_1","tipo":"por_no_ar","x":2240,"y":120,"dados":{"titulo":"Publicar as páginas","alvo":"publicar_site"}},{"id":"por_no_ar_2","tipo":"por_no_ar","x":2240,"y":310,"dados":{"titulo":"Subir o anúncio pausado","alvo":"subir_anuncio_pausado"}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"pesquisa_1"},{"id":"lig_2","de":"contexto_1","para":"oferta_1"},{"id":"lig_3","de":"pesquisa_1","para":"oferta_1"},{"id":"lig_4","de":"pesquisa_1","para":"funil_1"},{"id":"lig_5","de":"oferta_1","para":"funil_1"},{"id":"lig_6","de":"oferta_1","para":"copy_1"},{"id":"lig_7","de":"funil_1","para":"copy_1"},{"id":"lig_8","de":"oferta_1","para":"copy_2"},{"id":"lig_9","de":"funil_1","para":"copy_2"},{"id":"lig_10","de":"oferta_1","para":"copy_3"},{"id":"lig_11","de":"funil_1","para":"copy_3"},{"id":"lig_12","de":"oferta_1","para":"agente_1"},{"id":"lig_13","de":"funil_1","para":"agente_1"},{"id":"lig_14","de":"oferta_1","para":"copy_4"},{"id":"lig_15","de":"copy_1","para":"landing_1"},{"id":"lig_16","de":"funil_1","para":"landing_1"},{"id":"lig_17","de":"copy_2","para":"landing_2"},{"id":"lig_18","de":"oferta_1","para":"landing_2"},{"id":"lig_19","de":"oferta_1","para":"imagem_1"},{"id":"lig_20","de":"oferta_1","para":"imagem_2"},{"id":"lig_21","de":"gravity_1","para":"imagem_1"},{"id":"lig_22","de":"gravity_1","para":"imagem_2"},{"id":"lig_23","de":"copy_4","para":"anuncio_1"},{"id":"lig_24","de":"imagem_1","para":"anuncio_1"},{"id":"lig_25","de":"imagem_2","para":"anuncio_1"},{"id":"lig_26","de":"landing_1","para":"por_no_ar_1"},{"id":"lig_27","de":"landing_2","para":"por_no_ar_1"},{"id":"lig_28","de":"anuncio_1","para":"por_no_ar_2"},{"id":"lig_29","de":"landing_1","para":"por_no_ar_2"},{"id":"lig_30","de":"imagem_1","para":"por_no_ar_2"},{"id":"lig_31","de":"imagem_2","para":"por_no_ar_2"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-000000000009'::uuid, 'Montar empresa / marca do zero', 'Pesquisa na internet, posicionamento, logo (o Jev aponta a melhor), página e o post de lançamento; no fim, o pedido para pôr a página e o post no ar com a sua aprovação.', 'building', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":120,"dados":{"titulo":"Ideia do negócio","texto":"O que a empresa faz, para quem, onde atende, e o nome (se já tiver)."}},{"id":"pesquisa_1","tipo":"pesquisa","x":80,"y":310,"dados":{"titulo":"Pesquisa de mercado","tema":"Concorrentes, posicionamentos, preços e público deste mercado na região."}},{"id":"agente_1","tipo":"agente","x":440,"y":120,"dados":{"titulo":"Posicionamento","instrucao":"Defina o posicionamento: para quem, contra quem, a promessa, o tom de voz, 3 sugestões de nome (se faltar) e as palavras que a marca precisa transmitir."}},{"id":"logo_1","tipo":"logo","x":440,"y":310,"dados":{"titulo":"Logo","nome":"","conceito":"","paleta":"","estilo":"minimalista","n":4}},{"id":"copy_1","tipo":"copy","x":440,"y":500,"dados":{"titulo":"Copy da página","formato":"landing"}},{"id":"landing_1","tipo":"landing","x":800,"y":120,"dados":{"titulo":"Página da empresa","objetivo":"apresentar a empresa e captar contato"}},{"id":"config_1","tipo":"config","x":1160,"y":120,"dados":{"titulo":"Formato do post","proporcao":"4:5","quantidade":1,"qualidade":"media"}},{"id":"imagem_1","tipo":"imagem","x":1160,"y":310,"dados":{"titulo":"Post de lançamento","prompt":"Post anunciando a chegada da marca, com a logo."}},{"id":"copy_2","tipo":"copy","x":440,"y":690,"dados":{"titulo":"Legenda do lançamento","formato":"legenda"}},{"id":"por_no_ar_1","tipo":"por_no_ar","x":1520,"y":120,"dados":{"titulo":"Publicar a página","alvo":"publicar_site"}},{"id":"por_no_ar_2","tipo":"por_no_ar","x":1520,"y":310,"dados":{"titulo":"Publicar o post de lançamento","alvo":"outro","instrucao":"Publicar o post de lançamento no Instagram da marca, com a legenda ligada."}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"pesquisa_1"},{"id":"lig_2","de":"contexto_1","para":"agente_1"},{"id":"lig_3","de":"pesquisa_1","para":"agente_1"},{"id":"lig_4","de":"agente_1","para":"logo_1"},{"id":"lig_5","de":"contexto_1","para":"logo_1"},{"id":"lig_6","de":"agente_1","para":"copy_1"},{"id":"lig_7","de":"copy_1","para":"landing_1"},{"id":"lig_8","de":"agente_1","para":"landing_1"},{"id":"lig_9","de":"logo_1","para":"landing_1"},{"id":"lig_10","de":"agente_1","para":"imagem_1"},{"id":"lig_11","de":"logo_1","para":"imagem_1"},{"id":"lig_12","de":"config_1","para":"imagem_1"},{"id":"lig_13","de":"agente_1","para":"copy_2"},{"id":"lig_14","de":"landing_1","para":"por_no_ar_1"},{"id":"lig_15","de":"logo_1","para":"por_no_ar_1"},{"id":"lig_16","de":"imagem_1","para":"por_no_ar_2"},{"id":"lig_17","de":"copy_2","para":"por_no_ar_2"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true),
  ('6c0a1b10-0000-4000-8000-00000000000a'::uuid, 'Filme da marca', 'O contexto da marca vira o filme cinematográfico: 3 storyboards, você escolhe um no nó e ele renderiza. Precisa de cliente (usa a marca dele).', 'clapperboard', '{"nos":[{"id":"contexto_1","tipo":"contexto","x":80,"y":120,"dados":{"titulo":"Contexto da marca","texto":"O que a marca é, para quem, a promessa e o sentimento que o filme precisa deixar."}},{"id":"filme_1","tipo":"filme","x":440,"y":120,"dados":{"titulo":"Filme da marca","ideia":"","formato":"ambos"}}],"ligacoes":[{"id":"lig_1","de":"contexto_1","para":"filme_1"}],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, true)
ON CONFLICT (id) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    icone = EXCLUDED.icone,
    canvas = EXCLUDED.canvas,
    oficial = true;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select count(*) from public.lab_templates where oficial;  -- 10
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'lab_execucoes_tipo_check';  -- tem por_no_ar
-- select tgname from pg_trigger where tgrelid = 'public.operator_approvals'::regclass and tgname = 'zz_lab_no_ar_decisao';
