-- Revisao do Ciclo (/ciclo/revisao) passa a avisar. Ate aqui um pedido de
-- revisao preparado ficava esperando alguem lembrar de abrir a tela. Agora:
--   1) pedido preparado (operator_approvals.origin = 'central') -> aviso aos
--      administradores com link direto para o pedido;
--   2) decisao tomada (aprovado, rejeitado, alteracoes pedidas) -> aviso.
-- Mesmo padrao dos avisos de ordem executada; o gatilho de deduplicacao das
-- notificacoes (10 min) continua valendo.

CREATE OR REPLACE FUNCTION public.central_review_avisar_pedido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cliente text;
  _titulo text;
BEGIN
  IF NEW.origin IS DISTINCT FROM 'central' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente
    FROM public.profiles p WHERE p.id = NEW.client_id;
  _titulo := COALESCE(NULLIF(NEW.payload->'report'->>'title', ''), NEW.o_que, 'mensagem');
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id,
         'Revisão do Ciclo: ' || COALESCE(_cliente, 'Cliente') || ' · "' || left(_titulo, 80) || '" está pronta para a sua decisão.',
         'central_review_pendente',
         '/ciclo/revisao?client=' || COALESCE(NEW.client_id::text, '') || '&review=' || NEW.id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_central_review_avisar_pedido ON public.operator_approvals;
CREATE TRIGGER trg_central_review_avisar_pedido
  AFTER INSERT ON public.operator_approvals
  FOR EACH ROW EXECUTE FUNCTION public.central_review_avisar_pedido();

CREATE OR REPLACE FUNCTION public.central_review_avisar_decisao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cliente text;
  _titulo text;
  _frase text;
BEGIN
  IF NEW.origin IS DISTINCT FROM 'central' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  _frase := CASE NEW.status
    WHEN 'aprovado' THEN 'aprovada. Nenhuma mensagem foi enviada; o envio continua sendo seu.'
    WHEN 'rejeitado' THEN 'rejeitada.'
    WHEN 'alteracoes_pedidas' THEN 'devolvida com pedido de alterações.'
    ELSE NULL END;
  IF _frase IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente
    FROM public.profiles p WHERE p.id = NEW.client_id;
  _titulo := COALESCE(NULLIF(NEW.payload->'report'->>'title', ''), NEW.o_que, 'mensagem');
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT ur.user_id,
         'Revisão de ' || COALESCE(_cliente, 'Cliente') || ': "' || left(_titulo, 80) || '" foi ' || _frase,
         'central_review_decidida',
         '/ciclo/revisao?client=' || COALESCE(NEW.client_id::text, '') || '&review=' || NEW.id::text
    FROM public.user_roles ur WHERE ur.role = 'admin';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_central_review_avisar_decisao ON public.operator_approvals;
CREATE TRIGGER trg_central_review_avisar_decisao
  AFTER UPDATE OF status ON public.operator_approvals
  FOR EACH ROW EXECUTE FUNCTION public.central_review_avisar_decisao();
