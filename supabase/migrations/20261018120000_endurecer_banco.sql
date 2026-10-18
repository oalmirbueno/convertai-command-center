-- Endurecer o banco (18/10/2026): três achados do advisor e do log de consultas lentas.
--
-- 1. search_path fixo nas funções do schema acq_n8n (aviso "function_search_path_mutable", 22 funções).
-- 2. Consulta lenta (14 s) em mcp_audit_log: filtro por created_at e agrupamento por origin.
-- 3. public.autopublish_status_secure (erro "security_definer_view"): fica como está, de propósito.
--
-- Idempotente. Não aplicar direto: o dono aplica e registra no manifesto depois.

-- ---------------------------------------------------------------------------
-- 1. acq_n8n: search_path fixo
-- ---------------------------------------------------------------------------
-- As 22 funções nasceram em C:\AI\lf-N8N\automacoes\n8n\migrations\20261014120000_acq_n8n_estado.sql
-- (fora de supabase/migrations de propósito, aplicada à mão em 14/10) sem SET search_path:
-- registrar_evento, cursor_ler, cursor_avancar, observar, incidente_registrar, incidente_resolver,
-- proposta_registrar, proposta_mudar_estado, saida_imutavel (gatilho), saida_enfileirar,
-- saida_reivindicar, saida_iniciar_envio, saida_concluir_sem_envio, saida_resultado_transporte,
-- saida_expirar_envios, saida_conciliar_incerta, saida_registro_painel, recibo_registrar,
-- mensagem_registrar, mensagem_transcricao, mensagem_concluir, fato_propor.
-- Todas são SECURITY INVOKER e citam as tabelas com o prefixo acq_n8n.; o search_path fixo não muda
-- o que elas fazem, só tira a dependência do search_path de quem chama.
-- O laço lê pg_proc em vez de repetir as assinaturas: só funções comuns (prokind = 'f') do schema,
-- sem configuração própria (proconfig nulo) e que não sejam de extensão. Sem o schema (banco novo,
-- CI), o laço não encontra nada e não faz nada.
DO $$
DECLARE
  _f record;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure AS assinatura
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'acq_n8n'
       AND p.prokind = 'f'
       AND p.proconfig IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = acq_n8n, public, pg_temp', _f.assinatura);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. mcp_audit_log: índice para o filtro por data com o agrupamento por origin
-- ---------------------------------------------------------------------------
-- mcp_audit_log_created_at_idx (created_at DESC) já existe desde
-- 20260712183604_f3976c84-1d30-4e56-b4cd-e0ac38e818b5.sql; repetir não muda nada. A consulta lenta
-- filtra por created_at e agrupa por origin, então precisa ler origin de cada linha do intervalo; com o
-- índice só de created_at isso é uma ida à tabela por linha (a linha carrega sanitized_input em jsonb).
-- Este índice leva origin junto (INCLUDE) e permite varredura só do índice no intervalo. Escolhido no
-- lugar de (origin, created_at): com origin na frente, o filtro por data não limita a varredura.
-- Não é CONCURRENTLY (a migração roda em transação): trava a escrita no registro durante a criação.
CREATE INDEX IF NOT EXISTS mcp_audit_log_created_at_origin_idx
  ON public.mcp_audit_log (created_at DESC) INCLUDE (origin);

-- ---------------------------------------------------------------------------
-- 3. autopublish_status_secure: continua SECURITY DEFINER, sem mudança
-- ---------------------------------------------------------------------------
-- A vista (20260813190000_autopublish_enable_and_visibility.sql) lê social_private.autopublish_jobs,
-- que guarda o estado do motor de publicação e não é do painel: authenticated não tem USAGE no schema
-- social_private, a tabela tem REVOKE ALL de PUBLIC, anon e authenticated e RLS ligada sem política
-- nenhuma (20260812140000_editorial_autopublish_worker.sql). Com security_invoker = true a tela
-- (src/hooks/useAutopublishStatus.ts e a entrega na Agenda) receberia "permission denied for schema
-- social_private": o RLS da tabela de baixo não libera as mesmas linhas para ninguém.
-- A vista é o recorte seguro de propósito: só 8 colunas de estado (sem token e sem segredo), filtro
-- is_staff(auth.uid()) AND can_access_client(job.client_id) dentro dela, security_barrier ligado
-- (20260921140000) e só SELECT para authenticated (20260930293400). O erro security_definer_view do
-- advisor é esperado aqui e fica registrado neste comentário.

-- Conferência depois de aplicar (só leitura):
-- select p.oid::regprocedure, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'acq_n8n' order by 1;   -- todas com {"search_path=acq_n8n, public, pg_temp"}
-- select indexname, indexdef from pg_indexes where tablename = 'mcp_audit_log' order by 1;
