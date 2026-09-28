-- ═══════════════════════════════════════════════════════════════════════
-- AP-01 · APROVAÇÃO E AGENDA AUTOMÁTICAS (frente AP, 28/09). NÃO APLICADO.
--
-- Pedidos do dono (28/09):
--   1) "Quando eu envio para aprovação, já tem que aparecer instantaneamente
--      para o cliente na tela de aprovação, e em Arquivos também."
--   2) "Se o cliente aprovou, já tem que ir direto para a agenda, com base na
--      data. Se não tem data, dentro do Estúdio ele pergunta a data e o
--      horário, se vai postar ou não, onde, qual o perfil."
--   3) "Quando o cliente comentar em outro formato, já tem que atualizar
--      automaticamente e entender."
--
-- Este arquivo só amplia e é idempotente (pode rodar de novo):
--   1) public.files entra na publicação supabase_realtime. O Realtime aplica
--      a RLS de quem escuta (files_secure_select = can_read_file) e os
--      privilégios de coluna (o cliente só recebe as 34 colunas que já lê);
--      a tela do cliente só escuta INSERT e UPDATE do próprio client_id. A
--      RLS e can_access_client não mudam;
--   2) estudio_trabalhos ganha "não vai postar" (publicacao_dispensada_em/por):
--      a peça aprovada que o dono decidiu não publicar sai da pergunta de data;
--   3) mesa_avisos_da_decisao (gatilho da frente EA) passa a:
--      · guardar o comentário que o cliente deixa AO APROVAR (aprovação com
--        ressalva) na peça, junto dos pedidos de ajuste, com decisao='aprovado';
--      · avisar "aprovou; falta a data" com o link que abre a pergunta de data
--        no Estúdio (&publicar=<trabalho>), ou "aprovou e agendou para …"
--        quando a data já estava confirmada; nesse caso o aviso "agendado"
--        da mesma data (mesa_avisos_da_publicacao) não repete: um fato, um aviso;
--   4) file_approval_avisa_equipe (aviso genérico, peças fora da Mesa) leva o
--      comentário do cliente quando ele aprova com comentário.
--
-- Nenhum cron novo, nenhuma tabela nova, nenhum EXECUTE novo para anon.
-- O entendimento do pedido (Jev) é feito pela função estudio-arte
-- (ação pedido_entender) e gravado na própria lista ajustes_do_cliente.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Arquivos ao vivo para o cliente ─────────────────────────────────

DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'files'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.files;
  END IF;
END
$rt$;

-- ─── 2) "Não vai postar" na peça ─────────────────────────────────────────

ALTER TABLE public.estudio_trabalhos
  ADD COLUMN IF NOT EXISTS publicacao_dispensada_em timestamptz,
  ADD COLUMN IF NOT EXISTS publicacao_dispensada_por uuid;

COMMENT ON COLUMN public.estudio_trabalhos.publicacao_dispensada_em IS
  'Frente AP: o dono decidiu não publicar esta peça aprovada (fica em Arquivos). Confirmar uma data depois limpa.';

-- ─── 3) Decisão do cliente: comentário, data e um aviso por fato ────────

CREATE OR REPLACE FUNCTION public.mesa_avisos_da_decisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _t_id uuid;
  _t_client uuid;
  _t_task uuid;
  _t_post uuid;
  _t_sincronizada timestamptz;
  _t_ao_aprovar boolean;
  _t_rodada integer;
  _titulo text;
  _quando timestamptz;
  _pub_id uuid;
  _lamina integer;
  _texto text;
  _msg text;
  _link text;
  _agendado boolean := false;
BEGIN
  IF NEW.event_type NOT IN ('client_approved', 'client_approved_offline', 'client_rejected') THEN
    RETURN NEW;
  END IF;
  BEGIN
    SELECT t.id, t.client_id, t.task_id, t.post_id, t.agenda_sincronizada_em, t.publicar_ao_aprovar, t.entrega_rodada
      INTO _t_id, _t_client, _t_task, _t_post, _t_sincronizada, _t_ao_aprovar, _t_rodada
      FROM public.estudio_trabalhos t
     WHERE t.client_id = NEW.client_id
       AND cardinality(t.file_ids) > 0
       AND t.file_ids[1] = NEW.file_id
     ORDER BY t.criado_em DESC
     LIMIT 1;
    IF _t_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT NULLIF(btrim(title), '') INTO _titulo FROM public.tasks WHERE id = _t_task;
    _titulo := COALESCE(_titulo, 'post');
    _texto := left(NULLIF(btrim(COALESCE(NEW.feedback, '')), ''), 1000);
    _lamina := public.mesa_lamina_citada(_texto);

    -- O que o cliente escreveu fica na peça (pedido de ajuste ou comentário
    -- da aprovação). A função estudio-arte entende (Jev) e grava ao lado.
    IF _texto IS NOT NULL THEN
      UPDATE public.estudio_trabalhos
         SET ajustes_do_cliente = COALESCE(ajustes_do_cliente, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
               'evento_id', NEW.id,
               'texto', _texto,
               'lamina', _lamina,
               'pedido_em', NEW.created_at,
               'file_id', NEW.file_id,
               'post_id', _t_post,
               'rodada', COALESCE(_t_rodada, 1),
               'decisao', CASE WHEN NEW.event_type = 'client_rejected' THEN 'ajuste' ELSE 'aprovado' END
             )))
       WHERE id = _t_id
         AND NOT (COALESCE(ajustes_do_cliente, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('evento_id', NEW.id)));
    END IF;

    IF NEW.event_type = 'client_rejected' THEN
      PERFORM public.mesa_avisar_peca(
        _t_id,
        'ajuste:' || NEW.id::text,
        'approval',
        'Mesa: o cliente pediu ajuste em "' || _titulo || '"'
          || COALESCE(' (lâmina ' || _lamina::text || ')', '')
          || COALESCE(': ' || left(_texto, 300), '.'),
        '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&ajuste=cliente'
          || COALESCE('&lamina=' || _lamina::text, '')
      );
    ELSIF _t_sincronizada IS NOT NULL THEN
      SELECT pub.id, pub.scheduled_at INTO _pub_id, _quando
        FROM public.editorial_publications pub
       WHERE pub.post_id = _t_post AND pub.status IN ('planned', 'scheduled')
       ORDER BY (pub.platform = 'instagram') DESC
       LIMIT 1;
      _link := '/calendario?client=' || _t_client::text || COALESCE('&content=' || _t_post::text, '');
      IF _quando IS NULL THEN
        _msg := 'Mesa: o cliente aprovou "' || _titulo || '"; falta a data. Escolha a data, o perfil e se vai postar.';
        _link := '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&publicar=' || _t_id::text;
      ELSIF NOT COALESCE(_t_ao_aprovar, false) AND NEW.created_at > _quando + interval '5 minutes' THEN
        _msg := 'Mesa: o cliente aprovou "' || _titulo || '" depois do horário. Escolha uma nova data.';
        _link := '/mesa?client=' || _t_client::text || '&aba=estudio&task=' || _t_task::text || '&publicar=' || _t_id::text;
      ELSE
        _msg := 'Mesa: o cliente aprovou "' || _titulo || '". Agendado para '
          || to_char(greatest(_quando, NEW.created_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || '.';
        _agendado := _quando >= NEW.created_at;
      END IF;
      IF _texto IS NOT NULL THEN
        _msg := _msg || ' Comentário: "' || left(_texto, 200) || '"';
      END IF;
      PERFORM public.mesa_avisar_peca(_t_id, 'aprovado:' || NEW.id::text, 'approval', _msg, _link);
      -- Um fato, um aviso: o "agendado para" desta mesma data já foi dito aqui.
      IF _agendado AND _pub_id IS NOT NULL THEN
        INSERT INTO public.mesa_avisos_da_peca (chave, trabalho_id, tipo)
        VALUES (left('agendado:' || _pub_id::text || ':' || floor(extract(epoch FROM _quando))::bigint::text, 300), _t_id, 'publication')
        ON CONFLICT (chave) DO NOTHING;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mesa_avisos_da_decisao: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_avisos_da_decisao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mesa_avisos_da_decisao_trg ON public.file_approval_events;
CREATE TRIGGER mesa_avisos_da_decisao_trg
AFTER INSERT ON public.file_approval_events
FOR EACH ROW EXECUTE FUNCTION public.mesa_avisos_da_decisao();

-- ─── 4) Aviso genérico com o comentário da aprovação ────────────────────
-- Mesma função viva de 27/09 (frente N), com o comentário no fim quando o
-- cliente aprova comentando. A regra de ceder a vez para a Mesa não muda.

CREATE OR REPLACE FUNCTION public.file_approval_avisa_equipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cliente text;
  _arquivo text;
  _aprovou boolean;
  _mesa_cobre boolean := false;
  _comentario text;
BEGIN
  IF NEW.actor_id IS DISTINCT FROM NEW.client_id THEN RETURN NEW; END IF;
  IF NEW.to_status NOT IN ('approved', 'changes_requested', 'rejected') THEN RETURN NEW; END IF;
  _aprovou := NEW.to_status = 'approved';

  BEGIN
    -- A frente EA avisa a peça da Mesa com mais detalhe (data de publicação,
    -- lâmina citada). Quando o gatilho dela existe e a peça é dela, o aviso
    -- genérico sai de cena. to_jsonb lê a coluna nova sem depender dela.
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg
       WHERE tg.tgrelid = 'public.file_approval_events'::regclass
         AND tg.tgname = 'mesa_avisos_da_decisao_trg'
         AND tg.tgenabled <> 'D'
    ) THEN
      SELECT CASE WHEN _aprovou THEN (to_jsonb(t) ->> 'agenda_sincronizada_em') IS NOT NULL ELSE true END
        INTO _mesa_cobre
        FROM public.estudio_trabalhos t
       WHERE t.client_id = NEW.client_id
         AND cardinality(t.file_ids) > 0
         AND t.file_ids[1] = NEW.file_id
       ORDER BY t.criado_em DESC
       LIMIT 1;
    END IF;
    IF COALESCE(_mesa_cobre, false) THEN RETURN NEW; END IF;

    SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente FROM public.profiles p WHERE p.id = NEW.client_id;
    SELECT f.file_name INTO _arquivo FROM public.files f WHERE f.id = NEW.file_id;
    _comentario := left(NULLIF(btrim(COALESCE(NEW.feedback, '')), ''), 200);
    IF _aprovou THEN
      PERFORM public.avisar_equipe_do_cliente(NEW.client_id,
        'Aprovação recebida: ' || COALESCE(_cliente, 'Cliente') || ' aprovou "' || COALESCE(_arquivo, 'material') || '". Pronto para agendar na Agenda.'
          || COALESCE(' Comentário: "' || _comentario || '"', ''),
        'approval', '/calendario');
    ELSE
      PERFORM public.avisar_equipe_do_cliente(NEW.client_id,
        'Ajustes solicitados: ' || COALESCE(_cliente, 'Cliente') || ' pediu mudanças em "' || COALESCE(_arquivo, 'material') || '".',
        'approval', '/aprovacoes');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'file_approval_avisa_equipe: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- ─── Conferência (rodar depois de aplicar, só leitura) ───────────────────
-- select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
--                  and schemaname = 'public' and tablename = 'files') as files_ao_vivo;
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'estudio_trabalhos' and column_name like 'publicacao_dispensada%';
-- select position('falta a data' in pg_get_functiondef('public.mesa_avisos_da_decisao()'::regprocedure)) > 0 as aviso_novo;
--
-- ─── Para desfazer só o tempo real ───────────────────────────────────────
--   alter publication supabase_realtime drop table public.files;
--   (a tela volta a reler a cada 20 s, como antes).
