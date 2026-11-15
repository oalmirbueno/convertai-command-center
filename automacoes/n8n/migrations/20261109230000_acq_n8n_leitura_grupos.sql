-- ACQ n8n — leitura diária dos grupos de clientes (pedido do Almir em 09/11/2026).
-- Só o schema isolado acq_n8n; nenhuma tabela do painel é tocada. Pode rodar mais de uma vez.
--
-- 1) a mensagem guarda quem falou (nome do WhatsApp), se saiu do nosso número e a que mensagem responde;
-- 2) em grupo com leitura liberada, quem não está cadastrado conta como "equipe do cliente" (nunca decisor):
--    antes ficava parado em revisão por "remetente desconhecido" e nada era lido;
-- 3) os 12 grupos liberados pelo Almir entram com leitura ligada, e o nosso próprio número entra como "bot".

alter table acq_n8n.mensagens_entrada add column if not exists remetente_nome text;
alter table acq_n8n.mensagens_entrada add column if not exists de_mim boolean not null default false;
alter table acq_n8n.mensagens_entrada add column if not exists resposta_a text;
create index if not exists mensagens_cliente_tempo on acq_n8n.mensagens_entrada (client_id, occurred_at desc);

create or replace function acq_n8n.mensagem_registrar(_m jsonb)
returns jsonb language plpgsql as $$
declare _id uuid; _g acq_n8n.grupos_cliente; _papel text; _ex acq_n8n.mensagens_entrada; _liberado boolean;
begin
  select * into _g from acq_n8n.grupos_cliente where provedor = _m->>'provedor' and group_id = _m->>'group_id';
  _liberado := coalesce(_g.leitura_liberada, false);
  select papel into _papel from acq_n8n.remetentes
   where provedor = _m->>'provedor' and remetente = _m->>'remetente' and (client_id = _g.client_id or papel in ('agencia', 'bot'))
   order by case papel when 'bot' then 0 else 1 end limit 1;
  if coalesce((_m->>'de_mim')::boolean, false) then _papel := 'bot'; end if;
  if _papel is null and _liberado then _papel := 'cliente_equipe'; end if;
  insert into acq_n8n.mensagens_entrada (provedor, provider_message_id, group_id, client_id, remetente, papel, occurred_at,
    tipo, texto, media_id, transcricao_status, estado, motivo, remetente_nome, de_mim, resposta_a)
  values (_m->>'provedor', _m->>'provider_message_id', _m->>'group_id',
    case when _liberado then _g.client_id end, _m->>'remetente', _papel, (_m->>'occurred_at')::timestamptz,
    _m->>'tipo', _m->>'texto', _m->>'media_id',
    case when _m->>'tipo' = 'audio' then 'pendente' else 'nao_aplicavel' end,
    case when _papel = 'bot' then 'descartada' when _g.client_id is null or not _liberado then 'em_revisao'
         when _papel is null then 'em_revisao' else 'recebida' end,
    case when _papel = 'bot' then 'mensagem_do_proprio_bot' when _g.client_id is null then 'grupo_sem_vinculo_aprovado'
         when not _liberado then 'leitura_do_grupo_nao_liberada'
         when _papel is null then 'remetente_desconhecido' end,
    _m->>'remetente_nome', coalesce((_m->>'de_mim')::boolean, false), _m->>'resposta_a')
  on conflict (provedor, provider_message_id) do nothing returning id into _id;
  if _id is not null then
    select * into _ex from acq_n8n.mensagens_entrada where id = _id;
    return jsonb_build_object('novo', true, 'id', _id, 'client_id', _ex.client_id, 'papel', _ex.papel, 'estado', _ex.estado, 'motivo', _ex.motivo);
  end if;
  select * into _ex from acq_n8n.mensagens_entrada where provedor = _m->>'provedor' and provider_message_id = _m->>'provider_message_id';
  return jsonb_build_object('novo', false, 'id', _ex.id, 'client_id', _ex.client_id, 'papel', _ex.papel, 'estado', _ex.estado, 'motivo', 'duplicada');
end $$;

insert into acq_n8n.grupos_cliente (provedor, group_id, client_id, rotulo, leitura_liberada, aprovado_por, aprovado_em) values
  ('baileys_3429', '120363428599963988@g.us', '39ebda82-637c-498b-a23a-b622f645e852', 'Acerbi (CME) - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363423049836757@g.us', 'eb1270a5-4d9e-4c67-bb17-e25fa12ada34', 'Mirante Luz Floripa - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363429066427891@g.us', '5ae0705e-6f8c-40f1-b076-867fd2ab3178', 'Preserva Eco - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363412288631453@g.us', '52f2efb6-9928-4074-b8e2-bc972baf1f6a', 'Rd Ar - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363428053001812@g.us', 'bad69252-05ad-4b80-ab76-4a0e9fd3c314', 'SKC CONTABIL  - MKT - ACELERIQ', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363411747461813@g.us', '6a847578-ba39-44cd-be61-08e34e18e4c9', 'Stop - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363426246084548@g.us', '8801caa5-7505-44c9-9c14-e3019eace772', 'Terra Flor - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363411010558392@g.us', '3ba9540c-bc09-4026-b575-05fd0df4195f', 'Thainá Rosa - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363408413329860@g.us', 'e590497e-f985-47be-b8f2-493bae1da7df', 'Verzelo - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363430155631136@g.us', '3d08338c-0c3b-453f-a64f-79a55c5711e8', 'Softy - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363413077517896@g.us', 'd3dacbac-0da6-49eb-8322-31ae22bd79b4', 'Casa dos Assados - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z'),
  ('baileys_3429', '120363431505782128@g.us', '213848fc-5a01-400b-8896-ddde03ba33ec', 'Skyfleet - MKT - Aceleriq', true, 'Almir', '2026-11-09T23:00:00Z')
on conflict (provedor, group_id) do update set leitura_liberada = true, client_id = excluded.client_id, rotulo = excluded.rotulo;

insert into acq_n8n.remetentes (provedor, remetente, client_id, papel, nome)
select 'baileys_3429', 'eu', null, 'bot', 'Número da equipe (Hermes e avisos)'
where not exists (select 1 from acq_n8n.remetentes where provedor = 'baileys_3429' and remetente = 'eu');

grant select, insert, update on all tables in schema acq_n8n to acq_n8n_worker;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
