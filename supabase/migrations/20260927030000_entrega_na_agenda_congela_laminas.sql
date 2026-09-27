-- Frente EA, conserto de 27/09: a peça entregue entra na Agenda ANTES da
-- aprovação do cliente, e a Agenda só congela arquivo aprovado. Então a
-- publicação fica sem as lâminas (editorial_publication_assets vazio). No
-- caminho antigo o post nascia na aprovação, já com asset_file_ids; no novo,
-- ninguém congelava depois, e o promotor agendaria com 0 lâminas e em modo
-- manual (o autopublish não posta). Visto no teste real da conta da agência.
--
-- Conserto: quando o cliente aprova e a peça da frente EA tem data
-- confirmada, o agendador da Mesa congela as lâminas na ordem do Estúdio e
-- escolhe o modo de entrega pela mesma regra do caminho antigo, antes do
-- promotor agendar. Sem data, nada muda: ao confirmar a data depois da
-- aprovação, a função estudio-arte já manda as lâminas.
-- Falha vira WARNING (a fila da Mesa segue).

DO $patch$
DECLARE
  _fonte text;
  _decl text := '  _segurada boolean;';
  _alvo text := '        -- "Publicar assim que aprovar" e aprovação além da janela de 6 h do';
  _novo text := '        -- Conserto 27/09: a peça entrou na Agenda antes da aprovação, sem as
        -- lâminas (a Agenda só congela arquivo aprovado). Aprovada e com data:
        -- congela as lâminas na ordem do Estúdio e o modo de entrega, pela
        -- mesma regra do caminho antigo, antes de o promotor agendar.
        IF _pub_id IS NOT NULL AND _pub_status = ''planned'' AND _quando IS NOT NULL
          AND _t.agenda_sincronizada_em IS NOT NULL
          AND cardinality(_t.file_ids) > 0
          AND NOT EXISTS (
            SELECT 1 FROM social_private.editorial_publication_assets a WHERE a.publication_id = _pub_id
          ) THEN
          BEGIN
            SELECT pub.external_account_id INTO _pub_conta
              FROM public.editorial_publications pub WHERE pub.id = _pub_id;
            _pub_modo := CASE
              WHEN EXISTS (
                SELECT 1 FROM public.external_account_connections c
                 WHERE c.external_account_id = _pub_conta
                   AND c.client_id = _t.client_id
                   AND c.provider = ''meta''
                   AND c.connection_status = ''connected''
                   AND COALESCE(c.automation_enabled, false)
                   AND (c.expires_at IS NULL OR c.expires_at > now())
              )
                AND cardinality(_t.file_ids) BETWEEN 1 AND 10
                AND NOT EXISTS (
                  SELECT 1 FROM public.files fr
                   WHERE (fr.id = _f.file_id OR fr.parent_file_id = _f.file_id)
                     AND (fr.sha256 IS NULL OR lower(fr.sha256) !~ ''^[0-9a-f]{64}$'')
                )
                THEN ''automatic''
              ELSE ''manual''
            END;
            PERFORM set_config(''request.jwt.claims'',
              json_build_object(''sub'', _admin::text, ''role'', ''authenticated'')::text, true);
            PERFORM social_private.capture_editorial_asset_snapshots(
              _post,
              jsonb_build_object(''publications'', jsonb_build_array(jsonb_build_object(
                ''id'', _pub_id,
                ''external_account_id'', _pub_conta,
                ''asset_file_ids'', to_jsonb(_t.file_ids),
                ''delivery_mode'', _pub_modo,
                ''scheduled_at'', _quando,
                ''scheduled_timezone'', _pub_fuso
              ))),
              false
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING ''mesa_agendar_aprovados: lâminas da peça % não congeladas: %'', _t.id, SQLERRM;
          END;
        END IF;

';
BEGIN
  SELECT pg_get_functiondef('public.mesa_agendar_aprovados()'::regprocedure) INTO _fonte;
  IF position('lâminas da peça % não congeladas' IN _fonte) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(_decl IN _fonte) = 0 OR position(_alvo IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch mesa_agendar_aprovados (lâminas): alvo nao encontrado';
  END IF;
  _fonte := replace(_fonte, _decl, _decl || '
  _pub_conta uuid;');
  EXECUTE replace(_fonte, _alvo, _novo || _alvo);
END
$patch$;
