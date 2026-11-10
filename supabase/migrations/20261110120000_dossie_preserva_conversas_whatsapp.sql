-- Dossiê: a rotina de avanços deixa de apagar o que vem depois dela (10/11/2026).
--
-- Causa: dossie_registrar_avancos_interno (desde 20260918160000, ainda assim na
-- versão de 20261026120400) trata tudo a partir de "## Avanços recentes (automático"
-- como bloco descartável e grava de novo só o texto anterior + a seção nova.
-- O n8n grava "## Conversas do grupo de WhatsApp" no fim do dossiê, depois desse
-- marcador. O cron dossie-movimentos-15min reescreve e a conversa some.
-- Não há RPC neste repositório que escreva essa seção: o n8n chama o upsert
-- (ou grava o texto atual) fora daqui.
--
-- Correção, só de função, sem mexer em linha nenhuma:
-- 1) app_private.dossie_recompor_avancos separa o bloco automático da cauda.
-- 2) Seções de fora do bloco continuam. "Conversas do grupo de WhatsApp" fica
--    uma vez só (a cópia mais nova, com ou sem data no título) imediatamente
--    antes dos avanços. Os avanços continuam por último, como em regras.ts.
-- 3) A rotina usa esse texto. No mesmo dia ela não cria outra versão automática,
--    exceto para recolher uma cauda que ainda esteja depois do marcador.
-- 4) app_private.dossie_sem_avancos não muda: a revisão da Central segue
--    ignorando o bloco automático. A conversa passa a entrar nesse prefixo
--    quando a rotina a recoloca antes do marcador.

create or replace function app_private.dossie_fim_de_secao(_texto text, _inicio integer)
returns integer
language plpgsql
immutable
set search_path to ''
as $$
declare
  _rel integer;
begin
  if coalesce(_inicio, 0) < 1 then
    return 1;
  end if;
  _rel := position(E'\n## ' in substr(coalesce(_texto, ''), _inicio + 1));
  if _rel = 0 then
    return char_length(coalesce(_texto, '')) + 1;
  end if;
  return _inicio + _rel + 1;
end;
$$;

create or replace function app_private.dossie_inicio_de_titulo(_texto text, _chave text, _prefixo boolean)
returns integer
language plpgsql
immutable
set search_path to ''
as $$
declare
  _em text := coalesce(_texto, '');
  _de integer := 1;
  _pos integer;
  _nl integer;
  _linha text;
  _sep text;
begin
  if coalesce(_chave, '') = '' or _em = '' then
    return 0;
  end if;
  loop
    _pos := position(_chave in substr(_em, _de));
    exit when _pos = 0;
    _pos := _de + _pos - 1;
    if _pos = 1 or substr(_em, _pos - 1, 1) = E'\n' then
      _nl := position(E'\n' in substr(_em, _pos));
      _linha := btrim(case when _nl = 0 then substr(_em, _pos) else substr(_em, _pos, _nl - 1) end, E' \t\r');
      if not _prefixo and _linha = _chave then
        return _pos;
      end if;
      if _prefixo and left(_linha, char_length(_chave)) = _chave then
        if char_length(_linha) = char_length(_chave) then
          return _pos;
        end if;
        _sep := substr(_linha, char_length(_chave) + 1, 1);
        if _sep !~ '[[:alnum:]]' then
          return _pos;
        end if;
      end if;
    end if;
    _de := _pos + 1;
    exit when _de > char_length(_em);
  end loop;
  return 0;
end;
$$;

create or replace function app_private.dossie_tem_cauda_externa(_content text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select case
    when position('## Avanços recentes (automático' in coalesce(_content, '')) = 0 then false
    else position(
      E'\n## ' in substr(_content, position('## Avanços recentes (automático' in _content))
    ) > 0
  end;
$$;

create or replace function app_private.dossie_recompor_avancos(_content text, _secao text)
returns text
language plpgsql
immutable
set search_path to ''
as $$
declare
  _marcador constant text := '## Avanços recentes (automático';
  _whatsapp constant text := '## Conversas do grupo de WhatsApp';
  _auto text := btrim(coalesce(_secao, ''), E' \t\r\n');
  _pos integer;
  _base text;
  _resto text;
  _cursor text;
  _rel integer;
  _pedaco text;
  _linha text;
  _externas text[] := array[]::text[];
  _outras text[] := array[]::text[];
  _copias text[] := array[]::text[];
  _primeira boolean := true;
  _whatsapp_cauda text;
  _whatsapp_final text;
  _onde integer;
  _fim integer;
  _prefixo text;
  _sufixo text;
  _passos integer := 0;
begin
  _pos := position(_marcador in coalesce(_content, ''));
  if _pos = 0 then
    _base := rtrim(coalesce(_content, ''), E' \t\r\n');
  else
    _base := rtrim(substr(_content, 1, _pos - 1), E' \t\r\n');
    _resto := substr(_content, _pos);
    _cursor := _resto;
    loop
      _rel := position(E'\n## ' in _cursor);
      if _primeira then
        _primeira := false;
        exit when _rel = 0;
        _cursor := substr(_cursor, _rel + 1);
        continue;
      end if;
      if _rel = 0 then
        _pedaco := btrim(_cursor, E' \t\r\n');
      else
        _pedaco := btrim(substr(_cursor, 1, _rel - 1), E' \t\r\n');
      end if;
      _linha := btrim(split_part(_pedaco, E'\n', 1), E' \t\r');
      if _pedaco <> '' and left(_linha, char_length(_marcador)) is distinct from _marcador then
        _externas := _externas || _pedaco;
      end if;
      exit when _rel = 0;
      _cursor := substr(_cursor, _rel + 1);
    end loop;
  end if;

  foreach _pedaco in array _externas loop
    _linha := btrim(split_part(_pedaco, E'\n', 1), E' \t\r');
    if left(_linha, char_length(_whatsapp)) = _whatsapp
       and (
         char_length(_linha) = char_length(_whatsapp)
         or substr(_linha, char_length(_whatsapp) + 1, 1) !~ '[[:alnum:]]'
       ) then
      _whatsapp_cauda := _pedaco;
    else
      _outras := _outras || _pedaco;
    end if;
  end loop;

  loop
    _passos := _passos + 1;
    exit when _passos > 30;
    _onde := app_private.dossie_inicio_de_titulo(_base, _whatsapp, true);
    exit when _onde = 0;
    _fim := app_private.dossie_fim_de_secao(_base, _onde);
    _copias := _copias || btrim(
      substr(_base, _onde, greatest(_fim - _onde, 0)),
      E' \t\r\n'
    );
    _prefixo := rtrim(case when _onde > 1 then substr(_base, 1, _onde - 1) else '' end, E' \t\r\n');
    _sufixo := case when _fim <= char_length(_base) then ltrim(substr(_base, _fim), E' \t\r\n') else '' end;
    _base := coalesce(concat_ws(E'\n\n', nullif(_prefixo, ''), nullif(_sufixo, '')), '');
  end loop;

  foreach _pedaco in array _outras loop
    _linha := btrim(split_part(_pedaco, E'\n', 1), E' \t\r');
    _onde := app_private.dossie_inicio_de_titulo(_base, _linha, false);
    if _onde > 0 then
      _fim := app_private.dossie_fim_de_secao(_base, _onde);
      _prefixo := rtrim(case when _onde > 1 then substr(_base, 1, _onde - 1) else '' end, E' \t\r\n');
      _sufixo := case when _fim <= char_length(_base) then ltrim(substr(_base, _fim), E' \t\r\n') else '' end;
      _base := coalesce(concat_ws(E'\n\n', nullif(_prefixo, ''), nullif(btrim(_pedaco, E' \t\r\n'), ''), nullif(_sufixo, '')), '');
    else
      _base := case
        when btrim(coalesce(_base, ''), E' \t\r\n') = '' then btrim(_pedaco, E' \t\r\n')
        else rtrim(_base, E' \t\r\n') || E'\n\n' || btrim(_pedaco, E' \t\r\n')
      end;
    end if;
  end loop;

  if _whatsapp_cauda is not null then
    _whatsapp_final := btrim(_whatsapp_cauda, E' \t\r\n');
  elsif coalesce(array_length(_copias, 1), 0) > 0 then
    _whatsapp_final := _copias[array_length(_copias, 1)];
  end if;

  if _whatsapp_final is not null and btrim(_whatsapp_final, E' \t\r\n') <> '' then
    _base := case
      when btrim(coalesce(_base, ''), E' \t\r\n') = '' then btrim(_whatsapp_final, E' \t\r\n')
      else rtrim(_base, E' \t\r\n') || E'\n\n' || btrim(_whatsapp_final, E' \t\r\n')
    end;
  end if;

  if _auto = '' then
    return coalesce(_base, '');
  end if;
  if btrim(coalesce(_base, ''), E' \t\r\n') = '' then
    return _auto;
  end if;
  return rtrim(_base, E' \t\r\n') || E'\n\n' || _auto;
end;
$$;

revoke all on function app_private.dossie_fim_de_secao(text, integer) from public, anon, authenticated;
revoke all on function app_private.dossie_inicio_de_titulo(text, text, boolean) from public, anon, authenticated;
revoke all on function app_private.dossie_tem_cauda_externa(text) from public, anon, authenticated;
revoke all on function app_private.dossie_recompor_avancos(text, text) from public, anon, authenticated;

create or replace function public.dossie_registrar_avancos_interno(_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _atual public.client_dossiers%rowtype;
  _marcador constant text := '## Avanços recentes (automático';
  _secao text;
  _novo text;
begin
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null and d.is_current
    limit 1;
  if not found then
    return false;
  end if;
  -- 26/10/2026: no máximo uma versão automática por dia. 10/11/2026: se o n8n
  -- anexou uma seção depois do marcador, esta passagem ainda recolhe a cauda.
  if position(_marcador in _atual.content) > 0
     and not app_private.dossie_tem_cauda_externa(_atual.content)
     and exists (
       select 1 from public.client_dossiers d
        where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null
          and app_private.dossie_versao_automatica(d.change_reason, d.tags)
          and d.created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
     ) then
    return false;
  end if;
  _secao := public.dossie_avancos_texto(_client_id, 14);
  _novo := app_private.dossie_recompor_avancos(_atual.content, _secao);
  if btrim(coalesce(_novo, ''), E' \t\r\n') = btrim(coalesce(_atual.content, ''), E' \t\r\n') then
    return false;
  end if;
  perform public.upsert_current_dossier(
    _client_id := _client_id,
    _content := _novo,
    _dossier_type := 'contexto',
    _project_id := null,
    _summary := _atual.summary,
    _change_reason := 'Movimentos automáticos do painel (14 dias)',
    _source := 'painel',
    _actor := 'ciclo',
    _tags := array['avancos-automaticos'],
    _metadata := coalesce(_atual.metadata, '{}'::jsonb) || jsonb_build_object('auto_avancos', true, 'auto_avancos_em', now()),
    _expected_version := _atual.version
  );
  return true;
end;
$function$;

revoke all on function public.dossie_registrar_avancos_interno(uuid) from public, anon, authenticated;
