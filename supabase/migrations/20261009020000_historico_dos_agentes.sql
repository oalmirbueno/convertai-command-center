-- Histórico dos agentes das Mesas (lote B, 09/10/2026): a mesma ideia das
-- conversas do Gestor, na tabela que os agentes já usam (agente_conversas).
-- - titulo: nasce da primeira pergunta da equipe (o gatilho preenche; a tela edita);
-- - atualizado_em: última mensagem (ordena a lista);
-- - arquivada_em: "Nova conversa" arquiva a atual; nada é apagado.
-- As funções passam a continuar só a conversa não arquivada.

alter table public.agente_conversas
  add column if not exists titulo text,
  add column if not exists atualizado_em timestamptz,
  add column if not exists arquivada_em timestamptz;

create index if not exists agente_conversas_lista_idx
  on public.agente_conversas (client_id, agente, referencia_tipo, arquivada_em, atualizado_em desc);

-- Gatilho leve (uma linha atualizada por mensagem): última atividade e título.
create or replace function app_private.agente_conversa_tocada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.agente_conversas c set
    atualizado_em = greatest(coalesce(c.atualizado_em, new.criado_em), new.criado_em),
    titulo = coalesce(c.titulo, case when new.papel = 'usuario' and coalesce(trim(new.conteudo), '') <> ''
      then left(regexp_replace(trim(new.conteudo), '\s+', ' ', 'g'), 80) end)
  where c.id = new.conversa_id;
  return new;
end;
$$;

revoke all on function app_private.agente_conversa_tocada() from public;

drop trigger if exists agente_mensagens_toca_conversa on public.agente_mensagens;
create trigger agente_mensagens_toca_conversa
  after insert on public.agente_mensagens
  for each row execute function app_private.agente_conversa_tocada();

-- O que já existe: última atividade e título pela primeira pergunta.
update public.agente_conversas c set
  atualizado_em = coalesce((select max(m.criado_em) from public.agente_mensagens m where m.conversa_id = c.id), c.criado_em),
  titulo = coalesce(c.titulo, (
    select left(regexp_replace(trim(m.conteudo), '\s+', ' ', 'g'), 80)
    from public.agente_mensagens m
    where m.conversa_id = c.id and m.papel = 'usuario' and coalesce(trim(m.conteudo), '') <> ''
    order by m.criado_em asc limit 1))
where c.atualizado_em is null or c.titulo is null;
