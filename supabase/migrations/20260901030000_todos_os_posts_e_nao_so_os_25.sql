-- ═══════════════════════════════════════════════════════════════════════
-- TODOS OS POSTS, E NAO SO OS 25 MAIS RECENTES.
--
-- "Tem clientes cadastrados ali que falta posts." A queixa e exata, e a
-- causa estava numa linha: a URL de midia pedia `&limit=25` e o painel
-- lia apenas `data`, sem nunca seguir `paging.cursors.after`.
--
-- Resultado: cada conta ficou congelada nos 25 posts mais recentes desde
-- sempre. Nao era falha intermitente nem token vencido — era o teto da
-- primeira pagina, e ele nunca aparecia como erro porque a resposta vinha
-- 200 com dados. Silencio lido como completude, de novo.
--
-- Agora a coleta ANDA pelas paginas: cada resposta que traz um cursor
-- enfileira a proxima, ate a conta acabar. O passo continua sendo uma
-- pagina por vez, de proposito — puxar tudo numa chamada estouraria o
-- limite da Meta e derrubaria a coleta inteira junto.
--
-- Nao altera metricas ja coletadas: o upsert por (conta, media_id) apenas
-- acrescenta o que faltava. Rollback: remover a coluna e restaurar as
-- duas funcoes.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) A fila guarda onde parou ────────────────────────────────────────
alter table social_private.social_metrics_requests
  add column if not exists after_cursor text;

-- Quantas paginas ja andamos nesta varredura. Um teto explicito impede
-- que uma conta com anos de historico prenda a fila para sempre — e o
-- numero fica visivel em vez de escondido num loop.
alter table social_private.social_metrics_requests
  add column if not exists page_no integer not null default 1;

-- ─── 2) A URL aceita o cursor ───────────────────────────────────────────
create or replace function social_private.social_metrics_url(
  _kind text, _ig text, _token text, _week_start date, _week_end date,
  _after text default null
)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  SELECT CASE _kind
    WHEN 'profile' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '?fields=followers_count,media_count&access_token=' || _token
    WHEN 'reach' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=reach&period=day&since=' || _week_start::text
      || '&until=' || (_week_end + 1)::text || '&access_token=' || _token
    WHEN 'posts' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/media?fields=id,caption,timestamp,media_type,permalink,like_count,comments_count,media_url,thumbnail_url'
      -- 100 e o teto pratico da Meta para media. Vinte e cinco era o que
      -- fazia caber tudo numa pagina so na cabeca de quem escreveu, e nao
      -- na conta de quem posta todo dia.
      || '&limit=100'
      || COALESCE('&after=' || _after, '')
      || '&access_token=' || _token
    WHEN 'post_insights' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=reach,saved,shares,total_interactions&access_token=' || _token
    WHEN 'identity' THEN
      'https://graph.facebook.com/v21.0/' || _ig
      || '?fields=username,name,biography,website,profile_picture_url&access_token=' || _token
    ELSE
      'https://graph.facebook.com/v21.0/' || _ig
      || '/insights?metric=profile_views,accounts_engaged,total_interactions'
      || '&metric_type=total_value&period=day&since=' || _week_start::text
      || '&until=' || (_week_end + 1)::text || '&access_token=' || _token
  END;
$function$;

-- ─── 3) O tick segue o cursor ───────────────────────────────────────────
--
-- Patch cirurgico em duas ancoras da definicao VIVA. A funcao tem 14 mil
-- caracteres de regras acumuladas (retentativa, expiracao, insights,
-- identidade) e reescreve-la para mudar dois pontos seria arriscar tudo o
-- que nao muda.
do $patch$
declare
  _def text;
  _oid oid;

  -- (a) depois de gravar a pagina, enfileirar a proxima se houver cursor.
  _fim_posts constant text := $a$        END LOOP;
      ELSIF _req.kind = 'identity' THEN$a$;
  _fim_posts_novo constant text := $n$        END LOOP;

        -- A PROXIMA PAGINA.
        --
        -- Sem isto a coleta parava na primeira e a conta ficava congelada
        -- nos posts mais recentes — parecendo completa, porque a resposta
        -- vinha 200 com dados.
        --
        -- O teto de 40 paginas existe para uma conta com anos de historico
        -- nao prender a fila; a 4000 posts por varredura, ninguem real
        -- esbarra nele, e quem esbarrar aparece na fila em vez de sumir.
        IF COALESCE(_body#>>'{paging,cursors,after}', '') <> ''
           AND jsonb_array_length(COALESCE(_body->'data', '[]'::jsonb)) > 0
           AND COALESCE(_req.page_no, 1) < 40 THEN
          INSERT INTO social_private.social_metrics_requests
            (external_account_id, client_id, kind, week_start, week_end,
             after_cursor, page_no)
          VALUES (_req.external_account_id, _req.client_id, 'posts',
                  _req.week_start, _req.week_end,
                  _body#>>'{paging,cursors,after}', COALESCE(_req.page_no, 1) + 1);
        END IF;
      ELSIF _req.kind = 'identity' THEN$n$;

  -- (b) o despacho passa o cursor guardado.
  _despacho constant text := $a$    _url := social_private.social_metrics_url(
      _req.kind,
      CASE WHEN _req.kind = 'post_insights' THEN _req.media_id ELSE _token_resource END,
      _token_secret, _req.week_start, _req.week_end);$a$;
  _despacho_novo constant text := $n$    _url := social_private.social_metrics_url(
      _req.kind,
      CASE WHEN _req.kind = 'post_insights' THEN _req.media_id ELSE _token_resource END,
      _token_secret, _req.week_start, _req.week_end, _req.after_cursor);$n$;
begin
  select p.oid into _oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'social_metrics_tick';
  if _oid is null then
    raise exception 'patch_alvo_ausente: social_metrics_tick nao existe';
  end if;

  _def := pg_get_functiondef(_oid);
  if position(_fim_posts in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o bloco de posts do tick mudou de forma';
  end if;
  if position(_despacho in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o despacho do tick mudou de forma';
  end if;

  _def := replace(_def, _fim_posts, _fim_posts_novo);
  _def := replace(_def, _despacho, _despacho_novo);
  execute _def;
end $patch$;

-- ─── 4) Uma varredura completa agora ────────────────────────────────────
--
-- A guarda de "coletado nos ultimos 30 minutos" impediria a primeira
-- pagina de sair hoje. Enfileirar a mao dispara a varredura para as contas
-- conectadas, e a paginacao cuida do resto sozinha.
insert into social_private.social_metrics_requests
  (external_account_id, client_id, kind, week_start, week_end, page_no)
select a.id, a.client_id, 'posts',
       (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date::timestamp)::date - 7),
       (date_trunc('week', (now() at time zone 'America/Sao_Paulo')::date::timestamp)::date - 1),
       1
  from public.external_accounts a
  join public.external_account_connections c
    on c.external_account_id = a.id and c.connection_status = 'connected'
 where a.platform = 'instagram' and a.status = 'active'
   and not exists (
     select 1 from social_private.social_metrics_requests r
      where r.external_account_id = a.id and r.kind = 'posts'
   );
