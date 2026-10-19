-- Portal sem texto interno (19/10/2026).
--
-- Em 09/10, 10 clientes receberam no portal (reports.status = 'published', sent_channel 'portal') a
-- preparação interna do Hermes: "Preparação interna para revisão; corte 09/10/2026 ... Status ACTIVE não
-- comprova entrega; saldo não é orçamento", com id de contrato e de arquivo no meio. O dono: "os clientes
-- já estão de saco cheio dessas mensagens".
--
-- Daqui para frente o banco recusa publicar um relatório cujo título ou texto tenha marca de nota interna,
-- venha de onde vier (painel, Hermes pelos RPCs *_por_agente, MCP). Só no momento em que vira publicado ou
-- em que o texto publicado muda: tirar do portal (voltar a rascunho) continua livre.
--
-- Marcas (determinísticas, sem falso positivo em texto para cliente):
--   - "Preparação interna" no título ou no texto;
--   - "corte dd/mm" no título (o recorte de dados do Hermes);
--   - id técnico (uuid) no texto.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.reports_sem_texto_interno()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'published'
          OR NEW.summary IS DISTINCT FROM OLD.summary
          OR NEW.title IS DISTINCT FROM OLD.title) THEN
    IF coalesce(NEW.title, '') ~* 'prepara(ç|c)(ã|a)o interna|corte [0-9]{2}/[0-9]{2}'
       OR coalesce(NEW.summary, '') ~* 'prepara(ç|c)(ã|a)o interna'
       OR coalesce(NEW.summary, '') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' THEN
      RAISE EXCEPTION 'TEXTO_INTERNO_NO_PORTAL: o relatório tem marca de nota interna (preparação interna, corte de dados ou id técnico) e não vai para o cliente. Reescreva para o cliente antes de publicar.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_sem_texto_interno_trg ON public.reports;
CREATE TRIGGER reports_sem_texto_interno_trg
  BEFORE INSERT OR UPDATE OF status, summary, title ON public.reports
  FOR EACH ROW EXECUTE FUNCTION public.reports_sem_texto_interno();

COMMENT ON FUNCTION public.reports_sem_texto_interno() IS
  '19/10/2026: recusa publicar no portal relatório com marca de nota interna (preparação interna, corte dd/mm no título, uuid no texto).';
