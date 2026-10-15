-- Seção automática do dossiê com teto de tamanho (14/10/2026).
--
-- Problema: "Avanços recentes (automático)" listava até 120 movimentos dos últimos 14 dias. Num cliente
-- ativo (Mirante, 14/10) isso dava 116 movimentos e ~27 mil caracteres, quase metade do dossiê, e o dossiê
-- passava do limite de 60 mil que o MCP aceita para escrita (Hermes e automações).
--
-- Correção: os mesmos 14 dias, do mais recente para o mais antigo, até 12 mil caracteres de itens. O que
-- não couber vira uma linha "(+N movimentos mais antigos no histórico completo.)". Nada é apagado: a lista
-- completa continua em movimentos_do_cliente, no Cérebro do cliente e nas versões anteriores do dossiê.
-- Só muda o texto gerado; assinatura, segurança e permissões são as mesmas.

CREATE OR REPLACE FUNCTION public.dossie_avancos_texto(_client_id uuid, _dias integer DEFAULT 14)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH mov AS (
    SELECT m.quando, m.tipo, m.titulo, m.detalhe, m.visivel_ao_cliente, m.link,
           (m.quando AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
           row_number() OVER (ORDER BY m.quando DESC) AS pos
      FROM public.movimentos_do_cliente(_client_id, now() - make_interval(days => _dias), now(), false) m
  ),
  linhas AS (
    SELECT mov.*,
           '- ' || to_char(quando AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') || ' · ' || titulo
           || CASE WHEN detalhe IS NOT NULL THEN ' — ' || btrim(regexp_replace(detalhe, '\s+', ' ', 'g')) ELSE '' END
           || CASE WHEN link IS NOT NULL THEN ' ' || link ELSE '' END
           || CASE WHEN visivel_ao_cliente THEN '' ELSE ' [interno]' END AS linha
      FROM mov
     WHERE pos <= 120
  ),
  acumulado AS (
    SELECT linhas.*, sum(length(linha) + 1) OVER (ORDER BY quando DESC, pos ROWS UNBOUNDED PRECEDING) AS soma
      FROM linhas
  ),
  -- Teto de 12 mil caracteres de itens; o movimento mais recente entra sempre.
  limitado AS (SELECT * FROM acumulado WHERE soma <= 12000 OR pos = 1),
  dias AS (
    SELECT dia,
           '**' || CASE extract(isodow FROM dia)
             WHEN 1 THEN 'Segunda' WHEN 2 THEN 'Terça' WHEN 3 THEN 'Quarta' WHEN 4 THEN 'Quinta'
             WHEN 5 THEN 'Sexta' WHEN 6 THEN 'Sábado' ELSE 'Domingo' END
           || ', ' || to_char(dia, 'DD/MM') || '**' || E'\n'
           || string_agg(linha, E'\n' ORDER BY quando DESC) AS bloco
      FROM limitado
     GROUP BY dia
  ),
  agenda AS (
    SELECT e.scheduled_at, coalesce(po.title, 'publicação') AS title, po.content_type, e.platform
      FROM public.editorial_publications e
      LEFT JOIN public.editorial_posts po ON po.id = e.post_id
     WHERE e.client_id = _client_id AND e.status = 'scheduled' AND e.scheduled_at > now()
     ORDER BY e.scheduled_at
     LIMIT 12
  ),
  aguardando AS (
    SELECT public.rotulo_do_material(f.file_type, f.folder) || ' "' || public.nome_do_material(f.file_name) || '"' AS item, f.approval_requested_at
      FROM public.files f
     WHERE f.client_id = _client_id AND f.parent_file_id IS NULL AND f.archived_at IS NULL
       AND f.approval_status = 'pending' AND f.visibility = 'approval'
     ORDER BY f.approval_requested_at DESC NULLS LAST
     LIMIT 12
  )
  SELECT concat_ws(E'\n',
    '## Avanços recentes (automático, ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
    'Registro gerado pelo painel a partir do que aconteceu nos últimos ' || _dias || ' dias, dia a dia. Não edite esta seção: ela é reescrita. Itens marcados [interno] não aparecem para o cliente.',
    CASE WHEN EXISTS (SELECT 1 FROM dias) THEN E'\n' || (SELECT string_agg(bloco, E'\n\n' ORDER BY dia DESC) FROM dias)
         ELSE E'\nSem movimentos registrados no período.' END,
    CASE WHEN (SELECT count(*) FROM mov) > (SELECT count(*) FROM limitado)
         THEN '(+' || ((SELECT count(*) FROM mov) - (SELECT count(*) FROM limitado)) || ' movimentos mais antigos no histórico completo.)' END,
    CASE WHEN EXISTS (SELECT 1 FROM aguardando) THEN
      E'\n**Aguardando aprovação do cliente:** ' || (SELECT string_agg(item || CASE WHEN approval_requested_at IS NOT NULL THEN ' (desde ' || to_char(approval_requested_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') || ')' ELSE '' END, '; ') FROM aguardando) END,
    E'\n**Agenda à frente:** ' || CASE WHEN EXISTS (SELECT 1 FROM agenda)
      THEN (SELECT string_agg(public.rotulo_do_material(NULL, NULL, content_type) || ' "' || public.nome_do_material(title) || '" ' || to_char(scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') || CASE WHEN platform IS NOT NULL THEN ' (' || initcap(platform) || ')' ELSE '' END, '; ' ORDER BY scheduled_at) FROM agenda)
      ELSE 'nada agendado.' END
  );
$$;

-- Mesmas permissões de antes (20260921130000): só backend e equipe pelas funções com guarda.
REVOKE EXECUTE ON FUNCTION public.dossie_avancos_texto(uuid, integer) FROM PUBLIC, anon, authenticated;
