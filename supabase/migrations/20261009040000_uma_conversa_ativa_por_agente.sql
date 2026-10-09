-- Uma conversa ativa por agente e referência (lote B, 09/10/2026).
-- O "Nova conversa" antigo de Contratos, Estilo, Foto (e das outras Mesas)
-- criava outra conversa sem arquivar a anterior: o histórico mostrava duas
-- "atuais". Aqui, ao nascer uma conversa ativa, as outras ativas da mesma
-- chave (cliente, agente, tipo e referência) vão para o arquivo. Nada é
-- apagado; "Continuar esta" no Histórico desarquiva quando a equipe quer.
-- Não mexe no que já existe (só vale para conversas novas).

create or replace function app_private.agente_conversa_unica_ativa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.arquivada_em is null then
    update public.agente_conversas
      set arquivada_em = now()
    where client_id = new.client_id
      and agente = new.agente
      and referencia_tipo is not distinct from new.referencia_tipo
      and referencia_id is not distinct from new.referencia_id
      and arquivada_em is null
      and id <> new.id;
  end if;
  return new;
end;
$$;

revoke all on function app_private.agente_conversa_unica_ativa() from public;

drop trigger if exists agente_conversas_uma_ativa on public.agente_conversas;
create trigger agente_conversas_uma_ativa
  before insert on public.agente_conversas
  for each row execute function app_private.agente_conversa_unica_ativa();
