-- 04/11/2026 (dono: "analise os workflows do n8n e deixe organizado e funcionando"): o ACQ-05 roda sem erro desde
-- 15/10, mas a pauta do Dia Prioritário e os incidentes só ficavam no schema acq_n8n, que ninguém lê. Agora a pauta
-- nova e o incidente novo ou reaberto chegam ao sino dos admins. Sem mudar o n8n e sem segredo novo.
-- O incidente "execuções de agente com falha" não avisa: conta tarefa do Paperclip em "bloqueado" e faria barulho.
-- Falha aqui nunca derruba a gravação do n8n.
create or replace function acq_n8n.avisar_pauta_no_sino()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  _acao jsonb := new.conteudo->'acoes'->0;
  _nome text := coalesce(nullif(new.conteudo->>'nome', ''), 'cliente');
  _qtd integer := coalesce(jsonb_array_length(new.conteudo->'acoes'), 0);
begin
  if _qtd = 0 then
    return new;
  end if;
  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
         format('Dia Prioritário de %s: %s%s', _nome, left(coalesce(_acao->>'titulo', 'ver a pauta'), 140),
                case when _qtd > 1 then format(' (e mais %s)', _qtd - 1) else '' end),
         'dia_prioritario',
         '/mesa?client=' || new.client_id::text
    from public.user_roles ur
   where ur.role = 'admin'::public.app_role;
  return new;
exception when others then
  raise warning 'acq_n8n.avisar_pauta_no_sino: %', sqlerrm;
  return new;
end;
$$;

create or replace function acq_n8n.avisar_incidente_no_sino()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.incident_key = 'ACQ-05|operadores|incidentes' then
    return new;
  end if;
  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
         format('Automação (%s): %s', new.workflow_id, left(new.titulo, 200)),
         'automacao_incidente',
         '/execucao'
    from public.user_roles ur
   where ur.role = 'admin'::public.app_role;
  return new;
exception when others then
  raise warning 'acq_n8n.avisar_incidente_no_sino: %', sqlerrm;
  return new;
end;
$$;

revoke all on function acq_n8n.avisar_pauta_no_sino() from public;
revoke all on function acq_n8n.avisar_incidente_no_sino() from public;

drop trigger if exists avisar_pauta_no_sino on acq_n8n.propostas;
create trigger avisar_pauta_no_sino
  after insert on acq_n8n.propostas
  for each row
  when (new.tipo = 'pauta_dia' and new.ambiente = 'production' and new.client_id is not null)
  execute function acq_n8n.avisar_pauta_no_sino();

drop trigger if exists avisar_incidente_novo_no_sino on acq_n8n.incidentes;
create trigger avisar_incidente_novo_no_sino
  after insert on acq_n8n.incidentes
  for each row
  when (new.estado = 'aberto')
  execute function acq_n8n.avisar_incidente_no_sino();

drop trigger if exists avisar_incidente_reaberto_no_sino on acq_n8n.incidentes;
create trigger avisar_incidente_reaberto_no_sino
  after update of estado on acq_n8n.incidentes
  for each row
  when (new.estado = 'aberto' and old.estado is distinct from 'aberto')
  execute function acq_n8n.avisar_incidente_no_sino();
