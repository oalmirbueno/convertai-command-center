-- Lembrete de aprovação no grupo do cliente e régua de cobrança com um clique (27/10/2026).
--
-- Análise de 26/10: aprovação do cliente com mediana de 30 h e 20% passando de 137 h; 13 peças esperando o
-- cliente (Stop 6, a mais antiga com 25 dias); 47 vezes no mês o dono registrou "cliente aprovou por fora"
-- depois do WhatsApp. Financeiro: R$ 1.647 em atraso e nenhuma cobrança teve lembrete (check-renewals está
-- segurado de propósito); profiles.overdue_since errado para quem já pagou.
--
-- O painel NÃO envia WhatsApp. Ele prepara a mensagem; o dono aprova; o Hermes envia no grupo e registra
-- (mesmo rito das Mensagens da semana e do aviso de post no ar). Nada vai ao cliente sem aprovação do dono:
-- - lembrete: o dono aprova UMA vez o modelo (mensagem_modelo.aprovado_texto). Sem modelo aprovado, nada é
--   preparado. Com ele, cada lembrete já nasce aprovado ("aprovado_via = modelo") e vai para a fila do Hermes;
-- - cobrança: cada mensagem nasce "pendente" e espera o dono (1 toque), a não ser que ele tenha aprovado a régua
--   daquela cobrança (cobranca_regua_aprovada), aí as etapas seguintes já nascem aprovadas ("regua").
--
-- Regras do lembrete (por cliente, por dia):
-- - peça pendente com o cliente (mesmo critério do aprovacao-email) há mais de 48 h, pedida nos últimos 30 dias;
-- - no máximo 1 por cliente por dia (chave lembrete:<cliente>:<dia>), só em dia útil das 9h às 18h (São Paulo),
--   e vale só até as 18h do dia: o Hermes só recebe na janela; o que não saiu, vence;
-- - o cliente decidiu (aprovou, pediu ajuste, ou o dono marcou "aprovou por fora") = o lembrete não enviado é
--   cancelado e o motivo fica registrado (cliente_decidiu / aprovado_por_fora). O "aprovou por fora" segue
--   igual; aqui só se registra;
-- - cliente sem grupo de WhatsApp conhecido não recebe (aparece na tela para o dono informar o grupo).
-- Regras da cobrança (por cobrança de billing pendente, cliente ativo):
-- - D+1, D+5 e D+10 após o vencimento (a etapa é a maior já alcançada; uma mensagem por etapa, nunca repete);
-- - uma mensagem por cliente por dia, listando tudo o que está em aberto dele;
-- - pagou (billing sai de pending) = a mensagem não enviada é cancelada e as próximas etapas não nascem.
--
-- Também aqui: recalcular_em_atraso_desde(_aplicar) recalcula profiles.overdue_since a partir das cobranças
-- reais (pago = limpa). Esta migration NÃO aplica: só cria a função. Simulação: select * from
-- public.recalcular_em_atraso_desde(false);
--
-- Idempotente: pode rodar de novo (IF NOT EXISTS, OR REPLACE, ON CONFLICT DO NOTHING, cron recriado).

-- ------------------------------------------------------------------ tabelas

CREATE TABLE IF NOT EXISTS public.mensagem_modelo (
  tipo text PRIMARY KEY CHECK (tipo IN ('lembrete_aprovacao', 'cobranca_d1', 'cobranca_d5', 'cobranca_d10')),
  texto text NOT NULL CHECK (length(btrim(texto)) BETWEEN 10 AND 1000),
  aprovado_texto text CHECK (aprovado_texto IS NULL OR length(btrim(aprovado_texto)) BETWEEN 10 AND 1000),
  aprovado_em timestamptz,
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.mensagem_modelo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mensagem_modelo_admin_le ON public.mensagem_modelo;
CREATE POLICY mensagem_modelo_admin_le ON public.mensagem_modelo FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
REVOKE ALL ON public.mensagem_modelo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mensagem_modelo TO authenticated;

-- Os textos-base. O do lembrete NÃO nasce aprovado: enquanto o dono não aprovar, nenhum lembrete é preparado.
-- Variáveis: {cliente} {pecas} {lista} {link} (lembrete); {cliente} {itens} {total} {pix} {link} (cobrança).
INSERT INTO public.mensagem_modelo (tipo, texto) VALUES
  ('lembrete_aprovacao', E'Oi, pessoal! Tem {pecas} esperando a aprovação de vocês:\n{lista}\nDá para aprovar direto por aqui: {link}\nSe quiserem algum ajuste, é só responder aqui no grupo.'),
  ('cobranca_d1', E'Oi, pessoal! Um lembrete rápido: este pagamento ainda aparece em aberto por aqui:\n{itens}\nPix: {pix}\nDetalhes: {link}\nSe já pagou, é só mandar o comprovante aqui que a gente dá baixa. Obrigado!'),
  ('cobranca_d5', E'Oi, pessoal! Tudo certo por aí? Seguimos com este pagamento em aberto:\n{itens}\nPix: {pix}\nDetalhes: {link}\nSe já foi pago, manda o comprovante aqui que a gente atualiza.'),
  ('cobranca_d10', E'Oi, pessoal! A gente ainda não identificou este pagamento:\n{itens}\nConsegue ver isso esta semana? Pix: {pix}\nDetalhes: {link}\nSe surgiu algum imprevisto, chama a gente aqui que a gente combina o melhor jeito.')
ON CONFLICT (tipo) DO NOTHING;

-- O grupo de WhatsApp de cada cliente, quando o dono informa (senão vale o último grupo usado na Revisão).
CREATE TABLE IF NOT EXISTS public.cliente_grupo_whatsapp (
  client_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient text NOT NULL CHECK (length(btrim(recipient)) BETWEEN 1 AND 250),
  definido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cliente_grupo_whatsapp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cliente_grupo_whatsapp_admin_le ON public.cliente_grupo_whatsapp;
CREATE POLICY cliente_grupo_whatsapp_admin_le ON public.cliente_grupo_whatsapp FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
REVOKE ALL ON public.cliente_grupo_whatsapp FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_grupo_whatsapp TO authenticated;

-- A régua aprovada de uma cobrança: as etapas seguintes dela já nascem aprovadas.
CREATE TABLE IF NOT EXISTS public.cobranca_regua_aprovada (
  billing_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aprovado_em timestamptz NOT NULL DEFAULT now(),
  revogada_em timestamptz
);
CREATE INDEX IF NOT EXISTS cobranca_regua_aprovada_cliente ON public.cobranca_regua_aprovada (client_id);
ALTER TABLE public.cobranca_regua_aprovada ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cobranca_regua_aprovada_admin_le ON public.cobranca_regua_aprovada;
CREATE POLICY cobranca_regua_aprovada_admin_le ON public.cobranca_regua_aprovada FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
REVOKE ALL ON public.cobranca_regua_aprovada FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cobranca_regua_aprovada TO authenticated;

-- Cada mensagem preparada. Tabela própria (como aviso_publicacao): nada entra em operator_approvals, que tem
-- dezenas de leitores sem filtro de origem.
CREATE TABLE IF NOT EXISTS public.mensagem_automatica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('lembrete_aprovacao', 'cobranca')),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  chave text NOT NULL UNIQUE CHECK (length(chave) BETWEEN 8 AND 200),
  dia date NOT NULL,
  etapa integer CHECK (etapa IS NULL OR etapa IN (1, 5, 10)),
  itens jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) > 0),
  mensagem text NOT NULL CHECK (length(btrim(mensagem)) BETWEEN 1 AND 2000),
  destino jsonb NOT NULL,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'expirado', 'cancelado')),
  aprovado_via text CHECK (aprovado_via IS NULL OR aprovado_via IN ('modelo', 'dono', 'regua')),
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  decision_key text,
  valid_until timestamptz NOT NULL,
  executed_at timestamptz,
  execution_evidence text,
  execution_run_key text,
  cancelado_motivo text,
  cancelado_em timestamptz,
  desfecho jsonb,
  desfecho_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Enviada só depois de aprovada (cancelada depois de sair continua registrando o envio).
  CONSTRAINT mensagem_automatica_envio_so_aprovado CHECK (executed_at IS NULL OR status IN ('aprovado', 'cancelado')),
  CONSTRAINT mensagem_automatica_aprovada_tem_grupo CHECK (status <> 'aprovado' OR length(btrim(COALESCE(destino->>'recipient', ''))) > 0)
);
CREATE INDEX IF NOT EXISTS mensagem_automatica_cliente ON public.mensagem_automatica (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mensagem_automatica_viva ON public.mensagem_automatica (status, valid_until) WHERE executed_at IS NULL;
ALTER TABLE public.mensagem_automatica ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mensagem_automatica_admin_le ON public.mensagem_automatica;
CREATE POLICY mensagem_automatica_admin_le ON public.mensagem_automatica FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
REVOKE ALL ON public.mensagem_automatica FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mensagem_automatica TO authenticated;

-- O que foi preparado não muda; só a decisão, o envio, o cancelamento e o desfecho andam. Texto e grupo só
-- mudam enquanto pendente (o dono edita antes de aprovar).
CREATE OR REPLACE FUNCTION app_private.mensagem_automatica_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  _andam text[] := ARRAY['status', 'aprovado_via', 'decided_by', 'decided_at', 'decision_note', 'decision_key',
                         'executed_at', 'execution_evidence', 'execution_run_key', 'cancelado_motivo', 'cancelado_em',
                         'desfecho', 'desfecho_em'];
BEGIN
  IF OLD.status = 'pendente' THEN
    _andam := _andam || ARRAY['mensagem', 'destino', 'payload', 'payload_hash'];
  END IF;
  IF (to_jsonb(NEW) - _andam) IS DISTINCT FROM (to_jsonb(OLD) - _andam) THEN
    RAISE EXCEPTION 'MENSAGEM_IMUTAVEL: a mensagem preparada não muda depois de decidida';
  END IF;
  IF OLD.executed_at IS NOT NULL AND NEW.executed_at IS DISTINCT FROM OLD.executed_at THEN
    RAISE EXCEPTION 'MENSAGEM_JA_ENVIADA: o envio registrado não muda';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.mensagem_automatica_imutavel() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mensagem_automatica_imutavel ON public.mensagem_automatica;
CREATE TRIGGER mensagem_automatica_imutavel BEFORE UPDATE ON public.mensagem_automatica
  FOR EACH ROW EXECUTE FUNCTION app_private.mensagem_automatica_imutavel();

-- ------------------------------------------------------------------ peças pequenas

-- Dia útil das 9h às 18h em São Paulo (feriado não entra: o dono pula a mensagem).
CREATE OR REPLACE FUNCTION app_private.mensagens_janela_aberta(_t timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT extract(isodow FROM (_t AT TIME ZONE 'America/Sao_Paulo')) BETWEEN 1 AND 5
     AND (_t AT TIME ZONE 'America/Sao_Paulo')::time >= time '09:00'
     AND (_t AT TIME ZONE 'America/Sao_Paulo')::time < time '18:00';
$$;
REVOKE ALL ON FUNCTION app_private.mensagens_janela_aberta(timestamptz) FROM PUBLIC, anon, authenticated;

-- 18h (São Paulo) de um dia.
CREATE OR REPLACE FUNCTION app_private.mensagens_fim_da_janela(_dia date) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (_dia + time '18:00') AT TIME ZONE 'America/Sao_Paulo';
$$;
REVOKE ALL ON FUNCTION app_private.mensagens_fim_da_janela(date) FROM PUBLIC, anon, authenticated;

-- Etapa da régua pelos dias de atraso: 1, 5 ou 10 (a maior já alcançada); antes do D+1, nenhuma.
CREATE OR REPLACE FUNCTION app_private.cobranca_etapa(_dias integer) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN _dias >= 10 THEN 10 WHEN _dias >= 5 THEN 5 WHEN _dias >= 1 THEN 1 END;
$$;
REVOKE ALL ON FUNCTION app_private.cobranca_etapa(integer) FROM PUBLIC, anon, authenticated;

-- R$ 1.234,56
CREATE OR REPLACE FUNCTION app_private.brl(_v numeric) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT 'R$ ' || translate(to_char(COALESCE(_v, 0), 'FM999,999,990.00'), ',.', '.,');
$$;
REVOKE ALL ON FUNCTION app_private.brl(numeric) FROM PUBLIC, anon, authenticated;

-- Troca {chave} pelo valor. Chave sem valor some (nunca sai "{pix}" para o cliente).
CREATE OR REPLACE FUNCTION app_private.mensagem_preencher(_texto text, _vars jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _k text;
  _v text;
  _saida text := COALESCE(_texto, '');
BEGIN
  FOR _k, _v IN SELECT key, value FROM jsonb_each_text(COALESCE(_vars, '{}'::jsonb)) LOOP
    _saida := replace(_saida, '{' || _k || '}', COALESCE(_v, ''));
  END LOOP;
  _saida := regexp_replace(_saida, '\{[a-z_]+\}', '', 'g');
  RETURN btrim(_saida);
END $$;
REVOKE ALL ON FUNCTION app_private.mensagem_preencher(text, jsonb) FROM PUBLIC, anon, authenticated;

-- O grupo do cliente: o que o dono informou; senão, o último grupo de WhatsApp usado na Revisão do Ciclo.
CREATE OR REPLACE FUNCTION app_private.grupo_whatsapp_do_cliente(_client_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT NULLIF(btrim(g.recipient), '') FROM public.cliente_grupo_whatsapp g WHERE g.client_id = _client_id),
    (SELECT x.r FROM (
        SELECT NULLIF(btrim(oa.payload->'destination'->>'recipient'), '') AS r, oa.created_at AS q
          FROM public.operator_approvals oa
         WHERE oa.origin = 'central' AND oa.client_id = _client_id
           AND oa.payload->'destination'->>'channel' = 'whatsapp'
        UNION ALL
        SELECT NULLIF(btrim(a.destino->>'recipient'), ''), a.created_at
          FROM public.aviso_publicacao a
         WHERE a.client_id = _client_id AND a.destino->>'channel' = 'whatsapp'
     ) x WHERE x.r IS NOT NULL ORDER BY x.q DESC LIMIT 1));
$$;
REVOKE ALL ON FUNCTION app_private.grupo_whatsapp_do_cliente(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.nome_do_cliente(_client_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT COALESCE(NULLIF(btrim(p.company_name), ''), p.full_name) FROM public.profiles p WHERE p.id = _client_id), 'Cliente');
$$;
REVOKE ALL ON FUNCTION app_private.nome_do_cliente(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ candidatos

-- Clientes com peça esperando a aprovação há mais de 48 h (pedida nos últimos 30 dias). Mesmo critério do
-- aprovacao_email_tick; a hora conta de quando a peça foi pedida ao cliente (approval_requested_at).
CREATE OR REPLACE FUNCTION app_private.lembrete_candidatos()
RETURNS TABLE (client_id uuid, cliente text, itens jsonb, grupo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH pend AS (
    SELECT f.client_id, f.id,
           CASE WHEN length(regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i')) > 70
                THEN btrim(left(regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i'), 67)) || '…'
                ELSE regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i') END AS titulo,
           COALESCE(f.approval_requested_at, f.created_at) AS desde
      FROM public.files f
     WHERE f.approval_status = 'pending'
       AND f.visibility = 'approval'
       AND f.requires_approval = true
       AND f.status = 'ready'
       AND f.archived_at IS NULL
       AND f.parent_file_id IS NULL
       AND COALESCE(f.approval_requested_at, f.created_at) > now() - interval '30 days'
       AND COALESCE(f.approval_requested_at, f.created_at) <= now() - interval '48 hours'
  )
  SELECT pend.client_id,
         COALESCE(NULLIF(btrim(p.company_name), ''), p.full_name),
         jsonb_agg(jsonb_build_object('file_id', pend.id, 'titulo', pend.titulo, 'desde', pend.desde,
                                      'dias', floor(extract(epoch FROM (now() - pend.desde)) / 86400)::int)
                   ORDER BY pend.desde),
         app_private.grupo_whatsapp_do_cliente(pend.client_id)
    FROM pend
    JOIN public.profiles p ON p.id = pend.client_id
   WHERE p.deleted_at IS NULL
     AND COALESCE(p.plan_status, '') NOT IN ('inactive', 'standby')
     AND NOT COALESCE(public.is_staff(p.id), false)
   GROUP BY pend.client_id, p.company_name, p.full_name;
$$;
REVOKE ALL ON FUNCTION app_private.lembrete_candidatos() FROM PUBLIC, anon, authenticated;

-- Clientes com cobrança vencida que alcançou uma etapa nova da régua (D+1, D+5, D+10) ainda sem mensagem.
-- Cada item diz a etapa e se ela é nova ("marco"); a mensagem lista tudo o que está em aberto do cliente.
CREATE OR REPLACE FUNCTION app_private.cobranca_candidatos(_hoje date)
RETURNS TABLE (client_id uuid, cliente text, itens jsonb, etapa integer, grupo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH aberto AS (
    SELECT b.id, b.client_id, b.amount, b.due_date,
           COALESCE(NULLIF(btrim(regexp_replace(COALESCE(b.description, ''), '\s*\([^)]*\)\s*$', '')), ''),
                    CASE b.type WHEN 'renewal' THEN 'Mensalidade' ELSE 'Cobrança' END) AS descricao,
           (_hoje - b.due_date) AS dias,
           app_private.cobranca_etapa(_hoje - b.due_date) AS etapa
      FROM public.billing b
      JOIN public.profiles p ON p.id = b.client_id
     WHERE b.status = 'pending'
       AND b.due_date < _hoje
       AND b.amount > 0
       AND p.deleted_at IS NULL
       AND COALESCE(p.plan_status, '') NOT IN ('inactive', 'standby')
  ), marcado AS (
    SELECT a.*,
           NOT EXISTS (
             SELECT 1 FROM public.mensagem_automatica m
              WHERE m.tipo = 'cobranca' AND m.client_id = a.client_id AND m.status <> 'cancelado'
                AND m.itens @> jsonb_build_array(jsonb_build_object('billing_id', a.id::text, 'etapa', a.etapa, 'marco', true))
           ) AS novo
      FROM aberto a
  )
  SELECT m.client_id,
         app_private.nome_do_cliente(m.client_id),
         jsonb_agg(jsonb_build_object('billing_id', m.id::text, 'descricao', m.descricao, 'valor', m.amount,
                                      'vencimento', m.due_date, 'dias', m.dias, 'etapa', m.etapa, 'marco', m.novo)
                   ORDER BY m.due_date, m.id),
         max(m.etapa) FILTER (WHERE m.novo),
         app_private.grupo_whatsapp_do_cliente(m.client_id)
    FROM marcado m
   GROUP BY m.client_id
  HAVING bool_or(m.novo);
$$;
REVOKE ALL ON FUNCTION app_private.cobranca_candidatos(date) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ montar o texto

CREATE OR REPLACE FUNCTION app_private.lembrete_texto(_modelo text, _cliente text, _itens jsonb) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  _n integer := jsonb_array_length(_itens);
  _lista text;
BEGIN
  SELECT string_agg('• ' || (i->>'titulo') || CASE WHEN (i->>'dias')::int >= 1
                      THEN ' (há ' || (i->>'dias') || CASE WHEN (i->>'dias')::int = 1 THEN ' dia)' ELSE ' dias)' END ELSE '' END,
                    E'\n' ORDER BY o)
    INTO _lista
    FROM jsonb_array_elements(_itens) WITH ORDINALITY AS t(i, o)
   WHERE o <= 5;
  IF _n > 5 THEN _lista := _lista || E'\n• e mais ' || (_n - 5); END IF;
  RETURN app_private.mensagem_preencher(_modelo, jsonb_build_object(
    'cliente', _cliente,
    'pecas', _n || CASE WHEN _n = 1 THEN ' peça' ELSE ' peças' END,
    'lista', _lista,
    'link', 'https://aceleriq.online/aprovacoes'));
END $$;
REVOKE ALL ON FUNCTION app_private.lembrete_texto(text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.cobranca_texto(_modelo text, _cliente text, _itens jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _linhas text;
  _total numeric;
  _pix text;
BEGIN
  SELECT string_agg('• ' || (i->>'descricao') || ': ' || app_private.brl((i->>'valor')::numeric)
                      || ', venceu em ' || to_char((i->>'vencimento')::date, 'DD/MM'), E'\n' ORDER BY (i->>'vencimento')),
         sum((i->>'valor')::numeric)
    INTO _linhas, _total
    FROM jsonb_array_elements(_itens) i;
  SELECT NULLIF(btrim(a.pix_chave), '') INTO _pix FROM public.agencia_dados a LIMIT 1;
  RETURN app_private.mensagem_preencher(_modelo, jsonb_build_object(
    'cliente', _cliente,
    'itens', _linhas,
    'total', app_private.brl(_total),
    'pix', COALESCE(_pix, 'a chave está no link abaixo'),
    'link', 'https://aceleriq.online/financeiro'));
END $$;
REVOKE ALL ON FUNCTION app_private.cobranca_texto(text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.mensagem_automatica_hash(_payload jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(_payload::text, 'sha256'), 'hex');
$$;
REVOKE ALL ON FUNCTION app_private.mensagem_automatica_hash(jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ ainda vale?

-- NULL = ainda vale. Senão, o motivo para parar: o cliente decidiu a peça (ou o dono marcou "aprovou por
-- fora"), pagou, o cliente saiu, ou o modelo do lembrete foi pausado.
CREATE OR REPLACE FUNCTION app_private.mensagem_automatica_motivo_para_parar(_m public.mensagem_automatica) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
  _total integer := jsonb_array_length(_m.itens);
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _m.client_id AND p.deleted_at IS NOT NULL) THEN
    RETURN 'cliente_removido';
  END IF;
  IF _m.tipo = 'lembrete_aprovacao' THEN
    IF _m.executed_at IS NULL AND _m.aprovado_via = 'modelo'
       AND NOT EXISTS (SELECT 1 FROM public.mensagem_modelo mm WHERE mm.tipo = 'lembrete_aprovacao' AND mm.aprovado_texto IS NOT NULL) THEN
      RETURN 'modelo_pausado';
    END IF;
    SELECT count(*) INTO _n
      FROM jsonb_array_elements(_m.itens) i
      JOIN public.files f ON f.id = (i->>'file_id')::uuid
     WHERE f.approval_status = 'pending' AND f.visibility = 'approval' AND f.archived_at IS NULL;
    IF _n = _total THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM public.file_approval_events e
                WHERE e.file_id IN (SELECT (i->>'file_id')::uuid FROM jsonb_array_elements(_m.itens) i)
                  AND e.event_type = 'client_approved_offline' AND e.created_at >= _m.created_at) THEN
      RETURN 'aprovado_por_fora';
    END IF;
    RETURN 'cliente_decidiu';
  END IF;
  SELECT count(*) INTO _n
    FROM jsonb_array_elements(_m.itens) i
    JOIN public.billing b ON b.id = (i->>'billing_id')::uuid
   WHERE b.status = 'pending';
  IF _n = _total THEN RETURN NULL; END IF;
  RETURN CASE WHEN _n = 0 THEN 'pagou' ELSE 'pagou_parte' END;
END $$;
REVOKE ALL ON FUNCTION app_private.mensagem_automatica_motivo_para_parar(public.mensagem_automatica) FROM PUBLIC, anon, authenticated;

-- Confere as mensagens não enviadas: cancela o que não vale mais e vence o que passou do prazo. Também anota o
-- desfecho das enviadas (o que o cliente fez depois), para medir se o lembrete e a cobrança funcionam.
CREATE OR REPLACE FUNCTION app_private.mensagens_automaticas_conferir() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_automatica%ROWTYPE;
  _motivo text;
  _canceladas integer := 0;
  _vencidas integer := 0;
BEGIN
  FOR _m IN SELECT * FROM public.mensagem_automatica
             WHERE executed_at IS NULL AND status IN ('pendente', 'aprovado')
             FOR UPDATE SKIP LOCKED LOOP
    _motivo := app_private.mensagem_automatica_motivo_para_parar(_m);
    IF _motivo IS NOT NULL THEN
      UPDATE public.mensagem_automatica SET status = 'cancelado', cancelado_motivo = _motivo, cancelado_em = now() WHERE id = _m.id;
      _canceladas := _canceladas + 1;
    ELSIF _m.valid_until <= now() THEN
      UPDATE public.mensagem_automatica SET status = 'expirado' WHERE id = _m.id;
      _vencidas := _vencidas + 1;
    END IF;
  END LOOP;

  UPDATE public.mensagem_automatica m
     SET desfecho = d.j, desfecho_em = now()
    FROM (
      SELECT m2.id, CASE WHEN m2.tipo = 'lembrete_aprovacao' THEN jsonb_build_object(
               'aprovadas', (SELECT count(DISTINCT e.file_id) FROM public.file_approval_events e
                              WHERE e.file_id IN (SELECT (i->>'file_id')::uuid FROM jsonb_array_elements(m2.itens) i)
                                AND e.created_at >= m2.executed_at AND e.event_type IN ('client_approved', 'client_approved_offline')),
               'aprovadas_por_fora', (SELECT count(DISTINCT e.file_id) FROM public.file_approval_events e
                              WHERE e.file_id IN (SELECT (i->>'file_id')::uuid FROM jsonb_array_elements(m2.itens) i)
                                AND e.created_at >= m2.executed_at AND e.event_type = 'client_approved_offline'),
               'ajustes', (SELECT count(DISTINCT e.file_id) FROM public.file_approval_events e
                              WHERE e.file_id IN (SELECT (i->>'file_id')::uuid FROM jsonb_array_elements(m2.itens) i)
                                AND e.created_at >= m2.executed_at AND e.event_type = 'client_rejected'),
               'pecas', jsonb_array_length(m2.itens))
             ELSE jsonb_build_object(
               'pagas', (SELECT count(*) FROM jsonb_array_elements(m2.itens) i
                          JOIN public.billing b ON b.id = (i->>'billing_id')::uuid WHERE b.status = 'paid'),
               'cobrancas', jsonb_array_length(m2.itens))
             END AS j
        FROM public.mensagem_automatica m2
       WHERE m2.executed_at IS NOT NULL AND m2.executed_at > now() - interval '14 days'
    ) d
   WHERE m.id = d.id AND m.desfecho IS DISTINCT FROM d.j;

  RETURN jsonb_build_object('canceladas', _canceladas, 'vencidas', _vencidas);
END $$;
REVOKE ALL ON FUNCTION app_private.mensagens_automaticas_conferir() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ o tick (cron)

CREATE OR REPLACE FUNCTION public.mensagens_automaticas_tick() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _conf jsonb;
  _modelo public.mensagem_modelo%ROWTYPE;
  _c record;
  _chave text;
  _texto text;
  _destino jsonb;
  _payload jsonb;
  _regua boolean;
  _status text;
  _lembretes integer := 0;
  _sem_grupo integer := 0;
  _cobrancas integer := 0;
  _cobrancas_pendentes integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mensagens-automaticas-tick', 0));
  _conf := app_private.mensagens_automaticas_conferir();
  IF NOT app_private.mensagens_janela_aberta(now()) THEN
    RETURN _conf || jsonb_build_object('janela', 'fechada');
  END IF;

  -- Lembretes: só com o modelo aprovado pelo dono. Nascem aprovados (pelo modelo) e vão para a fila do Hermes.
  SELECT * INTO _modelo FROM public.mensagem_modelo WHERE tipo = 'lembrete_aprovacao';
  IF FOUND AND _modelo.aprovado_texto IS NOT NULL THEN
    FOR _c IN SELECT * FROM app_private.lembrete_candidatos() LOOP
      IF _c.grupo IS NULL THEN _sem_grupo := _sem_grupo + 1; CONTINUE; END IF;
      _chave := 'lembrete:' || _c.client_id::text || ':' || _hoje::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.mensagem_automatica WHERE chave = _chave);
      _texto := app_private.lembrete_texto(_modelo.aprovado_texto, _c.cliente, _c.itens);
      _destino := jsonb_build_object('channel', 'whatsapp', 'recipient', _c.grupo);
      _payload := jsonb_build_object('tipo', 'lembrete_aprovacao', 'client_id', _c.client_id, 'chave', _chave,
                                     'itens', _c.itens, 'mensagem', _texto, 'destino', _destino);
      INSERT INTO public.mensagem_automatica (tipo, client_id, chave, dia, itens, mensagem, destino, payload, payload_hash,
                                              status, aprovado_via, decided_by, decided_at, decision_note, valid_until)
      VALUES ('lembrete_aprovacao', _c.client_id, _chave, _hoje, _c.itens, _texto, _destino, _payload,
              app_private.mensagem_automatica_hash(_payload), 'aprovado', 'modelo', _modelo.aprovado_por, now(),
              'Modelo aprovado pelo dono em ' || to_char(_modelo.aprovado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
              app_private.mensagens_fim_da_janela(_hoje))
      ON CONFLICT (chave) DO NOTHING;
      IF FOUND THEN _lembretes := _lembretes + 1; END IF;
    END LOOP;
  END IF;

  -- Cobranças: pendentes para o dono, ou aprovadas se a régua de TODAS as cobranças da mensagem foi aprovada.
  FOR _c IN SELECT * FROM app_private.cobranca_candidatos(_hoje) LOOP
    _chave := 'cobranca:' || _c.client_id::text || ':' || _hoje::text;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.mensagem_automatica WHERE chave = _chave);
    SELECT mm.texto INTO _texto FROM public.mensagem_modelo mm WHERE mm.tipo = ('cobranca_d' || _c.etapa::text);
    _texto := app_private.cobranca_texto(_texto, _c.cliente, _c.itens);
    _destino := jsonb_build_object('channel', 'whatsapp', 'recipient', _c.grupo);
    _payload := jsonb_build_object('tipo', 'cobranca', 'client_id', _c.client_id, 'chave', _chave, 'etapa', _c.etapa,
                                   'itens', _c.itens, 'mensagem', _texto, 'destino', _destino);
    _regua := _c.grupo IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_c.itens) i
       WHERE NOT EXISTS (SELECT 1 FROM public.cobranca_regua_aprovada r
                          WHERE r.billing_id = (i->>'billing_id')::uuid AND r.revogada_em IS NULL));
    _status := CASE WHEN _regua THEN 'aprovado' ELSE 'pendente' END;
    INSERT INTO public.mensagem_automatica (tipo, client_id, chave, dia, etapa, itens, mensagem, destino, payload, payload_hash,
                                            status, aprovado_via, decided_by, decided_at, decision_note, valid_until)
    VALUES ('cobranca', _c.client_id, _chave, _hoje, _c.etapa, _c.itens, _texto, _destino, _payload,
            app_private.mensagem_automatica_hash(_payload), _status,
            CASE WHEN _regua THEN 'regua' END,
            CASE WHEN _regua THEN (SELECT r.aprovado_por FROM public.cobranca_regua_aprovada r
                                    WHERE r.billing_id = (_c.itens->0->>'billing_id')::uuid) END,
            CASE WHEN _regua THEN now() END,
            CASE WHEN _regua THEN 'Régua da cobrança aprovada pelo dono' END,
            app_private.mensagens_fim_da_janela(_hoje + 3))
    ON CONFLICT (chave) DO NOTHING;
    IF FOUND THEN
      _cobrancas := _cobrancas + 1;
      IF NOT _regua THEN _cobrancas_pendentes := _cobrancas_pendentes + 1; END IF;
    END IF;
  END LOOP;

  -- Um aviso por dia no sino do dono quando há cobrança nova esperando (não vira e-mail).
  IF _cobrancas_pendentes > 0 AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.notification_type = 'cobranca_para_aprovar'
          AND n.created_at >= (_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo')) THEN
    INSERT INTO public.notifications (user_id, message, notification_type, link)
    SELECT DISTINCT ur.user_id,
           'Cobrança pronta para você aprovar: ' || _cobrancas_pendentes
             || CASE WHEN _cobrancas_pendentes = 1 THEN ' cliente.' ELSE ' clientes.' END,
           'cobranca_para_aprovar', '/central/mensagens#cobrancas'
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.deleted_at IS NULL AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
  END IF;

  RETURN _conf || jsonb_build_object('janela', 'aberta', 'lembretes', _lembretes, 'lembretes_sem_grupo', _sem_grupo,
                                     'cobrancas', _cobrancas, 'cobrancas_para_o_dono', _cobrancas_pendentes);
END $$;
REVOKE ALL ON FUNCTION public.mensagens_automaticas_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mensagens_automaticas_tick() TO service_role;

-- ------------------------------------------------------------------ o dono (painel)

-- Aprovar uma mensagem pendente (texto e grupo podem vir editados). Uso interno da decisão e da régua.
CREATE OR REPLACE FUNCTION app_private.mensagem_automatica_aprovar(_id uuid, _texto text, _grupo text, _via text, _nota text, _key text)
RETURNS public.mensagem_automatica
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_automatica%ROWTYPE;
  _destino jsonb;
  _payload jsonb;
  _msg text;
BEGIN
  SELECT * INTO _m FROM public.mensagem_automatica WHERE id = _id FOR UPDATE;
  _msg := COALESCE(NULLIF(btrim(COALESCE(_texto, '')), ''), _m.mensagem);
  IF length(_msg) > 2000 THEN RAISE EXCEPTION 'MENSAGEM_LONGA: até 2000 caracteres'; END IF;
  IF length(btrim(COALESCE(_grupo, ''))) = 0 THEN
    RAISE EXCEPTION 'MENSAGEM_SEM_GRUPO: informe o nome exato do grupo do cliente no WhatsApp';
  END IF;
  _destino := jsonb_build_object('channel', 'whatsapp', 'recipient', btrim(_grupo));
  _payload := _m.payload || jsonb_build_object('mensagem', _msg, 'destino', _destino);
  UPDATE public.mensagem_automatica
     SET mensagem = _msg, destino = _destino, payload = _payload, payload_hash = app_private.mensagem_automatica_hash(_payload),
         status = 'aprovado', aprovado_via = _via, decided_by = auth.uid(), decided_at = now(),
         decision_note = _nota, decision_key = _key
   WHERE id = _m.id RETURNING * INTO _m;
  RETURN _m;
END $$;
REVOKE ALL ON FUNCTION app_private.mensagem_automatica_aprovar(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.cliente_grupo_gravar(_client_id uuid, _recipient text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.cliente_grupo_whatsapp (client_id, recipient, definido_por, atualizado_em)
  VALUES (_client_id, btrim(_recipient), auth.uid(), now())
  ON CONFLICT (client_id) DO UPDATE SET recipient = EXCLUDED.recipient, definido_por = EXCLUDED.definido_por, atualizado_em = now();
$$;
REVOKE ALL ON FUNCTION app_private.cliente_grupo_gravar(uuid, text) FROM PUBLIC, anon, authenticated;

-- Decidir uma mensagem pendente: aprovado (com texto e grupo opcionais) ou rejeitado (pular). Confere o hash do
-- que está na tela. Se o cliente já pagou ou já decidiu, cancela e devolve o motivo (não aprova).
CREATE OR REPLACE FUNCTION public.mensagem_automatica_decidir(
  _id uuid, _hash text, _decisao text, _mensagem text DEFAULT NULL, _recipient text DEFAULT NULL,
  _nota text DEFAULT NULL, _key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_automatica%ROWTYPE;
  _motivo text;
  _grupo text;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'MENSAGEM_CHAVE_INVALIDA'; END IF;
  IF _decisao IS NULL OR _decisao NOT IN ('aprovado', 'rejeitado') THEN RAISE EXCEPTION 'MENSAGEM_DECISAO_INVALIDA: aprovado ou rejeitado'; END IF;
  SELECT * INTO _m FROM public.mensagem_automatica WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MENSAGEM_NAO_ENCONTRADA'; END IF;
  IF _m.decision_key = _key THEN RETURN to_jsonb(_m) || jsonb_build_object('repetido', true); END IF;
  IF _m.status <> 'pendente' THEN RAISE EXCEPTION 'MENSAGEM_JA_DECIDIDA: está como %', _m.status USING ERRCODE = '40001'; END IF;
  IF _m.payload_hash IS DISTINCT FROM _hash THEN RAISE EXCEPTION 'MENSAGEM_MUDOU: atualize a lista' USING ERRCODE = '40001'; END IF;
  _motivo := app_private.mensagem_automatica_motivo_para_parar(_m);
  IF _motivo IS NOT NULL THEN
    UPDATE public.mensagem_automatica SET status = 'cancelado', cancelado_motivo = _motivo, cancelado_em = now()
     WHERE id = _m.id RETURNING * INTO _m;
    RETURN to_jsonb(_m) || jsonb_build_object('parou', _motivo);
  END IF;
  IF _m.valid_until <= now() THEN
    UPDATE public.mensagem_automatica SET status = 'expirado' WHERE id = _m.id RETURNING * INTO _m;
    RETURN to_jsonb(_m) || jsonb_build_object('parou', 'vencida');
  END IF;
  IF _decisao = 'rejeitado' THEN
    UPDATE public.mensagem_automatica
       SET status = 'rejeitado', decided_by = auth.uid(), decided_at = now(),
           decision_note = COALESCE(NULLIF(btrim(COALESCE(_nota, '')), ''), 'Pulada pelo dono: não enviar esta.'), decision_key = _key
     WHERE id = _m.id RETURNING * INTO _m;
    RETURN to_jsonb(_m);
  END IF;
  _grupo := COALESCE(NULLIF(btrim(COALESCE(_recipient, '')), ''), NULLIF(btrim(COALESCE(_m.destino->>'recipient', '')), ''));
  IF NULLIF(btrim(COALESCE(_recipient, '')), '') IS NOT NULL THEN PERFORM app_private.cliente_grupo_gravar(_m.client_id, _recipient); END IF;
  _m := app_private.mensagem_automatica_aprovar(_m.id, _mensagem, _grupo, 'dono', NULLIF(btrim(COALESCE(_nota, '')), ''), _key);
  RETURN to_jsonb(_m);
END $$;
REVOKE ALL ON FUNCTION public.mensagem_automatica_decidir(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagem_automatica_decidir(uuid, text, text, text, text, text, text) TO authenticated;

-- A régua inteira de um cliente: aprova as cobranças pendentes dele agora e deixa as próximas etapas (D+5,
-- D+10) já aprovadas, enquanto não pagar. Revogar volta a pedir o dono a cada etapa.
CREATE OR REPLACE FUNCTION public.cobranca_regua_aprovar(_client_id uuid, _recipient text DEFAULT NULL, _key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_automatica%ROWTYPE;
  _n integer;
  _aprovadas integer := 0;
  _paradas integer := 0;
  _grupo text;
  _motivo text;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'MENSAGEM_CHAVE_INVALIDA'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cobranca-regua:' || _client_id::text, 0));
  IF NULLIF(btrim(COALESCE(_recipient, '')), '') IS NOT NULL THEN PERFORM app_private.cliente_grupo_gravar(_client_id, _recipient); END IF;
  INSERT INTO public.cobranca_regua_aprovada (billing_id, client_id, aprovado_por, aprovado_em)
  SELECT b.id, b.client_id, auth.uid(), now() FROM public.billing b WHERE b.client_id = _client_id AND b.status = 'pending'
  ON CONFLICT (billing_id) DO UPDATE SET revogada_em = NULL, aprovado_por = EXCLUDED.aprovado_por, aprovado_em = now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  _grupo := app_private.grupo_whatsapp_do_cliente(_client_id);
  FOR _m IN SELECT * FROM public.mensagem_automatica
             WHERE client_id = _client_id AND tipo = 'cobranca' AND status = 'pendente' AND executed_at IS NULL
             ORDER BY created_at FOR UPDATE LOOP
    _motivo := app_private.mensagem_automatica_motivo_para_parar(_m);
    IF _motivo IS NOT NULL OR _m.valid_until <= now() THEN
      UPDATE public.mensagem_automatica
         SET status = CASE WHEN _motivo IS NOT NULL THEN 'cancelado' ELSE 'expirado' END,
             cancelado_motivo = _motivo, cancelado_em = CASE WHEN _motivo IS NOT NULL THEN now() END
       WHERE id = _m.id;
      _paradas := _paradas + 1;
      CONTINUE;
    END IF;
    CONTINUE WHEN COALESCE(NULLIF(btrim(COALESCE(_m.destino->>'recipient', '')), ''), _grupo) IS NULL;
    PERFORM app_private.mensagem_automatica_aprovar(_m.id, NULL, COALESCE(NULLIF(btrim(COALESCE(_m.destino->>'recipient', '')), ''), _grupo),
                                                    'regua', 'Régua da cobrança aprovada pelo dono', left(_key || ':' || _m.id::text, 128));
    _aprovadas := _aprovadas + 1;
  END LOOP;
  RETURN jsonb_build_object('cobrancas_na_regua', _n, 'aprovadas_agora', _aprovadas, 'paradas', _paradas, 'sem_grupo', _grupo IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.cobranca_regua_aprovar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_regua_aprovar(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cobranca_regua_revogar(_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  PERFORM app_private.central_review_admin();
  UPDATE public.cobranca_regua_aprovada SET revogada_em = now() WHERE client_id = _client_id AND revogada_em IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('revogadas', _n);
END $$;
REVOKE ALL ON FUNCTION public.cobranca_regua_revogar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cobranca_regua_revogar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cliente_grupo_whatsapp_definir(_client_id uuid, _recipient text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(btrim(COALESCE(_recipient, ''))) NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'GRUPO_INVALIDO: o nome exato do grupo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _client_id) THEN RAISE EXCEPTION 'CLIENTE_NAO_ENCONTRADO'; END IF;
  PERFORM app_private.cliente_grupo_gravar(_client_id, _recipient);
  RETURN jsonb_build_object('client_id', _client_id, 'recipient', btrim(_recipient));
END $$;
REVOKE ALL ON FUNCTION public.cliente_grupo_whatsapp_definir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_grupo_whatsapp_definir(uuid, text) TO authenticated;

-- Modelos: salvar o texto (rascunho) e aprovar. O lembrete usa SÓ o texto aprovado; aprovar de novo troca o
-- modelo em uso. Pausar tira a aprovação: nenhum lembrete novo, e o que estava na fila sem sair é cancelado.
CREATE OR REPLACE FUNCTION app_private.mensagem_modelo_validar(_tipo text, _texto text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  _t text := btrim(COALESCE(_texto, ''));
BEGIN
  IF length(_t) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'MODELO_TAMANHO: de 10 a 1000 caracteres'; END IF;
  IF _tipo = 'lembrete_aprovacao' AND (position('{lista}' IN _t) = 0 OR position('{link}' IN _t) = 0) THEN
    RAISE EXCEPTION 'MODELO_INCOMPLETO: o lembrete precisa de {lista} e {link}';
  END IF;
  IF _tipo LIKE 'cobranca_d%' AND position('{itens}' IN _t) = 0 THEN
    RAISE EXCEPTION 'MODELO_INCOMPLETO: a cobrança precisa de {itens} (valor e vencimento)';
  END IF;
  RETURN _t;
END $$;
REVOKE ALL ON FUNCTION app_private.mensagem_modelo_validar(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mensagem_modelo_salvar(_tipo text, _texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_modelo%ROWTYPE;
BEGIN
  PERFORM app_private.central_review_admin();
  UPDATE public.mensagem_modelo SET texto = app_private.mensagem_modelo_validar(_tipo, _texto), atualizado_em = now(), atualizado_por = auth.uid()
   WHERE tipo = _tipo RETURNING * INTO _m;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODELO_NAO_ENCONTRADO'; END IF;
  RETURN to_jsonb(_m);
END $$;
REVOKE ALL ON FUNCTION public.mensagem_modelo_salvar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagem_modelo_salvar(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mensagem_modelo_aprovar(_tipo text, _texto text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_modelo%ROWTYPE;
  _t text;
BEGIN
  PERFORM app_private.central_review_admin();
  _t := app_private.mensagem_modelo_validar(_tipo, _texto);
  UPDATE public.mensagem_modelo
     SET texto = _t, aprovado_texto = _t, aprovado_em = now(), aprovado_por = auth.uid(), atualizado_em = now(), atualizado_por = auth.uid()
   WHERE tipo = _tipo RETURNING * INTO _m;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODELO_NAO_ENCONTRADO'; END IF;
  RETURN to_jsonb(_m);
END $$;
REVOKE ALL ON FUNCTION public.mensagem_modelo_aprovar(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagem_modelo_aprovar(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mensagem_modelo_pausar(_tipo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _n integer;
BEGIN
  PERFORM app_private.central_review_admin();
  UPDATE public.mensagem_modelo SET aprovado_texto = NULL, aprovado_em = NULL, aprovado_por = NULL, atualizado_em = now(), atualizado_por = auth.uid()
   WHERE tipo = _tipo;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODELO_NAO_ENCONTRADO'; END IF;
  UPDATE public.mensagem_automatica SET status = 'cancelado', cancelado_motivo = 'modelo_pausado', cancelado_em = now()
   WHERE _tipo = 'lembrete_aprovacao' AND tipo = 'lembrete_aprovacao' AND aprovado_via = 'modelo'
     AND status = 'aprovado' AND executed_at IS NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('tipo', _tipo, 'pausado', true, 'canceladas', _n);
END $$;
REVOKE ALL ON FUNCTION public.mensagem_modelo_pausar(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagem_modelo_pausar(text) TO authenticated;

-- A tela (Mensagens da semana → Cobranças e Lembretes): tudo numa leitura.
CREATE OR REPLACE FUNCTION public.mensagens_automaticas_painel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _linha jsonb;
BEGIN
  PERFORM app_private.central_review_admin();
  RETURN jsonb_build_object(
    'agora', now(),
    'janela_aberta', app_private.mensagens_janela_aberta(now()),
    'tem_pix', EXISTS (SELECT 1 FROM public.agencia_dados a WHERE NULLIF(btrim(a.pix_chave), '') IS NOT NULL),
    'modelos', COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', m.tipo, 'texto', m.texto, 'aprovado_texto', m.aprovado_texto,
                                  'aprovado_em', m.aprovado_em,
                                  'aprovado_por', CASE WHEN m.aprovado_por IS NOT NULL THEN app_private.nome_do_cliente(m.aprovado_por) END)
                                ORDER BY m.tipo) FROM public.mensagem_modelo m), '[]'::jsonb),
    'mensagens', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', m.id, 'tipo', m.tipo, 'client_id', m.client_id, 'cliente', app_private.nome_do_cliente(m.client_id),
                  'dia', m.dia, 'etapa', m.etapa, 'itens', m.itens, 'mensagem', m.mensagem, 'destino', m.destino,
                  'payload_hash', m.payload_hash, 'status', m.status, 'aprovado_via', m.aprovado_via, 'decided_at', m.decided_at,
                  'valid_until', m.valid_until, 'executed_at', m.executed_at, 'execution_evidence', m.execution_evidence,
                  'cancelado_motivo', m.cancelado_motivo, 'desfecho', m.desfecho, 'created_at', m.created_at,
                  'grupo_conhecido', app_private.grupo_whatsapp_do_cliente(m.client_id))
                ORDER BY m.created_at DESC)
              FROM public.mensagem_automatica m
             WHERE m.created_at > now() - interval '14 days'
                OR (m.status IN ('pendente', 'aprovado') AND m.executed_at IS NULL)), '[]'::jsonb),
    'esperando_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object('client_id', c.client_id, 'cliente', c.cliente, 'itens', c.itens, 'grupo', c.grupo)
                                   ORDER BY jsonb_array_length(c.itens) DESC)
                                  FROM app_private.lembrete_candidatos() c), '[]'::jsonb),
    'reguas', COALESCE((SELECT jsonb_agg(DISTINCT r.client_id) FROM public.cobranca_regua_aprovada r
                         JOIN public.billing b ON b.id = r.billing_id AND b.status = 'pending'
                        WHERE r.revogada_em IS NULL), '[]'::jsonb),
    'hoje', _hoje);
END $$;
REVOKE ALL ON FUNCTION public.mensagens_automaticas_painel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagens_automaticas_painel() TO authenticated;

-- O que pede o dono, no formato do "Precisa de você" da tela Hoje (src/lib/resumoDoDia.ts). Só aparece quando
-- há decisão: cobrança pendente, ou peças esperando o cliente e o modelo do lembrete sem aprovação.
CREATE OR REPLACE FUNCTION public.mensagens_automaticas_decisoes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _cobrancas jsonb;
  _modelo jsonb := '[]'::jsonb;
  _esperando integer;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'tipo', 'mensagem', 'titulo', 'Cobrança para aprovar (D+' || m.etapa || ')',
           'client_id', m.client_id, 'cliente', app_private.nome_do_cliente(m.client_id), 'area', 'Financeiro',
           'motivo', (SELECT app_private.brl(sum((i->>'valor')::numeric)) FROM jsonb_array_elements(m.itens) i)
                     || ' em aberto desde ' || (SELECT to_char(min((i->>'vencimento')::date), 'DD/MM') FROM jsonb_array_elements(m.itens) i),
           'link', '/central/mensagens#cobrancas', 'link_id', null, 'aprovacao_id', null) ORDER BY m.created_at), '[]'::jsonb)
    INTO _cobrancas
    FROM public.mensagem_automatica m
   WHERE m.tipo = 'cobranca' AND m.status = 'pendente' AND m.executed_at IS NULL AND m.valid_until > now();
  IF NOT EXISTS (SELECT 1 FROM public.mensagem_modelo WHERE tipo = 'lembrete_aprovacao' AND aprovado_texto IS NOT NULL) THEN
    SELECT count(*) INTO _esperando FROM app_private.lembrete_candidatos();
    IF _esperando > 0 THEN
      _modelo := jsonb_build_array(jsonb_build_object(
        'id', 'modelo-lembrete-aprovacao', 'tipo', 'mensagem', 'titulo', 'Aprovar o modelo do lembrete de aprovação',
        'client_id', null, 'cliente', null, 'area', 'Atendimento',
        'motivo', _esperando || CASE WHEN _esperando = 1 THEN ' cliente com peça' ELSE ' clientes com peças' END
                  || ' esperando há mais de 48 h; sem o modelo aprovado, nenhum lembrete sai.',
        'link', '/central/mensagens#lembretes', 'link_id', null, 'aprovacao_id', null));
    END IF;
  END IF;
  RETURN _modelo || _cobrancas;
END $$;
REVOKE ALL ON FUNCTION public.mensagens_automaticas_decisoes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagens_automaticas_decisoes() TO authenticated;

-- ------------------------------------------------------------------ o Hermes (MCP, service_role)

-- Registrar o envio (painel: o dono enviou ele mesmo; MCP: o Hermes enviou).
CREATE OR REPLACE FUNCTION public.mensagem_automatica_marcar_enviado(_id uuid, _evidence text, _key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _m public.mensagem_automatica%ROWTYPE;
  _via text;
BEGIN
  PERFORM app_private.central_review_admin();
  IF length(COALESCE(_key, '')) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'MENSAGEM_CHAVE_INVALIDA'; END IF;
  IF length(btrim(COALESCE(_evidence, ''))) < 3 THEN RAISE EXCEPTION 'MENSAGEM_EVIDENCIA_OBRIGATORIA: diga onde e quando enviou'; END IF;
  SELECT * INTO _m FROM public.mensagem_automatica WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MENSAGEM_NAO_ENCONTRADA'; END IF;
  IF _m.executed_at IS NOT NULL THEN
    IF _m.execution_run_key = _key THEN RETURN to_jsonb(_m) || jsonb_build_object('repetido', true); END IF;
    RAISE EXCEPTION 'MENSAGEM_JA_ENVIADA: registrada em %', _m.executed_at;
  END IF;
  -- Cancelada (o cliente pagou ou aprovou) depois que o Hermes leu a fila: o envio ainda é registrado.
  IF _m.status NOT IN ('aprovado', 'cancelado') OR (_m.status = 'cancelado' AND _m.decided_at IS NULL) THEN
    RAISE EXCEPTION 'MENSAGEM_NAO_APROVADA: só mensagem aprovada pelo dono pode ser enviada';
  END IF;
  _via := NULLIF(current_setting('app.agent_actor', true), '');
  UPDATE public.mensagem_automatica
     SET executed_at = now(), execution_evidence = btrim(_evidence)
           || CASE WHEN _via IS NOT NULL THEN ' [via Hermes ' || _via || ']' ELSE '' END,
         execution_run_key = _key
   WHERE id = _m.id RETURNING * INTO _m;
  RETURN to_jsonb(_m) || jsonb_build_object('via', COALESCE(_via, 'painel'));
END $$;
REVOKE ALL ON FUNCTION public.mensagem_automatica_marcar_enviado(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mensagem_automatica_marcar_enviado(uuid, text, text) TO authenticated;

-- A fila do Hermes: só o que o dono aprovou (pelo modelo, uma a uma ou pela régua), ainda valendo, e só na
-- janela (dia útil, 9h às 18h em São Paulo). Antes de devolver, confere de novo: pagou ou aprovou, sai.
CREATE OR REPLACE FUNCTION public.mensagens_automaticas_fila_para_agente(_operator_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _aberta boolean;
  _aprovados jsonb;
  _aguardando integer;
  _enviados jsonb;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  PERFORM app_private.mensagens_automaticas_conferir();
  _aberta := app_private.mensagens_janela_aberta(now());
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'mensagem_id', m.id, 'tipo', m.tipo, 'client_id', m.client_id, 'cliente', app_private.nome_do_cliente(m.client_id),
           'mensagem', m.mensagem, 'destino', m.destino, 'enviar_ate', m.valid_until, 'aprovado_via', m.aprovado_via)
           ORDER BY m.created_at), '[]'::jsonb),
         count(*)
    INTO _aprovados, _aguardando
    FROM public.mensagem_automatica m
   WHERE m.status = 'aprovado' AND m.executed_at IS NULL AND m.valid_until > now();
  SELECT COALESCE(jsonb_agg(x ORDER BY x.executed_at DESC), '[]'::jsonb) INTO _enviados FROM (
    SELECT m.id AS mensagem_id, m.tipo, m.client_id, app_private.nome_do_cliente(m.client_id) AS cliente, m.executed_at, m.execution_evidence
      FROM public.mensagem_automatica m
     WHERE m.executed_at IS NOT NULL ORDER BY m.executed_at DESC LIMIT 20) x;
  RETURN jsonb_build_object(
    'janela_aberta', _aberta,
    'aprovados_para_enviar', CASE WHEN _aberta THEN _aprovados ELSE '[]'::jsonb END,
    'aguardando_a_janela', CASE WHEN _aberta THEN 0 ELSE _aguardando END,
    'enviados_recentes', _enviados,
    'como_agir', jsonb_build_array(
      'aprovados_para_enviar: o dono já aprovou. Envie o texto EXATO de mensagem no grupo de destino.recipient (WhatsApp) e registre na hora com aceleriq_mensagens_automaticas_marcar_enviado, com a evidência (grupo, data e hora, id da mensagem se houver). Sem o registro, o painel considera não enviado.',
      'Só envie com janela_aberta=true (dia útil, 9h às 18h em São Paulo). Fora dela a lista vem vazia: não insista; leia de novo na próxima hora útil.',
      'Nunca escreva outra mensagem de cobrança ou lembrete por conta própria e nunca reenvie o que já está em enviados_recentes. Lista vazia não é erro.',
      'Se o cliente responder no grupo (pagou, aprovou, pediu ajuste), registre no diário do cliente; o painel para sozinho quando o pagamento ou a aprovação entra.'));
END $$;
REVOKE ALL ON FUNCTION public.mensagens_automaticas_fila_para_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mensagens_automaticas_fila_para_agente(text) TO service_role;

CREATE OR REPLACE FUNCTION public.mensagem_automatica_marcar_enviado_por_agente(_operator_slug text, _id uuid, _evidence text, _key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);
  RETURN public.mensagem_automatica_marcar_enviado(_id, _evidence, _key);
END $$;
REVOKE ALL ON FUNCTION public.mensagem_automatica_marcar_enviado_por_agente(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mensagem_automatica_marcar_enviado_por_agente(text, uuid, text, text) TO service_role;

-- ------------------------------------------------------------------ "em atraso desde"

-- Recalcula profiles.overdue_since a partir das cobranças reais: a cobrança pendente mais antiga já vencida
-- (billing.status = 'pending' e due_date antes de hoje, em São Paulo); nenhuma = NULL (pagou, limpa).
-- _aplicar = false (padrão) só lista o que mudaria. Só admin (ou o serviço).
CREATE OR REPLACE FUNCTION public.recalcular_em_atraso_desde(_aplicar boolean DEFAULT false)
RETURNS TABLE (client_id uuid, cliente text, atual date, calculado date, em_aberto numeric, muda boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::public.app_role), false) THEN
    RAISE EXCEPTION 'recalcular_em_atraso_desde: só admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH calc AS (
    SELECT p.id AS cid, COALESCE(NULLIF(btrim(p.company_name), ''), p.full_name) AS nome, p.overdue_since AS antes,
           (SELECT min(b.due_date) FROM public.billing b WHERE b.client_id = p.id AND b.status = 'pending' AND b.due_date < _hoje) AS depois,
           (SELECT COALESCE(sum(b.amount), 0) FROM public.billing b WHERE b.client_id = p.id AND b.status = 'pending' AND b.due_date < _hoje) AS aberto
      FROM public.profiles p
     WHERE p.deleted_at IS NULL
  )
  SELECT c.cid, c.nome, c.antes, c.depois, c.aberto, c.antes IS DISTINCT FROM c.depois
    FROM calc c
   WHERE c.antes IS NOT NULL OR c.depois IS NOT NULL
   ORDER BY (c.antes IS DISTINCT FROM c.depois) DESC, c.nome;
  IF _aplicar THEN
    UPDATE public.profiles p
       SET overdue_since = (SELECT min(b.due_date) FROM public.billing b WHERE b.client_id = p.id AND b.status = 'pending' AND b.due_date < _hoje)
     WHERE p.deleted_at IS NULL
       AND p.overdue_since IS DISTINCT FROM (SELECT min(b.due_date) FROM public.billing b WHERE b.client_id = p.id AND b.status = 'pending' AND b.due_date < _hoje);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.recalcular_em_atraso_desde(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_em_atraso_desde(boolean) TO authenticated, service_role;

-- ------------------------------------------------------------------ cron

-- A cada 30 min, toda hora: confere (cancela o que parou, vence o que passou); só prepara na janela.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('mensagens-automaticas')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mensagens-automaticas');
    PERFORM cron.schedule('mensagens-automaticas', '7,37 * * * *', $job$SELECT public.mensagens_automaticas_tick();$job$);
  END IF;
END
$cron$;
