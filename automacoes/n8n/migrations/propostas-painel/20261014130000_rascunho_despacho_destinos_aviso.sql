-- RASCUNHO — NÃO APLICAR. NÃO TESTADO CONTRA O SCHEMA REAL.
-- Proposta para o lote do painel (itens 5, 6, 7 e 8 de docs/MUDANCAS-NO-PAINEL.md).
-- Antes de virar migration: conferir contra supabase/migrations atuais, escrever preflight, rollback
-- lógico e testes; seguir o fluxo do AGENTS.md (branch, PR, revisão humana, autorização explícita).

-- 5. Despacho com lease e estados de entrega (hoje: preparado/aprovado/enviado/confirmado/erro/incerto/invalidado)
alter table public.central_review_dispatches
  add column if not exists lease_dono text,
  add column if not exists lease_ate timestamptz,
  add column if not exists tentativas integer not null default 0,
  add column if not exists provedor text,
  add column if not exists provider_message_id text,
  add column if not exists aceito_em timestamptz,
  add column if not exists entregue_em timestamptz,
  add column if not exists lido_em timestamptz;
-- O CHECK de status precisaria incluir 'reivindicado', 'enviando', 'aceito', 'entregue', 'lido'.

-- Reivindicação atômica (um consumidor por aprovação), revalidando validade e fonte NO claim.
create or replace function public.central_review_reivindicar_envio_por_agente(_operator_slug text, _lease_segundos integer, _limite integer)
returns setof public.central_review_dispatches language plpgsql security definer set search_path = public as $$
begin
  perform app_private.agente_assume_admin(_operator_slug);
  return query
  update public.central_review_dispatches d set status = 'reivindicado', lease_dono = _operator_slug,
    lease_ate = now() + make_interval(secs => _lease_segundos), tentativas = d.tentativas + 1, updated_at = now()
   where d.approval_id in (
     select a.id from public.operator_approvals a join public.central_review_dispatches x on x.approval_id = a.id
      where a.origin = 'central' and a.status = 'aprovado' and a.executed_at is null and a.invalidated_at is null
        and a.valid_until > now()
        and (x.status = 'aprovado' or (x.status = 'reivindicado' and x.lease_ate < now()))
      order by a.decided_at
      for update of x skip locked
      limit _limite)
  returning d.*;
end $$;

-- 6. Destino técnico aprovado por cliente (o nome do grupo deixa de ser identidade).
create table if not exists public.client_message_destinations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  canal text not null check (canal in ('whatsapp_grupo', 'whatsapp_contato')),
  provedor text not null,
  rotulo text not null,
  destino_tecnico text not null,
  aprovado_por uuid not null,
  aprovado_em timestamptz not null default now(),
  evidencia text not null,
  ativo boolean not null default true,
  unique (provedor, destino_tecnico)
);
-- RLS: leitura e escrita só admin (can_manage_client); n8n lê pelo MCP (ferramenta nova, leitura).

-- 7. Aviso de publicação na mesma revisão (sem inventar ritual): nova origem com vínculo à publicação.
-- operator_approvals.origin passa a aceitar 'aviso_publicacao' com publication_id obrigatório,
-- payload congelado {mensagem, permalink, screenshot_file_id, platform_media_id} e o mesmo decide/marcar_enviado.
alter table public.operator_approvals add column if not exists publication_id uuid;
-- + CHECK (origin <> 'aviso_publicacao' or publication_id is not null)
-- + RPC central_review_preparar_aviso_por_agente(_operator_slug, _publication_id, _destination, _idempotency_key, _mensagem)

-- 8. Expiração formal dos pedidos vencidos (hoje ficam 'pendente' depois de valid_until).
create or replace function public.central_review_expirar_vencidos()
returns integer language sql security definer set search_path = public as $$
  with x as (
    update public.operator_approvals set status = 'expirado', invalidation_reason = 'valid_until_passou', invalidated_at = now()
     where origin = 'central' and status = 'pendente' and valid_until < now() returning id)
  select count(*)::int from x;
$$;
-- agendamento sugerido: pg_cron a cada hora (decisão do dono).
